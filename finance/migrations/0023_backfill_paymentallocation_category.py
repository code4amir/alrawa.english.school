from django.db import migrations, models


def backfill_categories(apps, schema_editor):
    """Label every existing allocation.

    The field was added blank, so all historical rows (including the ones the
    bulk/Excel import path writes) have no label — receipts fell back to one
    lump category line. Prefer the fee schedule's category; fall back to the
    transaction's own category for schedule-less ad-hoc rows.
    """
    with schema_editor.connection.cursor() as cur:
        # Schedule-linked rows take the schedule's category.
        cur.execute(
            '''
            UPDATE finance_paymentallocation pa
               SET category = fs.category
              FROM finance_feeschedule fs
             WHERE pa.fee_schedule_id = fs.id
               AND (pa.category IS NULL OR pa.category = '')
            '''
        )
        # Remaining rows (no schedule) take the transaction's category, minus
        # any multi-value "A, B" string — keep the first label only.
        cur.execute(
            """
            UPDATE finance_paymentallocation pa
               SET category = split_part(t.category, ',', 1)
              FROM finance_transaction t
             WHERE pa.transaction_id = t.id
               AND pa.fee_schedule_id IS NULL
               AND (pa.category IS NULL OR pa.category = '')
               AND t.category IS NOT NULL
               AND t.category <> ''
            """
        )


def noop(apps, schema_editor):
    """Labels are a snapshot; reversing leaves them as-is."""


class Migration(migrations.Migration):

    dependencies = [
        ('finance', '0022_paymentallocation_category'),
    ]

    operations = [
        migrations.RunPython(backfill_categories, noop),
    ]