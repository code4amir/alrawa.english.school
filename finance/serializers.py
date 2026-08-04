from rest_framework import serializers
from .models import (
    Transaction, FeeSchedule, FeeWaiver, StudentFeeAssignment,
    PaymentAllocation, ReceiptCounter, OpeningBalance,
    OpeningBalanceHistory, PeriodClose, Reconciliation,
    BankAccount, AccountBalance,
)
from core.camelcase import CamelCaseModelSerializer


class TransactionSerializer(CamelCaseModelSerializer):
    studentName = serializers.CharField(source='student.name', read_only=True, allow_null=True)
    student_id = serializers.UUIDField(allow_null=True, required=False)
    feeMonth = serializers.CharField(source='fee_month', read_only=True, allow_null=True)
    className = serializers.CharField(source='class_name', read_only=True, allow_null=True)
    source_account = serializers.SlugRelatedField(
        slug_field='name', queryset=BankAccount.objects.all(),
        allow_null=True, required=False,
    )
    destination_account = serializers.SlugRelatedField(
        slug_field='name', queryset=BankAccount.objects.all(),
        allow_null=True, required=False,
    )

    class Meta:
        model = Transaction
        fields = ['id', 'transaction_date', 'entry_date', 'transaction_type', 'source_account',
                  'destination_account', 'amount', 'category', 'description', 'student',
                  'student_id', 'studentName', 'class_name', 'className', 'affects_income_ledger',
                  'affects_expense_ledger', 'created_by', 'approved_by', 'reference_id',
                  'token_number', 'fee_month', 'feeMonth', 'fiscal_year', 'receipt_sequence',
                  'is_cancelled', 'cancelled_at', 'cancelled_by', 'cancel_reason',
                  'reversal_of_id', 'created_at', 'updated_by', 'updated_at']
        read_only_fields = ['id', 'created_at', 'is_cancelled', 'cancelled_at',
                            'cancelled_by', 'cancel_reason', 'reversal_of_id',
                            'receipt_sequence', 'reference_id', 'token_number',
                            'affects_income_ledger', 'affects_expense_ledger',
                            'approved_by']


class TransactionCancelSerializer(serializers.Serializer):
    reason = serializers.CharField(required=True)


class FeeScheduleSerializer(CamelCaseModelSerializer):
    classRel = serializers.SerializerMethodField()
    academicYear = serializers.SerializerMethodField()
    class_id = serializers.UUIDField(source='school_class_id', allow_null=True, required=False)
    academic_year_id = serializers.UUIDField(required=False)

    class Meta:
        model = FeeSchedule
        exclude = ['academic_year', 'school_class']
        read_only_fields = ['id', 'created_at']

    def get_classRel(self, obj):
        if obj.school_class:
            return {'name': obj.school_class.name}
        return None

    def get_academicYear(self, obj):
        if obj.academic_year:
            return {'name': obj.academic_year.name}
        return None


class FeeScheduleCopySerializer(serializers.Serializer):
    sourceAcademicYearId = serializers.UUIDField(source='from_academic_year_id')
    targetAcademicYearId = serializers.UUIDField(source='to_academic_year_id')


class FeeWaiverSerializer(CamelCaseModelSerializer):
    studentName = serializers.CharField(source='student.name', read_only=True)
    feeCategory = serializers.CharField(source='fee_schedule.category', read_only=True)
    feeScheduleAmount = serializers.DecimalField(
        source='fee_schedule.amount', max_digits=12, decimal_places=2, read_only=True
    )

    class Meta:
        model = FeeWaiver
        fields = ['id', 'student', 'studentName', 'fee_schedule', 'feeCategory',
                  'feeScheduleAmount', 'type', 'value', 'reason', 'approved_by',
                  'approved_at', 'approval_status', 'active', 'starts_at',
                  'ends_at', 'created_at']
        read_only_fields = ['id', 'created_at', 'approved_at']


