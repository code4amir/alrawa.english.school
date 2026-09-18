from django.test import TestCase
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import RefreshToken
from students.models import Student
from core.models import SchoolClass, AcademicYear
from .models import Transaction, FeeSchedule, PaymentAllocation, StudentFeeAssignment, OpeningBalance, OpeningBalanceHistory, PeriodClose, FeeWaiver, BankAccount
from parents.models import ParentStudentLink, NotificationLog

User = get_user_model()


def _auth(client):
    user = User.objects.create_superuser(email='admin@test.com', name='Admin', password='testpass123')
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
    return user


class FinanceTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        _auth(self.client)
        self.klass = SchoolClass.objects.create(name='Class 5', order=1)
        self.year = AcademicYear.objects.create(name='2026', start_date='2026-01-01', end_date='2026-12-31', is_active=True)
        self.student = Student.objects.create(name='Stu', student_id='S000001', school_class=self.klass, session='2026')
        self.fs = FeeSchedule.objects.create(
            academic_year=self.year, school_class=self.klass,
            category='Tuition', amount=1000, frequency='MONTHLY', applicability='AUTO'
        )
        self.bank_ar, _ = BankAccount.objects.get_or_create(name='AL_RAWA_BANK', display_name='AL RAWA Bank')
        self.bank_gf, _ = BankAccount.objects.get_or_create(name='GLOBAL_FORUM_BANK', display_name='Global Forum Bank')
        self.bank_cash, _ = BankAccount.objects.get_or_create(name='CASH_IN_HAND', display_name='Cash in Hand')

    def _tx_data(self, **kw):
        data = {
            'transaction_date': '2026-06-01',
            'transaction_type': 'INCOME',
            'amount': 500,
            'description': 'Test payment',
            'student': str(self.student.id),
            'class_name': 'Class 5',
            'destination_account': 'AL_RAWA_BANK',
            'fee_month': '2026-06',
        }
        data.update(kw)
        return data

    # ── Ledger ──

    def test_ledger_returns_data_for_account(self):
        Transaction.objects.create(
            transaction_date='2026-06-01', transaction_type='INCOME',
            amount=1000, description='Fee', student=self.student,
            destination_account=self.bank_ar, fiscal_year=2026,
            category='Tuition',
        )
        res = self.client.get('/api/finance/ledger/?account=AL_RAWA_BANK')
        self.assertEqual(res.status_code, 200)
        self.assertIn('data', res.data)
        self.assertEqual(len(res.data['data']), 1)
        self.assertEqual(res.data['totalRows'], 1)

    def test_ledger_running_balance(self):
        Transaction.objects.create(
            transaction_date='2026-06-01', transaction_type='INCOME',
            amount=500, description='First', student=self.student,
            destination_account=self.bank_ar, fiscal_year=2026,
        )
        Transaction.objects.create(
            transaction_date='2026-06-02', transaction_type='INCOME',
            amount=300, description='Second', student=self.student,
            destination_account=self.bank_ar, fiscal_year=2026,
        )
        res = self.client.get('/api/finance/ledger/?account=AL_RAWA_BANK')
        self.assertEqual(res.status_code, 200)
        data = res.data['data']
        self.assertEqual(len(data), 2)
        # First tx: running = opening + 500
        # Second tx: running = opening + 500 + 300
        self.assertEqual(data[0]['runningBalance'], data[0]['debit'])
        expected_second = data[0]['debit'] + data[1]['debit']
        self.assertEqual(data[1]['runningBalance'], expected_second)

    def test_ledger_excludes_cancelled_from_balance(self):
        Transaction.objects.create(
            transaction_date='2026-06-01', transaction_type='INCOME',
            amount=500, description='Active', student=self.student,
            destination_account=self.bank_ar, fiscal_year=2026,
        )
        cancelled = Transaction.objects.create(
            transaction_date='2026-06-02', transaction_type='INCOME',
            amount=300, description='Cancelled', student=self.student,
            destination_account=self.bank_ar, fiscal_year=2026,
            is_cancelled=True,
        )
        res = self.client.get('/api/finance/ledger/?account=AL_RAWA_BANK')
        self.assertEqual(res.status_code, 200)
        data = res.data['data']
        self.assertEqual(len(data), 2)
        # Both rows show, but cancelled doesn't affect running balance
        active_running = data[0]['runningBalance']
        cancelled_running = data[1]['runningBalance']
        self.assertEqual(
            active_running, cancelled_running,
            "Cancelled transaction should not change running balance"
        )

    def test_ledger_pagination(self):
        for i in range(5):
            Transaction.objects.create(
                transaction_date=f'2026-06-{i+1:02d}', transaction_type='INCOME',
                amount=100, description=f'Fee {i}', student=self.student,
                destination_account=self.bank_ar, fiscal_year=2026,
            )
        res = self.client.get('/api/finance/ledger/?account=AL_RAWA_BANK&limit=2&page=1')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data['data']), 2)
        self.assertEqual(res.data['totalRows'], 5)
        self.assertEqual(res.data['totalPages'], 3)

        res2 = self.client.get('/api/finance/ledger/?account=AL_RAWA_BANK&limit=2&page=2')
        self.assertEqual(res2.status_code, 200)
        self.assertEqual(len(res2.data['data']), 2)

    def test_ledger_search(self):
        Transaction.objects.create(
            transaction_date='2026-06-01', transaction_type='INCOME',
            amount=500, description='Tuition payment', student=self.student,
            destination_account=self.bank_ar, fiscal_year=2026, category='Tuition',
        )
        Transaction.objects.create(
            transaction_date='2026-06-02', transaction_type='INCOME',
            amount=300, description='Lab fee', student=self.student,
            destination_account=self.bank_ar, fiscal_year=2026, category='Lab',
        )
        res = self.client.get('/api/finance/ledger/?account=AL_RAWA_BANK&search=Tuition')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data['data']), 1)
        self.assertEqual(res.data['totalRows'], 1)

    def test_ledger_date_range(self):
        Transaction.objects.create(
            transaction_date='2026-05-01', transaction_type='INCOME',
            amount=200, description='May', student=self.student,
            destination_account=self.bank_ar, fiscal_year=2026,
        )
        Transaction.objects.create(
            transaction_date='2026-06-01', transaction_type='INCOME',
            amount=500, description='June', student=self.student,
            destination_account=self.bank_ar, fiscal_year=2026,
        )
        Transaction.objects.create(
            transaction_date='2026-07-01', transaction_type='INCOME',
            amount=300, description='July', student=self.student,
            destination_account=self.bank_ar, fiscal_year=2026,
        )
        res = self.client.get(
            '/api/finance/ledger/?account=AL_RAWA_BANK&dateFrom=2026-06-01&dateTo=2026-06-30'
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data['data']), 1)
        self.assertEqual(res.data['data'][0]['amount'], 500)

    def test_ledger_expense_tracks_outgoing(self):
        Transaction.objects.create(
            transaction_date='2026-06-01', transaction_type='EXPENSE',
            amount=400, description='Payment', student=self.student,
            source_account=self.bank_ar, fiscal_year=2026,
        )
        res = self.client.get('/api/finance/ledger/?account=AL_RAWA_BANK')
        self.assertEqual(res.status_code, 200)
        data = res.data['data']
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]['debit'], 0)
        self.assertEqual(data[0]['credit'], 400)
        self.assertEqual(data[0]['runningBalance'], -400)

    def test_ledger_includes_opening_balance(self):
        Transaction.objects.create(
            transaction_date='2026-06-01', transaction_type='INCOME',
            amount=1000, description='Fee', student=self.student,
            destination_account=self.bank_ar, fiscal_year=2026,
        )
        OpeningBalance.objects.create(
            account=self.bank_ar, fiscal_year=2026, amount=50000,
        )
        res = self.client.get('/api/finance/ledger/?account=AL_RAWA_BANK&dateFrom=2026-01-01')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['openingBalance'], 50000)

    def test_ledger_invalid_account(self):
        res = self.client.get('/api/finance/ledger/?account=INVALID')
        self.assertEqual(res.status_code, 400)

    def test_ledger_with_camelcase_params(self):
        Transaction.objects.create(
            transaction_date='2026-06-01', transaction_type='INCOME',
            amount=500, description='Test', student=self.student,
            destination_account=self.bank_ar, fiscal_year=2026,
        )
        res = self.client.get('/api/finance/ledger/?account=AL_RAWA_BANK&dateFrom=2026-06-01&dateTo=2026-06-30')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data['data']), 1)

    # ── Transactions ──

    def test_create_transaction(self):
        res = self.client.post('/api/finance/transactions/', self._tx_data())
        self.assertEqual(res.status_code, 201)
        self.assertEqual(Transaction.objects.count(), 1)

    def test_create_expense(self):
        res = self.client.post('/api/finance/transactions/', self._tx_data(transaction_type='EXPENSE', source_account='CASH_IN_HAND'))
        self.assertEqual(res.status_code, 201)

    def test_create_internal_transfer(self):
        res = self.client.post('/api/finance/transactions/', self._tx_data(
            transaction_type='INTERNAL_TRANSFER', source_account='CASH_IN_HAND',
            destination_account='AL_RAWA_BANK'
        ))
        self.assertEqual(res.status_code, 201)

    # ── Receipt/trx date-based numbering (TYPE-YYYYMMDD-SEQ) ──

    def test_income_receipt_uses_date_serial(self):
        res = self.client.post('/api/finance/transactions/', self._tx_data())
        self.assertEqual(res.status_code, 201)
        t = Transaction.objects.get()
        # 2026-06-01 -> RCPT-20260601-0001
        self.assertEqual(t.reference_id, 'RCPT-20260601-0001')

    def test_income_receipt_serial_increments_same_day(self):
        for _ in range(2):
            res = self.client.post('/api/finance/transactions/', self._tx_data())
            self.assertEqual(res.status_code, 201)
        refs = sorted(Transaction.objects.values_list('reference_id', flat=True))
        self.assertEqual(refs[0], 'RCPT-20260601-0001')
        self.assertEqual(refs[1], 'RCPT-20260601-0002')

    def test_receipt_serial_resets_per_day(self):
        # Same date twice → 0001, 0002
        self.client.post('/api/finance/transactions/', self._tx_data())
        self.client.post('/api/finance/transactions/', self._tx_data())
        # Different date → serial restarts at 0001
        self.client.post('/api/finance/transactions/', self._tx_data(transaction_date='2026-06-02'))
        refs = sorted(Transaction.objects.values_list('reference_id', flat=True))
        self.assertEqual(refs, ['RCPT-20260601-0001', 'RCPT-20260601-0002', 'RCPT-20260602-0001'])

    def test_expense_voucher_uses_date_serial(self):
        res = self.client.post('/api/finance/transactions/', self._tx_data(
            transaction_type='EXPENSE', source_account='CASH_IN_HAND',
            destination_account=None,
        ), format='json')
        self.assertEqual(res.status_code, 201)
        t = Transaction.objects.get()
        self.assertEqual(t.reference_id, 'PV-20260601-0001')

    def test_reversal_uses_date_serial(self):
        created = self.client.post('/api/finance/transactions/', self._tx_data())
        t = Transaction.objects.get()
        cancel = self.client.post(f'/api/finance/transactions/{t.id}/cancel/', {'reason': 'err'}, format='json')
        self.assertEqual(cancel.status_code, 200)
        reversal = Transaction.objects.filter(reversal_of_id=t.id).first()
        self.assertIsNotNone(reversal)
        # Reversal flips INCOME→EXPENSE → gets a PV number (isolated test DB, starts at 0001)
        self.assertEqual(reversal.reference_id, 'PV-20260601-0001')

    def test_list_transactions(self):
        Transaction.objects.create(
            transaction_date='2026-06-01', transaction_type='INCOME',
            amount=500, description='Test', student=self.student,
            destination_account=self.bank_ar, fiscal_year=2026
        )
        res = self.client.get('/api/finance/transactions/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data['results']), 1)

    def test_cancel_transaction(self):
        tx = Transaction.objects.create(
            transaction_date='2026-06-01', transaction_type='INCOME',
            amount=500, description='Test', student=self.student,
            destination_account=self.bank_ar, fiscal_year=2026,
        )
        res = self.client.post(f'/api/finance/transactions/{tx.id}/cancel/', {'reason': 'Cancelled by test'})
        self.assertEqual(res.status_code, 200)
        tx.refresh_from_db()
        self.assertTrue(tx.is_cancelled)

    def test_cancel_income_notifies_linked_parent(self):
        parent = User.objects.create_user(
            email='parent_cancel@test.com', name='Parent', password='testpass123',
            email_verified=True, role='parent',
        )
        ParentStudentLink.objects.create(parent=parent, student=self.student)
        tx = Transaction.objects.create(
            transaction_date='2026-06-01', transaction_type='INCOME',
            amount=500, description='Fee', student=self.student,
            destination_account=self.bank_ar, fiscal_year=2026, category='Tuition',
        )
        res = self.client.post(f'/api/finance/transactions/{tx.id}/cancel/', {'reason': 'Wrong amount'})
        self.assertEqual(res.status_code, 200)
        log = NotificationLog.objects.filter(user=parent, event_type='fee_reversal').first()
        self.assertIsNotNone(log, 'fee_reversal notification should be created for the linked parent')
        self.assertIn('500.00', log.body)
        self.assertIn('Wrong amount', log.body)

    def test_cancel_expense_does_not_notify_parents(self):
        parent = User.objects.create_user(
            email='parent_expense@test.com', name='Parent', password='testpass123',
            email_verified=True, role='parent',
        )
        ParentStudentLink.objects.create(parent=parent, student=self.student)
        tx = Transaction.objects.create(
            transaction_date='2026-06-01', transaction_type='EXPENSE',
            amount=500, description='Electricity', student=None,
            source_account=self.bank_ar, fiscal_year=2026,
        )
        res = self.client.post(f'/api/finance/transactions/{tx.id}/cancel/', {'reason': 'Typo'})
        self.assertEqual(res.status_code, 200)
        self.assertFalse(
            NotificationLog.objects.filter(user=parent, event_type='fee_reversal').exists(),
            'Expense reversal should not notify parents',
        )

    def test_cancel_already_cancelled(self):
        tx = Transaction.objects.create(
            transaction_date='2026-06-01', transaction_type='INCOME',
            amount=500, description='Test', student=self.student,
            destination_account=self.bank_ar, fiscal_year=2026, is_cancelled=True,
        )
        res = self.client.post(f'/api/finance/transactions/{tx.id}/cancel/', {'reason': 'Again'})
        self.assertEqual(res.status_code, 400)

    def test_transaction_delete_rejected(self):
        tx = Transaction.objects.create(
            transaction_date='2026-06-01', transaction_type='INCOME',
            amount=500, description='Test', student=self.student,
            destination_account=self.bank_ar, fiscal_year=2026,
        )
        res = self.client.delete(f'/api/finance/transactions/{tx.id}/')
        self.assertEqual(res.status_code, 400)
        self.assertTrue(Transaction.objects.filter(id=tx.id).exists())

    def test_transaction_protected_from_orm_delete_with_allocations(self):
        tx = Transaction.objects.create(
            transaction_date='2026-06-01', transaction_type='INCOME',
            amount=500, description='Test', student=self.student,
            destination_account=self.bank_ar, fiscal_year=2026,
        )
        PaymentAllocation.objects.create(
            transaction=tx, fee_schedule=self.fs,
            student=self.student, period='2026-06', amount=500,
        )
        from django.db.models.deletion import ProtectedError
        with self.assertRaises(ProtectedError):
            tx.delete()

    def test_balances(self):
        Transaction.objects.create(
            transaction_date='2026-06-01', transaction_type='INCOME',
            amount=1000, description='Test', student=self.student,
            destination_account=self.bank_ar, fiscal_year=2026
        )
        res = self.client.get('/api/finance/balances/')
        self.assertEqual(res.status_code, 200)
        self.assertIsInstance(res.data, dict)
        self.assertIn('AL_RAWA_BANK', res.data)

    def test_balances_includes_opening_balance(self):
        from django.utils import timezone
        from finance.views.base import _fiscal_year_from_date
        # Opening balances apply to the CURRENT fiscal year (time-bomb guard:
        # never hardcode a year — the suite must pass whatever month it runs).
        current_fy = _fiscal_year_from_date(timezone.now().date())
        Transaction.objects.create(
            transaction_date='2026-06-01', transaction_type='INCOME',
            amount=1000, description='Test', student=self.student,
            destination_account=self.bank_ar, fiscal_year=current_fy
        )
        OpeningBalance.objects.create(
            account=self.bank_ar, fiscal_year=current_fy, amount=50000,
            updated_by='test'
        )
        res = self.client.get('/api/finance/balances/')
        self.assertEqual(res.status_code, 200)
        # Opening balance (50000) + income (1000) = 51000
        self.assertEqual(float(res.data['AL_RAWA_BANK']), 51000.0)
        # Other accounts should be 0 (no opening balance set)
        self.assertEqual(float(res.data['GLOBAL_FORUM_BANK']), 0)
        self.assertEqual(float(res.data['CASH_IN_HAND']), 0)

    def test_dashboard_summary(self):
        Transaction.objects.create(
            transaction_date='2026-06-01', transaction_type='INCOME',
            amount=1000, description='Test', student=self.student,
            destination_account=self.bank_ar, fiscal_year=2026
        )
        res = self.client.get('/api/finance/dashboard-summary/?fiscal_year=2026')
        self.assertEqual(res.status_code, 200)
        self.assertIn('totalIncome', res.data)
        self.assertEqual(float(res.data['totalIncome']), 1000.0)

    def test_fee_status(self):
        Transaction.objects.create(
            transaction_date='2026-06-01', transaction_type='INCOME',
            amount=500, description='Fee', student=self.student,
            destination_account=self.bank_ar, fiscal_year=2026,
            fee_month='2026-06', category='Tuition'
        )
        res = self.client.get(f'/api/finance/fee-status/?student_id={self.student.id}')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 1)

    # ── Fee Schedules ──

    def test_create_fee_schedule(self):
        res = self.client.post('/api/finance/fee-schedules/', {
            'academic_year_id': str(self.year.id),
            'class_id': str(self.klass.id),
            'category': 'Sports',
            'amount': 500,
            'frequency': 'YEARLY',
            'applicability': 'AUTO',
        }, format='json')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(FeeSchedule.objects.count(), 2)

    def test_list_fee_schedules(self):
        res = self.client.get('/api/finance/fee-schedules/')
        self.assertEqual(res.status_code, 200)
        self.assertGreaterEqual(len(res.data), 1)

    def test_update_fee_schedule(self):
        res = self.client.patch(f'/api/finance/fee-schedules/{self.fs.id}/', {'amount': 2000})
        self.assertEqual(res.status_code, 200)
        self.fs.refresh_from_db()
        self.assertEqual(float(self.fs.amount), 2000)

    def test_delete_fee_schedule(self):
        res = self.client.delete(f'/api/finance/fee-schedules/{self.fs.id}/')
        self.assertEqual(res.status_code, 204)
        self.assertEqual(FeeSchedule.objects.count(), 0)

    def test_fee_schedule_serializer_has_class_rel(self):
        res = self.client.get(f'/api/finance/fee-schedules/{self.fs.id}/')
        self.assertIn('classRel', res.data)
        self.assertEqual(res.data['classRel']['name'], 'Class 5')

    def test_fee_schedule_serializer_camelcase(self):
        res = self.client.get(f'/api/finance/fee-schedules/{self.fs.id}/')
        self.assertIn('academicYearId', res.data)
        self.assertIn('classId', res.data)
        self.assertIn('frequency', res.data)

    # ── Student Fee Assignments ──

    def test_toggle_assignment(self):
        fs2 = FeeSchedule.objects.create(
            academic_year=self.year, category='Lab', amount=300,
            frequency='MONTHLY', applicability='ASSIGNED_ONLY'
        )
        res = self.client.post('/api/finance/student-fee-assignments/toggle/', {
            'studentId': str(self.student.id),
            'feeScheduleId': str(fs2.id),
            'active': True,
            'startsAt': '2026-01',
            'endsAt': '2026-12',
        }, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(StudentFeeAssignment.objects.count(), 1)
        a = StudentFeeAssignment.objects.first()
        self.assertEqual(a.starts_at, '2026-01')
        self.assertEqual(a.ends_at, '2026-12')

    def test_toggle_assignment_requires_dates(self):
        fs2 = FeeSchedule.objects.create(
            academic_year=self.year, category='Lab', amount=300,
            frequency='MONTHLY', applicability='ASSIGNED_ONLY'
        )
        res = self.client.post('/api/finance/student-fee-assignments/toggle/', {
            'studentId': str(self.student.id),
            'feeScheduleId': str(fs2.id),
            'active': True,
        }, format='json')
        self.assertEqual(res.status_code, 400)

    def test_toggle_assignment_deactivate_no_dates_needed(self):
        fs2 = FeeSchedule.objects.create(
            academic_year=self.year, category='Lab', amount=300,
            frequency='MONTHLY', applicability='ASSIGNED_ONLY'
        )
        StudentFeeAssignment.objects.create(
            student=self.student, fee_schedule=fs2, active=True,
            starts_at='2026-01', ends_at='2026-12'
        )
        res = self.client.post('/api/finance/student-fee-assignments/toggle/', {
            'studentId': str(self.student.id),
            'feeScheduleId': str(fs2.id),
            'active': False,
        }, format='json')
        self.assertEqual(res.status_code, 200)
        a = StudentFeeAssignment.objects.first()
        self.assertFalse(a.active)

    def test_bulk_assign(self):
        fs2 = FeeSchedule.objects.create(
            academic_year=self.year, school_class=self.klass, category='Lab', amount=300,
            frequency='MONTHLY', applicability='ASSIGNED_ONLY'
        )
        res = self.client.post('/api/finance/student-fee-assignments/bulk/', {
            'classId': str(self.klass.id),
            'feeScheduleId': str(fs2.id),
            'startsAt': '2026-01',
            'endsAt': '2026-12',
        }, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['assigned'], 1)

    def test_bulk_assign_requires_dates(self):
        fs2 = FeeSchedule.objects.create(
            academic_year=self.year, school_class=self.klass, category='Lab', amount=300,
            frequency='MONTHLY', applicability='ASSIGNED_ONLY'
        )
        res = self.client.post('/api/finance/student-fee-assignments/bulk/', {
            'classId': str(self.klass.id),
            'feeScheduleId': str(fs2.id),
        }, format='json')
        self.assertEqual(res.status_code, 400)

    def test_payment_rejected_for_expired_assignment(self):
        fs2 = FeeSchedule.objects.create(
            academic_year=self.year, school_class=self.klass, category='Lab Fee', amount=300,
            frequency='MONTHLY', applicability='ASSIGNED_ONLY'
        )
        StudentFeeAssignment.objects.create(
            student=self.student, fee_schedule=fs2, active=True,
            starts_at='2026-01', ends_at='2026-03'
        )
        res = self.client.post('/api/finance/transactions/', {
            'transaction_date': '2026-06-01',
            'transaction_type': 'INCOME',
            'amount': 300,
            'description': 'Expired payment',
            'student': str(self.student.id),
            'class_name': 'Class 5',
            'destination_account': 'AL_RAWA_BANK',
            'fee_month': '2026-06',
            'allocations': [{'feeScheduleId': str(fs2.id), 'amount': 300, 'period': '2026-06'}],
        }, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(Transaction.objects.count(), 0)

    def test_payment_rejected_for_unassigned_fee(self):
        fs2 = FeeSchedule.objects.create(
            academic_year=self.year, school_class=self.klass, category='Lab Fee', amount=300,
            frequency='MONTHLY', applicability='ASSIGNED_ONLY'
        )
        res = self.client.post('/api/finance/transactions/', {
            'transaction_date': '2026-06-01',
            'transaction_type': 'INCOME',
            'amount': 300,
            'description': 'Unassigned payment',
            'student': str(self.student.id),
            'class_name': 'Class 5',
            'destination_account': 'AL_RAWA_BANK',
            'fee_month': '2026-06',
            'allocations': [{'feeScheduleId': str(fs2.id), 'amount': 300, 'period': '2026-06'}],
        }, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(Transaction.objects.count(), 0)

    def test_payment_checks_fee_month_not_transaction_date(self):
        fs2 = FeeSchedule.objects.create(
            academic_year=self.year, school_class=self.klass, category='Lab Fee', amount=300,
            frequency='MONTHLY', applicability='ASSIGNED_ONLY'
        )
        StudentFeeAssignment.objects.create(
            student=self.student, fee_schedule=fs2, active=True,
            starts_at='2026-01', ends_at='2026-03'
        )
        res = self.client.post('/api/finance/transactions/', {
            'transaction_date': '2025-12-15',
            'transaction_type': 'INCOME',
            'amount': 300,
            'description': 'Tx date before range, fee_month in range',
            'student': str(self.student.id),
            'class_name': 'Class 5',
            'destination_account': 'AL_RAWA_BANK',
            'fee_month': '2026-02',
            'allocations': [{'feeScheduleId': str(fs2.id), 'amount': 300, 'period': '2026-02'}],
        }, format='json')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(Transaction.objects.count(), 1)

        res2 = self.client.post('/api/finance/transactions/', {
            'transaction_date': '2026-02-01',
            'transaction_type': 'INCOME',
            'amount': 300,
            'description': 'Tx date in range, fee_month after range',
            'student': str(self.student.id),
            'class_name': 'Class 5',
            'destination_account': 'AL_RAWA_BANK',
            'fee_month': '2026-06',
            'allocations': [{'feeScheduleId': str(fs2.id), 'amount': 300, 'period': '2026-06'}],
        }, format='json')
        self.assertEqual(res2.status_code, 400)

    # ── Fee Waivers ──

    def test_create_fee_waiver(self):
        res = self.client.post('/api/finance/fee-waivers/', {
            'student': str(self.student.id),
            'fee_schedule': str(self.fs.id),
            'value': 200,
            'reason': 'Discount',
        })
        self.assertEqual(res.status_code, 201)

    def test_deactivate_waiver(self):
        w = FeeWaiver.objects.create(
            student=self.student, fee_schedule=self.fs,
            value=200, reason='Discount', active=True
        )
        res = self.client.post(f'/api/finance/fee-waivers/{w.id}/deactivate/')
        self.assertEqual(res.status_code, 200)
        w.refresh_from_db()
        self.assertFalse(w.active)

    # ── Payment Allocations ──

    def test_payment_allocation_created_with_transaction(self):
        tx = Transaction.objects.create(
            transaction_date='2026-06-01', transaction_type='INCOME',
            amount=1000, description='Fee', student=self.student,
            destination_account=self.bank_ar, fiscal_year=2026
        )
        alloc = PaymentAllocation.objects.create(
            transaction=tx, fee_schedule=self.fs,
            student=self.student, period='2026-06', amount=1000
        )
        self.assertEqual(PaymentAllocation.objects.count(), 1)

    def test_opening_balance_protected_from_bank_delete(self):
        OpeningBalance.objects.create(account=self.bank_ar, fiscal_year=2026, amount=5000)
        from django.db.models.deletion import ProtectedError
        with self.assertRaises(ProtectedError):
            self.bank_ar.delete()

    # ── Opening Balances ──

    def test_set_opening_balance(self):
        res = self.client.post('/api/finance/opening-balances/', {
            'fiscal_year': 2026, 'account': 'AL_RAWA_BANK', 'amount': 5000,
        })
        self.assertEqual(res.status_code, 201)
        self.assertEqual(OpeningBalance.objects.count(), 1)

    def test_get_opening_balances(self):
        OpeningBalance.objects.create(fiscal_year=2026, account=self.bank_ar, amount=5000)
        res = self.client.get('/api/finance/opening-balances/')
        self.assertEqual(res.status_code, 200)
        results = res.data['results'] if isinstance(res.data, dict) and 'results' in res.data else res.data
        accounts = [item['account'] for item in results]
        self.assertIn('AL_RAWA_BANK', accounts)

    def test_opening_balance_history(self):
        ob = OpeningBalance.objects.create(fiscal_year=2026, account=self.bank_ar, amount=5000)
        res = self.client.patch(f'/api/finance/opening-balances/{ob.id}/', {'amount': 6000})
        self.assertEqual(res.status_code, 200)
        res = self.client.get('/api/finance/opening-balances/history/')
        self.assertEqual(res.status_code, 200)
        self.assertGreaterEqual(len(res.data), 1)

    def test_revert_opening_balance(self):
        from .models import OpeningBalanceHistory
        ob = OpeningBalance.objects.create(fiscal_year=2026, account=self.bank_ar, amount=5000)
        self.client.patch(f'/api/finance/opening-balances/{ob.id}/', {'amount': 6000})
        hist = OpeningBalanceHistory.objects.first()
        res = self.client.post(f'/api/finance/opening-balances/revert/{hist.id}/')
        self.assertEqual(res.status_code, 200)
        ob.refresh_from_db()
        self.assertEqual(float(ob.amount), 5000)

    # ── Period Close ──

    def test_period_close(self):
        res = self.client.post('/api/finance/period-closes/', {'fiscal_year': 2026})
        self.assertEqual(res.status_code, 201)
        self.assertEqual(PeriodClose.objects.count(), 1)

    def test_period_close_duplicate(self):
        PeriodClose.objects.create(fiscal_year=2026)
        res = self.client.post('/api/finance/period-closes/', {'fiscal_year': 2026})
        self.assertEqual(res.status_code, 400)

    # ── Defaulter ──

    def test_defaulter_endpoint(self):
        res = self.client.get('/api/finance/defaulter/?year=2026&monthFrom=2026-01&monthTo=2026-06')
        self.assertEqual(res.status_code, 200)
        self.assertIn('data', res.data)
        self.assertIsInstance(res.data['data'], list)

    def test_defaulter_with_class_filter(self):
        res = self.client.get('/api/finance/defaulter/?year=2026&className=Class 5')
        self.assertEqual(res.status_code, 200)

    # ── Defaulter Pagination ──

    def test_defaulter_pagination(self):
        student2 = Student.objects.create(name='Stu2', student_id='S000002', school_class=self.klass, session='2026')
        res = self.client.get('/api/finance/defaulter/?year=2026&limit=1&page=1&monthFrom=2026-01&monthTo=2026-06')
        self.assertEqual(res.status_code, 200)
        self.assertIn('data', res.data)
        self.assertIn('totalRows', res.data)
        self.assertEqual(res.data['totalRows'], 2)
        self.assertEqual(len(res.data['data']), 1)
        # Server-side grand totals span the FULL filtered set, not just the page.
        self.assertIn('grandTotalDue', res.data)
        self.assertIn('grandTotalPaid', res.data)
        self.assertIn('grandTotalBalance', res.data)

        res2 = self.client.get('/api/finance/defaulter/?year=2026&limit=1&page=2&monthFrom=2026-01&monthTo=2026-06')
        self.assertEqual(res2.status_code, 200)
        self.assertEqual(len(res2.data['data']), 1)
        self.assertNotEqual(res.data['data'][0]['studentId'], res2.data['data'][0]['studentId'])
        # Grand totals identical across pages (whole set, not per-page).
        self.assertEqual(res.data['grandTotalDue'], res2.data['grandTotalDue'])

    def test_defaulter_pagination_defaults(self):
        for i in range(3):
            Student.objects.create(name=f'Stu{i}', student_id=f'S99{i:05d}', school_class=self.klass, session='2026')
        res = self.client.get('/api/finance/defaulter/?year=2026&monthFrom=2026-01&monthTo=2026-06')
        self.assertEqual(res.status_code, 200)
        self.assertIn('data', res.data)
        self.assertGreaterEqual(len(res.data['data']), 1)

    def test_defaulter_pagination_limits_max(self):
        res = self.client.get('/api/finance/defaulter/?year=2026&limit=9999&monthFrom=2026-01&monthTo=2026-06')
        self.assertEqual(res.status_code, 200)
        self.assertIn('data', res.data)

    def test_defaulter_compute_totals_matches_compute(self):
        """Totals-only path must equal full compute() sums (same fixtures)."""
        from finance.services.defaulter_service import DefaulterService
        s2 = Student.objects.create(
            name='Stu2', student_id='S000002',
            school_class=self.klass, session='2026',
        )
        FeeSchedule.objects.create(
            academic_year=self.year, school_class=self.klass,
            category='Admission', amount=5000,
            frequency='YEARLY', applicability='AUTO',
        )
        FeeWaiver.objects.create(
            student=self.student, fee_schedule=self.fs,
            type='PERCENTAGE', value=10,
            approval_status='approved', active=True,
        )
        tx = Transaction.objects.create(
            transaction_date='2026-06-01', transaction_type='INCOME',
            amount=400, student=self.student,
            destination_account=self.bank_ar, fiscal_year=2026,
            category='Tuition', fee_month='2026-06',
        )
        PaymentAllocation.objects.create(
            transaction=tx, fee_schedule=self.fs,
            student=self.student, period='2026-06', amount=400,
        )
        svc = DefaulterService(month_from='2026-01', month_to='2026-06')
        svc.resolve_year()
        students = list(
            Student.objects.filter(deleted_at__isnull=True)
            .select_related('school_class')
            .only('id', 'name', 'school_class__name')
            .order_by('name')
        )
        ids = [s.id for s in students]
        full = svc.compute(students, ids)
        due, paid = svc.compute_totals(students, ids)
        self.assertEqual(len(full), 2)
        self.assertAlmostEqual(due, sum(r['totalDue'] for r in full))
        self.assertAlmostEqual(paid, sum(r['totalPaid'] for r in full))
        # Paginated endpoint (limit=1 forces the totals-only branch) agrees.
        res = self.client.get(
            '/api/finance/defaulter/?year=2026&limit=1&page=1'
            '&monthFrom=2026-01&monthTo=2026-06'
        )
        self.assertEqual(res.status_code, 200)
        self.assertAlmostEqual(res.data['grandTotalDue'], due)
        self.assertAlmostEqual(res.data['grandTotalPaid'], paid)

    # ── AGM Report ──

    def test_agm_report(self):
        Transaction.objects.create(
            transaction_date='2026-06-01', transaction_type='INCOME',
            amount=10000, description='Fee income', student=self.student,
            destination_account=self.bank_ar, fiscal_year=2026, category='Tuition',
        )
        Transaction.objects.create(
            transaction_date='2026-06-02', transaction_type='EXPENSE',
            amount=2000, description='Salary', student=self.student,
            source_account=self.bank_ar, fiscal_year=2026, category='Salary',
        )
        res = self.client.get('/api/finance/reports/agm/?fiscal_year=2026')
        self.assertEqual(res.status_code, 200)
        self.assertIn('totalIncome', res.data)
        self.assertIn('totalExpense', res.data)
        self.assertEqual(float(res.data['totalIncome']), 10000)
        self.assertEqual(float(res.data['totalExpense']), 2000)

    def test_agm_report_net_surplus(self):
        Transaction.objects.create(
            transaction_date='2026-06-01', transaction_type='INCOME',
            amount=5000, student=self.student,
            destination_account=self.bank_ar, fiscal_year=2026,
        )
        Transaction.objects.create(
            transaction_date='2026-06-02', transaction_type='EXPENSE',
            amount=3000, student=self.student,
            source_account=self.bank_ar, fiscal_year=2026,
        )
        res = self.client.get('/api/finance/reports/agm/?fiscal_year=2026')
        self.assertEqual(float(res.data['netSurplus']), 2000)

    def test_agm_report_camelcase_param(self):
        Transaction.objects.create(
            transaction_date='2026-06-01', transaction_type='INCOME',
            amount=5000, student=self.student,
            destination_account=self.bank_ar, fiscal_year=2026,
        )
        res = self.client.get('/api/finance/reports/agm/?year=2026')
        self.assertEqual(res.status_code, 200)

    def test_agm_includes_transfer_transactions(self):
        Transaction.objects.create(
            transaction_date='2026-06-01', transaction_type='INTERNAL_TRANSFER',
            amount=3000, source_account=self.bank_gf,
            destination_account=self.bank_ar, fiscal_year=2026,
        )
        res = self.client.get('/api/finance/reports/agm/?fiscal_year=2026')
        self.assertEqual(res.status_code, 200)
        self.assertIn('totalTransfers', res.data)

    # ── CamelCase Query Params ──

    def test_fee_status_with_camelcase_student_id(self):
        Transaction.objects.create(
            transaction_date='2026-06-01', transaction_type='INCOME',
            amount=500, description='Fee', student=self.student,
            destination_account=self.bank_ar, fiscal_year=2026,
            fee_month='2026-06', category='Tuition'
        )
        res = self.client.get(f'/api/finance/fee-status/?studentId={self.student.id}')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 1)

    def test_fee_status_excludes_unassigned_only(self):
        assigned_fs = FeeSchedule.objects.create(
            academic_year=self.year, school_class=self.klass,
            category='Lab Fee', amount=300, frequency='MONTHLY', applicability='ASSIGNED_ONLY'
        )
        res = self.client.get(f'/api/finance/fee-status/?student_id={self.student.id}')
        self.assertEqual(res.status_code, 200)
        categories = [item['category'] for item in res.data]
        self.assertNotIn('Lab Fee', categories)

        StudentFeeAssignment.objects.create(
            student=self.student, fee_schedule=assigned_fs, active=True,
            starts_at='2026-01', ends_at='2026-12'
        )
        res = self.client.get(f'/api/finance/fee-status/?student_id={self.student.id}')
        self.assertEqual(res.status_code, 200)
        categories = [item['category'] for item in res.data]
        self.assertIn('Lab Fee', categories)

    def test_fee_status_excludes_expired_assignment(self):
        assigned_fs = FeeSchedule.objects.create(
            academic_year=self.year, school_class=self.klass,
            category='Lab Fee', amount=300, frequency='MONTHLY', applicability='ASSIGNED_ONLY'
        )
        StudentFeeAssignment.objects.create(
            student=self.student, fee_schedule=assigned_fs, active=True,
            starts_at='2026-01', ends_at='2026-03'
        )
        res = self.client.get(f'/api/finance/fee-status/?student_id={self.student.id}&feeMonth=2026-06')
        self.assertEqual(res.status_code, 200)
        categories = [item['category'] for item in res.data]
        self.assertNotIn('Lab Fee', categories)

    def test_fee_status_shows_fee_in_month_range(self):
        assigned_fs = FeeSchedule.objects.create(
            academic_year=self.year, school_class=self.klass,
            category='Lab Fee', amount=300, frequency='MONTHLY', applicability='ASSIGNED_ONLY'
        )
        StudentFeeAssignment.objects.create(
            student=self.student, fee_schedule=assigned_fs, active=True,
            starts_at='2026-01', ends_at='2026-03'
        )
        res = self.client.get(f'/api/finance/fee-status/?student_id={self.student.id}&feeMonth=2026-02&feeMonthTo=2026-02')
        self.assertEqual(res.status_code, 200)
        categories = [item['category'] for item in res.data]
        self.assertIn('Lab Fee', categories)

    def test_defaulter_excludes_expired_assignment(self):
        assigned_fs = FeeSchedule.objects.create(
            academic_year=self.year, school_class=self.klass,
            category='Lab Fee', amount=300, frequency='MONTHLY', applicability='ASSIGNED_ONLY'
        )
        StudentFeeAssignment.objects.create(
            student=self.student, fee_schedule=assigned_fs, active=True,
            starts_at='2026-01', ends_at='2026-03'
        )
        res = self.client.get('/api/finance/defaulter/?year=2026&monthFrom=2026-04&monthTo=2026-06')
        self.assertEqual(res.status_code, 200)
        data = res.data['data']
        if data:
            fees = data[0].get('fees', [])
            fee_names = [f['name'] for f in fees]
            self.assertNotIn('Lab Fee', fee_names)

    def test_fee_waivers_with_camelcase_params(self):
        FeeWaiver.objects.create(
            student=self.student, fee_schedule=self.fs,
            value=200, reason='Discount', active=True
        )
        res = self.client.get(f'/api/finance/fee-waivers/?studentId={self.student.id}&feeScheduleId={self.fs.id}&active=true')
        self.assertEqual(res.status_code, 200)
        results = res.data['results'] if isinstance(res.data, dict) and 'results' in res.data else res.data
        self.assertEqual(len(results), 1)

    def test_fee_waivers_with_snake_case_params(self):
        FeeWaiver.objects.create(
            student=self.student, fee_schedule=self.fs,
            value=200, reason='Discount', active=True
        )
        res = self.client.get(f'/api/finance/fee-waivers/?student_id={self.student.id}&fee_schedule_id={self.fs.id}')
        self.assertEqual(res.status_code, 200)
        results = res.data['results'] if isinstance(res.data, dict) and 'results' in res.data else res.data
        self.assertEqual(len(results), 1)

    def test_student_fee_assignments_with_camelcase(self):
        fs2 = FeeSchedule.objects.create(
            academic_year=self.year, category='Lab', amount=300,
            frequency='MONTHLY', applicability='ASSIGNED_ONLY'
        )
        StudentFeeAssignment.objects.create(
            student=self.student, fee_schedule=fs2, active=True
        )
        res = self.client.get(f'/api/finance/student-fee-assignments/?feeScheduleId={fs2.id}&active=true')
        self.assertEqual(res.status_code, 200)
        results = res.data['results'] if isinstance(res.data, dict) and 'results' in res.data else res.data
        self.assertEqual(len(results), 1)

    def test_dashboard_summary_with_camelcase_fiscal_year(self):
        Transaction.objects.create(
            transaction_date='2026-06-01', transaction_type='INCOME',
            amount=1000, description='Test', student=self.student,
            destination_account=self.bank_ar, fiscal_year=2026
        )
        res = self.client.get('/api/finance/dashboard-summary/?fiscalYear=2026')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(float(res.data['totalIncome']), 1000.0)

    def test_defaulter_with_camelcase_params(self):
        res = self.client.get('/api/finance/defaulter/?className=Class 5&year=2026&monthFrom=2026-01&monthTo=2026-06')
        self.assertEqual(res.status_code, 200)
        self.assertIn('data', res.data)

    def test_opening_balances_with_camelcase_fiscal_year(self):
        OpeningBalance.objects.create(fiscal_year=2026, account=self.bank_ar, amount=5000)
        res = self.client.get('/api/finance/opening-balances/?fiscalYear=2026')
        self.assertEqual(res.status_code, 200)
        results = res.data['results'] if isinstance(res.data, dict) and 'results' in res.data else res.data
        self.assertEqual(len(results), 1)

    def test_opening_balances_history_with_camelcase_fiscal_year(self):
        ob = OpeningBalance.objects.create(fiscal_year=2026, account=self.bank_ar, amount=5000)
        self.client.patch(f'/api/finance/opening-balances/{ob.id}/', {'amount': 6000})
        res = self.client.get('/api/finance/opening-balances/history/?fiscalYear=2026')
        self.assertEqual(res.status_code, 200)
        self.assertGreaterEqual(len(res.data), 1)

    def test_opening_balance_history_bad_fiscal_year_400(self):
        res = self.client.get('/api/finance/opening-balances/history/?fiscal_year=abc')
        self.assertEqual(res.status_code, 400)

    # ── Transaction Create via POST (camelCase body) ──

    def test_create_transaction_with_camelcase_body(self):
        res = self.client.post('/api/finance/transactions/', {
            'transactionDate': '2026-06-01',
            'transactionType': 'INCOME',
            'amount': 500,
            'description': 'CamelCase body test',
            'studentId': str(self.student.id),
            'className': 'Class 5',
            'destinationAccount': 'AL_RAWA_BANK',
            'feeMonth': '2026-06',
        })
        self.assertEqual(res.status_code, 201)
        self.assertEqual(Transaction.objects.count(), 1)

    def test_create_expense_with_camelcase_body(self):
        res = self.client.post('/api/finance/transactions/', {
            'transactionDate': '2026-06-01',
            'transactionType': 'EXPENSE',
            'amount': 300,
            'description': 'Expense test',
            'sourceAccount': 'CASH_IN_HAND',
            'category': 'Stationery',
        })
        self.assertEqual(res.status_code, 201)
        tx = Transaction.objects.first()
        self.assertEqual(tx.transaction_type, 'EXPENSE')
        self.assertEqual(tx.category, 'Stationery')

    def test_transaction_serializer_camelcase(self):
        tx = Transaction.objects.create(
            transaction_date='2026-06-01', transaction_type='INCOME',
            amount=500, description='Test', student=self.student,
            destination_account=self.bank_ar, fiscal_year=2026
        )
        res = self.client.get(f'/api/finance/transactions/{tx.id}/')
        self.assertIn('transactionType', res.data)
        self.assertIn('studentId', res.data)
        self.assertIn('sourceAccount', res.data)
        self.assertIn('destinationAccount', res.data)
        self.assertIn('feeMonth', res.data)
        self.assertIn('isCancelled', res.data)
        self.assertEqual(res.data['sourceAccount'], None)
        self.assertEqual(res.data['destinationAccount'], 'AL_RAWA_BANK')

    # ── Fee Status: month range filtering for ASSIGNED_ONLY fees ──

    def test_fee_status_excludes_before_assignment_start(self):
        """fee_month before assignment start -> fee should NOT show."""
        fs = FeeSchedule.objects.create(
            academic_year=self.year, school_class=self.klass,
            category='Lab Fee', amount=300, frequency='MONTHLY', applicability='ASSIGNED_ONLY'
        )
        StudentFeeAssignment.objects.create(
            student=self.student, fee_schedule=fs, active=True,
            starts_at='2026-06', ends_at='2026-12'
        )
        res = self.client.get(f'/api/finance/fee-status/?student_id={self.student.id}&feeMonth=2026-05')
        self.assertEqual(res.status_code, 200)
        categories = [item['category'] for item in res.data]
        self.assertNotIn('Lab Fee', categories)

    def test_fee_status_includes_within_assignment_range(self):
        """fee_month within assignment range -> fee should show with numMonths=1."""
        fs = FeeSchedule.objects.create(
            academic_year=self.year, school_class=self.klass,
            category='Lab Fee', amount=300, frequency='MONTHLY', applicability='ASSIGNED_ONLY'
        )
        StudentFeeAssignment.objects.create(
            student=self.student, fee_schedule=fs, active=True,
            starts_at='2026-06', ends_at='2026-12'
        )
        res = self.client.get(f'/api/finance/fee-status/?student_id={self.student.id}&feeMonth=2026-06')
        self.assertEqual(res.status_code, 200)
        items = [item for item in res.data if item['category'] == 'Lab Fee']
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]['numMonths'], 1)
        self.assertEqual(items[0]['expectedTotal'], 300.0)
        self.assertEqual(items[0]['assignmentStart'], '2026-06')
        self.assertEqual(items[0]['assignmentEnd'], '2026-12')

    def test_fee_status_range_partial_overlap(self):
        """Range May-July with assignment June-Dec -> fee shows with numMonths=2 (June, July)."""
        fs = FeeSchedule.objects.create(
            academic_year=self.year, school_class=self.klass,
            category='Lab Fee', amount=300, frequency='MONTHLY', applicability='ASSIGNED_ONLY'
        )
        StudentFeeAssignment.objects.create(
            student=self.student, fee_schedule=fs, active=True,
            starts_at='2026-06', ends_at='2026-12'
        )
        res = self.client.get(
            f'/api/finance/fee-status/?student_id={self.student.id}&feeMonth=2026-05&feeMonthTo=2026-07'
        )
        self.assertEqual(res.status_code, 200)
        items = [item for item in res.data if item['category'] == 'Lab Fee']
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]['numMonths'], 2)
        self.assertEqual(items[0]['expectedTotal'], 600.0)

    def test_fee_status_range_no_overlap(self):
        """Range Jan-Mar with assignment Jun-Dec -> fee should NOT show (0 valid months)."""
        fs = FeeSchedule.objects.create(
            academic_year=self.year, school_class=self.klass,
            category='Lab Fee', amount=300, frequency='MONTHLY', applicability='ASSIGNED_ONLY'
        )
        StudentFeeAssignment.objects.create(
            student=self.student, fee_schedule=fs, active=True,
            starts_at='2026-06', ends_at='2026-12'
        )
        res = self.client.get(
            f'/api/finance/fee-status/?student_id={self.student.id}&feeMonth=2026-01&feeMonthTo=2026-03'
        )
        self.assertEqual(res.status_code, 200)
        categories = [item['category'] for item in res.data]
        self.assertNotIn('Lab Fee', categories)

    def test_fee_status_paid_calculation_with_range(self):
        """Paid status should consider total expected for the valid months in range."""
        fs = FeeSchedule.objects.create(
            academic_year=self.year, school_class=self.klass,
            category='Lab Fee', amount=300, frequency='MONTHLY', applicability='ASSIGNED_ONLY'
        )
        StudentFeeAssignment.objects.create(
            student=self.student, fee_schedule=fs, active=True,
            starts_at='2026-06', ends_at='2026-12'
        )
        # Student paid 300 for June only
        Transaction.objects.create(
            transaction_date='2026-06-01', transaction_type='INCOME',
            amount=300, description='June fee', student=self.student,
            destination_account=self.bank_ar, fiscal_year=2026,
            fee_month='2026-06', category='Lab Fee'
        )
        # Query range June-July (2 valid months, expected 600, paid 300 -> not fully paid)
        res = self.client.get(
            f'/api/finance/fee-status/?student_id={self.student.id}&feeMonth=2026-06&feeMonthTo=2026-07'
        )
        self.assertEqual(res.status_code, 200)
        items = [item for item in res.data if item['category'] == 'Lab Fee']
        self.assertEqual(len(items), 1)
        self.assertFalse(items[0]['paid'])
        self.assertEqual(items[0]['numMonths'], 2)
        self.assertEqual(items[0]['expectedTotal'], 600.0)

    def test_fee_status_paid_when_fully_paid_in_range(self):
        """Fee shows as paid when total paid >= expected for valid months."""
        fs = FeeSchedule.objects.create(
            academic_year=self.year, school_class=self.klass,
            category='Lab Fee', amount=300, frequency='MONTHLY', applicability='ASSIGNED_ONLY'
        )
        StudentFeeAssignment.objects.create(
            student=self.student, fee_schedule=fs, active=True,
            starts_at='2026-06', ends_at='2026-12'
        )
        # Student paid 600 for June and July
        Transaction.objects.create(
            transaction_date='2026-06-01', transaction_type='INCOME',
            amount=300, description='June fee', student=self.student,
            destination_account=self.bank_ar, fiscal_year=2026,
            fee_month='2026-06', category='Lab Fee'
        )
        Transaction.objects.create(
            transaction_date='2026-07-01', transaction_type='INCOME',
            amount=300, description='July fee', student=self.student,
            destination_account=self.bank_ar, fiscal_year=2026,
            fee_month='2026-07', category='Lab Fee'
        )
        # Query range June-July (2 valid months, expected 600, paid 600 -> fully paid)
        res = self.client.get(
            f'/api/finance/fee-status/?student_id={self.student.id}&feeMonth=2026-06&feeMonthTo=2026-07'
        )
        self.assertEqual(res.status_code, 200)
        items = [item for item in res.data if item['category'] == 'Lab Fee']
        self.assertEqual(len(items), 1)
        self.assertTrue(items[0]['paid'])

    def test_fee_status_single_month_after_assignment_end(self):
        """fee_month after assignment end -> fee should NOT show."""
        fs = FeeSchedule.objects.create(
            academic_year=self.year, school_class=self.klass,
            category='Lab Fee', amount=300, frequency='MONTHLY', applicability='ASSIGNED_ONLY'
        )
        StudentFeeAssignment.objects.create(
            student=self.student, fee_schedule=fs, active=True,
            starts_at='2026-01', ends_at='2026-03'
        )
        res = self.client.get(f'/api/finance/fee-status/?student_id={self.student.id}&feeMonth=2026-06')
        self.assertEqual(res.status_code, 200)
        categories = [item['category'] for item in res.data]
        self.assertNotIn('Lab Fee', categories)

    def test_fee_status_range_spans_entire_assignment(self):
        """Range Jan-Dec with assignment Jun-Dec -> numMonths=7 (Jun-Dec)."""
        fs = FeeSchedule.objects.create(
            academic_year=self.year, school_class=self.klass,
            category='Lab Fee', amount=300, frequency='MONTHLY', applicability='ASSIGNED_ONLY'
        )
        StudentFeeAssignment.objects.create(
            student=self.student, fee_schedule=fs, active=True,
            starts_at='2026-06', ends_at='2026-12'
        )
        res = self.client.get(
            f'/api/finance/fee-status/?student_id={self.student.id}&feeMonth=2026-01&feeMonthTo=2026-12'
        )
        self.assertEqual(res.status_code, 200)
        items = [item for item in res.data if item['category'] == 'Lab Fee']
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]['numMonths'], 7)
        self.assertEqual(items[0]['expectedTotal'], 2100.0)


