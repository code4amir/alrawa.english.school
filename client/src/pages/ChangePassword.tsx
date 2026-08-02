import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useAuthStore } from '../store';
import Toast, { toast } from '../components/Toast';
import { Loader2, KeyRound, Eye, EyeOff } from 'lucide-react';

export default function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  if (!user) {
    navigate('/', { replace: true });
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next.length < 8) {
      toast('New password must be at least 8 characters.', 'error');
      return;
    }
    if (next !== confirm) {
      toast('New passwords do not match.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/auth/change-password/', {
        current_password: current,
        new_password: next,
      });
      // Clear the forced-password-change flag so the app doesn't bounce back here
      const me = useAuthStore.getState().user;
      if (me) useAuthStore.setState({ user: { ...me, mustChangePassword: false } });
      toast('Password changed successfully.', 'success');
      setTimeout(() => navigate('/', { replace: true }), 600);
    } catch (err: any) {
      const msg =
        err.response?.data?.current_password?.[0] ||
        err.response?.data?.error ||
        err.response?.data?.detail ||
        'Failed to change password.';
      toast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const eyeBtn = (
    <button
      type="button"
      onClick={() => setShow((s) => !s)}
      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg hover:bg-school-accent/10 text-school-muted"
      tabIndex={-1}
      aria-label={show ? 'Hide password' : 'Show password'}
    >
      {show ? <EyeOff size={18} /> : <Eye size={18} />}
    </button>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-school-primary via-school-secondary to-school-accent2 flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 rounded-full bg-white/5 blur-3xl" />
      </div>

      <div className="w-full max-w-md relative animate-fade-in">
        <div className="bg-school-paper rounded-3xl shadow-2xl overflow-hidden">
          <div className="bg-gradient-to-r from-school-accent to-school-accent/90 p-6 text-white text-center">
            <KeyRound size={32} className="mx-auto mb-2" />
            <h2 className="font-bold text-lg">Change Password</h2>
            <p className="text-sm opacity-80 mt-1">{user.name}</p>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div>
              <label className="text-[10px] font-bold uppercase text-school-muted ml-1">Current Password</label>
              <div className="relative">
                <input
                  type={show ? 'text' : 'password'} required value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  className="w-full bg-white border border-school-border p-3 pr-11 rounded-xl text-sm focus:outline-none focus:border-school-accent"
                  placeholder="••••••••"
                />
                {eyeBtn}
              </div>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-school-muted ml-1">New Password</label>
              <div className="relative">
                <input
                  type={show ? 'text' : 'password'} required value={next}
                  onChange={(e) => setNext(e.target.value)}
                  className="w-full bg-white border border-school-border p-3 pr-11 rounded-xl text-sm focus:outline-none focus:border-school-accent"
                  placeholder="At least 8 characters"
                />
                {eyeBtn}
              </div>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-school-muted ml-1">Confirm New Password</label>
              <div className="relative">
                <input
                  type={show ? 'text' : 'password'} required value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full bg-white border border-school-border p-3 pr-11 rounded-xl text-sm focus:outline-none focus:border-school-accent"
                  placeholder="Re-enter new password"
                />
                {eyeBtn}
              </div>
            </div>

            <button
              type="submit" disabled={submitting}
              className="w-full bg-gradient-to-r from-school-accent to-school-accent/90 hover:from-school-accent/90 hover:to-school-accent text-white font-bold py-3.5 rounded-xl shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2 text-sm"
            >
              {submitting ? <Loader2 size={18} className="animate-spin" /> : <KeyRound size={18} />}
              Change Password
            </button>
          </form>
        </div>
        <Toast />
      </div>
    </div>
  );
}
