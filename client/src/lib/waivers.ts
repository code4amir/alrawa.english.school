// Shared waiver helpers — mirror finance/views/base.py::_waiver_expected_amount.
// A waiver only counts when approved AND inside its active window; a
// PERCENTAGE waiver's `value` is the discount %, not the payable amount.

export function isUsableWaiver(w: any, month?: string): boolean {
  if (!w || w.active === false) return false;
  const status = String(w.approvalStatus || w.approval_status || '').toLowerCase();
  if (status && status !== 'approved') return false;
  if (month) {
    const start = w.startsAt || w.starts_at;
    const end = w.endsAt || w.ends_at;
    const startMonth = start ? String(start).slice(0, 7) : null;
    const endMonth = end ? String(end).slice(0, 7) : null;
    if (startMonth && startMonth > month) return false;
    if (endMonth && endMonth < month) return false;
  }
  return true;
}

export function waiverExpectedAmount(waiver: any, baseAmount: number): number {
  if (!waiver) return Number(baseAmount);
  const type = waiver.type || waiver.waiverType;
  const value = Number(waiver.value);
  if (type === 'PERCENTAGE') {
    return Math.round((Number(baseAmount) * (1 - value / 100)) * 100) / 100;
  }
  return value;
}
