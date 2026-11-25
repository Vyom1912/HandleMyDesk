import React, { useEffect, useRef, useState } from 'react';
import {
  Home,
  CheckSquare,
  Inbox,
  FolderKanban,
  Building2,
  Users,
  Search,
  Plus,
  ChevronRight,
  ChevronsLeft,
  Star,
  Sun,
  Moon,
  Monitor,
  LogOut,
  UserCircle2,
  ChevronsUpDown,
  LayoutList,
  SquareKanban,
  CalendarDays,
  FileText,
  BookText,
  MessageSquare,
  Milestone,
  Link2,
  Shield,
  Keyboard,
} from 'lucide-react';
import { useApp, PageView, ThemePreference } from '../../context/AppContext';
import { Project, ProjectSection } from '../../../types';
import { Avatar, StatusDot } from '../ui/Badges';

const NAV: Array<{ view: PageView; label: string; icon: React.ElementType }> = [
  { view: 'home', label: 'Home', icon: Home },
  { view: 'tasks', label: 'My tasks', icon: CheckSquare },
  { view: 'projects', label: 'All projects', icon: FolderKanban },
  { view: 'clients', label: 'Clients', icon: Building2 },
  { view: 'team', label: 'Team', icon: Users },
];

// The sections most people jump between; the rest are one click away in the project header
const QUICK_SECTIONS: Array<{ id: ProjectSection; label: string; icon: React.ElementType }> = [
  { id: 'overview', label: 'Overview', icon: LayoutList },
  { id: 'tasks', label: 'Tasks', icon: CheckSquare },
  { id: 'kanban', label: 'Board', icon: SquareKanban },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  { id: 'timeline', label: 'Milestones', icon: Milestone },
  { id: 'files', label: 'Files', icon: FileText },
  { id: 'notes', label: 'Notes', icon: BookText },
  { id: 'links', label: 'Links', icon: Link2 },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
];

const EXPANDED_KEY = (userId: string) => `novadesk_sidebar_expanded_${userId}`;

function readExpanded(userId: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(EXPANDED_KEY(userId)) || '[]');
  } catch {
    return [];
  }
}

// Finger-sized rows on touchscreens (the sidebar opens from Menu there); compact with a mouse
const rowBase = 'group flex items-center gap-2.5 pointer-fine:gap-2 w-full h-10 pointer-fine:h-7 px-2.5 pointer-fine:px-2 rounded-md text-[15px] pointer-fine:text-sm text-left transition-colors';
const rowIdle = 'text-fg-muted hover:bg-hover hover:text-fg';
const rowActive = 'bg-selected text-fg font-medium';

