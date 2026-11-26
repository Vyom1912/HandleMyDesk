import { Response } from 'express';
import { AppEvent } from '../types';
import { currentTenant } from './db';

// Open server-sent-event streams, per office and user (one user may have several browser tabs).
// The same user id can exist in two offices, so the key includes the office.
const streams = new Map<string, Set<Response>>();
// Which key each stream was added under, so removal works without knowing the office
const keyOf = new WeakMap<Response, string>();

const key = (userId: string) => `${currentTenant().id}:${userId}`;

export function addStream(userId: string, res: Response) {
  const k = key(userId);
  if (!streams.has(k)) streams.set(k, new Set());
  streams.get(k)!.add(res);
  keyOf.set(res, k);
}

export function removeStream(_userId: string, res: Response) {
  const k = keyOf.get(res);
  const set = k ? streams.get(k) : undefined;
  if (!k || !set) return;
  set.delete(res);
  if (set.size === 0) streams.delete(k);
}

export function emitToUsers(userIds: Iterable<string>, event: AppEvent) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const userId of new Set(userIds)) {
    for (const res of streams.get(key(userId)) ?? []) res.write(payload);
  }
}

// Ends a user's live streams, e.g. after their sessions are revoked; valid sessions reconnect
export function closeStreamsFor(userId: string) {
  const k = key(userId);
  for (const res of streams.get(k) ?? []) res.end();
  streams.delete(k);
}

// Keep-alive every 15 s: stops proxies closing idle streams, and lets browsers notice a dead connection
setInterval(() => {
  for (const set of streams.values()) for (const res of set) res.write(': ping\n\n');
}, 15000).unref();
