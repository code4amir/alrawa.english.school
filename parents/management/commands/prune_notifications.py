"""Monthly hygiene: delete NotificationLog rows past the retention window.

Correctness never depends on this — the parent notifications endpoint
already filters by the TTL window on every read. This command only reclaims
disk space and keeps the table small.

Schedule (Alwaysdata cron, monthly):
    python manage.py prune_notifications --days 90
"""
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from parents.models import NotificationLog
from parents.views import NOTIFICATION_TTL_DAYS


class Command(BaseCommand):
    help = 'Delete notification-log rows older than the retention window.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--days', type=int, default=NOTIFICATION_TTL_DAYS,
            help=f'Retention window in days (default: {NOTIFICATION_TTL_DAYS}).',
        )
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Report how many rows would be deleted without deleting.',
        )

    def handle(self, *args, **options):
        days = options['days']
        if days <= 0:
            self.stderr.write('--days must be positive')
            raise SystemExit(2)
        cutoff = timezone.now() - timedelta(days=days)
        qs = NotificationLog.objects.filter(sent_at__lt=cutoff)
        count = qs.count()
        if options['dry_run']:
            self.stdout.write(f'[dry-run] would delete {count} rows older than {cutoff.isoformat()}')
            return
        deleted, _ = qs.delete()
        self.stdout.write(f'Pruned {deleted} notification rows older than {days} days.')
