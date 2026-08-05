import { useEffect, useState } from 'react';
import { api } from '../../store';
import Toast, { toast } from '../../components/Toast';
import ParentLayout from './ParentLayout';
import { Megaphone } from 'lucide-react';

interface Announcement {
  id: string;
  title: string;
  body: string;
  author: string;
  createdAt: string;
  school_class?: { id: string; name: string } | null;
}

export default function ParentAnnouncements() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/parents/announcements/')
      .then((res) => setItems(res.data))
      .catch(() => toast('Failed to load announcements', 'error'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <ParentLayout>
      <Toast />
      <div className="space-y-4">
        <div className="bg-gradient-to-br from-purple-500 to-purple-700 rounded-2xl p-5 text-white">
          <div className="flex items-center gap-3 mb-1">
            <Megaphone size={24} />
            <h2 className="font-serif text-xl">Announcements</h2>
          </div>
          <p className="text-sm text-white/70">School notices and updates</p>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="animate-pulse bg-white rounded-xl p-4 border border-school-border">
                <div className="h-5 bg-gray-200 rounded w-3/4 mb-2" />
                <div className="h-4 bg-gray-100 rounded w-full" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="bg-white rounded-xl p-8 text-center border border-school-border">
            <Megaphone size={40} className="mx-auto text-school-muted mb-3" />
            <p className="text-school-muted font-medium">No announcements yet</p>
          </div>
        ) : (
          items.map((a) => (
            <div key={a.id} className="bg-white rounded-xl border border-school-border p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-bold text-school-primary">{a.title}</h3>
                <span className="text-[10px] text-school-muted whitespace-nowrap shrink-0">
                  {new Date(a.createdAt).toLocaleDateString()}
                </span>
              </div>
              {a.school_class ? (
                <span className="inline-block text-[10px] font-semibold text-purple-700 bg-purple-100 rounded-full px-2 py-0.5">
                  {a.school_class.name}
                </span>
              ) : (
                <span className="inline-block text-[10px] font-semibold text-school-muted bg-school-paper rounded-full px-2 py-0.5">
                  All classes
                </span>
              )}
              {a.body && <p className="text-sm text-school-muted leading-relaxed">{a.body}</p>}
              <p className="text-[10px] text-school-muted/60">— {a.author}</p>
            </div>
          ))
        )}
      </div>
    </ParentLayout>
  );
}
