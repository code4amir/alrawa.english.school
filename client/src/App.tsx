import { useEffect, Suspense, lazy, useState } from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store';
import ErrorBoundary from './components/ErrorBoundary';
import NotFound from './pages/NotFound';
import AICommandPalette from './ai/AICommandPalette';
import { usePullToRefresh } from './lib/usePullToRefresh';
import { setInstallPrompt as saveInstallEvent } from './lib/pwa';
import IOSInstallPrompt from './components/IOSInstallPrompt';

const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const PinAttendance = lazy(() => import('./pages/PinAttendance'));
const UserManagement = lazy(() => import('./pages/UserManagement'));
const AuditLogs = lazy(() => import('./pages/AuditLogs'));
const VerifyEmail = lazy(() => import('./pages/VerifyEmail'));
const ParentDashboard = lazy(() => import('./pages/parents/ParentDashboard'));
const ParentAttendance = lazy(() => import('./pages/parents/ParentAttendance'));
const ParentFees = lazy(() => import('./pages/parents/ParentFees'));
const ParentResults = lazy(() => import('./pages/parents/ParentResults'));
const ParentAnnouncements = lazy(() => import('./pages/parents/ParentAnnouncements'));
const ParentHomework = lazy(() => import('./pages/parents/ParentHomework'));
const ParentDiary = lazy(() => import('./pages/parents/ParentDiary'));
const ParentRoutine = lazy(() => import('./pages/parents/ParentRoutine'));
const ParentExamRoutine = lazy(() => import('./pages/parents/ParentExamRoutine'));
const TeacherLayout = lazy(() => import('./pages/teacher/TeacherLayout'));
const TeacherDashboard = lazy(() => import('./pages/teacher/TeacherDashboard'));
const WeeklyRoutine = lazy(() => import('./pages/teacher/WeeklyRoutine'));
const AttendanceSection = lazy(() => import('./pages/AttendanceSection'));
const HomeworkPage = lazy(() => import('./pages/teacher/HomeworkPage'));
const DiaryPage = lazy(() => import('./pages/teacher/DiaryPage'));
const LinkChild = lazy(() => import('./pages/LinkChild'));
const ChangePassword = lazy(() => import('./pages/ChangePassword'));
const AdminRoutine = lazy(() => import('./pages/AdminRoutine'));
const ExamRoutineAdmin = lazy(() => import('./pages/ExamRoutineAdmin'));
const Connections = lazy(() => import('./pages/admin/Connections'));

function PageLoader() {
  return (
    <div className="min-h-screen bg-school-paper flex items-center justify-center">
      <div className="w-8 h-8 border-3 border-school-primary/20 border-t-school-primary rounded-full animate-spin"></div>
    </div>
  );
}

