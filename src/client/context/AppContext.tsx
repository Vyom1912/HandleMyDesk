import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { User, UserWorkspace, Project, NotificationItem, AppEvent, ProjectSection, isSystemTab } from '../../types';
import { api, getStoredToken, setStoredToken, openEventStream, UNAUTHORIZED_EVENT } from '../services/api';

type ToastType = 'info' | 'success' | 'error';
export interface Toast {
  id: number;
  message: string;
  type: ToastType;
  action?: { label: string; onClick: () => void };
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  // When set, the user must type this text to enable the confirm button
  requireText?: string;
}

export type ThemePreference = 'light' | 'dark' | 'system';
export type PageView = 'home' | 'tasks' | 'projects' | 'clients' | 'team' | 'admin';
export type Route = { view: PageView } | { view: 'project'; projectId: string; section: ProjectSection; taskId?: string };

export const PROJECT_SECTIONS: ProjectSection[] = [
  'overview',
  'tasks',
  'kanban',
  'calendar',
  'timeline',
  'deliverables',
  'files',
  'notes',
  'links',
  'chat',
  'team',
  'activity',
  'settings',
];

// URL hash <-> route. Hash routing keeps back/forward and shareable links working without server config.
const PAGE_PATHS: Record<PageView, string> = { home: '', tasks: 'tasks', projects: 'projects', clients: 'clients', team: 'team', admin: 'admin' };
// The server stores the last view using the original tab ids
const PAGE_TO_TAB: Record<PageView, string> = { home: 'dashboard', tasks: 'tasks', projects: 'directory', clients: 'clients', team: 'team', admin: 'admin' };

export function routeToHash(route: Route): string {
  if (route.view === 'project') {
    if (route.taskId) return `#/p/${route.projectId}/${route.section}/${route.taskId}`;
    return `#/p/${route.projectId}${route.section === 'overview' ? '' : `/${route.section}`}`;
  }
  return `#/${PAGE_PATHS[route.view]}`;
}

function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'p' && parts[1]) {
    const section = PROJECT_SECTIONS.includes(parts[2] as ProjectSection) ? (parts[2] as ProjectSection) : 'overview';
    const taskId = parts[3] ? decodeURIComponent(parts[3]) : undefined;
    return { view: 'project', projectId: decodeURIComponent(parts[1]), section, taskId };
  }
  const page = (Object.keys(PAGE_PATHS) as PageView[]).find((p) => PAGE_PATHS[p] === (parts[0] ?? ''));
  return { view: page ?? 'home' };
}

function tabToRoute(tabId: string): Route {
  if (isSystemTab(tabId)) {
    const page = (Object.keys(PAGE_TO_TAB) as PageView[]).find((p) => PAGE_TO_TAB[p] === tabId) ?? 'home';
    return { view: page };
  }
  return { view: 'project', projectId: tabId, section: 'overview' };
}

// Per-user so people sharing a browser don't inherit each other's place
const SECTION_KEY = (userId: string, projectId: string) => `novadesk_section_${userId}_${projectId}`;
const THEME_KEY = 'novadesk_theme';
const SIDEBAR_KEY = 'novadesk_sidebar';

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage unavailable (private mode): preference just won't persist
    }
  },
};

