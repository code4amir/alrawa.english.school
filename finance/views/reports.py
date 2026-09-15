from datetime import datetime
from decimal import Decimal
from rest_framework import viewsets, status, generics
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db.models import Sum, Q, Count, OuterRef, Subquery, DateTimeField
from django.db.models.functions import ExtractMonth

from finance.models import Transaction, OpeningBalance
from finance.serializers import TransactionSerializer
from accounts.permissions import require_permission
from .base import (
    PRIMARY_BANK, SECONDARY_BANK, CROSS_BANK_INCOME, CROSS_BANK_EXPENSE, _internal_accounts,
    report_filter, _void_refund_memo,
)

class ReportView(generics.GenericAPIView):
    permission_classes = [require_permission('finance:read')]

    def get(self, request, report_type):
        fy = request.query_params.get('fiscal_year') or request.query_params.get('year', datetime.now().year)
        try:
            fy = int(fy)
        except ValueError:
            fy = datetime.now().year

        handlers = {
            'headwise': self._report_headwise,
            'monthly': self._report_monthly,
            'audit': self._report_audit,
            'agm': self._report_agm,
            'defaulter': self._report_defaulter,
        }

        handler = handlers.get(report_type)
        if not handler:
            return Response({'error': 'Unknown report type'}, status=400)

        return handler(fy, request)

    def _report_headwise(self, fy, request):
        # report_filter(): voids (incl. all historical reversals) excluded from
        # every sum/count; refunds included via their flipped type.
        income = Transaction.objects.filter(
            fiscal_year=fy,
        ).filter(report_filter()).filter(CROSS_BANK_INCOME).values('category').annotate(
            total=Sum('amount'), count=Count('id')
        ).order_by('category')

        expense = Transaction.objects.filter(
            fiscal_year=fy,
        ).filter(report_filter()).filter(CROSS_BANK_EXPENSE).values('category').annotate(
            total=Sum('amount'), count=Count('id')
        ).order_by('category')

        return Response({
            'fiscal_year': fy,
            'income': list(income),
            'expense': list(expense),
        })

    def _report_monthly(self, fy, request):
        income = Transaction.objects.filter(
            fiscal_year=fy,
        ).filter(report_filter()).filter(CROSS_BANK_INCOME).annotate(
            month=self._month_extract('transaction_date')
        ).values('month', 'category').annotate(total=Sum('amount'))

        expense = Transaction.objects.filter(
            fiscal_year=fy,
        ).filter(report_filter()).filter(CROSS_BANK_EXPENSE).annotate(
            month=self._month_extract('transaction_date')
        ).values('month', 'category').annotate(total=Sum('amount'))

        return Response({
            'fiscal_year': fy,
            'income': list(income),
            'expense': list(expense),
        })

    def _report_audit(self, fy, request):
        txs = Transaction.objects.filter(
            fiscal_year=fy, is_cancelled=False,
        ).select_related('student', 'source_account', 'destination_account').order_by('-transaction_date')

        page = self.paginate_queryset(txs)
        if page is not None:
            serializer = TransactionSerializer(page, many=True)
            return self.get_paginated_response(serializer.data)

        serializer = TransactionSerializer(txs, many=True)
        return Response(serializer.data)

    def _report_agm(self, fy, request):
        qs = Transaction.objects.filter(fiscal_year=fy).filter(report_filter())

        cross_bank_q = Q(
            transaction_type='INTERNAL_TRANSFER',
            source_account__name=SECONDARY_BANK,
            destination_account__name=PRIMARY_BANK,
        ) | Q(
            transaction_type='INTERNAL_TRANSFER',
            source_account__name=PRIMARY_BANK,
            destination_account__name=SECONDARY_BANK,
        )

        non_cross_transfer_q = Q(transaction_type='INTERNAL_TRANSFER') & ~cross_bank_q

        combined_agg = qs.aggregate(
            income=Sum('amount', filter=CROSS_BANK_INCOME),
            income_count=Count('id', filter=CROSS_BANK_INCOME),
            expense=Sum('amount', filter=CROSS_BANK_EXPENSE),
            expense_count=Count('id', filter=CROSS_BANK_EXPENSE),
            transfers=Sum('amount', filter=non_cross_transfer_q),
            transfer_count=Count('id', filter=non_cross_transfer_q),
        )
        income = combined_agg['income'] or Decimal('0')
        income_count = combined_agg['income_count'] or 0
        expense = combined_agg['expense'] or Decimal('0')
        expense_count = combined_agg['expense_count'] or 0
        total_transfers = combined_agg['transfers'] or Decimal('0')
        transfer_count = combined_agg['transfer_count'] or 0

        cat_agg = qs.values('category').annotate(
            income_total=Sum('amount', filter=CROSS_BANK_INCOME),
            expense_total=Sum('amount', filter=CROSS_BANK_EXPENSE),
        ).order_by('category')

        income_by_cat = []
        expense_by_cat = []
        for row in cat_agg:
            cat = row['category'] or 'Uncategorized'
            if row['income_total']:
                income_by_cat.append([cat, float(row['income_total'])])
            if row['expense_total']:
                expense_by_cat.append([cat, float(row['expense_total'])])

        inc_by_account = dict(
            qs.filter(CROSS_BANK_INCOME).values(
                'destination_account__name'
            ).annotate(total=Sum('amount')).values_list('destination_account__name', 'total')
        )
        exp_by_account = dict(
            qs.filter(CROSS_BANK_EXPENSE).values(
                'source_account__name'
            ).annotate(total=Sum('amount')).values_list('source_account__name', 'total')
        )
        transfer_in_by_account = dict(
            qs.filter(non_cross_transfer_q).values(
                'destination_account__name'
            ).annotate(total=Sum('amount')).values_list('destination_account__name', 'total')
        )
        transfer_out_by_account = dict(
            qs.filter(non_cross_transfer_q).values(
                'source_account__name'
            ).annotate(total=Sum('amount')).values_list('source_account__name', 'total')
        )

        accounts = _internal_accounts()
        opening = {}
        closing = {}
        ob_map = {
            ob.account.name: ob
            for ob in OpeningBalance.objects.filter(account__name__in=accounts, fiscal_year=fy).select_related('account')
        }
        for account in accounts:
            ob = ob_map.get(account)
            opening[account] = float(ob.amount) if ob else 0
            inc = inc_by_account.get(account, Decimal('0'))
            exp = exp_by_account.get(account, Decimal('0'))
            tin = transfer_in_by_account.get(account, Decimal('0'))
            tout = transfer_out_by_account.get(account, Decimal('0'))
            closing[account] = float(opening[account]) + float(inc) - float(exp) + float(tin) - float(tout)

        total_assets = sum(closing.values())

        memo = _void_refund_memo(fy)
        return Response({
            'fiscal_year': fy,
            'totalIncome': income,
            'totalExpense': expense,
            'netSurplus': income - expense,
            'income': income_by_cat,
            'expense': expense_by_cat,
            'opening': opening,
            'closing': closing,
            'totalAssets': total_assets,
            'totalTransfers': total_transfers,
            'transferCount': transfer_count,
            'transactionCount': income_count + expense_count + transfer_count,
            'voids': {
                'count': memo['voids']['count'],
                'amount': float(memo['voids']['amount']),
            },
            'refunds': {
                'count': memo['refunds']['count'],
                'amount': float(memo['refunds']['amount']),
            },
        })

    def _report_defaulter(self, fy, request):
        # Single source of truth: delegate to DefaulterService so this
        # endpoint agrees with /finance/defaulter/ on waivers, monthly
        # proration, assignment windows, and cancelled transactions.
        # Response shape is kept flat for backward compatibility.
        from finance.services.defaulter_service import DefaulterService
        class_id = request.query_params.get('class_id')
        fee_category = request.query_params.get('fee_category')
        month_from = request.query_params.get('month_from') or request.query_params.get('monthFrom')
        month_to = request.query_params.get('month_to') or request.query_params.get('monthTo')
        year_str = request.query_params.get('year') or request.query_params.get('fiscal_year')

        svc = DefaulterService(
            fee_category=fee_category or None,
            month_from=month_from, month_to=month_to,
            year_str=year_str,
        )
        svc.resolve_year()
        students_qs = svc.get_student_queryset()
        if class_id:
            students_qs = students_qs.filter(school_class_id=class_id)
        students = list(students_qs.select_related('school_class'))
        computed = svc.compute(students, [s.id for s in students])

        result = []
        for entry, student in zip(computed, students):
            due = entry['totalDue'] - entry['totalPaid']
            result.append({
                'student_id': student.id,
                'student_name': student.name,
                'roll': student.roll,
                'class': student.school_class.name if student.school_class else '',
                'paid': entry['totalPaid'],
                'expected': entry['totalDue'],
                'due': due,
            })

        return Response(result)

    @staticmethod
    def _month_extract(field):
        allowed = {'transaction_date', 'date'}
        if field not in allowed:
            raise ValueError(f"Field '{field}' is not allowed for month extraction")
        return ExtractMonth(field)


class ReportViewSet(viewsets.GenericViewSet):
    permission_classes = [require_permission('finance:read')]

    @action(detail=False, methods=['get'])
    def agm(self, request):
        view = ReportView()
        view.request = request
        return view.get(request, 'agm')

    @action(detail=False, methods=['get'])
    def headwise(self, request):
        view = ReportView()
        view.request = request
        return view.get(request, 'headwise')

    @action(detail=False, methods=['get'])
    def monthly(self, request):
        view = ReportView()
        view.request = request
        return view.get(request, 'monthly')

    @action(detail=False, methods=['get'])
    def audit(self, request):
        view = ReportView()
        view.request = request
        return view.get(request, 'audit')

    @action(detail=False, methods=['get'])
    def defaulter(self, request):
        view = ReportView()
        view.request = request
        return view.get(request, 'defaulter')