class StudentFeeAssignmentSerializer(CamelCaseModelSerializer):
    studentName = serializers.CharField(source='student.name', read_only=True)
    feeCategory = serializers.CharField(source='fee_schedule.category', read_only=True)
    studentId = serializers.UUIDField(source='student_id', read_only=True)

    class Meta:
        model = StudentFeeAssignment
        fields = ['id', 'student', 'studentName', 'fee_schedule', 'feeCategory',
                  'studentId', 'active', 'starts_at', 'ends_at', 'note', 'created_at']
        read_only_fields = ['id', 'created_at']


class StudentFeeAssignmentToggleSerializer(serializers.Serializer):
    studentId = serializers.UUIDField(source='student_id')
    feeScheduleId = serializers.UUIDField(source='fee_schedule_id')
    active = serializers.BooleanField(default=True)
    startsAt = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    endsAt = serializers.CharField(required=False, allow_blank=True, allow_null=True)

    def validate(self, data):
        if data.get('active'):
            if not data.get('startsAt'):
                raise serializers.ValidationError({'startsAt': 'Start month is required when activating an assignment.'})
            if not data.get('endsAt'):
                raise serializers.ValidationError({'endsAt': 'End month is required when activating an assignment.'})
            if data.get('startsAt') and data.get('endsAt') and data['startsAt'] > data['endsAt']:
                raise serializers.ValidationError({'endsAt': 'End month must be on or after start month.'})
        return data


class BulkAssignSerializer(serializers.Serializer):
    classId = serializers.UUIDField(source='class_id')
    feeScheduleId = serializers.UUIDField(source='fee_schedule_id')
    active = serializers.BooleanField(default=True)
    startsAt = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    endsAt = serializers.CharField(required=False, allow_blank=True, allow_null=True)

    def validate(self, data):
        if data.get('active', True):
            if not data.get('startsAt'):
                raise serializers.ValidationError({'startsAt': 'Start month is required when activating assignments.'})
            if not data.get('endsAt'):
                raise serializers.ValidationError({'endsAt': 'End month is required when activating assignments.'})
            if data.get('startsAt') and data.get('endsAt') and data['startsAt'] > data['endsAt']:
                raise serializers.ValidationError({'endsAt': 'End month must be on or after start month.'})
        return data


class OpeningBalanceSerializer(CamelCaseModelSerializer):
    account = serializers.SlugRelatedField(
        slug_field='name', queryset=BankAccount.objects.all(),
    )

    class Meta:
        model = OpeningBalance
        fields = ['id', 'account', 'fiscal_year', 'amount', 'updated_at']
        read_only_fields = ['id', 'updated_at']


class OpeningBalanceHistorySerializer(CamelCaseModelSerializer):
    class Meta:
        model = OpeningBalanceHistory
        fields = ['id', 'account', 'fiscal_year', 'old_amount', 'new_amount',
                  'changed_by', 'changed_at']


class PeriodCloseSerializer(CamelCaseModelSerializer):
    class Meta:
        model = PeriodClose
        fields = ['id', 'fiscal_year', 'closed_by', 'closed_at', 'notes']
        read_only_fields = ['id', 'closed_at']

    def validate_fiscal_year(self, value):
        if self.instance is None and PeriodClose.objects.filter(fiscal_year=value).exists():
            raise serializers.ValidationError('Period already closed for this year')
        return value


class ReconciliationSerializer(CamelCaseModelSerializer):
    class Meta:
        model = Reconciliation
        fields = ['id', 'account', 'statement_date', 'closing_balance', 'system_balance',
                  'difference', 'status', 'notes', 'created_by', 'created_at']
        read_only_fields = ['id', 'created_at', 'system_balance', 'difference']


class PaymentAllocationSerializer(CamelCaseModelSerializer):
    class Meta:
        model = PaymentAllocation
        fields = ['id', 'transaction', 'fee_schedule', 'student', 'period', 'amount', 'created_at']
        read_only_fields = ['id', 'created_at']


class BalanceSerializer(serializers.Serializer):
    account = serializers.CharField()
    balance = serializers.DecimalField(max_digits=12, decimal_places=2)
