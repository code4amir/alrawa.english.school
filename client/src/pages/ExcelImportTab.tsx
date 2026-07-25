import React, { useState, useRef, useEffect, useMemo } from 'react';
import { toast } from '../components/Toast';
import { Upload, Trash2, Edit2, Check, X, Download, Loader } from 'lucide-react';
import { useSchoolStore, api } from '../store';
import { PRIMARY_BANK, CASH_BANK } from '../lib/accounts';
import type { FeeWaiver, FeeSchedule, Student } from '../lib/types';



interface ImportRow {
  _id: number;
  _selected: boolean;
  token: string;
  date: string;
  category: string;
  type: 'income' | 'expense';
  amount: string;
  description: string;
  feeMonth: string;
  className: string;
  roll: string;
  studentName: string;
  studentId: string;
  _errors: string[];
  _fieldErrors: Record<string, string>;
}

function parseExcelDate(val: any): string {
  if (!val) return '';
  if (typeof val === 'number') {
    const d = new Date((val - 25569) * 86400 * 1000);
    return d.toISOString().split('T')[0];
  }
  const str = String(val).trim();
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  return str;
}

function normalizeType(val: any): 'income' | 'expense' {
  const s = String(val || '').trim().toLowerCase();
  if (s === 'income' || s === 'inc' || s === 'i' || s === '1') return 'income';
  return 'expense';
}

function isStudentCategory(cat: string, feeCats: string[]): boolean {
  return feeCats.includes(cat) || cat === 'Other Fee';
}

const MONTH_NAMES: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
  apr: 3, april: 3, may: 4, jun: 5, june: 5,
  jul: 6, july: 6, aug: 7, august: 7, sep: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

function parseFeeMonth(val: any): string {
  if (!val) return '';
  const s = String(val).trim();
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  const parts = s.split(/\s+/);
  const mi = MONTH_NAMES[parts[0].toLowerCase()];
  if (mi === undefined) return '';
  const year = parts[1] ? parseInt(parts[1]) : new Date().getFullYear();
  if (isNaN(year)) return '';
  return `${year}-${String(mi + 1).padStart(2, '0')}`;
}

function validateRow(row: ImportRow, feeCats: string[], feeSchedules: any[], waivers: any[], paidMonths?: Set<string>, usedTokens?: Set<string>): { errors: string[]; fieldErrors: Record<string, string> } {
  const fieldErrors: Record<string, string> = {};
  const errors: string[] = [];
  if (!row.date) { errors.push('Date is required'); fieldErrors.date = 'required'; }
  if (!row.amount || isNaN(parseFloat(row.amount)) || parseFloat(row.amount) <= 0) { errors.push('Amount must be > 0'); fieldErrors.amount = 'must be > 0'; }
  if (!row.category) { errors.push('Category is required'); fieldErrors.category = 'required'; }
  if (row.type === 'income' && !row.feeMonth) { errors.push('Fee Month is required for income'); fieldErrors.feeMonth = 'required'; }
  if (row.token && usedTokens && usedTokens.has(row.token)) {
    errors.push(`Token ${row.token} already exists in ledger`);
    fieldErrors.token = 'duplicate';
  }
  if (row.studentId && row.feeMonth && row.type === 'income' && paidMonths) {
    const key = `${row.studentId}|${row.feeMonth}|${row.category}`;
    if (paidMonths.has(key)) {
      errors.push(`Fee month ${row.feeMonth} already paid for this student in ${row.category}`);
      fieldErrors.feeMonth = 'already paid';
    }
  }
  if (isStudentCategory(row.category, feeCats)) {
    if (!row.roll) { errors.push('Roll required for student fees'); fieldErrors.roll = 'required'; }
    if (row.roll && !row.studentId) { errors.push('Student not found for this Roll'); fieldErrors.roll = 'not found'; }
  }
  if (row.studentId && row.amount && parseFloat(row.amount) > 0) {
    const normalizedCat = row.category.trim().toLowerCase();
    const normalizedClass = (row.className || '').trim().toLowerCase();
    const fs = feeSchedules.find((f: any) => {
      const catMatch = String(f.category || '').trim().toLowerCase() === normalizedCat;
      if (!catMatch) return false;
      if (!f.classId && !f.classRel) return true;
      const fsClassName = (f.classRel?.name || '').trim().toLowerCase();
      return fsClassName === normalizedClass;
    });
    if (fs) {
      const waiver = waivers.find((w: any) => {
        const wStudent = String(w.studentId || w.student || '');
        const wFs = String(w.feeScheduleId || w.feeSchedule || '');
        return wStudent === String(row.studentId) && wFs === String(fs.id) && w.active;
      });
      const expected = waiver ? Number(waiver.value) : Number(fs.amount);
      const actual = parseFloat(String(row.amount).replace(/[,৳$\s]/g, ''));
      if (Math.abs(actual - expected) > 0.01) {
        const msg = waiver ? `should be ${expected} (waiver)` : `should be ${expected}`;
        errors.push(`Amount ${msg}`);
        fieldErrors.amount = msg;
      }
    }
  }
  return { errors, fieldErrors };
}

