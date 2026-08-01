import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useUIStore, useSchoolStore, useAuthStore } from '../store';
import { api } from '../store';
import Layout from '../components/Layout';
import Toast, { toast } from '../components/Toast';
import Skeleton from '../components/Skeleton';
import IdCardSection from './IdCardSection';
import AccessoriesSection from './AccessoriesSection';
import ResultSection from './ResultSection';
import FinanceSection from './FinanceSection';
import AttendanceSection from './AttendanceSection';
import AdminRoutine from './AdminRoutine';
import ExamRoutineAdmin from './ExamRoutineAdmin';
import SessionYearSection from './SessionYearSection';
import AdminAnnouncements from './AdminAnnouncements';
import ServiceTypeManager from './admin/ServiceTypeManager';
import EngagementWidget, { QuizPanel, RiddlePanel, MoodPanel, ChallengePanel, TipsPanel, PlannerPanel } from './engagement/EngagementWidget';
import { CreditCard, BookOpen, BarChart3, Wallet, Users, GraduationCap, Building2, Sparkles, ArrowRight, Clock, MailCheck, CalendarCheck, UserCheck, ClipboardList, Calendar, CalendarDays, Megaphone, Settings } from 'lucide-react';
import { SCHOOL_LOGO } from '../lib/logo';

type ModeParam = 'idcard' | 'accessories' | 'result' | 'finance' | 'attendance' | 'routine' | 'exam-routine' | 'session-year' | 'announcements' | 'services';

function TodaysGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
}

