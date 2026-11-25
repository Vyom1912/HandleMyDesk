import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { db, DATA_DIR } from './db';
import { User, Project } from '../types';

function resolveJwtSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set when NODE_ENV=production');
  }
  if (process.env.NODE_ENV === 'test') return 'novadesk-test-secret';

  // Development: generate a random secret once and keep it, so sessions survive server restarts
  const secretFile = path.join(DATA_DIR, '.jwt-secret');
  try {
    return fs.readFileSync(secretFile, 'utf-8').trim();
  } catch {
    const secret = crypto.randomBytes(48).toString('hex');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(secretFile, secret, { mode: 0o600 });
    return secret;
  }
}

export const JWT_SECRET = resolveJwtSecret();

export interface AuthenticatedRequest extends Request {
  user?: User;
}

// Tokens carry the user's session version; bumping it (password change, reset, deactivation,
// "sign out everywhere") makes every token issued before that point stop working.
export function generateToken(user: User): string {
  const { sessionVersion } = db.getAuthState(user.id);
  return jwt.sign({ id: user.id, sv: sessionVersion }, JWT_SECRET, { expiresIn: '7d' });
}

// The only calls allowed until a temporary password has been replaced
const ALLOWED_DURING_PASSWORD_CHANGE = new Set(['GET /api/auth/me', 'POST /api/auth/password', 'POST /api/auth/logout-all']);

export function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  let userId: string;
  let tokenVersion: number;
  try {
    const decoded = jwt.verify(authHeader.substring(7), JWT_SECRET) as { id: string; sv?: number };
    userId = decoded.id;
    tokenVersion = decoded.sv ?? 0;
  } catch {
    res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
    return;
  }

  const user = db.getData().users.find((u) => u.id === userId);
  if (!user) {
    res.status(401).json({ error: 'Account no longer exists' });
    return;
  }
  if (user.active === false) {
    res.status(401).json({ error: 'This account has been deactivated' });
    return;
  }

  const { sessionVersion, mustChange } = db.getAuthState(user.id);
  if (tokenVersion !== sessionVersion) {
    res.status(401).json({ error: 'You were signed out. Please sign in again.' });
    return;
  }

  const route = `${req.method} ${req.originalUrl.split('?')[0]}`;
  if (mustChange && !ALLOWED_DURING_PASSWORD_CHANGE.has(route)) {
    res.status(403).json({ error: 'Set a new password to continue', code: 'PASSWORD_CHANGE_REQUIRED' });
    return;
  }

  req.user = user;
  next();
}

export function requireRole(allowedRoles: Array<'admin' | 'pm' | 'member'>) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: `Forbidden: This action requires one of the following roles: ${allowedRoles.join(', ')}`,
      });
      return;
    }

    next();
  };
}

export function canUserAccessProject(user: User, project: Project): boolean {
  if (user.role === 'admin') return true;
  return project.leadId === user.id || project.teamMemberIds.includes(user.id);
}

// Access plus the archive rule: standard members never see archived projects
export function canUserViewProject(user: User, project: Project): boolean {
  if (project.status === 'archived' && user.role === 'member') return false;
  return canUserAccessProject(user, project);
}

// Admins manage everything; a PM manages the projects they lead
export function canManageProject(user: User, project: Project): boolean {
  return user.role === 'admin' || (user.role === 'pm' && project.leadId === user.id);
}

export function requireProjectAccess(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const projectId = req.params.projectId || req.params.id;
  if (!projectId) {
    res.status(400).json({ error: 'Project ID is required' });
    return;
  }

  const project = db.getData().projects.find((p) => p.id === projectId);

  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  if (project.status === 'archived' && req.user.role === 'member') {
    res.status(403).json({ error: 'Access denied: Project is archived and inaccessible to members' });
    return;
  }

  if (!canUserAccessProject(req.user, project)) {
    res.status(403).json({
      error: 'Access denied: You do not have permission to view or interact with this project workspace.',
    });
    return;
  }

  next();
}

export function requireProjectManager(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const project = db.getData().projects.find((p) => p.id === req.params.id);
  if (!project || !req.user || !canManageProject(req.user, project)) {
    res.status(403).json({ error: 'Only the project lead or an administrator can do this' });
    return;
  }
  next();
}