function applyTheme(pref: ThemePreference) {
  const dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

type AuthStatus = 'checking' | 'signed_out' | 'signed_in';

interface AppContextType {
  authStatus: AuthStatus;
  currentUser: User | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  // Set when the account still has a temporary password; the app asks for a new one first
  mustChangePassword: boolean;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  signOutEverywhere: () => Promise<void>;
  refreshEmployees: () => Promise<void>;
  allEmployees: User[];
  projects: Project[];
  refreshProjects: () => Promise<void>;
  workspace: UserWorkspace | null;
  favoriteIds: string[];
  toggleFavorite: (projectId: string) => Promise<void>;
  loading: boolean;
  error: string | null;
  retryLoad: () => void;
  // Navigation
  route: Route;
  navigate: (route: Route) => void;
  openProject: (projectId: string, section?: ProjectSection, taskId?: string) => void;
  // Live connection to the server: 'reconnecting' while it's down, 'offline' without a network
  connection: 'online' | 'reconnecting' | 'offline';
  updateProfile: (patch: Partial<Pick<User, 'name' | 'title' | 'phone' | 'status'>>) => Promise<void>;
  uploadAvatar: (file: File) => Promise<void>;
  removeAvatar: () => Promise<void>;
  isShortcutsOpen: boolean;
  setIsShortcutsOpen: (open: boolean) => void;
  // Appearance
  theme: ThemePreference;
  setTheme: (t: ThemePreference) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;
  mobileNavOpen: boolean;
  setMobileNavOpen: (v: boolean) => void;
  // Notifications
  notificationCount: number;
  notifications: NotificationItem[];
  markNotificationRead: (id: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  // Live updates
  subscribe: (listener: (event: AppEvent) => void) => () => void;
  // Modal states
  isProjectPickerOpen: boolean;
  setIsProjectPickerOpen: (open: boolean) => void;
  isCreateProjectOpen: boolean;
  setIsCreateProjectOpen: (open: boolean) => void;
  isAccountOpen: boolean;
  setIsAccountOpen: (open: boolean) => void;
  isNotificationsOpen: boolean;
  setIsNotificationsOpen: (open: boolean) => void;
  // Feedback
  toast: Toast | null;
  showToast: (message: string, type?: ToastType, action?: Toast['action']) => void;
  dismissToast: () => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  confirmState: (ConfirmOptions & { resolve: (ok: boolean) => void }) | null;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [authStatus, setAuthStatus] = useState<AuthStatus>(getStoredToken() ? 'checking' : 'signed_out');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [allEmployees, setAllEmployees] = useState<User[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [workspace, setWorkspace] = useState<UserWorkspace | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  const [theme, setThemeState] = useState<ThemePreference>(() => (store.get(THEME_KEY) as ThemePreference) || 'light');
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(() => store.get(SIDEBAR_KEY) === 'collapsed');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [confirmState, setConfirmState] = useState<AppContextType['confirmState']>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const listeners = useRef(new Set<(event: AppEvent) => void>());
  const routeRef = useRef(route);
  routeRef.current = route;
  const currentUserIdRef = useRef('');
  currentUserIdRef.current = currentUser?.id ?? '';

  const [isProjectPickerOpen, setIsProjectPickerOpen] = useState(false);
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [connection, setConnection] = useState<'online' | 'reconnecting' | 'offline'>(navigator.onLine ? 'online' : 'offline');

  // ---------- Feedback ----------
  const dismissToast = useCallback(() => {
    clearTimeout(toastTimer.current);
    setToast(null);
  }, []);

  const showToast = useCallback((message: string, type: ToastType = 'info', action?: Toast['action']) => {
    clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), message, type, action });
    // Give people time to reach an Undo button
    toastTimer.current = setTimeout(() => setToast(null), action ? 6000 : 3500);
  }, []);

  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setConfirmState({ ...options, resolve })),
    []
  );

  // ---------- Appearance ----------
  const setTheme = (t: ThemePreference) => {
    setThemeState(t);
    store.set(THEME_KEY, t);
  };

  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  const setSidebarCollapsed = (v: boolean) => {
    setSidebarCollapsedState(v);
    store.set(SIDEBAR_KEY, v ? 'collapsed' : 'open');
  };

  // ---------- Data ----------
  const refreshProjects = useCallback(async () => {
    try {
      setProjects(await api.get<Project[]>('/api/projects'));
    } catch (err) {
      console.error('Failed to load projects:', err);
    }
  }, []);

  const refreshWorkspace = useCallback(async () => {
    try {
      const res = await api.get<{ workspace: UserWorkspace }>('/api/workspace');
      setWorkspace(res.workspace);
    } catch (err) {
      console.error('Failed to refresh workspace:', err);
    }
  }, []);

  const loadInitialData = useCallback(async () => {
    if (!getStoredToken()) return;
    try {
      setLoading(true);
      setError(null);

      const authRes = await api.get<{ user: User; mustChangePassword: boolean }>('/api/auth/me');
      setCurrentUser(authRes.user);
      setMustChangePassword(authRes.mustChangePassword);
      setAuthStatus('signed_in');
      // Nothing else is available until the temporary password is replaced
      if (authRes.mustChangePassword) return;

      const [employeesRes, wsRes, notifsRes, projectsRes] = await Promise.all([
        api.get<User[]>('/api/employees'),
        api.get<{ workspace: UserWorkspace }>('/api/workspace'),
        api.get<NotificationItem[]>('/api/notifications'),
        api.get<Project[]>('/api/projects'),
      ]);
      setAllEmployees(employeesRes);
      setWorkspace(wsRes.workspace);
      setNotifications(notifsRes);
      setProjects(projectsRes);

      // No link in the address bar: resume where this person left off
      if (!window.location.hash || window.location.hash === '#' || window.location.hash === '#/') {
        const resume = tabToRoute(wsRes.workspace.activeTabId || 'dashboard');
        window.history.replaceState(null, '', routeToHash(resume));
        setRoute(resume);
      }
    } catch (err: any) {
      console.error('Failed to load initial data:', err);
      setError(err.message || 'Failed to load your workspace');
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    setStoredToken(null);
    setCurrentUser(null);
    setWorkspace(null);
    setProjects([]);
    setNotifications([]);
    setMustChangePassword(false);
    setAuthStatus('signed_out');
    setError(null);
  }, []);

  const login = async (email: string, password: string) => {
    const res = await api.post<{ user: User; token: string }>('/api/auth/login', { email, password });
    setStoredToken(res.token);
    await loadInitialData();
  };

  // Changing your password ends your other sessions; this tab continues with the new token
  const changePassword = async (currentPassword: string, newPassword: string) => {
    const res = await api.post<{ token: string }>('/api/auth/password', { currentPassword, newPassword });
    setStoredToken(res.token);
    if (mustChangePassword) {
      setMustChangePassword(false);
      await loadInitialData();
    }
  };

  const signOutEverywhere = async () => {
    try {
      await api.post('/api/auth/logout-all');
    } finally {
      logout();
    }
  };

  const refreshEmployees = useCallback(async () => {
    try {
      setAllEmployees(await api.get<User[]>('/api/employees'));
    } catch (err) {
      console.error('Failed to load people:', err);
    }
  }, []);

  useEffect(() => {
    loadInitialData();
    const handleUnauthorized = () => logout();
    window.addEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handleUnauthorized);
  }, [loadInitialData, logout]);

  // ---------- Navigation ----------
  const navigate = useCallback((next: Route) => {
    const hash = routeToHash(next);
    if (window.location.hash !== hash) window.location.hash = hash;
    else setRoute(next);
    setMobileNavOpen(false);
  }, []);

  const openProject = useCallback(
    (projectId: string, section?: ProjectSection, taskId?: string) => {
      const remembered = store.get(SECTION_KEY(currentUserIdRef.current, projectId)) as ProjectSection | null;
      const target = section ?? (taskId ? 'tasks' : remembered && PROJECT_SECTIONS.includes(remembered) ? remembered : 'overview');
      navigate({ view: 'project', projectId, section: target, taskId });
    },
    [navigate]
  );

  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Remember the last view on the server so people resume where they left off, on any device
  const routeKey = route.view === 'project' ? `p:${route.projectId}` : route.view;
  useEffect(() => {
    if (authStatus !== 'signed_in' || loading || mustChangePassword) return;
    const r = routeRef.current;
    if (r.view === 'project') {
      api
        .post<UserWorkspace>('/api/workspace/open-tab', { projectId: r.projectId })
        .then(setWorkspace)
        .catch(() => {
          // The project page itself explains missing access
        });
    } else {
      api
        .put<UserWorkspace>('/api/workspace', { tabs: workspace?.tabs ?? [], activeTabId: PAGE_TO_TAB[r.view] })
        .then(setWorkspace)
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, authStatus, loading, mustChangePassword]);

  useEffect(() => {
    if (route.view === 'project' && currentUser) store.set(SECTION_KEY(currentUser.id, route.projectId), route.section);
  }, [route, currentUser]);

  // ---------- Favorites ----------
  const favoriteIds = workspace?.favoriteProjectIds ?? [];

  const toggleFavorite = async (projectId: string) => {
    const favorite = !favoriteIds.includes(projectId);
    if (workspace) {
      setWorkspace({
        ...workspace,
        favoriteProjectIds: favorite ? [...favoriteIds, projectId] : favoriteIds.filter((id) => id !== projectId),
      });
    }
    try {
      setWorkspace(await api.post<UserWorkspace>('/api/workspace/favorites', { projectId, favorite }));
    } catch (err: any) {
      showToast(err.message || 'Could not update favorites', 'error');
      refreshWorkspace();
    }
  };

  // ---------- Live updates ----------
  useEffect(() => {
    if (authStatus !== 'signed_in' || !currentUser || mustChangePassword) return;
    const userId = currentUser.id;
    let dropped = false;
    const onStatus = (status: 'connected' | 'reconnecting') => {
      if (status === 'reconnecting') {
        dropped = true;
        setConnection(navigator.onLine ? 'reconnecting' : 'offline');
        return;
      }
      setConnection('online');
      if (dropped) {
        // Anything could have changed while we were away: refresh what's on screen
        dropped = false;
        refreshProjects();
        refreshWorkspace();
        api.get<NotificationItem[]>('/api/notifications').then(setNotifications).catch(() => {});
        listeners.current.forEach((l) => l({ type: 'reconnected' }));
      }
    };
    return openEventStream((event) => {
      if (event.type === 'notification') {
        setNotifications((prev) => [event.notification, ...prev.filter((n) => n.id !== event.notification.id)]);
        // Being added to a project should make it appear in the sidebar right away
        refreshProjects();
      }
      if (event.type === 'project-deleted') {
        refreshProjects();
        refreshWorkspace();
        const r = routeRef.current;
        if (r.view === 'project' && r.projectId === event.projectId && event.actorId !== userId) {
          showToast('That project was deleted', 'info');
          navigate({ view: 'projects' });
        }
      }
      if (event.type === 'project-updated' && (event.resource === 'project' || event.resource === 'team')) {
        refreshProjects();
      }
      listeners.current.forEach((l) => l(event));
    }, onStatus);
  }, [authStatus, currentUser?.id, mustChangePassword, refreshProjects, refreshWorkspace, navigate, showToast]);

  useEffect(() => {
    const goOffline = () => setConnection('offline');
    const goOnline = () => setConnection((c) => (c === 'offline' ? 'reconnecting' : c));
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  // ---------- Your profile ----------
  const applyUser = (user: User) => {
    setCurrentUser(user);
    setAllEmployees((list) => list.map((u) => (u.id === user.id ? user : u)));
  };

  const updateProfile = async (patch: Partial<Pick<User, 'name' | 'title' | 'phone' | 'status'>>) => {
    applyUser(await api.put<User>('/api/auth/me', patch));
  };

  const uploadAvatar = async (file: File) => {
    const form = new FormData();
    form.append('avatar', file);
    applyUser(await api.upload<User>('/api/auth/me/avatar', form));
  };

  const removeAvatar = async () => {
    applyUser(await api.delete<User>('/api/auth/me/avatar'));
  };

  const subscribe = useCallback((listener: (event: AppEvent) => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  // ---------- Notifications ----------
  const markNotificationRead = async (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    try {
      await api.post(`/api/notifications/${id}/read`);
    } catch (err) {
      console.error(err);
    }
  };

  const markAllNotificationsRead = async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      await api.post('/api/notifications/read-all');
    } catch (err) {
      console.error(err);
    }
  };

  const notificationCount = notifications.filter((n) => !n.read).length;

  return (
    <AppContext.Provider
      value={{
        authStatus,
        currentUser,
        login,
        logout,
        mustChangePassword,
        changePassword,
        signOutEverywhere,
        refreshEmployees,
        allEmployees,
        projects,
        refreshProjects,
        workspace,
        favoriteIds,
        toggleFavorite,
        loading,
        error,
        retryLoad: loadInitialData,
        route,
        navigate,
        openProject,
        theme,
        setTheme,
        sidebarCollapsed,
        setSidebarCollapsed,
        mobileNavOpen,
        setMobileNavOpen,
        notificationCount,
        notifications,
        markNotificationRead,
        markAllNotificationsRead,
        subscribe,
        isProjectPickerOpen,
        setIsProjectPickerOpen,
        isCreateProjectOpen,
        setIsCreateProjectOpen,
        isAccountOpen,
        setIsAccountOpen,
        isNotificationsOpen,
        isShortcutsOpen,
        setIsShortcutsOpen,
        connection,
        updateProfile,
        uploadAvatar,
        removeAvatar,
        setIsNotificationsOpen,
        toast,
        showToast,
        dismissToast,
        confirm,
        confirmState: confirmState && {
          ...confirmState,
          resolve: (ok: boolean) => {
            confirmState.resolve(ok);
            setConfirmState(null);
          },
        },
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};

// Admins manage every project; a PM manages the ones they lead (mirrors the server rule)
export function canManage(user: User | null, project: Pick<Project, 'leadId'> | null): boolean {
  if (!user || !project) return false;
  return user.role === 'admin' || (user.role === 'pm' && project.leadId === user.id);
}
