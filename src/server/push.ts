import fs from 'fs';
import path from 'path';
import webpush from 'web-push';
import { db, currentTenant, runInTenant } from './db';
import { DATA_DIR, IS_PROD, IS_TEST } from './paths';
import { PushSubscriptionRecord } from '../types';

/*
 * Phone and desktop notifications (Web Push). The browser gives us a subscription; we keep it in
 * the person's workspace and send each new in-app notification to it, even when the app is closed.
 *
 * Needs a VAPID key pair. In production set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (generate them
 * with: npx web-push generate-vapid-keys). In development a pair is made once and kept in DATA_DIR.
 */

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

function loadKeys(): VapidKeys | null {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) return { publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY };
  if (IS_TEST) return null;
  // Without settings, a key pair is made once and kept with the data (copied to the cloud database
  // when DATABASE_URL is set, so it survives restarts). Phones then keep getting notifications.
  const file = path.join(DATA_DIR, '.vapid.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    const keys = webpush.generateVAPIDKeys();
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(keys));
    if (IS_PROD && !process.env.DATABASE_URL) {
      console.warn('Phone notifications: made new keys in DATA_DIR. Without a disk or DATABASE_URL they are lost on restart, and phones must turn notifications on again.');
    }
    return keys;
  }
}

const keys = loadKeys();
if (keys) {
  // Push services want a contact address for the sender; a generic one is fine
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@handlemydesk.app', keys.publicKey, keys.privateKey);
}

export const pushPublicKey = keys?.publicKey ?? null;

const MAX_DEVICES_PER_PERSON = 10;

export function isValidSubscription(sub: any): sub is PushSubscriptionRecord {
  return (
    sub &&
    typeof sub.endpoint === 'string' &&
    /^https:\/\//.test(sub.endpoint) &&
    sub.endpoint.length < 2000 &&
    typeof sub.keys?.p256dh === 'string' &&
    typeof sub.keys?.auth === 'string'
  );
}

/** Links a device to this person. A device belongs to one person at a time (the last to turn it on). */
export function addSubscription(userId: string, sub: PushSubscriptionRecord, workspace: { pushSubscriptions?: PushSubscriptionRecord[] }) {
  for (const ws of Object.values(db.getData().workspaces)) {
    if (ws.pushSubscriptions?.some((s) => s.endpoint === sub.endpoint)) {
      ws.pushSubscriptions = ws.pushSubscriptions.filter((s) => s.endpoint !== sub.endpoint);
    }
  }
  const record: PushSubscriptionRecord = { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, createdAt: new Date().toISOString() };
  workspace.pushSubscriptions = [record, ...(workspace.pushSubscriptions ?? [])].slice(0, MAX_DEVICES_PER_PERSON);
}

export function removeSubscription(endpoint: string) {
  let changed = false;
  for (const ws of Object.values(db.getData().workspaces)) {
    if (ws.pushSubscriptions?.some((s) => s.endpoint === endpoint)) {
      ws.pushSubscriptions = ws.pushSubscriptions.filter((s) => s.endpoint !== endpoint);
      changed = true;
    }
  }
  return changed;
}

export interface PushMessage {
  title: string;
  body: string;
  // Path inside the app to open when the notification is tapped, e.g. /#/p/prj-1
  url: string;
  tag?: string;
}

/** Sends to every device of this person. Never throws; devices that have gone away are forgotten. */
export function sendPush(userId: string, message: PushMessage): Promise<number> {
  if (!keys) return Promise.resolve(0);
  // Remember the office now: the replies arrive later, outside the request
  const tenant = currentTenant();
  const subs = tenant.db.getData().workspaces[userId]?.pushSubscriptions ?? [];
  if (subs.length === 0) return Promise.resolve(0);
  const payload = JSON.stringify(message);

  return Promise.all(
    subs.map((sub) =>
      webpush
        .sendNotification(sub, payload, { TTL: 24 * 3600, urgency: 'normal' })
        .then(() => true)
        .catch((err: any) => {
          // 404/410: the person turned notifications off or uninstalled the app
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            runInTenant(tenant, () => {
              if (removeSubscription(sub.endpoint)) db.save();
            });
          } else {
            console.warn(`Push to ${new URL(sub.endpoint).host} failed: ${err?.statusCode ?? ''} ${err?.message ?? err}`);
          }
          return false;
        })
    )
  ).then((results) => results.filter(Boolean).length);
}
