import { useState, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useUIStore, useAuthStore } from '../store';
import EnterBySubject from './results/EnterBySubject';
import EnterByStudent from './results/EnterByStudent';
import TabulationTab from './results/TabulationTab';
import AllReportCardsTab from './results/AllReportCardsTab';
import MyTasksTab from './results/MyTasksTab';
import OverviewTab from './results/OverviewTab';
import SubjectManager from './results/SubjectManager';
import { PenLine, User, ClipboardList, FileSpreadsheet, BookOpen, Send, ClipboardCheck, LayoutDashboard } from 'lucide-react';
import PublishResultsTab from './results/PublishResultsTab';

type Tab = 'subject' | 'student' | 'tabulation' | 'reports' | 'subjects' | 'publish' | 'tasks' | 'overview';

const TABS: { key: Tab; label: string; icon: ReactNode; roles?: string[] }[] = [
  { key: 'tasks', label: 'My Tasks', icon: <ClipboardCheck size={14} />, roles: ['teacher'] },
  { key: 'overview', label: 'Overview', icon: <LayoutDashboard size={14} />, roles: ['admin'] },
  { key: 'subject', label: 'Enter by Subject', icon: <PenLine size={14} /> },
  { key: 'student', label: 'Enter by Student', icon: <User size={14} /> },
  { key: 'tabulation', label: 'Tabulation', icon: <ClipboardList size={14} /> },
  { key: 'reports', label: 'Report Cards', icon: <FileSpreadsheet size={14} /> },
  { key: 'subjects', label: 'Manage Subjects', icon: <BookOpen size={14} /> },
  { key: 'publish', label: 'Publish', icon: <Send size={14} /> },
];

const ResultSection = () => {
  const role = useAuthStore((s) => s.user?.role);
  const visibleTabs = useMemo(() => TABS.filter((t) => !t.roles || (role && t.roles.includes(role))), [role]);
  const [activeTab, setActiveTab] = useState<Tab>('subject');
  useEffect(() => { document.title = 'Results - AL RAWA English School'; }, []);
  useEffect(() => { useUIStore.getState().registerSwipeBack(() => setActiveTab('subject')); }, []);
  useEffect(() => {
    const handler = (e: Event) => {
      const tab = (e as CustomEvent).detail as Tab;
      if (tab && visibleTabs.some((t) => t.key === tab)) setActiveTab(tab);
    };
    window.addEventListener('alrawa-results-tab', handler);
    return () => window.removeEventListener('alrawa-results-tab', handler);
  }, [visibleTabs]);

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
        {visibleTabs.map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold transition-all shrink-0 ${activeTab === t.key ? 'bg-school-primary text-white shadow-lg' : 'bg-white border border-school-border hover:border-school-accent'}`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'tasks' && <MyTasksTab />}
      {activeTab === 'overview' && <OverviewTab />}
      {activeTab === 'subject' && <EnterBySubject />}
      {activeTab === 'student' && <EnterByStudent />}
      {activeTab === 'tabulation' && <TabulationTab />}
      {activeTab === 'reports' && <AllReportCardsTab />}
      {activeTab === 'subjects' && <SubjectManager />}
      {activeTab === 'publish' && <PublishResultsTab />}
    </div>
  );
};

export default ResultSection;
