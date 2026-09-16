from datetime import date
from decimal import Decimal
from django.db.models import Sum, Q
from finance.models import FeeSchedule, FeeWaiver, PaymentAllocation, Transaction, StudentFeeAssignment
from students.models import Student
from finance.views.base import _waiver_expected_amount, _waiver_covers_month, _parse_month


class FeeStatusService:

    def __init__(self, student_id, fee_month=None, fee_month_to=None, academic_year=None):
        self.student_id = student_id
        self.fee_month = fee_month
        self.fee_month_to = fee_month_to
        self.academic_year = academic_year

    def get_status(self):
        try:
            student = Student.objects.get(id=self.student_id)
        except Student.DoesNotExist:
            return None

        class_id = student.school_class_id
        schedules = FeeSchedule.objects.filter(
            Q(school_class_id=class_id) | Q(school_class_id__isnull=True)
        ).select_related('school_class', 'academic_year').order_by('category')
        if self.academic_year:
            # Opt-in scope; default remains unscoped (all years).
            schedules = schedules.filter(academic_year__name=self.academic_year)

        auto_schedules, assigned_only_schedules = [], []
        for s in schedules:
            (auto_schedules if s.applicability == 'AUTO' else assigned_only_schedules).append(s)

        assignment_dates, matching_assigned_ids = self._fetch_assignments(student, assigned_only_schedules)

        final_schedules = auto_schedules + [
            s for s in assigned_only_schedules if s.id in matching_assigned_ids
        ]

        paid_by_schedule_period = self._fetch_paid_by_schedule(student, final_schedules)
        paid_by_category_month = self._fetch_paid_by_category(student, final_schedules)
        waiver_map = self._fetch_waivers(student, final_schedules)

        return self._build_result(
            final_schedules, paid_by_schedule_period,
            paid_by_category_month, waiver_map, assignment_dates,
        )

    def _fetch_assignments(self, student, assigned_only_schedules):
        assignment_dates = {}
        matching_assigned_ids = set()
        if not assigned_only_schedules:
            return assignment_dates, matching_assigned_ids

        query_start = self.fee_month or date.today().strftime('%Y-%m')
        query_end = self.fee_month_to or query_start

        try:
            assignments = StudentFeeAssignment.objects.filter(
                student=student,
                fee_schedule_id__in=[s.id for s in assigned_only_schedules],
                active=True,
                starts_at__lte=query_end,
                ends_at__gte=query_start,
            )
            for a in assignments:
                matching_assigned_ids.add(a.fee_schedule_id)
                assignment_dates[str(a.fee_schedule_id)] = {
                    'assignmentStart': a.starts_at,
                    'assignmentEnd': a.ends_at,
                }
        except Exception:
            import logging
            logging.getLogger(__name__).warning('Failed to fetch fee assignments', exc_info=True)
        return assignment_dates, matching_assigned_ids

    def _fetch_paid_by_schedule(self, student, final_schedules):
        if not final_schedules:
            return {}
        alloc_filter = Q(
            student=student,
            transaction__transaction_type='INCOME',
            transaction__is_cancelled=False,
            fee_schedule_id__in=[s.id for s in final_schedules],
        )
        if self.fee_month:
            alloc_filter &= Q(period__gte=self.fee_month)
        if self.fee_month_to:
            alloc_filter &= Q(period__lte=self.fee_month_to)

        result = {}
        for pa in PaymentAllocation.objects.filter(alloc_filter).values(
            'fee_schedule_id', 'period'
        ).annotate(total=Sum('amount')):
            fs_id = str(pa['fee_schedule_id'])
            if fs_id not in result:
                result[fs_id] = {}
            result[fs_id][pa['period']] = pa['total']
        return result

    def _fetch_paid_by_category(self, student, final_schedules):
        if not final_schedules:
            return {}
        tx_filter = Q(
            student_id=self.student_id,
            transaction_type='INCOME',
            is_cancelled=False,
        )
        if self.fee_month:
            tx_filter &= Q(fee_month__gte=self.fee_month)
        if self.fee_month_to:
            tx_filter &= Q(fee_month__lte=self.fee_month_to)

        result = {}
        for pt in Transaction.objects.filter(tx_filter).values(
            'category', 'fee_month'
        ).annotate(total=Sum('amount')):
            cat = pt['category']
            month = pt['fee_month'] or ''
            if cat not in result:
                result[cat] = {}
            result[cat][month] = pt['total']
        return result

    def _fetch_waivers(self, student, final_schedules):
        if not final_schedules:
            return {}
        return {
            str(w.fee_schedule_id): w
            for w in FeeWaiver.objects.filter(
                student=student, fee_schedule__in=final_schedules, active=True,
                approval_status='approved',
            )
        }

    def _build_result(self, final_schedules, paid_by_schedule_period, paid_by_category_month, waiver_map, assignment_dates):
        result = []
        for s in final_schedules:
            fs_id = str(s.id)
            a_start = assignment_dates.get(fs_id, {}).get('assignmentStart')
            a_end = assignment_dates.get(fs_id, {}).get('assignmentEnd')

            valid_months = self._valid_months(s, a_start, a_end)
            num_valid_months = len(valid_months)

            schedule_paid = paid_by_schedule_period.get(fs_id, {})
            cat_paid = paid_by_category_month.get(s.category, {})

            waiver = waiver_map.get(fs_id)
            expected_per_month = float(s.amount)
            expected_total = 0.0

            unpaid_months = []
            for month in valid_months:
                # A waiver only discounts the months inside its active window.
                w = waiver if _waiver_covers_month(waiver, month) else None
                month_expected = float(_waiver_expected_amount(w, s.amount))
                expected_per_month = month_expected
                expected_total += month_expected
                # Allocation rows are authoritative, but bulk/legacy payments
                # were written with category + fee_month only — fall back to
                # the transaction-level sums so paid months don't read unpaid.
                # max(), never sum: form payments record BOTH, and doubling
                # them would mark partial months paid.
                month_paid = max(
                    schedule_paid.get(month, Decimal('0')),
                    cat_paid.get(month, Decimal('0')),
                )
                if float(month_paid) < month_expected:
                    unpaid_months.append(month)

            item = {
                'feeScheduleId': fs_id,
                'category': s.category,
                'feeScheduleAmount': float(s.amount),
                'amount': expected_per_month,
                'frequency': s.frequency,
                'applicability': s.applicability,
                'paid': len(unpaid_months) == 0 and num_valid_months > 0,
                'numMonths': num_valid_months,
                'expectedTotal': expected_total,
                'unpaidMonths': unpaid_months,
            }
            if a_start:
                item['assignmentStart'] = a_start
            if a_end:
                item['assignmentEnd'] = a_end
            result.append(item)
        return result

    def _valid_months(self, s, a_start, a_end):
        if s.frequency == 'MONTHLY' and self.fee_month and self.fee_month_to:
            months = self._months_in_range(self.fee_month, self.fee_month_to)
            return [
                m for m in months
                if (not a_start or m >= a_start) and (not a_end or m <= a_end)
            ]
        elif s.frequency == 'MONTHLY' and self.fee_month:
            if (a_start and self.fee_month < a_start) or (a_end and self.fee_month > a_end):
                return []
            return [self.fee_month]
        return [self.fee_month or '']

    @staticmethod
    def _months_in_range(start, end):
        months = []
        y, m = _parse_month(start, 'fee_month')
        ey, em = _parse_month(end, 'fee_month_to')
        while y < ey or (y == ey and m <= em):
            months.append(f"{y}-{m:02d}")
            m += 1
            if m > 12:
                m = 1
                y += 1
        return months
