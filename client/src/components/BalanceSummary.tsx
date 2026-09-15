import { AlertTriangle } from 'lucide-react';

interface BalanceSummaryProps {
  totalIncome: number;
  totalDepositedToBank: number;
  depositRemaining: number;
  voids?: { count: number; amount: number };
  refunds?: { count: number; amount: number };
}

export default function BalanceSummary({ totalIncome, totalDepositedToBank, depositRemaining, voids, refunds }: BalanceSummaryProps) {
  const memoCount = (voids?.count || 0) + (refunds?.count || 0);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <div className="bg-white rounded-xl border border-school-border p-3 sm:p-4">
          <p className="text-[9px] sm:text-[10px] uppercase font-bold tracking-widest text-school-muted mb-1">Income Collected</p>
          <h3 className="text-base sm:text-xl font-serif text-school-primary">৳ {totalIncome.toLocaleString('en-BD')}</h3>
        </div>
        <div className="bg-white rounded-xl border border-school-border p-3 sm:p-4">
          <p className="text-[9px] sm:text-[10px] uppercase font-bold tracking-widest text-school-muted mb-1">Deposited to Bank</p>
          <h3 className="text-base sm:text-xl font-serif text-emerald-600">৳ {totalDepositedToBank.toLocaleString('en-BD')}</h3>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-school-border p-3 sm:p-4">
        <p className="text-[9px] sm:text-[10px] uppercase font-bold tracking-widest text-school-muted mb-1">Undeposited Income</p>
        <h3 className={`text-base sm:text-xl font-serif ${depositRemaining > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
          ৳ {depositRemaining.toLocaleString('en-BD')}
        </h3>
      </div>

      {depositRemaining > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-3 flex items-center gap-3">
          <AlertTriangle size={16} className="text-amber-500 flex-shrink-0" />
          <p className="text-sm text-amber-800 font-medium">
            <strong>৳ {depositRemaining.toLocaleString('en-BD')}</strong> in cash not yet deposited to AL RAWA Bank.
          </p>
        </div>
      )}

      {memoCount > 0 && (
        <p className="text-[11px] text-school-muted px-1">
          Voids: {voids?.count || 0} (৳ {(voids?.amount || 0).toLocaleString('en-BD')}) · Refunds: {refunds?.count || 0} (৳ {(refunds?.amount || 0).toLocaleString('en-BD')}) — memo only
        </p>
      )}
    </div>
  );
}
