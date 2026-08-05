from decimal import Decimal
from rest_framework.decorators import action
from rest_framework.response import Response

from finance.services.ledger_service import LedgerService
from finance.services.fee_status_service import FeeStatusService
from finance.services.defaulter_service import DefaulterService
from .base import PRIMARY_BANK, SECONDARY_BANK, _internal_accounts, _param


def _serialize_tx(tx, account_name, opening_balance, cancelled_by_names):
    is_incoming = tx.destination_account and tx.destination_account.name == account_name
    is_outgoing = tx.source_account and tx.source_account.name == account_name
    debit = tx.amount if is_incoming else Decimal('0')
    credit = tx.amount if is_outgoing else Decimal('0')
    running = tx._running + opening_balance

    display_type = tx.transaction_type
    if tx.transaction_type == 'INTERNAL_TRANSFER' and tx.source_account and tx.destination_account:
        src = tx.source_account.name
        dst = tx.destination_account.name
        if src == SECONDARY_BANK and dst == PRIMARY_BANK:
            display_type = 'INCOME'
        elif src == PRIMARY_BANK and dst == SECONDARY_BANK:
            display_type = 'EXPENSE'

    tx_status = 'Cancelled' if tx.is_cancelled else ('Reversal' if tx.reversal_of_id else 'Active')

    return {
        'id': str(tx.id),
        'voucher': tx.reference_id or '',
        'transactionDate': tx.transaction_date.isoformat(),
        'entryDate': tx.entry_date.isoformat() if tx.entry_date else tx.created_at.date().isoformat(),
        'transactionType': display_type,
        'amount': float(tx.amount),
        'debit': float(debit),
        'credit': float(credit),
        'runningBalance': float(running),
        'description': tx.description or (
            tx.destination_account.name
            if tx.transaction_type == 'INTERNAL_TRANSFER' and tx.destination_account
            else ''
        ),
        'category': tx.category,
        'sourceAccount': tx.source_account.name if tx.source_account else None,
        'destinationAccount': tx.destination_account.name if tx.destination_account else None,
        'studentId': str(tx.student_id) if tx.student_id else None,
        'studentName': tx.student.name if tx.student else None,
        'className': tx.class_name,
        'feeMonth': tx.fee_month,
        'tokenNumber': tx.token_number,
        'referenceId': tx.reference_id,
        'isCancelled': tx.is_cancelled,
        'cancelledAt': tx.cancelled_at.isoformat() if tx.cancelled_at else None,
        'cancelledBy': tx.cancelled_by,
        'cancelledByName': cancelled_by_names.get(str(tx.cancelled_by), tx.cancelled_by) if tx.cancelled_by else None,
        'cancelReason': tx.cancel_reason,
        'reversalOfId': str(tx.reversal_of_id) if tx.reversal_of_id else None,
        'status': tx_status,
        'createdBy': tx.created_by,
        'createdAt': tx.created_at.isoformat(),
    }


