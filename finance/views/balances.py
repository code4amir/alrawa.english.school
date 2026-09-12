from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db import transaction as db_transaction

from finance.models import (
    OpeningBalance, OpeningBalanceHistory, PeriodClose, Reconciliation
)
from finance.serializers import (
    OpeningBalanceSerializer, OpeningBalanceHistorySerializer,
    PeriodCloseSerializer, ReconciliationSerializer
)
from accounts.permissions import require_permission
from .base import _param, _check_period_open, _fiscal_year_from_date
from core.audit import log_audit

class OpeningBalanceViewSet(viewsets.ModelViewSet):
    queryset = OpeningBalance.objects.select_related('account').all()
    serializer_class = OpeningBalanceSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        fiscal_year = _param(self.request, 'fiscal_year', 'fiscalYear')
        if fiscal_year:
            qs = qs.filter(fiscal_year=int(fiscal_year))
        account = _param(self.request, 'account')
        if account:
            qs = qs.filter(account__name=account)
        return qs

    def get_permissions(self):
        if self.action in ['list', 'retrieve', 'history']:
            return [require_permission('finance:read')()]
        return [require_permission('finance:write')()]

    def perform_create(self, serializer):
        fy = serializer.validated_data.get('fiscal_year')
        if fy:
            _check_period_open(fy)
        obj = serializer.save()
        log_audit('create', 'opening_balance', entity_id=obj.pk, request=self.request,
                  details={'fiscal_year': obj.fiscal_year,
                           'account': getattr(obj.account, 'name', str(obj.account_id)),
                           'amount': str(obj.amount)})

    def perform_update(self, serializer):
        instance = self.get_object()
        if instance.fiscal_year:
            _check_period_open(instance.fiscal_year)
        old_amount = instance.amount
        with db_transaction.atomic():
            serializer.save(updated_by=str(self.request.user.id))
            OpeningBalanceHistory.objects.create(
                fiscal_year=instance.fiscal_year,
                account=instance.account,
                old_amount=old_amount,
                new_amount=serializer.validated_data.get('amount', old_amount),
                changed_by=str(self.request.user.id),
            )
        log_audit('update', 'opening_balance', entity_id=instance.pk, request=self.request)

    def perform_destroy(self, instance):
        if instance.fiscal_year:
            _check_period_open(instance.fiscal_year)
        log_audit('delete', 'opening_balance', entity_id=instance.pk, request=self.request,
                  details={'fiscal_year': instance.fiscal_year,
                           'account': getattr(instance.account, 'name', str(instance.account_id)),
                           'amount': str(instance.amount)})
        instance.delete()

    @action(detail=False, methods=['get'])
    def history(self, request):
        qs = OpeningBalanceHistory.objects.select_related('account').all()
        fiscal_year = _param(request, 'fiscal_year', 'fiscalYear')
        account = _param(request, 'account')
        if fiscal_year is not None:
            try:
                qs = qs.filter(fiscal_year=int(fiscal_year))
            except ValueError:
                pass
        if account:
            qs = qs.filter(account__name=account)
        serializer = OpeningBalanceHistorySerializer(qs, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['post'], url_path='revert/(?P<history_pk>[^/.]+)')
    def revert(self, request, history_pk=None):
        from rest_framework.exceptions import NotFound
        try:
            history = OpeningBalanceHistory.objects.select_related('account').get(pk=history_pk)
        except OpeningBalanceHistory.DoesNotExist:
            raise NotFound("Opening balance history record not found.")
        if history.fiscal_year:
            _check_period_open(history.fiscal_year)
        with db_transaction.atomic():
            balance, _ = OpeningBalance.objects.select_related('account').get_or_create(
                fiscal_year=history.fiscal_year,
                account=history.account,
            )
            balance.amount = history.old_amount
            balance.updated_by = str(request.user.id)
            balance.save()
        log_audit('revert', 'opening_balance', entity_id=balance.pk,
                  details={'history_id': str(history_pk)}, request=request)
        return Response(OpeningBalanceSerializer(balance).data)


class PeriodCloseViewSet(viewsets.ModelViewSet):
    queryset = PeriodClose.objects.all()
    serializer_class = PeriodCloseSerializer

    def get_permissions(self):
        if self.action in ['list', 'retrieve']:
            return [require_permission('finance:read')()]
        return [require_permission('finance:admin')()]

    def perform_create(self, serializer):
        obj = serializer.save(closed_by=str(self.request.user.id))
        log_audit('create', 'period_close', entity_id=obj.pk, request=self.request)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        entity_id = str(instance.pk)
        instance.delete()
        log_audit('delete', 'period_close', entity_id=entity_id, request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ReconciliationViewSet(viewsets.ModelViewSet):
    queryset = Reconciliation.objects.select_related('account').all()
    serializer_class = ReconciliationSerializer

    def get_permissions(self):
        if self.action in ['list', 'retrieve']:
            return [require_permission('finance:read')()]
        return [require_permission('finance:admin')()]

    def perform_create(self, serializer):
        fy = _fiscal_year_from_date(serializer.validated_data.get('statement_date'))
        _check_period_open(fy)
        obj = serializer.save()
        log_audit('create', 'reconciliation', entity_id=obj.pk, request=self.request,
                  details={'account': getattr(obj.account, 'name', str(obj.account_id)),
                           'statement_date': str(obj.statement_date)})

    def perform_update(self, serializer):
        instance = self.get_object()
        _check_period_open(_fiscal_year_from_date(instance.statement_date))
        serializer.save()
        log_audit('update', 'reconciliation', entity_id=instance.pk, request=self.request,
                  details={'account': getattr(instance.account, 'name', str(instance.account_id)),
                           'statement_date': str(instance.statement_date)})

    def perform_destroy(self, instance):
        _check_period_open(_fiscal_year_from_date(instance.statement_date))
        log_audit('delete', 'reconciliation', entity_id=instance.pk, request=self.request,
                  details={'account': getattr(instance.account, 'name', str(instance.account_id)),
                           'statement_date': str(instance.statement_date)})
        instance.delete()
