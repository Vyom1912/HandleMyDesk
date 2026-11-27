import { api } from './api';

/*
 * Phone and desktop notifications. The service worker (public/sw.js) receives them from the server
 * and shows them even when the app is closed.
 */

export type PushState =
  | 'unsupported' // this browser can't do it
  | 'needs-install' // iPhone/iPad: only works after "Add to Home Screen"
  | 'server-off' // the server has no keys set up
  | 'blocked' // the person said no; must be changed in browser/phone settings
  | 'off'
  | 'on';

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isInstalled = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Not fatal: the app works without it, just without phone notifications
    });
  });
}

let configCache: Promise<{ enabled: boolean; publicKey: string | null }> | null = null;
const getConfig = () => (configCache ??= api.get<{ enabled: boolean; publicKey: string | null }>('/api/push/config').catch((err) => {
  configCache = null;
  throw err;
}));

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function getPushState(): Promise<PushState> {
  if (!supported()) return isIos() && !isInstalled() ? 'needs-install' : 'unsupported';
  if (isIos() && !isInstalled()) return 'needs-install';
  const config = await getConfig();
  if (!config.enabled) return 'server-off';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission !== 'granted') return 'off';
  return (await currentSubscription()) ? 'on' : 'off';
}

function keyToBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Asks permission (must be called from a tap/click) and links this device to the signed-in person. */
export async function turnOnPush(): Promise<PushState> {
  const config = await getConfig();
  if (!config.enabled || !config.publicKey) return 'server-off';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with different server keys won't work; replace it
  if (sub && sub.options.applicationServerKey) {
    const current = new Uint8Array(sub.options.applicationServerKey);
    const wanted = keyToBytes(config.publicKey);
    if (current.length !== wanted.length || current.some((b, i) => b !== wanted[i])) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(config.publicKey) });
  await api.post('/api/push/subscribe', { subscription: sub.toJSON() });
  return 'on';
}

export async function turnOffPush(): Promise<PushState> {
  const sub = await currentSubscription();
  if (sub) {
    await api.post('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => undefined);
    await sub.unsubscribe();
  }
  return 'off';
}

/**
 * After signing in: if this device already has notifications on, tell the server again. This links
 * the device to whoever signed in, and restores it if the server lost its data.
 */
export async function resyncPush(): Promise<void> {
  try {
    if (!supported() || Notification.permission !== 'granted') return;
    const config = await getConfig();
    if (!config.enabled) return;
    let sub = await currentSubscription();
    if (!sub) return;
    // The server's keys changed (e.g. a new server): permission is already given, so quietly
    // make a new subscription instead of leaving this phone without notifications
    if (config.publicKey && sub.options.applicationServerKey) {
      const current = new Uint8Array(sub.options.applicationServerKey);
      const wanted = keyToBytes(config.publicKey);
      if (current.length !== wanted.length || current.some((b, i) => b !== wanted[i])) {
        await sub.unsubscribe();
        const reg = await navigator.serviceWorker.ready;
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: wanted });
      }
    }
    await api.post('/api/push/subscribe', { subscription: sub.toJSON() });
  } catch {
    // Best effort
  }
}

/**
 * When signing out: stop this device getting the person's notifications. Takes the token because
 * sign-out clears the stored one straight away.
 */
export async function detachPushOnSignOut(token: string | null): Promise<void> {
  try {
    if (!token || !supported()) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await fetch('/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
  } catch {
    // Best effort
  }
}
