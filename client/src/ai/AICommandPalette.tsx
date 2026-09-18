import { useEffect, useRef, useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Command, ArrowRight, X, Sparkles, Info } from 'lucide-react';
import { useAIQueryStore } from '../store';
import AIResultPanel from './AIResultPanel';

const SUGGESTIONS = [
  'List students in Class Five',
  'Search student Atifa Asma Ohi',
  'Attendance summary for Class Four',
  'Who is absent today in Class Five',
  'Show all teachers',
  'Teacher subjects for Kurratul Jannat',
  'Teacher schedule for Kurratul Jannat',
  'Weekly routine for Class Five',
  'Homework for Class Five',
  'Diary entries for Class Five',
  'Exam schedule for Class Five',
  'Lesson plans for Class Five',
  'Dashboard summary',
  'Bank account balances',
  'Fee collection this month',
  'How many students in each class',
  'Show exam results for Class Five',
];

const AICommandPalette = () => {
  // Ctrl+K / Escape shortcut is owned by App (so it works before this lazy
  // chunk loads) — no key listener here to avoid double-toggling.
  const { open, query, loading, result, error, setQuery, submit, close } = useAIQueryStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [tipSeen, setTipSeen] = useState(() => localStorage.getItem('ai-palette-tip') === '1');
  const [history, setHistory] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('ai-query-history') || '[]').slice(0, 5); } catch { return []; }
  });

  useEffect(() => {
    if (result && !loading) {
      const updated = [query, ...history.filter(h => h !== query)].slice(0, 5);
      setHistory(updated);
      localStorage.setItem('ai-query-history', JSON.stringify(updated));
    }
  }, [result, loading]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  const handleSubmit = useCallback(() => {
    localStorage.setItem('ai-palette-tip', '1');
    setTipSeen(true);
    const q = query.trim();
    if (!q || loading) return;
    submit(q);
  }, [query, loading, submit]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
  }, [handleSubmit]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] bg-black/40 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) close(); }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -10 }}
            transition={{ duration: 0.15 }}
            className="w-full max-w-xl mx-4 bg-school-paper dark:bg-[#1a1a2e] rounded-2xl shadow-2xl border border-school-border overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Input */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-school-border">
              <Search size={20} className="text-school-muted shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything about school data…"
                className="flex-1 bg-transparent text-sm text-school-ink dark:text-[#e0e0e8] placeholder-school-muted outline-none"
              />
              <kbd className="hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-md bg-school-border/50 text-[10px] text-school-muted font-mono">
                <Command size={12} /><span>K</span>
              </kbd>
              <button
                onClick={handleSubmit}
                disabled={!query.trim() || loading}
                className="p-1.5 rounded-lg bg-school-accent text-white disabled:opacity-40 hover:bg-school-accent/90 transition-colors"
                aria-label="Submit query"
              >
                <ArrowRight size={16} />
              </button>
              <button
                onClick={close}
                className="p-1.5 rounded-lg hover:bg-school-border/50 transition-colors text-school-muted"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            {/* Results or suggestions */}
            <div className="px-4 py-3 max-h-96 overflow-y-auto">
              {result || loading || error ? (
                <AIResultPanel loading={loading} result={result} error={error} />
              ) : (
                <div className="space-y-2">
                  {!tipSeen && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20">
                      <Info size={14} className="text-blue-500 shrink-0" />
                      <p className="text-[11px] text-blue-700 dark:text-blue-300">Press <kbd className="px-1 py-0.5 rounded bg-blue-100 dark:bg-blue-500/20 text-[10px] font-mono font-bold">Ctrl+K</kbd> or <kbd className="px-1 py-0.5 rounded bg-blue-100 dark:bg-blue-500/20 text-[10px] font-mono font-bold">⌘K</kbd> anytime to ask questions about school data</p>
                      <button onClick={() => { localStorage.setItem('ai-palette-tip', '1'); setTipSeen(true); }} className="text-blue-400 hover:text-blue-600 shrink-0" aria-label="Dismiss tip">✕</button>
                    </div>
                  )}
                  {history.length > 0 && (
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-school-muted font-semibold mb-1.5">
                        Recent
                      </p>
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {history.map((h) => (
                          <button
                            key={h}
                            onClick={() => { setQuery(h); submit(h); }}
                            className="px-2.5 py-1 rounded-full bg-school-border/40 hover:bg-school-border/70 text-[11px] text-school-ink/70 dark:text-[#c0c0c8] transition-colors"
                          >
                            {h.length > 40 ? h.slice(0, 40) + '…' : h}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <p className="text-[10px] uppercase tracking-widest text-school-muted font-semibold">
                    Try asking…
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => { setQuery(s); submit(s); }}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-school-border/40 hover:bg-school-border/70 text-[11px] text-school-ink/70 dark:text-[#c0c0c8] transition-colors"
                      >
                        <Sparkles size={12} />
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default AICommandPalette;
