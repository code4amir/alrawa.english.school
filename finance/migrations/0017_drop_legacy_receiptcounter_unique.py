# Drop the legacy (fiscal_year, receipt_type) uniqueness on ReceiptCounter.
# It was declared via unique_together in 0001 but 0008 only removed it from
# Django STATE (AlterUniqueTogether, "already gone from DB" assumption) — the
# DB constraint actually persisted, so same-day serials collided. Removed here
# generically (by definition) so prod (which has it) and test DBs (which get it
# from 0001) both work. The new per-date uniqueness is unique_receipt_counter.

from django.db import migrations


def drop_legacy_receiptcounter_unique(apps, schema_editor):
    conn = schema_editor.connection
    with conn.cursor() as c:
        # Constraint names are deterministic per backend; find any unique
        # constraint on the counter table whose columns were fiscal_year,
        # receipt_type (the legacy unique_together) and drop it if present.
        c.execute(
            """
            SELECT conname
            FROM pg_constraint
            WHERE conrelid = 'finance_receiptcounter'::regclass
              AND contype = 'u'
              AND conname NOT IN ('unique_receipt_counter', 'finance_receiptcounter_pkey')
            """
        )
        for (name,) in c.fetchall():
            try:
                c.execute(f'ALTER TABLE finance_receiptcounter DROP CONSTRAINT "{name}"')
                print(f"dropped legacy receiptcounter constraint: {name}")
            except Exception:
                pass


class Migration(migrations.Migration):

    dependencies = [
        ('finance', '0016_remove_receiptcounter_unique_receipt_counter_and_more'),
    ]

    operations = [
        migrations.RunPython(drop_legacy_receiptcounter_unique, migrations.RunPython.noop),
    ]