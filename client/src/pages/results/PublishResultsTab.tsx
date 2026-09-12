import { useEffect, useState } from 'react';
import { api } from '../../store';
import { TERM_NAMES } from '../../lib/config';
import Toast, { toast } from '../../components/Toast';
import { Send, Eye, EyeOff, Loader2 } from 'lucide-react';

const TERMS = ['1', '2', '3'];

export default function PublishResultsTab() {
  const [published, setPublished] = useState<Record<string, string[]>>({});
  const [session, setSession] = useState('');
  const [sessions, setSessions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [notify, setNotify] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/results/published_terms/'),
      api.get('/results/', { params: { limit: 1 } }),
    ]).then(([pubRes, _]) => {
      setPublished(pubRes.data || {});
      const keys = Object.keys(pubRes.data || {});
      if (keys.length > 0) setSession(keys[0]);
    }).catch(() => {})
    .finally(() => setLoading(false));

    api.get('/academic-years/').then((r) => {
      const yrs = (r.data.results || r.data || []).map((y: any) => y.name);
      setSessions(yrs);
      if (yrs.length > 0 && !session) setSession(yrs[0]);
    }).catch(() => {});
  }, []);

  const toggleTerm = async (term: string, publish: boolean) => {
    if (!session) { toast('Select a session', 'error'); return; }
    setSaving(term);
    try {
      const current = published[session] || [];
      const updated = publish
        ? [...new Set([...current, term])]
        : current.filter((t) => t !== term);
      const res = await api.post('/results/publish_terms/', {
        session,
        terms: updated,
        notify: publish ? notify : false,
      });
      setPublished(res.data);
      toast(publish ? `Published ${TERM_NAMES[term]}` : `Unpublished ${TERM_NAMES[term]}`, 'success');
    } catch {
      toast('Failed to update', 'error');
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 size={28} className="animate-spin text-school-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Toast />
      <div className="bg-gradient-to-br from-school-primary to-school-secondary rounded-2xl p-5 text-white">
        <h2 className="font-serif text-xl">Publish Results</h2>
        <p className="text-sm text-white/70 mt-1">
          Control when results are visible to parents
        </p>
      </div>

      {sessions.length > 0 && (
        <div className="bg-white rounded-xl border border-school-border p-4 card-shadow">
          <label className="text-[10px] font-bold uppercase text-school-muted tracking-wider block mb-1.5">Session</label>
          <select
            value={session}
            onChange={(e) => setSession(e.target.value)}
            className="w-full px-3 py-2.5 border border-school-border rounded-xl text-sm focus:outline-none focus:border-school-accent bg-white"
          >
            {sessions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      )}

      <div className="bg-white rounded-xl border border-school-border overflow-hidden card-shadow">
        {TERMS.map((term) => {
          const isPublished = (published[session] || []).includes(term);
          return (
            <div key={term} className="px-4 py-4 border-b border-school-border last:border-0 flex items-center justify-between">
              <div>
                <p className="font-bold text-sm text-school-primary">{TERM_NAMES[term]}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {isPublished ? (
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-green-600">
                      <Eye size={12} /> Published
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-school-muted">
                      <EyeOff size={12} /> Draft
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => toggleTerm(term, !isPublished)}
                disabled={saving === term}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                  isPublished
                    ? 'bg-orange-50 text-orange-600 border border-orange-200 hover:bg-orange-100'
                    : 'bg-school-primary text-white shadow-sm hover:opacity-90'
                }`}
              >
                {saving === term ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : isPublished ? (
                  <EyeOff size={12} />
                ) : (
                  <Send size={12} />
                )}
                {isPublished ? 'Unpublish' : 'Publish'}
              </button>
            </div>
          );
        })}
      </div>

      <label className="flex items-center gap-2 px-1 cursor-pointer">
        <input
          type="checkbox"
          checked={notify}
          onChange={(e) => setNotify(e.target.checked)}
          className="w-4 h-4 rounded border-school-border accent-school-primary"
        />
        <span className="text-xs text-school-muted font-medium">
          Send push notification to parents when publishing
        </span>
      </label>

      <p className="text-[10px] text-school-muted/60 px-1">
        Teachers can enter marks at any time. Results only become visible to parents
        after you publish the term.
      </p>
    </div>
  );
}
