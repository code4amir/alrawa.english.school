"""Speed bundle: server-side finance totals + fee-schedule private caching."""
from decimal import Decimal

from django.test import TestCase
from django.core.cache import cache
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import RefreshToken

from core.models import SchoolClass, AcademicYear
from students.models import Student
from finance.models import Transaction, BankAccount, FeeSchedule

User = get_user_model()
FY = 2031  # distinct from other suites' years so locmem-dashboard caches can't collide


class FinanceTotalsTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        admin = User.objects.create_superuser(
            email='adm@speed.test', name='Admin', password='x')
        self.client.credentials(
            HTTP_AUTHORIZATION=f'Bearer {str(RefreshToken.for_user(admin).access_token)}')
        self.klass = SchoolClass.objects.create(name='Class T', order=0)
        self.year = AcademicYear.objects.create(
            name='2031', start_date='2031-01-01', end_date='2031-12-31', is_active=True)
        self.student = Student.objects.create(
            name='Stu', student_id='SPD900', school_class=self.klass, session='2031')
        self.bank_ar, _ = BankAccount.objects.get_or_create(
            name='AL_RAWA_BANK', display_name='AL RAWA Bank')
        self.bank_cash, _ = BankAccount.objects.get_or_create(
            name='CASH_IN_HAND', display_name='Cash in Hand')
        FeeSchedule.objects.create(
            academic_year=self.year, school_class=self.klass,
            category='Tuition', amount=1000, frequency='MONTHLY', applicability='AUTO')

    def _income(self, amount, **kw):
        data = dict(
            transaction_date=f'{FY}-06-01', transaction_type='INCOME',
            amount=amount, description='Fee', student=self.student,
            destination_account=self.bank_ar, fiscal_year=FY,
            category='Tuition', fee_month=f'{FY}-06')
        data.update(kw)
        return Transaction.objects.create(**data)

    def _manual_totals(self):
        """Row-by-row aggregation mirroring report_filter() semantics."""
        refunded_originals = {
            t.reversal_of_id for t in Transaction.objects.filter(
                fiscal_year=FY, is_cancelled=False,
                reversal_of_id__isnull=False, is_refund=True)
        }
        income, expense = Decimal('0'), Decimal('0')
        for t in Transaction.objects.filter(fiscal_year=FY):
            if t.is_cancelled:
                # Only refunded originals keep their income leg.
                if (t.reversal_of_id is None and t.id in refunded_originals
                        and t.transaction_type == 'INCOME'):
                    income += t.amount
                continue
            if t.reversal_of_id is not None:
                if t.is_refund:
                    if t.transaction_type == 'EXPENSE':
                        expense += t.amount
                    else:
                        income += t.amount
                continue
            if t.transaction_type == 'INCOME':
                income += t.amount
            elif t.transaction_type == 'EXPENSE':
                expense += t.amount
        return income, expense

    def test_totals_equal_manual_aggregation_with_void_and_refund(self):
        self._income(1000)  # live income
        Transaction.objects.create(
            transaction_date=f'{FY}-06-02', transaction_type='EXPENSE',
            amount=300, description='Chalk', source_account=self.bank_cash,
            fiscal_year=FY, category='Stationery')

        void_tx = self._income(5000, fee_month=f'{FY}-07')
        res = self.client.post(
            f'/api/finance/transactions/{void_tx.id}/cancel/',
            {'reason': 'duplicate entry'}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertFalse(Transaction.objects.get(reversal_of_id=void_tx.id).is_refund)

        refund_tx = self._income(2000, fee_month=f'{FY}-08')
        res = self.client.post(
            f'/api/finance/transactions/{refund_tx.id}/cancel/',
            {'reason': 'fee returned', 'cancel_type': 'refund'}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertTrue(Transaction.objects.get(reversal_of_id=refund_tx.id).is_refund)

        res = self.client.get(f'/api/finance/dashboard-summary/?fiscal_year={FY}')
        self.assertEqual(res.status_code, 200)
        self.assertIn('totals', res.data)
        self.assertEqual(set(res.data['totals'].keys()), {'income', 'expense'})

        # void nets to zero; refund keeps income leg + books expense leg
        self.assertEqual(float(res.data['totals']['income']), 3000.0)
        self.assertEqual(float(res.data['totals']['expense']), 2300.0)
        # totals agree with the legacy top-level fields and manual math
        self.assertEqual(float(res.data['totals']['income']), float(res.data['totalIncome']))
        self.assertEqual(float(res.data['totals']['expense']), float(res.data['totalExpense']))
        manual_income, manual_expense = self._manual_totals()
        self.assertEqual(float(res.data['totals']['income']), float(manual_income))
        self.assertEqual(float(res.data['totals']['expense']), float(manual_expense))


class FeeScheduleCacheHeaderTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        admin = User.objects.create_superuser(
            email='adm2@speed.test', name='Admin', password='x')
        self.client.credentials(
            HTTP_AUTHORIZATION=f'Bearer {str(RefreshToken.for_user(admin).access_token)}')
        year = AcademicYear.objects.create(
            name='2031', start_date='2031-01-01', end_date='2031-12-31', is_active=True)
        FeeSchedule.objects.create(
            academic_year=year, school_class=None,
            category='Tuition', amount=1000, frequency='MONTHLY', applicability='AUTO')

    def test_fee_schedules_list_is_private_cached(self):
        res = self.client.get('/api/finance/fee-schedules/')
        self.assertEqual(res.status_code, 200)
        cc = res.get('Cache-Control', '')
        self.assertIn('private', cc)
        self.assertIn('max-age=60', cc)
        self.assertNotIn('public', cc)
        self.assertNotIn('s-maxage', cc)
        self.assertTrue(res.get('ETag'), 'ETag missing')

    def test_transactions_list_is_never_shared(self):
        res = self.client.get('/api/finance/transactions/')
        self.assertEqual(res.status_code, 200)
        cc = res.get('Cache-Control', '')
        self.assertNotIn('public', cc)
        self.assertNotIn('s-maxage', cc)
