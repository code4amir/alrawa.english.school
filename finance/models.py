import uuid
import datetime
from django.db import models
from django.db.models import Q


class BankAccount(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, unique=True)
    display_name = models.CharField(max_length=255)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'bank account'
        verbose_name_plural = 'bank accounts'

    def __str__(self):
        return self.display_name


class Transaction(models.Model):
    TRANSACTION_TYPES = [
        ('INCOME', 'Income'),
        ('EXPENSE', 'Expense'),
        ('INTERNAL_TRANSFER', 'Internal Transfer'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    transaction_date = models.DateField(default=datetime.date.today)
    entry_date = models.DateField(default=datetime.date.today, help_text='When entered into system')
    transaction_type = models.CharField(max_length=50, choices=TRANSACTION_TYPES)
    source_account = models.ForeignKey(
        BankAccount, on_delete=models.PROTECT,
        blank=True, null=True, related_name='source_transactions'
    )
    destination_account = models.ForeignKey(
        BankAccount, on_delete=models.PROTECT,
        blank=True, null=True, related_name='destination_transactions'
    )
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    category = models.CharField(max_length=100, blank=True, null=True)
    description = models.TextField(blank=True, null=True)
    student = models.ForeignKey(
        'students.Student', on_delete=models.PROTECT,
        blank=True, null=True, related_name='transactions'
    )
    class_name = models.CharField(max_length=100, blank=True, null=True)
    affects_income_ledger = models.BooleanField(default=False)
    affects_expense_ledger = models.BooleanField(default=False)
    created_by = models.CharField(max_length=100, blank=True, null=True)
    approved_by = models.CharField(max_length=100, blank=True, null=True)
    reference_id = models.CharField(max_length=255, unique=True, blank=True, null=True)
    token_number = models.IntegerField(blank=True, null=True)
    fee_month = models.CharField(max_length=20, blank=True, null=True)
    fiscal_year = models.IntegerField(blank=True, null=True)
    receipt_sequence = models.IntegerField(blank=True, null=True)
    is_cancelled = models.BooleanField(default=False)
    cancelled_at = models.DateTimeField(blank=True, null=True)
    cancelled_by = models.CharField(max_length=100, blank=True, null=True)
    cancel_reason = models.TextField(blank=True, null=True)
    reversal_of_id = models.UUIDField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_by = models.CharField(max_length=100, blank=True, null=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=['fiscal_year', 'transaction_type', 'category']),
            models.Index(fields=['student', 'transaction_date']),
            models.Index(fields=['transaction_type', 'affects_income_ledger']),
            models.Index(fields=['is_cancelled', 'fiscal_year', 'transaction_type'], name='tx_report_idx'),
            models.Index(fields=['fee_month', 'fiscal_year']),
            models.Index(fields=['transaction_date', 'transaction_type']),
        ]
        verbose_name = 'transaction'
        verbose_name_plural = 'transactions'

    def __str__(self):
        return f"{self.transaction_type} - {self.amount} ({self.transaction_date})"


class FeeSchedule(models.Model):
    FREQUENCY_CHOICES = [
        ('MONTHLY', 'Monthly'),
        ('YEARLY', 'Yearly'),
        ('ONE_TIME', 'One Time'),
    ]
    APPLICABILITY_CHOICES = [
        ('AUTO', 'Auto'),
        ('ASSIGNED_ONLY', 'Assigned Only'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    academic_year = models.ForeignKey(
        'core.AcademicYear', on_delete=models.CASCADE,
        related_name='fee_schedules'
    )
    school_class = models.ForeignKey(
        'core.SchoolClass', on_delete=models.CASCADE,
        blank=True, null=True, related_name='fee_schedules'
    )
    category = models.CharField(max_length=100)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    frequency = models.CharField(max_length=20, choices=FREQUENCY_CHOICES, default='MONTHLY')
    applicability = models.CharField(max_length=20, choices=APPLICABILITY_CHOICES, default='AUTO')
    effective_from = models.DateField(blank=True, null=True)
    effective_to = models.DateField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['academic_year', 'school_class', 'category', 'frequency'],
                name='unique_fee_schedule_per_class',
            ),
            models.UniqueConstraint(
                fields=['academic_year', 'category', 'frequency'],
                condition=Q(school_class__isnull=True),
                name='unique_fee_schedule_global',
            ),
        ]
        indexes = [
            models.Index(fields=['academic_year', 'school_class', 'category']),
        ]
        verbose_name = 'fee schedule'
        verbose_name_plural = 'fee schedules'

    def __str__(self):
        return f"{self.category} - {self.amount} ({self.academic_year.name})"


class FeeWaiver(models.Model):
    WAIVER_TYPES = [
        ('CUSTOM_AMOUNT', 'Custom Amount'),
        ('PERCENTAGE', 'Percentage'),
    ]

    APPROVAL_STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    student = models.ForeignKey(
        'students.Student', on_delete=models.PROTECT,
        related_name='fee_waivers'
    )
    fee_schedule = models.ForeignKey(
        FeeSchedule, on_delete=models.CASCADE,
        related_name='waivers'
    )
    type = models.CharField(max_length=20, choices=WAIVER_TYPES, default='CUSTOM_AMOUNT')
    value = models.DecimalField(max_digits=12, decimal_places=2)
    reason = models.TextField(blank=True, null=True)
    approved_by = models.CharField(max_length=100, blank=True, null=True)
    approved_at = models.DateTimeField(blank=True, null=True)
    approval_status = models.CharField(
        max_length=20, choices=APPROVAL_STATUS_CHOICES, default='pending',
    )
    active = models.BooleanField(default=True)
    starts_at = models.DateField(blank=True, null=True)
    ends_at = models.DateField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['student', 'fee_schedule'], name='unique_waiver_per_student_schedule'),
        ]
        verbose_name = 'fee waiver'
        verbose_name_plural = 'fee waivers'

    def __str__(self):
        return f"{self.student.name} - {self.fee_schedule.category} waiver"