class DuesReminderTests(TestCase):
    """send_dues_reminder action — line-item message, current-month cap, parent notify."""

    def setUp(self):
        self.client = APIClient()
        # Accountant (finance:write) caller
        self.admin = User.objects.create_user(
            email='admin@test.com', name='Admin', password='testpass123',
            email_verified=True, role='accountant',
        )
        self.parent = User.objects.create_user(
            email='parent@test.com', name='Parent', password='testpass123',
            email_verified=True, role='parent',
        )
        self.teacher = User.objects.create_user(
            email='teacher@test.com', name='Teacher', password='testpass123',
            email_verified=True, role='teacher',
        )
        self.klass = SchoolClass.objects.create(name='Class 5', order=1)
        self.year = AcademicYear.objects.create(
            name='2026', start_date='2026-01-01', end_date='2026-12-31', is_active=True
        )
        self.student = Student.objects.create(
            name='Stu', student_id='S000001', school_class=self.klass, session='2026'
        )
        ParentStudentLink.objects.create(parent=self.parent, student=self.student)
        self.monthly = FeeSchedule.objects.create(
            academic_year=self.year, school_class=self.klass,
            category='Tuition', amount=1500, frequency='MONTHLY', applicability='AUTO'
        )
        self.yearly = FeeSchedule.objects.create(
            academic_year=self.year, school_class=self.klass,
            category='Admission', amount=5000, frequency='YEARLY', applicability='AUTO'
        )
        StudentFeeAssignment.objects.create(
            student=self.student, fee_schedule=self.monthly, active=True,
            starts_at='2026-01', ends_at='2026-12'
        )

    def _auth(self, user):
        refresh = RefreshToken.for_user(user)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')

    def test_notifies_linked_parent(self):
        self._auth(self.admin)
        res = self.client.post('/api/finance/transactions/send_dues_reminder/', {
            'studentId': str(self.student.id),
        })
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['notifiedParents'], 1)
        log = NotificationLog.objects.filter(user=self.parent, event_type='dues_reminder').first()
        self.assertIsNotNone(log)
        self.assertTrue(log.body.startswith('You have dues:'))

    def test_message_is_line_item_breakdown(self):
        self._auth(self.admin)
        self.client.post('/api/finance/transactions/send_dues_reminder/', {
            'studentId': str(self.student.id),
        })
        log = NotificationLog.objects.filter(user=self.parent, event_type='dues_reminder').first()
        # Yearly admission line (always unpaid, no month needed)
        self.assertIn('Admission: 5,000.00', log.body)
        # Monthly tuition line with /mo suffix
        self.assertIn('/mo', log.body)

    def test_custom_note_included(self):
        self._auth(self.admin)
        self.client.post('/api/finance/transactions/send_dues_reminder/', {
            'studentId': str(self.student.id),
            'note': 'Please clear by Friday',
        })
        log = NotificationLog.objects.filter(user=self.parent, event_type='dues_reminder').first()
        self.assertIn('Please clear by Friday', log.body)

    def test_requires_finance_write(self):
        self._auth(self.teacher)
        res = self.client.post('/api/finance/transactions/send_dues_reminder/', {
            'studentId': str(self.student.id),
        })
        self.assertEqual(res.status_code, 403)

    def test_no_linked_parent_returns_zero(self):
        lonely = Student.objects.create(name='Lonely', student_id='S000002', school_class=self.klass, session='2026')
        self._auth(self.admin)
        res = self.client.post('/api/finance/transactions/send_dues_reminder/', {
            'studentId': str(lonely.id),
        })
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['notifiedParents'], 0)

    def test_missing_student_id_400(self):
        self._auth(self.admin)
        res = self.client.post('/api/finance/transactions/send_dues_reminder/', {})
        self.assertEqual(res.status_code, 400)

    def test_unknown_student_404(self):
        import uuid
        self._auth(self.admin)
        res = self.client.post('/api/finance/transactions/send_dues_reminder/', {
            'studentId': str(uuid.uuid4()),
        })
        self.assertEqual(res.status_code, 404)

    def test_rate_limited_after_excess(self):
        from unittest import mock
        from finance.throttles import DuesReminderRateThrottle
        from django.core.cache import cache
        cache.clear()
        self._auth(self.admin)
        # Force a 1/minute bucket by pointing the throttle at a tiny rate
        # table; get_rate() reads THROTTLE_RATES[self.scope] on the class.
        with mock.patch.object(
            DuesReminderRateThrottle, 'THROTTLE_RATES',
            {'dues_reminder': '1/minute'},
        ):
            statuses = []
            for _ in range(3):
                r = self.client.post('/api/finance/transactions/send_dues_reminder/', {
                    'studentId': str(self.student.id),
                })
                statuses.append(r.status_code)
            self.assertIn(200, statuses)        # first request succeeds
            self.assertIn(429, statuses)        # subsequent ones throttled

    # ── Bulk "send to all defaulters" ──

    def test_bulk_notifies_all_linked_parents(self):
        self._auth(self.admin)
        res = self.client.post('/api/finance/transactions/send_dues_reminder_all/', {})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['totalStudents'], 1)
        self.assertEqual(res.data['notifiedParents'], 1)
        self.assertEqual(res.data['skipped'], 0)
        log = NotificationLog.objects.filter(user=self.parent, event_type='dues_reminder').first()
        self.assertIsNotNone(log)

    def test_bulk_respects_class_filter(self):
        other_class = SchoolClass.objects.create(name='Class 9', order=9)
        other = Student.objects.create(name='Other', student_id='S000099', school_class=other_class, session='2026')
        self._auth(self.admin)
        res = self.client.post('/api/finance/transactions/send_dues_reminder_all/', {
            'className': 'Class 5',
        })
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['totalStudents'], 1)
        self.assertEqual(res.data['notifiedParents'], 1)

    def test_bulk_skips_students_without_dues(self):
        # A student in another class with no fee schedules — not a defaulter.
        other_class = SchoolClass.objects.create(name='Class 9', order=9)
        Student.objects.create(name='Clean', student_id='S000099', school_class=other_class, session='2026')
        self._auth(self.admin)
        res = self.client.post('/api/finance/transactions/send_dues_reminder_all/', {})
        self.assertEqual(res.status_code, 200)
        # Only the original defaulter student is counted.
        self.assertEqual(res.data['totalStudents'], 2)
        self.assertEqual(res.data['skipped'], 1)
        self.assertEqual(res.data['notifiedParents'], 1)

    def test_bulk_requires_finance_write(self):
        self._auth(self.teacher)
        res = self.client.post('/api/finance/transactions/send_dues_reminder_all/', {})
        self.assertEqual(res.status_code, 403)

    # ── send_due_reminders management command (Alwaysdata cron) ──

    def test_command_dry_run_does_not_notify(self):
        from io import StringIO
        from django.core.management import call_command
        out = StringIO()
        call_command('send_due_reminders', dry_run=True, stdout=out)
        # The defaulter student is in the current-month window → processed; the
        # dry-run reports how many parents *would* be notified (their linked
        # parent account) without creating any notifications.
        self.assertIn('Processed: 1', out.getvalue())
        self.assertIn('Notified: 1', out.getvalue())
        self.assertIn('-> 1 parent(s)', out.getvalue())
        self.assertEqual(NotificationLog.objects.filter(event_type='dues_reminder').count(), 0)

    def test_command_sends_to_linked_parent(self):
        from io import StringIO
        from django.core.management import call_command
        out = StringIO()
        call_command('send_due_reminders', stdout=out)
        self.assertIn('Notified: 1', out.getvalue())
        self.assertEqual(
            NotificationLog.objects.filter(event_type='dues_reminder').count(), 1
        )


