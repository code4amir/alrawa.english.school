"""
Alwaysdata scheduled-task (cron `job`) management.

The school runs on Alwaysdata; its own cron daemon is what actually executes the
dues-reminder management command on schedule (the Django app is not a long-running
daemon). This service lets the in-app admin manage those scheduled tasks by
proxying Alwaysdata's admin REST API (`/v1/job/`), and it can trigger a command
*now* synchronously via subprocess (the "Run now" action).

Secrets:
- API token is read from the environment (`ALWAYSDATA_SCHED_TOKEN`). It is NEVER
  stored in the database or returned to the client.
"""
from __future__ import annotations

import logging
import os
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import requests

logger = logging.getLogger(__name__)

ALWAYSDATA_BASE = "https://api.alwaysdata.com/v1"
SCHED_TOKEN_ENV = "ALWAYSDATA_SCHED_TOKEN"

BASE_DIR = Path(__file__).resolve().parent.parent  # …/school_management/core -> project root


class SchedulerConfigError(Exception):
    def __init__(self, missing: str):
        self.missing = missing
        super().__init__(
            f"{missing} is not configured. Add it to the server .env via the "
            "Alwaysdata panel (Web -> <site> -> Environment) and restart."
        )


@dataclass
class Job:
    """A serialisable view of an Alwaysdata scheduled `job` (cron)."""

    id: int | None = None
    type: str = "TYPE_COMMAND"
    date_type: str = "CRONTAB"
    crontab_syntax: str = ""
    argument: str = ""
    ssh_user: int | None = None
    working_directory: str = ""
    annotation: str = ""
    is_disabled: bool = False
    href: str = ""
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def enabled(self) -> bool:
        return not self.is_disabled

    def to_public(self) -> dict[str, Any]:
        """Shape safe to send to the frontend (no secrets)."""
        return {
            "id": self.id,
            "crontabSyntax": self.crontab_syntax,
            "argument": self.argument,
            "annotation": self.annotation,
            "isDisabled": self.is_disabled,
            "workingDirectory": self.working_directory,
            "href": self.href,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Job":
        known = {
            "id", "type", "date_type", "crontab_syntax", "argument",
            "ssh_user", "working_directory", "annotation", "is_disabled", "href",
        }
        extra = {k: v for k, v in data.items() if k not in known}
        return cls(
            id=data.get("id"),
            type=data.get("type", "TYPE_COMMAND"),
            date_type=data.get("date_type", "CRONTAB"),
            crontab_syntax=data.get("crontab_syntax") or "",
            argument=data.get("argument") or "",
            ssh_user=data.get("ssh_user"),
            working_directory=data.get("working_directory") or "",
            annotation=data.get("annotation") or "",
            is_disabled=bool(data.get("is_disabled", False)),
            href=data.get("href") or "",
            extra=extra,
        )


def _token() -> str:
    tok = os.environ.get(SCHED_TOKEN_ENV, "").strip()
    if not tok:
        raise SchedulerConfigError(SCHED_TOKEN_ENV)
    return tok


def _auth() -> tuple[str, str]:
    return (_token(), "")


def _headers() -> dict[str, str]:
    return {
        "Content-Type": "application/json",
        "alwaysdata-synchronous": "true",
    }


def _raise_for_failed(resp: requests.Response) -> None:
    if resp.status_code >= 400:
        try:
            if resp.headers.get("content-type", "").startswith("application/json"):
                detail = resp.json()
            else:
                detail = resp.text[:300]
        except Exception:
            detail = resp.text[:300]
        raise RuntimeError(
            f"Alwaysdata API {resp.status_code} {resp.url}: {detail}"
        )


# ---------------------------------------------------------------------------
# CRUD against Alwaysdata's `/v1/job/` resource
# ---------------------------------------------------------------------------
def list_jobs() -> list[Job]:
    resp = requests.get(f"{ALWAYSDATA_BASE}/job/", auth=_auth(), timeout=30)
    _raise_for_failed(resp)
    return [Job.from_dict(item) for item in resp.json()]


def get_job(job_id: int) -> Job:
    resp = requests.get(f"{ALWAYSDATA_BASE}/job/{job_id}/", auth=_auth(), timeout=30)
    _raise_for_failed(resp)
    return Job.from_dict(resp.json())


def create_job(**fields) -> Job:
    payload = {
        "type": "TYPE_COMMAND",
        "date_type": "CRONTAB",
        "crontab_syntax": fields.get("crontab_syntax", ""),
        "argument": fields.get("argument", ""),
        "ssh_user": fields.get("ssh_user"),
        "working_directory": fields.get("working_directory", ""),
        "annotation": fields.get("annotation", ""),
        "is_disabled": bool(fields.get("is_disabled", False)),
    }
    resp = requests.post(
        f"{ALWAYSDATA_BASE}/job/", headers=_headers(), json=payload,
        auth=_auth(), timeout=30,
    )
    _raise_for_failed(resp)
    loc = resp.headers.get("Location") or resp.headers.get("location") or ""
    if loc:
        job_id = int(loc.rstrip("/").rsplit("/", 1)[-1])
        return get_job(job_id)
    return Job()


def update_job(job_id: int, **fields) -> Job:
    payload = {
        "type": "TYPE_COMMAND",
        "date_type": "CRONTAB",
        "crontab_syntax": fields.get("crontab_syntax"),
        "argument": fields.get("argument"),
        "ssh_user": fields.get("ssh_user"),
        "working_directory": fields.get("working_directory"),
        "annotation": fields.get("annotation"),
        "is_disabled": fields.get("is_disabled"),
    }
    payload = {k: v for k, v in payload.items() if v is not None}
    resp = requests.put(
        f"{ALWAYSDATA_BASE}/job/{job_id}/", headers=_headers(), json=payload,
        auth=_auth(), timeout=30,
    )
    _raise_for_failed(resp)
    return get_job(job_id)


def delete_job(job_id: int) -> None:
    resp = requests.delete(
        f"{ALWAYSDATA_BASE}/job/{job_id}/", auth=_auth(), timeout=30
    )
    if resp.status_code not in (200, 204):
        _raise_for_failed(resp)


# ---------------------------------------------------------------------------
# "Run now" — execute a Django management command in-process at this host
# ---------------------------------------------------------------------------
def _resolve_python() -> str:
    """Return the python interpreter to spawn for 'run now' commands.

    Inside a WSGI worker ``sys.executable`` is the uWSGI binary, not a
    python interpreter, so it cannot be used to run ``manage.py``. The
    cron job on Alwaysdata runs with ``~/schoolenv/bin/python`` — the venv
    that sits next to the project checkout — so we prefer that layout,
    then ``VIRTUAL_ENV``, and only fall back to ``sys.executable``.
    """
    # 1) venv next to the project checkout (Alwaysdata: ~/schoolenv)
    candidate = BASE_DIR.parent / "schoolenv" / ("Scripts" if os.name == "nt" else "bin") / (
        "python.exe" if os.name == "nt" else "python"
    )
    if candidate.exists():
        return str(candidate)
    # 2) active virtualenv
    venv = os.environ.get("VIRTUAL_ENV")
    if venv:
        return str(
            Path(venv) / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        )
    # 3) fallback (manage.py shell / local dev)
    return sys.executable


def run_command_now(command: str, *args: str, timeout: int = 600) -> dict[str, Any]:
    """Run a management command synchronously and return {ok, output}.

    `command` is a management-command name (e.g. 'send_due_reminders'); we run
    `{BASE_DIR}/manage.py <command> [--dry-run ...]`. Uses the venv python that
    sits next to the checkout (same interpreter the cron job uses), so the
    subprocess shares Django + deps with the scheduler.
    """
    if command.endswith(".py") or " " in command:
        argv = [command, *args]
    else:
        argv = [_resolve_python(), str(BASE_DIR / "manage.py"), command, *args]
    logger.info("scheduler.run_command_now: %s", " ".join(argv))
    try:
        proc = subprocess.run(
            argv, capture_output=True, text=True, timeout=timeout, cwd=BASE_DIR,
        )
        output = (proc.stdout or "") + (proc.stderr or "")
        return {
            "ok": proc.returncode == 0,
            "command": command,
            "args": list(args),
            "output": output[-8000:],
            "exitCode": proc.returncode,
        }
    except subprocess.TimeoutExpired as exc:
        output = (exc.stdout or "") + (exc.stderr or "") + f"\n[TIMED OUT after {timeout}s]"
        return {
            "ok": False,
            "command": command,
            "args": list(args),
            "output": output[-8000:],
            "exitCode": None,
        }
