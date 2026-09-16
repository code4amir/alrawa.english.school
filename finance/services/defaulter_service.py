from decimal import Decimal
from django.db.models import Sum, Q
from finance.models import FeeSchedule, FeeWaiver, PaymentAllocation, StudentFeeAssignment
from students.models import Student
from core.models import AcademicYear
from finance.views.base import _waiver_expected_amount, _waiver_covers_month, _parse_month


class DefaulterService:

    def __init__(self, class_name=None, student_id=None, fee_category=None,
                 month_from=None, month_to=None, year_str=None):
        self.class_name = class_name
        self.student_id = student_id
        self.fee_category = fee_category
        self.month_from = month_from
        self.month_to = month_to
        self.year_str = year_str

    def resolve_year(self):
        if self.year_str:
            exact = AcademicYear.objects.filter(name=self.year_str).first()
            if exact:
                self.year_str = exact.name
            else:
                match = AcademicYear.objects.filter(name__icontains=self.year_str).first()
                self.year_str = match.name if match else self.year_str
        else:
            from django.utils import timezone
            from core.request_cache import get_active_year
            active_year = get_active_year()
            self.year_str = active_year.name if active_year else str(timezone.now().year)
        return self.year_str

    def get_student_queryset(self, page_num=None, page_size=None):
        qs = Student.objects.filter(deleted_at__isnull=True)
        if self.class_name:
            qs = qs.filter(school_class__name=self.class_name)
        if self.student_id:
            qs = qs.filter(id=self.student_id)
        return qs

    def paginate_students(self, qs, page_num, page_size):
        total_rows = qs.count()
        if total_rows == 0:
            return [], total_rows
        start = (page_num - 1) * page_size
        page_students = list(
            qs.select_related('school_class').only('id', 'name', 'school_class__name')[start:start + page_size]
        )
        return page_students, total_rows

    def compute(self, students, student_ids):
        fee_schedules = FeeSchedule.objects.filter(
            academic_year__name=self.year_str,
        ).select_related('academic_year', 'school_class')
        if self.fee_category:
            fee_schedules = fee_schedules.filter(category=self.fee_category)

        yearly_schedules = [fs for fs in fee_schedules if fs.frequency in ('YEARLY', 'ONE_TIME')]
        monthly_schedules = [fs for fs in fee_schedules if fs.frequency == 'MONTHLY']

        assigned = self._fetch_monthly_assignments(student_ids, monthly_schedules)
        yearly_assigned = self._fetch_yearly_assignments(student_ids, yearly_schedules)
        paid_map = self._fetch_paid_map(student_ids)
        tx_paid_map = self._fetch_tx_paid_map(student_ids)
        waiver_map = self._fetch_waiver_map(student_ids)

        return self._build_result(students, yearly_schedules, monthly_schedules,
                                  assigned, yearly_assigned, paid_map, waiver_map,
                                  tx_paid_map=tx_paid_map)

    def compute_totals(self, students, student_ids):
        """Totals-only path: same batched fetches as compute(), but skips
        building the per-fee/per-month dicts — only (total_due, total_paid).

        Used for grand totals over the full filtered set so pagination
        footers don't pay for a second full per-month structure.
        """
        fee_schedules = FeeSchedule.objects.filter(
            academic_year__name=self.year_str,
        ).select_related('academic_year', 'school_class')
        if self.fee_category:
            fee_schedules = fee_schedules.filter(category=self.fee_category)

        yearly_schedules = [fs for fs in fee_schedules if fs.frequency in ('YEARLY', 'ONE_TIME')]
        monthly_schedules = [fs for fs in fee_schedules if fs.frequency == 'MONTHLY']

        assigned = self._fetch_monthly_assignments(student_ids, monthly_schedules)
        yearly_assigned = self._fetch_yearly_assignments(student_ids, yearly_schedules)
        paid_map = self._fetch_paid_map(student_ids)
        tx_paid_map = self._fetch_tx_paid_map(student_ids)
        waiver_map = self._fetch_waiver_map(student_ids)

        rows = self._build_result(students, yearly_schedules, monthly_schedules,
                                  assigned, yearly_assigned, paid_map, waiver_map,
                                  totals_only=True, tx_paid_map=tx_paid_map)
        grand_due = sum(r['totalDue'] for r in rows)
        grand_paid = sum(r['totalPaid'] for r in rows)
        return grand_due, grand_paid

    def _fetch_monthly_assignments(self, student_ids, monthly_schedules):
        if not monthly_schedules or not student_ids:
            return set()
        assn_filter = Q(
            student_id__in=student_ids,
            fee_schedule__in=monthly_schedules,
            active=True,
        )
        if self.month_from and self.month_to:
            assn_filter &= Q(starts_at__lte=self.month_to) & Q(ends_at__gte=self.month_from)
        assn = StudentFeeAssignment.objects.filter(assn_filter).values_list('student_id', 'fee_schedule_id')
        return {(s, fs) for s, fs in assn}

    def _fetch_yearly_assignments(self, student_ids, yearly_schedules):
        assigned_only_yearly = [fs for fs in yearly_schedules if fs.applicability == 'ASSIGNED_ONLY']
        if not assigned_only_yearly or not student_ids:
            return set()
        ya_filter = Q(
            student_id__in=student_ids,
            fee_schedule__in=assigned_only_yearly,
            active=True,
        )
        if self.month_from and self.month_to:
            ya_filter &= Q(starts_at__lte=self.month_to) & Q(ends_at__gte=self.month_from)
        return set(
            StudentFeeAssignment.objects.filter(ya_filter).values_list('student_id', 'fee_schedule_id')
        )

    def _fetch_paid_map(self, student_ids):
        paid_allocations = PaymentAllocation.objects.filter(
            student_id__in=student_ids,
            transaction__is_cancelled=False,
        ).values('student_id', 'fee_schedule_id', 'period').annotate(total=Sum('amount'))

        paid_map = {}
        for pa in paid_allocations:
            key = (pa['student_id'], pa['fee_schedule_id'], pa['period'] or '')
            paid_map[key] = float(pa['total'])
        return paid_map

    def _fetch_tx_paid_map(self, student_ids):
        """Transaction-level fallback for bulk/legacy payments written with
        category + fee_month but no allocation rows. Keyed
        (student, category, month) -> total. Callers take max() with the
        allocation map, never sum, so months paid through the income form
        (which records BOTH) are never double-counted."""
        from finance.models import Transaction
        from django.db.models import Sum
        tx_paid = {}
        for pt in Transaction.objects.filter(
            student_id__in=student_ids,
            transaction_type='INCOME',
            is_cancelled=False,
        ).values('student_id', 'category', 'fee_month').annotate(total=Sum('amount')):
            if pt['fee_month']:
                tx_paid[(pt['student_id'], pt['category'] or '', pt['fee_month'])] = float(pt['total'])
        return tx_paid

    def _fetch_waiver_map(self, student_ids):
        waivers = FeeWaiver.objects.filter(
            student_id__in=student_ids, active=True,
            approval_status='approved',
        ).values('student_id', 'fee_schedule_id', 'type', 'value', 'starts_at', 'ends_at')

        return {
            (w['student_id'], w['fee_schedule_id']): w
            for w in waivers
        }

    def _build_result(self, students, yearly_schedules, monthly_schedules,
                      assigned, yearly_assigned, paid_map, waiver_map,
                      totals_only=False, tx_paid_map=None):
        result = []
        for student in students:
            sid = student.id
            class_name_str = student.school_class.name if student.school_class else ''

            fees = [] if not totals_only else None
            total_due = 0
            total_paid = 0

            for fs in yearly_schedules:
                if fs.school_class and fs.school_class.name != class_name_str:
                    continue
                if fs.applicability == 'ASSIGNED_ONLY' and (sid, fs.id) not in yearly_assigned:
                    continue

                waiver_entry = waiver_map.get((sid, fs.id))
                amt = float(_waiver_expected_amount(waiver_entry, fs.amount))
                paid_amt = paid_map.get((sid, fs.id, ''), 0)
                if not paid_amt and tx_paid_map:
                    paid_amt = sum(
                        v for (s, c, _m), v in tx_paid_map.items()
                        if s == sid and c == fs.category
                    )

                if not totals_only:
                    fees.append({
                        'name': fs.category,
                        'amount': amt,
                        'paid': paid_amt >= amt,
                        'type': 'onetime' if fs.frequency == 'ONE_TIME' else 'global',
                    })
                total_due += amt
                total_paid += paid_amt

            for fs in monthly_schedules:
                if fs.school_class and fs.school_class.name != class_name_str:
                    continue
                if fs.applicability == 'ASSIGNED_ONLY' and (sid, fs.id) not in assigned:
                    continue

                months_list = [] if not totals_only else None
                months_to_check = []
                if self.month_from and self.month_to:
                    y, m = _parse_month(self.month_from, 'month_from')
                    ey, em = _parse_month(self.month_to, 'month_to')
                    while y < ey or (y == ey and m <= em):
                        months_to_check.append(f"{y}-{m:02d}")
                        m += 1
                        if m > 12:
                            m = 1
                            y += 1

                waiver_entry = waiver_map.get((sid, fs.id))
                amt = float(_waiver_expected_amount(waiver_entry, fs.amount))
                fee_paid = 0
                fee_due = 0
                for month_label in months_to_check:
                    # A waiver only discounts the months inside its active window.
                    w = waiver_entry if _waiver_covers_month(waiver_entry, month_label) else None
                    month_amt = float(_waiver_expected_amount(w, fs.amount))
                    paid_amt = max(
                        paid_map.get((sid, fs.id, month_label), 0),
                        (tx_paid_map or {}).get((sid, fs.category, month_label), 0),
                    )
                    if not totals_only:
                        months_list.append({
                            'month': month_label,
                            'amount': month_amt,
                            'paid': paid_amt >= month_amt,
                        })
                    fee_due += month_amt
                    fee_paid += paid_amt
                    total_due += month_amt
                    total_paid += paid_amt

                if not totals_only:
                    fees.append({
                        'name': fs.category,
                        'amount': amt,
                        'paid': fee_paid >= fee_due and len(months_to_check) > 0,
                        'type': 'recurring',
                        'months': months_list,
                    })

            result.append({
                'studentId': str(sid),
                'name': student.name,
                'class': class_name_str,
                'totalDue': total_due,
                'totalPaid': total_paid,
                'balance': total_due - total_paid,
                'fees': fees if not totals_only else [],
            })
        return result
