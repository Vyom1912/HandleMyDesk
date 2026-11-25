import React, { useState, useEffect, useRef } from 'react';
import { Search, FolderKanban, Home, CheckSquare, Building2, Users, CornerDownLeft } from 'lucide-react';
import { useApp, Route } from '../../context/AppContext';
import { useDialogBehavior } from '../ui/Modal';
import { StatusDot, label } from '../ui/Badges';

type Result = { id: string; title: string; subtitle?: string; icon: React.ReactNode; go: () => void; group: 'Pages' | 'Projects' };

export const QuickProjectPickerModal: React.FC = () => {
  const { isProjectPickerOpen, setIsProjectPickerOpen, projects, openProject, navigate, workspace } = useApp();
  const [search, setSearch] = useState('');
  const [highlight, setHighlight] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const close = () => {
    setIsProjectPickerOpen(false);
    setSearch('');
  };
  useDialogBehavior(isProjectPickerOpen, close, dialogRef);

  useEffect(() => setHighlight(0), [search]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${highlight}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  if (!isProjectPickerOpen) return null;

  const q = search.trim().toLowerCase();
  const pages: Array<{ title: string; route: Route; icon: React.ElementType }> = [
    { title: 'Home', route: { view: 'home' }, icon: Home },
    { title: 'My tasks', route: { view: 'tasks' }, icon: CheckSquare },
    { title: 'All projects', route: { view: 'projects' }, icon: FolderKanban },
    { title: 'Clients', route: { view: 'clients' }, icon: Building2 },
    { title: 'Team', route: { view: 'team' }, icon: Users },
  ];

  // With no query, show recently opened projects first
  const recentIds = [...(workspace?.tabs ?? [])].reverse().map((t) => t.projectId);
  const ordered = q
    ? projects.filter((p) => [p.name, p.code, p.clientName, p.category].some((v) => v.toLowerCase().includes(q)))
    : [...projects].sort((a, b) => {
        const ra = recentIds.indexOf(a.id);
        const rb = recentIds.indexOf(b.id);
        return (ra === -1 ? 999 : ra) - (rb === -1 ? 999 : rb) || a.name.localeCompare(b.name);
      });

  const results: Result[] = [
    ...ordered.slice(0, 30).map((p) => ({
      id: p.id,
      title: p.name,
      subtitle: `${p.code} · ${p.clientName}${p.status !== 'active' ? ` · ${label(p.status)}` : ''}`,
      icon: <StatusDot status={p.status} />,
      go: () => openProject(p.id),
      group: 'Projects' as const,
    })),
    ...pages
      .filter((p) => !q || p.title.toLowerCase().includes(q))
      .map((p) => ({ id: p.title, title: p.title, icon: <p.icon size={15} className="text-fg-faint" />, go: () => navigate(p.route), group: 'Pages' as const })),
  ];

  const choose = (r: Result) => {
    r.go();
    close();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter' && results[highlight]) {
      e.preventDefault();
      choose(results[highlight]);
    }
  };

  let lastGroup = '';

  return (
    <div className="fixed inset-0 bg-overlay z-50 flex items-start justify-center pt-4 sm:pt-[12vh] px-3 animate-fade-in" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Search" className="bg-surface border border-line rounded-lg shadow-[0_16px_48px_rgb(0_0_0/0.2)] w-full max-w-xl overflow-hidden">
        <div className="flex items-center px-3.5 h-12 border-b border-line gap-2.5">
          <Search size={16} className="text-fg-faint shrink-0" aria-hidden="true" />
          <input
            data-autofocus
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="search-results"
            aria-activedescendant={results[highlight] ? `search-${results[highlight].id}` : undefined}
            aria-label="Search projects and pages"
            placeholder="Search projects and pages…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full bg-transparent text-[15px] text-fg placeholder:text-fg-faint focus:outline-none"
          />
          <kbd className="text-[11px] text-fg-faint border border-line rounded px-1.5 py-0.5 font-sans">Esc</kbd>
        </div>

        <ul id="search-results" ref={listRef} role="listbox" className="max-h-[60vh] sm:max-h-[400px] overflow-y-auto p-1.5">
          {results.length === 0 && <li className="py-10 text-center text-sm text-fg-muted">No results for “{search}”</li>}
          {results.map((r, index) => {
            const header = r.group !== lastGroup ? r.group : null;
            lastGroup = r.group;
            return (
              <React.Fragment key={`${r.group}-${r.id}`}>
                {header && (
                  <li role="presentation" className="px-2 pt-2 pb-1 text-xs font-medium text-fg-faint">
                    {header === 'Projects' && !q ? 'Recent projects' : header}
                  </li>
                )}
                <li
                  id={`search-${r.id}`}
                  data-index={index}
                  role="option"
                  aria-selected={index === highlight}
                  onClick={() => choose(r)}
                  onMouseMove={() => setHighlight(index)}
                  className={`flex items-center gap-2.5 h-9 px-2 rounded-md cursor-pointer ${index === highlight ? 'bg-hover' : ''}`}
                >
                  <span className="w-4 flex justify-center shrink-0">{r.icon}</span>
                  <span className="text-sm text-fg truncate">{r.title}</span>
                  {r.subtitle && <span className="text-xs text-fg-faint truncate">{r.subtitle}</span>}
                  {index === highlight && <CornerDownLeft size={13} className="ml-auto text-fg-faint shrink-0" aria-hidden="true" />}
                </li>
              </React.Fragment>
            );
          })}
        </ul>
        <div className="hidden sm:flex px-3.5 h-9 items-center gap-4 border-t border-line text-xs text-fg-faint bg-subtle">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>Ctrl K anywhere</span>
        </div>
      </div>
    </div>
  );
};