const App: React.FC = () => {
  const { user, loading, fetchSession } = useAuthStore();
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  usePullToRefresh();

  useEffect(() => {
    const handler = (e: Event) => { e.preventDefault(); saveInstallEvent(e); setInstallPrompt(e); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const result = await installPrompt.userChoice;
    if (result.outcome === 'accepted') setInstallPrompt(null);
  };

  useEffect(() => {
      fetchSession();
    }, [fetchSession]);

    // Force staff to change their admin-set first password before using anything
    useEffect(() => {
      if (user?.mustChangePassword && !window.location.hash.startsWith('#/change-password')) {
        window.location.hash = '#/change-password';
      }
    }, [user, user?.mustChangePassword]);

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches;

  const teacherRoute = isStandalone ? '/teacher' : '/';

  if (loading) {
    return <PageLoader />;
  }

  return (
    <Router>
      <ErrorBoundary>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/login" element={!user ? <Login /> : <Navigate to={user.role === 'parent' ? '/parent' : user.role === 'teacher' && teacherRoute !== '/' ? teacherRoute : '/'} />} />
          <Route path="/register" element={!user ? <Register /> : <Navigate to={user.role === 'parent' ? '/parent' : user.role === 'teacher' && teacherRoute !== '/' ? teacherRoute : '/'} />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route path="/link-child" element={user?.role === 'parent' ? <LinkChild /> : <Navigate to="/" />} />
          <Route path="/change-password" element={user ? <ChangePassword /> : <Navigate to="/login" />} />
          <Route path="/users" element={user?.role === 'admin' ? <UserManagement /> : <Navigate to="/" />} />
          <Route path="/audit" element={user?.role === 'admin' ? <AuditLogs /> : <Navigate to="/" />} />
          <Route path="/pin-attendance" element={<PinAttendance />} />
          <Route path="/m" element={<Navigate to="/?mode=attendance" replace />} />

          <Route path="/" element={user ? (user.role === 'parent' ? <Navigate to="/parent" /> : user.role === 'teacher' && teacherRoute !== '/' ? <Navigate to={teacherRoute} /> : <Dashboard />) : <Navigate to="/login" />} />
          <Route path="/parent" element={user?.role === 'parent' || user?.role === 'admin' ? <ParentDashboard /> : <Navigate to="/" />} />
          <Route path="/parent/attendance" element={user?.role === 'parent' || user?.role === 'admin' ? <ParentAttendance /> : <Navigate to="/" />} />
          <Route path="/parent/attendance/:studentId" element={user?.role === 'parent' || user?.role === 'admin' ? <ParentAttendance /> : <Navigate to="/" />} />
          <Route path="/parent/fees" element={user?.role === 'parent' || user?.role === 'admin' ? <ParentFees /> : <Navigate to="/" />} />
          <Route path="/parent/fees/:studentId" element={user?.role === 'parent' || user?.role === 'admin' ? <ParentFees /> : <Navigate to="/" />} />
          <Route path="/parent/results" element={user?.role === 'parent' || user?.role === 'admin' ? <ParentResults /> : <Navigate to="/" />} />
          <Route path="/parent/results/:studentId" element={user?.role === 'parent' || user?.role === 'admin' ? <ParentResults /> : <Navigate to="/" />} />
          <Route path="/parent/homework" element={user?.role === 'parent' || user?.role === 'admin' ? <ParentHomework /> : <Navigate to="/" />} />
          <Route path="/parent/diary" element={user?.role === 'parent' || user?.role === 'admin' ? <ParentDiary /> : <Navigate to="/" />} />
          <Route path="/parent/routine" element={user?.role === 'parent' || user?.role === 'admin' ? <ParentRoutine /> : <Navigate to="/" />} />
          <Route path="/parent/exam-routine" element={user?.role === 'parent' || user?.role === 'admin' ? <ParentExamRoutine /> : <Navigate to="/" />} />
          <Route path="/parent/announcements" element={user?.role === 'parent' || user?.role === 'admin' ? <ParentAnnouncements /> : <Navigate to="/" />} />

          <Route path="/teacher" element={user?.role === 'teacher' || user?.role === 'admin' || user?.role === 'monitor' ? <TeacherLayout><TeacherDashboard /></TeacherLayout> : <Navigate to="/" />} />
          <Route path="/teacher/routine" element={user?.role === 'teacher' || user?.role === 'admin' || user?.role === 'monitor' ? <TeacherLayout><WeeklyRoutine /></TeacherLayout> : <Navigate to="/" />} />
          <Route path="/teacher/attendance" element={user?.role === 'teacher' || user?.role === 'admin' || user?.role === 'monitor' ? <TeacherLayout><AttendanceSection /></TeacherLayout> : <Navigate to="/" />} />
          <Route path="/teacher/homework" element={user?.role === 'teacher' || user?.role === 'admin' || user?.role === 'monitor' ? <TeacherLayout><HomeworkPage /></TeacherLayout> : <Navigate to="/" />} />
          <Route path="/teacher/diary" element={user?.role === 'teacher' || user?.role === 'admin' || user?.role === 'monitor' ? <TeacherLayout><DiaryPage /></TeacherLayout> : <Navigate to="/" />} />

          <Route path="/admin/routine" element={user?.role === 'admin' || user?.role === 'monitor' ? <AdminRoutine /> : <Navigate to="/" />} />
          <Route path="/admin/exam-routine" element={user?.role === 'admin' || user?.role === 'monitor' ? <ExamRoutineAdmin /> : <Navigate to="/" />} />
          <Route path="/connections" element={user?.role === 'admin' ? <Connections /> : <Navigate to="/" />} />

          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
      <AICommandPalette />
      </ErrorBoundary>

      {installPrompt && !window.matchMedia('(display-mode: standalone)').matches && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-school-primary text-white px-4 py-3 flex items-center justify-between shadow-lg">
          <p className="text-xs font-medium">Install <strong>AL RAWA</strong> for quick access</p>
          <div className="flex gap-2">
            <button onClick={() => setInstallPrompt(null)} className="px-3 py-1.5 text-xs text-white/70 hover:text-white">Not now</button>
            <button id="pwa-install-btn" onClick={handleInstall} className="px-4 py-1.5 bg-school-accent text-white rounded-lg text-xs font-bold hover:opacity-90">Install</button>
          </div>
        </div>
      )}
      <IOSInstallPrompt />
    </Router>
  );
};

export default App;
