import { useEffect } from 'react';
import { useSchoolStore } from '../store';

export default function ClassSelect({ value, onChange }: { value: string; onChange: (cls: any) => void }) {
  const { classes, fetchClasses } = useSchoolStore();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchClasses(); }, []);
  const sorted = [...classes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return (
    <select value={value} onChange={(e) => { const v = e.target.value; if (!v) { onChange(null); return; } const cls = sorted.find((c: any) => c.id === v); if (cls) onChange(cls); }} className="w-full px-3 py-2 border border-school-border rounded-xl text-sm focus:outline-none focus:border-school-accent bg-white">
      <option value="">— Select Class —</option>
      {sorted.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}
