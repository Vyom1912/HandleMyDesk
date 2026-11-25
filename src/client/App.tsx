import React, { useEffect, useRef } from 'react';
import { AlertTriangle, RefreshCw, LogOut } from 'lucide-react';
import { useApp } from './context/AppContext';
import { Sidebar } from './components/layout/Sidebar';
import { ProjectWorkspace } from './components/project/ProjectWorkspace';
import { DashboardView } from './components/views/DashboardView';
import { ProjectDirectoryView } from './components/views/ProjectDirectoryView';
import { GlobalTasksView } from './components/views/GlobalTasksView';
import { ClientsView } from './components/views/ClientsView';
import { TeamView } from './components/views/TeamView';
import { LoginView } from './components/views/LoginView';
import { SetPasswordView } from './components/views/SetPasswordView';
import { AdminView } from './components/views/AdminView';
import { QuickProjectPickerModal } from './components/modals/QuickProjectPickerModal';
import { CreateProjectModal } from './components/modals/CreateProjectModal';
import { AccountModal } from './components/modals/AccountModal';
import { NotificationsDrawer } from './components/modals/NotificationsDrawer';
import { ConfirmDialog, ToastBanner } from './components/ui/Feedback';
import { Button } from './components/ui/Field';
import { useDialogBehavior } from './components/ui/Modal';

const Spinner: React.FC<{ label: string }> = ({ label }) => (
  <div className="flex-1 flex items-center justify-center" role="status">
    <div className="flex flex-col items-center gap-3 text-fg-muted text-sm">
      <div className="w-5 h-5 border-2 border-line-strong border-t-fg rounded-full animate-spin" aria-hidden="true"></div>
      <span>{label}</span>
    </div>
  </div>
);

const MobileSidebar: React.FC = () => {
  const { mobileNavOpen, setMobileNavOpen } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  useDialogBehavior(mobileNavOpen, () => setMobileNavOpen(false), ref);
  if (!mobileNavOpen) return null;
  return (
    <div className="lg:hidden fixed inset-0 z-40 bg-overlay animate-fade-in" onMouseDown={(e) => e.target === e.currentTarget && setMobileNavOpen(false)}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Sidebar" className="h-full w-[280px] max-w-[85vw] shadow-xl">
        <Sidebar />
      </div>
    </div>
  );
};

export const App: React.FC = () => {
  const { authStatus, mustChangePassword, route, setIsProjectPickerOpen, sidebarCollapsed, setSidebarCollapsed, loading, error, retryLoad, logout } = useApp();

  // Keyboard shortcuts
  useEffect(() => {
    if (authStatus !== 'signed_in') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsProjectPickerOpen(true);
      }
      if (mod && e.key === '\\') {
        e.preventDefault();
        setSidebarCollapsed(!sidebarCollapsed);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [authStatus, sidebarCollapsed, setIsProjectPickerOpen, setSidebarCollapsed]);

  if (authStatus === 'signed_out') {
    return (
      <>
        <LoginView />
        <ToastBanner />
      </>
    );
  }

  // Temporary password (new account or admin reset): choose a real one before anything else
  if (authStatus === 'signed_in' && mustChangePassword) {
    return (
      <>
        <SetPasswordView />
        <ToastBanner />
      </>
    );
  }

  // Initial load failed: show what happened and a way out, instead of an empty shell
  if (error && !loading) {
    return (
      <main className="h-full flex items-center justify-center bg-canvas px-4">
        <div role="alert" className="max-w-sm w-full text-center space-y-4">
          <AlertTriangle size={28} className="text-tone-amber-fg mx-auto" />
          <div>
            <h1 className="text-base font-semibold text-fg">Couldn't load your workspace</h1>
            <p className="text-sm text-fg-muted mt-1">{error}</p>
          </div>
          <div className="flex justify-center gap-2">
            <Button variant="secondary" onClick={logout}>
              <LogOut size={14} /> Sign out
            </Button>
            <Button onClick={retryLoad}>
              <RefreshCw size={14} /> Try again
            </Button>
          </div>
        </div>
      </main>
    );
  }

  if (authStatus === 'checking' || loading) {
    return (
      <div className="flex h-full bg-canvas">
        <Spinner label="Loading your workspace…" />
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] w-full bg-canvas text-fg overflow-hidden">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:px-3 focus:py-2 focus:rounded-md focus:bg-accent focus:text-on-accent">
        Skip to content
      </a>

      {!sidebarCollapsed && (
        <aside className="hidden lg:block w-[248px] shrink-0 h-full">
          <Sidebar />
        </aside>
      )}
      <MobileSidebar />

      <main id="main-content" tabIndex={-1} className="flex-1 flex flex-col min-w-0 min-h-0 focus:outline-none">
        {route.view === 'home' ? (
          <DashboardView />
        ) : route.view === 'projects' ? (
          <ProjectDirectoryView />
        ) : route.view === 'tasks' ? (
          <GlobalTasksView />
        ) : route.view === 'clients' ? (
          <ClientsView />
        ) : route.view === 'team' ? (
          <TeamView />
        ) : route.view === 'admin' ? (
          <AdminView />
        ) : route.view === 'project' ? (
          <ProjectWorkspace key={route.projectId} projectId={route.projectId} />
        ) : null}
      </main>

      <QuickProjectPickerModal />
      <CreateProjectModal />
      <AccountModal />
      <NotificationsDrawer />
      <ConfirmDialog />
      <ToastBanner />
    </div>
  );
};
