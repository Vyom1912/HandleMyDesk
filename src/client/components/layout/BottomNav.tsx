import React from 'react';
import { Home, CheckSquare, FolderKanban, Bell, Menu } from 'lucide-react';
import { useApp } from '../../context/AppContext';

/**
 * Thumb-reach navigation for phones and tablets (hidden on laptop/desktop widths, where the
 * sidebar is always visible). Sits above the iPhone home indicator via the safe-area inset.
 */
export const BottomNav: React.FC = () => {
  const { route, navigate, notificationCount, setIsNotificationsOpen, setMobileNavOpen } = useApp();

  const items: Array<{ label: string; icon: React.ElementType; active?: boolean; badge?: number; onClick: () => void }> = [
    { label: 'Home', icon: Home, active: route.view === 'home', onClick: () => navigate({ view: 'home' }) },
    { label: 'My tasks', icon: CheckSquare, active: route.view === 'tasks', onClick: () => navigate({ view: 'tasks' }) },
    { label: 'Projects', icon: FolderKanban, active: route.view === 'project' || route.view === 'projects', onClick: () => navigate({ view: 'projects' }) },
    { label: 'Alerts', icon: Bell, badge: notificationCount, onClick: () => setIsNotificationsOpen(true) },
    { label: 'Menu', icon: Menu, onClick: () => setMobileNavOpen(true) },
  ];

  return (
    <nav
      aria-label="Main"
      className="lg:hidden fixed inset-x-0 bottom-0 z-30 bg-canvas/95 backdrop-blur border-t border-line"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <ul className="grid grid-cols-5 h-14 max-w-xl mx-auto">
        {items.map(({ label, icon: Icon, active, badge, onClick }) => (
          <li key={label}>
            <button
              onClick={onClick}
              aria-current={active ? 'page' : undefined}
              aria-label={badge ? `${label}, ${badge} unread` : label}
              className={`relative w-full h-full flex flex-col items-center justify-center gap-0.5 text-tiny font-medium ${active ? 'text-fg' : 'text-fg-faint'}`}
            >
              <span className="relative">
                <Icon size={21} strokeWidth={active ? 2.2 : 1.8} />
                {!!badge && badge > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-micro font-semibold flex items-center justify-center" aria-hidden="true">
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </span>
              {label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
};
