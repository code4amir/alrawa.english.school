import { useState, useEffect } from 'react';
import { api } from '../../store';
import Toast, { toast } from '../../components/Toast';
import { Loader2, ClipboardList } from 'lucide-react';

interface Period {
  id: string;
  day: string;
  period_number: number;
  subject_name: string;
  teacher_name: string;
  class_name: string;
  lesson_topic?: string;
  lesson_completed?: boolean;
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday'];
const DAY_LABELS: Record<string, string> = {
  sunday: 'Sun', monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu',
};

export default function ParentRoutine() {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/parents/routine/')
      .then((res) => setPeriods(res.data))
      .catch(() => toast('Failed to load routine', 'error'))
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

  if (periods.length === 0) {
    return (
      <>
        <Toast />
        <div className="text-center py-20 text-school-muted text-sm">
          <ClipboardList size={40} className="mx-auto mb-3 opacity-40" />
          No routine available
        </div>
      </>
    );
  }

  const maxPeriod = Math.max(...periods.map((p) => p.period_number), 0);

  return (
    <div className="space-y-3 animate-fade-in">
      <Toast />
      <p className="text-[10px] font-bold uppercase text-school-muted tracking-wider mb-2">Weekly Schedule</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className="px-2 py-2 text-school-muted font-bold text-[10px] uppercase">#</th>
              {DAYS.map((d) => (
                <th key={d} className="px-2 py-2 text-school-muted font-bold text-[10px] uppercase min-w-[90px]">{DAY_LABELS[d]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: maxPeriod }, (_, i) => i + 1).map((pn) => (
              <tr key={pn}>
                <td className="px-2 py-1 text-school-muted font-bold text-[10px] border-t border-school-border/30">{pn}</td>
                {DAYS.map((d) => {
                  const p = periods.find((pr) => pr.day === d && pr.period_number === pn);
                  return (
                    <td key={d} className="px-1 py-1 border-t border-school-border/30">
                      {p ? (
                        <div className="bg-white dark:bg-[#1a1a2e] rounded-xl p-2 border border-school-border dark:border-[#2a2a3e] min-h-[50px]">
                          <div className="font-bold text-school-primary dark:text-[#e0e0e8] text-[11px] leading-tight">{p.subject_name}</div>
                          <div className="text-[8px] text-school-muted mt-0.5">{p.teacher_name}</div>
                          {p.lesson_topic && (
                            <div className="flex items-center gap-1 mt-1">
                              <span className="text-[8px] text-school-accent leading-tight line-clamp-2">{p.lesson_topic}</span>
                              {p.lesson_completed && <span className="text-green-500 text-[8px]">✓</span>}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="min-h-[50px]" />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