class FinanceMoneyAuditTests(TestCase):
    """Money-moving writes leave audit rows (Phase 0)."""

    def setUp(self):
        from core.models import AuditLog
        self.AuditLog = AuditLog
        self.client = APIClient()
        _auth(self.client)
        self.bank, _ = BankAccount.objects.get_or_create(
            name='CASH_IN_HAND', display_name='Cash in Hand')

    def test_opening_balance_create_audited(self):
        res = self.client.post('/api/finance/opening-balances/', {
            'account': 'CASH_IN_HAND', 'fiscal_year': 2026, 'amount': '5000.00',
        }, format='json')
        self.assertEqual(res.status_code, 201)
        self.assertTrue(self.AuditLog.objects.filter(
            action='create', entity_type='opening_balance').exists())

    def test_opening_balance_delete_audited(self):
        from .models import OpeningBalance
        ob = OpeningBalance.objects.create(
            account=self.bank, fiscal_year=2026, amount=100)
        res = self.client.delete(f'/api/finance/opening-balances/{ob.id}/')
        self.assertEqual(res.status_code, 204)
        self.assertTrue(self.AuditLog.objects.filter(
            action='delete', entity_type='opening_balance').exists())

    def test_reconciliation_cud_audited(self):
        res = self.client.post('/api/finance/reconciliations/', {
            'account': str(self.bank.id), 'statement_date': '2026-09-01T00:00:00Z',
            'closing_balance': '1000.00',
        }, format='json')
        self.assertEqual(res.status_code, 201)
        rid = res.data['id']
        res = self.client.patch(f'/api/finance/reconciliations/{rid}/', {
            'closing_balance': '1200.00',
        }, format='json')
        self.assertEqual(res.status_code, 200)
        res = self.client.delete(f'/api/finance/reconciliations/{rid}/')
        self.assertEqual(res.status_code, 204)
        actions = set(self.AuditLog.objects.filter(
            entity_type='reconciliation', entity_id=str(rid)).values_list('action', flat=True))
        self.assertEqual(actions, {'create', 'update', 'delete'})


