import { useState, useEffect } from 'react';
import { api } from '../../store';
import Toast, { toast } from '../../components/Toast';
import { Loader2, BookText } from 'lucide-react';

interface DiaryItem {
  id: string;
  subject_name: string;
  class_name: string;
  date: string;
  topic: string;
  activities: string;
  remarks: string;
}

export default function ParentDiary() {
  const [items, setItems] = useState<DiaryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/parents/diary/')
      .then((res) => setItems(res.data))
      .catch(() => toast('Failed to load diary entries', 'error'))
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
          <BookText size={40} className="mx-auto mb-3 opacity-40" />
          No diary entries yet
        </div>
      </>
    );
  }

  return (
    <div className="space-y-3 animate-fade-in">
      <Toast />
      {items.map((entry) => (
        <div key={entry.id} className="bg-white dark:bg-[#1a1a2e] rounded-2xl border border-school-border dark:border-[#2a2a3e] p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold uppercase text-school-accent bg-school-accent/10 px-2 py-0.5 rounded-full">{entry.subject_name}</span>
            <span className="text-[10px] text-school-muted">{entry.class_name}</span>
            <span className="text-[10px] text-school-muted ml-auto">{entry.date}</span>
          </div>
          <h3 className="font-bold text-sm text-school-primary dark:text-[#e0e0e8]">{entry.topic}</h3>
          {entry.activities && (
            <p className="text-xs text-school-muted mt-1">{entry.activities}</p>
          )}
          {entry.remarks && (
            <p className="text-[10px] text-school-muted mt-1 italic">{entry.remarks}</p>
          )}
        </div>
      ))}
    </div>
  );
}