export default function ExcelImportTab() {
  const { fetchTransactions, fetchFinance, students, fetchStudents, feeSchedules, fetchFeeSchedules, expenseCategories, fetchExpenseCategories } = useSchoolStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editData, setEditData] = useState<Partial<ImportRow>>({});
  const [importing, setImporting] = useState(false);
  const [waivers, setWaivers] = useState<FeeWaiver[]>([]);
  const [paidMonths, setPaidMonths] = useState<Set<string>>(new Set());
  const [usedTokens, setUsedTokens] = useState<Set<string>>(new Set());

  const feeScheduleCategories = useMemo(() => [...new Set(feeSchedules.map((fs: FeeSchedule) => fs.category))], [feeSchedules]);
  const incomeCategories = useMemo(() => [...feeScheduleCategories, 'Other Fee'], [feeScheduleCategories]);
  const [fallbackCats] = useState<string[]>(['Salary', 'Rent', 'Bills', 'Supplies', 'Other Expense']);
  const cats = expenseCategories.length > 0 ? expenseCategories : fallbackCats;

  useEffect(() => {
    fetchExpenseCategories();
    fetchFeeSchedules();
    api.get('/finance/fee-waivers', { params: { active: 'true' } }).then(r => setWaivers(r.data.results || r.data.data || r.data)).catch(() => {});
    api.get('/finance/transactions/', { params: { limit: '9999' } }).then(r => {
      const txns = r.data?.data || r.data?.results || r.data || [];
      const pSet = new Set<string>();
      const tSet = new Set<string>();
      txns.forEach((t: any) => {
        const sid = t.studentId || t.student_id || t.student;
        const fm = t.feeMonth || t.fee_month;
        const cat = t.category;
        if (sid && fm && cat && !t.isCancelled && !t.is_cancelled) {
          pSet.add(`${sid}|${fm}|${cat}`);
        }
        const tok = t.tokenNumber || t.token_number;
        if (tok != null) tSet.add(String(tok));
      });
      setPaidMonths(pSet);
      setUsedTokens(tSet);
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const rollMapRef = React.useRef<Record<string, Student>>({});

  const rollMap = React.useMemo(() => {
    const map: Record<string, Student> = {};
    students.forEach((s: Student) => {
      const key = `${(s.class || '').trim().toLowerCase()}|${(s.roll || '').trim().toLowerCase()}`;
      map[key] = s;
      // Also index by roll alone (roll is globally unique)
      const rollKey = (s.roll || '').trim().toLowerCase();
      if (rollKey) map[`__roll__${rollKey}`] = s;
    });
    return map;
  }, [students]);

  rollMapRef.current = rollMap;

  const resolveStudent = (className: string, roll: string): { studentId: string; studentName: string; resolvedClass: string } => {
    // Try class+roll first
    const key = `${className.trim().toLowerCase()}|${roll.trim().toLowerCase()}`;
    let s = rollMap[key];
    // Fall back to roll alone (roll is globally unique)
    if (!s && roll.trim()) {
      s = rollMap[`__roll__${roll.trim().toLowerCase()}`];
    }
    if (s) return { studentId: s.id, studentName: s.name, resolvedClass: s.class };
    return { studentId: '', studentName: '', resolvedClass: '' };
  };

  // Re-resolve students when the students array updates (e.g. after fetch completes)
  useEffect(() => {
    if (!rows.length || !students.length) return;
    setRows(prev => prev.map(row => {
      if (!row.roll) return row;
      if (row.studentId) return row; // already resolved
      const { studentId, studentName, resolvedClass } = resolveStudent(row.className, row.roll);
      if (!studentId) return row;
      const updated = { ...row, studentId, studentName, className: resolvedClass || row.className };
      const v = validateRow(updated, feeScheduleCategories, feeSchedules, waivers, paidMonths, usedTokens);
      updated._errors = v.errors;
      updated._fieldErrors = v.fieldErrors;
      return updated;
    }));
  }, [students]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Ensure students are loaded
    await fetchStudents();
    // Fetch fee schedules and waivers directly (not from store cache)
    let latestFeeSchedules: any[] = [];
    let latestWaivers: any[] = [];
    try {
      const [fsRes, wRes] = await Promise.all([
        api.get('/finance/fee-schedules/'),
        api.get('/finance/fee-waivers', { params: { active: 'true' } }),
      ]);
      latestFeeSchedules = fsRes.data.results || fsRes.data.data || fsRes.data;
      latestWaivers = wRes.data.results || wRes.data.data || wRes.data;
    } catch { /* fee schedule fetch failed, use cached data */ }
    setWaivers(latestWaivers);
    // Read latest students from store
    const latestStudents = useSchoolStore.getState().students;
    const latestFeeCats = [...new Set(latestFeeSchedules.map((fs: any) => fs.category))];
    // Debug: log import data for troubleshooting
    if (import.meta.env.DEV) console.log('[ExcelImport] Direct fetch:', { feeSchedules: latestFeeSchedules.length, waivers: latestWaivers.length, students: latestStudents.length, feeCats: latestFeeCats, sampleFS: latestFeeSchedules[0] });
    const localMap: Record<string, any> = {};
    latestStudents.forEach((s: any) => {
      const key = `${(s.class || '').trim().toLowerCase()}|${(s.roll || '').trim().toLowerCase()}`;
      localMap[key] = s;
      const rollKey = (s.roll || '').trim().toLowerCase();
      if (rollKey) localMap[`__roll__${rollKey}`] = s;
    });
    const resolve = (className: string, roll: string) => {
      const key = `${className.trim().toLowerCase()}|${roll.trim().toLowerCase()}`;
      let s = localMap[key];
      if (!s && roll.trim()) s = localMap[`__roll__${roll.trim().toLowerCase()}`];
      if (s) return { studentId: s.id, studentName: s.name, resolvedClass: s.class };
      return { studentId: '', studentName: '', resolvedClass: '' };
    };

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const XLSX = await import('xlsx');
        const wb = XLSX.read(evt.target?.result, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { defval: '' });
        if (!data.length) { toast('Excel file is empty', 'error'); return; }

        const parsed: ImportRow[] = data.map((r: any, i) => {
          const className = String(r['Class'] || r['class'] || r['ClassName'] || '').trim();
          const roll = String(r['Roll'] || r['roll'] || r['Roll No'] || r['rollNo'] || r['RollNo'] || r['roll_no'] || '').trim();
          const category = String(r['Category'] || r['category'] || r['Cat'] || '').trim();
          const { studentId, studentName, resolvedClass } = roll ? resolve(className, roll) : { studentId: '', studentName: '', resolvedClass: '' };
          const finalClass = resolvedClass || className;

          const row: ImportRow = {
            _id: i,
            _selected: true,
            token: String(r['Token'] || r['token'] || r['Ref'] || r['ref'] || '').trim(),
            date: parseExcelDate(r['Date'] || r['date']),
            category,
            type: normalizeType(r['Income/Expense'] || r['Type'] || r['type'] || 'expense'),
            amount: String(r['Amount'] || r['amount'] || '0').trim(),
            description: String(r['Description'] || r['description'] || r['desc'] || '').trim(),
            feeMonth: parseFeeMonth(r['Fee Month'] || r['feeMonth'] || r['fee_month'] || r['Month']),
            className: finalClass,
            roll,
            studentName,
            studentId,
            _errors: [],
            _fieldErrors: {},
          };
          const v = validateRow(row, latestFeeCats, latestFeeSchedules, latestWaivers, paidMonths, usedTokens);
          row._errors = v.errors;
          row._fieldErrors = v.fieldErrors;
          return row;
        });

        setRows(parsed);

        const takenTokens = new Set<string>(usedTokens);
        parsed.forEach(r => { if (r.token) takenTokens.add(r.token); });
        let nextToken = 1;
        const assignNext = () => {
          while (takenTokens.has(String(nextToken))) nextToken++;
          const t = String(nextToken);
          takenTokens.add(t);
          nextToken++;
          return t;
        };
        setRows(prev => prev.map(r => {
          if (!r.token) {
            return { ...r, token: assignNext() };
          }
          return r;
        }));

        const studentRows = parsed.filter(r => isStudentCategory(r.category, latestFeeCats));
        const resolved = studentRows.filter(r => r.studentId).length;
        const amountErrors = parsed.filter(r => r._fieldErrors.amount).length;
        const cols = data.length ? Object.keys(data[0] as object).join(', ') : '';
        toast(`Loaded ${parsed.length} rows. ${resolved}/${studentRows.length} students found. ${amountErrors ? `${amountErrors} amount mismatches. ` : ''}Columns: ${cols}`, 'success');
      } catch {
        toast('Failed to parse Excel file', 'error');
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  const toggleRow = (id: number) => {
    setRows(prev => prev.map(r => r._id === id ? { ...r, _selected: !r._selected } : r));
  };

  const toggleAll = () => {
    const allSelected = rows.every(r => r._selected);
    setRows(prev => prev.map(r => ({ ...r, _selected: !allSelected })));
  };

  const deleteRow = (id: number) => {
    setRows(prev => prev.filter(r => r._id !== id));
  };

  const startEdit = (row: ImportRow) => {
    setEditingId(row._id);
    setEditData({ token: row.token, date: row.date, category: row.category, type: row.type, amount: row.amount, description: row.description, feeMonth: row.feeMonth, className: row.className, roll: row.roll });
  };

  const saveEdit = (id: number) => {
    setRows(prev => prev.map(r => {
      if (r._id !== id) return r;
      const updated = { ...r, ...editData, _errors: [] as string[], _fieldErrors: {} as Record<string, string> };
      // Re-resolve student if class/roll changed
      if (editData.className !== undefined || editData.roll !== undefined) {
        const cn = editData.className ?? r.className;
        const rl = editData.roll ?? r.roll;
        const resolved = resolveStudent(cn, rl);
        updated.studentId = resolved.studentId;
        updated.studentName = resolved.studentName;
        updated.className = resolved.resolvedClass || cn;
        updated.roll = rl;
      }
      const v = validateRow(updated, feeScheduleCategories, feeSchedules, waivers, paidMonths, usedTokens);
      updated._errors = v.errors;
      updated._fieldErrors = v.fieldErrors;
      return updated;
    }));
    setEditingId(null);
    setEditData({});
  };

  const cancelEdit = () => { setEditingId(null); setEditData({}); };

  const handleImport = async () => {
    const selected = rows.filter(r => r._selected && r._errors.length === 0);
    if (!selected.length) { toast('No valid rows selected', 'error'); return; }

    setImporting(true);
    try {
      const payload = selected.map(row => ({
        transactionDate: row.date,
        transactionType: row.type === 'income' ? 'INCOME' : 'EXPENSE',
        amount: parseFloat(row.amount),
        sourceAccount: row.type === 'income' ? undefined : PRIMARY_BANK,
        destinationAccount: row.type === 'income' ? CASH_BANK : undefined,
        category: row.category,
        description: row.description || undefined,
        tokenNumber: row.token ? parseInt(row.token) || undefined : undefined,
        feeMonth: row.feeMonth || undefined,
        studentId: row.studentId || undefined,
        className: row.className || undefined,
      }));

      const res = await api.post('/finance/transactions/bulk/', payload);
      
      const skipped = res.data?.skipped || [];
      const created = res.data?.created || res.data || [];
      const createdCount = Array.isArray(created) ? created.length : selected.length;
      if (skipped.length > 0) {
        const msgs = skipped.map((s: any) => s.error).join('; ');
        toast(`Imported ${createdCount}, skipped ${skipped.length}: ${msgs}`, 'info');
      } else {
        toast(`Successfully imported ${createdCount} transactions`, 'success');
      }
      setRows([]);
      fetchTransactions();
      const store = useSchoolStore.getState();
      if (store._fetchedAt) store._fetchedAt['finance'] = 0;
      fetchFinance();
    } catch (err: any) {
      const errorMsg = err.response?.data?.detail || err.response?.data?.error || 'Import failed';
      toast(errorMsg, 'error');
    } finally {
      setImporting(false);
    }
  };

  const selectedCount = rows.filter(r => r._selected).length;
  const validCount = rows.filter(r => r._selected && r._errors.length === 0).length;

  return (
    <div className="space-y-4">
      {/* Upload */}
      <div className="bg-white rounded-xl border border-school-border p-6">
        <h4 className="font-serif text-lg text-school-primary mb-3 flex items-center gap-1.5"><Download size={16} /> Import Transactions from Excel</h4>
        <p className="text-sm text-school-muted mb-2">
          Required columns: <strong>Date, Category, Income/Expense, Amount, Class, Roll</strong>
        </p>
        <p className="text-sm text-school-muted mb-4">
          Optional: <strong>Token (auto-assigned if empty), Fee Month, Description</strong>. Class & Roll are required for student fee categories (Tuition, Admission, etc.).
        </p>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} className="hidden" />
        <button onClick={() => fileRef.current?.click()} className="flex items-center gap-2 px-4 py-2 bg-school-primary text-white rounded-xl text-sm font-bold hover:opacity-90">
          <Upload size={16} /> Choose Excel File
        </button>
      </div>

      {/* Preview */}
      {rows.length > 0 && (
        <div className="bg-white rounded-xl border border-school-border overflow-hidden">
          {/* Toolbar */}
          <div className="flex items-center justify-between p-4 border-b border-school-border">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={rows.length > 0 && rows.every(r => r._selected)} onChange={toggleAll} className="rounded" />
                Select All ({rows.length})
              </label>
              <span className="text-sm text-school-muted">
                {selectedCount} selected · {validCount} valid
              </span>
            </div>
            <button
              onClick={handleImport}
              disabled={importing || validCount === 0}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-bold hover:opacity-90 disabled:opacity-50"
            >
              {importing ? <><Loader size={14} className="animate-spin" /> Importing...</> : <><Download size={14} /> Import {validCount} Rows</>}
            </button>
          </div>

          {/* Table */}
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="w-full text-sm mobile-card-table">
              <thead className="bg-school-primary text-white sticky top-0">
                <tr className="text-xs uppercase">
                  <th className="px-3 py-2 w-10"></th>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Token</th>
                  <th className="px-3 py-2 text-left">Category</th>
                  <th className="px-3 py-2 text-center">Type</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-left">Roll</th>
                  <th className="px-3 py-2 text-left">Class</th>
                  <th className="px-3 py-2 text-left">Student</th>
                  <th className="px-3 py-2 text-left">Fee Month</th>
                  <th className="px-3 py-2 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isEditing = editingId === row._id;
                  const hasError = row._errors.length > 0;
                  const needsStudent = isStudentCategory(row.category, feeScheduleCategories);
                  return (
                    <tr key={row._id} className={`border-t border-school-border/50 ${!row._selected ? 'bg-gray-50 opacity-50' : hasError ? 'bg-red-50' : row._id % 2 ? 'bg-school-paper/30' : ''}`}>
                      <td className="px-3 py-2 text-center" data-label="">
                        <input type="checkbox" checked={row._selected} onChange={() => toggleRow(row._id)} className="rounded" />
                      </td>

                      {isEditing ? (
                        <>
                          <td className="px-2 py-1" data-label="Date"><input type="date" value={editData.date || ''} onChange={e => setEditData({ ...editData, date: e.target.value })} className="w-full px-2 py-1 border border-school-border rounded text-xs" /></td>
                          <td className="px-2 py-1" data-label="Token"><input type="number" value={editData.token || ''} onChange={e => setEditData({ ...editData, token: e.target.value })} placeholder="auto" className="w-16 px-2 py-1 border border-school-border rounded text-xs" /></td>
                          <td className="px-2 py-1" data-label="Category">
                            <select value={editData.category || ''} onChange={e => setEditData({ ...editData, category: e.target.value })} className="w-full px-2 py-1 border border-school-border rounded text-xs">
                              <option value="">—</option>
                              <optgroup label="Income">{incomeCategories.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
                              <optgroup label="Expense">{cats.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>
                            </select>
                          </td>
                          <td className="px-2 py-1 text-center" data-label="Type">
                            <select value={editData.type || 'expense'} onChange={e => setEditData({ ...editData, type: e.target.value as any })} className="px-2 py-1 border border-school-border rounded text-xs">
                              <option value="income">Income</option>
                              <option value="expense">Expense</option>
                            </select>
                          </td>
                          <td className="px-2 py-1" data-label="Amount"><input type="number" value={editData.amount || ''} onChange={e => setEditData({ ...editData, amount: e.target.value })} className="w-20 px-2 py-1 border border-school-border rounded text-xs text-right" /></td>
                          <td className="px-2 py-1" data-label="Roll"><input value={editData.roll || ''} onChange={e => setEditData({ ...editData, roll: e.target.value })} className="w-20 px-2 py-1 border border-school-border rounded text-xs" /></td>
                          <td className="px-2 py-1" data-label="Class"><input value={editData.className || ''} onChange={e => setEditData({ ...editData, className: e.target.value })} className="w-16 px-2 py-1 border border-school-border rounded text-xs" /></td>
                          <td className="px-2 py-1" data-label="Fee Month"><input type="month" value={editData.feeMonth || ''} onChange={e => setEditData({ ...editData, feeMonth: e.target.value })} className="w-full px-2 py-1 border border-school-border rounded text-xs" /></td>
                          <td className="px-2 py-1 text-center" data-label="Actions">
                            <button onClick={() => saveEdit(row._id)} className="p-1 text-green-600 hover:bg-green-50 rounded" aria-label="Save edit"><Check size={14} /></button>
                            <button onClick={cancelEdit} className="p-1 text-red-500 hover:bg-red-50 rounded" aria-label="Cancel edit"><X size={14} /></button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className={`px-3 py-2 text-xs ${row._fieldErrors.date ? 'bg-red-100' : ''}`} data-label="Date">
                            {row.date || <span className="text-red-500">missing</span>}
                            {row._fieldErrors.date && <div className="text-[10px] text-red-600 mt-0.5">{row._fieldErrors.date}</div>}
                          </td>
                          <td className="px-3 py-2 text-xs font-mono" data-label="Token">{row.token || <span className="text-school-muted italic">auto</span>}</td>
                          <td className={`px-3 py-2 text-xs ${row._fieldErrors.category ? 'bg-red-100' : ''}`} data-label="Category">
                            {row.category || <span className="text-red-500">missing</span>}
                            {row._fieldErrors.category && <div className="text-[10px] text-red-600 mt-0.5">{row._fieldErrors.category}</div>}
                          </td>
                          <td className="px-3 py-2 text-center" data-label="Type">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${row.type === 'income' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                              {row.type === 'income' ? 'INCOME' : 'EXPENSE'}
                            </span>
                          </td>
                          <td className={`px-3 py-2 text-right font-medium text-xs ${row._fieldErrors.amount ? 'bg-red-100 text-red-700' : row.type === 'income' ? 'text-green-600' : 'text-red-600'}`} data-label="Amount">
                            {row.amount ? `৳${parseFloat(row.amount).toLocaleString()}` : <span className="text-red-500">0</span>}
                            {row._fieldErrors.amount && <div className="text-[10px] text-red-600 mt-0.5 text-right">{row._fieldErrors.amount}</div>}
                          </td>
                          <td className={`px-3 py-2 text-xs ${row._fieldErrors.roll ? 'bg-red-100' : ''}`} data-label="Roll">
                            {row.roll || '—'}
                            {row._fieldErrors.roll && <div className="text-[10px] text-red-600 mt-0.5">{row._fieldErrors.roll}</div>}
                          </td>
                          <td className="px-3 py-2 text-xs" data-label="Class">{row.type === 'income' ? (row.className || '—') : '—'}</td>
                          <td className="px-3 py-2 text-xs font-medium" data-label="Student">{row.type === 'income' ? (row.studentName || (needsStudent && row.roll ? <span className="text-red-500">not found</span> : '—')) : '—'}</td>
                          <td className={`px-3 py-2 text-xs ${row._fieldErrors.feeMonth ? 'bg-red-100' : ''}`} data-label="Fee Month">
                            {row.feeMonth || '—'}
                            {row._fieldErrors.feeMonth && <div className="text-[10px] text-red-600 mt-0.5">{row._fieldErrors.feeMonth}</div>}
                          </td>
                          <td className="px-3 py-2 text-center" data-label="Actions">
                            <button onClick={() => startEdit(row)} className="p-1 text-blue-500 hover:bg-blue-50 rounded" aria-label="Edit row"><Edit2 size={14} /></button>
                            <button onClick={() => deleteRow(row._id)} className="p-1 text-red-500 hover:bg-red-50 rounded" aria-label="Delete row"><Trash2 size={14} /></button>
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
