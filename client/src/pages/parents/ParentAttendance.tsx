import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../../store';
import Toast, { toast } from '../../components/Toast';
import ParentLayout from './ParentLayout';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Day {
  date: string;
  weekday: number;
  type: string;
  status: string | null;
}

interface Student {
  id: string;
  name: string;
  roll: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STATUS_COLORS: Record<string, string> = {
  present: 'bg-green-100 text-green-700 border-green-200',
  absent: 'bg-red-100 text-red-700 border-red-200',
};

export default function ParentAttendance() {
  const { studentId } = useParams<{ studentId: string }>();
  const navigate = useNavigate();
  const today = new Date();
  const [student, setStudent] = useState<Student | null>(null);
  const [days, setDays] = useState<Day[]>([]);
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!studentId) return;
    setLoading(true);
    api.get(`/parents/attendance/${studentId}/`, { params: { year, month } })
      .then((res) => {
        setStudent(res.data.student);
        setDays(res.data.days);
      })
      .catch(() => toast('Failed to load attendance', 'error'))
      .finally(() => setLoading(false));
  }, [studentId, year, month]);

  const prevMonth = () => {
    if (month === 1) { setYear((y) => y - 1); setMonth(12); }
    else setMonth((m) => m - 1);
  };

  const nextMonth = () => {
    if (month === 12) { setYear((y) => y + 1); setMonth(1); }
    else setMonth((m) => m + 1);
  };

  const summary = {
    present: days.filter((d) => d.status === 'present').length,
    absent: days.filter((d) => d.status === 'absent').length,
  };

  if (!studentId) {
    return <StudentSelector onSelect={(id) => navigate(`/parent/attendance/${id}`)} title="Select a student to view attendance" />;
  }

  return (
    <ParentLayout>
      <Toast />
      {student && (
        <button onClick={() => navigate('/parent')} className="flex items-center gap-1 text-sm text-school-muted mb-3 hover:text-school-primary">
          <ChevronLeft size={16} />
          {student.name}
        </button>
      )}

      <div className="bg-white rounded-xl border border-school-border p-4 mb-4">
        <div className="flex items-center justify-between mb-4">
          <button onClick={prevMonth} className="p-2 hover:bg-gray-100 rounded-lg"><ChevronLeft size={20} /></button>
          <h3 className="font-bold text-school-primary">{MONTHS[month - 1]} {year}</h3>
          <button onClick={nextMonth} className="p-2 hover:bg-gray-100 rounded-lg"><ChevronRight size={20} /></button>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center mb-2">
          {DAYS.map((d) => (
            <div key={d} className="text-[10px] font-bold text-school-muted uppercase tracking-wider py-1">{d}</div>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-8 text-school-muted">Loading...</div>
        ) : (
          <>
            <div className="grid grid-cols-7 gap-1">
              {new Array(new Date(year, month - 1, 1).getDay()).fill(null).map((_, i) => (
                <div key={`empty-${i}`} />
              ))}
              {days.map((d) => {
                const num = new Date(d.date).getDate();
                const isWeekend = d.type === 'weekend';
                const isHoliday = d.type === 'holiday' || d.type === 'de_facto_holiday';
                const color = d.status ? STATUS_COLORS[d.status] : isWeekend ? 'bg-gray-50 text-gray-300' : isHoliday ? 'bg-purple-50 text-purple-300' : 'bg-gray-50 text-gray-400';
                return (
                  <div
                    key={d.date}
                    className={`aspect-square rounded-lg flex items-center justify-center text-[13px] font-semibold border ${color || 'border-transparent'}`}
                    title={`${d.date}${d.status ? ` - ${d.status}` : isHoliday ? ' - Holiday' : isWeekend ? ' - Weekend' : ' - No record'}`}
                  >
                    {num}
                  </div>
                );
              })}
            </div>

            <div className="flex gap-4 mt-4 pt-3 border-t border-school-border text-xs">
              <span className="text-green-600">Present: {summary.present}</span>
              <span className="text-red-600">Absent: {summary.absent}</span>
            </div>
          </>
        )}
      </div>
    </ParentLayout>
  );
}

function StudentSelector({ onSelect, title }: { onSelect: (id: string) => void; title: string }) {
  const [students, setStudents] = useState<Array<{ id: string; name: string; className: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/parents/my-students/')
      .then((res) => setStudents(res.data))
      .catch(() => toast('Failed to load students', 'error'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <ParentLayout>
      <div className="space-y-3">
        <h2 className="font-serif text-lg text-school-primary">{title}</h2>
        {loading ? (
          <div className="text-school-muted">Loading...</div>
        ) : (
          students.map((s) => (
            <button
              key={s.id}
              onClick={() => onSelect(s.id)}
              className="w-full bg-white rounded-xl border border-school-border p-4 text-left card-shadow hover:shadow-md transition-shadow"
            >
              <p className="font-bold text-school-primary">{s.name}</p>
              <p className="text-xs text-school-muted">{s.className}</p>
            </button>
          ))
        )}
      </div>
    </ParentLayout>
  );
}