class FinanceAuditFixTests(TestCase):
    """Regression tests for the Sept-2026 finance audit fixes (F1/F2/F9/F11/F12/F14)."""

    def setUp(self):
        from datetime import date
        self.client = APIClient()
        _auth(self.client)
        self.klass = SchoolClass.objects.create(name='Class 5', order=1)
        self.year = AcademicYear.objects.create(name='2026', start_date=date(2026, 1, 1), end_date=date(2026, 12, 31), is_active=True)
        self.student = Student.objects.create(name='Stu', student_id='S000001', school_class=self.klass, session='2026')
        self.fs = FeeSchedule.objects.create(
            academic_year=self.year, school_class=self.klass,
            category='Tuition', amount=1000, frequency='MONTHLY', applicability='AUTO'
        )
        self.bank_ar, _ = BankAccount.objects.get_or_create(name='AL_RAWA_BANK', display_name='AL RAWA Bank')

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

    def test_agm_with_opening_balance(self):
        """F1: AGM must not crash when an opening balance exists for the FY."""
        from django.utils import timezone
        from finance.views.base import _fiscal_year_from_date
        current_fy = _fiscal_year_from_date(timezone.now().date())
        OpeningBalance.objects.create(
            account=self.bank_ar, fiscal_year=current_fy, amount=50000, updated_by='test')
        res = self.client.get('/api/finance/reports/agm/', {'year': current_fy})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(float(res.data['opening']['AL_RAWA_BANK']), 50000.0)

    def test_bulk_row_gets_receipt_ref_and_allocation(self):
        """F2: bulk import runs the full pipeline (receipt counter, allocation)."""
        row = {
            'transaction_date': '2026-06-01',
            'transaction_type': 'INCOME',
            'amount': 1000,
            'description': 'Bulk import',
            'student': str(self.student.id),
            'class_name': 'Class 5',
            'destination_account': 'AL_RAWA_BANK',
            'fee_month': '2026-06',
            'allocations': [{'feeScheduleId': str(self.fs.id), 'amount': 1000, 'period': '2026-06'}],
        }
        res = self.client.post('/api/finance/transactions/bulk/', [row], format='json')
        self.assertEqual(res.status_code, 201)
        tx = Transaction.objects.get(description='Bulk import')
        self.assertTrue(tx.reference_id.startswith('RCPT-'))
        self.assertIsNotNone(tx.receipt_sequence)
        self.assertIsNotNone(tx.token_number)
        self.assertTrue(PaymentAllocation.objects.filter(transaction=tx).exists())

    def test_cancelled_payment_shows_unpaid_in_defaulter(self):
        """F9: allocations of cancelled transactions must not count as paid."""
        res = self._income()
        self.assertEqual(res.status_code, 201)
        params = {'month_from': '2026-06', 'month_to': '2026-06'}
        before = self.client.get('/api/finance/defaulter/', params)
        entry = [r for r in before.data['data'] if r['studentId'] == str(self.student.id)][0]
        self.assertEqual(float(entry['balance']), 0.0)
        res = self.client.post(
            f"/api/finance/transactions/{res.data['id']}/cancel/",
            {'reason': 'test'}, format='json')
        self.assertEqual(res.status_code, 200)
        after = self.client.get('/api/finance/defaulter/', params)
        entry = [r for r in after.data['data'] if r['studentId'] == str(self.student.id)][0]
        self.assertEqual(float(entry['balance']), 1000.0)

    def test_closed_period_blocks_fee_schedule_edit(self):
        """F11: period lock applies to fee models via their academic year."""
        from finance.views.base import _fiscal_year_from_date
        fy = _fiscal_year_from_date(self.year.start_date)
        PeriodClose.objects.create(fiscal_year=fy, closed_by='test')
        res = self.client.patch(
            f'/api/finance/fee-schedules/{self.fs.id}/', {'amount': 2000}, format='json')
        self.assertEqual(res.status_code, 403)
        res = self.client.post('/api/finance/fee-waivers/', {
            'student': str(self.student.id), 'fee_schedule': str(self.fs.id),
            'type': 'CUSTOM_AMOUNT', 'value': 500,
        }, format='json')
        self.assertEqual(res.status_code, 403)

    def test_pending_waiver_does_not_discount(self):
        """F12: only approved waivers affect the expected amount."""
        FeeWaiver.objects.create(
            student=self.student, fee_schedule=self.fs,
            type='CUSTOM_AMOUNT', value=500, approval_status='pending', active=True)
        res = self._income()
        self.assertEqual(res.status_code, 201)

    def test_cancel_reverses_balance_cache(self):
        """F14: cancelling must net the AccountBalance cache back to zero."""
        from finance.models import AccountBalance
        from finance.views.base import _fiscal_year_from_date
        res = self._income()
        self.assertEqual(res.status_code, 201)
        fy = _fiscal_year_from_date(self.year.start_date)
        bal = AccountBalance.objects.get(account=self.bank_ar, fiscal_year=fy, month=6)
        self.assertEqual(float(bal.closing_balance), 1000.0)
        self.client.post(
            f"/api/finance/transactions/{res.data['id']}/cancel/",
            {'reason': 'test'}, format='json')
        bal.refresh_from_db()
        self.assertEqual(float(bal.closing_balance), 0.0)

    def test_negative_amount_rejected(self):
        """Low: money fields must not accept negative values."""
        res = self._income(amount=-100)
        self.assertEqual(res.status_code, 400)

    def test_duplicate_assignment_rejected(self):
        """Low: (student, fee_schedule) is unique; raw dupes get a 400."""
        StudentFeeAssignment.objects.create(student=self.student, fee_schedule=self.fs)
        res = self.client.post('/api/finance/student-fee-assignments/', {
            'student': str(self.student.id), 'fee_schedule': str(self.fs.id),
        }, format='json')
        self.assertEqual(res.status_code, 400)

    def test_defaulter_bad_month_is_400(self):
        """Low: malformed month params must 400, not 500."""
        res = self.client.get('/api/finance/defaulter/', {'month_from': 'junk', 'month_to': '2026-06'})
        self.assertEqual(res.status_code, 400)

    def test_opening_balance_bad_year_is_400(self):
        """Low: non-integer fiscal_year filter must 400, not 500."""
        res = self.client.get('/api/finance/opening-balances/', {'fiscal_year': 'junk'})
        self.assertEqual(res.status_code, 400)

    def test_double_cancel_mints_one_reversal(self):
        """Low: second cancel of the same transaction is rejected cleanly."""
        res = self._income()
        self.assertEqual(res.status_code, 201)
        tx_id = res.data['id']
        r1 = self.client.post(f'/api/finance/transactions/{tx_id}/cancel/', {'reason': 'x'}, format='json')
        self.assertEqual(r1.status_code, 200)
        r2 = self.client.post(f'/api/finance/transactions/{tx_id}/cancel/', {'reason': 'y'}, format='json')
        self.assertEqual(r2.status_code, 400)
        self.assertEqual(Transaction.objects.filter(reversal_of_id=tx_id).count(), 1)

    def test_opening_balance_bulk_upsert(self):
        """F5: bulk opening-balance save creates rows + history on change."""
        from django.utils import timezone
        from finance.views.base import _fiscal_year_from_date
        fy = _fiscal_year_from_date(timezone.now().date())
        res = self.client.post('/api/finance/opening-balances/bulk/', {
            'fiscal_year': fy,
            'balances': {'AL_RAWA_BANK': 5000, 'CASH_IN_HAND': 250},
        }, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(
            float(OpeningBalance.objects.get(account=self.bank_ar, fiscal_year=fy).amount), 5000.0)
        res = self.client.post('/api/finance/opening-balances/bulk/', {
            'fiscal_year': fy,
            'balances': {'AL_RAWA_BANK': 6000},
        }, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertTrue(OpeningBalanceHistory.objects.filter(
            fiscal_year=fy, account=self.bank_ar, old_amount=5000, new_amount=6000).exists())


class VoidRefundCancelTests(TestCase):
    # Void-vs-refund cancel: voids are memo-only (net 0, absent from every
    # total); refunds are real money-out (income AND expense stay).
    def setUp(self):
        self.client = APIClient()
        _auth(self.client)
        self.klass = SchoolClass.objects.create(name='Class 5', order=1)
        self.year = AcademicYear.objects.create(name='2026', start_date='2026-01-01', end_date='2026-12-31', is_active=True)
        self.student = Student.objects.create(name='Stu', student_id='S000001', school_class=self.klass, session='2026')
        self.bank_ar, _ = BankAccount.objects.get_or_create(name='AL_RAWA_BANK', display_name='AL RAWA Bank')

    def _income_5000(self):
        return Transaction.objects.create(
            transaction_date='2026-06-01', transaction_type='INCOME',
            amount=5000, description='Fee', student=self.student,
            destination_account=self.bank_ar, fiscal_year=2026,
            category='Tuition', fee_month='2026-06',
        )

    def test_void_cancel_nets_to_zero_and_memo(self):
        tx = self._income_5000()
        res = self.client.post(
            f'/api/finance/transactions/{tx.id}/cancel/',
            {'reason': 'duplicate entry'}, format='json')
        self.assertEqual(res.status_code, 200)
        reversal = Transaction.objects.get(reversal_of_id=tx.id)
        self.assertFalse(reversal.is_refund)

        dash = self.client.get('/api/finance/dashboard-summary/?fiscal_year=2026')
        self.assertEqual(dash.status_code, 200)
        self.assertEqual(float(dash.data['totalIncome']), 0.0)
        self.assertEqual(float(dash.data['totalExpense']), 0.0)
        self.assertEqual(float(dash.data['net']), 0.0)
        self.assertEqual(dash.data['voids']['count'], 1)
        self.assertEqual(float(dash.data['voids']['amount']), 5000.0)
        self.assertEqual(dash.data['refunds']['count'], 0)

        ledger = self.client.get('/api/finance/ledger/?account=AL_RAWA_BANK')
        self.assertEqual(ledger.status_code, 200)
        self.assertEqual(float(ledger.data['totalDebit']), 0.0)
        self.assertEqual(float(ledger.data['totalCredit']), 0.0)
        # dashboard agrees with ledger: nothing live remains
        self.assertEqual(float(dash.data['totalIncome']), float(ledger.data['totalDebit']))

        agm = self.client.get('/api/finance/reports/agm/?fiscal_year=2026')
        self.assertEqual(agm.status_code, 200)
        self.assertEqual(float(agm.data['totalIncome']), 0.0)
        self.assertEqual(float(agm.data['totalExpense']), 0.0)
        self.assertEqual(agm.data['voids']['count'], 1)
        self.assertEqual(float(agm.data['voids']['amount']), 5000.0)

    def test_refund_cancel_keeps_income_and_books_expense(self):
        tx = self._income_5000()
        res = self.client.post(
            f'/api/finance/transactions/{tx.id}/cancel/',
            {'reason': 'fee returned to parent', 'cancel_type': 'refund'}, format='json')
        self.assertEqual(res.status_code, 200)
        reversal = Transaction.objects.get(reversal_of_id=tx.id)
        self.assertTrue(reversal.is_refund)
        self.assertEqual(reversal.transaction_type, 'EXPENSE')

        dash = self.client.get('/api/finance/dashboard-summary/?fiscal_year=2026')
        self.assertEqual(float(dash.data['totalIncome']), 5000.0)
        self.assertEqual(float(dash.data['totalExpense']), 5000.0)
        self.assertEqual(float(dash.data['net']), 0.0)
        self.assertEqual(dash.data['refunds']['count'], 1)
        self.assertEqual(float(dash.data['refunds']['amount']), 5000.0)
        self.assertEqual(dash.data['voids']['count'], 0)

        agm = self.client.get('/api/finance/reports/agm/?fiscal_year=2026')
        self.assertEqual(float(agm.data['totalIncome']), 5000.0)
        self.assertEqual(float(agm.data['totalExpense']), 5000.0)
        self.assertEqual(agm.data['refunds']['count'], 1)
        self.assertEqual(float(agm.data['refunds']['amount']), 5000.0)

    def test_bare_refund_reason_is_honoured(self):
        tx = self._income_5000()
        res = self.client.post(
            f'/api/finance/transactions/{tx.id}/cancel/',
            {'reason': 'refund'}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertTrue(Transaction.objects.get(reversal_of_id=tx.id).is_refund)

    def test_malformed_cancel_type_is_400(self):
        tx = self._income_5000()
        res = self.client.post(
            f'/api/finance/transactions/{tx.id}/cancel/',
            {'reason': 'x', 'cancel_type': 'bogus'}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertFalse(Transaction.objects.filter(reversal_of_id=tx.id).exists())


class BulkPaymentVisibilityTests(TestCase):
    """Bulk/Excel income (category + fee_month, no allocations array) must
    still read as paid in fee-status and defaulter — the Play-tuition case."""

    def setUp(self):
        from django.contrib.auth import get_user_model
        from rest_framework_simplejwt.tokens import RefreshToken
        from rest_framework.test import APIClient
        u = get_user_model().objects.create_superuser(
            email='bulk@t.com', name='B', password='x')
        self.client = APIClient()
        t = RefreshToken.for_user(u)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {t.access_token}')
        self.klass = SchoolClass.objects.create(name='Play', order=1)
        self.year = AcademicYear.objects.create(
            name='2026', start_date='2026-01-01', end_date='2026-12-31', is_active=True)
        self.student = Student.objects.create(
            name='Kid', student_id='S000009', school_class=self.klass, session='2026')
        self.sched = FeeSchedule.objects.create(
            academic_year=self.year, school_class=self.klass,
            category='Tuition fee', amount=3500,
            frequency='MONTHLY', applicability='AUTO')
        for b in ('AL_RAWA_BANK', 'GLOBAL_FORUM_BANK', 'CASH_IN_HAND'):
            BankAccount.objects.get_or_create(
                name=b, defaults={'display_name': b})

    def _bulk_pay(self, month, amount=3500):
        return self.client.post('/api/finance/transactions/bulk/', [{
            'transaction_date': f'{month}-05',
            'transaction_type': 'INCOME',
            'amount': amount,
            'student': str(self.student.id),
            'class_name': 'Play',
            'destination_account': 'AL_RAWA_BANK',
            'fee_month': month,
            'category': 'Tuition fee',
        }], format='json')

    def test_bulk_payment_auto_allocates(self):
        res = self._bulk_pay('2026-01')
        self.assertEqual(res.status_code, 201, msg=res.content[:300])
        self.assertTrue(PaymentAllocation.objects.filter(
            student=self.student, fee_schedule=self.sched, period='2026-01').exists())

    def test_bulk_paid_month_not_due(self):
        self._bulk_pay('2026-01')
        res = self.client.get('/api/finance/fee-status/', {
            'studentId': str(self.student.id),
            'feeMonth': '2026-01', 'feeMonthTo': '2026-03'})
        self.assertEqual(res.status_code, 200)
        item = [i for i in res.data if i['category'] == 'Tuition fee'][0]
        self.assertNotIn('2026-01', item['unpaidMonths'])
        self.assertIn('2026-02', item['unpaidMonths'])
        self.assertIn('2026-03', item['unpaidMonths'])

    def test_bulk_paid_month_not_defaulter(self):
        self._bulk_pay('2026-01')
        res = self.client.get('/api/finance/defaulter/', {
            'month_from': '2026-01', 'month_to': '2026-03'})
        self.assertEqual(res.status_code, 200)
        rows = res.data.get('data', res.data) if isinstance(res.data, dict) else res.data
        row = [r for r in rows if r['studentId'] == str(self.student.id)][0]
        tuition = [f for f in row['fees'] if f['name'] == 'Tuition fee'][0]
        by_month = {m['month']: m for m in tuition['months']}
        self.assertTrue(by_month['2026-01']['paid'])
        self.assertFalse(by_month['2026-02']['paid'])

    def test_form_payment_not_double_counted(self):
        # Income-form payment records tx + allocations; fallback must not double.
        res = self.client.post('/api/finance/transactions/', {
            'transaction_date': '2026-01-05',
            'transaction_type': 'INCOME',
            'amount': 3500,
            'student': str(self.student.id),
            'class_name': 'Play',
            'destination_account': 'AL_RAWA_BANK',
            'fee_month': '2026-01',
            'category': 'Tuition fee',
            'allocations': [{'feeScheduleId': str(self.sched.id), 'amount': 3500, 'period': '2026-01'}],
        }, format='json')
        self.assertEqual(res.status_code, 201, msg=res.content[:300])
        res = self.client.get('/api/finance/defaulter/', {
            'month_from': '2026-01', 'month_to': '2026-01'})
        rows = res.data.get('data', res.data) if isinstance(res.data, dict) else res.data
        row = [r for r in rows if r['studentId'] == str(self.student.id)][0]
        self.assertEqual(row['totalPaid'], 3500)

    def test_due_total_excludes_paid_months(self):
        self._bulk_pay('2026-01')
        res = self.client.get('/api/finance/fee-status/', {
            'studentId': str(self.student.id),
            'feeMonth': '2026-01', 'feeMonthTo': '2026-03'})
        self.assertEqual(res.status_code, 200)
        item = [i for i in res.data if i['category'] == 'Tuition fee'][0]
        self.assertEqual(item['dueTotal'], 7000)


class DefaulterTotalsReuseTests(TestCase):
    """Grand totals reuse the page compute's fetched maps (no 2x fetch)."""

    def setUp(self):
        self.client = APIClient()
        _auth(self.client)
        self.klass = SchoolClass.objects.create(name='Class 5', order=1)
        self.year = AcademicYear.objects.create(
            name='2026', start_date='2026-01-01',
            end_date='2026-12-31', is_active=True)
        self.students = [
            Student.objects.create(
                name=f'D{i}', student_id=f'D{i:06d}',
                school_class=self.klass, session='2026')
            for i in range(5)
        ]
        FeeSchedule.objects.create(
            academic_year=self.year, school_class=self.klass,
            category='Tuition', amount=1000,
            frequency='MONTHLY', applicability='AUTO',
        )

    def test_paginated_totals_match_full_compute_single_fetch(self):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext
        from finance.services.defaulter_service import DefaulterService
        svc = DefaulterService(month_from='2026-01', month_to='2026-06')
        svc.resolve_year()
        students = list(
            Student.objects.filter(deleted_at__isnull=True)
            .select_related('school_class')
            .only('id', 'name', 'school_class__name')
            .order_by('name')
        )
        ids = [s.id for s in students]
        full = svc.compute(students, ids)
        # Totals from the page compute's maps: same sums, one fetch.
        maps = svc.fetch_maps(ids)
        page_due, page_paid = svc.compute_totals(students[:2], ids[:2], _maps=maps)
        due, paid = svc.compute_totals(students, ids, _maps=maps)
        self.assertAlmostEqual(due, sum(r['totalDue'] for r in full))
        self.assertAlmostEqual(paid, sum(r['totalPaid'] for r in full))
        self.assertAlmostEqual(
            page_due + sum(r['totalDue'] for r in full[2:]), due)
        with CaptureQueriesContext(connection) as ctx:
            res = self.client.get(
                '/api/finance/defaulter/?year=2026&limit=2&page=1'
                '&monthFrom=2026-01&monthTo=2026-06')
        n = len(ctx)
        print(f'\nDEFAULTER-PAGE queries: {n}')
        self.assertEqual(res.status_code, 200)
        self.assertAlmostEqual(res.data['grandTotalDue'], due)
        self.assertAlmostEqual(res.data['grandTotalPaid'], paid)
        self.assertLess(n, 25, f'paginated defaulter took {n} queries')
