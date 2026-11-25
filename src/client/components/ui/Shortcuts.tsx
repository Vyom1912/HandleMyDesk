import React, { useEffect, useRef } from 'react';
import { useApp, PageView } from '../../context/AppContext';
import { Modal } from './Modal';
import { markOnboarding } from '../../services/onboarding';

// Fired by the "n" shortcut; the open project listens and shows its New task dialog
export const NEW_TASK_EVENT = 'novadesk:new-task';

const GO_TO: Record<string, PageView> = { h: 'home', t: 'tasks', p: 'projects', c: 'clients', m: 'team', a: 'admin' };

export const SHORTCUT_GROUPS: Array<{ title: string; items: Array<{ keys: string[]; label: string }> }> = [
  {
    title: 'Anywhere',
    items: [
      { keys: ['Ctrl', 'K'], label: 'Search projects, tasks, notes, files and people' },
      { keys: ['/'], label: 'Search' },
      { keys: ['Ctrl', '\\'], label: 'Show or hide the sidebar' },
      { keys: ['?'], label: 'Show these shortcuts' },
      { keys: ['Esc'], label: 'Close a dialog, panel or menu' },
    ],
  },
  {
    title: 'Go to',
    items: [
      { keys: ['G', 'H'], label: 'Home' },
      { keys: ['G', 'T'], label: 'My tasks' },
      { keys: ['G', 'P'], label: 'All projects' },
      { keys: ['G', 'C'], label: 'Clients' },
      { keys: ['G', 'M'], label: 'Team' },
    ],
  },
  {
    title: 'In a project',
    items: [
      { keys: ['N'], label: 'New task' },
      { keys: ['Ctrl', 'Enter'], label: 'Save a description, note or comment' },
    ],
  },
];

// Single-key shortcuts must not fire while someone is typing or a dialog is open
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

export function useKeyboardShortcuts() {
  const { authStatus, route, navigate, currentUser, setIsProjectPickerOpen, setIsShortcutsOpen, sidebarCollapsed, setSidebarCollapsed } = useApp();
  const pendingG = useRef(0);

  useEffect(() => {
    if (authStatus !== 'signed_in') return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsProjectPickerOpen(true);
        return;
      }
      if (mod && e.key === '\\') {
        e.preventDefault();
        setSidebarCollapsed(!sidebarCollapsed);
        return;
      }
      if (mod || e.altKey || isTyping(e.target) || document.querySelector('[role="dialog"]')) return;

      const key = e.key.toLowerCase();
      if (pendingG.current && Date.now() - pendingG.current < 1500 && GO_TO[key]) {
        pendingG.current = 0;
        if (GO_TO[key] === 'admin' && currentUser?.role !== 'admin') return;
        e.preventDefault();
        navigate({ view: GO_TO[key] });
        return;
      }
      pendingG.current = 0;

      if (e.key === '?') {
        e.preventDefault();
        setIsShortcutsOpen(true);
      } else if (e.key === '/') {
        e.preventDefault();
        setIsProjectPickerOpen(true);
      } else if (key === 'g') {
        pendingG.current = Date.now();
      } else if (key === 'n' && route.view === 'project') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(NEW_TASK_EVENT));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [authStatus, route.view, navigate, currentUser?.role, setIsProjectPickerOpen, setIsShortcutsOpen, sidebarCollapsed, setSidebarCollapsed]);
}

const Key: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className="inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded border border-line-strong bg-subtle text-xs font-sans text-fg">{children}</kbd>
);

export const ShortcutsModal: React.FC = () => {
  const { isShortcutsOpen, setIsShortcutsOpen, currentUser } = useApp();
  useEffect(() => {
    if (isShortcutsOpen) markOnboarding(currentUser?.id, 'shortcuts');
  }, [isShortcutsOpen, currentUser?.id]);
  return (
    <Modal open={isShortcutsOpen} onClose={() => setIsShortcutsOpen(false)} title="Keyboard shortcuts" size="lg">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-6">
        {SHORTCUT_GROUPS.map((g) => (
          <section key={g.title}>
            <h3 className="text-[13px] font-medium text-fg-muted mb-2">{g.title}</h3>
            <ul className="space-y-2">
              {g.items.map((item) => (
                <li key={item.label} className="flex items-center justify-between gap-3 text-sm text-fg">
                  <span>{item.label}</span>
                  <span className="flex items-center gap-1 shrink-0">
                    {item.keys.map((k, i) => (
                      <React.Fragment key={k}>
                        {i > 0 && item.keys[0] === 'G' && <span className="text-xs text-fg-faint">then</span>}
                        <Key>{k}</Key>
                      </React.Fragment>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className="text-xs text-fg-faint mt-6">Single-letter shortcuts don't fire while you're typing in a field.</p>
    </Modal>
  );
};
