import { useState, useEffect } from 'react';
import { useSchoolStore, useAuthStore } from '../../store';
import { toast } from '../../components/Toast';
import ClassSelect from '../../components/ClassSelect';
import { Plus, Save, Trash2, X } from 'lucide-react';
import Modal from '../../components/Modal';

export default function SubjectManager() {
  const { fetchSubjects, subjects, createSubject, updateSubject, deleteSubject } = useSchoolStore();
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'admin' || role === 'monitor';
  const [cls, setCls] = useState<any>(null);
  const [newName, setNewName] = useState('');
  const [newMarks, setNewMarks] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editMarks, setEditMarks] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => { if (cls) fetchSubjects(cls.id); }, [cls]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectClass = (c: any) => { setCls(c); setNewName(''); setNewMarks(''); };

  const handleAdd = async () => {
    if (!cls) return;
    const name = newName.trim();
    const marks = parseInt(newMarks);
    if (!name) { toast('Enter subject name.', 'error'); return; }
    if (!marks || marks < 1) { toast('Enter valid full marks.', 'error'); return; }
    if (subjects.some((s: any) => s.name === name)) { toast('Subject already exists.', 'error'); return; }
    try {
      await createSubject(cls.id, name, marks);
      setNewName('');
      setNewMarks('');
      toast(`"${name}" added ✓`, 'success');
    } catch { toast('Failed to add subject.', 'error'); }
  };

  const handleUpdate = async (id: string) => {
    const name = editName.trim();
    const marks = parseInt(editMarks);
    if (!name) { toast('Subject name required.', 'error'); return; }
    if (!marks || marks < 1) { toast('Valid full marks required.', 'error'); return; }
    const dup = subjects.find((s: any) => s.name === name && s.id !== id);
    if (dup) { toast('Subject already exists.', 'error'); return; }
    try {
      await updateSubject(id, { name, fullMarks: marks });
      setEditingId(null);
      toast('Updated ✓', 'success');
    } catch { toast('Failed to update subject.', 'error'); }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteSubject(id);
      setDeleteId(null);
      toast('Deleted ✓', 'success');
    } catch { toast('Failed to delete subject.', 'error'); }
  };

  const startEdit = (s: any) => {
    setEditingId(s.id);
    setEditName(s.name);
    setEditMarks(String(s.fullMarks));
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs text-school-muted mb-1 block">Class</label>
          <ClassSelect value={cls?.id || ''} onChange={handleSelectClass} />
        </div>
      </div>

      {!cls && <div className="text-center py-12 text-sm text-school-muted">Select a class to manage subjects.</div>}

      {cls && (
        <>
          <div className="bg-white rounded-2xl border border-school-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-school-primary text-white text-xs uppercase">
                  <th className="px-3 py-2 text-left w-10">#</th>
                  <th className="px-3 py-2 text-left">Subject Name</th>
                  <th className="px-3 py-2 text-center w-24">Full Marks</th>
                  {isAdmin && <th className="px-3 py-2 text-center w-20">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {subjects.length === 0 && (
                  <tr><td colSpan={isAdmin ? 4 : 3} className="px-3 py-8 text-center text-school-muted text-sm">No subjects yet. Add one below.</td></tr>
                )}
                {subjects.map((s: any, i: number) => (
                  <tr key={s.id} className={`border-t border-school-border/50 ${i % 2 ? 'bg-school-paper/30' : ''}`}>
                    <td className="px-3 py-2">{i + 1}</td>
                    {editingId === s.id ? (
                      <>
                        <td className="px-3 py-2">
                          <input value={editName} onChange={(e) => setEditName(e.target.value)}
                            className="w-full px-2 py-1 border border-school-border rounded text-sm focus:outline-none focus:border-school-accent" />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <input type="number" min="1" value={editMarks} onChange={(e) => setEditMarks(e.target.value)}
                            className="w-20 px-2 py-1 border border-school-border rounded text-sm text-right focus:outline-none focus:border-school-accent" />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <div className="flex gap-1 justify-center">
                            <button onClick={() => handleUpdate(s.id)} className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg" title="Save" aria-label="Save"><Save size={14} /></button>
                            <button onClick={() => setEditingId(null)} className="p-1.5 text-school-muted hover:bg-school-border/30 rounded-lg" title="Cancel" aria-label="Cancel"><X size={14} /></button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2 font-medium">{s.name}</td>
                        <td className="px-3 py-2 text-center">{s.fullMarks}</td>
                        {isAdmin && (
                          <td className="px-3 py-2 text-center">
                            <div className="flex gap-1 justify-center">
                              <button onClick={() => startEdit(s)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg" title="Edit" aria-label="Edit"><Save size={14} /></button>
                              <button onClick={() => setDeleteId(s.id)} className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg" title="Delete" aria-label="Delete"><Trash2 size={14} /></button>
                            </div>
                          </td>
                        )}
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {isAdmin && (
            <div className="flex gap-2 flex-wrap items-end">
              <div className="flex-1 min-w-[140px]">
                <label className="text-xs text-school-muted mb-1 block">Subject Name</label>
                <input value={newName} onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                  placeholder="e.g. Science"
                  className="w-full px-3 py-2 border border-school-border rounded-xl text-sm focus:outline-none focus:border-school-accent" />
              </div>
              <div className="w-24">
                <label className="text-xs text-school-muted mb-1 block">Full Marks</label>
                <input type="number" min="1" value={newMarks} onChange={(e) => setNewMarks(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                  placeholder="100"
                  className="w-full px-3 py-2 border border-school-border rounded-xl text-sm text-right focus:outline-none focus:border-school-accent" />
              </div>
              <button onClick={handleAdd} className="px-4 py-2 bg-school-primary text-white rounded-xl text-sm font-bold hover:opacity-90 flex items-center gap-1.5 mb-0.5">
                <Plus size={14} /> Add Subject
              </button>
            </div>
          )}
        </>
      )}

      <Modal open={!!deleteId} onClose={() => setDeleteId(null)} title="Delete Subject">
        <p className="text-sm text-school-muted mb-4">Are you sure you want to delete "{subjects.find((s: any) => s.id === deleteId)?.name}"? All marks for this subject will be lost.</p>
        <div className="flex gap-2 justify-end">
          <button onClick={() => setDeleteId(null)} className="px-4 py-2 border border-school-border rounded-xl text-sm">Cancel</button>
          <button onClick={() => handleDelete(deleteId!)} className="px-4 py-2 bg-red-600 text-white rounded-xl text-sm font-bold hover:opacity-90">Delete</button>
        </div>
      </Modal>
    </div>
  );
}
