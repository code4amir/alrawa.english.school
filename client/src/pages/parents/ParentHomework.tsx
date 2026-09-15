import { useState, useEffect } from 'react';
import { api } from '../../store';
import Toast, { toast } from '../../components/Toast';
import { Loader2, BookOpen } from 'lucide-react';

interface HomeworkItem {
  id: string;
  subject_name: string;
  class_name: string;
  date: string;
  topic: string;
  description: string;
  due_date: string;
}

export default function ParentHomework() {
  const [items, setItems] = useState<HomeworkItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/parents/homework/')
      .then((res) => setItems(res.data))
      .catch(() => toast('Failed to load homework', 'error'))
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

  if (items.length === 0) {
    return (
      <>
        <Toast />
        <div className="text-center py-20 text-school-muted text-sm">
          <BookOpen size={40} className="mx-auto mb-3 opacity-40" />
          No homework assigned yet
        </div>
      </>
    );
  }

  const grouped: Record<string, HomeworkItem[]> = {};
  items.forEach((item) => {
    const key = item.date;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(item);
  });

  return (
    <div className="space-y-4 animate-fade-in">
      <Toast />
      {Object.entries(grouped).map(([date, hws]) => (
        <div key={date}>
          <p className="text-[10px] font-bold uppercase text-school-muted tracking-wider mb-2">{date}</p>
          <div className="space-y-2">
            {hws.map((hw) => (
              <div key={hw.id} className="bg-white dark:bg-[#1a1a2e] rounded-2xl border border-school-border dark:border-[#2a2a3e] p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-bold uppercase text-school-accent bg-school-accent/10 px-2 py-0.5 rounded-full">{hw.subject_name}</span>
                  <span className="text-[10px] text-school-muted">{hw.class_name}</span>
                </div>
                <h3 className="font-bold text-sm text-school-primary dark:text-[#e0e0e8]">{hw.topic}</h3>
                {hw.description && (
                  <p className="text-xs text-school-muted mt-1">{hw.description}</p>
                )}
                <p className="text-[10px] text-school-muted mt-2">Due: {hw.due_date}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
