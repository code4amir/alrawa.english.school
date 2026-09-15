from datetime import datetime
from decimal import Decimal
from rest_framework import viewsets, status, generics
from rest_framework.exceptions import PermissionDenied
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db import transaction as db_transaction
from django.db.models import Sum, Q
from django.utils import timezone
from django.core.cache import cache
from finance.models import (
    Transaction, FeeSchedule, FeeWaiver, StudentFeeAssignment,
    PaymentAllocation, ReceiptCounter, OpeningBalance,
    OpeningBalanceHistory, PeriodClose, Reconciliation,
    BankAccount, AccountBalance,
)
from students.models import Student
from finance.serializers import (
    TransactionSerializer, TransactionCancelSerializer,
    FeeScheduleSerializer, FeeScheduleCopySerializer,
    FeeWaiverSerializer, StudentFeeAssignmentSerializer,
    StudentFeeAssignmentToggleSerializer, BulkAssignSerializer,
    OpeningBalanceSerializer, OpeningBalanceHistorySerializer,
    PeriodCloseSerializer, ReconciliationSerializer,
    PaymentAllocationSerializer, BalanceSerializer,
)
from accounts.permissions import require_permission


def _waiver_expected_amount(waiver, fee_schedule_amount):
    """Compute the expected payment amount given a waiver and fee schedule amount.

    For CUSTOM_AMOUNT waivers, `value` is the exact amount to pay.
    For PERCENTAGE waivers, `value` is the percentage discount applied to the base amount.
    Returns `fee_schedule_amount` if no waiver is provided.
    Accepts waiver as either a model instance or a dict (from .values()).
    """
    if not waiver:
        return fee_schedule_amount
    waiver_type = waiver.type if hasattr(waiver, 'type') else waiver.get('type')
    waiver_value = waiver.value if hasattr(waiver, 'value') else waiver.get('value')
    if waiver_type == 'PERCENTAGE':
        discount = fee_schedule_amount * (Decimal(str(waiver_value)) / Decimal('100'))
        return (fee_schedule_amount - discount).quantize(Decimal('0.01'))
    return Decimal(str(waiver_value))


def _waiver_covers_date(waiver, dt):
    """True if a waiver's active window covers the given date.

    A waiver with no starts_at/ends_at covers every date. Accepts a date
    or datetime. Pending/rejected waivers must already be filtered out by
    the caller (approval_status='approved').
    """
    if not waiver:
        return False
    d = dt.date() if hasattr(dt, 'date') else dt
    starts_at = waiver.starts_at if hasattr(waiver, 'starts_at') else waiver.get('starts_at')
    ends_at = waiver.ends_at if hasattr(waiver, 'ends_at') else waiver.get('ends_at')
    if starts_at and starts_at > d:
        return False
    if ends_at and ends_at < d:
        return False
    return True


def _waiver_covers_month(waiver, month):
    """True if a waiver's active window covers a 'YYYY-MM' fee month."""
    if not waiver or not month:
        return False
    starts_at = waiver.starts_at if hasattr(waiver, 'starts_at') else waiver.get('starts_at')
    ends_at = waiver.ends_at if hasattr(waiver, 'ends_at') else waiver.get('ends_at')
    start_month = starts_at.strftime('%Y-%m') if starts_at else None
    end_month = ends_at.strftime('%Y-%m') if ends_at else None
    if start_month and start_month > month:
        return False
    if end_month and end_month < month:
        return False
    return True


def _parse_month(value, field_name):
    """Parse a 'YYYY-MM' string into (year, month); 400 on garbage."""
    from rest_framework.exceptions import ValidationError
    try:
        y, m = str(value).split('-')
        y, m = int(y), int(m)
        if not 1 <= m <= 12:
            raise ValueError
        return y, m
    except (ValueError, AttributeError):
        raise ValidationError({field_name: 'Expected YYYY-MM.'})


PRIMARY_BANK = 'AL_RAWA_BANK'
SECONDARY_BANK = 'GLOBAL_FORUM_BANK'
CASH_BANK = 'CASH_IN_HAND'

CROSS_BANK_INCOME = Q(transaction_type='INCOME') | (
    Q(transaction_type='INTERNAL_TRANSFER',
      source_account__name=SECONDARY_BANK,
      destination_account__name=PRIMARY_BANK)
)
CROSS_BANK_EXPENSE = Q(transaction_type='EXPENSE') | (
    Q(transaction_type='INTERNAL_TRANSFER',
      source_account__name=PRIMARY_BANK,
      destination_account__name=SECONDARY_BANK)
)

