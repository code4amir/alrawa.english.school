import { useState, useEffect, useCallback } from 'react';
import { api, useSchoolStore } from '../../store';
import Toast, { toast } from '../../components/Toast';
import { Plus, Loader2, Pencil, Trash2, Eye, EyeOff } from 'lucide-react';

interface Subject { id: string; name: string; fullMarks?: number; }

interface HomeworkItem {
  id: string;
  school_class: string;
  class_name: string;
  subject: string;
  subject_name: string;
  date: string;
  topic: string;
  description: string;
  due_date: string;
  published: boolean;
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

export default function HomeworkPage() {
  const { classes, subjects, fetchClasses, fetchSubjects } = useSchoolStore();
  const [items, setItems] = useState<HomeworkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const [classId, setClassId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [date, setDate] = useState(todayStr());
  const [topic, setTopic] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState(todayStr());
  const [published, setPublished] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/teacher/homework/');
      setItems(res.data.results || res.data);
    } catch { setError('Failed to load homework'); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchClasses(); fetchItems(); }, [fetchClasses, fetchItems]);

  useEffect(() => { if (classId) fetchSubjects(classId); }, [classId, fetchSubjects]);

  const resetForm = () => {
    setEditId(null);
    setClassId(''); setSubjectId(''); setDate(todayStr());
    setTopic(''); setDescription(''); setDueDate(todayStr());
    setPublished(false);
    setShowForm(false);
  };

  const handleEdit = (item: HomeworkItem) => {
    setEditId(item.id);
    setClassId(item.school_class);
    setSubjectId(item.subject);
    setDate(item.date);
    setTopic(item.topic);
    setDescription(item.description);
    setDueDate(item.due_date);
    setPublished(item.published);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!topic.trim() || !classId || !subjectId) { toast('Fill required fields', 'error'); return; }
    setSaving(true);
    const payload = { school_class: classId, subject: subjectId, date, topic, description, due_date: dueDate, published };
    try {
      if (editId) {
        await api.put(`/teacher/homework/${editId}/`, payload);
        toast('Homework updated', 'success');
      } else {
        await api.post('/teacher/homework/', payload);
        toast('Homework created', 'success');
      }
      resetForm();
      fetchItems();
    } catch (e: any) {
      toast(e.response?.data?.error || 'Failed to save', 'error');
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this homework?')) return;
    try {
      await api.delete(`/teacher/homework/${id}/`);
      toast('Deleted', 'success');
      fetchItems();
    } catch { toast('Failed to delete', 'error'); }
  };

  const togglePublish = async (item: HomeworkItem) => {
    try {
      await api.patch(`/teacher/homework/${item.id}/`, { published: !item.published });
      toast(item.published ? 'Unpublished' : 'Published ✓', 'success');
      fetchItems();
    } catch { toast('Failed to update', 'error'); }
  };

  const classSubjects: Subject[] = classId ? subjects : [];

  return (
    <div className="space-y-4 animate-fade-in">
      <Toast />
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-sm text-school-primary dark:text-[#e0e0e8]">Homework</h2>
        {!showForm && (
          <button onClick={() => setShowForm(true)} className="flex items-center gap-1 px-3 py-1.5 bg-school-accent text-white rounded-xl text-xs font-bold hover:opacity-90 transition-opacity">
            <Plus size={14} /> New
          </button>
        )}
      </div>

      {showForm && (
        <div className="bg-white dark:bg-[#1a1a2e] rounded-2xl border border-school-border dark:border-[#2a2a3e] p-4 space-y-3 shadow-sm">
          <div className="grid grid-cols-2 gap-2">
            <select value={classId} onChange={(e) => { setClassId(e.target.value); setSubjectId(''); }}
              className="px-3 py-2 border border-school-border rounded-xl text-sm bg-school-paper dark:bg-[#2a2a3e] text-school-primary dark:text-[#e0e0e8]">
              <option value="">Class *</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}
              className="px-3 py-2 border border-school-border rounded-xl text-sm bg-school-paper dark:bg-[#2a2a3e] text-school-primary dark:text-[#e0e0e8]">
              <option value="">Subject *</option>
              {classSubjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="px-3 py-2 border border-school-border rounded-xl text-sm bg-school-paper dark:bg-[#2a2a3e] text-school-primary dark:text-[#e0e0e8]" />
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
              className="px-3 py-2 border border-school-border rounded-xl text-sm bg-school-paper dark:bg-[#2a2a3e] text-school-primary dark:text-[#e0e0e8]" />
          </div>
          <input type="text" value={topic} onChange={(e) => setTopic(e.target.value)}
            className="w-full px-3 py-2 border border-school-border rounded-xl text-sm bg-school-paper dark:bg-[#2a2a3e] text-school-primary dark:text-[#e0e0e8]"
            placeholder="Topic *" />
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
            className="w-full px-3 py-2 border border-school-border rounded-xl text-sm bg-school-paper dark:bg-[#2a2a3e] text-school-primary dark:text-[#e0e0e8] resize-none"
            placeholder="Homework description" />
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)}
                className="rounded border-school-border" />
              <span className="text-xs font-semibold text-school-primary dark:text-[#e0e0e8]">Publish</span>
            </label>
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={saving}
              className="flex-1 px-3 py-2 bg-school-accent text-white rounded-xl text-sm font-bold hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-1">
              {saving ? <Loader2 size={16} className="animate-spin" /> : null}
              {saving ? 'Saving...' : editId ? 'Update' : 'Create'}
            </button>
            <button onClick={resetForm} className="px-3 py-2 border border-school-border rounded-xl text-sm font-semibold text-school-muted hover:bg-school-paper transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 size={28} className="animate-spin text-school-muted" /></div>
      ) : error ? (
        <div className="text-center py-12 space-y-3">
          <p className="text-school-muted text-sm">{error}</p>
          <button onClick={fetchItems} className="px-4 py-2 bg-school-accent text-white rounded-xl text-xs font-bold hover:opacity-90">Retry</button>
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-school-muted text-sm">No homework yet</div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="bg-white dark:bg-[#1a1a2e] rounded-2xl border border-school-border dark:border-[#2a2a3e] p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-bold uppercase text-school-accent bg-school-accent/10 px-2 py-0.5 rounded-full">{item.subject_name}</span>
                    <span className="text-[10px] text-school-muted">{item.class_name}</span>
                    {!item.published && <span className="text-[10px] text-amber-600 font-semibold">Draft</span>}
                  </div>
                  <h3 className="font-bold text-sm text-school-primary dark:text-[#e0e0e8]">{item.topic}</h3>
                  <p className="text-xs text-school-muted mt-0.5 line-clamp-2">{item.description}</p>
                  <div className="flex items-center gap-3 mt-1.5 text-[10px] text-school-muted">
                    <span>Given: {item.date}</span>
                    <span>Due: {item.due_date}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => togglePublish(item)} className="p-1.5 hover:bg-school-paper dark:hover:bg-white/5 rounded-lg transition-colors" title={item.published ? 'Unpublish' : 'Publish'}>
                    {item.published ? <Eye size={14} className="text-green-600" /> : <EyeOff size={14} className="text-school-muted" />}
                  </button>
                  <button onClick={() => handleEdit(item)} className="p-1.5 hover:bg-school-paper dark:hover:bg-white/5 rounded-lg transition-colors">
                    <Pencil size={14} className="text-school-muted" />
                  </button>
                  <button onClick={() => handleDelete(item.id)} className="p-1.5 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors">
                    <Trash2 size={14} className="text-red-500" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
