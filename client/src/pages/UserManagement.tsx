import { useEffect, useState } from 'react';
import { useAuthStore, useUserManagementStore } from '../store';
import { api } from '../store';
import { Users, Trash2, ChevronDown, AlertTriangle, Check, Clock, UserCheck, UserPlus, Eye, EyeOff } from 'lucide-react';
import Layout from '../components/Layout';
import Toast, { toast, getErrorMessage } from '../components/Toast';

const ROLE_BADGES: Record<string, string> = {
  admin: 'bg-purple-100 text-purple-700 border-purple-200',
  teacher: 'bg-blue-100 text-blue-700 border-blue-200',
  monitor: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  accountant: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  super_viewer: 'bg-gray-100 text-gray-600 border-gray-200',
  viewer: 'bg-amber-50 text-amber-600 border-amber-200',
};

const UserManagement: React.FC = () => {
  const { user: currentUser } = useAuthStore();
  const { users, roles, fetchUsers, fetchRoles, updateRole, deleteUser } = useUserManagementStore();
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [unlinkedTeachers, setUnlinkedTeachers] = useState<any[]>([]);

  // Create staff state
  const [showCreateStaff, setShowCreateStaff] = useState(false);
  const [staffName, setStaffName] = useState('');
  const [staffEmail, setStaffEmail] = useState('');
  const [staffRole, setStaffRole] = useState('teacher');
  const [staffPassword, setStaffPassword] = useState('');
  const [creatingStaff, setCreatingStaff] = useState(false);
  const [staffTeacherId, setStaffTeacherId] = useState('');
  const [showStaffPassword, setShowStaffPassword] = useState(false);

  const handleCreateStaff = async () => {
    if (!staffName || !staffEmail || !staffPassword) return toast('Fill all fields', 'error');
    if (staffPassword.length < 8) return toast('Password must be at least 8 characters', 'error');
    setCreatingStaff(true);
    try {
      await api.post('/users/create-staff/', { name: staffName, email: staffEmail, role: staffRole, password: staffPassword, teacher_id: staffTeacherId || undefined });
      toast('Staff account created', 'success');
      setShowCreateStaff(false);
      setStaffName('');
      setStaffEmail('');
      setStaffRole('teacher');
      setStaffPassword('');
      setStaffTeacherId('');
      fetchUsers();
    } catch (err: any) {
      toast(getErrorMessage(err), 'error');
    }
    setCreatingStaff(false);
  };

  useEffect(() => { document.title = 'User Management - AL RAWA English School'; }, []);
  useEffect(() => {
    Promise.all([fetchUsers(), fetchRoles()]).finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (currentUser?.role === 'admin') {
      api.get('/teachers/').then(res => {
        setUnlinkedTeachers((res.data?.results || res.data || []).filter((t: any) => !t.userId));
      }).catch(() => {});
    }
  }, [currentUser]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      await updateRole(userId, newRole);
      toast('Role updated', 'success');
    } catch (err: any) {
      toast(typeof err.response?.data?.error === 'string' ? err.response.data.error : 'Failed to update role', 'error');
    }
  };

  const handleQuickAssign = async (userId: string, role: string) => {
    setAssigning(userId);
    try {
      await updateRole(userId, role);
      toast(`Role assigned: ${roles.find((r) => r.value === role)?.label || role}`, 'success');
    } catch (err: any) {
      toast(typeof err.response?.data?.error === 'string' ? err.response.data.error : 'Failed to assign role', 'error');
    } finally {
      setAssigning(null);
    }
  };

  const handleDelete = async (userId: string) => {
    try {
      await deleteUser(userId);
      setConfirmDelete(null);
      toast('User deleted', 'success');
    } catch (err: any) {
      toast(typeof err.response?.data?.error === 'string' ? err.response.data.error : 'Failed to delete user', 'error');
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-3 border-school-primary/20 border-t-school-primary rounded-full animate-spin" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
    <Toast />
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-purple-500 text-white rounded-xl flex items-center justify-center">
          <Users size={20} />
        </div>
        <div>
          <h2 className="font-serif text-xl text-school-primary">User Management</h2>
          <p className="text-xs text-school-muted">{users.length} registered accounts</p>
        </div>
      </div>

      {/* Role Legend */}
      <div className="bg-white rounded-xl border border-school-border p-4">
        <h3 className="text-xs font-bold uppercase text-school-muted mb-3">Role Permissions</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
          <div className="space-y-1">
            <span className="font-bold text-purple-700">Admin</span>
            <p className="text-school-muted">Full access. Manages users & roles.</p>
          </div>
          <div className="space-y-1">
            <span className="font-bold text-blue-700">Teacher</span>
            <p className="text-school-muted">Students, results, classes. No finance.</p>
          </div>
          <div className="space-y-1">
            <span className="font-bold text-emerald-700">Accountant</span>
            <p className="text-school-muted">Finance & transactions. Read-only on students.</p>
          </div>
          <div className="space-y-1">
            <span className="font-bold text-gray-600">Super Viewer</span>
            <p className="text-school-muted">Read-only on all modules.</p>
          </div>
          <div className="space-y-1">
            <span className="font-bold text-amber-600">Viewer <span className="text-[9px] bg-amber-100 px-1.5 py-0.5 rounded-full ml-1">Pending</span></span>
            <p className="text-school-muted">No access until admin assigns a role.</p>
          </div>
        </div>
      </div>

      {/* Create Staff — admin only */}
      {currentUser?.role === 'admin' && (
        <div className="bg-white rounded-xl border border-school-border p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold uppercase text-school-muted">Create Staff Account</h3>
            <button onClick={() => setShowCreateStaff(!showCreateStaff)}
              className="text-xs font-semibold text-school-accent hover:underline">
              {showCreateStaff ? 'Cancel' : 'New Staff'}
            </button>
          </div>
          {showCreateStaff && (
            <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
              <select value={staffTeacherId} onChange={e => {
                const id = e.target.value;
                setStaffTeacherId(id);
                const t = unlinkedTeachers.find(t => t.id === id);
                if (t) { setStaffName(t.name); setStaffEmail(t.email || ''); }
              }}
                className="border border-school-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-school-accent">
                <option value="">— Link to Teacher (optional) —</option>
                {unlinkedTeachers.map(t => (
                  <option key={t.id} value={t.id}>{t.name} — {t.designation || 'Teacher'}</option>
                ))}
              </select>
              <input value={staffName} onChange={e => setStaffName(e.target.value)} placeholder="Full Name"
                className="border border-school-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-school-accent" />
              <input value={staffEmail} onChange={e => setStaffEmail(e.target.value)} placeholder="Email" type="email"
                className="border border-school-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-school-accent" />
              <select value={staffRole} onChange={e => setStaffRole(e.target.value)}
                className="border border-school-border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-school-accent">
                {roles.filter(r => r.value !== 'viewer' && r.value !== 'parent').map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
              <div className="relative">
                <input value={staffPassword} onChange={e => setStaffPassword(e.target.value)} placeholder="Password" type={showStaffPassword ? 'text' : 'password'}
                  className="w-full border border-school-border rounded-lg px-3 py-2 pr-10 text-sm outline-none focus:ring-2 focus:ring-school-accent" />
                <button type="button" onClick={() => setShowStaffPassword(!showStaffPassword)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 rounded-lg hover:bg-school-accent/10 text-school-muted hover:text-school-accent transition-colors"
                  tabIndex={-1} aria-label={showStaffPassword ? 'Hide password' : 'Show password'}>
                  {showStaffPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <button onClick={handleCreateStaff} disabled={creatingStaff}
                className="bg-school-primary hover:bg-school-secondary disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-semibold transition-colors flex items-center justify-center gap-2">
                {creatingStaff ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <><UserPlus size={16} /> Create</>}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Users Table */}
      <div className="bg-white rounded-xl border border-school-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm mobile-card-table">
            <thead>
              <tr className="bg-gray-50 border-b border-school-border">
                <th className="text-left px-4 py-3 text-[10px] font-bold uppercase text-school-muted">User</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold uppercase text-school-muted">Role</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold uppercase text-school-muted">Status</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold uppercase text-school-muted">Joined</th>
                <th className="text-right px-4 py-3 text-[10px] font-bold uppercase text-school-muted">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf = u.id === currentUser?.id;
                const isPending = u.role === 'viewer';
                return (
                  <tr key={u.id} className={`border-b border-gray-100 last:border-0 hover:bg-gray-50/50 transition-colors ${isPending ? 'bg-amber-50/30' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 ${isPending ? 'bg-amber-400' : 'bg-school-primary'} text-white rounded-full flex items-center justify-center text-xs font-bold`}>
                          {u.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-semibold text-school-primary text-sm">
                            {u.name}
                            {isSelf && <span className="text-[10px] text-school-muted ml-1">(you)</span>}
                          </div>
                          <div className="text-[11px] text-school-muted">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {isSelf ? (
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold border ${ROLE_BADGES[u.role] || ROLE_BADGES.viewer}`}>
                          {roles.find((r) => r.value === u.role)?.label || u.role}
                        </span>
                      ) : (
                        <div className="relative">
                          <select
                            value={u.role}
                            onChange={(e) => handleRoleChange(u.id, e.target.value)}
                            className={`appearance-none w-full bg-white border rounded-lg px-3 py-1.5 pr-8 text-xs font-semibold cursor-pointer focus:ring-2 focus:ring-school-accent focus:border-transparent outline-none ${ROLE_BADGES[u.role] || ROLE_BADGES.viewer}`}
                          >
                            {roles.map((r) => (
                              <option key={r.value} value={r.value}>{r.label}</option>
                            ))}
                          </select>
                          <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400" />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {u.role === 'viewer' ? (
                        <span className="inline-flex items-center gap-1 text-amber-600 text-xs font-semibold">
                          <Clock size={12} /> Pending
                        </span>
                      ) : u.emailVerified ? (
                        <span className="inline-flex items-center gap-1 text-green-600 text-xs font-semibold">
                          <Check size={12} /> Verified
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-blue-600 text-xs font-semibold">
                          <UserCheck size={12} /> Assigned
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-school-muted">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isSelf ? (
                        <span className="text-[10px] text-school-muted">—</span>
                      ) : isPending ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => setConfirmDelete(u.id)}
                            className="p-1.5 text-gray-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"
                            title="Delete user"
                            aria-label="Delete user"
                          >
                            <Trash2 size={14} />
                          </button>
                          <div className="relative group">
                            <button
                              onClick={() => handleQuickAssign(u.id, 'super_viewer')}
                              disabled={assigning === u.id}
                              className="p-1.5 text-amber-500 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors disabled:opacity-50"
                              title="Assign role"
                              aria-label="Assign role"
                            >
                              {assigning === u.id ? (
                                <div className="w-3.5 h-3.5 border-2 border-amber-400/30 border-t-amber-500 rounded-full animate-spin" />
                              ) : (
                                <UserCheck size={14} />
                              )}
                            </button>
                            <div className="absolute right-0 top-full mt-1 bg-white border border-school-border rounded-xl shadow-lg p-1 z-10 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all min-w-[140px]">
                              {roles.filter((r) => r.value !== 'viewer').map((r) => (
                                <button
                                  key={r.value}
                                  onClick={() => handleQuickAssign(u.id, r.value)}
                                  className="w-full text-left px-3 py-1.5 text-xs font-semibold rounded-lg hover:bg-gray-100 transition-colors text-school-primary"
                                >
                                  {r.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      ) : confirmDelete === u.id ? (
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-[10px] text-rose-600 flex items-center gap-1">
                            <AlertTriangle size={12} /> Delete?
                          </span>
                          <button
                            onClick={() => handleDelete(u.id)}
                            className="text-[10px] font-bold text-white bg-rose-500 hover:bg-rose-600 px-2 py-1 rounded-lg transition-colors"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => setConfirmDelete(null)}
                            className="text-[10px] font-bold text-gray-500 hover:text-gray-700 px-2 py-1 rounded-lg transition-colors"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDelete(u.id)}
                          className="p-1.5 text-gray-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"
                          title="Delete user"
                          aria-label="Delete user"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      </div>
    </Layout>
    );
  };

export default UserManagement;
