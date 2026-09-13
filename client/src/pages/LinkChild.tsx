import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api, useAuthStore } from '../store';
import Toast, { toast } from '../components/Toast';
import { Loader2, Search, UserPlus } from 'lucide-react';

export default function LinkChild() {
  const [childName, setChildName] = useState('');
  const [roll, setRoll] = useState('');
  const [phone, setPhone] = useState('');
  const [fatherName, setFatherName] = useState('');
  const [motherName, setMotherName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  if (!user || user.role !== 'parent') {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!childName.trim() || !phone.trim()) return;
    setSubmitting(true);
    try {
      await api.post('/auth/link-child/', {
        child_name: childName.trim(),
        roll: roll.trim(),
        phone: phone.trim(),
        father_name: fatherName.trim(),
        mother_name: motherName.trim(),
      });
      toast('Child linked successfully!', 'success');
      setTimeout(() => navigate('/parent', { replace: true }), 800);
    } catch (err: any) {
      const msg = err.response?.data?.error || 'Failed to link child. Check your details and try again.';
      toast(msg, 'error');
    }
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-school-primary via-school-secondary to-school-accent2 flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 rounded-full bg-white/5 blur-3xl" />
      </div>

      <div className="w-full max-w-md relative animate-fade-in">
        <div className="bg-school-paper rounded-3xl shadow-2xl overflow-hidden">
          <div className="bg-gradient-to-r from-school-accent to-school-accent/90 p-6 text-white text-center">
            <UserPlus size={32} className="mx-auto mb-2" />
            <h2 className="font-bold text-lg">Welcome, {user.name}!</h2>
            <p className="text-sm opacity-80 mt-1">Link your child to get started</p>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div>
              <label className="text-[10px] font-bold uppercase text-school-muted ml-1">Child Name *</label>
              <input
                type="text" required value={childName}
                onChange={(e) => setChildName(e.target.value)}
                className="w-full bg-white border border-school-border p-3 rounded-xl text-sm focus:outline-none focus:border-school-accent"
                placeholder="Child's full name"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-school-muted ml-1">Roll</label>
              <input
                type="text" value={roll}
                onChange={(e) => setRoll(e.target.value)}
                className="w-full bg-white border border-school-border p-3 rounded-xl text-sm focus:outline-none focus:border-school-accent"
                placeholder="Roll number (if known)"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-school-muted ml-1">Phone (Contact) *</label>
              <input
                type="tel" required value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full bg-white border border-school-border p-3 rounded-xl text-sm focus:outline-none focus:border-school-accent"
                placeholder="Phone number in school records"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-school-muted ml-1">Father's Name</label>
              <input
                type="text" value={fatherName}
                onChange={(e) => setFatherName(e.target.value)}
                className="w-full bg-white border border-school-border p-3 rounded-xl text-sm focus:outline-none focus:border-school-accent"
                placeholder="Father's name"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-school-muted ml-1">Mother's Name</label>
              <input
                type="text" value={motherName}
                onChange={(e) => setMotherName(e.target.value)}
                className="w-full bg-white border border-school-border p-3 rounded-xl text-sm focus:outline-none focus:border-school-accent"
                placeholder="Mother's name"
              />
            </div>

            <button
              type="submit" disabled={submitting}
              className="w-full bg-gradient-to-r from-school-accent to-school-accent/90 hover:from-school-accent/90 hover:to-school-accent text-white font-bold py-3.5 rounded-xl shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2 text-sm"
            >
              {submitting ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
              Find & Link Child
            </button>

            <p className="text-[10px] text-school-muted text-center">
              Your details will be matched against school records. Contact the school if you have issues.
            </p>
          </form>
        </div>
        <Toast />
      </div>
    </div>
  );
}