export const Sidebar: React.FC = () => {
  const {
    currentUser,
    projects,
    favoriteIds,
    toggleFavorite,
    route,
    navigate,
    openProject,
    notificationCount,
    setIsNotificationsOpen,
    setIsProjectPickerOpen,
    setIsCreateProjectOpen,
    setIsAccountOpen,
    setSidebarCollapsed,
    setMobileNavOpen,
    theme,
    setTheme,
    logout,
    updateProfile,
    showToast,
    setIsShortcutsOpen,
  } = useApp();

  const [expanded, setExpanded] = useState<string[]>(() => readExpanded(currentUser?.id ?? ''));
  const [showClosed, setShowClosed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const activeProjectId = route.view === 'project' ? route.projectId : null;

  // Keep the open project expanded so its sections are visible
  useEffect(() => {
    if (activeProjectId && !expanded.includes(activeProjectId)) setExpanded((e) => [...e, activeProjectId]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId]);

  useEffect(() => {
    try {
      localStorage.setItem(EXPANDED_KEY(currentUser?.id ?? ''), JSON.stringify(expanded));
    } catch {
      // Storage unavailable
    }
  }, [expanded, currentUser?.id]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => menuRef.current && !menuRef.current.contains(e.target as Node) && setMenuOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const toggleExpanded = (id: string) => setExpanded((e) => (e.includes(id) ? e.filter((x) => x !== id) : [...e, id]));

  const canCreate = currentUser?.role === 'admin' || currentUser?.role === 'pm';
  const byName = (a: Project, b: Project) => a.name.localeCompare(b.name);
  const favorites = favoriteIds.map((id) => projects.find((p) => p.id === id)).filter((p): p is Project => !!p);
  const openProjects = projects.filter((p) => p.status === 'active' || p.status === 'on_hold').sort(byName);
  const closedProjects = projects.filter((p) => p.status === 'completed' || p.status === 'archived').sort(byName);

  const renderProjectRow = (project: Project, keyPrefix: string) => {
    const isOpen = expanded.includes(`${keyPrefix}${project.id}`);
    const isActive = activeProjectId === project.id;
    const isFavorite = favoriteIds.includes(project.id);
    const expandKey = `${keyPrefix}${project.id}`;
    return (
      <li key={expandKey}>
        <div className={`${rowBase} pl-1 pr-1 ${isActive && route.view === 'project' && route.section === 'overview' ? rowActive : isActive ? 'text-fg' : rowIdle}`}>
          <button
            onClick={() => toggleExpanded(expandKey)}
            className="w-8 h-8 pointer-fine:w-5 pointer-fine:h-5 shrink-0 flex items-center justify-center rounded text-fg-faint hover:bg-selected"
            aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${project.name}`}
            aria-expanded={isOpen}
          >
            <ChevronRight size={13} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} />
          </button>
          <button onClick={() => openProject(project.id, 'overview')} className="flex-1 flex items-center gap-2 min-w-0 h-full" aria-current={isActive ? 'page' : undefined} title={`${project.code} · ${project.name}`}>
            <StatusDot status={project.status} />
            <span className="truncate">{project.name}</span>
          </button>
          <button
            onClick={() => toggleFavorite(project.id)}
            className={`w-8 h-8 pointer-fine:w-5 pointer-fine:h-5 shrink-0 flex items-center justify-center rounded hover:bg-selected ${isFavorite ? 'text-tone-amber-fg' : 'text-fg-faint opacity-0 group-hover:opacity-100 focus:opacity-100'}`}
            aria-label={isFavorite ? `Remove ${project.name} from favorites` : `Add ${project.name} to favorites`}
            aria-pressed={isFavorite}
          >
            <Star size={12} fill={isFavorite ? 'currentColor' : 'none'} />
          </button>
        </div>
        {isOpen && (
          <ul className="ml-[18px] pl-2 border-l border-line my-0.5 space-y-px">
            {QUICK_SECTIONS.map((s) => {
              const sectionActive = isActive && route.view === 'project' && route.section === s.id;
              return (
                <li key={s.id}>
                  <button onClick={() => openProject(project.id, s.id)} className={`${rowBase} h-9 pointer-fine:h-[26px] text-sm pointer-fine:text-[13px] ${sectionActive ? rowActive : rowIdle}`} aria-current={sectionActive ? 'page' : undefined}>
                    <s.icon size={13} className="shrink-0 opacity-70" />
                    {s.label}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </li>
    );
  };

  const groupLabel = (children: React.ReactNode, action?: React.ReactNode) => (
    <div className="flex items-center justify-between h-9 pointer-fine:h-7 px-2 mt-4 mb-0.5">
      <span className="text-xs font-medium text-fg-faint">{children}</span>
      {action}
    </div>
  );

  const THEMES: Array<{ value: ThemePreference; label: string; icon: React.ElementType }> = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ];

  return (
    <nav aria-label="Workspace" className="h-full w-full flex flex-col bg-sidebar border-r border-line select-none">
      {/* Account / workspace switcher */}
      <div className="relative px-2 pt-2" ref={menuRef}>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="flex-1 flex items-center gap-2 h-9 px-2 rounded-md hover:bg-hover min-w-0"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <span className="w-6 h-6 pointer-fine:w-5 pointer-fine:h-5 rounded bg-fg text-canvas text-[11px] font-bold flex items-center justify-center shrink-0" aria-hidden="true">
              N
            </span>
            <span className="flex-1 min-w-0 text-left">
              <span className="block text-sm font-semibold text-fg truncate leading-tight">NovaDesk</span>
              <span className="block text-xs text-fg-faint truncate leading-tight">{currentUser?.name}</span>
            </span>
            <ChevronsUpDown size={13} className="text-fg-faint shrink-0" />
          </button>
          <button
            onClick={() => {
              setSidebarCollapsed(true);
              setMobileNavOpen(false);
            }}
            className="w-10 h-10 pointer-fine:w-7 pointer-fine:h-7 flex items-center justify-center rounded-md text-fg-faint hover:bg-hover hover:text-fg"
            aria-label="Hide sidebar (Ctrl+\)"
            title="Hide sidebar (Ctrl+\)"
          >
            <ChevronsLeft size={15} />
          </button>
        </div>

        {menuOpen && (
          <div role="menu" className="absolute left-2 right-2 top-12 z-40 bg-surface border border-line rounded-lg shadow-[0_8px_28px_rgb(0_0_0/0.14)] p-1 animate-fade-in">
            <div className="flex items-center gap-2.5 px-2 py-2">
              <Avatar src={currentUser?.avatar} name={currentUser?.name ?? ''} size={28} />
              <div className="min-w-0">
                <div className="text-sm font-medium text-fg truncate">{currentUser?.name}</div>
                <div className="text-xs text-fg-faint truncate">{currentUser?.email}</div>
              </div>
            </div>
            <div className="h-px bg-line my-1" />
            <div className="px-2 pt-1 pb-1.5">
              <div className="text-xs text-fg-faint mb-1.5">Status</div>
              <div className="grid grid-cols-3 gap-1" role="group" aria-label="Your status">
                {([
                  ['active', 'Available', 'bg-tone-green-fg'],
                  ['busy', 'Busy', 'bg-tone-red-fg'],
                  ['away', 'Away', 'bg-tone-amber-fg'],
                ] as const).map(([value, text, dot]) => (
                  <button
                    key={value}
                    onClick={() => updateProfile({ status: value }).catch((err) => showToast(err.message, 'error'))}
                    aria-pressed={currentUser?.status === value}
                    className={`flex items-center justify-center gap-1.5 h-8 rounded-md text-xs border ${
                      currentUser?.status === value ? 'border-accent text-accent-ink bg-accent-soft' : 'border-line text-fg-muted hover:bg-hover'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${dot}`} aria-hidden="true" />
                    {text}
                  </button>
                ))}
              </div>
            </div>
            <div className="px-2 pt-1 pb-1.5">
              <div className="text-xs text-fg-faint mb-1.5">Appearance</div>
              <div className="grid grid-cols-3 gap-1" role="group" aria-label="Theme">
                {THEMES.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setTheme(t.value)}
                    aria-pressed={theme === t.value}
                    className={`flex flex-col items-center gap-1 py-1.5 rounded-md text-xs border ${
                      theme === t.value ? 'border-accent text-accent-ink bg-accent-soft' : 'border-line text-fg-muted hover:bg-hover'
                    }`}
                  >
                    <t.icon size={14} />
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="h-px bg-line my-1" />
            <button
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setIsAccountOpen(true);
              }}
              className={`${rowBase} ${rowIdle}`}
            >
              <UserCircle2 size={15} /> Profile & password
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                setIsShortcutsOpen(true);
              }}
              className={`${rowBase} ${rowIdle}`}
            >
              <Keyboard size={15} /> Keyboard shortcuts
              <kbd className="ml-auto text-[11px] text-fg-faint font-sans">?</kbd>
            </button>
            <button role="menuitem" onClick={logout} className={`${rowBase} ${rowIdle}`}>
              <LogOut size={15} /> Sign out
            </button>
          </div>
        )}
      </div>

      <div className="px-2 pt-1 space-y-px">
        <button onClick={() => setIsProjectPickerOpen(true)} className={`${rowBase} ${rowIdle}`}>
          <Search size={15} className="shrink-0" />
          <span className="flex-1">Search</span>
          <kbd className="text-[11px] text-fg-faint font-sans">Ctrl K</kbd>
        </button>
        <button onClick={() => setIsNotificationsOpen(true)} className={`${rowBase} ${rowIdle}`}>
          <Inbox size={15} className="shrink-0" />
          <span className="flex-1">Inbox</span>
          {notificationCount > 0 && (
            <span className="min-w-5 h-[18px] px-1.5 rounded-full bg-accent text-on-accent text-[11px] font-semibold flex items-center justify-center" aria-label={`${notificationCount} unread`}>
              {notificationCount > 99 ? '99+' : notificationCount}
            </span>
          )}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        <ul className="mt-3 space-y-px">
          {[...NAV, ...(currentUser?.role === 'admin' ? [{ view: 'admin' as PageView, label: 'Admin', icon: Shield }] : [])].map(({ view, label, icon: Icon }) => (
            <li key={view}>
              <button onClick={() => navigate({ view })} aria-current={route.view === view ? 'page' : undefined} className={`${rowBase} ${route.view === view ? rowActive : rowIdle}`}>
                <Icon size={15} className="shrink-0" />
                {label}
              </button>
            </li>
          ))}
        </ul>

        {favorites.length > 0 && (
          <>
            {groupLabel('Favorites')}
            <ul className="space-y-px">
              {favorites.map((p) => (
                renderProjectRow(p, 'fav:')
              ))}
            </ul>
          </>
        )}

        {groupLabel(
          'Projects',
          canCreate && (
              <button
                onClick={() => setIsCreateProjectOpen(true)}
                className="w-8 h-8 pointer-fine:w-5 pointer-fine:h-5 flex items-center justify-center rounded text-fg-faint hover:bg-hover hover:text-fg"
                aria-label="New project"
                title="New project"
              >
                <Plus size={14} />
              </button>
          )
        )}
        {openProjects.length === 0 ? (
          <p className="px-2 py-1 text-[13px] text-fg-faint leading-snug">
            {canCreate ? 'No active projects yet. Use + to create one.' : "You're not on any active project yet. When a project manager adds you, it appears here."}
          </p>
        ) : (
          <ul className="space-y-px">
            {openProjects.map((p) => (
              renderProjectRow(p, '')
            ))}
          </ul>
        )}

        {closedProjects.length > 0 && (
          <>
            <button onClick={() => setShowClosed((s) => !s)} className="flex items-center gap-1 h-10 pointer-fine:h-7 px-2 mt-3 text-xs font-medium text-fg-faint hover:text-fg" aria-expanded={showClosed}>
              <ChevronRight size={12} className={`transition-transform ${showClosed ? 'rotate-90' : ''}`} />
              Completed & archived ({closedProjects.length})
            </button>
            {showClosed && (
              <ul className="space-y-px">
                {closedProjects.map((p) => (
                  renderProjectRow(p, '')
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </nav>
  );
};
