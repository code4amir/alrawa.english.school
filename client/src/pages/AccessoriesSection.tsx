import { useState, useEffect, useRef, useMemo } from 'react';
import { useSchoolStore, useAuthStore } from '../store';
import { api } from '../store';
import { toast } from '../components/Toast';
import { Settings, RefreshCw, Plus, Pencil, Trash2, Printer, Download, BookOpen, Check, X, ChevronDown } from 'lucide-react';
import DeleteConfirmModal from '../components/DeleteConfirmModal';
import FeeStructureDocument from '../components/FeeStructureDocument';
import BookListDocument from '../components/BookListDocument';
import EditSchoolInfoModal from '../components/EditSchoolInfoModal';
import { useReactToPrint } from 'react-to-print';

function isHifz(cat: string) { return cat.toLowerCase().includes('hifz'); }

function feeOrder(cat: string): number {
  const lower = cat.trim().toLowerCase();
  if (lower.includes('admission') && !lower.includes('hifz')) return 1;
  if (lower.includes('tuition') && !lower.includes('hifz')) return 2;
  if (lower.includes('books')) return 3;
  if (lower.includes('copy')) return 4;
  if (lower.includes('station')) return 5;
  if (lower.includes('accessor')) return 6;
  if (lower.includes('hifz') && lower.includes('admission')) return 1;
  if (lower.includes('hifz') && lower.includes('tuition')) return 2;
  return 99;
}

function fmt(n: number) { return n.toLocaleString('en-BD'); }

const EMOJIS = ['👶', '🌸', '📚', '📖', '📘', '📗', '📕', '🎒', '🔬', '🌍', '⚡', '🎨', '🎵', '🏅'];