const Dashboard = () => {
  const { activeMode, setMode } = useUIStore();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { studentTotal, teacherTotal, staffTotal, fetchClasses, fetchDashboardCounts } = useSchoolStore();
  const user = useAuthStore((s) => s.user);
  const isTeacher = user?.role === 'teacher';
  const isMonitor = user?.role === 'monitor';
  const isAdmin = user?.role === 'admin';
  const isPendingViewer = user?.role === 'viewer';
  const urlMode = searchParams.get('mode') as ModeParam | null;
  const effectiveMode: ModeParam | null =
    isPendingViewer || ((urlMode === 'finance') && (isTeacher || isMonitor)) ? null : (activeMode ?? urlMode);
  const handleSetMode = (mode: ModeParam | null) => {
    setMode(mode);
    if (mode) window.location.hash = '#/?mode=' + mode;
    else window.location.hash = '#/';
  };
  const [verifying, setVerifying] = useState(false);
  const [verifySent, setVerifySent] = useState(false);
  const [engagementPanel, setEngagementPanel] = useState<string | null>(null);
  const [countsReady, setCountsReady] = useState(false);

  const handleResendVerification = async () => {
    setVerifying(true);
    try {
      await api.post('/auth/send-verification/');
      setVerifySent(true);
      toast('Verification email sent.', 'success');
    } catch (e) {
      toast('Failed to send verification email. Please try again.', 'error');
      if (import.meta.env.DEV) console.warn('[Dashboard] verification resend failed', e);
    }
    setVerifying(false);
  };

  useEffect(() => { document.title = 'Dashboard - AL RAWA English School'; }, []);
  useEffect(() => {
    Promise.all([fetchDashboardCounts(), fetchClasses()]).then(() => setCountsReady(true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const MODULES = [
    { key: 'idcard' as ModeParam, label: 'ID Card', desc: 'Students, Teachers & Staff', color: 'blue', icon: CreditCard },
    { key: 'accessories' as ModeParam, label: 'Fees & Books', desc: 'Fee structure & book list', color: 'amber', icon: BookOpen },
    { key: 'attendance' as ModeParam, label: 'Attendance', desc: 'Daily marking & monthly view', color: 'purple', icon: CalendarCheck },
    { key: 'result' as ModeParam, label: 'Result', desc: 'Marks & report cards', color: 'green', icon: BarChart3 },
    ...(!isTeacher && !isMonitor && !isPendingViewer ? [{ key: 'finance' as ModeParam, label: 'Finance', desc: 'Accounting & fees', color: 'rose', icon: Wallet }] : []),
    ...(!isTeacher && !isPendingViewer ? [{ key: 'routine' as ModeParam, label: 'Routine', desc: 'Weekly class schedule', color: 'indigo', icon: ClipboardList }] : []),
    ...(!isTeacher && !isPendingViewer ? [{ key: 'exam-routine' as ModeParam, label: 'Exam Schedule', desc: 'Exam timetable management', color: 'cyan', icon: Calendar }] : []),
    ...(!isTeacher && !isPendingViewer ? [{ key: 'session-year' as ModeParam, label: 'Session Year', desc: 'Manage academic years & promote students', color: 'amber', icon: CalendarDays }] : []),
    ...(!isTeacher && !isPendingViewer ? [{ key: 'announcements' as ModeParam, label: 'Announcements', desc: 'Create & manage notices', color: 'purple', icon: Megaphone }] : []),
    ...(!isTeacher && !isPendingViewer ? [{ key: 'services' as ModeParam, label: 'Services', desc: 'Manage service types & auto-fee setup', color: 'sky', icon: Settings }] : []),
  ];

  return (
    <Layout>
      <Toast />

      {!effectiveMode ? (
        <div className="space-y-5 animate-fade-in">
          {/* Welcome Banner */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-school-primary via-school-secondary to-school-accent2 p-6 text-white">
            <div className="absolute inset-0 bg-white/5 [mask-image:radial-gradient(ellipse_at_top_right,black_30%,transparent_70%)]" />
            <div className="absolute top-0 right-0 w-40 h-40 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/4" />
            <div className="relative flex items-center gap-4">
              <button onClick={() => handleSetMode(null)} className="hidden sm:block">
                <img src={SCHOOL_LOGO} alt="School logo" className="w-14 h-14 rounded-full border-2 border-white/20 shadow-lg object-cover cursor-pointer hover:scale-105 transition-transform" />
              </button>
              <div className="flex-1">
                <p className="text-sm text-white/70 font-medium">{TodaysGreeting()}{user?.name ? `, ${user.name.split(' ')[0]}` : ''}</p>
                <h1 className="font-serif text-xl sm:text-2xl mt-0.5">AL RAWA English School</h1>
              </div>
              <div className="hidden sm:flex items-center gap-1 text-[10px] text-white/50 uppercase tracking-wider bg-white/10 px-3 py-1.5 rounded-full">
                <Sparkles size={12} />
                <span>{new Date().getFullYear()} Session</span>
              </div>
            </div>
          </div>

          {/* Email verification notice */}
          {user && !user.emailVerified && !isPendingViewer && (
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 flex items-center gap-4">
              <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                <MailCheck size={20} className="text-blue-500" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-blue-800">Verify your email address</p>
                <p className="text-xs text-blue-600">Check your inbox or resend the verification link.</p>
              </div>
              {verifySent ? (
                <span className="text-xs text-green-600 font-semibold">Sent!</span>
              ) : (
                <button onClick={handleResendVerification} disabled={verifying}
                  className="px-3 py-1.5 bg-blue-500 text-white text-xs font-semibold rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors">
                  {verifying ? 'Sending...' : 'Resend'}
                </button>
              )}
            </div>
          )}

          {/* Pending viewer notice */}
          {isPendingViewer && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-center">
              <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Clock size={32} className="text-amber-500" />
              </div>
              <h3 className="font-serif text-lg font-bold text-amber-800 mb-2">Account Pending</h3>
              <p className="text-sm text-amber-700 max-w-sm mx-auto">
                Your account is awaiting role assignment. Please contact an admin to get access to the system.
              </p>
            </div>
          )}

          {/* Quick Stats */}
          {!isPendingViewer && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {countsReady
              ? ([
                  { icon: GraduationCap, value: studentTotal, label: 'Students', color: 'text-blue-500', bg: 'bg-blue-50 dark:bg-blue-500/10' },
                  { icon: Users, value: teacherTotal, label: 'Teachers', color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-500/10' },
                  { icon: Building2, value: staffTotal, label: 'Staff', color: 'text-green-500', bg: 'bg-green-50 dark:bg-green-500/10' },
                ].map((s) => (
                  <div key={s.label} className="bg-white dark:bg-[#1a1a2e] rounded-xl border border-school-border dark:border-[#2a2a3e] p-4 card-shadow">
                    <div className={`w-9 h-9 ${s.bg} rounded-xl flex items-center justify-center mb-2`}>
                      <s.icon size={18} className={s.color} />
                    </div>
                    <div className="font-bold text-lg text-school-primary dark:text-[#e0e0e8]">{s.value}</div>
                    <div className="text-[10px] text-school-muted uppercase tracking-wider font-bold">{s.label}</div>
                  </div>
                )))
              : <Skeleton type="card" rows={3} className="col-span-full grid-cols-3" />
            }
          </div>
          )}

          {/* Module Tiles */}
          {!isPendingViewer && (
          <div className="grid grid-cols-2 gap-3">
            {MODULES.map((m) => {
              const Icon = m.icon;
              const bgMap: Record<string, string> = { blue: 'from-blue-500 to-blue-700', amber: 'from-amber-500 to-orange-700', green: 'from-green-500 to-emerald-700', rose: 'from-rose-500 to-rose-700', purple: 'from-purple-500 to-purple-700', indigo: 'from-indigo-500 to-indigo-700', cyan: 'from-cyan-500 to-cyan-700', sky: 'from-sky-500 to-sky-700' };
              return (
                <button key={m.key} onClick={() => handleSetMode(m.key)}
                  className="group relative bg-white dark:bg-[#1a1a2e] p-5 rounded-2xl border border-school-border dark:border-[#2a2a3e] text-left card-shadow overflow-hidden"
                >
                  <div className={`w-12 h-12 bg-gradient-to-br ${bgMap[m.color]} text-white rounded-2xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform shadow-sm`}>
                    <Icon size={24} />
                  </div>
                  <div className="font-bold text-sm text-school-primary dark:text-[#e0e0e8]">{m.label}</div>
                  <div className="text-[11px] text-school-muted mt-0.5">{m.desc}</div>
                  <ArrowRight size={14} className="absolute bottom-4 right-4 text-school-muted opacity-0 group-hover:opacity-100 transition-all translate-x-2 group-hover:translate-x-0" />
                </button>
              );
            })}
          </div>
          )}

          {/* Parent Portal — admins can preview */}
          {isAdmin && (
            <button onClick={() => navigate('/parent')}
              className="w-full group relative bg-white dark:bg-[#1a1a2e] p-5 rounded-2xl border border-school-border dark:border-[#2a2a3e] text-left card-shadow overflow-hidden"
            >
              <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-indigo-700 text-white rounded-2xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform shadow-sm">
                <UserCheck size={24} />
              </div>
              <div className="font-bold text-sm text-school-primary dark:text-[#e0e0e8]">Parent Portal</div>
              <div className="text-[11px] text-school-muted mt-0.5">View as parent — attendance, fees, results</div>
              <ArrowRight size={14} className="absolute bottom-4 right-4 text-school-muted opacity-0 group-hover:opacity-100 transition-all translate-x-2 group-hover:translate-x-0" />
            </button>
          )}

          {/* Teacher Portal — admins can preview */}
          {isAdmin && (
            <button onClick={() => navigate('/teacher')}
              className="w-full group relative bg-white dark:bg-[#1a1a2e] p-5 rounded-2xl border border-school-border dark:border-[#2a2a3e] text-left card-shadow overflow-hidden"
            >
              <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-emerald-700 text-white rounded-2xl flex items-center justify-center mb-3 group-hover:scale-110 transition-transform shadow-sm">
                <GraduationCap size={24} />
              </div>
              <div className="font-bold text-sm text-school-primary dark:text-[#e0e0e8]">Teacher Portal</div>
              <div className="text-[11px] text-school-muted mt-0.5">View as teacher — routine, homework, diary</div>
              <ArrowRight size={14} className="absolute bottom-4 right-4 text-school-muted opacity-0 group-hover:opacity-100 transition-all translate-x-2 group-hover:translate-x-0" />
            </button>
          )}

          {/* Engagement Widget — teachers & admins */}
          {(isTeacher || isAdmin) && !isPendingViewer && (
            <EngagementWidget onOpenPanel={(p) => setEngagementPanel(p)} />
          )}
        </div>
      ) : (
        <div className="animate-fade-in">
          {effectiveMode === 'idcard' && <IdCardSection />}
          {effectiveMode === 'accessories' && <AccessoriesSection />}
          {effectiveMode === 'result' && <ResultSection />}
          {effectiveMode === 'finance' && <FinanceSection />}
          {effectiveMode === 'attendance' && <AttendanceSection />}
          {effectiveMode === 'routine' && <AdminRoutine />}
          {effectiveMode === 'exam-routine' && <ExamRoutineAdmin />}
          {effectiveMode === 'session-year' && <SessionYearSection />}
          {effectiveMode === 'announcements' && <AdminAnnouncements />}
          {effectiveMode === 'services' && <ServiceTypeManager />}
        </div>
      )}

      {/* Engagement Panels */}
      {engagementPanel === 'quiz' && <QuizPanel onClose={() => setEngagementPanel(null)} />}
      {engagementPanel === 'riddle' && <RiddlePanel onClose={() => setEngagementPanel(null)} />}
      {engagementPanel === 'mood' && <MoodPanel onClose={() => setEngagementPanel(null)} />}
      {engagementPanel === 'challenge' && <ChallengePanel onClose={() => setEngagementPanel(null)} />}
      {engagementPanel === 'tips' && <TipsPanel onClose={() => setEngagementPanel(null)} />}
      {engagementPanel === 'planner' && <PlannerPanel onClose={() => setEngagementPanel(null)} />}
    </Layout>
  );
};

export default Dashboard;
