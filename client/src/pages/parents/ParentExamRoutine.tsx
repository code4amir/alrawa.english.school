import { useState, useEffect } from 'react';
import { api } from '../../store';
import Toast, { toast } from '../../components/Toast';
import { Loader2, Calendar } from 'lucide-react';

interface Exam {
  id: string;
  exam_name: string;
  subject_name: string;
  class_name: string;
  date: string;
  start_time: string;
  end_time: string | null;
  room: string;
}

export default function ParentExamRoutine() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/parents/exam-routine/')
      .then((res) => setExams(res.data))
      .catch(() => toast('Failed to load exam routine', 'error'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <>
        <Toast />
        <div className="flex justify-center py-20">
          <Loader2 size={28} className="animate-spin text-school-muted" />
        </div>
      </>
    );
  }

  if (exams.length === 0) {
    return (
      <>
        <Toast />
        <div className="text-center py-20 text-school-muted text-sm">
          <Calendar size={40} className="mx-auto mb-3 opacity-40" />
          No exam routine published yet
        </div>
      </>
    );
  }

  const grouped: Record<string, Exam[]> = {};
  exams.forEach((exam) => {
    const key = exam.exam_name;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(exam);
  });

  return (
    <div className="space-y-4 animate-fade-in">
      <Toast />
      {Object.entries(grouped).map(([examName, examList]) => (
        <div key={examName}>
          <h3 className="font-bold text-sm text-school-primary dark:text-[#e0e0e8] mb-2">{examName}</h3>
          <div className="space-y-1.5">
            {examList.map((exam) => (
              <div key={exam.id} className="flex items-center gap-3 bg-white dark:bg-[#1a1a2e] rounded-xl border border-school-border dark:border-[#2a2a3e] px-4 py-3 shadow-sm">
                <div className="w-10 h-10 rounded-xl bg-school-accent/10 flex items-center justify-center flex-shrink-0">
                  <Calendar size={18} className="text-school-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-school-primary dark:text-[#e0e0e8]">{exam.subject_name}</div>
                  <div className="text-[10px] text-school-muted">
                    {exam.date} · {exam.start_time}{exam.end_time ? ` - ${exam.end_time}` : ''}
                    {exam.room ? ` · ${exam.room}` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
