import { useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import {
  School, BookOpen, ShieldAlert, CheckCircle2, UserPlus, LogIn, Eye, EyeOff, Link2,
} from 'lucide-react';
import { SCHOOL_LOGO } from '../../lib/logo';
import { api } from '../../stores/api';
import { useAuthStore } from '../../stores/auth';

type Info =
  | { valid: false; status: 'invalid' | 'revoked' | 'expired' }
  | { valid: true; status: 'claimed'; claimedByMe: boolean; studentName: string; className?: string }
  | {
      valid: true; status: 'unclaimed';
      studentName: string; studentRoll?: string | null; className?: string;
      hasIdFacts: boolean; authenticated: boolean; isParent: boolean;
      alreadyLinked: boolean; familyLinked: boolean;
    };

const inputCls =
  'w-full bg-white border border-school-border p-3 rounded-xl focus:border-school-accent focus:ring-[3px] focus:ring-school-accent/15 outline-none transition-all text-sm';
const labelCls = 'text-[10px] font-bold uppercase text-school-muted ml-1';

const ConnectParent = () => {
  const { token } = useParams<{ token: string }>();

  const [info, setInfo] = useState<Info | null>(null);
  const [order, setOrder] = useState<'idle' | 'create' | 'login' | 'add' | 'done'>('idle');
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [needId, setNeedId] = useState(false); // family check failed -> ask ID-card facts
  const [showId, setShowId] = useState(true);
  const [showPwd, setShowPwd] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [idFields, setIdFields] = useState({ fatherName: '', motherName: '', contact: '' });

  useEffect(() => {
    document.title = 'Connect - AL RAWA English School';
  }, []);

  useEffect(() => {
    if (!token) {
      setInfo({ valid: false, status: 'invalid' });
      return;
    }
    (async () => {
      try {
        const res = await api.get(`/parents/connect/${token}/`);
        setInfo(res.data);
      } catch {
        setInfo({ valid: false, status: 'invalid' });
      }
    })();
  }, [token]);

  useEffect(() => {
    if (info && info.valid && info.status === 'unclaimed') {
      setShowId(info.hasIdFacts);
    }
  }, [info]);

  const goPortal = () => {
    window.location.hash = '#/parent';
  };

  const claim = async (payload: any) => {
    setLoading(true);
    setError('');
    setSuccessMsg('');
    try {
      const res = await api.post(`/parents/connect/${token}/`, payload);
      await useAuthStore.getState().fetchSession();
      if (res.data?.status === 'created') {
        setSuccessMsg('Guardian account created. Your child is now connected.');
      } else if (res.data?.status === 'linked') {
        setSuccessMsg('Connected! This child is now in your guardian portal.');
      } else if (res.data?.status === 'already_linked') {
        setSuccessMsg('You are already connected to this student.');
      }
      setOrder('done');
      return true;
    } catch (e: any) {
      const data = e.response?.data || {};
      if (data.code === 'family_exists' || data.code === 'email_exists') {
        setOrder('login');
        if (data.code === 'email_exists' && data.email) setEmail(data.email);
        setError(data.error || 'Sign in with your existing guardian account.');
      } else if (e.response?.status === 409) {
        setNeedId(true);
        setError(data.error || 'Please verify the details on the student ID card.');
      } else {
        setError(data.error || 'Something went wrong. Please try again.');
      }
      return false;
    } finally {
      setLoading(false);
    }
  };

  const idFacts = (
    <div className="space-y-3">
      <p className="text-xs text-school-muted flex items-start gap-1.5">
        <ShieldAlert size={14} className="text-school-accent flex-shrink-0 mt-0.5" />
        Verify the student's ID card to continue.
      </p>
      <div>
        <label className={labelCls}>Father's name</label>
        <input className={inputCls} value={idFields.fatherName}
          onChange={(e) => setIdFields({ ...idFields, fatherName: e.target.value })} />
      </div>
      <div>
        <label className={labelCls}>Mother's name</label>
        <input className={inputCls} value={idFields.motherName}
          onChange={(e) => setIdFields({ ...idFields, motherName: e.target.value })} />
      </div>
      <div>
        <label className={labelCls}>Contact number (as shown on the ID card)</label>
        <input className={inputCls} type="tel" placeholder="01XXXXXXXXX" value={idFields.contact}
          onChange={(e) => setIdFields({ ...idFields, contact: e.target.value })} />
      </div>
    </div>
  );

  const passwordField = (
    <div>
      <label className={labelCls}>Password</label>
      <div className="relative">
        <input className={`${inputCls} pr-11`} type={showPwd ? 'text' : 'password'} required value={password}
          onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
        <button type="button" onClick={() => setShowPwd(!showPwd)} tabIndex={-1}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg hover:bg-school-accent/10 text-school-muted hover:text-school-accent transition-colors"
          aria-label={showPwd ? 'Hide password' : 'Show password'}>
          {showPwd ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
    </div>
  );

  const spinner = (
    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
  );

  let body: ReactNode = null;

  if (!info) {
    body = (
      <div className="flex items-center justify-center py-16">
        <div className="w-8 h-8 border-3 border-school-primary/30 border-t-school-primary rounded-full animate-spin" />
      </div>
    );
  } else if (!info.valid) {
    const msgs: Record<string, { title: string; body: string }> = {
      invalid: { title: 'This link is not valid', body: 'It may be incomplete or corrupted.' },
      revoked: { title: 'This link was revoked', body: 'The school has disabled this link. Please ask the office for a new one.' },
      expired: { title: 'This link has expired', body: 'Links are valid for 90 days. Please ask the school office for a fresh link.' },
    };
    const m = msgs[info.status];
    body = (
      <div className="text-center space-y-4">
        <div className="w-16 h-16 rounded-full bg-rose-100 dark:bg-rose-500/10 flex items-center justify-center mx-auto">
          <ShieldAlert size={30} className="text-rose-500" />
        </div>
        <h2 className="text-xl font-bold text-school-primary dark:text-white">{m.title}</h2>
        <p className="text-sm text-school-muted">{m.body}</p>
        <p className="text-xs text-school-muted">Contact the school office for assistance.</p>
      </div>
    );
  } else if (info.status === 'claimed') {
    body = info.claimedByMe ? (
      <div className="text-center space-y-4">
        <CheckCircle2 size={44} className="text-emerald-500 mx-auto" />
        <h2 className="text-xl font-bold text-school-primary dark:text-white">Already connected</h2>
        <p className="text-sm text-school-muted">{info.studentName} is in your guardian portal.</p>
        <button onClick={goPortal}
          className="w-full bg-gradient-to-r from-school-accent to-school-accent/90 hover:from-school-accent/90 text-white font-bold py-3 rounded-xl transition-all active:scale-[0.98] flex items-center justify-center gap-2">
          <School size={18} /> Open guardian portal
        </button>
      </div>
    ) : (
      <div className="text-center space-y-4">
        <ShieldAlert size={40} className="text-school-accent mx-auto" />
        <h2 className="text-xl font-bold text-school-primary dark:text-white">Already connected</h2>
        <p className="text-sm text-school-muted">
          {info.studentName} is already connected to a guardian account. If this is a mistake, contact the school office.
        </p>
      </div>
    );
  } else {
    // unclaimed
    if (order === 'done') {
      body = (
        <div className="text-center space-y-4">
          <CheckCircle2 size={44} className="text-emerald-500 mx-auto" />
          <h2 className="text-xl font-bold text-school-primary dark:text-white">You're all set</h2>
          <p className="text-sm text-school-muted">{successMsg || `${info.studentName} is connected.`}</p>
          <button type="button" onClick={goPortal}
            className="w-full bg-gradient-to-r from-school-accent to-school-accent/90 hover:from-school-accent/90 text-white font-bold py-3 rounded-xl transition-all active:scale-[0.98] flex items-center justify-center gap-2">
            <School size={18} /> Open guardian portal
          </button>
        </div>
      );
    } else if (info.authenticated && info.isParent) {
      if (info.alreadyLinked) {
        body = (
          <div className="text-center space-y-4">
            <CheckCircle2 size={44} className="text-emerald-500 mx-auto" />
            <h2 className="text-xl font-bold text-school-primary dark:text-white">Already connected</h2>
            <p className="text-sm text-school-muted">{info.studentName} is in your guardian portal.</p>
            <button type="button" onClick={goPortal}
              className="w-full bg-gradient-to-r from-school-accent to-school-accent/90 text-white font-bold py-3 rounded-xl transition-all active:scale-[0.98] flex items-center justify-center gap-2">
              <School size={18} /> Open guardian portal
            </button>
          </div>
        );
      } else {
        body = (
          <div className="space-y-4">
            <div className="text-center">
              <Link2 size={34} className="text-school-accent mx-auto mb-2" />
              <h2 className="text-lg font-bold text-school-primary dark:text-white">
                Add {info.studentName} to your account
              </h2>
              <p className="text-xs text-school-muted mt-1">Connect this student to your existing guardian portal.</p>
            </div>
            {error && (
              <div className="bg-rose-50 border border-rose-200 text-rose-600 p-3 rounded-xl text-sm">{error}</div>
            )}
            {needId && (
              <div className="bg-school-paper border border-school-border rounded-xl p-4">{idFacts}</div>
            )}
            <button type="button" onClick={() => claim(needId ? { ...idFields } : {})} disabled={loading}
              className="w-full bg-gradient-to-r from-school-accent to-school-accent/90 text-white font-bold py-3 rounded-xl transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50">
              {loading ? spinner : <><UserPlus size={18} /> Add {info.studentName}</>}
            </button>
          </div>
        );
      }
    } else if (info.familyLinked) {
      body = (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); claim({ mode: 'login', email, password, ...idFields }); }}>
          <div className="text-center">
            <LogIn className="mx-auto mb-2 text-school-accent" size={30} />
            <h2 className="text-lg font-bold text-school-primary dark:text-white">This child's family is connected</h2>
            <p className="text-xs text-school-muted mt-1">Sign in with your guardian account to link {info.studentName}.</p>
          </div>
          {error && <div className="bg-rose-50 border border-rose-200 text-rose-600 p-3 rounded-xl text-sm">{error}</div>}
          <div>
            <label className={labelCls}>Guardian email</label>
            <input className={inputCls} type="email" required value={email} placeholder="you@example.com"
              onChange={(e) => setEmail(e.target.value)} />
          </div>
          {passwordField}
          {needId && <div className="bg-school-paper rounded-xl border border-school-border p-4">{idFacts}</div>}
          <button type="submit" disabled={loading}
            className="w-full bg-gradient-to-r from-school-accent to-school-accent/90 text-white font-bold py-3 rounded-xl transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50">
            {loading ? spinner : <><LogIn size={18} /> Sign in & connect</>}
          </button>
        </form>
      );
    } else {
      body = (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); claim({ mode: 'create', name, email, password, ...idFields }); }}>
          <div className="text-center">
            <UserPlus className="mx-auto mb-2 text-school-accent" size={30} />
            <h2 className="text-lg font-bold text-school-primary dark:text-white">Create your guardian account</h2>
            <p className="text-xs text-school-muted mt-1">Connect {info.studentName} and any other children in your family.</p>
          </div>
          {error && <div className="bg-rose-50 border border-rose-200 text-rose-600 p-3 rounded-xl text-sm">{error}</div>}
          <div>
            <label className={labelCls}>Your full name</label>
            <input className={inputCls} required value={name} placeholder="e.g. Mohammed Rahman"
              onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Email</label>
            <input className={inputCls} type="email" required value={email} placeholder="you@example.com"
              onChange={(e) => setEmail(e.target.value)} />
          </div>
          {passwordField}
          <div>
            <label className={labelCls}>Confirm password</label>
            <input className={inputCls} type={showPwd ? 'text' : 'password'} required value={confirm}
              onChange={(e) => setConfirm(e.target.value)} />
          </div>
          {showId ? (
            idFacts
          ) : (
            <p className="text-xs text-school-muted flex items-start gap-1.5">
              <ShieldAlert size={14} className="text-school-accent flex-shrink-0 mt-0.5" />
              No parent details are on file for this student. You can create the account now; if anything looks
              wrong, ask the office to add your details to the ID card.
            </p>
          )}
          <button type="submit" disabled={loading || (password !== confirm)}
            className="w-full bg-gradient-to-r from-school-accent to-school-accent/90 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-all active:scale-[0.98] flex items-center justify-center gap-2">
            {loading ? spinner : <><CheckCircle2 size={18} /> Create account & connect</>}
          </button>
          <p className="text-center text-xs text-school-muted">
            Already have a guardian account?{' '}
            <button type="button" className="text-school-accent font-semibold hover:underline" onClick={() => setOrder('login')}>
              Sign in instead
            </button>
          </p>
        </form>
      );
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-school-primary via-school-secondary to-school-accent2 flex items-center justify-center p-4">
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
          <div className="p-7">
            {info && info.valid && (
              <div className="mb-4 inline-flex items-center gap-2 bg-school-paper px-4 py-1.5 rounded-full border border-school-border">
                <School size={14} className="text-school-accent" />
                <span className="text-xs font-bold text-school-primary dark:text-[#e0e0e8]">
                  {info.studentName}
                  {info.className ? ` — ${info.className}` : ''}
                </span>
              </div>
            )}
            {body}
            <div className="mt-6 pt-4 border-t border-school-border/50 flex items-center gap-1.5 text-[10px] text-school-muted justify-center">
              <BookOpen size={12} />
              <span>This one-time link verifies the student ID card and connects your guardian account.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConnectParent;