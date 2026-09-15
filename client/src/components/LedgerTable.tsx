import { memo } from 'react';

interface LedgerEntry {
  id: string;
  transactionDate: string;
  transactionType: string;
  description: string;
  debit: number;
  credit: number;
  runningBalance: number;
  isCancelled?: boolean;
  reversalOfId?: string | null;
  receiptSequence?: number;
  fiscalYear?: string;
}

interface LedgerTableProps {
  entries: LedgerEntry[];
  accountLabel: string;
  openingBalance: number;
  closingBalance: number;
  totalDebits: number;
  totalCredits: number;
  loading?: boolean;
  total?: number;
  page?: number;
  totalPages?: number;
  canCancel?: boolean;
  onCancel?: (id: string) => void;
  fmt?: (n: number) => string;
}

const defaultFmt = (n: number) => n.toLocaleString('en-BD');

const LedgerRow = memo(function LedgerRow({ entry, canCancel, onCancel, fmt }: { entry: LedgerEntry; canCancel: boolean; onCancel?: (id: string) => void; fmt: (n: number) => string }) {
  return (
    <tr className={`hover:bg-school-paper/30 text-xs ${entry.isCancelled || entry.reversalOfId ? 'line-through opacity-50 bg-rose-50/30' : ''}`}>
      <td className="px-4 py-2.5 whitespace-nowrap font-mono font-bold">
        {new Date(entry.transactionDate).toLocaleDateString()}
      </td>
      <td className="px-4 py-2.5">
        <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-black uppercase ${entry.transactionType === 'INCOME' ? 'bg-emerald-50 text-emerald-700' : entry.transactionType === 'EXPENSE' ? 'bg-rose-50 text-rose-700' : 'bg-blue-50 text-blue-700'}`}>
          {entry.transactionType === 'INTERNAL_TRANSFER' ? 'Transfer' : entry.transactionType}
        </span>
      </td>
      <td className="px-4 py-2.5 max-w-[200px] truncate text-school-muted">
        {entry.description || '—'}
      </td>
      <td className="px-4 py-2.5 text-right font-bold text-emerald-600">
        {entry.debit ? fmt(entry.debit) : '—'}
      </td>
      <td className="px-4 py-2.5 text-right font-bold text-rose-600">
        {entry.credit ? fmt(entry.credit) : '—'}
      </td>
      <td className="px-4 py-2.5 text-right font-bold font-mono">
        {fmt(entry.runningBalance)}
      </td>
      {canCancel && (
        <td className="px-4 py-2.5 text-center">
          {!entry.isCancelled && !entry.reversalOfId && onCancel && (
            <button onClick={() => onCancel(entry.id)} title="Cancel transaction" className="p-1 rounded-lg text-school-muted hover:text-red-600 hover:bg-red-50 transition-all">
              ✕
            </button>
          )}
        </td>
      )}
    </tr>
  );
});

export default function LedgerTable({
  entries,
  accountLabel,
  openingBalance,
  closingBalance,
  totalDebits,
  totalCredits,
  loading = false,
  total = 0,
  page = 1,
  totalPages = 1,
  canCancel = false,
  onCancel,
  fmt = defaultFmt,
}: LedgerTableProps) {
  return (
    <div className="bg-white rounded-xl border border-school-border overflow-hidden">
      <div className="px-5 py-4 border-b border-school-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h4 className="font-serif text-sm text-school-primary">{accountLabel} Ledger</h4>
          {!loading && <span className="text-[10px] text-school-muted">({total} rows{totalPages > 1 ? `, p.${page}/${totalPages}` : ''})</span>}
          {loading && <span className="text-[10px] text-school-muted animate-pulse">Loading...</span>}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-school-paper/50 text-[10px] uppercase tracking-widest text-school-muted font-bold">
            <tr>
              <th className="px-4 py-3 text-left w-[110px]">Date</th>
              <th className="px-4 py-3 text-left w-[60px]">Type</th>
              <th className="px-4 py-3 text-left">Description</th>
              <th className="px-4 py-3 text-right w-[100px]">Debit (৳)</th>
              <th className="px-4 py-3 text-right w-[100px]">Credit (৳)</th>
              <th className="px-4 py-3 text-right w-[110px]">Balance (৳)</th>
              {canCancel && <th className="px-4 py-3 text-center w-10"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-school-border/50">
            <tr className="bg-school-paper/30 text-xs font-bold text-school-muted">
              <td className="px-4 py-2" colSpan={3}>Opening Balance</td>
              <td className="px-4 py-2 text-right" colSpan={canCancel ? 4 : 3}>{fmt(openingBalance)}</td>
            </tr>
            {loading ? (
              <tr>
                <td colSpan={canCancel ? 7 : 6} className="px-4 py-12 text-center text-sm text-school-muted italic">
                  Loading entries...
                </td>
              </tr>
            ) : entries.length > 0 ? (
              entries.map((entry) => (
                <LedgerRow key={entry.id} entry={entry} canCancel={canCancel} onCancel={onCancel} fmt={fmt} />
              ))
            ) : (
              <tr>
                <td colSpan={canCancel ? 7 : 6} className="px-4 py-12 text-center text-sm text-school-muted italic">
                  No entries yet.
                </td>
              </tr>
            )}
            <tr className="bg-school-primary/5 text-xs font-bold border-t-2 border-school-primary/20">
              <td className="px-4 py-2.5" colSpan={3}>
                <span className="text-school-muted font-normal">Total Dr:</span> {fmt(totalDebits)}
                <span className="mx-2 text-school-muted">│</span>
                <span className="text-school-muted font-normal">Total Cr:</span> {fmt(totalCredits)}
              </td>
              <td className="px-4 py-2.5 text-right font-bold text-school-primary" colSpan={canCancel ? 4 : 3}>
                {fmt(closingBalance)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
