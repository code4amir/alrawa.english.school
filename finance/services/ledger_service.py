from datetime import datetime
from decimal import Decimal
from django.db.models import Sum, Q, F, Case, When, Value, Window, DecimalField
from rest_framework.exceptions import ValidationError
from finance.models import Transaction, OpeningBalance
from finance.views.base import _fiscal_year_from_date
from accounts.models import User


class LedgerService:

    def __init__(self, account_name, date_from=None, date_to=None, search=None):
        self.account_name = account_name
        self.date_from = date_from
        self.date_to = date_to
        self.search = search
        self.account_filter = Q(source_account__name=account_name) | Q(destination_account__name=account_name)
        self.opening_balance = Decimal('0')

    def compute_opening_balance(self):
        if not self.date_from:
            return
        try:
            from_date = datetime.strptime(self.date_from, '%Y-%m-%d').date()
        except (ValueError, TypeError):
            raise ValidationError({'date_from': 'Expected YYYY-MM-DD.'})
        fy = _fiscal_year_from_date(from_date)
        try:
            ob = OpeningBalance.objects.get(
                account__name=self.account_name, fiscal_year=fy
            )
            self.opening_balance = ob.amount
        except (OpeningBalance.DoesNotExist, Exception):
            pass
        prior_agg = Transaction.objects.filter(
            self.account_filter,
            is_cancelled=False,
            reversal_of_id__isnull=True,
            transaction_date__lt=self.date_from,
        ).aggregate(
            total_in=Sum('amount', filter=Q(destination_account__name=self.account_name)),
            total_out=Sum('amount', filter=Q(source_account__name=self.account_name)),
        )
        self.opening_balance += (prior_agg['total_in'] or Decimal('0')) - (prior_agg['total_out'] or Decimal('0'))

    def build_base_queryset(self):
        qs = Transaction.objects.filter(
            self.account_filter,
        ).select_related('student', 'source_account', 'destination_account')

        if self.search:
            search_q = (
                Q(reference_id__icontains=self.search) |
                Q(description__icontains=self.search) |
                Q(category__icontains=self.search) |
                Q(student__name__icontains=self.search) |
                Q(class_name__icontains=self.search)
            )
            try:
                search_q |= Q(token_number=int(self.search))
            except (ValueError, TypeError):
                pass
            qs = qs.filter(search_q)

        if self.date_from:
            qs = qs.filter(transaction_date__gte=self.date_from)
        if self.date_to:
            qs = qs.filter(transaction_date__lte=self.date_to)

        return qs.order_by('transaction_date', 'created_at', 'id')

    def get_page(self, qs, page_num, page_size):
        order_by_fields = [F('transaction_date').asc(), F('created_at').asc(), F('id').asc()]

        signed_amount = Case(
            When(destination_account__name=self.account_name, then=F('amount')),
            When(source_account__name=self.account_name, then=-F('amount')),
            default=Value(0),
            output_field=DecimalField(),
        )
        running_contribution = Case(
            When(is_cancelled=False, reversal_of_id__isnull=True, then=signed_amount),
            default=Value(0),
            output_field=DecimalField(),
        )

        page_qs = qs.annotate(
            _running=Window(
                expression=Sum(running_contribution),
                order_by=order_by_fields,
            ),
        )

        start = (page_num - 1) * page_size
        end = start + page_size
        return list(page_qs[start:end])

    def get_cancelled_by_names(self, page_txs):
        cancelled_ids = {str(tx.cancelled_by) for tx in page_txs if tx.cancelled_by}
        if not cancelled_ids:
            return {}
        return {
            str(u.id): u.name
            for u in User.objects.filter(id__in=cancelled_ids)
        }

    def get_totals(self, qs):
        agg = qs.aggregate(
            total_debit=Sum('amount', filter=Q(
                is_cancelled=False, reversal_of_id__isnull=True,
                destination_account__name=self.account_name,
            )),
            total_credit=Sum('amount', filter=Q(
                is_cancelled=False, reversal_of_id__isnull=True,
                source_account__name=self.account_name,
            )),
        )
        return agg['total_debit'] or Decimal('0'), agg['total_credit'] or Decimal('0')
