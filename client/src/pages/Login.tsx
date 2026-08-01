import { useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import { useAuthStore, useDarkMode } from '../store';
import { Link, useNavigate } from 'react-router-dom';
import { LogIn, ShieldAlert, School, BookOpen, Sun, Moon, Eye, EyeOff, Fingerprint } from 'lucide-react';
import { SCHOOL_LOGO } from '../lib/logo';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasCred, setHasCred] = useState(false);
  const [bioLoading, setBioLoading] = useState(false);
  const login = useAuthStore((state) => state.login);
  const { dark, toggle: toggleDark } = useDarkMode();
  const navigate = useNavigate();

  useEffect(() => { document.title = 'Login - AL RAWA English School'; }, []);
  useEffect(() => { document.documentElement.classList.toggle('dark', dark); }, [dark]);

  // Check for stored credentials on mount
  useEffect(() => {
    if (localStorage.getItem('bio_has_cred')) { setHasCred(true); return; }
    if (!navigator.credentials?.get) return;
    (navigator.credentials.get as any)({ password: true, mediation: 'silent' })
      .then((cred: any) => { if (cred) { setHasCred(true); localStorage.setItem('bio_has_cred', '1'); } })
      .catch(() => {});
  }, []);

  // Try biometric auto-fill
  const handleBioLogin = async () => {
    if (!navigator.credentials?.get) return;
    setBioLoading(true);
    try {
      const cred = await (navigator.credentials.get as any)({ password: true, mediation: 'optional' });
      if (cred?.password) {
        setEmail(cred.id || '');
        setPassword(cred.password);
        setTimeout(async () => {
          try {
            await login(cred.id, cred.password);
            navigate('/', { replace: true });
          } catch { setError('Biometric login failed. Try again.'); }
        }, 100);
      }
    } catch { setError('Biometric authentication cancelled.'); }
    finally { setBioLoading(false); }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { needsLinking } = await login(email, password);
      // Store credential for next biometric login
      try {
        if (navigator.credentials?.store && navigator.credentials?.create) {
          const cred = await (navigator.credentials.create as any)({ password: { id: email, password, name: email.split('@')[0] } });
          if (cred) { await navigator.credentials.store(cred); }
        }
      } catch {}
      localStorage.setItem('bio_has_cred', '1');
      setHasCred(true);
      if (needsLinking) {
        navigate('/link-child', { replace: true });
      } else {
        navigate('/', { replace: true });
      }
    } catch (err: any) {
      const msg = err.response?.data?.detail || err.response?.data?.error || 'Failed to login. Please try again.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-school-primary via-school-secondary to-school-accent2 flex items-center justify-center p-4">
      {/* Decorative background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 rounded-full bg-white/5 blur-3xl" />
      </div>

      <div className="w-full max-w-md relative animate-fade-in">
        <div className="bg-school-paper rounded-3xl shadow-2xl overflow-hidden transition-shadow hover:shadow-[0_8px_30px_rgba(26,26,46,0.12)]">
          {/* Brand Header */}
          <div className="bg-gradient-to-r from-school-primary to-school-secondary p-8 text-white text-center relative overflow-hidden">
            <div className="absolute inset-0 bg-white/5 [mask-image:radial-gradient(ellipse_at_top,transparent_30%,black_70%)]" />
            <button
              onClick={toggleDark}
              className="absolute top-3 right-3 w-[52px] h-[28px] rounded-full bg-white/15 border border-white/20 flex items-center p-[3px] z-10 hover:bg-white/20 transition-colors"
              title={dark ? 'Light Mode' : 'Dark Mode'}
              aria-label={dark ? 'Light Mode' : 'Dark Mode'}
            >
              <div className={`w-5 h-5 rounded-full flex items-center justify-center transition-transform duration-300 ease-in-out ${dark ? 'translate-x-[24px] bg-school-accent' : 'translate-x-0 bg-white shadow-sm'}`}>
                {dark ? <Sun size={12} className="text-white" /> : <Moon size={12} className="text-school-accent" />}
              </div>
            </button>
            <div className="relative">
              <img src={SCHOOL_LOGO} alt="AL RAWA" className="w-16 h-16 rounded-full mx-auto mb-3 border-2 border-white/20 shadow-lg object-cover" />
              <h1 className="font-serif text-2xl">AL RAWA</h1>
              <p className="text-[10px] uppercase tracking-[0.3em] opacity-60 mt-1">English School</p>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-7 space-y-5">
            <div className="text-center">
              <div className="inline-flex items-center gap-2 bg-school-paper px-4 py-1.5 rounded-full border border-school-border">
                <School size={14} className="text-school-accent" />
                <span className="text-[10px] font-bold uppercase text-school-muted tracking-wider">School Portal</span>
              </div>
            </div>

            {error && (
              <div className="bg-rose-50 border border-rose-200 text-rose-600 p-3 rounded-xl flex items-center gap-3 text-sm shake-1">
                <ShieldAlert size={20} className="flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label htmlFor="login-email" className="text-[10px] font-bold uppercase text-school-muted ml-1">Email</label>
                <input
                  id="login-email"
                  type="email" required value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-white border border-school-border p-3 rounded-xl focus:border-school-accent focus:ring-[3px] focus:ring-school-accent/15 outline-none transition-all text-sm"
                  placeholder="you@example.com" />
              </div>
              <div>
                <label htmlFor="login-password" className="text-[10px] font-bold uppercase text-school-muted ml-1">Password</label>
                <div className="relative">
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'} required value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-white border border-school-border p-3 pr-11 rounded-xl focus:border-school-accent focus:ring-[3px] focus:ring-school-accent/15 outline-none transition-all text-sm"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg hover:bg-school-accent/10 text-school-muted hover:text-school-accent transition-colors"
                    tabIndex={-1}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
            </div>

            {hasCred && (
              <button type="button" onClick={handleBioLogin} disabled={bioLoading}
                className="w-full py-3 border border-school-border rounded-xl text-sm font-bold flex items-center justify-center gap-2 hover:bg-school-paper transition-all disabled:opacity-50">
                {bioLoading ? (
                  <div className="w-5 h-5 border-2 border-school-primary/30 border-t-school-primary rounded-full animate-spin" />
                ) : (
                  <><Fingerprint size={18} className="text-school-accent" /> Sign in with Fingerprint</>
                )}
              </button>
            )}

            <button type="submit" disabled={loading}
              className="w-full bg-gradient-to-r from-school-accent to-school-accent/90 hover:from-school-accent/90 hover:to-school-accent text-white font-bold py-3.5 rounded-xl shadow-[0_2px_8px_rgba(200,75,49,0.25)] hover:shadow-[0_4px_16px_rgba(200,75,49,0.35)] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50 text-sm relative overflow-hidden group"
            >
              <span className="absolute inset-0 bg-gradient-to-r from-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <><LogIn size={18} /><span className="relative">Sign In</span></>
              )}
            </button>

            <div className="flex items-center gap-2 text-[10px] text-school-muted justify-center">
              <BookOpen size={12} />
              <span>Authorized personnel only</span>
            </div>

            <p className="text-center text-xs text-school-muted">
              New parent?{' '}
              <Link to="/register" className="text-school-accent font-semibold hover:underline">Register here</Link>
            </p>

            <div className="border-t border-school-border/50 pt-4">
              <button type="button" onClick={() => { window.location.hash = '#/pin-attendance'; }}
                className="flex items-center justify-center gap-2 w-full py-2.5 bg-school-paper border border-school-border rounded-xl text-xs font-bold text-school-primary dark:text-[#e0e0e8] hover:bg-school-border/30 dark:hover:bg-white/5 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                Quick Attendance (Teacher PIN)
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default Login;
