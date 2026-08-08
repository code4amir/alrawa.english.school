import sys
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = (
        'Send dues-reminders to the parents of every defaulting student '
        '(current-month-anchored range). Intended for Alwaysdata cron, e.g.:\n'
        '  0 8 * * 1  ~/schoolenv/bin/python ~/school-management/manage.py send_due_reminders\n'
        'Options: --class-name, --fee-category, --note, --dry-run'
    )

    def add_arguments(self, parser):
        parser.add_argument('--class-name', dest='class_name', help='Restrict to a class name')
        parser.add_argument('--fee-category', dest='fee_category', help='Restrict to a fee category')
        parser.add_argument('--note', default='', help='Optional note appended to the reminder')
        parser.add_argument('--dry-run', action='store_true', help='Compute + log but do not notify')

    def handle(self, *args, **options):
        # Lazy imports: this command runs in a fresh process where importing
        # finance.services.defaulter_service at module top triggers a circular
        # import via finance.views (defaulter_service -> views.base -> views ->
        # services). Deferring until here lets the app fully load first.
        from django.utils import timezone
        from finance.services.defaulter_service import DefaulterService
        from parents.services import count_linked_parents, notify_parents_dues, compose_dues_body

        now = timezone.now()
        month_to = f"{now.year}-{now.month:02d}"
        prev_year = now.year - 1 if now.month == 1 else now.year
        prev_month = 12 if now.month == 1 else now.month - 1
        month_from = f"{prev_year}-{prev_month:02d}"

        svc = DefaulterService(
            class_name=options['class_name'] or None,
            fee_category=options['fee_category'] or None,
            month_from=month_from, month_to=month_to,
        )
        svc.resolve_year()
        students = list(svc.get_student_queryset())

        processed = skipped = notified = 0
        per_student = []
        for student in students:
            result = svc.compute([student], [student.id])
            fees = result[0]['fees'] if result else []
            if not compose_dues_body(fees):
                skipped += 1
                continue
            processed += 1
            if options['dry_run']:
                # Report how many parents *would* be notified, without sending.
                n = count_linked_parents(student.id)
            else:
                n = notify_parents_dues(student.id, fees, options['note'] or '')
            notified += n
            per_student.append(f"  {student.name} -> {n} parent(s)")

        mode = 'DRY-RUN (no notifications sent)' if options['dry_run'] else 'SEND'
        summary = (
            f"[{mode}] Students: {len(students)} | Processed: {processed} "
            f"| Notified: {notified} | Skipped: {skipped}"
        )
        self.stdout.write(summary)

        if per_student:
            self.stdout.write('--- per student ---')
            self.stdout.write('\n'.join(per_student))

        # Non-zero exit when nothing ran so the cron log is easy to scan.
        if processed == 0:
            sys.stdout.write('(no defaulting students)\n')