class LedgerActionsMixin:
    """Ledger, fee_status, and defaulter actions for TransactionViewSet."""

    @action(detail=False, methods=['get'])
    def ledger(self, request):
        account_name = _param(request, 'account')
        if account_name not in _internal_accounts():
            return Response({'error': 'Invalid account'}, status=400)

        date_from = _param(request, 'date_from', 'dateFrom')
        date_to = _param(request, 'date_to', 'dateTo')
        search = _param(request, 'search')

        try:
            page_size = min(int(request.query_params.get('limit', 25)), 200)
            page_num = max(int(request.query_params.get('page', 1)), 1)
        except (ValueError, TypeError):
            page_size = 25
            page_num = 1

        svc = LedgerService(account_name, date_from, date_to, search)
        svc.compute_opening_balance()

        base_qs = svc.build_base_queryset()
        total_rows = base_qs.count()

        page_txs = svc.get_page(base_qs, page_num, page_size)
        cancelled_by_names = svc.get_cancelled_by_names(page_txs)
        total_debit, total_credit = svc.get_totals(base_qs)

        closing_balance = svc.opening_balance + total_debit - total_credit
        total_pages = max(1, (total_rows + page_size - 1) // page_size)

        return Response({
            'data': [_serialize_tx(tx, account_name, svc.opening_balance, cancelled_by_names) for tx in page_txs],
            'page': page_num,
            'pageSize': page_size,
            'totalPages': total_pages,
            'totalRows': total_rows,
            'openingBalance': float(svc.opening_balance),
            'closingBalance': float(closing_balance),
            'totalDebit': float(total_debit),
            'totalCredit': float(total_credit),
        })

    @action(detail=False, methods=['get'])
    def fee_status(self, request):
        student_id = request.query_params.get('student_id') or request.query_params.get('studentId')
        if not student_id:
            return Response({'error': 'student_id required'}, status=400)

        fee_month = request.query_params.get('fee_month') or request.query_params.get('feeMonth')
        fee_month_to = request.query_params.get('fee_month_to') or request.query_params.get('feeMonthTo')

        svc = FeeStatusService(student_id, fee_month, fee_month_to)
        result = svc.get_status()
        if result is None:
            return Response({'error': 'Student not found'}, status=404)
        return Response(result)

    @action(detail=False, methods=['get'])
    def defaulter(self, request):
        class_name = _param(request, 'class_name', 'className')
        student_id = _param(request, 'student_id', 'studentId')
        fee_category = _param(request, 'fee_category', 'feeCategory')
        month_from = _param(request, 'month_from', 'monthFrom')
        month_to = _param(request, 'month_to', 'monthTo')
        year_str = _param(request, 'year')

        try:
            page_size = min(int(request.query_params.get('limit', 25)), 200)
            page_num = max(int(request.query_params.get('page', 1)), 1)
        except (ValueError, TypeError):
            page_size = 25
            page_num = 1

        svc = DefaulterService(class_name, student_id, fee_category, month_from, month_to, year_str)
        svc.resolve_year()

        students_qs = svc.get_student_queryset()
        students, total_rows = svc.paginate_students(students_qs, page_num, page_size)

        if not students:
            total_pages = max(1, (total_rows + page_size - 1) // page_size) if total_rows > 0 else 1
            return Response({
                'data': [], 'page': page_num, 'pageSize': page_size,
                'totalPages': total_pages, 'totalRows': total_rows,
            })

        student_ids = [s.id for s in students]
        result = svc.compute(students, student_ids)

        total_pages = max(1, (total_rows + page_size - 1) // page_size)
        return Response({
            'data': result,
            'page': page_num,
            'pageSize': page_size,
            'totalPages': total_pages,
            'totalRows': total_rows,
        })

    @action(detail=False, methods=['post'])
    def send_dues_reminder(self, request):
        """Send a dues-reminder to the parent(s) of an individual student.

        Computes the student's unpaid fees (up to the current month only), then
        web-pushes + logs a notification to every linked parent. Gated by the
        viewset's `finance:write` permission (accountant + admin).
        """
        student_id = request.data.get('studentId')
        note = (request.data.get('note') or '').strip()
        if not student_id:
            return Response({'error': 'studentId required'}, status=400)
        if len(note) > 500:
            return Response({'error': 'Note must be 500 characters or fewer'}, status=400)

        from django.utils import timezone
        from students.models import Student
        from parents.services import notify_parents_dues, compose_dues_body

        student = Student.objects.filter(id=student_id, deleted_at__isnull=True).first()
        if not student:
            return Response({'error': 'Student not found'}, status=404)

        # Range anchored at the current month (no future months), ~12 months back
        # to cover a full academic cycle of monthly dues.
        now = timezone.now()
        month_to = f"{now.year}-{now.month:02d}"
        prev_year = now.year - 1 if now.month == 1 else now.year
        prev_month = 12 if now.month == 1 else now.month - 1
        month_from = f"{prev_year}-{prev_month:02d}"

        svc = DefaulterService(
            student_id=student_id,
            month_from=month_from, month_to=month_to,
        )
        svc.resolve_year()
        result = svc.compute([student], [student.id])
        fees = result[0]['fees'] if result else []
        unpaid_count = len(compose_dues_body(fees))
        notified = notify_parents_dues(student_id, fees, note)

        from core.audit import log_audit
        log_audit(
            'due_reminder_sent', 'student', entity_id=str(student_id),
            details={'notified_parents': notified, 'unpaid_count': unpaid_count},
            request=request,
        )
        return Response({
            'studentId': str(student_id),
            'studentName': student.name,
            'unpaidCount': unpaid_count,
            'notifiedParents': notified,
            'message': 'No unpaid dues to remind about' if unpaid_count == 0 else 'Reminder sent',
        })