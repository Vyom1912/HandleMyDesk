import { useEffect, useState } from 'react';

/*
 * "Install app" on Android/desktop Chrome and Edge: the browser offers it through the
 * beforeinstallprompt event, which must be caught early and used later from a tap.
 */

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

export const isInstalledApp = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
export const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Whether the browser can install the app right now, and a function to do it (call from a tap). */
export function useInstallPrompt(): [boolean, () => Promise<boolean>] {
  const [available, setAvailable] = useState(!!deferred);
  useEffect(() => {
    const update = () => setAvailable(!!deferred);
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);
  const install = async () => {
    if (!deferred) return false;
    const e = deferred;
    deferred = null;
    await e.prompt();
    const { outcome } = await e.userChoice;
    listeners.forEach((l) => l());
    return outcome === 'accepted';
  };
  return [available, install];
}
