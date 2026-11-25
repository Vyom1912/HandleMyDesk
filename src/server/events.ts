import { Response } from 'express';
import { AppEvent } from '../types';

// Open server-sent-event streams, per user (one user may have several browser tabs)
const streams = new Map<string, Set<Response>>();

export function addStream(userId: string, res: Response) {
  if (!streams.has(userId)) streams.set(userId, new Set());
  streams.get(userId)!.add(res);
}

export function removeStream(userId: string, res: Response) {
  const set = streams.get(userId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) streams.delete(userId);
}

export function emitToUsers(userIds: Iterable<string>, event: AppEvent) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const userId of new Set(userIds)) {
    for (const res of streams.get(userId) ?? []) res.write(payload);
  }
}

// Ends a user's live streams, e.g. after their sessions are revoked; valid sessions reconnect
export function closeStreamsFor(userId: string) {
  for (const res of streams.get(userId) ?? []) res.end();
  streams.delete(userId);
}

// Keep proxies from closing idle streams
setInterval(() => {
  for (const set of streams.values()) for (const res of set) res.write(': ping\n\n');
}, 25000).unref();
