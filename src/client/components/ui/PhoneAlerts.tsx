import React, { useEffect, useState } from 'react';
import { BellRing, Share, X, Download, Check } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { getPushState, turnOnPush, PushState } from '../../services/push';
import { useInstallPrompt } from '../../services/install';
import { api } from '../../services/api';
import { Button } from './Field';

const DISMISS_KEY = (userId: string) => `hmd.phoneAlertsDismissed.${userId}`;

/**
 * "Get notifications on this phone": shown until they're on. Walks people through the one step
 * that's needed on their device (turn on, add to Home Screen on iPhone, or allow in settings).
 * On Home it can be hidden; inside Notifications it always shows while they're off.
 */
export const PhoneAlertsCard: React.FC<{ place: 'home' | 'inbox' }> = ({ place }) => {
  const { currentUser, showToast } = useApp();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [canInstall, install] = useInstallPrompt();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return place === 'home' && !!currentUser && localStorage.getItem(DISMISS_KEY(currentUser.id)) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    getPushState()
      .then(setState)
      .catch(() => setState('unsupported'));
  }, []);

  if (dismissed || !state || state === 'on' || state === 'unsupported' || state === 'server-off') return null;

  const turnOn = async () => {
    setBusy(true);
    try {
      const next = await turnOnPush();
      setState(next);
      if (next === 'on') {
        showToast('Notifications are on for this device', 'success');
        api.post('/api/push/test').catch(() => {});
      }
    } catch (err: any) {
      showToast(err.message || 'Could not turn on notifications', 'error');
    } finally {
      setBusy(false);
    }
  };

  const hide = () => {
    try {
      if (currentUser) localStorage.setItem(DISMISS_KEY(currentUser.id), '1');
    } catch {
      // Not remembered; hidden for now
    }
    setDismissed(true);
  };

  return (
    <section
      aria-label="Notifications on this device"
      className={`relative rounded-xl border border-accent/30 bg-accent-soft p-4 ${place === 'home' ? 'mb-6' : 'm-3'}`}
    >
      {place === 'home' && (
        <button onClick={hide} className="absolute top-2 right-2 w-9 h-9 flex items-center justify-center rounded-md text-fg-faint hover:text-fg hover:bg-hover" aria-label="Hide">
          <X size={16} />
        </button>
      )}
      <div className="flex gap-3 pr-6">
        <span className="w-10 h-10 shrink-0 rounded-full bg-accent text-on-accent flex items-center justify-center" aria-hidden="true">
          <BellRing size={18} />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-fg">Get notifications on this phone</h3>
          {state === 'off' && <p className="text-meta text-fg-muted mt-0.5">New tasks, @mentions, comments and due dates, even when HandleMyDesk is closed.</p>}
          {state === 'needs-install' && (
            <ol className="text-meta text-fg-muted mt-1 space-y-1 list-decimal pl-4">
              <li>
                Tap <Share size={13} className="inline -mt-0.5" aria-label="Share" /> <strong className="text-fg">Share</strong> at the bottom of Safari
              </li>
              <li>
                Choose <strong className="text-fg">Add to Home Screen</strong>
              </li>
              <li>Open HandleMyDesk from the new icon, and turn notifications on there</li>
            </ol>
          )}
          {state === 'blocked' && (
            <p className="text-meta text-fg-muted mt-0.5">
              Notifications are blocked for this site. Open your phone's <strong className="text-fg">Settings → Notifications</strong> (or the browser's site settings), allow
              them for HandleMyDesk, then come back.
            </p>
          )}
        </div>
      </div>
      {(state === 'off' || canInstall) && (
        <div className="flex flex-wrap gap-2 mt-3 pl-[52px]">
          {state === 'off' && (
            <Button disabled={busy} onClick={turnOn}>
              <Check size={15} /> {busy ? 'Turning on…' : 'Turn on'}
            </Button>
          )}
          {canInstall && (
            <Button variant="secondary" onClick={() => install().then((ok) => ok && showToast('HandleMyDesk is installed on this device', 'success'))}>
              <Download size={15} /> Install app
            </Button>
          )}
        </div>
      )}
    </section>
  );
};
