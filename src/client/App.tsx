import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, RefreshCw, LogOut, LifeBuoy } from 'lucide-react';
import { SupportModal } from './components/modals/SupportModal';
import { useOffice } from './services/office';
import { returnToOwnerConsole } from './services/api';
import { useApp } from './context/AppContext';
import { Sidebar } from './components/layout/Sidebar';
import { BottomNav } from './components/layout/BottomNav';
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
import { useKeyboardShortcuts, ShortcutsModal } from './components/ui/Shortcuts';
import { WorkspaceSkeleton } from './components/ui/Skeleton';

const MobileSidebar: React.FC = () => {
  const { mobileNavOpen, setMobileNavOpen } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  useDialogBehavior(mobileNavOpen, () => setMobileNavOpen(false), ref);
  if (!mobileNavOpen) return null;
  return (
    <div className="lg:hidden fixed inset-0 z-40 bg-overlay animate-fade-in" onMouseDown={(e) => e.target === e.currentTarget && setMobileNavOpen(false)}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Sidebar" tabIndex={-1} className="focus:outline-none h-full w-[300px] max-w-[85vw] shadow-xl">
        <Sidebar />
      </div>
    </div>
  );
};

// Shown while the live connection is down; waits 2 s so brief blips don't flash
const ConnectionNotice: React.FC = () => {
  const { connection } = useApp();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (connection === 'online') return setVisible(false);
    const t = setTimeout(() => setVisible(true), 2000);
    return () => clearTimeout(t);
  }, [connection]);
  if (!visible || connection === 'online') return null;
  return (
    <div role="status" className="fixed top-3 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 h-8 px-3 rounded-full bg-fg text-canvas text-meta shadow-lg animate-fade-in">
      <span className="w-2 h-2 rounded-full bg-tone-amber-bg animate-pulse" aria-hidden="true" />
      {connection === 'offline' ? "You're offline. Changes can't be saved until the connection is back." : 'Reconnecting… live updates are paused.'}
    </div>
  );
};

// While the HandleMyDesk owner works inside this office as support
const SupportVisitBanner: React.FC = () => {
  // Also loads the office's branding (colour, logo) for the whole app
  const office = useOffice();
  if (!office?.supportVisit) return null;
  return (
    <div role="status" className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] lg:bottom-4 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 max-w-[calc(100vw-2rem)] pl-4 pr-1.5 py-1.5 rounded-full bg-fg text-canvas text-meta shadow-lg">
      <LifeBuoy size={15} className="shrink-0" />
      <span className="truncate">
        Support visit: <strong>{office.name}</strong>
      </span>
      <button onClick={returnToOwnerConsole} className="shrink-0 h-8 px-3 rounded-full bg-canvas text-fg font-medium hover:opacity-90">
        Back to owner console
      </button>
    </div>
  );
};

export const App: React.FC = () => {
  const { authStatus, mustChangePassword, route, setIsProjectPickerOpen, sidebarCollapsed, setSidebarCollapsed, loading, error, retryLoad, logout } = useApp();

  // Unread count on the home-screen icon (installed app on Android, and iPhone from iOS 16.4)
  const { notificationCount } = useApp();
  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (authStatus !== 'signed_in') {
      nav.clearAppBadge?.().catch(() => {});
      return;
    }
    if (notificationCount > 0) nav.setAppBadge?.(notificationCount).catch(() => {});
    else nav.clearAppBadge?.().catch(() => {});
  }, [notificationCount, authStatus]);

  useKeyboardShortcuts();

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
      <WorkspaceSkeleton />
    );
  }

  return (
    <div className="flex h-[100dvh] w-full bg-canvas text-fg overflow-hidden" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:px-3 focus:py-2 focus:rounded-md focus:bg-accent focus:text-on-accent">
        Skip to content
      </a>

      {!sidebarCollapsed && (
        <aside className="hidden lg:block w-[248px] shrink-0 h-full">
          <Sidebar />
        </aside>
      )}
      <MobileSidebar />
      <BottomNav />

      {/* Below laptop width the bottom bar takes 56 px (plus the home-indicator area) */}
      <main id="main-content" tabIndex={-1} className="flex-1 flex flex-col min-w-0 min-h-0 focus:outline-none pb-[calc(3.5rem+env(safe-area-inset-bottom))] lg:pb-0">
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
      <ShortcutsModal />
      <ConnectionNotice />
      <SupportModal />
      <SupportVisitBanner />
      <ConfirmDialog />
      <ToastBanner />
    </div>
  );
};
