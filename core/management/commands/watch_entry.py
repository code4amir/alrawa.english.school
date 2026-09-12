"""Watchdog agent: entry-completeness scan (Phase 1).

Files findings, never touches data. Signals:
- published term with missing marks per class x term (warning) — the gap
  that burns report-card season;
- class with zero result rows for the active session (info) — entry hasn't
  started or the class is new.

Run: ~/schoolenv/bin/python ~/school.management.django/manage.py watch_entry
Suggested cron: 0 7 * * * (before teachers start; digest follows at 8).
"""
import json

from django.core.management.base import BaseCommand

from core.findings import report, resolve_stale
from core.models import AcademicYear, SchoolClass, Subject
from results.models import Result
from students.models import Student

try:
    from results.serializers import SUBJECT_KEY_MAP
except Exception:
    SUBJECT_KEY_MAP = {}

TERMS = ['1', '2', '3']


def _published_terms():
    from core.models import SchoolSetting
    setting = SchoolSetting.objects.filter(key='published_terms').first()
    if not setting or not setting.value:
        return {}
    try:
        return json.loads(setting.value)
    except (json.JSONDecodeError, TypeError):
        return {}


class Command(BaseCommand):
    help = 'Watchdog: file findings for published-but-incomplete entry.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true')

    def handle(self, *args, **opts):
        dry = opts['dry_run']
        year = AcademicYear.objects.filter(is_active=True).first()
        if not year:
            self.stdout.write('No active academic year.')
            return
        session = year.name
        published = {str(t) for t in _published_terms().get(session, [])}
        filed = 0
        current_keys = []

        for klass in SchoolClass.objects.all().order_by('order'):
            roster = list(Student.objects.filter(
                school_class=klass, deleted_at__isnull=True).values_list('id', flat=True))
            rows = list(Result.objects.filter(
                student__school_class=klass, session=session,
                student__deleted_at__isnull=True))
            if not rows:
                key = ('result', f'{klass.id}:none')
                current_keys.append(key)
                msg = f'{klass.name}: no results entered yet for {session} ({len(roster)} students)'
                if dry:
                    self.stdout.write(f'[DRY-RUN] info {msg}')
                else:
                    report('watchdog', 'info', 'result', f'{klass.id}:none', msg,
                           {'class': klass.name, 'session': session, 'roster': len(roster)})
                    filed += 1
                continue
            by_term = {}
            for r in rows:
                by_term.setdefault(str(r.term), []).append(r)
            subjects = list(Subject.objects.filter(school_class=klass))
            for term in TERMS:
                term_rows = {str(sid): {} for sid in roster}
                for r in by_term.get(term, []):
                    term_rows[str(r.student_id)] = r.marks or {}
                gaps = []
                for sub in subjects:
                    canonical = SUBJECT_KEY_MAP.get(sub.name, sub.name)
                    done = sum(1 for m in term_rows.values()
                               if m.get(canonical) is not None)
                    if done < len(roster):
                        gaps.append({'subject': sub.name, 'done': done,
                                     'total': len(roster)})
                if gaps and term in published:
                    key = ('result', f'{klass.id}:{term}')
                    current_keys.append(key)
                    shown = ', '.join(f"{g['subject']} {g['done']}/{g['total']}" for g in gaps[:5])
                    msg = (f'{klass.name} Term {term} is published but incomplete: '
                           f'{shown}' + (f' +{len(gaps) - 5} more' if len(gaps) > 5 else ''))
                    if dry:
                        self.stdout.write(f'[DRY-RUN] warning {msg}')
                    else:
                        report('watchdog', 'warning', 'result', f'{klass.id}:{term}', msg,
                               {'class': klass.name, 'session': session,
                                'term': term, 'gaps': gaps})
                        filed += 1

        if not dry:
            healed = resolve_stale('watchdog', current_keys)
        else:
            healed = 0
        self.stdout.write(
            f'[{"DRY-RUN" if dry else "WATCH"}] session={session} '
            f'filed={filed} auto-resolved={healed}')
