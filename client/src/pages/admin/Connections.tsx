import { useState, useEffect } from 'react';
import { api } from '../../store';
import { toast, getErrorMessage } from '../../components/Toast';
import { Link2, Unlink, Search, ShieldOff, Users } from 'lucide-react';
import Layout from '../../components/Layout';

interface ParentLink {
  id: string;
  parentId: string;
  parentName: string;
  parentEmail: string;
  studentId: string;
  studentName: string;
  studentRoll: string;
  className?: string;
  createdAt: string;
}

interface ParentOption {
  id: string;
  name: string;
  email: string;
}

interface StudentOption {
  id: string;
  name: string;
  studentId: string;
  roll: string;
  className: string;
}

export default function Connections() {
  const [links, setLinks] = useState<ParentLink[]>([]);
  const [parents, setParents] = useState<ParentOption[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedParent, setSelectedParent] = useState('');
  const [selectedStudents, setSelectedStudents] = useState<Set<string>>(new Set());
  const [classFilter, setClassFilter] = useState('');
  const [search, setSearch] = useState('');
  const [linking, setLinking] = useState(false);

  const [blockedEmails, setBlockedEmails] = useState<string[]>([]);
  const [blockEmail, setBlockEmail] = useState('');

  useEffect(() => { document.title = 'Connections - AL RAWA English School'; }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [linksRes, usersRes, studentsRes] = await Promise.all([
        api.get('/parents/links/'),
        api.get('/users/'),
        api.get('/students/', { params: { all: 'true' } }),
      ]);
      setLinks(linksRes.data);
      const users = usersRes.data?.results || usersRes.data || [];
      setParents(users.filter((u: any) => u.role === 'parent').map((u: any) => ({
        id: u.id, name: u.name, email: u.email,
      })));
      setStudents((studentsRes.data || []).map((s: any) => ({
        id: s.id, name: s.name, studentId: s.studentId || s.student_id || '',
        roll: s.roll || '', className: s.className || '',
      })));
    } catch (e) {
      toast(getErrorMessage(e), 'error');
    }
    setLoading(false);
  };

  const fetchBlocked = async () => {
    try {
      const res = await api.get('/parents/blocked-emails/');
      setBlockedEmails(res.data);
    } catch { /* noop */ }
  };

  useEffect(() => { void Promise.all([fetchAll(), fetchBlocked()]); }, []);

  const classes = [...new Set(students.map(s => s.className).filter(Boolean))].sort();

  const filteredStudents = students.filter(s => {
    if (classFilter && s.className !== classFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!s.name.toLowerCase().includes(q) && !s.studentId.toLowerCase().includes(q) && !s.roll.includes(q)) return false;
    }
    return true;
  });

  const toggleStudent = (id: string) => {
    setSelectedStudents(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedStudents.size === filteredStudents.length) {
      setSelectedStudents(new Set());
    } else {
      setSelectedStudents(new Set(filteredStudents.map(s => s.id)));
    }
  };

  const handleLink = async () => {
    if (!selectedParent) return toast('Select a parent', 'error');
    if (selectedStudents.size === 0) return toast('Select at least one student', 'error');
    setLinking(true);
    let successCount = 0;
    for (const studentId of selectedStudents) {
      try {
        await api.post('/parents/links/', { parentId: selectedParent, studentId });
        successCount++;
      } catch (err: any) {
        toast(err.response?.data?.error || 'Failed to link', 'error');
      }
    }
    if (successCount > 0) {
      toast(`Linked ${successCount} student(s)`, 'success');
      setSelectedStudents(new Set());
      setSelectedParent('');
      fetchAll();
    }
    setLinking(false);
  };

  const handleUnlink = async (id: string) => {
    try {
      await api.delete('/parents/links/', { data: { id } });
      toast('Link removed', 'success');
      fetchAll();
    } catch { toast('Failed to remove link', 'error'); }
  };

  const handleBlock = async () => {
    const email = blockEmail.trim().toLowerCase();
    if (!email) return;
    try {
      await api.post('/parents/blocked-emails/', { email });
      toast('Email blocked', 'success');
      setBlockEmail('');
      fetchBlocked();
    } catch (e) {
      toast(getErrorMessage(e), 'error');
    }
  };

  const handleUnblock = async (email: string) => {
    try {
      await api.delete('/parents/blocked-emails/', { data: { email } });
      toast('Email unblocked', 'success');
      fetchBlocked();
    } catch { toast('Failed to unblock', 'error'); }
  };

  return (
    <Layout>
      <div className="space-y-6 animate-fade-in max-w-5xl mx-auto">
        <div>
          <h2 className="font-serif text-xl sm:text-2xl text-school-primary dark:text-[#e0e0e8]">Parent-Student Connections</h2>
          <p className="text-xs text-school-muted">Manage links between parents and students</p>
        </div>

        {/* Link Form */}
        <div className="bg-white dark:bg-[#1a1a2e] rounded-xl border border-school-border dark:border-[#2a2a3e] p-4">
          <h3 className="font-bold text-sm text-school-primary dark:text-[#e0e0e8] mb-3 flex items-center gap-2">
            <Link2 size={16} className="text-school-accent" /> Link a Parent to Students
          </h3>

          <select value={selectedParent} onChange={e => setSelectedParent(e.target.value)}
            className="w-full bg-school-paper dark:bg-[#252540] border border-school-border dark:border-[#2a2a3e] p-2.5 rounded-lg text-sm outline-none focus:border-school-accent mb-3">
            <option value="">Select parent...</option>
            {parents.map(p => (
              <option key={p.id} value={p.id}>{p.name} ({p.email})</option>
            ))}
          </select>

          <div className="flex flex-wrap gap-2 mb-3">
            <select value={classFilter} onChange={e => setClassFilter(e.target.value)}
              className="bg-school-paper dark:bg-[#252540] border border-school-border dark:border-[#2a2a3e] p-2 rounded-lg text-sm outline-none focus:border-school-accent">
              <option value="">All Classes</option>
              {classes.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <div className="relative flex-1 min-w-[180px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-school-muted" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                className="w-full bg-school-paper dark:bg-[#252540] border border-school-border dark:border-[#2a2a3e] p-2 pl-9 rounded-lg text-sm outline-none focus:border-school-accent"
                placeholder="Search students..." />
            </div>
          </div>

          <div className="max-h-48 overflow-y-auto border border-school-border dark:border-[#2a2a3e] rounded-lg">
            <label className="flex items-center gap-2 px-3 py-2 border-b border-school-border dark:border-[#2a2a3e] bg-school-paper/50 dark:bg-[#252540]/50 cursor-pointer select-none text-xs font-semibold text-school-muted sticky top-0">
              <input type="checkbox" checked={selectedStudents.size === filteredStudents.length && filteredStudents.length > 0}
                onChange={toggleAll} className="w-4 h-4 rounded" />
              {selectedStudents.size > 0 ? `${selectedStudents.size} selected` : `Select All (${filteredStudents.length})`}
            </label>
            {filteredStudents.map(s => (
              <label key={s.id}
                className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-school-paper/50 dark:hover:bg-[#252540]/50 text-sm ${selectedStudents.has(s.id) ? 'bg-school-accent/5' : ''}`}>
                <input type="checkbox" checked={selectedStudents.has(s.id)}
                  onChange={() => toggleStudent(s.id)} className="w-4 h-4 rounded" />
                <span className="font-semibold text-school-primary dark:text-[#e0e0e8] flex-1">{s.name}</span>
                <span className="text-xs text-school-muted">{s.className}</span>
                <span className="text-xs text-school-muted">Roll: {s.roll || '-'}</span>
              </label>
            ))}
          </div>

          <button onClick={handleLink} disabled={linking || !selectedParent || selectedStudents.size === 0}
            className="mt-3 flex items-center gap-1 px-4 py-2 bg-school-accent text-white text-xs font-bold rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity">
            {linking ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Link2 size={14} />}
            {linking ? 'Linking...' : `Link ${selectedStudents.size > 0 ? `(${selectedStudents.size})` : ''}`}
          </button>
        </div>

        {/* Email Ban */}
        <div className="bg-white dark:bg-[#1a1a2e] rounded-xl border border-school-border dark:border-[#2a2a3e] p-4">
          <h3 className="font-bold text-sm text-school-primary dark:text-[#e0e0e8] mb-3 flex items-center gap-2">
            <ShieldOff size={16} className="text-rose-500" /> Blocked Emails
          </h3>
          <div className="flex gap-2 mb-3">
            <input value={blockEmail} onChange={e => setBlockEmail(e.target.value)}
              type="email"
              className="flex-1 bg-school-paper dark:bg-[#252540] border border-school-border dark:border-[#2a2a3e] p-2.5 rounded-lg text-sm outline-none focus:border-school-accent"
              placeholder="email@example.com" />
            <button onClick={handleBlock} disabled={!blockEmail.trim()}
              className="px-4 py-2 bg-rose-500 text-white text-xs font-bold rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity">
              Block
            </button>
          </div>
          {blockedEmails.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {blockedEmails.map(email => (
                <span key={email} className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 rounded-lg text-xs text-rose-700 dark:text-rose-300">
                  {email}
                  <button onClick={() => handleUnblock(email)} className="hover:text-rose-900 dark:hover:text-rose-100">
                    <Unlink size={12} />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-school-muted">No blocked emails</p>
          )}
        </div>

        {/* Existing Links */}
        <div className="bg-white dark:bg-[#1a1a2e] rounded-xl border border-school-border dark:border-[#2a2a3e] p-4">
          <h3 className="font-bold text-sm text-school-primary dark:text-[#e0e0e8] mb-3 flex items-center gap-2">
            <Users size={16} className="text-school-accent" /> Existing Links ({links.length})
          </h3>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-school-primary/20 border-t-school-primary rounded-full animate-spin" />
            </div>
          ) : links.length === 0 ? (
            <p className="text-sm text-school-muted text-center py-4">No links yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-school-border dark:border-[#2a2a3e]">
                    <th className="text-left py-2 px-2 text-[10px] font-bold uppercase text-school-muted">Parent</th>
                    <th className="text-left py-2 px-2 text-[10px] font-bold uppercase text-school-muted">Student</th>
                    <th className="text-left py-2 px-2 text-[10px] font-bold uppercase text-school-muted">Roll</th>
                    <th className="text-left py-2 px-2 text-[10px] font-bold uppercase text-school-muted">Since</th>
                    <th className="w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {links.map(link => (
                    <tr key={link.id} className="border-b border-school-border/50 dark:border-[#2a2a3e]/50 hover:bg-school-paper/50 dark:hover:bg-[#252540]/50">
                      <td className="py-2 px-2">
                        <p className="font-semibold text-school-primary dark:text-[#e0e0e8]">{link.parentName}</p>
                        <p className="text-[10px] text-school-muted">{link.parentEmail}</p>
                      </td>
                      <td className="py-2 px-2 font-semibold text-school-primary dark:text-[#e0e0e8]">{link.studentName}</td>
                      <td className="py-2 px-2 text-school-muted">{link.studentRoll || '-'}</td>
                      <td className="py-2 px-2 text-xs text-school-muted">{new Date(link.createdAt).toLocaleDateString()}</td>
                      <td className="py-2 px-2 text-right">
                        <button onClick={() => handleUnlink(link.id)}
                          className="p-1.5 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 rounded-lg transition-colors"
                          title="Unlink">
                          <Unlink size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
