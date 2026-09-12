from django.contrib import admin
from .models import (
    BankAccount, Transaction, FeeSchedule, FeeWaiver,
    StudentFeeAssignment, PaymentAllocation, ReceiptCounter,
    OpeningBalance, OpeningBalanceHistory, PeriodClose,
    Reconciliation, AccountBalance,
)


@admin.register(BankAccount)
class BankAccountAdmin(admin.ModelAdmin):
    list_display = ('name', 'display_name', 'is_active', 'created_at')
    list_filter = ('is_active',)


@admin.register(Transaction)
class TransactionAdmin(admin.ModelAdmin):
    list_display = ('transaction_type', 'amount', 'category', 'transaction_date',
                    'source_account', 'destination_account', 'is_cancelled')
    list_filter = ('transaction_type', 'fiscal_year', 'is_cancelled')
    search_fields = ('description', 'reference_id', 'category')
    # Ledger entries are immutable — corrections go through cancel+reversal
    # in the app, so the admin must not edit or delete them either.
    readonly_fields = ('id', 'transaction_type', 'amount', 'transaction_date',
                       'entry_date', 'source_account', 'destination_account',
                       'category', 'description', 'student', 'class_name',
                       'fee_month', 'fiscal_year', 'reference_id',
                       'receipt_sequence', 'token_number', 'reversal_of_id',
                       'is_cancelled', 'cancelled_at', 'cancelled_by',
                       'cancel_reason', 'created_by', 'approved_by',
                       'updated_by', 'created_at', 'updated_at')

    def has_delete_permission(self, request, obj=None):
        return False

    def save_model(self, request, obj, form, change):
        if change:
            from django.core.exceptions import ValidationError
            raise ValidationError(
                'Financial records are immutable. Cancel the transaction in the app instead.'
            )
        super().save_model(request, obj, form, change)


@admin.register(FeeSchedule)
class FeeScheduleAdmin(admin.ModelAdmin):
    list_display = ('category', 'amount', 'frequency', 'academic_year', 'school_class', 'applicability')
    list_filter = ('frequency', 'applicability', 'academic_year')
    search_fields = ('category',)


@admin.register(FeeWaiver)
class FeeWaiverAdmin(admin.ModelAdmin):
    list_display = ('student', 'fee_schedule', 'type', 'value', 'active')
    list_filter = ('active', 'type')


@admin.register(StudentFeeAssignment)
class StudentFeeAssignmentAdmin(admin.ModelAdmin):
    list_display = ('student', 'fee_schedule', 'active', 'starts_at', 'ends_at')
    list_filter = ('active',)


@admin.register(PeriodClose)
class PeriodCloseAdmin(admin.ModelAdmin):
    list_display = ('fiscal_year', 'closed_at', 'closed_by')
    readonly_fields = ('closed_at',)


@admin.register(OpeningBalance)
class OpeningBalanceAdmin(admin.ModelAdmin):
    list_display = ('account', 'fiscal_year', 'amount', 'updated_at')
    list_filter = ('fiscal_year',)


@admin.register(Reconciliation)
class ReconciliationAdmin(admin.ModelAdmin):
    list_display = ('account', 'statement_date', 'closing_balance', 'status')
    list_filter = ('status',)


@admin.register(AccountBalance)
class AccountBalanceAdmin(admin.ModelAdmin):
    list_display = ('account', 'fiscal_year', 'month', 'opening_balance',
                    'total_debits', 'total_credits', 'closing_balance')
    list_filter = ('fiscal_year',)
