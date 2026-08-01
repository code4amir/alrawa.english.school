import { useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import { api } from '../store';
import { Link } from 'react-router-dom';
import { UserPlus, ShieldAlert, MailCheck, School, User } from 'lucide-react';
import { SCHOOL_LOGO } from '../lib/logo';

const PARENT_FIELDS: { key: string; label: string; placeholder: string; type?: string }[] = [
  { key: 'child_name', label: "Student's Full Name", placeholder: 'John Smith' },
  { key: 'roll', label: "Student's Roll No", placeholder: '25' },
  { key: 'father_name', label: "Father's Name", placeholder: 'Robert Smith' },
  { key: 'mother_name', label: "Mother's Name", placeholder: 'Jane Smith' },
  { key: 'phone', label: 'Your Phone Number', placeholder: '01712345678', type: 'tel' },
];

const Register = () => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [setupMode, setSetupMode] = useState<boolean | null>(null);

  useEffect(() => { document.title = 'Register - AL RAWA English School'; }, []);
  useEffect(() => {
      api.get('/setup/status/')
      .then(res => setSetupMode(!res.data.initialized))
      .catch(() => setSetupMode(false));
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const endpoint = setupMode ? '/setup/init/' : '/auth/register/';
      const payload: Record<string, string> = { name, email, password };
      if (!setupMode) {
        for (const f of PARENT_FIELDS) {
          if (extra[f.key]) payload[f.key] = extra[f.key];
        }
      }
      const res = await api.post(endpoint, payload);
      if (res.data?.error) {
        setError(res.data.error);
        return;
      }
      setRegistered(true);
      setNeedsVerification(!setupMode && !res.data?.emailVerified);
    } catch (err: any) {
      const data = err.response?.data;
      if (typeof data === 'string') {
        setError(data);
      } else if (data?.detail) {
        setError(data.detail);
      } else if (data && typeof data === 'object') {
        const msgs = Object.entries(data).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`);
        setError(msgs.join(' | '));
      } else {
        setError('Failed to register. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setExtra(p => ({ ...p, [k]: e.target.value }));

  return (
    <div className="min-h-screen bg-gradient-to-br from-school-primary via-school-secondary to-school-accent2 flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 rounded-full bg-white/5 blur-3xl" />
      </div>

      <div className="w-full max-w-md relative animate-fade-in">
        <div className="bg-school-paper rounded-3xl shadow-2xl overflow-hidden">
          <div className="bg-gradient-to-r from-school-primary to-school-secondary p-8 text-white text-center relative overflow-hidden">
            <div className="absolute inset-0 bg-white/5 [mask-image:radial-gradient(ellipse_at_top,transparent_30%,black_70%)]" />
            <div className="relative">
              <img src={SCHOOL_LOGO} alt="AL RAWA" className="w-16 h-16 rounded-full mx-auto mb-3 border-2 border-white/20 shadow-lg object-cover" />
              <h1 className="font-serif text-2xl">AL RAWA</h1>
              <p className="text-[10px] uppercase tracking-[0.3em] opacity-60 mt-1">English School</p>
            </div>
          </div>

          {registered ? (
            <div className="p-8 text-center space-y-4">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <MailCheck size={32} className="text-green-600" />
              </div>
              <h2 className="text-xl font-bold text-school-primary">
                Registration Successful
              </h2>
              <p className="text-sm text-school-muted">
                Account created for<br />
                <span className="font-semibold text-school-primary">{email}</span>
                <br />{needsVerification ? 'Please check your email to verify your account.' : 'You can now sign in.'}
              </p>
              <Link to="/login"
                className="inline-block w-full bg-gradient-to-r from-school-primary to-school-secondary hover:from-school-secondary hover:to-school-primary text-white font-bold py-4 rounded-xl shadow-lg transition-all text-center"
              >
                Go to Sign In
              </Link>
            </div>
          ) : (
          <form onSubmit={handleSubmit} className="p-7 space-y-5">
            <div className="text-center">
              <div className="inline-flex items-center gap-2 bg-school-paper px-4 py-1.5 rounded-full border border-school-border">
                <School size={14} className="text-school-accent" />
                <span className="text-[10px] font-bold uppercase text-school-muted tracking-wider">
                  {setupMode ? 'Initial Setup' : 'Parent Registration'}
                </span>
              </div>
            </div>

            {error && (
              <div className="bg-rose-50 border border-rose-200 text-rose-600 p-3 rounded-xl flex items-center gap-3 text-sm shake-1">
                <ShieldAlert size={20} className="flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-3">
              {!setupMode && (
                <>
                  <div className="flex items-center gap-2 pt-2 pb-1">
                    <User size={14} className="text-school-accent" />
                    <span className="text-[10px] font-bold uppercase text-school-muted tracking-wider">Student Information</span>
                  </div>
                  {PARENT_FIELDS.map(f => (
                    <div key={f.key}>
                      <label htmlFor={`reg-${f.key}`} className="text-[10px] font-bold uppercase text-school-muted ml-1">{f.label}</label>
                      <input id={`reg-${f.key}`} type={f.type || 'text'} required value={extra[f.key] || ''} onChange={set(f.key)}
                        className="w-full bg-white border border-school-border p-3 rounded-xl focus:ring-2 focus:ring-school-accent focus:border-transparent outline-none transition-all text-sm"
                        placeholder={f.placeholder} />
                    </div>
                  ))}
                </>
              )}
              <div className="flex items-center gap-2 pt-2 pb-1">
                <School size={14} className="text-school-accent" />
                <span className="text-[10px] font-bold uppercase text-school-muted tracking-wider">Account Information</span>
              </div>
              <div>
                <label htmlFor="reg-name" className="text-[10px] font-bold uppercase text-school-muted ml-1">{setupMode ? 'Full Name' : 'Your Name'}</label>
                <input id="reg-name" type="text" required value={name} onChange={(e) => setName(e.target.value)}
                  className="w-full bg-white border border-school-border p-3 rounded-xl focus:ring-2 focus:ring-school-accent focus:border-transparent outline-none transition-all text-sm"
                  placeholder={setupMode ? 'Admin Name' : 'Your Name'} />
              </div>
              <div>
                <label htmlFor="reg-email" className="text-[10px] font-bold uppercase text-school-muted ml-1">Email Address</label>
                <input id="reg-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-white border border-school-border p-3 rounded-xl focus:ring-2 focus:ring-school-accent focus:border-transparent outline-none transition-all text-sm"
                  placeholder="you@example.com" />
              </div>
              <div>
                <label htmlFor="reg-password" className="text-[10px] font-bold uppercase text-school-muted ml-1">Password</label>
                <input id="reg-password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-white border border-school-border p-3 rounded-xl focus:ring-2 focus:ring-school-accent focus:border-transparent outline-none transition-all text-sm"
                  placeholder="••••••••" />
              </div>
              <div>
                <label htmlFor="reg-confirm" className="text-[10px] font-bold uppercase text-school-muted ml-1">Confirm Password</label>
                <input id="reg-confirm" type="password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full bg-white border border-school-border p-3 rounded-xl focus:ring-2 focus:ring-school-accent focus:border-transparent outline-none transition-all text-sm"
                  placeholder="••••••••" />
              </div>
            </div>

            <button type="submit" disabled={loading || setupMode === null}
              className="w-full bg-gradient-to-r from-school-primary to-school-secondary hover:from-school-secondary hover:to-school-primary text-white font-bold py-3.5 rounded-xl shadow-lg hover:shadow-xl active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50 text-sm"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <><UserPlus size={18} /><span>{setupMode ? 'Complete Setup' : 'Register'}</span></>
              )}
            </button>

            <p className="text-center text-xs text-school-muted">
              Already have an account?{' '}
              <Link to="/login" className="text-school-accent font-semibold hover:underline">Sign In</Link>
            </p>
            <p className="text-center text-[10px] text-school-muted/70">
              Registration is for parents/guardians. Staff & teacher accounts are created by the school.
            </p>
          </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default Register;
