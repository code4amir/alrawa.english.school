import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../store';
import {
  ChevronRight, GraduationCap, Megaphone, BookOpen, BookText,
  ClipboardList, Calendar, Wallet, Bell,
} from 'lucide-react';
import ParentLayout from './ParentLayout';
import Toast, { toast } from '../../components/Toast';

interface Student {
  id: string;
  studentId: string;
  name: string;
  roll: string;
  className: string;
  session: string;
  photoUrl: string | null;
}

interface Announcement {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

interface HomeworkItem {
  id: string; subject_name: string; topic: string; due_date: string; date: string;
}

interface DiaryItem {
  id: string; subject_name: string; topic: string; date: string;
}

interface ExamItem {
  id: string; exam_name: string; subject_name: string; date: string; start_time: string;
}

interface NoticeItem {
  id: string;
  title: string;
  body: string;
  eventType: string;
  sentAt: string;
}

export default function ParentDashboard() {
  const navigate = useNavigate();
  const [students, setStudents] = useState<Student[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [homeworks, setHomeworks] = useState<HomeworkItem[]>([]);
  const [diaries, setDiaries] = useState<DiaryItem[]>([]);
  const [exams, setExams] = useState<ExamItem[]>([]);
  const [todayRoutine, setTodayRoutine] = useState<string[]>([]);
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const dayName = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date().getDay()];

    Promise.all([
      api.get('/parents/my-students/'),
      api.get('/parents/announcements/'),
      api.get('/parents/homework/'),
      api.get('/parents/diary/'),
      api.get('/parents/exam-routine/'),
      api.get('/parents/routine/'),
      api.get('/parents/notifications/'),
    ])
      .then(([stuRes, annRes, hwRes, diRes, exRes, rtRes, notRes]) => {
        setStudents(stuRes.data);
        setAnnouncements(annRes.data.slice(0, 3));
        setHomeworks(hwRes.data.slice(0, 3));
        setDiaries(diRes.data.slice(0, 3));
        setExams(exRes.data.slice(0, 5));
        setNotices(notRes.data.slice(0, 4));
        setTodayRoutine(
          rtRes.data
            .filter((p: any) => p.day === dayName)
            .sort((a: any, b: any) => a.period_number - b.period_number)
            .map((p: any) => p.subject_name)
        );
      })
      .catch(() => toast('Failed to load data', 'error'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <ParentLayout>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse bg-white rounded-xl p-5 border border-school-border">
              <div className="h-5 bg-gray-200 rounded w-3/4 mb-2" />
              <div className="h-4 bg-gray-100 rounded w-1/2" />
            </div>
          ))}
        </div>
      </ParentLayout>
    );
  }

  return (
    <ParentLayout>
      <Toast />
      <div className="space-y-4">
        <div className="bg-gradient-to-br from-school-primary to-school-secondary rounded-2xl p-5 text-white">
          <h2 className="font-serif text-xl">My Children</h2>
          <p className="text-sm text-white/70 mt-1">Select a student to view details</p>
        </div>

        {students.length === 0 && (
          <div className="bg-white rounded-xl border border-school-border p-8 text-center">
            <GraduationCap size={40} className="mx-auto text-school-muted mb-3" />
            <p className="text-school-muted font-medium">No students linked to your account</p>
            <p className="text-sm text-school-muted mt-1">Contact the school admin to link your children.</p>
          </div>
        )}

        {students.map((s) => (
          <div
            key={s.id}
            onClick={() => navigate(`/parent/attendance/${s.id}`)}
            className="bg-white rounded-xl border border-school-border p-4 card-shadow hover:shadow-md transition-shadow cursor-pointer"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-gradient-to-br from-school-accent to-school-accent2 rounded-full flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
                {s.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-bold text-school-primary truncate">{s.name}</h3>
                <p className="text-xs text-school-muted mt-0.5">
                  {s.className} · Roll: {s.roll} · ID: {s.studentId}
                </p>
              </div>
              <ChevronRight size={20} className="text-school-muted flex-shrink-0" />
            </div>
          </div>
        ))}

        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => navigate('/parent/homework')}
            className="bg-white rounded-xl border border-school-border p-4 text-left card-shadow hover:shadow-md transition-shadow">
            <div className="w-9 h-9 rounded-xl bg-green-100 dark:bg-green-500/20 flex items-center justify-center mb-2">
              <BookOpen size={18} className="text-green-600" />
            </div>
            <div className="text-lg font-bold text-school-primary">{homeworks.length}</div>
            <div className="text-[10px] text-school-muted font-semibold uppercase tracking-wider">Homework</div>
          </button>
          <button onClick={() => navigate('/parent/diary')}
            className="bg-white rounded-xl border border-school-border p-4 text-left card-shadow hover:shadow-md transition-shadow">
            <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center mb-2">
              <BookText size={18} className="text-amber-600" />
            </div>
            <div className="text-lg font-bold text-school-primary">{diaries.length}</div>
            <div className="text-[10px] text-school-muted font-semibold uppercase tracking-wider">Diary</div>
          </button>
          <button onClick={() => navigate('/parent/routine')}
            className="bg-white rounded-xl border border-school-border p-4 text-left card-shadow hover:shadow-md transition-shadow">
            <div className="w-9 h-9 rounded-xl bg-purple-100 dark:bg-purple-500/20 flex items-center justify-center mb-2">
              <ClipboardList size={18} className="text-purple-600" />
            </div>
            <div className="text-lg font-bold text-school-primary">{todayRoutine.length}</div>
            <div className="text-[10px] text-school-muted font-semibold uppercase tracking-wider">Today's Classes</div>
          </button>
          <button onClick={() => navigate('/parent/exam-routine')}
            className="bg-white rounded-xl border border-school-border p-4 text-left card-shadow hover:shadow-md transition-shadow">
            <div className="w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-500/20 flex items-center justify-center mb-2">
              <Calendar size={18} className="text-blue-600" />
            </div>
            <div className="text-lg font-bold text-school-primary">{exams.length}</div>
            <div className="text-[10px] text-school-muted font-semibold uppercase tracking-wider">Upcoming Exams</div>
          </button>
        </div>

        {todayRoutine.length > 0 && (
          <div className="bg-white rounded-xl border border-school-border p-4 card-shadow">
            <div className="flex items-center gap-2 mb-2">
              <ClipboardList size={16} className="text-school-accent" />
              <span className="font-bold text-sm text-school-primary">Today's Classes</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {todayRoutine.map((subj, i) => (
                <span key={i} className="px-2.5 py-1 bg-school-paper dark:bg-[#2a2a3e] rounded-lg text-[10px] font-semibold text-school-primary">
                  {subj}
                </span>
              ))}
            </div>
          </div>
        )}

        {homeworks.length > 0 && (
          <div className="bg-white rounded-xl border border-school-border overflow-hidden card-shadow">
            <div className="px-4 py-3 bg-gray-50 border-b border-school-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BookOpen size={16} className="text-green-600" />
                <span className="font-bold text-sm text-school-primary">Recent Homework</span>
              </div>
              <button onClick={() => navigate('/parent/homework')} className="text-[11px] font-semibold text-school-accent hover:underline">See all</button>
            </div>
            {homeworks.map((hw) => (
              <div key={hw.id} className="px-4 py-3 border-b border-school-border last:border-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase text-green-600 bg-green-50 dark:bg-green-500/10 px-1.5 py-0.5 rounded">{hw.subject_name}</span>
                  <span className="text-[10px] text-school-muted">{hw.date}</span>
                </div>
                <p className="font-semibold text-sm text-school-primary mt-0.5">{hw.topic}</p>
                <p className="text-[10px] text-school-muted mt-0.5">Due: {hw.due_date}</p>
              </div>
            ))}
          </div>
        )}

        {diaries.length > 0 && (
          <div className="bg-white rounded-xl border border-school-border overflow-hidden card-shadow">
            <div className="px-4 py-3 bg-gray-50 border-b border-school-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BookText size={16} className="text-amber-600" />
                <span className="font-bold text-sm text-school-primary">Latest Diary</span>
              </div>
              <button onClick={() => navigate('/parent/diary')} className="text-[11px] font-semibold text-school-accent hover:underline">See all</button>
            </div>
            {diaries.map((d) => (
              <div key={d.id} className="px-4 py-3 border-b border-school-border last:border-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase text-amber-600 bg-amber-50 dark:bg-amber-500/10 px-1.5 py-0.5 rounded">{d.subject_name}</span>
                  <span className="text-[10px] text-school-muted">{d.date}</span>
                </div>
                <p className="font-semibold text-sm text-school-primary mt-0.5">{d.topic}</p>
              </div>
            ))}
          </div>
        )}

        {exams.length > 0 && (
          <div className="bg-white rounded-xl border border-school-border overflow-hidden card-shadow">
            <div className="px-4 py-3 bg-gray-50 border-b border-school-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar size={16} className="text-blue-600" />
                <span className="font-bold text-sm text-school-primary">Upcoming Exams</span>
              </div>
              <button onClick={() => navigate('/parent/exam-routine')} className="text-[11px] font-semibold text-school-accent hover:underline">See all</button>
            </div>
            {exams.map((ex) => (
              <div key={ex.id} className="px-4 py-3 border-b border-school-border last:border-0 flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center">
                  <Calendar size={14} className="text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-school-primary">{ex.subject_name}</p>
                  <p className="text-[10px] text-school-muted">{ex.date} · {ex.start_time}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={() => navigate('/parent/attendance')}
            className="flex-1 bg-white rounded-xl border border-school-border p-3 text-center card-shadow hover:shadow-md transition-shadow">
            <span className="text-[10px] font-bold uppercase text-school-muted">Attendance</span>
          </button>
          <button onClick={() => navigate('/parent/fees')}
            className="flex-1 bg-white rounded-xl border border-school-border p-3 text-center card-shadow hover:shadow-md transition-shadow">
            <Wallet size={16} className="mx-auto text-school-accent mb-0.5" />
            <span className="text-[10px] font-bold uppercase text-school-muted">Fees</span>
          </button>
          <button onClick={() => navigate('/parent/results')}
            className="flex-1 bg-white rounded-xl border border-school-border p-3 text-center card-shadow hover:shadow-md transition-shadow">
            <span className="text-[10px] font-bold uppercase text-school-muted">Results</span>
          </button>
        </div>

        {notices.length > 0 && (
          <div className="bg-white rounded-xl border border-school-border overflow-hidden card-shadow">
            <div className="px-4 py-3 bg-gray-50 border-b border-school-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bell size={16} className="text-school-accent" />
                <span className="font-bold text-sm text-school-primary">Recent Notices</span>
              </div>
            </div>
            {notices.map((n) => (
              <div key={n.id} className="px-4 py-3 border-b border-school-border last:border-0">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-bold text-sm text-school-primary">{n.title || 'Notice'}</h3>
                  <span className="text-[10px] text-school-muted whitespace-nowrap shrink-0">
                    {n.sentAt ? new Date(n.sentAt).toLocaleDateString() : ''}
                  </span>
                </div>
                {n.body && <p className="text-xs text-school-muted mt-1 whitespace-pre-line">{n.body}</p>}
                {n.eventType === 'dues_reminder' && (
                  <span className="inline-block text-[10px] font-semibold text-rose-700 bg-rose-50 rounded-full px-2 py-0.5 mt-1">
                    Dues Reminder
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {announcements.length > 0 && (
          <div className="bg-white rounded-xl border border-school-border overflow-hidden card-shadow">
            <div className="px-4 py-3 bg-gray-50 border-b border-school-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Megaphone size={16} className="text-school-accent" />
                <span className="font-bold text-sm text-school-primary">Recent Updates</span>
              </div>
              <button onClick={() => navigate('/parent/announcements')} className="text-[11px] font-semibold text-school-accent hover:underline">See all</button>
            </div>
            {announcements.map((a) => (
              <div key={a.id} className="px-4 py-3 border-b border-school-border last:border-0">
                <p className="font-semibold text-sm text-school-primary">{a.title}</p>
                {a.body && <p className="text-xs text-school-muted mt-0.5 line-clamp-2">{a.body}</p>}
                <p className="text-[10px] text-school-muted/60 mt-1">{new Date(a.createdAt).toLocaleDateString()}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </ParentLayout>
  );
}
