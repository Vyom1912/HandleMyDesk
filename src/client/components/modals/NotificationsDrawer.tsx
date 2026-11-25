import React, { useRef, useState } from 'react';
import { X, Check } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useDialogBehavior } from '../ui/Modal';
import { NotificationItem } from '../../../types';
import { DOT, timeAgo } from '../ui/Badges';
import { Segmented } from '../ui/Field';

const TYPE_DOT: Record<NotificationItem['type'], string> = {
  success: DOT.green,
  alert: DOT.red,
  warning: DOT.amber,
  info: DOT.blue,
};

export const NotificationsDrawer: React.FC = () => {
  const { isNotificationsOpen, setIsNotificationsOpen, notifications, notificationCount, markNotificationRead, markAllNotificationsRead, openProject } = useApp();
  const [filter, setFilter] = useState<'unread' | 'all'>('all');
  const ref = useRef<HTMLDivElement>(null);
  const close = () => setIsNotificationsOpen(false);
  useDialogBehavior(isNotificationsOpen, close, ref);

  if (!isNotificationsOpen) return null;

  const visible = filter === 'unread' ? notifications.filter((n) => !n.read) : notifications;

  const handleOpen = (notif: NotificationItem) => {
    if (!notif.read) markNotificationRead(notif.id);
    if (notif.projectId) {
      openProject(notif.projectId);
      close();
    }
  };

  return (
    <div className="fixed inset-0 bg-overlay z-50 flex justify-end animate-fade-in" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="inbox-title" className="bg-surface border-l border-line w-full max-w-sm h-full flex flex-col shadow-[0_0_40px_rgb(0_0_0/0.12)]">
        <div className="h-12 px-4 border-b border-line flex items-center justify-between gap-2">
          <h2 id="inbox-title" className="text-[15px] font-semibold text-fg">
            Inbox
          </h2>
          <div className="flex items-center gap-1">
            {notificationCount > 0 && (
              <button onClick={markAllNotificationsRead} className="h-7 px-2 rounded-md text-[13px] text-fg-muted hover:text-fg hover:bg-hover">
                Mark all read
              </button>
            )}
            <button onClick={close} className="w-7 h-7 flex items-center justify-center rounded-md text-fg-faint hover:text-fg hover:bg-hover" aria-label="Close inbox">
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="px-4 py-2.5 border-b border-line">
          <Segmented
            label="Filter notifications"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'unread', label: `Unread${notificationCount ? ` (${notificationCount})` : ''}` },
            ]}
          />
        </div>

        <ul className="flex-1 overflow-y-auto">
          {visible.length === 0 ? (
            <li className="text-sm text-fg-muted text-center py-20">{filter === 'unread' ? 'No unread notifications.' : "You're all caught up."}</li>
          ) : (
            visible.map((notif) => (
              <li key={notif.id} className="group border-b border-line">
                <div className={`flex items-start gap-3 px-4 py-3 hover:bg-subtle ${notif.read ? '' : 'bg-accent-soft/40'}`}>
                  <span aria-hidden="true" className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${notif.read ? 'bg-transparent' : TYPE_DOT[notif.type]}`} />
                  <button onClick={() => handleOpen(notif)} className="flex-1 text-left min-w-0">
                    <div className={`text-sm ${notif.read ? 'text-fg-muted' : 'text-fg font-medium'}`}>
                      {!notif.read && <span className="sr-only">Unread: </span>}
                      {notif.title}
                    </div>
                    <div className="text-[13px] text-fg-muted mt-0.5 leading-snug">{notif.message}</div>
                    <div className="text-xs text-fg-faint mt-1">
                      {timeAgo(notif.timestamp)}
                      {notif.projectName && ` · ${notif.projectName}`}
                    </div>
                  </button>
                  {!notif.read && (
                    <button
                      onClick={() => markNotificationRead(notif.id)}
                      className="w-7 h-7 flex items-center justify-center rounded-md text-fg-faint hover:text-fg hover:bg-hover opacity-0 group-hover:opacity-100 focus:opacity-100"
                      aria-label={`Mark "${notif.title}" as read`}
                    >
                      <Check size={14} />
                    </button>
                  )}
                </div>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
};
