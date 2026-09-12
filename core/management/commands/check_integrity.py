"""Integrity agent: read-only data-health scan (Phase 1).

Reports evidence, repairs NOTHING — every finding needs a human (the board
revert button covers marks). Signals, aggregated to bound board volume:
- marks above the subject's full marks (warning per class x term);
- result rows belonging to soft-deleted students (warning per class);
- result rows with empty marks older than 7 days (info per class x term).

Run: ~/schoolenv/bin/python ~/school.management.django/manage.py check_integrity
Suggested cron: 0 3 * * * (nightly).
"""
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from core.findings import report, resolve_stale
from core.models import SchoolClass, Subject
from results.models import Result

try:
    from results.serializers import SUBJECT_KEY_MAP
except Exception:
    SUBJECT_KEY_MAP = {}


class Command(BaseCommand):
    help = 'Integrity: file findings for corrupt/legacy result data.'

    def add_arguments(self, parser):
        parser.add_argument('--dry-run', action='store_true')

    def handle(self, *args, **opts):
        dry = opts['dry_run']
        filed = 0
        current_keys = []
        week_ago = timezone.now() - timedelta(days=7)

        for klass in SchoolClass.objects.all().order_by('order'):
            limits = {}
            for sub in Subject.objects.filter(school_class=klass):
                limits[sub.name] = sub.full_marks
                canonical = SUBJECT_KEY_MAP.get(sub.name, sub.name)
                limits.setdefault(canonical, sub.full_marks)
            rows = list(Result.objects.filter(
                student__school_class=klass).select_related('student'))

            over, orphan, stale = [], [], []
            for r in rows:
                marks = r.marks or {}
                if getattr(r.student, 'deleted_at', None):
                    orphan.append(str(r.id))
                    continue
                for subj, val in marks.items():
                    if val is None or isinstance(val, bool):
                        continue
                    try:
                        num = float(val)
                    except (TypeError, ValueError):
                        over.append({'row': str(r.id), 'student': r.student.name,
                                     'term': r.term, 'subject': subj, 'value': val,
                                     'reason': 'not-a-number'})
                        continue
                    full = limits.get(subj)
                    if full is not None and num > full:
                        over.append({'row': str(r.id), 'student': r.student.name,
                                     'term': r.term, 'subject': subj, 'value': val,
                                     'full': full})
                if not marks and r.created_at and r.created_at < week_ago:
                    stale.append({'row': str(r.id), 'student': r.student.name,
                                  'term': r.term, 'session': r.session})

            for kind, items, severity, text in [
                ('over-range', over, 'warning', 'marks above full marks'),
                ('orphan-rows', orphan, 'warning', 'rows belong to deleted students'),
                ('empty-rows', stale, 'info', 'empty rows older than 7 days'),
            ]:
                if not items:
                    continue
                key = ('result', f'{klass.id}:integrity:{kind}')
                current_keys.append(key)
                msg = f'{klass.name}: {len(items)} {text}'
                if dry:
                    self.stdout.write(f'[DRY-RUN] {severity} {msg}')
                else:
                    report('integrity', severity, 'result', f'{klass.id}:integrity:{kind}',
                           msg, {'class': klass.name, 'kind': kind,
                                 'items': items[:20],
                                 'total': len(items)})
                    filed += 1

        healed = 0 if dry else resolve_stale('integrity', current_keys)
        self.stdout.write(
            f'[{"DRY-RUN" if dry else "INTEGRITY"}] filed={filed} auto-resolved={healed}')