# ── Void-vs-refund reporting ──────────────────────────────────────────
# A cancel marks the original is_cancelled=True and mints a reversal row.
# Voids (is_refund=False, the default — including every historical
# reversal) mean "never happened": they are excluded from ALL
# income/expense sums and activity counts. Refunds (is_refund=True) are
# real money movement back out and DO count, landing in expense sums via
# their flipped EXPENSE type.
ACTIVE_TXNS = Q(is_cancelled=False, reversal_of_id__isnull=True)
REFUND_TXNS = Q(is_cancelled=False, reversal_of_id__isnull=False, is_refund=True)


def report_filter():
    # Rows that count in income/expense sums and activity counts:
    # live rows, refund reversals (real money back out), AND the cancelled
    # originals those refunds reverse (money genuinely arrived, so the
    # income leg stays: income 5000 + expense 5000, net 0). Void reversals
    # and their originals never count anywhere (memo-only).
    from django.db.models import Subquery
    refunded_originals = Transaction.objects.filter(
        is_cancelled=False, reversal_of_id__isnull=False, is_refund=True,
    ).values('reversal_of_id')
    return (
        ACTIVE_TXNS
        | REFUND_TXNS
        | Q(reversal_of_id__isnull=True, id__in=Subquery(refunded_originals))
    )


def _void_refund_memo(fy):
    # Memo figures for one fiscal year: voids and refunds (count+amount each).

    # Memo only: reversals never enter the main income/expense totals
    # (voids) or enter only via report_filter() (refunds).
    from django.db.models import Count
    agg = Transaction.objects.filter(
        fiscal_year=fy, is_cancelled=False, reversal_of_id__isnull=False,
    ).aggregate(
        void_count=Count('id', filter=Q(is_refund=False)),
        void_amount=Sum('amount', filter=Q(is_refund=False)),
        refund_count=Count('id', filter=Q(is_refund=True)),
        refund_amount=Sum('amount', filter=Q(is_refund=True)),
    )
    return {
        'voids': {
            'count': agg['void_count'] or 0,
            'amount': agg['void_amount'] or Decimal('0'),
        },
        'refunds': {
            'count': agg['refund_count'] or 0,
            'amount': agg['refund_amount'] or Decimal('0'),
        },
    }

def _internal_accounts():
    """Get active bank account names, cached for performance."""
    cache_key = 'active_bank_account_names'
    names = cache.get(cache_key)
    if names is None:
        names = list(BankAccount.objects.filter(
            is_active=True
        ).values_list('name', flat=True))
        cache.set(cache_key, names, 300)  # 5 minutes
    return names


def _invalidate_internal_accounts_cache():
    """Invalidate the bank account names cache."""
    cache.delete('active_bank_account_names')


def _next_receipt_sequence(tx_date, receipt_type):
    """Allocate the next receipt/counter sequence, retrying on races.

    Two concurrent creates can both miss the get_or_create and collide on
    the unique (counter_date, receipt_type) pair; on IntegrityError just
    re-read the row the other transaction committed.
    """
    from django.db import IntegrityError
    from finance.models import ReceiptCounter
    for _ in range(3):
        try:
            counter, _ = ReceiptCounter.objects.select_for_update().get_or_create(
                counter_date=tx_date,
                receipt_type=receipt_type,
                defaults={'next_sequence': 1, 'fiscal_year': tx_date.year},
            )
            seq = counter.next_sequence
            counter.next_sequence = seq + 1
            counter.save(update_fields=['next_sequence'])
            return seq
        except IntegrityError:
            continue
    counter = ReceiptCounter.objects.select_for_update().get(
        counter_date=tx_date, receipt_type=receipt_type,
    )
    seq = counter.next_sequence
    counter.next_sequence = seq + 1
    counter.save(update_fields=['next_sequence'])
    return seq


def _roll_balances_forward(account, fy):
    """Re-roll opening/closing balances forward through an FY.

    Keeps the earliest existing month's stored opening (0 when the FY
    started with no activity) and cascades each month's close into the
    next month's opening. This self-heals backdated entries: writing to
    an old month re-rolls every later month in the same FY.
    FY months run September(9) -> August(8).
    """
    rows = list(
        AccountBalance.objects.select_for_update().filter(
            account=account, fiscal_year=fy
        )
    )
    if not rows:
        return
    by_month = {b.month: b for b in rows}
    prev_close = None
    for m in sorted(by_month.keys(), key=lambda m: (m - 9) % 12):
        b = by_month[m]
        if prev_close is not None:
            b.opening_balance = prev_close
        b.closing_balance = b.opening_balance + b.total_credits - b.total_debits
        b.save(update_fields=['opening_balance', 'closing_balance'])
        prev_close = b.closing_balance


