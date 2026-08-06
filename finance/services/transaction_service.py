import logging
from decimal import Decimal
from django.db import transaction as db_transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

logger = logging.getLogger(__name__)

from finance.models import (
    Transaction, FeeSchedule, FeeWaiver, PaymentAllocation,
    ReceiptCounter, StudentFeeAssignment,
)
from finance.views.base import (
    _check_period_open, _fiscal_year_from_date,
    _internal_accounts, _account_balances_update,
    _waiver_expected_amount, _invalidate_dashboard_cache,
)
from core.audit import log_audit
from parents.services import notify_parents_of_student


def create_transaction(serializer, request):
    fiscal_year = serializer.validated_data.get('fiscal_year')
    if fiscal_year:
        _check_period_open(fiscal_year)
    tx_type = serializer.validated_data.get('transaction_type')

    if tx_type == 'INCOME':
        fee_month = serializer.validated_data.get('fee_month') or request.data.get('feeMonth')
        if not fee_month:
            raise ValidationError({'feeMonth': 'Fee month is required for income transactions.'})

    with db_transaction.atomic():
        tx_date = serializer.validated_data.get('transaction_date') or timezone.now().date()
        tx = serializer.save(
            created_by=str(request.user.id),
            fiscal_year=fiscal_year or _fiscal_year_from_date(tx_date),
        )

        allocations = request.data.get('allocations')
        if allocations and tx_type == 'INCOME':
            fee_ids = [
                a.get('feeScheduleId') or a.get('fee_schedule_id')
                for a in allocations
                if (a.get('feeScheduleId') or a.get('fee_schedule_id')) and (a.get('feeScheduleId') or a.get('fee_schedule_id')) != '__other__'
            ]
            fee_map = {
                str(fs.id): fs
                for fs in FeeSchedule.objects.filter(id__in=fee_ids)
            }
            alloc_objects = []
            assigned_fee_ids = [
                fs_id for fs_id in fee_ids
                if fee_map.get(fs_id) and fee_map[fs_id].applicability == 'ASSIGNED_ONLY'
            ]
            assignment_map = {}
            if assigned_fee_ids:
                for a in StudentFeeAssignment.objects.filter(
                    student=tx.student, fee_schedule_id__in=assigned_fee_ids, active=True
                ):
                    assignment_map[str(a.fee_schedule_id)] = a

            waiver_map = {}
            if fee_ids:
                for w in FeeWaiver.objects.filter(
                    student=tx.student, fee_schedule_id__in=fee_ids, active=True
                ):
                    waiver_map[str(w.fee_schedule_id)] = w

            for alloc in allocations:
                fs_id = alloc.get('feeScheduleId') or alloc.get('fee_schedule_id')
                if not fs_id:
                    continue
                if fs_id == '__other__':
                    continue
                if str(fs_id) not in fee_map:
                    continue
                fs = fee_map[str(fs_id)]
                alloc_amount = Decimal(str(alloc.get('amount', 0)))

                if fs.applicability == 'ASSIGNED_ONLY':
                    assignment = assignment_map.get(str(fs_id))
                    if not assignment:
                        raise ValidationError({
                            'allocations': f'You are not assigned to fee "{fs.category}".'
                        })
                    fee_month = serializer.validated_data.get('fee_month') or request.data.get('feeMonth')
                    if fee_month:
                        if assignment.starts_at and fee_month < assignment.starts_at:
                            raise ValidationError({
                                'allocations': f'Fee "{fs.category}" is not yet active. Starts on {assignment.starts_at}.'
                            })
                        if assignment.ends_at and fee_month > assignment.ends_at:
                            raise ValidationError({
                                'allocations': f'Fee "{fs.category}" has expired. Ended on {assignment.ends_at}.'
                            })

                waiver = waiver_map.get(str(fs_id))
                expected = _waiver_expected_amount(waiver, fs.amount)

                if alloc_amount != expected:
                    raise ValidationError({
                        'allocations': f'Amount {alloc_amount} for fee "{fs.category}" does not match expected amount {expected}{f" (waiver applied)" if waiver else ""}.'
                    })
                alloc_objects.append(PaymentAllocation(
                    transaction=tx,
                    fee_schedule=fs,
                    student=tx.student,
                    period=alloc.get('period', ''),
                    amount=alloc_amount,
                ))
            PaymentAllocation.objects.bulk_create(alloc_objects)
            if not tx.category and alloc_objects:
                cats = FeeSchedule.objects.filter(id__in=fee_ids).values_list('category', flat=True)
                tx.category = ', '.join(sorted(set(cats)))
                tx.save(update_fields=['category'])
        elif tx_type == 'INCOME':
            fee_schedule_id = request.data.get('feeScheduleId') or request.data.get('fee_schedule_id')
            if fee_schedule_id and tx.student_id:
                try:
                    fs = FeeSchedule.objects.get(id=fee_schedule_id)
                except FeeSchedule.DoesNotExist:
                    raise ValidationError({'feeScheduleId': 'Fee schedule not found.'})
                waiver = FeeWaiver.objects.filter(
                    student=tx.student, fee_schedule=fs, active=True,
                ).first()
                expected = _waiver_expected_amount(waiver, fs.amount)
                if tx.amount != expected:
                    raise ValidationError({
                        'amount': f'Amount {tx.amount} does not match expected fee amount {expected}{f" (waiver applied)" if waiver else ""} for "{fs.category}".'
                    })
                fee_month = request.data.get('feeMonth') or request.data.get('fee_month') or serializer.validated_data.get('fee_month')
                PaymentAllocation.objects.create(
                    transaction=tx,
                    fee_schedule=fs,
                    student=tx.student,
                    period=fee_month or '',
                    amount=tx.amount,
                )

        if tx_type == 'INCOME' and tx.destination_account and tx.destination_account.name in _internal_accounts():
            tx.affects_income_ledger = True
            counter, _ = ReceiptCounter.objects.select_for_update().get_or_create(
                counter_date=tx.transaction_date,
                receipt_type='RCPT',
                defaults={'next_sequence': 1, 'fiscal_year': tx.transaction_date.year}
            )
            tx.receipt_sequence = counter.next_sequence
            tx.reference_id = f"RCPT-{tx.transaction_date:%Y%m%d}-{counter.next_sequence:04d}"
            counter.next_sequence += 1
            counter.save(update_fields=['next_sequence'])

        if tx_type == 'EXPENSE' and tx.source_account and tx.source_account.name in _internal_accounts():
            tx.affects_expense_ledger = True
            counter, _ = ReceiptCounter.objects.select_for_update().get_or_create(
                counter_date=tx.transaction_date,
                receipt_type='PV',
                defaults={'next_sequence': 1, 'fiscal_year': tx.transaction_date.year}
            )
            tx.receipt_sequence = counter.next_sequence
            tx.reference_id = f"PV-{tx.transaction_date:%Y%m%d}-{counter.next_sequence:04d}"
            counter.next_sequence += 1
            counter.save(update_fields=['next_sequence'])

        if tx_type == 'INTERNAL_TRANSFER' and tx.source_account and tx.destination_account:
            src_internal = tx.source_account.name in _internal_accounts()
            dst_internal = tx.destination_account.name in _internal_accounts()
            if src_internal and dst_internal:
                counter, _ = ReceiptCounter.objects.select_for_update().get_or_create(
                    counter_date=tx.transaction_date,
                    receipt_type='TV',
                    defaults={'next_sequence': 1, 'fiscal_year': tx.transaction_date.year}
                )
                tx.receipt_sequence = counter.next_sequence
                tx.reference_id = f"TV-{tx.transaction_date:%Y%m%d}-{counter.next_sequence:04d}"
                counter.next_sequence += 1
                counter.save(update_fields=['next_sequence'])

        if not tx.token_number and tx_type in ('INCOME', 'EXPENSE'):
            token_counter, _ = ReceiptCounter.objects.select_for_update().get_or_create(
                counter_date=tx.transaction_date,
                receipt_type='TOKEN',
                defaults={'next_sequence': 1, 'fiscal_year': tx.transaction_date.year}
            )
            tx.token_number = token_counter.next_sequence
            token_counter.next_sequence += 1
            token_counter.save(update_fields=['next_sequence'])

        tx.save()
        _account_balances_update(tx)
    _invalidate_dashboard_cache(tx.fiscal_year)
    log_audit('create', 'transaction', entity_id=tx.pk,
              details={'type': tx_type, 'amount': str(tx.amount),
                       'source_account': tx.source_account.name if tx.source_account else None,
                       'destination_account': tx.destination_account.name if tx.destination_account else None,
                       'student': tx.student.name if tx.student else None,
                       'fee_month': tx.fee_month}, request=request)

    if tx_type == 'INCOME' and tx.student_id:
        try:
            notify_parents_of_student(
                tx.student_id, 'fee_received',
                f'Payment received for {tx.student.name}',
                f'Amount: ${tx.amount:.2f} — {tx.category or "Fee"}',
                url='/#/parent/fees/' + str(tx.student_id),
            )
        except Exception:
            logger.exception('Failed to notify parents of fee payment')
    return tx