const AccessoriesSection = () => {
  useEffect(() => { document.title = 'Fees & Books - AL RAWA English School'; }, []);
  const { classes, books, feeSchedules, settings, loading, fetchClasses, fetchBooks, fetchSettings, fetchFeeSchedules } = useSchoolStore();
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'admin' || role === 'accountant';
  // Teachers & monitors can manage the book list (teachers take ID-card photos too);
  // fee editing stays admin/accountant-only.
  const canEditBooks = isAdmin || role === 'teacher' || role === 'monitor';

  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const [editFee, setEditFee] = useState<{ category: string; amount: string } | null>(null);
  const [editBook, setEditBook] = useState<{ id: string; name: string; sell: string } | null>(null);
  const [newBook, setNewBook] = useState(false);
  const [newBookData, setNewBookData] = useState({ name: '', sell: '' });
  const [refreshing, setRefreshing] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [feeOpen, setFeeOpen] = useState(true);
  const [booksOpen, setBooksOpen] = useState(true);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchBooks(), fetchFeeSchedules(), fetchSettings()]);
    setRefreshing(false);
  };
  const feeDocRef = useRef<HTMLDivElement>(null);
  const bookDocRef = useRef<HTMLDivElement>(null);

  useEffect(() => { 
    fetchClasses(); 
    fetchBooks(); 
    fetchSettings(); 
    fetchFeeSchedules(); 
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sorted = [...classes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const selectedClass = sorted.find(c => c.id === selectedClassId);

  const { academicFees, hifzFees } = useMemo(() => {
    const acad: { category: string; amount: number }[] = [];
    const hifz: { category: string; amount: number }[] = [];
    const seen = new Set<string>();
    for (const fs of feeSchedules) {
      if (fs.classId && fs.classId !== selectedClassId) continue;
      if (seen.has(fs.category)) continue;
      seen.add(fs.category);
      const item = { category: fs.category, amount: Number(fs.amount) };
      if (isHifz(fs.category)) {
        hifz.push(item);
      } else {
        acad.push(item);
      }
    }
    acad.sort((a, b) => feeOrder(a.category) - feeOrder(b.category));
    hifz.sort((a, b) => feeOrder(a.category) - feeOrder(b.category));
    return { academicFees: acad, hifzFees: hifz };
  }, [feeSchedules, selectedClassId]);

  const acadTotal = academicFees.reduce((s, f) => s + f.amount, 0);
  const hifzTotal = hifzFees.reduce((s, f) => s + f.amount, 0);
  const classBooks = books.filter((b: any) => b.classId === selectedClassId);
  const bookTotal = classBooks.reduce((s: number, b: any) => s + Number(b.sell || 0), 0);

  const handlePrintFee = useReactToPrint({ contentRef: feeDocRef, documentTitle: `${selectedClass?.name || 'Class'}_Fee_Structure` });

  const handlePrintBook = useReactToPrint({ contentRef: bookDocRef, documentTitle: `${selectedClass?.name || 'Class'}_Book_List` });

  const handlePdfBook = async () => {
    if (!selectedClass) return;
    try {
      const html2pdf = (await import('html2pdf.js')).default;
      const element = bookDocRef.current;
      if (!element) return;
      html2pdf().set({
        margin: [10, 10, 10, 10],
        filename: `${selectedClass.name}_Book_List.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      }).from(element).save();
    } catch {
      toast('PDF generation failed', 'error');
    }
  };

  const handlePdfFee = async () => {
    if (!selectedClass) return;
    try {
      const html2pdf = (await import('html2pdf.js')).default;
      const element = feeDocRef.current;
      if (!element) return;
      html2pdf().set({
        margin: [10, 10, 10, 10],
        filename: `${selectedClass.name}_Fee_Structure.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      }).from(element).save();
    } catch {
      toast('PDF generation failed', 'error');
    }
  };

  const handleUpdateFee = async (category: string) => {
    if (!editFee || !selectedClassId) return;
    try {
      const existing = feeSchedules.find((fs: any) => fs.category === category && (!fs.classId || fs.classId === selectedClassId));
      const amount = Number(editFee.amount) || 0;
      if (existing) {
        await api.put(`/finance/fee-schedules/${existing.id}/`, { amount });
        toast('Updated ✓', 'success');
        fetchFeeSchedules(true);
      } else {
        const activeYear = useSchoolStore.getState().academicYears.find((y: any) => y.isActive);
        await api.post('/finance/fee-schedules/', { academicYearId: activeYear?.id, classId: selectedClassId, category, amount, frequency: 'YEARLY' });
      }
      toast('Fee updated ✓', 'success');
      setEditFee(null);
      fetchFeeSchedules(true);
    } catch {
      toast('Failed to update fee', 'error');
    }
  };

  const handleUpdateBook = async (id: string) => {
    if (!editBook) return;
    try {
      await api.put(`/books/${id}/`, { name: editBook.name, mrp: Number(editBook.sell) || 0, discounted: Number(editBook.sell) || 0, sell: Number(editBook.sell) || 0 });
      toast('Book updated', 'success');
    } catch { toast('Failed to update', 'error'); }
    setEditBook(null);
    fetchBooks(undefined, true);
    };

    const handleAddBook = async () => {
    if (!newBookData.name.trim()) return toast('Book name required', 'error');
    try {
      const price = Number(newBookData.sell) || 0;
      await api.post('/books/', { name: newBookData.name.trim(), mrp: price, discounted: price, sell: price, classId: selectedClassId });
      toast('Book added ✓', 'success');
      setNewBook(false);
      setNewBookData({ name: '', sell: '' });
      fetchBooks(undefined, true);
    } catch {
      toast('Failed to add book', 'error');
    }
    };

    const confirmDelete = async () => {
    if (!deleteId) return;
    setDeleteLoading(true);
    try {
      await api.delete(`/books/${deleteId}/`);
      toast('Book deleted', 'success');
      setDeleteId(null);
      fetchBooks(undefined, true);
    } catch {
      toast('Failed to delete book', 'error');
    } finally {
      setDeleteLoading(false);
    }
    };

  return (
    <div className="space-y-4">
      <EditSchoolInfoModal open={showSettings} onClose={() => setShowSettings(false)} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-serif text-lg text-school-primary">Fees & Books</h3>
          <p className="text-xs text-school-muted">Fee structure & book list</p>
        </div>
        <div className="flex gap-2">
          {isAdmin && (
            <button onClick={() => setShowSettings(true)} className="flex items-center gap-1 px-3 py-1.5 border border-school-border rounded-lg text-xs hover:bg-school-paper">
              <Settings size={12} /> School Info
            </button>
          )}
          <button onClick={handleRefresh} disabled={refreshing} className="flex items-center gap-1 px-3 py-1.5 border border-school-border rounded-lg text-xs hover:bg-school-paper disabled:opacity-50">
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* Class Chip Strip */}
      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
        {sorted.map((cls, i) => (
          <button
            key={cls.id}
            onClick={() => setSelectedClassId(cls.id)}
            className={`flex flex-col items-center gap-0.5 px-4 py-3 rounded-2xl border-2 text-center transition-all flex-shrink-0 min-w-[80px] ${
              selectedClassId === cls.id
                ? 'border-school-accent bg-school-accent/5 shadow-sm'
                : 'border-school-border bg-white hover:border-school-muted'
            }`}
          >
            <span className="text-lg">{EMOJIS[i % EMOJIS.length]}</span>
            <span className={`text-xs font-bold ${selectedClassId === cls.id ? 'text-school-accent' : 'text-school-primary'}`}>{cls.name}</span>
            <span className="text-[10px] text-school-muted">{cls.bookCount || 0} books</span>
          </button>
        ))}
      </div>

      {!selectedClass ? (
        <div className="text-center py-16 text-school-muted">
          <BookOpen size={48} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">Select a class to view fee structure and books</p>
        </div>
      ) : (
        <>
          {/* Fee Structure Card */}
          <div className="bg-white rounded-2xl border border-school-border overflow-hidden">
            <div onClick={() => setFeeOpen(!feeOpen)} className="flex items-center justify-between w-full p-4 border-b border-school-border text-left cursor-pointer" role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFeeOpen(!feeOpen); } }}>
              <h4 className="font-bold text-sm text-school-primary">Fee Structure — {selectedClass.name}</h4>
              <div className="flex items-center gap-1.5">
                <div className="flex gap-1.5 no-print" onClick={e => e.stopPropagation()}>
                  <button onClick={handlePrintFee} className="flex items-center gap-1 px-3 py-1.5 bg-school-paper rounded-lg text-xs hover:bg-school-border/50"><Printer size={12} /> Print</button>
                  <button onClick={handlePdfFee} className="flex items-center gap-1 px-3 py-1.5 bg-school-paper rounded-lg text-xs hover:bg-school-border/50"><Download size={12} /> PDF</button>
                </div>
                <ChevronDown size={16} className={`text-school-muted transition-transform ${feeOpen ? '' : '-rotate-90'}`} />
              </div>
            </div>

            {/* Doc for print/pdf (hidden visually, used by ref) */}
            <div className="hidden">
              <FeeStructureDocument ref={feeDocRef} className={selectedClass.name} academicFees={academicFees} hifzFees={hifzFees} settings={settings} />
            </div>

            {feeOpen && (
            <div className="p-4">
              {/* Academic Fees */}
              <div className="mb-4">
                <h5 className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider mb-3 inline-block bg-school-primary text-white">Academic Section</h5>
                {academicFees.map(f => (
                  <div key={f.category} className="flex items-center justify-between py-1.5 border-b border-dotted border-school-border/50 group">
                    <span className="text-sm text-school-primary">{f.category}</span>
                    <div className="flex items-center gap-2">
                      {editFee?.category === f.category ? (
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-school-muted">৳</span>
                          <input type="number" value={editFee.amount} onChange={e => setEditFee({ ...editFee, amount: e.target.value })} className="w-24 px-2 py-1 border border-school-accent rounded-lg text-sm text-right font-mono" autoFocus />
                          <button onClick={() => handleUpdateFee(f.category)} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded" aria-label="Save"><Check size={14} /></button>
                          <button onClick={() => setEditFee(null)} className="p-1 text-red-500 hover:bg-red-50 rounded" aria-label="Cancel"><X size={14} /></button>
                        </div>
                      ) : (
                        <>
                          <span className="text-sm font-bold font-mono text-school-primary">৳ {fmt(f.amount)}</span>
                          {isAdmin && (
                            <button onClick={() => setEditFee({ category: f.category, amount: String(f.amount) })} className="p-1 text-school-muted opacity-0 group-hover:opacity-100 hover:bg-school-paper rounded transition-all">
                              <Pencil size={12} />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between py-2 mt-1 font-bold border-t-2 border-school-primary">
                  <span className="text-sm">Total Academic</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono">৳ {fmt(acadTotal)}</span>
                    {isAdmin && <span className="w-[20px]" />}
                  </div>
                </div>
              </div>

              {/* Hifz Fees */}
              {hifzFees.some(f => f.amount > 0) || isAdmin ? (
                <div>
                  <h5 className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider mb-3 inline-block bg-school-primary text-white">Hifz Section</h5>
                  {hifzFees.map(f => (
                    <div key={f.category} className="flex items-center justify-between py-1.5 border-b border-dotted border-school-border/50 group">
                      <span className="text-sm text-school-primary">{f.category}</span>
                      <div className="flex items-center gap-2">
                        {editFee?.category === f.category ? (
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-school-muted">৳</span>
                            <input type="number" value={editFee.amount} onChange={e => setEditFee({ ...editFee, amount: e.target.value })} className="w-24 px-2 py-1 border border-school-accent rounded-lg text-sm text-right font-mono" autoFocus />
                            <button onClick={() => handleUpdateFee(f.category)} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded" aria-label="Save"><Check size={14} /></button>
                            <button onClick={() => setEditFee(null)} className="p-1 text-red-500 hover:bg-red-50 rounded" aria-label="Cancel"><X size={14} /></button>
                          </div>
                        ) : (
                          <>
                            <span className="text-sm font-bold font-mono text-school-primary">৳ {fmt(f.amount)}</span>
                            {isAdmin && (
                              <button onClick={() => setEditFee({ category: f.category, amount: String(f.amount) })} className="p-1 text-school-muted opacity-0 group-hover:opacity-100 hover:bg-school-paper rounded transition-all" aria-label="Edit">
                                <Pencil size={12} />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center justify-between py-2 mt-1 font-bold border-t-2 border-school-primary">
                    <span className="text-sm">Total Hifz</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono">৳ {fmt(hifzTotal)}</span>
                      {isAdmin && <span className="w-[20px]" />}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
            )}
          </div>

          {/* Book List Card */}
          <div className="bg-white rounded-2xl border border-school-border overflow-hidden">
            <div onClick={() => setBooksOpen(!booksOpen)} className="flex items-center justify-between w-full p-4 border-b border-school-border text-left cursor-pointer" role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setBooksOpen(!booksOpen); } }}>
              <h4 className="font-bold text-sm text-school-primary">Books — {selectedClass.name}</h4>
              <div className="flex items-center gap-1.5">
                <div className="flex gap-1.5 no-print" onClick={e => e.stopPropagation()}>
                  <button onClick={handlePrintBook} className="flex items-center gap-1 px-3 py-1.5 bg-school-paper rounded-lg text-xs hover:bg-school-border/50"><Printer size={12} /> Print</button>
                  <button onClick={handlePdfBook} className="flex items-center gap-1 px-3 py-1.5 bg-school-paper rounded-lg text-xs hover:bg-school-border/50"><Download size={12} /> PDF</button>
                  {canEditBooks && (
                    <button onClick={() => { setNewBook(true); setNewBookData({ name: '', sell: '' }); }} className="flex items-center gap-1 px-3 py-1.5 bg-school-primary text-white rounded-lg text-xs font-bold hover:opacity-90">
                      <Plus size={12} /> Add Book
                    </button>
                  )}
                </div>
                <ChevronDown size={16} className={`text-school-muted transition-transform ${booksOpen ? '' : '-rotate-90'}`} />
              </div>
            </div>

            {/* Doc for print/pdf (hidden visually, used by ref) */}
            <div className="hidden">
              <BookListDocument ref={bookDocRef} className={selectedClass.name} books={classBooks} settings={settings} />
            </div>

            {booksOpen && (
            <>
            {loading.books ? (
              <div className="p-6 space-y-3">
                {[1,2,3].map(i => <div key={i} className="h-8 bg-school-paper rounded-lg animate-pulse" />)}
              </div>
            ) : classBooks.length === 0 && !newBook ? (
              <div className="text-center py-8 text-school-muted text-sm">No books in this class yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-school-paper text-school-muted text-[10px] uppercase tracking-wider">
                      <th className="px-4 py-2.5 text-left w-10">#</th>
                      <th className="px-4 py-2.5 text-left">Book Name</th>
                      <th className="px-4 py-2.5 text-right w-28">Price</th>
                      {isAdmin && <th className="px-4 py-2.5 text-center w-20">Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {newBook && (
                      <tr className="border-t border-school-border bg-amber-50/30">
                        <td className="px-4 py-2 text-school-muted">—</td>
                        <td className="px-4 py-2">
                          <input type="text" value={newBookData.name} onChange={e => setNewBookData({ ...newBookData, name: e.target.value })} placeholder="Book name" className="w-full px-2 py-1 border border-school-border rounded-lg text-sm" autoFocus />
                        </td>
                        <td className="px-4 py-2">
                          <input type="number" value={newBookData.sell} onChange={e => setNewBookData({ ...newBookData, sell: e.target.value })} placeholder="0" className="w-full px-2 py-1 border border-school-border rounded-lg text-sm text-right" />
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex gap-1 justify-center">
                            <button onClick={handleAddBook} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded" aria-label="Add book"><Check size={14} /></button>
                            <button onClick={() => setNewBook(false)} className="p-1 text-red-500 hover:bg-red-50 rounded" aria-label="Cancel"><X size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    )}
                    {classBooks.map((b: any, i: number) => {
                      const isEditing = editBook?.id === b.id;
                      return (
                      <tr key={b.id} className="border-t border-school-border/50 hover:bg-school-paper/30 group">
                        <td className="px-4 py-2.5 text-school-muted text-xs">{i + 1}</td>
                        <td className="px-4 py-2.5">
                          {isEditing ? (
                            <input type="text" value={editBook!.name} onChange={e => setEditBook(prev => prev ? { ...prev, name: e.target.value } : prev)} className="w-full px-2 py-1 border border-school-accent rounded-lg text-sm" autoFocus />
                          ) : (
                            <span className="font-medium">{b.name}</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {isEditing ? (
                            <input type="number" value={editBook!.sell} onChange={e => setEditBook(prev => prev ? { ...prev, sell: e.target.value } : prev)} className="w-24 px-2 py-1 border border-school-accent rounded-lg text-sm text-right" />
                          ) : (
                            <span className="font-bold font-mono">৳ {fmt(Number(b.sell))}</span>
                          )}
                        </td>
                        {canEditBooks && (
                          <td className="px-4 py-2.5 text-center">
                            {isEditing ? (
                              <div className="flex gap-1 justify-center">
                                <button onClick={() => handleUpdateBook(b.id)} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded" aria-label="Save"><Check size={14} /></button>
                                <button onClick={() => setEditBook(null)} className="p-1 text-red-500 hover:bg-red-50 rounded" aria-label="Cancel"><X size={14} /></button>
                              </div>
                            ) : (
                              <div className="flex gap-1 justify-center opacity-0 group-hover:opacity-100 transition-all">
                                <button onClick={() => setEditBook({ id: b.id, name: b.name, sell: String(Number(b.sell)) })} className="p-1 text-blue-500 hover:bg-blue-50 rounded" aria-label="Edit"><Pencil size={12} /></button>
                                <button onClick={() => setDeleteId(b.id)} className="p-1 text-red-400 hover:bg-red-50 rounded" aria-label="Delete"><Trash2 size={12} /></button>
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-school-primary bg-school-paper font-bold">
                      <td colSpan={2} className="px-4 py-2.5 text-xs uppercase tracking-wider">Total</td>
                      <td className="px-4 py-2.5 text-right font-mono">৳ {fmt(bookTotal)}</td>
                      {isAdmin && <td></td>}
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            </>
            )}
          </div>
        </>
      )}

      <DeleteConfirmModal open={!!deleteId} title="Delete Book" message="Permanently delete this book?" onConfirm={confirmDelete} onCancel={() => setDeleteId(null)} loading={deleteLoading} />
    </div>
  );
};

export default AccessoriesSection;