def _account_balances_update(transaction):
    """Update AccountBalance cache for a transaction's accounts."""
    with db_transaction.atomic():
        for account_field in ('source_account', 'destination_account'):
            account = getattr(transaction, account_field, None)
            if not account:
                continue
            fy = transaction.fiscal_year
            if not fy:
                continue
            month = transaction.transaction_date.month
            bal, _ = AccountBalance.objects.select_for_update().get_or_create(
                account=account,
                fiscal_year=fy,
                month=month,
                defaults={'opening_balance': 0},
            )
            is_source = (account_field == 'source_account')
            # Cancelled originals and their reversals are both EXCLUDED from
            # balances (mirroring the ledger/balances endpoints, which filter
            # is_cancelled=False AND reversal_of_id__isnull=True): the cancel
            # subtracts the original posting, and the reversal row is never
            # fed into this cache — applying it would double-count.
            if transaction.is_cancelled:
                if is_source:
                    bal.total_debits -= transaction.amount
                else:
                    bal.total_credits -= transaction.amount
            else:
                if is_source:
                    bal.total_debits += transaction.amount
                else:
                    bal.total_credits += transaction.amount
            bal.closing_balance = bal.opening_balance + bal.total_credits - bal.total_debits
            bal.save()
            # Cascade the new close forward so later months (and the AI
            # balances handler, which reads the latest month) stay correct,
            # including for backdated transactions.
            _roll_balances_forward(account, fy)


def _param(request, *names):
    """Get query param by any of the given names (e.g., snake_case and camelCase)."""
    for name in names:
        val = request.query_params.get(name)
        if val is not None:
            return val
    return None


def _invalidate_dashboard_cache(fiscal_year=None):
    """Invalidate dashboard summary cache for one or all fiscal years."""
    if fiscal_year is not None:
        cache.delete(f'finance_dashboard_{fiscal_year}')
    else:
        for y in range(timezone.now().year - 2, timezone.now().year + 2):
            cache.delete(f'finance_dashboard_{y}')


def _check_period_open(fiscal_year):
    if PeriodClose.objects.filter(fiscal_year=fiscal_year).exists():
        raise PermissionDenied(f"Transactions cannot be modified for fiscal year {fiscal_year}. Period is closed.")


def _fiscal_year_from_date(dt):
    """Calculate fiscal year from a date using September start (month > 8 → fy = year+1).
    FISCAL_YEAR_START_MONTH is 0-indexed (8=Sep in JS), so compare with dt.month (> not >=).
    Accepts date/datetime objects or 'YYYY-MM-DD' strings."""
    from school_management.settings import FISCAL_YEAR_START_MONTH
    if isinstance(dt, str):
        from datetime import date as _date, datetime as _dt
        try:
            dt = _dt.fromisoformat(dt)
        except ValueError:
            dt = _date.fromisoformat(dt[:10])
    else:
        import datetime as _mod
        if isinstance(dt, _mod.datetime):
            dt = dt.date()
    return dt.year + 1 if dt.month > FISCAL_YEAR_START_MONTH else dt.year


def _resolve_fiscal_year(obj):
    """Resolve the fiscal year a finance object belongs to.

    Transactions/OpeningBalances carry `fiscal_year` directly. Fee models
    don't: FeeSchedule anchors to its academic year's start date, and
    FeeWaiver/StudentFeeAssignment inherit their fee schedule's year.
    Returns None when no year can be resolved (check is skipped).
    Accepts a model instance or a validated-data dict.
    """
    if obj is None:
        return None
    get = obj.get if isinstance(obj, dict) else lambda k: getattr(obj, k, None)

    fy = get('fiscal_year')
    if fy:
        return fy

    year = get('academic_year')
    if year is None:
        schedule = get('fee_schedule')
        if schedule is not None:
            year = schedule.get('academic_year') if isinstance(schedule, dict) else getattr(schedule, 'academic_year', None)
    start = year.get('start_date') if isinstance(year, dict) else getattr(year, 'start_date', None)
    if start:
        return _fiscal_year_from_date(start)
    return None


class PeriodClosedMixin:
    def perform_create(self, serializer):
        fiscal_year = _resolve_fiscal_year(serializer.validated_data)
        if fiscal_year:
            _check_period_open(fiscal_year)
        serializer.save()

    def perform_update(self, serializer):
        if serializer.instance:
            fiscal_year = _resolve_fiscal_year(serializer.instance)
            if fiscal_year:
                _check_period_open(fiscal_year)
        serializer.save()

    def perform_destroy(self, instance):
        fiscal_year = _resolve_fiscal_year(instance)
        if fiscal_year:
            _check_period_open(fiscal_year)
        instance.delete()
