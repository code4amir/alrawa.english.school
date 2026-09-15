import logging
from datetime import date
from decimal import Decimal
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from django.db import transaction as db_transaction
from django.db.models import Sum, Q
from django.utils import timezone
from django.core.cache import cache

from finance.models import (
    Transaction, FeeSchedule, FeeWaiver, PaymentAllocation,
    ReceiptCounter, StudentFeeAssignment, OpeningBalance,
)
from finance.serializers import (
    TransactionSerializer, TransactionCancelSerializer
)
from accounts.permissions import require_permission
from .base import (
    PRIMARY_BANK, PeriodClosedMixin, CROSS_BANK_INCOME, CROSS_BANK_EXPENSE,
    report_filter, _void_refund_memo,
    _internal_accounts, _account_balances_update, _param,
    _check_period_open, _fiscal_year_from_date, _next_receipt_sequence,
    _waiver_expected_amount, _invalidate_dashboard_cache,
)
from .ledger import LedgerActionsMixin
from ..services.transaction_service import create_transaction
from core.audit import log_audit, AuditLogMixin
from parents.services import notify_parents_of_student

logger = logging.getLogger(__name__)


class TransactionViewSet(AuditLogMixin, LedgerActionsMixin, PeriodClosedMixin, viewsets.ModelViewSet):
    queryset = Transaction.objects.select_related('student', 'source_account', 'destination_account').all()
    serializer_class = TransactionSerializer
    filterset_fields = {
        'transaction_type': ['exact'],
        'category': ['exact'],
        'student_id': ['exact'],
        'class_name': ['exact'],
        'fiscal_year': ['exact'],
        'fee_month': ['exact'],
        'transaction_date': ['gte', 'lte'],
    }

    def perform_update(self, serializer):
        raise ValidationError(
            "Financial records are immutable. "
            "To correct a transaction, cancel it first and create a new entry."
        )

    def perform_destroy(self, instance):
        raise ValidationError(
            "Financial records cannot be deleted. "
            "Cancel the transaction instead to reverse it."
        )

    def get_permissions(self):
        if self.action in ['list', 'retrieve', 'balances', 'ledger', 'fee_status', 'dashboard_summary', 'defaulter']:
            return [require_permission('finance:read')()]
        return [require_permission('finance:write')()]

    def get_queryset(self):
        qs = super().get_queryset()
        account = _param(self.request, 'account')
        start_date = _param(self.request, 'start_date', 'startDate')
        end_date = _param(self.request, 'end_date', 'endDate')
        if account:
            qs = qs.filter(
                Q(source_account__name=account) | Q(destination_account__name=account)
            )
        if start_date:
            qs = qs.filter(transaction_date__gte=start_date)
        if end_date:
            qs = qs.filter(transaction_date__lte=end_date)
        return qs

    def perform_create(self, serializer):
        create_transaction(serializer, self.request)

    @action(detail=False, methods=['post'])
    def bulk(self, request):
        results = []
        errors = []
        seen_paid = set()

        # Outer atomic makes the per-row savepoints real: a failing row
        # rolls back only itself, a passing row keeps the full
        # create_transaction() pipeline (counters, waiver/allocation
        # validation, audit log, parent notify).
        with db_transaction.atomic():
            for idx, item in enumerate(request.data):
                sid = db_transaction.savepoint()
                try:
                    serializer = self.get_serializer(data=item)
                    serializer.is_valid(raise_exception=True)

                    student = serializer.validated_data.get('student')
                    fee_month = serializer.validated_data.get('fee_month')
                    category = serializer.validated_data.get('category')

                    if student and fee_month and category:
                        dup_key = (str(student.id), fee_month, category)
                        if dup_key in seen_paid:
                            errors.append({'index': idx, 'student': str(student.id), 'feeMonth': fee_month, 'category': category, 'error': f'Fee month {fee_month} already imported for this student in {category}'})
                            db_transaction.savepoint_rollback(sid)
                            continue
                        exists = Transaction.objects.filter(
                            student=student, fee_month=fee_month, category=category,
                            is_cancelled=False,
                        ).exists()
                        if exists:
                            errors.append({'index': idx, 'student': str(student.id), 'feeMonth': fee_month, 'category': category, 'error': f'Fee month {fee_month} already paid for {student.name} in {category}'})
                            db_transaction.savepoint_rollback(sid)
                            continue
                        seen_paid.add(dup_key)

                    tx = create_transaction(serializer, self.request, row_data=item)
                    db_transaction.savepoint_commit(sid)
                    results.append(TransactionSerializer(tx).data)
                except Exception as e:
                    db_transaction.savepoint_rollback(sid)
                    errors.append({'index': idx, 'error': str(e)})

        if errors and not results:
            return Response({'error': 'All rows failed', 'details': errors}, status=status.HTTP_400_BAD_REQUEST)
        _invalidate_dashboard_cache()
        if errors:
            return Response({'created': results, 'skipped': errors}, status=status.HTTP_201_CREATED)
        return Response(results, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        from django.core.exceptions import ValidationError as DjangoValidationError
        from django.http import Http404
        serializer = TransactionCancelSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # Single atomic block with a row lock: two concurrent cancels of
        # the same transaction serialize here instead of each minting a
        # reversal.
        with db_transaction.atomic():
            try:
                # select_related(None): Postgres forbids FOR UPDATE over the
                # nullable LEFT JOINs in this viewset's base queryset.
                tx = self.get_queryset().select_related(None).select_for_update().get(pk=pk)
            except (Transaction.DoesNotExist, DjangoValidationError):
                raise Http404
            if tx.is_cancelled:
                return Response({'error': 'Already cancelled'}, status=400)
            if tx.fiscal_year:
                _check_period_open(tx.fiscal_year)

            tx.is_cancelled = True
            tx.cancelled_at = timezone.now()
            tx.cancelled_by = str(request.user.id)
            tx.cancel_reason = serializer.validated_data['reason']
            tx.save(update_fields=['is_cancelled', 'cancelled_at', 'cancelled_by', 'cancel_reason'])
            _account_balances_update(tx)

            # Void (default) = entry never happened: the reversal is memo-only
            # and excluded from every report total. Refund = money really went
            # back out: the reversal counts in expense sums. Historical
            # reversals predate the flag, so they stay is_refund=False (void).
            # Compatibility: a bare reason of exactly 'void'/'refund' is also
            # honoured as the kind (kept as the free-text reason too).
            kind = serializer.validated_data.get('cancel_type') or 'void'
            if 'cancel_type' not in request.data:
                bare = (serializer.validated_data['reason'] or '').strip().lower()
                if bare in ('void', 'refund'):
                    kind = bare
            is_refund = (kind == 'refund')

            reversal = Transaction.objects.create(
                transaction_date=tx.transaction_date,
                entry_date=date.today(),
                transaction_type=tx.transaction_type,
                source_account=tx.destination_account,
                destination_account=tx.source_account,
                amount=tx.amount,
                description=f"Reversal of {tx.reference_id or tx.id}: {tx.cancel_reason}",
                student=tx.student,
                class_name=tx.class_name,
                category=tx.category,
                created_by=str(request.user.id),
                fiscal_year=tx.fiscal_year,
                reversal_of_id=tx.id,
                is_refund=is_refund,
            )
            if tx.transaction_type == 'INCOME':
                reversal.transaction_type = 'EXPENSE'
                reversal.affects_expense_ledger = True
            elif tx.transaction_type == 'EXPENSE':
                reversal.transaction_type = 'INCOME'
                reversal.affects_income_ledger = True

            if reversal.transaction_type == 'INCOME':
                reversal_type = 'RCPT'
            elif reversal.transaction_type == 'EXPENSE':
                reversal_type = 'PV'
            else:
                reversal_type = 'TV'
            seq = _next_receipt_sequence(reversal.transaction_date, reversal_type)
            reversal.reference_id = f"{reversal_type}-{reversal.transaction_date:%Y%m%d}-{seq:04d}"
            reversal.save()

        _invalidate_dashboard_cache(tx.fiscal_year)
        log_audit('cancel', 'transaction', entity_id=tx.pk,
                  details={'reason': tx.cancel_reason, 'cancel_type': kind,
                           'is_refund': is_refund, 'amount': str(tx.amount),
                           'source_account': tx.source_account.name if tx.source_account else None,
                           'destination_account': tx.destination_account.name if tx.destination_account else None}, request=request)

        # Notify parents when an income/fee payment is reversed so they know it no longer counts.
        if tx.transaction_type == 'INCOME' and tx.student_id:
            try:
                notify_parents_of_student(
                    tx.student_id, 'fee_reversal',
                    f'Payment reversed for {tx.student.name}',
                    f'{tx.category or "Fee"} {tx.amount:.2f} was reversed/cancelled (receipt {tx.reference_id or ""}). Reason: {tx.cancel_reason}',
                    url='/#/parent/fees/' + str(tx.student_id),
                )
            except Exception:
                logger.exception('Failed to notify parents of fee reversal')

        return Response(TransactionSerializer(tx).data)

    @action(detail=False, methods=['get'])
    def balances(self, request):
        date_from = _param(request, 'date_from', 'dateFrom')
        date_to = _param(request, 'date_to', 'dateTo')

        qs = Transaction.objects.filter(is_cancelled=False, reversal_of_id__isnull=True)
        if date_from:
            qs = qs.filter(transaction_date__gte=date_from)
        if date_to:
            qs = qs.filter(transaction_date__lte=date_to)

        accounts = _internal_accounts()

        from finance.models import OpeningBalance
        fy = _fiscal_year_from_date(timezone.now().date())
        # Scope the sums to the same FY as the opening balance below;
        # summing lifetime transactions against one year's opening
        # double-counts every prior year.
        qs = qs.filter(fiscal_year=fy)

        income_qs = qs.filter(transaction_type='INCOME').values(
            'destination_account__name'
        ).annotate(total=Sum('amount')).values_list('destination_account__name', 'total')
        income_map = dict(income_qs)

        expense_qs = qs.filter(transaction_type='EXPENSE').values(
            'source_account__name'
        ).annotate(total=Sum('amount')).values_list('source_account__name', 'total')
        expense_map = dict(expense_qs)

        transfer_in_qs = qs.filter(transaction_type='INTERNAL_TRANSFER').values(
            'destination_account__name'
        ).annotate(total=Sum('amount')).values_list('destination_account__name', 'total')
        transfer_in_map = dict(transfer_in_qs)

        transfer_out_qs = qs.filter(transaction_type='INTERNAL_TRANSFER').values(
            'source_account__name'
        ).annotate(total=Sum('amount')).values_list('source_account__name', 'total')
        transfer_out_map = dict(transfer_out_qs)

        opening_qs = OpeningBalance.objects.filter(
            fiscal_year=fy, account__name__in=accounts
        ).select_related('account').values_list('account__name', 'amount')
        opening_map = dict(opening_qs)

        results = {}
        for account in accounts:
            opening = opening_map.get(account, Decimal('0'))
            income = income_map.get(account, Decimal('0'))
            expense = expense_map.get(account, Decimal('0'))
            transfer_in = transfer_in_map.get(account, Decimal('0'))
            transfer_out = transfer_out_map.get(account, Decimal('0'))
            results[account] = opening + income + transfer_in - expense - transfer_out

        return Response(results)

    @action(detail=False, methods=['get'])
    def dashboard_summary(self, request):
        from django.core.cache import cache
        fy = _param(request, 'fiscal_year', 'fiscalYear') or timezone.now().year
        try:
            fy = int(fy)
        except ValueError:
            fy = timezone.now().year

        cache_key = f'finance_dashboard_{fy}'
        data = cache.get(cache_key)
        if data is None:
            # report_filter(): live rows plus refund reversals plus refunded
            # originals; void reversals (including all historical ones)
            # are memo-only, never totals.
            agg = Transaction.objects.filter(
                fiscal_year=fy,
            ).filter(report_filter()).aggregate(
                income=Sum('amount', filter=CROSS_BANK_INCOME),
                expense=Sum('amount', filter=CROSS_BANK_EXPENSE),
                deposited=Sum('amount', filter=Q(
                    destination_account__name=PRIMARY_BANK,
                )),
            )
            memo = _void_refund_memo(fy)
            data = {
                'fiscalYear': fy,
                'totalIncome': agg['income'] or Decimal('0'),
                'totalExpense': agg['expense'] or Decimal('0'),
                'totalDepositedToBank': agg['deposited'] or Decimal('0'),
                'depositRemaining': (agg['income'] or Decimal('0')) - (agg['deposited'] or Decimal('0')),
                'net': (agg['income'] or Decimal('0')) - (agg['expense'] or Decimal('0')),
                # Server-side FY totals (same report_filter() rows the
                # client used to accumulate by page-crawling): clients
                # should read totals instead of crawling all pages.
                'totals': {
                    'income': agg['income'] or Decimal('0'),
                    'expense': agg['expense'] or Decimal('0'),
                },
                'voids': memo['voids'],
                'refunds': memo['refunds'],
            }
            cache.set(cache_key, data, 60)
        return Response(data)
