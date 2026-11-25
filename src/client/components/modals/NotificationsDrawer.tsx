import React, { useEffect, useRef, useState } from 'react';
import { X, Check, Settings, ArrowLeft } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useDialogBehavior } from '../ui/Modal';
import { NotificationItem, NotificationKind, NOTIFICATION_KINDS } from '../../../types';
import { api } from '../../services/api';
import { markOnboarding } from '../../services/onboarding';
import { DOT, timeAgo } from '../ui/Badges';
import { Segmented, toolbarSelectClass } from '../ui/Field';

const TYPE_DOT: Record<NotificationItem['type'], string> = {
  success: DOT.green,
  alert: DOT.red,
  warning: DOT.amber,
  info: DOT.blue,
};

/** Which notifications this person wants to receive. */
const Preferences: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const { showToast, currentUser } = useApp();
  const [muted, setMuted] = useState<NotificationKind[] | null>(null);
  useEffect(() => markOnboarding(currentUser?.id, 'notifications'), [currentUser?.id]);

  useEffect(() => {
    api
      .get<{ muted: NotificationKind[] }>('/api/notification-preferences')
      .then((r) => setMuted(r.muted))
      .catch((err) => showToast(err.message, 'error'));
  }, [showToast]);

  const toggle = async (kind: NotificationKind) => {
    if (!muted) return;
    const next = muted.includes(kind) ? muted.filter((k) => k !== kind) : [...muted, kind];
    setMuted(next);
    try {
      setMuted((await api.put<{ muted: NotificationKind[] }>('/api/notification-preferences', { muted: next })).muted);
    } catch (err: any) {
      setMuted(muted);
      showToast(err.message || 'Could not save', 'error');
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4">
      <button onClick={onBack} className="flex items-center gap-1.5 h-7 px-1.5 -ml-1.5 rounded-md text-[13px] text-fg-muted hover:text-fg hover:bg-hover mb-3">
        <ArrowLeft size={14} /> Back to inbox
      </button>
      <h3 className="text-sm font-semibold text-fg">Notify me about</h3>
      <p className="text-[13px] text-fg-muted mt-0.5 mb-3">Turned-off kinds won't appear in your inbox. Changes save straight away.</p>
      {!muted ? (
        <p className="text-sm text-fg-muted" role="status">
          Loading…
        </p>
      ) : (
        <ul className="space-y-px">
          {NOTIFICATION_KINDS.map(({ kind, label }) => {
            const on = !muted.includes(kind);
            return (
              <li key={kind}>
                <label className="flex items-center justify-between gap-3 h-10 px-2 rounded-md hover:bg-hover cursor-pointer">
                  <span className="text-sm text-fg">{label}</span>
                  <input type="checkbox" role="switch" checked={on} onChange={() => toggle(kind)} className="sr-only peer" />
                  <span
                    aria-hidden="true"
                    className={`relative w-8 h-[18px] rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-accent ${on ? 'bg-accent' : 'bg-line-strong'}`}
                  >
                    <span className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-all ${on ? 'left-4' : 'left-0.5'}`} />
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export const NotificationsDrawer: React.FC = () => {
  const { isNotificationsOpen, setIsNotificationsOpen, notifications, notificationCount, markNotificationRead, markAllNotificationsRead, openProject, hasMoreNotifications, loadMoreNotifications } = useApp();
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState<'unread' | 'all'>('all');
  const [project, setProject] = useState('all');
  const [showPrefs, setShowPrefs] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = () => {
    setIsNotificationsOpen(false);
    setShowPrefs(false);
  };
  useDialogBehavior(isNotificationsOpen, close, ref);

  if (!isNotificationsOpen) return null;

  const projectsInInbox = [...new Map(notifications.filter((n) => n.projectId).map((n) => [n.projectId!, n.projectName ?? 'Project'])).entries()].sort((a, b) =>
    a[1].localeCompare(b[1])
  );
  const visible = notifications.filter((n) => (filter === 'all' || !n.read) && (project === 'all' || n.projectId === project));

  const handleOpen = (notif: NotificationItem) => {
    if (!notif.read) markNotificationRead(notif.id);
    if (notif.projectId) {
      openProject(notif.projectId, notif.taskId ? 'tasks' : undefined, notif.taskId);
      close();
    }
  };

  return (
    <div className="fixed inset-0 bg-overlay z-50 flex justify-end animate-fade-in" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="inbox-title" className="bg-surface border-l border-line w-full max-w-sm h-full flex flex-col shadow-[0_0_40px_rgb(0_0_0/0.12)]">
        <div className="h-12 px-4 border-b border-line flex items-center justify-between gap-2">
          <h2 id="inbox-title" className="text-[15px] font-semibold text-fg">
            {showPrefs ? 'Notification settings' : 'Inbox'}
          </h2>
          <div className="flex items-center gap-1">
            {!showPrefs && notificationCount > 0 && (
              <button onClick={markAllNotificationsRead} className="h-7 px-2 rounded-md text-[13px] text-fg-muted hover:text-fg hover:bg-hover">
                Mark all read
              </button>
            )}
            {!showPrefs && (
              <button onClick={() => setShowPrefs(true)} className="w-7 h-7 flex items-center justify-center rounded-md text-fg-faint hover:text-fg hover:bg-hover" aria-label="Notification settings" title="Notification settings">
                <Settings size={15} />
              </button>
            )}
            <button onClick={close} className="w-7 h-7 flex items-center justify-center rounded-md text-fg-faint hover:text-fg hover:bg-hover" aria-label="Close inbox">
              <X size={16} />
            </button>
          </div>
        </div>

        {showPrefs ? (
          <Preferences onBack={() => setShowPrefs(false)} />
        ) : (
          <>
            <div className="px-4 py-2.5 border-b border-line flex flex-wrap items-center gap-2">
              <Segmented
                label="Filter notifications"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'unread', label: `Unread${notificationCount ? ` (${notificationCount})` : ''}` },
                ]}
              />
              {projectsInInbox.length > 1 && (
                <select aria-label="Filter by project" value={project} onChange={(e) => setProject(e.target.value)} className={`${toolbarSelectClass} flex-1 min-w-0 max-w-[180px]`}>
                  <option value="all">All projects</option>
                  {projectsInInbox.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <ul className="flex-1 overflow-y-auto">
              {visible.length === 0 ? (
                <li className="text-sm text-fg-muted text-center py-20 px-6">
                  {filter === 'unread' ? 'No unread notifications.' : "You're all caught up."}
                  <span className="block text-xs text-fg-faint mt-2">Assignments, @mentions, comments on your tasks and reminders show up here.</span>
                </li>
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
                        <div className="text-[13px] text-fg-muted mt-0.5 leading-snug break-words">{notif.message}</div>
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
              {hasMoreNotifications && (
                <li className="p-3 flex justify-center">
                  <button
                    onClick={() => {
                      setLoadingMore(true);
                      loadMoreNotifications().finally(() => setLoadingMore(false));
                    }}
                    disabled={loadingMore}
                    className="h-7 px-3 rounded-md border border-line text-[13px] text-fg-muted hover:text-fg hover:bg-hover disabled:opacity-50"
                  >
                    {loadingMore ? 'Loading…' : 'Load older notifications'}
                  </button>
                </li>
              )}
            </ul>
          </>
        )}
      </div>
    </div>
  );
};
