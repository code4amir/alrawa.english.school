"""Morning digest agent: one push per admin summarizing open findings.

Reads the board (warning + critical, newest 20), pushes a single message
per admin login, and logs each send to NotificationLog like every other
fan-out. Never touches school data.

Run: ~/schoolenv/bin/python ~/school.management.django/manage.py send_agent_digest
Suggested cron: 0 8 * * 1-6 (after the 7am watchdog).
"""
import logging

from django.core.management.base import BaseCommand
from django.db.models import Q

from core.models import AgentFinding

logger = logging.getLogger(__name__)

EMOJI = {'critical': '🔴', 'warning': '🟡', 'info': '🔵'}


class Command(BaseCommand):
    help = 'Send admins one digest push of open agent findings.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true')

    def handle(self, *args, **opts):
        from django.contrib.auth import get_user_model
        from parents.services import notify
        from parents.models import NotificationLog

        User = get_user_model()
        findings = list(AgentFinding.objects.filter(
            status='open', severity__in=('warning', 'critical'),
        ).order_by('-created_at')[:20])
        total = AgentFinding.objects.filter(
            status='open', severity__in=('warning', 'critical')).count()
        if not findings:
            self.stdout.write('[DIGEST] nothing open — no message sent.')
            return

        lines = [f"{EMOJI.get(f.severity, '•')} {f.summary[:110]}" for f in findings]
        if total > len(lines):
            lines.append(f'…and {total - len(lines)} more.')
        body = f'{total} item{"s" if total != 1 else ""} need attention:\n' + '\n'.join(lines)
        body += '\nSee Audit Logs → Agent Findings.'
        title = 'School monitor'

        admins = User.objects.filter(
            Q(role='admin') | Q(is_superuser=True), is_active=True).distinct()
        if opts['dry_run']:
            self.stdout.write(f'[DRY-RUN] would notify {admins.count()} admin(s):')
            self.stdout.write(body)
            return

        notified = 0
        for admin in admins:
            err = None
            try:
                notify(admin, title, body, url='/audit')
                notified += 1
            except Exception as e:
                err = str(e)
                logger.exception('Digest failed for %s', admin.email)
            NotificationLog.objects.create(
                user=admin, event_type='agent_digest', title=title, body=body,
                payload={'open_findings': total}, error=err)
        self.stdout.write(f'[DIGEST] open={total} admins_notified={notified}')
