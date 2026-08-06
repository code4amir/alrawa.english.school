from django.test import TestCase
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import RefreshToken
from students.models import Student
from core.models import SchoolClass, AcademicYear
from .models import Transaction, FeeSchedule, PaymentAllocation, StudentFeeAssignment, OpeningBalance, PeriodClose, FeeWaiver, BankAccount
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
        Transaction.objects.create(
            transaction_date='2026-06-01', transaction_type='INCOME',
            amount=1000, description='Test', student=self.student,
            destination_account=self.bank_ar, fiscal_year=2026
        )
        OpeningBalance.objects.create(
            account=self.bank_ar, fiscal_year=2026, amount=50000,
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
        # The defaulter student is in the current-month window → processed, but
        # dry-run must NOT create notifications.
        self.assertIn('Processed: 1', out.getvalue())
        self.assertNotIn('Notified: 1', out.getvalue())
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
