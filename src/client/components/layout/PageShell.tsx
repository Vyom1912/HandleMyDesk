import React from 'react';
import { ChevronsRight, Search } from 'lucide-react';
import { useApp } from '../../context/AppContext';

/** Thin top bar shared by every page: sidebar toggle, breadcrumb trail and page actions. */
export const TopBar: React.FC<{ crumbs: React.ReactNode[]; actions?: React.ReactNode }> = ({ crumbs, actions }) => {
  const { sidebarCollapsed, setSidebarCollapsed, setIsProjectPickerOpen } = useApp();
  return (
    <div className="h-11 shrink-0 flex items-center justify-between gap-2 px-3 border-b border-line bg-canvas">
      <div className="flex items-center gap-1 min-w-0">
        {sidebarCollapsed && (
          <button
            onClick={() => setSidebarCollapsed(false)}
            className="hidden lg:flex w-7 h-7 items-center justify-center rounded-md text-fg-muted hover:bg-hover"
            aria-label="Show sidebar (Ctrl+\)"
            title="Show sidebar (Ctrl+\)"
          >
            <ChevronsRight size={16} />
          </button>
        )}
        <nav aria-label="Breadcrumb" className="min-w-0">
          <ol className="flex items-center gap-1 text-sm min-w-0">
            {crumbs.map((c, i) => (
              // Only the last crumb (usually a long name) shortens; earlier ones stay readable
              <li key={i} className={`flex items-center gap-1 ${i === crumbs.length - 1 ? 'text-fg min-w-0' : 'text-fg-muted shrink-0'}`}>
                {i > 0 && (
                  <span className="text-fg-faint" aria-hidden="true">
                    /
                  </span>
                )}
                <span className="truncate">{c}</span>
              </li>
            ))}
          </ol>
        </nav>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {actions}
        {/* Phones: search lives up here (the bottom bar has Home, tasks, projects, alerts, menu) */}
        <button
          onClick={() => setIsProjectPickerOpen(true)}
          className="lg:hidden w-10 h-10 flex items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
          aria-label="Search"
        >
          <Search size={18} />
        </button>
      </div>
    </div>
  );
};

/** Standard page: top bar, then a scrolling column with a title. */
export const PageShell: React.FC<{
  title: string;
  crumb?: string;
  description?: string;
  actions?: React.ReactNode;
  topActions?: React.ReactNode;
  width?: 'narrow' | 'wide';
  children: React.ReactNode;
}> = ({ title, crumb, description, actions, topActions, width = 'wide', children }) => (
  <div className="flex-1 flex flex-col min-h-0">
    <TopBar crumbs={[crumb ?? title]} actions={topActions} />
    <div className="flex-1 overflow-y-auto">
      <div className={`mx-auto px-4 sm:px-8 lg:px-12 py-4 sm:py-8 ${width === 'narrow' ? 'max-w-4xl' : 'max-w-6xl'}`}>
        <header className="flex flex-wrap items-end justify-between gap-3 sm:gap-4 mb-4 sm:mb-6">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-fg">{title}</h1>
            {description && <p className="text-sm text-fg-muted mt-1">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
        {children}
      </div>
    </div>
  </div>
);
