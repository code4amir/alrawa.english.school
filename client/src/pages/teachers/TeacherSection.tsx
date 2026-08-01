import { useState, useEffect } from 'react';
import { useSchoolStore, useAuthStore } from '../../store';
import { api } from '../../store';
import { toast } from '../../components/Toast';
import CameraModal from '../../components/CameraModal';
import ImportModal from '../../components/ImportModal';
import { CardSkeleton } from '../../components/Skeleton';
import { RefreshCw, Mail, Download, Upload, Camera, Pencil, Trash2, Check, GraduationCap, BookOpen, Users, X, Plus, Lock, Star } from 'lucide-react';
import { contactLinks } from '../../lib/contacts';
import DeleteConfirmModal from '../../components/DeleteConfirmModal';
import { API_URL } from '../../lib/config';

let _jsPDF: any = null;
async function loadJsPDF() {
  if (!_jsPDF) { _jsPDF = (await import('jspdf')).default; }
  return _jsPDF;
}

export default function TeacherSection() {
  const { teachers, fetchTeachers, loading, classes, fetchClasses } = useSchoolStore();
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'admin';

  const [showCamera, setShowCamera] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddNew, setShowAddNew] = useState(false);
  const [search, setSearch] = useState('');
  const [activeDesig, setActiveDesig] = useState<string | null>(null);
  const [showCoverage, setShowCoverage] = useState(false);

  const [photo, setPhoto] = useState<string | null>(null);
  const [form, setForm] = useState({ designation: '', name: '', email: '', contact: '' });

  useEffect(() => { document.title = 'Teachers - AL RAWA English School'; }, []);
  useEffect(() => {
    if (teachers.length === 0) fetchTeachers();
    if (classes.length === 0) fetchClasses();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const designations = [...new Set(teachers.map((t: any) => t.designation))];
  const filtered = teachers.filter((t: any) => {
    if (activeDesig && t.designation !== activeDesig) return false;
    if (search && !t.name.toLowerCase().includes(search.toLowerCase()) && !t.designation.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const resetForm = () => {
    setForm({ designation: '', name: '', email: '', contact: '' });
    setPhoto(null);
    setEditingId(null);
    setShowAddNew(false);
  };

  const handleEdit = (t: any) => {
    setForm({ designation: t.designation, name: t.name, email: t.email || '', contact: t.contact || '' });
    setPhoto(t.photoUrl ? (t.photoUrl.startsWith('http') ? t.photoUrl : `${API_URL.replace('/api', '')}${t.photoUrl}`) : (t.hasPhoto ? `${API_URL}/teachers/${t.id}/photo/` : null));
    setEditingId(t.id);
  };

  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!form.name.trim()) return toast('Enter teacher name', 'error');
    if (!form.designation.trim()) return toast('Enter designation', 'error');

    const body = { ...form, photo: photo || undefined };

    try {
      setSubmitting(true);
      if (editingId) {
        await api.put(`/teachers/${editingId}/`, body);
      } else {
        await api.post('/teachers/', body);
      }
      toast(editingId ? 'Teacher updated' : 'Teacher added', 'success');
      resetForm();
      fetchTeachers(undefined, true);
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
      await api.delete(`/teachers/${deleteId}/`);
      toast('Teacher deleted', '', { label: 'Undo', onClick: async () => {
        try {
          await api.post(`/teachers/${idToRestore}/restore/`);
          toast('Teacher restored', 'success');
          fetchTeachers(undefined, true);
        } catch { toast('Could not undo', 'error'); }
      }});
    } catch (e: any) { toast(e.response?.data?.error || e.message || 'Error', 'error'); }
    setDeleteId(null);
    setDeleteLoading(false);
    fetchTeachers(undefined, true);
  };

  const inputCls = 'w-full px-3 py-2 border border-school-border rounded-xl text-sm focus:outline-none focus:border-school-accent';

  const renderEditCard = (isNew: boolean) => (
    <div className={`p-4 rounded-2xl border-2 transition-all ${isNew ? 'border-violet-400 bg-violet-50/50' : 'border-blue-400 bg-blue-50/50'}`} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}>
      <div className="flex justify-center mb-3">
        <button onClick={() => setShowCamera(true)} className="relative group" aria-label="Take photo">
          {photo ? (
            <img src={photo} alt="" className="w-20 h-20 rounded-full object-cover border-2 border-white shadow-md" />
          ) : (
            <div className="w-20 h-20 rounded-full bg-emerald-600 text-white flex items-center justify-center"><GraduationCap size={32} className="text-white" /></div>
          )}
          <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <Camera size={20} className="text-white" />
          </div>
        </button>
      </div>
      <div>
        <label className="text-xs font-bold text-school-muted mb-1 block">Designation</label>
        <input type="text" value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} placeholder="e.g. Head Teacher" className={inputCls} />
      </div>
      <div className="mt-3">
        <label className="text-xs font-bold text-school-muted mb-1 block">Full Name</label>
        <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Teacher's full name" className={inputCls} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
        <div>
          <label className="text-xs font-bold text-school-muted mb-1 block">Email</label>
          <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="teacher@school.com" className={inputCls} />
        </div>
        <div>
          <label className="text-xs font-bold text-school-muted mb-1 block">Contact</label>
          <input type="tel" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} placeholder="01XXXXXXXXX" className={inputCls} />
        </div>
      </div>
      <div className="flex gap-2 mt-3">
        <button onClick={handleSubmit} disabled={submitting} className={`flex-1 py-2 text-white rounded-xl text-sm font-bold hover:opacity-90 flex items-center justify-center gap-1.5 disabled:opacity-50 ${isNew ? 'bg-violet-600' : 'bg-blue-600'}`}>
          {isNew ? '+ Add Teacher' : <>{submitting ? 'Saving...' : <><Check size={14} /> Save</>}</>}
        </button>
        <button onClick={resetForm} className="px-4 py-2 border border-school-border rounded-xl text-sm hover:bg-white">Cancel</button>
      </div>
    </div>
  );

  const renderViewCard = (t: any) => (
    <div className="bg-white p-4 rounded-2xl border border-school-border card-shadow text-center">
      <div className="flex flex-col items-center gap-2">
        {t.photoUrl ? (
          <img src={t.photoUrl} alt="" className="w-14 h-14 rounded-full object-cover border-2 border-school-border shadow-sm" />
        ) : t.hasPhoto ? (
          <img src={`${API_URL}/teachers/${t.id}/photo/`} alt="" className="w-14 h-14 rounded-full object-cover border-2 border-school-border shadow-sm" />
        ) : (
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-700 text-white flex items-center justify-center shadow-sm"><GraduationCap size={24} className="text-white" /></div>
        )}
        <div>
          <div className="font-bold text-sm text-school-primary">{t.name}</div>
          <div className="text-xs text-indigo-600 font-medium">{t.designation}</div>
        </div>
      </div>
      <div className="mt-2 space-y-0.5">
        {t.email && <div className="text-xs flex items-center justify-center gap-1"><Mail size={11} className="text-school-muted" /> {t.email}</div>}
        {t.contact && <div className="text-xs">{contactLinks(t.contact)}</div>}
      </div>
      {(t.classTeacherOf?.length > 0 || t.subjectAssignments?.length > 0) && (
        <div className="mt-2 pt-2 border-t border-school-border space-y-1">
          {t.classTeacherOf?.length > 0 && (
            <div className="text-[10px] text-emerald-600 font-medium">
              <Users size={10} className="inline mr-1" />
              Class Teacher: {t.classTeacherOf.map((c: any) => `${c.className}${c.is_primary ? ' ⭐' : ''}`).join(', ')}
            </div>
          )}
          {t.subjectAssignments?.length > 0 && (
            <div className="text-[10px] text-blue-600 font-medium">
              <BookOpen size={10} className="inline mr-1" />
              Subjects: {t.subjectAssignments.map((s: any) => `${s.subjectName} (${s.className})`).join(', ')}
            </div>
          )}
        </div>
      )}
      {isAdmin && (
        <div className="flex gap-2 mt-3 pt-3 border-t border-school-border">
          <button onClick={() => handleEdit(t)} className="flex-1 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs font-medium hover:bg-blue-100 flex items-center justify-center gap-1"><Pencil size={14} /> Edit</button>
          <button onClick={() => setAssignmentTeacherId(t.id)} className="flex-1 py-1.5 bg-purple-50 text-purple-600 rounded-lg text-xs font-medium hover:bg-purple-100 flex items-center justify-center gap-1"><BookOpen size={14} /> Assign</button>
          <button onClick={() => { setPinTeacherId(t.id); setPinValue(''); }} className="flex-1 py-1.5 bg-amber-50 text-amber-600 rounded-lg text-xs font-medium hover:bg-amber-100 flex items-center justify-center gap-1"><Lock size={14} /> PIN</button>
          <button onClick={() => setDeleteId(t.id)} className="flex-1 py-1.5 bg-red-50 text-red-500 rounded-lg text-xs font-medium hover:bg-red-100 flex items-center justify-center gap-1" aria-label="Delete"><Trash2 size={14} /></button>
        </div>
      )}
    </div>
  );

  const [assignmentTeacherId, setAssignmentTeacherId] = useState<string | null>(null);
  const assignmentTeacher = assignmentTeacherId ? teachers.find((t: any) => t.id === assignmentTeacherId) : null;

  const [pinTeacherId, setPinTeacherId] = useState<string | null>(null);
  const [pinValue, setPinValue] = useState('');
  const [pinSubmitting, setPinSubmitting] = useState(false);
  const pinTeacher = pinTeacherId ? teachers.find((t: any) => t.id === pinTeacherId) : null;

  const handleSetPin = async () => {
    if (!pinTeacherId || pinValue.length !== 6 || !/^\d{6}$/.test(pinValue)) return toast('Enter a 6-digit PIN', 'error');
    setPinSubmitting(true);
    try {
      await api.post(`/teachers/${pinTeacherId}/set_pin/`, { pin: pinValue });
      toast('PIN set successfully', 'success');
      setPinTeacherId(null);
      setPinValue('');
    } catch (e: any) {
      toast(e.response?.data?.error || e.message || 'Error', 'error');
    } finally { setPinSubmitting(false); }
  };

  return (
    <div className="space-y-4">
      <CameraModal open={showCamera} onClose={() => setShowCamera(false)} onCapture={(d) => { setPhoto(d); setShowCamera(false); }} />
      <ImportModal open={showImport} onClose={() => setShowImport(false)} onImported={() => fetchTeachers()} entity="teacher" />

      {/* Assignment Panel */}
      {assignmentTeacher && (
        <AssignmentPanel
          teacher={assignmentTeacher}
          classes={classes}
          fetchTeachers={fetchTeachers}
          onClose={() => setAssignmentTeacherId(null)}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-serif text-lg text-school-primary">Teachers</h3>
          <span className="bg-emerald-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">{filtered.length}</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={async () => {
              const photoCache: Record<string, string> = {};
              await Promise.all(filtered.filter((t: any) => t.photoUrl || t.hasPhoto).map(async (t: any) => {
                  try {
                    const r = await fetch(t.photoUrl, { credentials: 'omit' });
                    const blob = await r.blob();
                    photoCache[t.id] = await new Promise<string>(res => {
                        const reader = new FileReader();
                        reader.onload = () => res(reader.result as string);
                        reader.readAsDataURL(blob);
                    });
                  } catch { console.warn('Photo fetch failed for', t.id); }
              }));
              const doc = new (await loadJsPDF())();
              doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
              doc.text('Teacher List', 105, 14, { align: 'center' });
              let y = 22;
              filtered.forEach((t: any, i) => {
                if (y > 250) { doc.addPage(); y = 20; }
                doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(107, 63, 160);
                doc.text(`${i + 1}. ${t.name}`, 15, y); y += 7;
                doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(0, 0, 0);
                const lines = [`Designation: ${t.designation}`, t.email ? `Email: ${t.email}` : null, `Contact: ${t.contact || ''}`].filter(Boolean);
                if (photoCache[t.id]) {
                  try { doc.addImage(photoCache[t.id], photoCache[t.id].match(/data:image\/([a-zA-Z0-9]+);/)?.[1]?.toUpperCase() || 'JPEG', 15, y, 22, 22); } catch { console.warn('Photo addImage failed'); }
                  lines.forEach((l, li) => doc.text(l!, 42, y + 5 + li * 5)); y += 28;
                } else { lines.forEach(l => { doc.text(l!, 15, y); y += 5; }); }
                doc.setDrawColor(200); doc.setLineWidth(0.3); doc.setLineDashPattern([4, 4], 0);
                doc.line(15, y + 2, 195, y + 2); doc.setLineDashPattern([], 0); y += 8;
              });
              doc.save('Teacher_List.pdf');
            }}
            className="flex items-center gap-1 px-3 py-1.5 border border-school-border rounded-lg text-xs hover:bg-school-paper"
          >
            <Download size={12} /> PDF
          </button>
          {isAdmin && <button onClick={() => setShowImport(true)} className="flex items-center gap-1 px-3 py-1.5 border border-school-border rounded-lg text-xs hover:bg-school-paper">
            <Upload size={12} /> Import
          </button>}
          <button onClick={() => fetchTeachers(undefined, true)} className="flex items-center gap-1 px-3 py-1.5 border border-school-border rounded-lg text-xs hover:bg-school-paper">
            <RefreshCw size={12} /> Refresh
          </button>
          <button onClick={() => setShowCoverage(!showCoverage)}
            className={`flex items-center gap-1 px-3 py-1.5 border rounded-lg text-xs transition-colors ${showCoverage ? 'bg-school-primary text-white border-school-primary' : 'border-school-border hover:bg-school-paper'}`}>
            <BookOpen size={12} /> {showCoverage ? 'Teacher Cards' : 'Coverage'}
          </button>
        </div>
      </div>

      {/* Coverage Matrix — class-centric overview */}
      {showCoverage && <TeacherCoverage teachers={teachers} classes={classes} />}

      {/* Designation Picker */}
      {!showCoverage && <>
      {!activeDesig && designations.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setActiveDesig(null)} className="px-3 py-1.5 bg-school-primary text-white rounded-full text-xs font-medium">All</button>
          {designations.map((d) => (
            <button key={d} onClick={() => setActiveDesig(d)} className="px-3 py-1.5 border border-school-border rounded-full text-xs font-medium hover:bg-school-paper">{d}</button>
          ))}
        </div>
      )}
      {activeDesig && (
        <div className="flex items-center gap-2">
          <button onClick={() => setActiveDesig(null)} className="text-sm text-school-accent hover:underline">← All</button>
          <span className="text-sm font-medium">{activeDesig}</span>
        </div>
      )}

      <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or designation..." className="w-full px-3 py-2 border border-school-border rounded-xl text-sm focus:outline-none focus:border-school-accent" />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {isAdmin && (showAddNew ? renderEditCard(true) : (
          <button onClick={() => setShowAddNew(true)} className="border-2 border-dashed border-violet-300 bg-violet-50/30 p-4 rounded-2xl flex flex-col items-center justify-center min-h-[160px] hover:border-violet-400 hover:bg-violet-50/60 transition-all">
            <div className="text-3xl text-violet-400 mb-2">+</div>
            <div className="text-sm font-bold text-violet-600">Add New Teacher</div>
          </button>
        ))}
        {loading.teachers && filtered.length === 0 && Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)}
        {!loading.teachers && filtered.map((t: any) => editingId === t.id ? <div key={t.id}>{renderEditCard(false)}</div> : <div key={t.id}>{renderViewCard(t)}</div>)}
      </div>

      {filtered.length === 0 && !showAddNew && (
        <div className="text-center py-12 text-school-muted">
          <div className="text-4xl mb-2"><GraduationCap size={48} className="text-school-muted mx-auto mb-2" /></div>
          <p className="text-sm">No teachers found.</p>
        </div>
      )}
      </>}
      <DeleteConfirmModal open={!!deleteId} title="Delete Teacher" message="This will permanently delete this teacher." onConfirm={confirmDelete} onCancel={() => setDeleteId(null)} loading={deleteLoading} />

      {/* Set PIN Modal */}
      {pinTeacher && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => { setPinTeacherId(null); setPinValue(''); }}>
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-6" onClick={e => e.stopPropagation()}>
            <div className="text-center mb-4">
              <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-3"><Lock size={24} className="text-amber-600" /></div>
              <h3 className="font-bold text-school-primary">Set Mobile PIN</h3>
              <p className="text-xs text-school-muted mt-1">{pinTeacher.name}</p>
            </div>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={pinValue}
              onChange={e => setPinValue(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="Enter 6-digit PIN"
              className="w-full px-4 py-3 border-2 border-school-border rounded-xl text-center text-2xl tracking-[0.5em] font-mono focus:outline-none focus:border-amber-500"
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') handleSetPin(); }}
            />
            <div className="flex gap-2 mt-4">
              <button onClick={() => { setPinTeacherId(null); setPinValue(''); }} className="flex-1 py-2.5 border border-school-border rounded-xl text-sm font-medium">Cancel</button>
              <button onClick={handleSetPin} disabled={pinSubmitting || pinValue.length !== 6} className="flex-1 py-2.5 bg-amber-600 text-white rounded-xl text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-1">
                {pinSubmitting ? 'Saving...' : <><Lock size={14} /> Set PIN</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AssignmentPanel({ teacher, classes, fetchTeachers, onClose }: {
  teacher: any;
  classes: any[];
  fetchTeachers: (p?: any, force?: boolean) => void;
  onClose: () => void;
}) {
  const [classTeacherClasses, setClassTeacherClasses] = useState<any[]>(teacher.classTeacherOf || []);
  const [subjectAssignments, setSubjectAssignments] = useState<any[]>(teacher.subjectAssignments || []);
  const [selectedClass, setSelectedClass] = useState('');
  const [selectedSubject, setSelectedSubject] = useState('');
  const [classSubjects, setClassSubjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const loadClassSubjects = async (classId: string) => {
    setSelectedClass(classId);
    setSelectedSubject('');
    if (!classId) { setClassSubjects([]); return; }
    try {
      const res = await api.get(`/subjects/?class_id=${classId}&limit=2000`);
      setClassSubjects(res.data.results || res.data.data || res.data);
    } catch { setClassSubjects([]); }
  };

  const assignClassTeacher = async () => {
    if (!selectedClass) return toast('Select a class', 'error');
    setLoading(true);
    try {
      await api.post(`/teachers/${teacher.id}/class_teacher/`, { classId: selectedClass, isPrimary: false });
      toast('Class teacher assigned', 'success');
      const cls = classes.find((c: any) => c.id === selectedClass);
      setClassTeacherClasses([...classTeacherClasses, { classId: selectedClass, className: cls?.name || selectedClass, is_primary: false }]);
      setSelectedClass('');
      fetchTeachers(undefined, true);
    } catch (e: any) {
      toast(e.response?.data?.error || 'Error', 'error');
    } finally { setLoading(false); }
  };

  const toggleLead = async (classId: string, makePrimary: boolean) => {
    setLoading(true);
    try {
      await api.post(`/teachers/${teacher.id}/class_teacher/`, { classId, isPrimary: makePrimary });
      toast(makePrimary ? 'Marked as lead class teacher' : 'Removed lead designation', 'success');
      setClassTeacherClasses(classTeacherClasses.map((c: any) =>
        c.classId === classId ? { ...c, is_primary: makePrimary } : (makePrimary ? { ...c, is_primary: false } : c)
      ));
      fetchTeachers(undefined, true);
    } catch (e: any) {
      toast(e.response?.data?.error || 'Error', 'error');
    } finally { setLoading(false); }
  };

  const removeClassTeacher = async (classId: string) => {
    setLoading(true);
    try {
      await api.post(`/teachers/${teacher.id}/remove_class_teacher/`, { classId });
      toast('Removed from class teacher', 'success');
      setClassTeacherClasses(classTeacherClasses.filter((c: any) => c.classId !== classId));
      fetchTeachers(undefined, true);
    } catch (e: any) {
      toast(e.response?.data?.error || 'Error', 'error');
    } finally { setLoading(false); }
  };

  const assignSubject = async () => {
    if (!selectedClass || !selectedSubject) return toast('Select class and subject', 'error');
    setLoading(true);
    try {
      await api.post(`/teachers/${teacher.id}/subject_assignment/`, { subjectId: selectedSubject, classId: selectedClass });
      toast('Subject assigned', 'success');
      const cls = classes.find((c: any) => c.id === selectedClass);
      const subj = classSubjects.find((s: any) => s.id === selectedSubject);
      setSubjectAssignments([...subjectAssignments, {
        subjectId: selectedSubject,
        subjectName: subj?.name || selectedSubject,
        classId: selectedClass,
        className: cls?.name || selectedClass,
      }]);
      setSelectedSubject('');
      fetchTeachers(undefined, true);
    } catch (e: any) {
      toast(e.response?.data?.error || 'Error', 'error');
    } finally { setLoading(false); }
  };

  const removeSubject = async (subjectId: string, classId: string) => {
    setLoading(true);
    try {
      await api.post(`/teachers/${teacher.id}/remove_subject/`, { subjectId, classId });
      toast('Subject removed', 'success');
      setSubjectAssignments(subjectAssignments.filter((s: any) => !(s.subjectId === subjectId && s.classId === classId)));
      fetchTeachers(undefined, true);
    } catch (e: any) {
      toast(e.response?.data?.error || 'Error', 'error');
    } finally { setLoading(false); }
  };

  const availableClasses = classes.filter((c: any) => !classTeacherClasses.some((ct: any) => ct.classId === c.id));

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-xl">
        <div className="sticky top-0 bg-white border-b border-school-border p-4 flex items-center justify-between rounded-t-2xl">
          <div>
            <h3 className="font-bold text-school-primary">{teacher.name}</h3>
            <p className="text-xs text-school-muted">Assign classes and subjects</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg" aria-label="Close"><X size={20} /></button>
        </div>

        <div className="p-4 space-y-5">
          {/* Class Teacher Section */}
          <div>
            <h4 className="text-sm font-bold text-school-primary mb-2 flex items-center gap-1.5"><Users size={14} /> Class Teacher Of</h4>
            {classTeacherClasses.length > 0 && (
              <div className="space-y-1.5 mb-2">
                {classTeacherClasses.map((ct: any) => (
                  <div key={ct.classId} className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-emerald-700">{ct.className}</span>
                      {ct.is_primary ? (
                        <span className="text-[9px] px-1.5 py-0.5 bg-emerald-600 text-white rounded-full font-bold">LEAD</span>
                      ) : (
                        <button onClick={() => toggleLead(ct.classId, true)} disabled={loading} className="text-[9px] px-1.5 py-0.5 bg-white border border-emerald-300 text-emerald-600 rounded-full font-bold hover:bg-emerald-100 disabled:opacity-50" title="Make this teacher the lead class teacher">
                          Make Lead
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {ct.is_primary && (
                        <button onClick={() => toggleLead(ct.classId, false)} disabled={loading} className="text-[9px] px-1.5 py-0.5 text-amber-600 hover:bg-amber-50 rounded font-semibold disabled:opacity-50" title="Remove lead designation (class keeps co-teachers)">
                          remove lead
                        </button>
                      )}
                      <button onClick={() => removeClassTeacher(ct.classId)} disabled={loading} className="text-red-500 hover:text-red-700 disabled:opacity-50" aria-label="Remove"><X size={16} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {availableClasses.length > 0 ? (
              <div className="flex gap-2">
                <select value={selectedClass} onChange={(e) => setSelectedClass(e.target.value)} className="flex-1 px-3 py-2 border border-school-border rounded-xl text-sm">
                  <option value="">Select class...</option>
                  {availableClasses.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button onClick={assignClassTeacher} disabled={loading || !selectedClass} className="px-3 py-2 bg-emerald-600 text-white rounded-xl text-sm font-medium disabled:opacity-50 flex items-center gap-1"><Plus size={14} /> Add</button>
              </div>
            ) : (
              <p className="text-xs text-school-muted">All classes assigned</p>
            )}
          </div>

          {/* Subject Assignment Section */}
          <div>
            <h4 className="text-sm font-bold text-school-primary mb-2 flex items-center gap-1.5"><BookOpen size={14} /> Subject Assignments</h4>
            {subjectAssignments.length > 0 && (
              <div className="space-y-1.5 mb-2">
                {subjectAssignments.map((sa: any) => (
                  <div key={`${sa.subjectId}-${sa.classId}`} className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                    <span className="text-sm text-blue-700">{sa.subjectName} <span className="text-blue-400">({sa.className})</span></span>
                    <button onClick={() => removeSubject(sa.subjectId, sa.classId)} disabled={loading} className="text-red-500 hover:text-red-700 disabled:opacity-50" aria-label="Remove"><X size={16} /></button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <select value={selectedClass} onChange={(e) => loadClassSubjects(e.target.value)} className="flex-1 px-3 py-2 border border-school-border rounded-xl text-sm">
                <option value="">Class...</option>
                {classes.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select value={selectedSubject} onChange={(e) => setSelectedSubject(e.target.value)} disabled={!selectedClass} className="flex-1 px-3 py-2 border border-school-border rounded-xl text-sm disabled:opacity-50">
                <option value="">Subject...</option>
                {classSubjects.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button onClick={assignSubject} disabled={loading || !selectedClass || !selectedSubject} className="px-3 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium disabled:opacity-50 flex items-center gap-1" aria-label="Assign subject"><Plus size={14} /></button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============ TeacherCoverage — class-centric assignment overview ============ */

function TeacherCoverage({ teachers, classes }: { teachers: any[]; classes: any[] }) {
  const sortedClasses = [...classes].sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0));

  // classId -> all ClassTeacher entries {name, is_primary}
  const classTeachers: Record<string, { name: string; is_primary: boolean }[]> = {};
  for (const t of teachers) {
    for (const c of t.classTeacherOf || []) {
      (classTeachers[c.classId] ||= []).push({ name: t.name, is_primary: !!c.is_primary });
    }
  }

  // classId -> [{subjectName, teacherName}]
  const classSubjects: Record<string, { subjectName: string; teacherName: string }[]> = {};
  for (const t of teachers) {
    for (const sa of t.subjectAssignments || []) {
      (classSubjects[sa.classId] ||= []).push({ subjectName: sa.subjectName, teacherName: t.name });
    }
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 animate-fade-in">
      {sortedClasses.map((cls: any) => {
        const cts = classTeachers[cls.id] || [];
        const subs = classSubjects[cls.id] || [];
        const lead = cts.find((c) => c.is_primary);
        const cos = cts.filter((c) => !c.is_primary);
        return (
          <div key={cls.id} className="bg-white dark:bg-[#1a1a2e] rounded-xl border border-school-border dark:border-[#2a2a3e] overflow-hidden flex flex-col">
            {/* Class header */}
            <div className="px-4 py-2.5 border-b border-school-border/50 bg-school-paper/40 flex items-center justify-between">
              <h3 className="font-serif font-bold text-school-primary text-sm">{cls.name}</h3>
              <span className="text-[9px] px-2 py-0.5 bg-school-primary/10 text-school-primary rounded-full font-bold uppercase tracking-wide">
                {cts.length} teacher{cts.length === 1 ? '' : 's'}
              </span>
            </div>

            <div className="p-3 space-y-3 flex-1">
              {/* Class teachers */}
              <div>
                <div className="text-[9px] uppercase tracking-widest text-school-muted font-bold mb-1.5 flex items-center gap-1"><Users size={10} /> Class Teacher</div>
                {cts.length === 0 ? (
                  <div className="text-[11px] text-amber-600 font-semibold">— No class teacher</div>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {lead && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-600 text-white rounded-lg text-[10px] font-bold">
                        <Star size={10} className="fill-current" /> {lead.name}
                      </span>
                    )}
                    {cos.map((c, i) => (
                      <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-[10px] font-semibold">
                        {c.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Subjects */}
              <div>
                <div className="text-[9px] uppercase tracking-widest text-school-muted font-bold mb-1.5 flex items-center gap-1"><BookOpen size={10} /> Subjects</div>
                {subs.length === 0 ? (
                  <div className="text-[11px] text-amber-600 font-semibold">— No subjects assigned</div>
                ) : (
                  <div className="space-y-1">
                    {subs.map((s, i) => (
                      <div key={i} className="flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-school-primary">{s.subjectName}</span>
                        <span className="text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded font-medium">{s.teacherName}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

