from django.test import TestCase
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import RefreshToken
from students.models import Student
from core.models import SchoolClass, AcademicYear, AuditLog
from finance.models import (
    Transaction, FeeSchedule, PaymentAllocation, StudentFeeAssignment,
    OpeningBalance, OpeningBalanceHistory, PeriodClose, FeeWaiver, BankAccount,
)
from finance.tests import _auth

User = get_user_model()


class FinanceAuditRound2Tests(TestCase):
    """Regression tests for the second finance audit pass.

    Covers: computed-FY period lock on transaction create, waiver
    approve action + read-only approver fields, YYYY-MM format
    validation on toggle/bulk, waiver percentage cap, opening-balance
    bulk negatives, revert history rows, reconciliation non-negatives,
    zero-amount transactions, copy_from_year/deactivate period locks.
    """

    def setUp(self):
        self.client = APIClient()
        _auth(self.client)
        self.klass = SchoolClass.objects.create(name='Class 5', order=1)
        self.year = AcademicYear.objects.create(
            name='2026', start_date='2026-01-01', end_date='2026-12-31', is_active=True)
        self.student = Student.objects.create(
            name='Stu', student_id='S000001', school_class=self.klass, session='2026')
        self.fs = FeeSchedule.objects.create(
            academic_year=self.year, school_class=self.klass,
            category='Tuition', amount=1000, frequency='MONTHLY', applicability='AUTO')
        self.bank_ar, _ = BankAccount.objects.get_or_create(
            name='AL_RAWA_BANK', display_name='AL RAWA Bank')

    def _income(self, **kw):
        data = {
            'transaction_date': '2026-06-01',
            'transaction_type': 'INCOME',
            'amount': 1000,
            'description': 'Test payment',
            'student': str(self.student.id),
            'class_name': 'Class 5',
            'destination_account': 'AL_RAWA_BANK',
            'fee_month': '2026-06',
            'feeScheduleId': str(self.fs.id),
        }
        data.update(kw)
        return self.client.post('/api/finance/transactions/', data, format='json')

    def test_closed_period_blocks_computed_fiscal_year(self):
        """No explicit fiscal_year in the body: the lock must still fire
        on the fiscal year derived from transaction_date."""
        from finance.views.base import _fiscal_year_from_date
        import datetime
        fy = _fiscal_year_from_date(datetime.date(2026, 6, 1))
        PeriodClose.objects.create(fiscal_year=fy, closed_by='test')
        res = self._income()
        self.assertEqual(res.status_code, 403)
        self.assertEqual(Transaction.objects.count(), 0)

    def test_waiver_approve_stamps_approver(self):
        w = FeeWaiver.objects.create(
            student=self.student, fee_schedule=self.fs,
            type='CUSTOM_AMOUNT', value=500, approval_status='pending', active=True)
        res = self.client.post(f'/api/finance/fee-waivers/{w.id}/approve/', {}, format='json')
        self.assertEqual(res.status_code, 200)
        w.refresh_from_db()
        self.assertEqual(w.approval_status, 'approved')
        self.assertIsNotNone(w.approved_by)
        self.assertIsNotNone(w.approved_at)
        self.assertTrue(AuditLog.objects.filter(
            action='approve', entity_type='fee_waiver').exists())

    def test_waiver_self_approve_blocked(self):
        """approved_by/approved_at are read-only: callers can't stamp themselves."""
        w = FeeWaiver.objects.create(
            student=self.student, fee_schedule=self.fs,
            type='CUSTOM_AMOUNT', value=500, approval_status='pending', active=True)
        res = self.client.patch(f'/api/finance/fee-waivers/{w.id}/', {
            'approval_status': 'approved', 'approved_by': 'hacker',
        }, format='json')
        self.assertEqual(res.status_code, 200)
        w.refresh_from_db()
        self.assertNotEqual(w.approved_by, 'hacker')

    def test_percentage_waiver_over_100_rejected(self):
        res = self.client.post('/api/finance/fee-waivers/', {
            'student': str(self.student.id),
            'fee_schedule': str(self.fs.id),
            'type': 'PERCENTAGE', 'value': 150,
        }, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(FeeWaiver.objects.count(), 0)

    def test_toggle_garbage_month_rejected(self):
        fs2 = FeeSchedule.objects.create(
            academic_year=self.year, category='Lab', amount=300,
            frequency='MONTHLY', applicability='ASSIGNED_ONLY')
        res = self.client.post('/api/finance/student-fee-assignments/toggle/', {
            'studentId': str(self.student.id),
            'feeScheduleId': str(fs2.id),
            'active': True, 'startsAt': 'junk', 'endsAt': '2026-12',
        }, format='json')
        self.assertEqual(res.status_code, 400)
        res = self.client.post('/api/finance/student-fee-assignments/toggle/', {
            'studentId': str(self.student.id),
            'feeScheduleId': str(fs2.id),
            'active': True, 'startsAt': '2026-13', 'endsAt': '2026-12',
        }, format='json')
        self.assertEqual(res.status_code, 400)
        res = self.client.post('/api/finance/student-fee-assignments/toggle/', {
            'studentId': str(self.student.id),
            'feeScheduleId': str(fs2.id),
            'active': True, 'startsAt': '2026-12', 'endsAt': '2026-01',
        }, format='json')
        self.assertEqual(res.status_code, 400)

    def test_bulk_garbage_month_rejected(self):
        fs2 = FeeSchedule.objects.create(
            academic_year=self.year, school_class=self.klass, category='Lab', amount=300,
            frequency='MONTHLY', applicability='ASSIGNED_ONLY')
        res = self.client.post('/api/finance/student-fee-assignments/bulk/', {
            'classId': str(self.klass.id),
            'feeScheduleId': str(fs2.id),
            'startsAt': 'not-a-month', 'endsAt': '2026-12',
        }, format='json')
        self.assertEqual(res.status_code, 400)

    def test_zero_amount_transaction_rejected(self):
        res = self._income(amount=0)
        self.assertEqual(res.status_code, 400)
        self.assertEqual(Transaction.objects.count(), 0)

    def test_opening_balance_bulk_negative_rejected(self):
        res = self.client.post('/api/finance/opening-balances/bulk/', {
            'fiscal_year': 2026,
            'balances': {'AL_RAWA_BANK': -100},
        }, format='json')
        self.assertEqual(res.status_code, 400)

    def test_revert_writes_history_row(self):
        ob = OpeningBalance.objects.create(
            fiscal_year=2026, account=self.bank_ar, amount=5000)
        self.client.patch(f'/api/finance/opening-balances/{ob.id}/', {'amount': 6000})
        hist = OpeningBalanceHistory.objects.filter(
            old_amount=5000, new_amount=6000).first()
        self.assertIsNotNone(hist)
        before = OpeningBalanceHistory.objects.count()
        res = self.client.post(f'/api/finance/opening-balances/revert/{hist.id}/')
        self.assertEqual(res.status_code, 200)
        ob.refresh_from_db()
        self.assertEqual(float(ob.amount), 5000)
        self.assertEqual(OpeningBalanceHistory.objects.count(), before + 1)
        self.assertTrue(OpeningBalanceHistory.objects.filter(
            old_amount=6000, new_amount=5000).exists())

    def test_reconciliation_negative_rejected(self):
        res = self.client.post('/api/finance/reconciliations/', {
            'account': str(self.bank_ar.id),
            'statement_date': '2026-09-01T00:00:00Z',
            'closing_balance': '-100.00',
        }, format='json')
        self.assertEqual(res.status_code, 400)

    def test_copy_from_year_blocked_when_target_closed(self):
        from finance.views.base import _fiscal_year_from_date
        target = AcademicYear.objects.create(
            name='2027', start_date='2027-01-01', end_date='2027-12-31', is_active=False)
        PeriodClose.objects.create(
            fiscal_year=_fiscal_year_from_date(target.start_date), closed_by='test')
        res = self.client.post('/api/finance/fee-schedules/copy_from_year/', {
            'sourceAcademicYearId': str(self.year.id),
            'targetAcademicYearId': str(target.id),
        }, format='json')
        self.assertEqual(res.status_code, 403)

    def test_waiver_deactivate_blocked_when_closed(self):
        from finance.views.base import _fiscal_year_from_date
        w = FeeWaiver.objects.create(
            student=self.student, fee_schedule=self.fs,
            value=200, reason='x', active=True)
        PeriodClose.objects.create(
            fiscal_year=_fiscal_year_from_date(self.year.start_date), closed_by='test')
        res = self.client.post(f'/api/finance/fee-waivers/{w.id}/deactivate/')
        self.assertEqual(res.status_code, 403)
        w.refresh_from_db()
        self.assertTrue(w.active)

    def test_toggle_blocked_when_schedule_year_closed(self):
        from finance.views.base import _fiscal_year_from_date
        fs2 = FeeSchedule.objects.create(
            academic_year=self.year, category='Lab', amount=300,
            frequency='MONTHLY', applicability='ASSIGNED_ONLY')
        PeriodClose.objects.create(
            fiscal_year=_fiscal_year_from_date(self.year.start_date), closed_by='test')
        res = self.client.post('/api/finance/student-fee-assignments/toggle/', {
            'studentId': str(self.student.id),
            'feeScheduleId': str(fs2.id),
            'active': True, 'startsAt': '2026-01', 'endsAt': '2026-12',
        }, format='json')
        self.assertEqual(res.status_code, 403)
