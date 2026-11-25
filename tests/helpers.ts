import { db } from '../src/server/db';
import { generateToken } from '../src/server/auth';

// Authorization header for a seeded employee, for use with supertest's .set()
export function as(userId: string): Record<string, string> {
  const user = db.getData().users.find((u) => u.id === userId);
  if (!user) throw new Error(`No seeded user ${userId}`);
  return { Authorization: `Bearer ${generateToken(user)}` };
}