class StudentFeeAssignment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    student = models.ForeignKey(
        'students.Student', on_delete=models.PROTECT,
        related_name='student_fee_assignments'
    )
    fee_schedule = models.ForeignKey(
        FeeSchedule, on_delete=models.CASCADE,
        related_name='student_assignments'
    )
    active = models.BooleanField(default=True)
    starts_at = models.CharField(max_length=7, blank=True, null=True, help_text='Month string YYYY-MM')
    ends_at = models.CharField(max_length=7, blank=True, null=True, help_text='Month string YYYY-MM')
    note = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=['student', 'fee_schedule']),
        ]
        verbose_name = 'student fee assignment'
        verbose_name_plural = 'student fee assignments'

    def __str__(self):
        return f"{self.student.name} - {self.fee_schedule.category}"


class PaymentAllocation(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    transaction = models.ForeignKey(
        Transaction, on_delete=models.PROTECT,
        related_name='payment_allocations'
    )
    fee_schedule = models.ForeignKey(
        FeeSchedule, on_delete=models.CASCADE,
        blank=True, null=True, related_name='payment_allocations'
    )
    student = models.ForeignKey(
        'students.Student', on_delete=models.PROTECT,
        related_name='payment_allocations'
    )
    period = models.CharField(max_length=20, blank=True, null=True)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.student.name} - {self.period or 'N/A'} ({self.amount})"

    class Meta:
        indexes = [
            models.Index(fields=['student', 'period']),
        ]
        verbose_name = 'payment allocation'
        verbose_name_plural = 'payment allocations'


class ReceiptCounter(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    fiscal_year = models.IntegerField()
    counter_date = models.DateField(default=datetime.date.today, help_text='Serial resets daily (YYYYMMDD prefix)')
    receipt_type = models.CharField(max_length=20)
    next_sequence = models.IntegerField(default=1)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['counter_date', 'receipt_type'], name='unique_receipt_counter'),
        ]
        verbose_name = 'receipt counter'
        verbose_name_plural = 'receipt counters'

    def __str__(self):
        return f"{self.receipt_type} - {self.counter_date} ({self.next_sequence})"


class OpeningBalance(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    fiscal_year = models.IntegerField()
    account = models.ForeignKey(
        BankAccount, on_delete=models.PROTECT,
        related_name='opening_balances'
    )
    amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.CharField(max_length=100, blank=True, null=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['fiscal_year', 'account'], name='unique_opening_balance'),
        ]
        verbose_name = 'opening balance'
        verbose_name_plural = 'opening balances'

    def __str__(self):
        return f"{self.account} - FY{self.fiscal_year}: {self.amount}"


class OpeningBalanceHistory(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    fiscal_year = models.IntegerField()
    account = models.ForeignKey(
        BankAccount, on_delete=models.PROTECT,
        related_name='balance_history'
    )
    old_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    new_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    changed_by = models.CharField(max_length=100, blank=True, null=True)
    changed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=['fiscal_year', 'account']),
        ]
        verbose_name = 'opening balance history'
        verbose_name_plural = 'opening balance histories'

    def __str__(self):
        return f"{self.account} - FY{self.fiscal_year}: {self.old_amount} → {self.new_amount}"


class PeriodClose(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    fiscal_year = models.IntegerField(unique=True)
    closed_at = models.DateTimeField(auto_now_add=True)
    closed_by = models.CharField(max_length=100, blank=True, null=True)
    notes = models.TextField(blank=True, null=True)

    class Meta:
        verbose_name = 'period close'
        verbose_name_plural = 'period closes'

    def __str__(self):
        return f"FY{self.fiscal_year} closed"


class Reconciliation(models.Model):
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('matched', 'Matched'),
        ('difference', 'Difference'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    account = models.ForeignKey(
        BankAccount, on_delete=models.PROTECT,
        related_name='reconciliations'
    )
    statement_date = models.DateTimeField()
    closing_balance = models.DecimalField(max_digits=12, decimal_places=2)
    system_balance = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    difference = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    notes = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.CharField(max_length=100, blank=True, null=True)

    class Meta:
        indexes = [
            models.Index(fields=['created_at']),
        ]
        verbose_name = 'reconciliation'
        verbose_name_plural = 'reconciliations'

    def __str__(self):
        return f"{self.account} - {self.statement_date} ({self.status})"


class AccountBalance(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    account = models.ForeignKey(
        BankAccount, on_delete=models.PROTECT,
        related_name='account_balances'
    )
    fiscal_year = models.IntegerField()
    month = models.IntegerField()
    opening_balance = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total_debits = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total_credits = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    closing_balance = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['account', 'fiscal_year', 'month'], name='unique_account_balance'),
        ]
        verbose_name = 'account balance'
        verbose_name_plural = 'account balances'

    def __str__(self):
        return f"{self.account} - FY{self.fiscal_year} M{self.month}: {self.closing_balance}"
