import { useState, useEffect } from 'react';
import { useSchoolStore, useAuthStore } from '../../store';
import { api } from '../../store';
import { toast } from '../../components/Toast';
import CameraModal from '../../components/CameraModal';
import ImportModal from '../../components/ImportModal';
import { CardSkeleton } from '../../components/Skeleton';
import { RefreshCw, Mail, Download, Upload, Camera, Pencil, Trash2, Check, Building2 } from 'lucide-react';
import { contactLinks } from '../../lib/contacts';
import DeleteConfirmModal from '../../components/DeleteConfirmModal';
import { API_URL } from '../../lib/config';
import { useNativeCamera } from '../../hooks/useNativeCamera';

let _jsPDF: any = null;
async function loadJsPDF() {
  if (!_jsPDF) { _jsPDF = (await import('jspdf')).default; }
  return _jsPDF;
}

export default function StaffSection() {
  const { staff, fetchStaff, loading } = useSchoolStore();
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'admin';

  const [showCamera, setShowCamera] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddNew, setShowAddNew] = useState(false);
  const [search, setSearch] = useState('');

  const [photo, setPhoto] = useState<string | null>(null);
  const [form, setForm] = useState({ role: '', name: '', email: '', contact: '' });
  const { openNativeCamera, nativeInput } = useNativeCamera((d) => {
    if (d) setPhoto(d);
    setShowCamera(false);
  });

  useEffect(() => { document.title = 'Staff - AL RAWA English School'; }, []);
  useEffect(() => { 
    if (staff.length === 0) fetchStaff(); 
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = staff.filter((s: any) => {
    if (search && !s.name.toLowerCase().includes(search.toLowerCase()) && !(s.role || '').toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const resetForm = () => {
    setForm({ role: '', name: '', email: '', contact: '' });
    setPhoto(null);
    setEditingId(null);
    setShowAddNew(false);
  };

  const handleEdit = (s: any) => {
    setForm({ role: s.role || '', name: s.name, email: s.email || '', contact: s.contact || '' });
    setPhoto(s.photoUrl ? (s.photoUrl.startsWith('http') ? s.photoUrl : `${API_URL.replace('/api', '')}${s.photoUrl}`) : (s.hasPhoto ? `${API_URL}/staff/${s.id}/photo/` : null));
    setEditingId(s.id);
  };

  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!form.name.trim()) return toast('Enter staff name', 'error');
    if (!form.role.trim()) return toast('Enter role/designation', 'error');

    const body = { ...form, photo: photo || undefined };

    try {
      setSubmitting(true);
      if (editingId) {
        await api.put(`/staff/${editingId}/`, body);
      } else {
        await api.post('/staff/', body);
      }
      toast(editingId ? 'Staff updated ✓' : 'Staff added ✓', 'success');
      resetForm();
      fetchStaff();
    } catch (e: any) {
      toast(e.response?.data?.error || e.message || 'Error', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const confirmDelete = async () => {
    if (!deleteId) return;
    const idToRestore = deleteId;
    setDeleteLoading(true);
    try {
      await api.delete(`/staff/${deleteId}/`);
      toast('Staff deleted', '', { label: 'Undo', onClick: async () => {
        try {
          await api.post(`/staff/${idToRestore}/restore/`);
          toast('Staff restored ✓', 'success');
          fetchStaff(undefined, true);
        } catch { toast('Could not undo', 'error'); }
      }});
    } catch (e: any) { toast(e.response?.data?.error || e.message || 'Error', 'error'); }
    setDeleteId(null);
    setDeleteLoading(false);
    fetchStaff(undefined, true);
  };

  const inputCls = 'w-full px-3 py-2 border border-school-border rounded-xl text-sm focus:outline-none focus:border-school-accent';

  const renderEditCard = (isNew: boolean) => (
    <div className={`p-4 rounded-2xl border-2 transition-all ${isNew ? 'border-violet-400 bg-violet-50/50' : 'border-blue-400 bg-blue-50/50'}`} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}>
      <div className="flex justify-center mb-3">
        <button onClick={() => { if (!openNativeCamera()) setShowCamera(true); }} className="relative group" aria-label="Take photo">
          {photo ? (
            <img src={photo} alt="" className="w-20 h-20 rounded-full object-cover border-2 border-white shadow-md" />
          ) : (
            <div className="w-20 h-20 rounded-full bg-indigo-600 text-white flex items-center justify-center"><Building2 size={32} className="text-white" /></div>
          )}
          <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <Camera size={20} className="text-white" />
          </div>
        </button>
      </div>
      <div>
        <label className="text-xs font-bold text-school-muted mb-1 block">Role / Designation</label>
        <input type="text" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="e.g. Peon, Guard" className={inputCls} />
      </div>
      <div className="mt-3">
        <label className="text-xs font-bold text-school-muted mb-1 block">Full Name</label>
        <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Staff member's full name" className={inputCls} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
        <div>
          <label className="text-xs font-bold text-school-muted mb-1 block">Email <span className="font-normal opacity-60">(optional)</span></label>
          <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="staff@school.com" className={inputCls} />
        </div>
        <div>
          <label className="text-xs font-bold text-school-muted mb-1 block">Contact</label>
          <input type="tel" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} placeholder="01XXXXXXXXX" className={inputCls} />
        </div>
      </div>
      <div className="flex gap-2 mt-3">
        <button onClick={handleSubmit} disabled={submitting} className={`flex-1 py-2 text-white rounded-xl text-sm font-bold hover:opacity-90 flex items-center justify-center gap-1.5 disabled:opacity-50 ${isNew ? 'bg-violet-600' : 'bg-blue-600'}`}>
          {isNew ? '+ Add Staff' : <>{submitting ? 'Saving...' : <><Check size={14} /> Save</>}</>}
        </button>
        <button onClick={resetForm} className="px-4 py-2 border border-school-border rounded-xl text-sm hover:bg-white">Cancel</button>
      </div>
    </div>
  );

  const renderViewCard = (s: any) => (
    <div className="bg-white p-4 rounded-2xl border border-school-border card-shadow text-center">
      <div className="flex flex-col items-center gap-2">
        {s.photoUrl ? (
          <img src={s.photoUrl} alt="" className="w-14 h-14 rounded-full object-cover border-2 border-school-border shadow-sm" />
        ) : s.hasPhoto ? (
          <img src={`${API_URL}/staff/${s.id}/photo/`} alt="" className="w-14 h-14 rounded-full object-cover border-2 border-school-border shadow-sm" />
        ) : (
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-700 text-white flex items-center justify-center shadow-sm"><Building2 size={24} className="text-white" /></div>
        )}
        <div>
          <div className="font-bold text-sm text-school-primary">{s.name}</div>
          <div className="text-xs text-indigo-600 font-medium">{s.role}</div>
        </div>
      </div>
      <div className="mt-2 space-y-0.5">
        {s.email && <div className="text-xs flex items-center justify-center gap-1"><Mail size={11} className="text-school-muted" /> {s.email}</div>}
        {s.contact && <div className="text-xs">{contactLinks(s.contact)}</div>}
      </div>
      {isAdmin && (
        <div className="flex gap-2 mt-3 pt-3 border-t border-school-border">
          <button onClick={() => handleEdit(s)} className="flex-1 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs font-medium hover:bg-blue-100 flex items-center justify-center gap-1"><Pencil size={14} /> Edit</button>
          <button onClick={() => setDeleteId(s.id)} className="flex-1 py-1.5 bg-red-50 text-red-500 rounded-lg text-xs font-medium hover:bg-red-100 flex items-center justify-center gap-1"><Trash2 size={14} /> Delete</button>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {nativeInput}
      <CameraModal open={showCamera} onClose={() => setShowCamera(false)} onCapture={(d) => { setPhoto(d); setShowCamera(false); }} />
      <ImportModal open={showImport} onClose={() => setShowImport(false)} onImported={() => fetchStaff()} entity="staff" />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-serif text-lg text-school-primary">Staff</h3>
          <span className="bg-indigo-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">{filtered.length}</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={async () => {
              const photoCache: Record<string, string> = {};
              await Promise.all(filtered.filter((s: any) => s.photoUrl || s.hasPhoto).map(async (s: any) => {
                  try {
                    const r = await fetch(s.photoUrl, { credentials: 'omit' });
                    const blob = await r.blob();
                    photoCache[s.id] = await new Promise<string>(res => {
                        const reader = new FileReader();
                        reader.onload = () => res(reader.result as string);
                        reader.readAsDataURL(blob);
                    });
                  } catch { console.warn('Photo fetch failed for', s.id); }
              }));
              const doc = new (await loadJsPDF())();
              doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
              doc.text('Staff List', 105, 14, { align: 'center' });
              let y = 22;
              filtered.forEach((s: any, i) => {
                if (y > 250) { doc.addPage(); y = 20; }
                doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(65, 55, 160);
                doc.text(`${i + 1}. ${s.name}`, 15, y); y += 7;
                doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(0, 0, 0);
                const lines = [`Role: ${s.role || ''}`, s.email ? `Email: ${s.email}` : null, `Contact: ${s.contact || ''}`].filter(Boolean);
                if (photoCache[s.id]) {
                  try { doc.addImage(photoCache[s.id], photoCache[s.id].match(/data:image\/([a-zA-Z0-9]+);/)?.[1]?.toUpperCase() || 'JPEG', 15, y, 22, 22); } catch { console.warn('Photo addImage failed'); }
                  lines.forEach((l, li) => doc.text(l!, 42, y + 5 + li * 5)); y += 28;
                } else { lines.forEach(l => { doc.text(l!, 15, y); y += 5; }); }
                doc.setDrawColor(200); doc.setLineWidth(0.3); doc.setLineDashPattern([4, 4], 0);
                doc.line(15, y + 2, 195, y + 2); doc.setLineDashPattern([], 0); y += 8;
              });
              doc.save('Staff_List.pdf');
            }}
            className="flex items-center gap-1 px-3 py-1.5 border border-school-border rounded-lg text-xs hover:bg-school-paper"
          >
            <Download size={12} /> PDF
          </button>
          {isAdmin && <button onClick={() => setShowImport(true)} className="flex items-center gap-1 px-3 py-1.5 border border-school-border rounded-lg text-xs hover:bg-school-paper">
            <Upload size={12} /> Import
          </button>}
          <button onClick={() => fetchStaff()} className="flex items-center gap-1 px-3 py-1.5 border border-school-border rounded-lg text-xs hover:bg-school-paper">
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>

      <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or role..." className="w-full px-3 py-2 border border-school-border rounded-xl text-sm focus:outline-none focus:border-school-accent" />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {isAdmin && (showAddNew ? renderEditCard(true) : (
          <button onClick={() => setShowAddNew(true)} className="border-2 border-dashed border-violet-300 bg-violet-50/30 p-4 rounded-2xl flex flex-col items-center justify-center min-h-[160px] hover:border-violet-400 hover:bg-violet-50/60 transition-all">
            <div className="text-3xl text-violet-400 mb-2">+</div>
            <div className="text-sm font-bold text-violet-600">Add New Staff</div>
          </button>
        ))}
        {loading.staff && filtered.length === 0 && Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)}
        {!loading.staff && filtered.map((s: any) => editingId === s.id ? <div key={s.id}>{renderEditCard(false)}</div> : <div key={s.id}>{renderViewCard(s)}</div>)}
      </div>

      {filtered.length === 0 && !showAddNew && (
        <div className="text-center py-12 text-school-muted">
          <div className="text-4xl mb-2"><Building2 size={48} className="text-school-muted mx-auto mb-2" /></div>
          <p className="text-sm">No staff found.</p>
        </div>
      )}
      <DeleteConfirmModal open={!!deleteId} title="Delete Staff" message="This will permanently delete this staff member." onConfirm={confirmDelete} onCancel={() => setDeleteId(null)} loading={deleteLoading} />
    </div>
  );
}

