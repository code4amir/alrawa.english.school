import { useState, useEffect } from 'react';
import { useSchoolStore } from '../store';
import { api } from '../stores/api';
import { toast, getErrorMessage } from '../components/Toast';
import { Calendar, Plus, Trash2, X } from 'lucide-react';

export default function ExamRoutineAdmin() {
  const { classes, fetchClasses } = useSchoolStore();
  const [entries, setEntries] = useState<any[]>([]);
  const [examName, setExamName] = useState('');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const [formClass, setFormClass] = useState('');
  const [formSubject, setFormSubject] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formStartTime, setFormStartTime] = useState('10:00');
  const [formEndTime, setFormEndTime] = useState('');
  const [formRoom, setFormRoom] = useState('');
  const [formExamName, setFormExamName] = useState('');
  const [classSubjects, setClassSubjects] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchClasses();
    fetchEntries();
  }, []);

  const fetchEntries = async () => {
    setLoading(true);
    try {
      const res = await api.get('/academic/exam-routines/');
      setEntries(res.data?.results || res.data || []);
    } catch { /* */ }
    setLoading(false);
  };

  const loadSubjects = async (classId: string) => {
    setFormClass(classId);
    setFormSubject('');
    if (!classId) { setClassSubjects([]); return; }
    try {
      const res = await api.get(`/subjects/?school_class_id=${classId}`);
      setClassSubjects(res.data?.results || res.data || []);
    } catch { setClassSubjects([]); }
  };

  const uniqueExamNames = [...new Set(entries.map((e: any) => e.exam_name || e.examName))];

  const filteredEntries = examName
    ? entries.filter((e: any) => (e.exam_name || e.examName) === examName)
    : entries;

  const sortedDates = [...new Set(filteredEntries.map((e: any) => e.date))].sort();
  const sortedClasses = [...classes].sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0));
  const activeClassIds = sortedClasses
    .filter((c: any) => filteredEntries.some((e: any) => (e.school_class || e.schoolClass) === c.id))
    .map((c: any) => c.id);

  const cellSubject = (date: string, classId: string) =>
    filteredEntries.find((e: any) => e.date === date && (e.school_class || e.schoolClass) === classId);

  const addEntry = async () => {
    if (!formClass || !formSubject || !formDate || !formExamName.trim()) {
      return toast('Fill class, subject, date, and exam name', 'error');
    }
    setSubmitting(true);
    try {
      await api.post('/academic/exam-routines/', {
        exam_name: formExamName.trim(),
        school_class: formClass,
        subject: formSubject,
        date: formDate,
        start_time: formStartTime || '10:00',
        end_time: formEndTime || null,
        room: formRoom,
      });
      toast('Entry added', 'success');
      setShowForm(false);
      setFormClass('');
      setFormSubject('');
      setFormDate('');
      setFormStartTime('10:00');
      setFormEndTime('');
      setFormRoom('');
      fetchEntries();
    } catch (e: any) {
      toast(getErrorMessage(e), 'error');
    } finally { setSubmitting(false); }
  };

  const deleteEntry = async (id: string) => {
    try {
      await api.delete(`/academic/exam-routines/${id}/`);
      toast('Deleted', 'success');
      fetchEntries();
    } catch (e: any) {
      toast(getErrorMessage(e), 'error');
    }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar size={20} className="text-school-primary" />
          <h2 className="text-lg font-bold text-school-primary">Exam Schedule</h2>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-school-primary text-white hover:bg-school-primary/90">
            <Plus size={16} /> Add Entry
          </button>
        </div>
      </div>

      {uniqueExamNames.length > 0 && (
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-school-muted">Exam:</label>
          <select value={examName} onChange={(e) => setExamName(e.target.value)}
            className="border border-school-border rounded-lg px-3 py-1.5 text-sm bg-white">
            <option value="">All Exams</option>
            {uniqueExamNames.map((n: string) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      )}

      {showForm && (
        <div className="bg-white rounded-xl shadow-sm p-4 border border-school-border">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-school-primary">New Entry</h3>
            <button onClick={() => setShowForm(false)} className="p-1 hover:bg-school-paper rounded">
              <X size={16} />
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <input placeholder="Exam Name *" value={formExamName} onChange={(e) => setFormExamName(e.target.value)}
              className="col-span-2 sm:col-span-3 border border-school-border rounded-lg px-3 py-1.5 text-sm" />
            <select value={formClass} onChange={(e) => loadSubjects(e.target.value)}
              className="border border-school-border rounded-lg px-3 py-1.5 text-sm bg-white">
              <option value="">Class *</option>
              {sortedClasses.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={formSubject} onChange={(e) => setFormSubject(e.target.value)}
              className="border border-school-border rounded-lg px-3 py-1.5 text-sm bg-white">
              <option value="">Subject *</option>
              {classSubjects.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)}
              className="border border-school-border rounded-lg px-3 py-1.5 text-sm" />
            <input type="time" value={formStartTime} onChange={(e) => setFormStartTime(e.target.value)}
              className="border border-school-border rounded-lg px-3 py-1.5 text-sm" />
            <input type="time" value={formEndTime} onChange={(e) => setFormEndTime(e.target.value)}
              className="border border-school-border rounded-lg px-3 py-1.5 text-sm" />
            <input placeholder="Room" value={formRoom} onChange={(e) => setFormRoom(e.target.value)}
              className="border border-school-border rounded-lg px-3 py-1.5 text-sm" />
          </div>
          <button onClick={addEntry} disabled={submitting}
            className="mt-3 px-4 py-1.5 text-sm font-medium rounded-lg bg-school-primary text-white hover:bg-school-primary/90 disabled:opacity-50">
            {submitting ? 'Adding...' : 'Add Entry'}
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map(i => <div key={i} className="h-12 bg-school-paper rounded-xl animate-pulse" />)}
        </div>
      ) : filteredEntries.length === 0 ? (
        <div className="text-center py-10 text-school-muted">
          <Calendar size={32} className="mx-auto mb-2 opacity-40" />
          <p>No exam routine entries found.</p>
          <p className="text-xs mt-1">Click "Add Entry" to create one.</p>
        </div>
      ) : (
        <div className="overflow-x-auto bg-white rounded-xl shadow-sm">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-school-primary/10">
                <th className="border border-school-border px-3 py-2 text-left font-semibold text-school-primary">Date/Day</th>
                {sortedClasses.filter((c: any) => activeClassIds.includes(c.id)).map((c: any) => (
                  <th key={c.id} className="border border-school-border px-3 py-2 text-center font-semibold text-school-primary min-w-[100px]">
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedDates.map(date => {
                const d = new Date(date + 'T00:00:00');
                const dayName = d.toLocaleDateString('en-US', { weekday: 'long' });
                const display = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' });
                return (
                  <tr key={date} className="hover:bg-school-paper/50">
                    <td className="border border-school-border px-3 py-2 whitespace-nowrap">
                      <div className="font-medium">{display}</div>
                      <div className="text-xs text-school-muted">{dayName}</div>
                    </td>
                    {sortedClasses.filter((c: any) => activeClassIds.includes(c.id)).map((c: any) => {
                      const entry = cellSubject(date, c.id);
                      return (
                        <td key={c.id} className="border border-school-border px-3 py-2 text-center">
                          {entry ? (
                            <div className="group relative">
                              <span className="font-medium">{entry.subject_name || entry.subjectName}</span>
                              <button onClick={() => deleteEntry(entry.id)}
                                className="absolute -top-1 -right-1 p-0.5 rounded-full bg-red-100 text-red-600 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                                title="Delete">
                                <Trash2 size={12} />
                              </button>
                            </div>
                          ) : (
                            <span className="text-school-muted">x</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
