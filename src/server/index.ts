import './env';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { db, initialsOf, currentTenant, runInTenant, MAIN_TENANT_ID, requireOfficeContext } from './db';
import { BACKUP_KEEP } from './paths';
import {
  tenantMiddleware,
  keepTenant,
  tenantOf,
  getTenant,
  allTenants,
  findOfficeLogins,
  findOwnerLogin,
  registerPlatformRoutes,
} from './platform';
import { listBackups, isBackupName, backupPath } from './backups';
import {
  authMiddleware,
  requireRole,
  requireProjectAccess,
  requireProjectManager,
  canUserAccessProject,
  canUserViewProject,
  canManageProject,
  generateToken,
  AuthenticatedRequest,
} from './auth';
import { addStream, removeStream, emitToUsers, closeStreamsFor } from './events';
import { requestLogger, logServerError, LoggedRequest } from './logging';
import { toCsv, csvFileName } from './csv';
import { cloudStatus, filesMayHaveChanged, startFileWatch } from './cloud';
import { ssoRouter } from './sso';
import { pushPublicKey, sendPush, addSubscription, removeSubscription, isValidSubscription } from './push';
import { BUILT_IN_TEMPLATES, instantiateTemplate, templateFromProject } from './templates';
import {
  Project,
  Task,
  TaskSubtask,
  ProjectMilestone,
  ProjectDeliverable,
  ProjectChatMessage,
  ProjectFile,
  ProjectNote,
  ProjectLink,
  ProjectActivity,
  UserWorkspace,
  WorkspaceTab,
  Client,
  NotificationItem,
  User,
  isSystemTab,
  TaskComment,
  SearchResults,
  NotificationKind,
  NOTIFICATION_KINDS,
  PROJECT_STAGES,
  ProjectTemplate,
  Page,
} from '../types';

export const app = express();
const PORT = process.env.PORT || 3001;
const IS_PROD = process.env.NODE_ENV === 'production';
// HTTPS=true once the app is served over https (e.g. behind Caddy); turns on HSTS and https-only upgrades
const HTTPS = process.env.HTTPS === 'true';

// Behind a reverse proxy, trust its X-Forwarded-* headers so client IPs and protocol are correct
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);

// Security headers. The content security policy only allows the app's own scripts, which
// blocks injected scripts even if some text ever slipped through unescaped.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // React sets inline style attributes (progress bars etc.)
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: HTTPS ? [] : null,
      },
    },
    hsts: HTTPS ? { maxAge: 15552000 } : false,
    crossOriginEmbedderPolicy: false,
  })
);

// The Vite dev server proxies /api, so cross-origin access is only needed when explicitly configured
if (process.env.CORS_ORIGIN) {
  app.use(cors({ origin: process.env.CORS_ORIGIN.split(',') }));
}
app.use(express.json({ limit: '1mb' }));

// Uploads, logos and the office list are files: after any change, copy new files to the cloud database
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') res.on('finish', () => filesMayHaveChanged());
  next();
});

// One log line per request, with a request id that also goes back in the X-Request-Id header
app.use(requestLogger);

// Every request runs inside one office (customer company), chosen from its sign-in token
app.use(tenantMiddleware);

// ==========================================
// HELPERS & VALIDATION
// ==========================================

const TASK_STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done'] as const;
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
const PROJECT_STATUSES = ['active', 'on_hold', 'completed', 'archived'] as const;
const MILESTONE_STATUSES = ['pending', 'in_progress', 'completed', 'overdue'] as const;
const DELIVERABLE_STATUSES = ['pending', 'in_review', 'approved', 'rejected'] as const;
const CLIENT_STATUSES = ['active', 'prospect', 'inactive'] as const;
const FILE_CATEGORIES = ['contracts', 'assets', 'deliverables', 'specs', 'general'] as const;
const NOTE_CATEGORIES = ['meeting', 'architecture', 'spec', 'feedback'] as const;
const LINK_CATEGORIES = ['repository', 'live', 'domain', 'staging', 'design', 'docs', 'other'] as const;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const param = (req: Request, name: string) => String(req.params[name]);
const now = () => new Date().toISOString();
const newId = (prefix: string) => `${prefix}-${uuidv4().substring(0, 8)}`;
const daysFromNow = (days: number) => new Date(Date.now() + days * 86400000).toISOString().split('T')[0];

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (!allowed.includes(value as T)) throw new HttpError(400, `Invalid ${field}: must be one of ${allowed.join(', ')}`);
  return value as T;
}

function text(value: unknown, field: string, max: number, required = false): string | undefined {
  if (value === undefined || value === null) {
    if (required) throw new HttpError(400, `${field} is required`);
    return undefined;
  }
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be text`);
  const trimmed = value.trim();
  if (required && trimmed === '') throw new HttpError(400, `${field} is required`);
  if (trimmed.length > max) throw new HttpError(400, `${field} must be at most ${max} characters`);
  return trimmed;
}

function dateStr(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || isNaN(Date.parse(value))) {
    throw new HttpError(400, `${field} must be a date (YYYY-MM-DD)`);
  }
  return value;
}

function amount(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, `${field} must be a non-negative number`);
  return n;
}

function httpUrl(value: unknown, field: string, required = false): string | undefined {
  const s = text(value, field, 2048, required);
  if (!s) return s;
  let parsed: URL;
  try {
    parsed = new URL(s);
  } catch {
    throw new HttpError(400, `${field} must be a valid URL`);
  }
  // Blocks javascript:, data: and similar schemes that would run when the link is clicked
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new HttpError(400, `${field} must start with http:// or https://`);
  }
  return s;
}

// Wraps a handler so thrown HttpErrors become JSON responses
type Handler = (req: AuthenticatedRequest, res: Response) => void | Promise<void>;
const route =
  (fn: Handler) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res)).catch(next);
  };

function getProject(req: Request): Project {
  const project = db.getData().projects.find((p) => p.id === param(req, 'id'));
  if (!project) throw new HttpError(404, 'Project not found');
  return project;
}

function projectMemberIds(project: Project): Set<string> {
  return new Set([project.leadId, ...project.teamMemberIds]);
}

// Everyone who can see the project: its team plus every admin
function projectAudience(project: Project): string[] {
  const database = db.getData();
  return database.users.filter((u) => canUserViewProject(u, project)).map((u) => u.id);
}

function logActivity(projectId: string, user: User, action: string, type: ProjectActivity['type']) {
  db.getData().activities.unshift({
    id: newId('act'),
    projectId,
    userId: user.id,
    userName: user.name,
    userAvatar: user.avatar,
    action,
    timestamp: now(),
    type,
  });
}

// actor is null for system messages (reminders). Returns how many notifications were created.
function notify(
  userIds: Iterable<string>,
  actor: User | null,
  n: { title: string; message: string; type: NotificationItem['type']; kind: NotificationKind; project?: Project; taskId?: string }
): number {
  const database = db.getData();
  let created = 0;
  for (const userId of new Set(userIds)) {
    if (actor && userId === actor.id) continue;
    const recipient = database.users.find((u) => u.id === userId);
    if (!recipient || recipient.active === false) continue;
    // Respect the person's notification preferences
    if (database.workspaces[userId]?.mutedNotificationKinds?.includes(n.kind)) continue;
    const notification: NotificationItem = {
      id: newId('notif'),
      userId,
      title: n.title,
      message: n.message,
      projectId: n.project?.id,
      projectName: n.project?.name,
      type: n.type,
      kind: n.kind,
      taskId: n.taskId,
      read: false,
      timestamp: now(),
    };
    database.notifications.unshift(notification);
    emitToUsers([userId], { type: 'notification', notification });
    // Also to the person's phone/computer, even when the app is closed
    const url = n.project ? `/#/p/${encodeURIComponent(n.project.id)}${n.taskId ? `/tasks/${encodeURIComponent(n.taskId)}` : ''}` : '/#/';
    void sendPush(userId, { title: n.title, body: n.project ? `${n.project.name}: ${n.message}` : n.message, url, tag: notification.id });
    created++;
  }
  return created;
}

// ?limit=50&before=<timestamp> returns one page of a newest-first list
function pageOf<T extends { timestamp: string }>(newestFirst: T[], req: Request): Page<T> {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const before = typeof req.query.before === 'string' ? req.query.before : null;
  const remaining = before ? newestFirst.filter((i) => i.timestamp < before) : newestFirst;
  return { items: remaining.slice(0, limit), hasMore: remaining.length > limit };
}

const byNewest = <T extends { timestamp: string }>(a: T, b: T) => b.timestamp.localeCompare(a.timestamp);

function recalcCompletion(projectId: string) {
  const database = db.getData();
  const project = database.projects.find((p) => p.id === projectId);
  if (!project) return;
  const projectTasks = database.tasks.filter((t) => t.projectId === projectId);
  project.completionPercentage =
    projectTasks.length === 0
      ? 0
      : Math.round((projectTasks.filter((t) => t.status === 'done').length / projectTasks.length) * 100);
}

function removeProjectFromWorkspaces(projectId: string, userIds?: string[]) {
  const database = db.getData();
  for (const ws of Object.values(database.workspaces)) {
    if (userIds && !userIds.includes(ws.userId)) continue;
    const tabIdx = ws.tabs.findIndex((t) => t.projectId === projectId);
    if (tabIdx === -1) continue;
    ws.tabs.splice(tabIdx, 1);
    ws.tabs.forEach((t, i) => (t.tabOrder = i));
    if (ws.activeTabId === projectId) {
      ws.activeTabId = ws.tabs.length > 0 ? ws.tabs[Math.max(0, tabIdx - 1)].projectId : 'dashboard';
    }
  }
}

function sanitizeSubtasks(value: unknown): TaskSubtask[] {
  if (!Array.isArray(value)) throw new HttpError(400, 'subtasks must be a list');
  return value.slice(0, 100).map((s) => ({
    id: typeof s?.id === 'string' && s.id ? s.id : newId('sub'),
    title: text(s?.title, 'Subtask title', 300, true)!,
    completed: Boolean(s?.completed),
  }));
}

function sanitizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) throw new HttpError(400, 'tags must be a list');
  return [...new Set(value.map((t) => text(t, 'Tag', 40)).filter((t): t is string => !!t))].slice(0, 20);
}

function resolveAssignee(project: Project, assigneeId: unknown): User {
  const database = db.getData();
  const id = String(assigneeId);
  if (!projectMemberIds(project).has(id)) {
    throw new HttpError(400, 'Tasks can only be assigned to members of this project team');
  }
  const assignee = database.users.find((u) => u.id === id);
  if (!assignee) throw new HttpError(400, 'Assignee not found');
  return assignee;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// After every successful write to a project's sub-resources, tell everyone viewing that project
// so open workspaces refresh live. The audience is captured up front because a DELETE may remove the project.
app.use('/api/projects/:id', (req: AuthenticatedRequest, res, next) => {
  if (req.method === 'GET') return next();
  const project = db.getData().projects.find((p) => p.id === req.params.id);
  if (!project) return next();
  const audience = projectAudience(project);
  const resource = req.path.split('/')[1] || 'project';
  res.on('finish', () => {
    if (res.statusCode >= 300 || !req.user) return;
    const projectGone = !db.getData().projects.some((p) => p.id === project.id);
    emitToUsers(
      audience,
      projectGone
        ? { type: 'project-deleted', projectId: project.id, actorId: req.user.id }
        : { type: 'project-updated', projectId: project.id, resource, actorId: req.user.id }
    );
  });
  next();
});

// Lets people (and the dev tooling) confirm which server process is answering
app.get('/api/health', (req, res) => {
  res.json({ ok: true, pid: process.pid, uptimeSeconds: Math.round(process.uptime()), schemaVersion: db.schemaVersion(), cloud: cloudStatus() });
});

// ==========================================
// AUTH & EMPLOYEE ENDPOINTS
// ==========================================

app.post(
  '/api/auth/login',
  route(async (req, res) => {
    const email = text(req.body?.email, 'Email', 200, true)!.trim().toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    // The HandleMyDesk owner signs in on the same screen and gets the owner console
    const owner = await findOwnerLogin(email, password);
    if (owner) {
      res.json({ kind: 'owner', ...owner });
      return;
    }

    // Everyone else: find their office, then continue inside it
    const matches = await findOfficeLogins(email, password);
    if (matches.length === 0) throw new HttpError(401, 'Incorrect email or password');
    // Rare: the same email and password in two offices. Only this person (who knows the password
    // for both) sees the office names, and picks one.
    const match = matches.length === 1 ? matches[0] : matches.find((m) => m.tenant.id === req.body?.officeId);
    if (!match) {
      res.status(409).json({
        error: 'You have accounts in more than one office. Choose which one to open.',
        code: 'CHOOSE_OFFICE',
        offices: matches.map((m) => ({ id: m.tenant.id, name: m.officeName })),
      });
      return;
    }
    const { tenant, user, suspended } = match;
    if (suspended) throw new HttpError(403, 'This office is paused. Please contact HandleMyDesk.');
    if (user.active === false) throw new HttpError(403, 'This account has been deactivated. Ask an administrator.');

    runInTenant(tenant, () => {
      res.json({ user, token: generateToken(user), mustChangePassword: db.getAuthState(user.id).mustChange });
    });
  })
);

app.get('/api/auth/me', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  res.json({ user: req.user, mustChangePassword: db.getAuthState(req.user!.id).mustChange });
});

// Changing your password signs out every other session; this one gets a fresh token
app.post(
  '/api/auth/password',
  authMiddleware,
  route(async (req, res) => {
    const user = req.user!;
    const { currentPassword, newPassword } = req.body ?? {};
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      throw new HttpError(400, 'New password must be at least 8 characters');
    }
    const hash = db.getPasswordHash(user.id);
    if (!hash || typeof currentPassword !== 'string' || !(await bcrypt.compare(currentPassword, hash))) {
      throw new HttpError(400, 'Current password is incorrect');
    }
    if (currentPassword === newPassword) throw new HttpError(400, 'Choose a password different from the current one');
    db.setPasswordHash(user.id, await bcrypt.hash(newPassword, 10));
    db.bumpSessionVersion(user.id);
    closeStreamsFor(user.id);
    res.json({ success: true, token: generateToken(user) });
  })
);

app.post('/api/auth/logout-all', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  db.bumpSessionVersion(req.user!.id);
  closeStreamsFor(req.user!.id);
  res.json({ success: true });
});

app.get('/api/employees', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  res.json(db.getData().users);
});

// Company single sign-on (OpenID Connect); inactive unless configured in .env
app.use(ssoRouter);

// ==========================================
// PEOPLE ADMINISTRATION (admins only)
// ==========================================

const ROLES = ['admin', 'pm', 'member'] as const;
const USER_STATUSES = ['active', 'away', 'busy'] as const;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Easy to read aloud or type: no 0/O or 1/l
function temporaryPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const chars = Array.from(crypto.randomBytes(12), (b) => alphabet[b % alphabet.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8).join('')}`;
}

function findEmployee(req: Request): User {
  const user = db.getData().users.find((u) => u.id === param(req, 'id'));
  if (!user) throw new HttpError(404, 'Person not found');
  return user;
}

// Renames someone and keeps their name current on projects and tasks
function renameUser(user: User, name: string) {
  const database = db.getData();
  user.name = name;
  user.initials = initialsOf(name);
  for (const p of database.projects) if (p.leadId === user.id) p.leadName = name;
  for (const t of database.tasks) if (t.assigneeId === user.id) t.assigneeName = name;
}

const activeAdmins = () => db.getData().users.filter((u) => u.role === 'admin' && u.active !== false);

function revokeSessions(userId: string) {
  db.bumpSessionVersion(userId);
  closeStreamsFor(userId);
}

app.post(
  '/api/employees',
  authMiddleware,
  requireRole(['admin']),
  route(async (req, res) => {
    const database = db.getData();
    const body = req.body ?? {};
    const name = text(body.name, 'Name', 100, true)!;
    const email = text(body.email, 'Email', 200, true)!.toLowerCase();
    if (!EMAIL_PATTERN.test(email)) throw new HttpError(400, 'Enter a valid email');
    if (database.users.some((u) => u.email.toLowerCase() === email)) throw new HttpError(400, 'Someone already uses that email');
    // The admin may choose the password; otherwise a temporary one is made
    const chosen = typeof body.password === 'string' ? body.password : '';
    if (chosen && chosen.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
    if (chosen.length > 200) throw new HttpError(400, 'Password is too long');

    const user: User = {
      id: newId('emp'),
      name,
      email,
      avatar: '',
      role: oneOf(body.role, ROLES, 'role') ?? 'member',
      title: text(body.title, 'Job title', 100) || 'Team member',
      department: text(body.department, 'Department', 100) || 'General',
      status: 'active',
      phone: text(body.phone, 'Phone', 50) ?? '',
      initials: initialsOf(name),
      active: true,
    };
    const password = chosen || temporaryPassword();
    // A chosen password may be kept if the admin says so; a generated one is always replaced
    const mustChange = !chosen || body.mustChangePassword !== false;
    database.users.push(user);
    db.save();
    db.setPasswordHash(user.id, await bcrypt.hash(password, 10), { mustChange });

    // The temporary password is shown once to the admin and never stored in plain text
    res.status(201).json({ user, temporaryPassword: password, mustChangePassword: mustChange });
  })
);

app.put(
  '/api/employees/:id',
  authMiddleware,
  requireRole(['admin']),
  route((req, res) => {
    const database = db.getData();
    const user = findEmployee(req);
    const body = req.body ?? {};

    const name = text(body.name, 'Name', 100);
    if (name !== undefined && !name) throw new HttpError(400, 'Name is required');
    const email = text(body.email, 'Email', 200)?.toLowerCase();
    if (email !== undefined) {
      if (!EMAIL_PATTERN.test(email)) throw new HttpError(400, 'Enter a valid email');
      if (database.users.some((u) => u.id !== user.id && u.email.toLowerCase() === email)) {
        throw new HttpError(400, 'Someone already uses that email');
      }
    }
    const role = oneOf(body.role, ROLES, 'role');
    if (role && role !== 'admin' && user.role === 'admin' && user.active !== false && activeAdmins().length === 1) {
      throw new HttpError(400, 'Keep at least one administrator. Make someone else an admin first.');
    }

    if (name) renameUser(user, name);
    if (email) user.email = email;
    if (role) user.role = role;
    const title = text(body.title, 'Job title', 100);
    if (title) user.title = title;
    const department = text(body.department, 'Department', 100);
    if (department) user.department = department;
    const phone = text(body.phone, 'Phone', 50);
    if (phone !== undefined) user.phone = phone;
    const status = oneOf(body.status, USER_STATUSES, 'status');
    if (status) user.status = status;

    db.save();
    res.json(user);
  })
);

app.post(
  '/api/employees/:id/deactivate',
  authMiddleware,
  requireRole(['admin']),
  route((req, res) => {
    const user = findEmployee(req);
    if (user.id === req.user!.id) throw new HttpError(400, 'You cannot deactivate your own account');
    if (user.role === 'admin' && activeAdmins().length === 1) throw new HttpError(400, 'Keep at least one active administrator');
    user.active = false;
    db.save();
    revokeSessions(user.id);
    res.json(user);
  })
);

app.post(
  '/api/employees/:id/reactivate',
  authMiddleware,
  requireRole(['admin']),
  route((req, res) => {
    const user = findEmployee(req);
    user.active = true;
    db.save();
    res.json(user);
  })
);

app.post(
  '/api/employees/:id/reset-password',
  authMiddleware,
  requireRole(['admin']),
  route(async (req, res) => {
    const user = findEmployee(req);
    const password = temporaryPassword();
    db.setPasswordHash(user.id, await bcrypt.hash(password, 10), { mustChange: true });
    revokeSessions(user.id);
    res.json({ temporaryPassword: password });
  })
);

// ==========================================
// BACKUPS (admins only)
// ==========================================

app.get('/api/admin/backups', authMiddleware, requireRole(['admin']), (req, res) => {
  res.json({ backups: listBackups(currentTenant().backupDir), directory: currentTenant().backupDir, keep: BACKUP_KEEP });
});

app.post(
  '/api/admin/backups',
  authMiddleware,
  requireRole(['admin']),
  route((req, res) => {
    res.status(201).json(db.backup('manual'));
  })
);

app.get(
  '/api/admin/backups/:name/download',
  authMiddleware,
  requireRole(['admin']),
  route((req, res) => {
    const name = param(req, 'name');
    if (!isBackupName(name)) throw new HttpError(400, 'Invalid backup name');
    const file = backupPath(name, currentTenant().backupDir);
    if (!fs.existsSync(file)) throw new HttpError(404, 'Backup not found');
    res.download(file, name);
  })
);

// Live update stream (server-sent events). The client reads it with fetch so it can send its token.
app.get('/api/events', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write(': connected\n\n');
  addStream(userId, res);
  req.on('close', () => removeStream(userId, res));
});

// ==========================================
// USER WORKSPACE & DESKTOP PROJECT TABS
// ==========================================

// Phone subscriptions stay on the server
function publicWorkspace(ws: UserWorkspace): Omit<UserWorkspace, 'pushSubscriptions'> {
  const { pushSubscriptions: _, ...rest } = ws;
  return rest;
}

function ensureWorkspace(userId: string): UserWorkspace {
  const database = db.getData();
  if (!database.workspaces[userId]) {
    database.workspaces[userId] = {
      id: `ws-${userId}`,
      userId,
      tabs: [],
      activeTabId: 'dashboard',
      updatedAt: now(),
    };
  }
  return database.workspaces[userId];
}

// Get current user workspace (with graceful filtering of deleted/inaccessible projects)
app.get('/api/workspace', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const database = db.getData();
  const workspace = ensureWorkspace(user.id);

  // Sanitize tabs: filter out projects that no longer exist or user has no permission to view
  const validTabs: WorkspaceTab[] = [];
  const projectDetailsMap: Record<string, Partial<Project>> = {};

  for (const tab of workspace.tabs) {
    const project = database.projects.find((p) => p.id === tab.projectId);
    if (project && canUserViewProject(user, project)) {
      validTabs.push(tab);
      projectDetailsMap[project.id] = {
        id: project.id,
        code: project.code,
        name: project.name,
        clientName: project.clientName,
        status: project.status,
        priority: project.priority,
      };
    }
  }

  // Ensure activeTabId is valid
  let activeTabId = workspace.activeTabId;
  if (!isSystemTab(activeTabId) && !validTabs.some((t) => t.projectId === activeTabId)) {
    activeTabId = validTabs.length > 0 ? validTabs[validTabs.length - 1].projectId : 'dashboard';
  }

  const favorites = (workspace.favoriteProjectIds ?? []).filter((id) => {
    const project = database.projects.find((p) => p.id === id);
    return !!project && canUserViewProject(user, project);
  });
  workspace.favoriteProjectIds = favorites;

  if (validTabs.length !== workspace.tabs.length || activeTabId !== workspace.activeTabId) {
    workspace.tabs = validTabs;
    workspace.activeTabId = activeTabId;
    workspace.updatedAt = now();
  }
  db.save();

  res.json({ workspace: publicWorkspace(workspace), projectsMap: projectDetailsMap });
});

// Update current user workspace tabs and active tab
app.put('/api/workspace', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { tabs, activeTabId } = req.body;
  const database = db.getData();

  if (!Array.isArray(tabs)) {
    res.status(400).json({ error: 'Invalid tabs payload' });
    return;
  }

  // Keep only viewable projects, deduplicated, in the order given
  const seenProjectIds = new Set<string>();
  const sanitizedTabs: WorkspaceTab[] = [];

  for (const tab of tabs) {
    if (!tab?.projectId || seenProjectIds.has(tab.projectId)) continue;
    const project = database.projects.find((p) => p.id === tab.projectId);
    if (!project || !canUserViewProject(user, project)) continue;

    seenProjectIds.add(tab.projectId);
    sanitizedTabs.push({
      projectId: tab.projectId,
      tabOrder: sanitizedTabs.length,
      openedAt: tab.openedAt || now(),
    });
  }

  let finalActiveTabId = typeof activeTabId === 'string' && activeTabId ? activeTabId : 'dashboard';
  if (!isSystemTab(finalActiveTabId) && !seenProjectIds.has(finalActiveTabId)) {
    finalActiveTabId = sanitizedTabs.length > 0 ? sanitizedTabs[sanitizedTabs.length - 1].projectId : 'dashboard';
  }

  const updatedWorkspace: UserWorkspace = {
    // Keep everything else stored here (notification choices, phones)
    ...database.workspaces[user.id],
    id: `ws-${user.id}`,
    userId: user.id,
    tabs: sanitizedTabs,
    activeTabId: finalActiveTabId,
    favoriteProjectIds: database.workspaces[user.id]?.favoriteProjectIds ?? [],
    updatedAt: now(),
  };

  database.workspaces[user.id] = updatedWorkspace;
  db.save();

  res.json(publicWorkspace(updatedWorkspace));
});

// Star or unstar a project in the sidebar
app.post('/api/workspace/favorites', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { projectId, favorite } = req.body ?? {};
  const project = db.getData().projects.find((p) => p.id === projectId);
  if (!project || !canUserViewProject(user, project)) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  const workspace = ensureWorkspace(user.id);
  const current = (workspace.favoriteProjectIds ?? []).filter((id) => id !== projectId);
  workspace.favoriteProjectIds = favorite ? [...current, projectId] : current;
  workspace.updatedAt = now();
  db.save();
  res.json(publicWorkspace(workspace));
});

const MAX_RECENT_TABS = 12;

// Open a project (records it as recent) and make it active
app.post('/api/workspace/open-tab', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { projectId } = req.body;
  const project = db.getData().projects.find((p) => p.id === projectId);

  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  if (!canUserViewProject(user, project)) {
    res.status(403).json({ error: 'Access denied: You do not have permission to open this project' });
    return;
  }

  // tabs doubles as the user's recently opened projects, most recent last
  const workspace = ensureWorkspace(user.id);
  const existing = workspace.tabs.find((t) => t.projectId === projectId);
  workspace.tabs = workspace.tabs.filter((t) => t.projectId !== projectId);
  workspace.tabs.push(existing ?? { projectId, tabOrder: 0, openedAt: now() });
  if (workspace.tabs.length > MAX_RECENT_TABS) workspace.tabs = workspace.tabs.slice(-MAX_RECENT_TABS);
  workspace.tabs.forEach((t, i) => (t.tabOrder = i));

  workspace.activeTabId = projectId;
  workspace.updatedAt = now();
  db.save();

  res.json(publicWorkspace(workspace));
});

// Close a tab. Only affects this user's workspace; NEVER deletes or archives the project.
app.post('/api/workspace/close-tab', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { projectId } = req.body;
  const workspace = db.getData().workspaces[user.id];

  if (!workspace) {
    res.status(404).json({ error: 'Workspace not found' });
    return;
  }

  removeProjectFromWorkspaces(projectId, [user.id]);
  workspace.updatedAt = now();
  db.save();

  res.json(publicWorkspace(workspace));
});

// ==========================================
// PROJECTS DIRECTORY & CRUD
// ==========================================

app.get('/api/projects', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { search, status, filter } = req.query;

  let projects = db.getData().projects.filter((p) => canUserViewProject(user, p));

  if (status && status !== 'all') {
    projects = projects.filter((p) => p.status === status);
  }

  if (filter === 'my_projects') {
    projects = projects.filter((p) => projectMemberIds(p).has(user.id));
  } else if (filter === 'managed_by_me') {
    projects = projects.filter((p) => p.leadId === user.id);
  }

  if (typeof search === 'string' && search.trim() !== '') {
    const query = search.toLowerCase();
    projects = projects.filter(
      (p) =>
        p.name.toLowerCase().includes(query) ||
        p.code.toLowerCase().includes(query) ||
        p.clientName.toLowerCase().includes(query) ||
        p.category.toLowerCase().includes(query)
    );
  }

  res.json(projects);
});

app.post(
  '/api/projects',
  authMiddleware,
  requireRole(['admin', 'pm']),
  route((req, res) => {
    const user = req.user!;
    const database = db.getData();
    const body = req.body ?? {};

    const name = text(body.name, 'Project name', 200, true)!;
    // The client is either picked from the list (clientId) or typed by name (clientName). A typed
    // name that matches an existing client uses it; otherwise a new client is created.
    let client: Client | undefined;
    const clientName = text(body.clientName, 'Client name', 200);
    if (body.clientId) {
      client = database.clients.find((c) => c.id === String(body.clientId));
      if (!client) throw new HttpError(400, 'Selected client does not exist');
    } else if (clientName) {
      client = database.clients.find((c) => c.name.trim().toLowerCase() === clientName.toLowerCase());
    } else {
      throw new HttpError(400, 'Client is required');
    }

    const code = text(body.code, 'Project code', 20)?.toUpperCase() || `PRJ-${Math.floor(100 + Math.random() * 900)}`;
    const template = body.templateId ? findTemplate(String(body.templateId)) : null;
    if (body.templateId && !template) throw new HttpError(400, 'That template no longer exists');
    if (database.projects.some((p) => p.code === code)) throw new HttpError(400, `Project code ${code} is already in use`);

    // Team: only real employees, always including the creator (who becomes lead)
    const team = new Set<string>(
      Array.isArray(body.teamMemberIds)
        ? body.teamMemberIds.filter((id: unknown) => database.users.some((u) => u.id === id))
        : []
    );
    team.add(user.id);

    if (!client) {
      client = {
        id: newId('cli'),
        name: clientName!,
        company: clientName!,
        industry: '',
        contactPerson: '',
        email: '',
        phone: '',
        status: 'active',
        totalBilled: 0,
        activeProjectsCount: 0,
        notes: '',
        website: '',
      };
      database.clients.unshift(client);
    }

    const newProject: Project = {
      id: newId('prj'),
      code,
      name,
      clientId: client.id,
      clientName: client.name,
      description: text(body.description, 'Description', 5000) ?? '',
      status: 'active',
      priority: oneOf(body.priority, PRIORITIES, 'priority') ?? 'medium',
      leadId: user.id,
      leadName: user.name,
      leadAvatar: user.avatar,
      budget: amount(body.budget, 'Budget') ?? 25000,
      spent: 0,
      startDate: dateStr(body.startDate, 'Start date') ?? daysFromNow(0),
      targetDate: dateStr(body.targetDate, 'Target date') ?? daysFromNow(90),
      completionPercentage: 0,
      stage: 'planning',
      category: text(body.category, 'Category', 100) || template?.category || 'General Project',
      teamMemberIds: [...team],
      createdAt: now(),
      updatedAt: now(),
    };

    database.projects.unshift(newProject);
    logActivity(newProject.id, user, `created new project "${newProject.name}"${template ? ` from the "${template.name}" template` : ''}`, 'general');
    if (template) {
      const { tasks, milestones } = instantiateTemplate(template, newProject, user, newId);
      database.tasks.unshift(...tasks);
      database.milestones.push(...milestones);
    }
    notify(newProject.teamMemberIds, user, {
      kind: 'team',
      title: 'Added to New Project',
      message: `${user.name} added you to the new project "${newProject.name}".`,
      type: 'info',
      project: newProject,
    });

    db.save();
    res.status(201).json(newProject);
  })
);

// ==========================================
// PROJECT TEMPLATES
// ==========================================

function findTemplate(id: string): ProjectTemplate | undefined {
  return BUILT_IN_TEMPLATES.find((t) => t.id === id) ?? db.getData().templates.find((t) => t.id === id);
}

function findEditableTemplate(req: AuthenticatedRequest): ProjectTemplate {
  const template = db.getData().templates.find((t) => t.id === param(req, 'templateId'));
  if (!template) {
    if (BUILT_IN_TEMPLATES.some((t) => t.id === param(req, 'templateId'))) throw new HttpError(400, 'Built-in templates cannot be changed');
    throw new HttpError(404, 'Template not found');
  }
  if (template.createdById !== req.user!.id && req.user!.role !== 'admin') {
    throw new HttpError(403, 'Only the person who made this template or an administrator can change it');
  }
  return template;
}

app.get('/api/templates', authMiddleware, (req, res) => {
  res.json([...BUILT_IN_TEMPLATES, ...db.getData().templates]);
});

app.post(
  '/api/projects/:id/save-as-template',
  authMiddleware,
  requireProjectAccess,
  requireProjectManager,
  route((req, res) => {
    const user = req.user!;
    const database = db.getData();
    const project = getProject(req);
    const name = text(req.body?.name, 'Template name', 100, true)!;
    const shape = templateFromProject(
      project,
      database.tasks.filter((t) => t.projectId === project.id),
      database.milestones.filter((m) => m.projectId === project.id)
    );
    const template: ProjectTemplate = {
      id: newId('tpl'),
      name,
      description: text(req.body?.description, 'Description', 500) ?? '',
      ...shape,
      createdById: user.id,
      createdByName: user.name,
      createdAt: now(),
    };
    database.templates.push(template);
    db.save();
    res.status(201).json(template);
  })
);

app.put(
  '/api/templates/:templateId',
  authMiddleware,
  route((req, res) => {
    const template = findEditableTemplate(req);
    const name = text(req.body?.name, 'Template name', 100);
    if (name !== undefined && !name) throw new HttpError(400, 'Template name is required');
    if (name) template.name = name;
    const description = text(req.body?.description, 'Description', 500);
    if (description !== undefined) template.description = description;
    db.save();
    res.json(template);
  })
);

app.delete(
  '/api/templates/:templateId',
  authMiddleware,
  route((req, res) => {
    const template = findEditableTemplate(req);
    const database = db.getData();
    database.templates = database.templates.filter((t) => t.id !== template.id);
    db.save();
    res.json({ message: 'Template deleted' });
  })
);

// ==========================================
// EXPORTS (CSV)
// ==========================================

function sendCsv(res: Response, name: string, headers: string[], rows: Array<Array<string | number | undefined>>) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${csvFileName(name)}"`);
  res.send(toCsv(headers, rows));
}

const TASK_CSV_HEADERS = ['Project', 'Code', 'Task', 'Status', 'Priority', 'Assignee', 'Due date', 'Tags', 'Checklist done', 'Checklist total', 'Created', 'Updated'];
const taskRow = (t: Task) => [
  t.projectName,
  t.projectCode,
  t.title,
  t.status.replace('_', ' '),
  t.priority,
  t.assigneeName,
  t.dueDate,
  t.tags.join(', '),
  t.subtasks.filter((s) => s.completed).length,
  t.subtasks.length,
  t.createdAt.slice(0, 10),
  t.updatedAt.slice(0, 10),
];

// Every project the person can see
app.get('/api/projects/export.csv', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const database = db.getData();
  const projects = database.projects.filter((p) => canUserViewProject(req.user!, p));
  sendCsv(
    res,
    'projects',
    ['Code', 'Project', 'Client', 'Status', 'Stage', 'Priority', 'Lead', 'Category', 'Start', 'Target', 'Complete %', 'Open tasks', 'Budget', 'Spent', 'Team size'],
    projects.map((p) => [
      p.code,
      p.name,
      p.clientName,
      p.status.replace('_', ' '),
      (p.stage ?? '').replace('_', ' '),
      p.priority,
      p.leadName,
      p.category,
      p.startDate,
      p.targetDate,
      p.completionPercentage,
      database.tasks.filter((t) => t.projectId === p.id && t.status !== 'done').length,
      p.budget,
      p.spent,
      projectMemberIds(p).size,
    ])
  );
});

// Tasks across projects (?filter=assigned_to_me for just yours)
app.get('/api/tasks/export.csv', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const visible = visibleProjectIds(req.user!);
  let tasks = db.getData().tasks.filter((t) => visible.has(t.projectId));
  if (req.query.filter === 'assigned_to_me') tasks = tasks.filter((t) => t.assigneeId === req.user!.id);
  sendCsv(res, req.query.filter === 'assigned_to_me' ? 'my-tasks' : 'tasks', TASK_CSV_HEADERS, tasks.map(taskRow));
});

// Administrators: the whole office's activity (who did what, when), optionally between two dates.
// ?from=YYYY-MM-DD&to=YYYY-MM-DD&tz=Asia/Kolkata (dates and times are shown in that time zone)
app.get('/api/admin/export/activity.csv', authMiddleware, requireRole(['admin']), (req, res) => {
  const dateOk = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
  const from = dateOk(req.query.from);
  const to = dateOk(req.query.to);
  let timeZone = 'UTC';
  if (typeof req.query.tz === 'string' && req.query.tz.length < 64) {
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone: req.query.tz });
      timeZone = req.query.tz;
    } catch {
      // Unknown time zone: keep UTC
    }
  }
  const dayOf = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const timeOf = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false });

  const database = db.getData();
  const projects = new Map(database.projects.map((p) => [p.id, p]));
  const emails = new Map(database.users.map((u) => [u.id, u.email]));
  const rows = database.activities
    .map((a) => ({ a, at: new Date(a.timestamp) }))
    .filter(({ at }) => !Number.isNaN(at.getTime()))
    .map(({ a, at }) => ({ a, day: dayOf.format(at), time: timeOf.format(at) }))
    .filter(({ day }) => (!from || day >= from) && (!to || day <= to))
    .sort((x, y) => y.a.timestamp.localeCompare(x.a.timestamp));

  const name = `activity${from ? `-from-${from}` : ''}${to ? `-to-${to}` : ''}`;
  sendCsv(
    res,
    name,
    ['Date', `Time (${timeZone})`, 'Person', 'Email', 'Project code', 'Project', 'Type', 'What happened'],
    rows.map(({ a, day, time }) => {
      const p = projects.get(a.projectId);
      return [day, time, a.userName, emails.get(a.userId), p?.code ?? '', p?.name ?? '(deleted project)', a.type, a.action];
    })
  );
});

// Administrators: everyone in the office, with their workload
app.get('/api/admin/export/people.csv', authMiddleware, requireRole(['admin']), (req, res) => {
  const database = db.getData();
  const ROLE: Record<string, string> = { admin: 'Administrator', pm: 'Project manager', member: 'Member' };
  sendCsv(
    res,
    'people',
    ['Name', 'Email', 'Role', 'Job title', 'Department', 'Phone', 'Account', 'Projects', 'Open tasks', 'Overdue tasks', 'Done tasks'],
    database.users
      .filter((u) => u.id !== 'hmd-support')
      .map((u) => {
        const tasks = database.tasks.filter((t) => t.assigneeId === u.id);
        const open = tasks.filter((t) => t.status !== 'done');
        const today = now().slice(0, 10);
        return [
          u.name,
          u.email,
          ROLE[u.role] ?? u.role,
          u.title,
          u.department,
          u.phone,
          u.active === false ? 'Deactivated' : 'Active',
          database.projects.filter((p) => projectMemberIds(p).has(u.id)).length,
          open.length,
          open.filter((t) => t.dueDate && t.dueDate < today).length,
          tasks.length - open.length,
        ];
      })
  );
});

app.get('/api/projects/:id/export/tasks.csv', authMiddleware, requireProjectAccess, (req, res) => {
  const project = getProject(req);
  sendCsv(res, `${project.code}-tasks`, TASK_CSV_HEADERS, db.getData().tasks.filter((t) => t.projectId === project.id).map(taskRow));
});

app.get('/api/projects/:id', authMiddleware, requireProjectAccess, (req: AuthenticatedRequest, res: Response) => {
  res.json(getProject(req));
});

app.put(
  '/api/projects/:id',
  authMiddleware,
  requireProjectAccess,
  requireProjectManager,
  route((req, res) => {
    const user = req.user!;
    const database = db.getData();
    const project = getProject(req);
    const body = req.body ?? {};

    const name = text(body.name, 'Project name', 200);
    const code = text(body.code, 'Project code', 20)?.toUpperCase();
    const status = oneOf(body.status, PROJECT_STATUSES, 'status');
    const stage = oneOf(body.stage, PROJECT_STAGES, 'stage');

    if (name !== undefined && name === '') throw new HttpError(400, 'Project name is required');
    if (code && database.projects.some((p) => p.code === code && p.id !== project.id)) {
      throw new HttpError(400, `Project code ${code} is already in use`);
    }

    if (name) project.name = name;
    if (code) project.code = code;
    const description = text(body.description, 'Description', 5000);
    if (description !== undefined) project.description = description;
    const priority = oneOf(body.priority, PRIORITIES, 'priority');
    if (priority) project.priority = priority;
    const budget = amount(body.budget, 'Budget');
    if (budget !== undefined) project.budget = budget;
    const spent = amount(body.spent, 'Spent');
    if (spent !== undefined) project.spent = spent;
    const startDate = dateStr(body.startDate, 'Start date');
    if (startDate) project.startDate = startDate;
    const targetDate = dateStr(body.targetDate, 'Target date');
    if (targetDate) project.targetDate = targetDate;
    const category = text(body.category, 'Category', 100);
    if (category) project.category = category;
    if (Array.isArray(body.teamMemberIds)) {
      const team = new Set<string>(body.teamMemberIds.filter((id: unknown) => database.users.some((u) => u.id === id)));
      team.add(project.leadId);
      project.teamMemberIds = [...team];
    }

    if (status && status !== project.status) {
      const oldStatus = project.status;
      project.status = status;
      logActivity(project.id, user, `changed project status from ${oldStatus} to ${status}`, 'status');
      notify(projectMemberIds(project), user, {
        kind: 'status',
        title: 'Project Status Changed',
        message: `${user.name} changed "${project.name}" from ${oldStatus.replace('_', ' ')} to ${status.replace('_', ' ')}.`,
        type: status === 'archived' || status === 'on_hold' ? 'warning' : 'info',
        project,
      });
    }

    // Projects from before stages existed have none; infer it the same way the app does
    const currentStage = project.stage ?? (project.status === 'completed' ? 'delivered' : 'in_progress');
    if (stage && stage !== currentStage) {
      project.stage = stage;
      const stageLabel = stage.replace('_', ' ');
      logActivity(project.id, user, `moved the project to the ${stageLabel} stage`, 'status');
      notify(projectMemberIds(project), user, {
        title: 'Project stage changed',
        message: `"${project.name}" moved to ${stageLabel}.`,
        type: stage === 'delivered' ? 'success' : 'info',
        kind: 'status',
        project,
      });
    }

    // Keep denormalized names on tasks in sync
    for (const t of database.tasks) {
      if (t.projectId === project.id) {
        t.projectName = project.name;
        t.projectCode = project.code;
      }
    }

    project.updatedAt = now();
    logActivity(project.id, user, 'updated project details and settings', 'general');

    db.save();
    res.json(project);
  })
);

// Permanently delete a project and everything that belongs to it
app.delete(
  '/api/projects/:id',
  authMiddleware,
  requireRole(['admin', 'pm']),
  route((req, res) => {
    const user = req.user!;
    const database = db.getData();
    const project = getProject(req);

    if (!canManageProject(user, project)) {
      throw new HttpError(403, 'You can only delete projects you lead');
    }

    const keep = <T extends { projectId?: string }>(items: T[]) => items.filter((i) => i.projectId !== project.id);
    database.projects = database.projects.filter((p) => p.id !== project.id);
    database.tasks = keep(database.tasks);
    database.milestones = keep(database.milestones);
    database.deliverables = keep(database.deliverables);
    database.chatMessages = keep(database.chatMessages);
    database.files = keep(database.files);
    database.notes = keep(database.notes);
    database.links = keep(database.links);
    database.activities = keep(database.activities);
    database.notifications = keep(database.notifications);
    database.comments = keep(database.comments);
    removeProjectFromWorkspaces(project.id);

    fs.rmSync(path.join(currentTenant().uploadsDir, project.id), { recursive: true, force: true });

    db.save();
    res.json({ message: 'Project successfully deleted' });
  })
);

// ==========================================
// PROJECT WORKSPACE SUB-RESOURCES
// ==========================================

// 1. Tasks
app.get('/api/projects/:id/tasks', authMiddleware, requireProjectAccess, (req, res) => {
  res.json(db.getData().tasks.filter((t) => t.projectId === param(req, 'id')));
});

app.post(
  '/api/projects/:id/tasks',
  authMiddleware,
  requireProjectAccess,
  route((req, res) => {
    const user = req.user!;
    const database = db.getData();
    const project = getProject(req);
    const body = req.body ?? {};

    const assignee = resolveAssignee(project, body.assigneeId || user.id);

    const newTask: Task = {
      id: newId('tsk'),
      projectId: project.id,
      projectCode: project.code,
      projectName: project.name,
      title: text(body.title, 'Task title', 300, true)!,
      description: text(body.description, 'Description', 5000) ?? '',
      status: oneOf(body.status, TASK_STATUSES, 'status') ?? 'todo',
      priority: oneOf(body.priority, PRIORITIES, 'priority') ?? 'medium',
      assigneeId: assignee.id,
      assigneeName: assignee.name,
      assigneeAvatar: assignee.avatar,
      dueDate: dateStr(body.dueDate, 'Due date') ?? daysFromNow(7),
      tags: body.tags !== undefined ? sanitizeTags(body.tags) : [],
      subtasks: body.subtasks !== undefined ? sanitizeSubtasks(body.subtasks) : [],
      createdAt: now(),
      updatedAt: now(),
    };

    database.tasks.unshift(newTask);
    logActivity(project.id, user, `created task "${newTask.title}"`, 'task');
    notify([assignee.id], user, {
      kind: 'assignments',
      taskId: newTask.id,
      title: 'New Task Assigned',
      message: `${user.name} assigned you "${newTask.title}".`,
      type: newTask.priority === 'urgent' ? 'alert' : 'info',
      project,
    });
    recalcCompletion(project.id);

    db.save();
    res.status(201).json(newTask);
  })
);

app.put(
  '/api/projects/:id/tasks/:taskId',
  authMiddleware,
  requireProjectAccess,
  route((req, res) => {
    const user = req.user!;
    const database = db.getData();
    const project = getProject(req);
    const task = database.tasks.find((t) => t.id === param(req, 'taskId') && t.projectId === project.id);
    if (!task) throw new HttpError(404, 'Task not found');
    const body = req.body ?? {};

    const title = text(body.title, 'Task title', 300);
    if (title !== undefined && title === '') throw new HttpError(400, 'Task title is required');
    if (title) task.title = title;
    const description = text(body.description, 'Description', 5000);
    if (description !== undefined) task.description = description;

    const status = oneOf(body.status, TASK_STATUSES, 'status');
    if (status && status !== task.status) {
      const oldStatus = task.status;
      task.status = status;
      logActivity(project.id, user, `moved task "${task.title}" from ${oldStatus} to ${status}`, 'task');
      if (status === 'done') {
        notify([project.leadId], user, {
          kind: 'task_completed',
          taskId: task.id,
          title: 'Task Completed',
          message: `${user.name} completed "${task.title}".`,
          type: 'success',
          project,
        });
      }
    }

    const priority = oneOf(body.priority, PRIORITIES, 'priority');
    if (priority) task.priority = priority;

    if (body.assigneeId && body.assigneeId !== task.assigneeId) {
      const assignee = resolveAssignee(project, body.assigneeId);
      task.assigneeId = assignee.id;
      task.assigneeName = assignee.name;
      task.assigneeAvatar = assignee.avatar;
      logActivity(project.id, user, `assigned task "${task.title}" to ${assignee.name}`, 'task');
      notify([assignee.id], user, {
        kind: 'assignments',
        taskId: task.id,
        title: 'Task Assigned to You',
        message: `${user.name} assigned you "${task.title}".`,
        type: 'info',
        project,
      });
    }

    const dueDate = dateStr(body.dueDate, 'Due date');
    if (dueDate) task.dueDate = dueDate;
    if (body.tags !== undefined) task.tags = sanitizeTags(body.tags);
    if (body.subtasks !== undefined) task.subtasks = sanitizeSubtasks(body.subtasks);

    task.updatedAt = now();
    recalcCompletion(project.id);

    db.save();
    res.json(task);
  })
);

app.delete(
  '/api/projects/:id/tasks/:taskId',
  authMiddleware,
  requireProjectAccess,
  route((req, res) => {
    const user = req.user!;
    const database = db.getData();
    const project = getProject(req);
    const task = database.tasks.find((t) => t.id === param(req, 'taskId') && t.projectId === project.id);
    if (!task) throw new HttpError(404, 'Task not found');

    database.tasks = database.tasks.filter((t) => t.id !== task.id);
    database.comments = database.comments.filter((c) => c.taskId !== task.id);
    logActivity(project.id, user, `deleted task "${task.title}"`, 'task');
    recalcCompletion(project.id);

    db.save();
    res.json({ message: 'Task deleted' });
  })
);

// 2. Milestones
app.get('/api/projects/:id/milestones', authMiddleware, requireProjectAccess, (req, res) => {
  res.json(db.getData().milestones.filter((m) => m.projectId === param(req, 'id')));
});

function resolveOwner(project: Project, ownerId: unknown): User {
  const owner = db.getData().users.find((u) => u.id === ownerId);
  if (!owner || !projectMemberIds(project).has(owner.id)) {
    throw new HttpError(400, 'Owner must be a member of this project team');
  }
  return owner;
}

app.post(
  '/api/projects/:id/milestones',
  authMiddleware,
  requireProjectAccess,
  requireProjectManager,
  route((req, res) => {
    const user = req.user!;
    const project = getProject(req);
    const body = req.body ?? {};
    const owner = resolveOwner(project, body.ownerId || user.id);

    const progress = amount(body.progress, 'Progress') ?? 0;
    const newMilestone: ProjectMilestone = {
      id: newId('mls'),
      projectId: project.id,
      title: text(body.title, 'Milestone title', 200, true)!,
      description: text(body.description, 'Description', 2000) ?? '',
      targetDate: dateStr(body.targetDate, 'Target date') ?? daysFromNow(30),
      status: oneOf(body.status, MILESTONE_STATUSES, 'status') ?? 'pending',
      progress: Math.min(100, progress),
      ownerId: owner.id,
      ownerName: owner.name,
    };

    db.getData().milestones.push(newMilestone);
    logActivity(project.id, user, `added milestone "${newMilestone.title}"`, 'milestone');
    db.save();
    res.status(201).json(newMilestone);
  })
);

app.put(
  '/api/projects/:id/milestones/:milestoneId',
  authMiddleware,
  requireProjectAccess,
  requireProjectManager,
  route((req, res) => {
    const user = req.user!;
    const project = getProject(req);
    const milestone = db
      .getData()
      .milestones.find((m) => m.id === param(req, 'milestoneId') && m.projectId === project.id);
    if (!milestone) throw new HttpError(404, 'Milestone not found');
    const body = req.body ?? {};

    const title = text(body.title, 'Milestone title', 200);
    if (title) milestone.title = title;
    const description = text(body.description, 'Description', 2000);
    if (description !== undefined) milestone.description = description;
    const targetDate = dateStr(body.targetDate, 'Target date');
    if (targetDate) milestone.targetDate = targetDate;
    const progress = amount(body.progress, 'Progress');
    if (progress !== undefined) milestone.progress = Math.min(100, progress);
    if (body.ownerId) {
      const owner = resolveOwner(project, body.ownerId);
      milestone.ownerId = owner.id;
      milestone.ownerName = owner.name;
    }
    const status = oneOf(body.status, MILESTONE_STATUSES, 'status');
    if (status && status !== milestone.status) {
      milestone.status = status;
      if (status === 'completed') milestone.progress = 100;
      logActivity(project.id, user, `marked milestone "${milestone.title}" as ${status.replace('_', ' ')}`, 'milestone');
      if (status === 'completed') {
        notify(projectMemberIds(project), user, {
          kind: 'status',
          title: 'Milestone Completed',
          message: `"${milestone.title}" in ${project.name} was completed.`,
          type: 'success',
          project,
        });
      }
    }

    db.save();
    res.json(milestone);
  })
);

app.delete(
  '/api/projects/:id/milestones/:milestoneId',
  authMiddleware,
  requireProjectAccess,
  requireProjectManager,
  route((req, res) => {
    const database = db.getData();
    const project = getProject(req);
    const milestone = database.milestones.find((m) => m.id === param(req, 'milestoneId') && m.projectId === project.id);
    if (!milestone) throw new HttpError(404, 'Milestone not found');
    database.milestones = database.milestones.filter((m) => m.id !== milestone.id);
    logActivity(project.id, req.user!, `removed milestone "${milestone.title}"`, 'milestone');
    db.save();
    res.json({ message: 'Milestone deleted' });
  })
);

// 3. Deliverables
app.get('/api/projects/:id/deliverables', authMiddleware, requireProjectAccess, (req, res) => {
  res.json(db.getData().deliverables.filter((d) => d.projectId === param(req, 'id')));
});

app.post(
  '/api/projects/:id/deliverables',
  authMiddleware,
  requireProjectAccess,
  requireProjectManager,
  route((req, res) => {
    const user = req.user!;
    const project = getProject(req);
    const body = req.body ?? {};
    const owner = resolveOwner(project, body.ownerId || user.id);

    const newDeliverable: ProjectDeliverable = {
      id: newId('del'),
      projectId: project.id,
      title: text(body.title, 'Deliverable title', 200, true)!,
      description: text(body.description, 'Description', 2000) ?? '',
      dueDate: dateStr(body.dueDate, 'Due date') ?? daysFromNow(45),
      status: 'pending',
      ownerId: owner.id,
      ownerName: owner.name,
    };

    db.getData().deliverables.push(newDeliverable);
    logActivity(project.id, user, `added deliverable "${newDeliverable.title}"`, 'general');
    notify([owner.id], user, {
      kind: 'deliverables',
      title: 'Deliverable Assigned',
      message: `You own the deliverable "${newDeliverable.title}" in ${project.name}.`,
      type: 'info',
      project,
    });
    db.save();
    res.status(201).json(newDeliverable);
  })
);

app.put(
  '/api/projects/:id/deliverables/:deliverableId',
  authMiddleware,
  requireProjectAccess,
  requireProjectManager,
  route((req, res) => {
    const user = req.user!;
    const project = getProject(req);
    const deliverable = db
      .getData()
      .deliverables.find((d) => d.id === param(req, 'deliverableId') && d.projectId === project.id);
    if (!deliverable) throw new HttpError(404, 'Deliverable not found');
    const body = req.body ?? {};

    const title = text(body.title, 'Deliverable title', 200);
    if (title) deliverable.title = title;
    const description = text(body.description, 'Description', 2000);
    if (description !== undefined) deliverable.description = description;
    const dueDate = dateStr(body.dueDate, 'Due date');
    if (dueDate) deliverable.dueDate = dueDate;
    if (body.ownerId) {
      const owner = resolveOwner(project, body.ownerId);
      deliverable.ownerId = owner.id;
      deliverable.ownerName = owner.name;
    }

    const status = oneOf(body.status, DELIVERABLE_STATUSES, 'status');
    if (status && status !== deliverable.status) {
      deliverable.status = status;
      if (status === 'approved') {
        deliverable.signedOffBy = user.name;
        deliverable.signedOffAt = now();
      } else {
        delete deliverable.signedOffBy;
        delete deliverable.signedOffAt;
      }
      logActivity(project.id, user, `set deliverable "${deliverable.title}" to ${status.replace('_', ' ')}`, 'general');
      notify([deliverable.ownerId], user, {
        kind: 'deliverables',
        title: status === 'approved' ? 'Deliverable Approved' : 'Deliverable Status Changed',
        message: `"${deliverable.title}" is now ${status.replace('_', ' ')}.`,
        type: status === 'approved' ? 'success' : status === 'rejected' ? 'alert' : 'info',
        project,
      });
    }

    db.save();
    res.json(deliverable);
  })
);

app.delete(
  '/api/projects/:id/deliverables/:deliverableId',
  authMiddleware,
  requireProjectAccess,
  requireProjectManager,
  route((req, res) => {
    const database = db.getData();
    const project = getProject(req);
    const deliverable = database.deliverables.find(
      (d) => d.id === param(req, 'deliverableId') && d.projectId === project.id
    );
    if (!deliverable) throw new HttpError(404, 'Deliverable not found');
    database.deliverables = database.deliverables.filter((d) => d.id !== deliverable.id);
    logActivity(project.id, req.user!, `removed deliverable "${deliverable.title}"`, 'general');
    db.save();
    res.json({ message: 'Deliverable deleted' });
  })
);

// 4. Chat Messages
app.get('/api/projects/:id/chat', authMiddleware, requireProjectAccess, (req, res) => {
  const items = db.getData().chatMessages.filter((m) => m.projectId === param(req, 'id'));
  if (!req.query.limit) {
    res.json(items);
    return;
  }
  const page = pageOf([...items].sort(byNewest), req);
  res.json({ ...page, items: page.items.reverse() });
});

app.post(
  '/api/projects/:id/chat',
  authMiddleware,
  requireProjectAccess,
  route((req, res) => {
    const user = req.user!;
    const project = getProject(req);

    const newMsg: ProjectChatMessage = {
      id: newId('msg'),
      projectId: project.id,
      senderId: user.id,
      senderName: user.name,
      senderAvatar: user.avatar,
      senderRole: user.title,
      text: text(req.body?.text, 'Message', 4000, true)!,
      timestamp: now(),
      reactions: {},
    };

    db.getData().chatMessages.push(newMsg);
    db.save();
    res.status(201).json(newMsg);
  })
);

// 5. Files (real uploads, stored under data/uploads/<projectId>/)
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const dir = path.join(tenantOf(req).uploadsDir, String(req.params.id));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    // Stored under a generated name; the original name is only kept as metadata
    filename: (_req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname).slice(0, 12)}`),
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

function describeFileType(name: string, mime: string): string {
  const ext = path.extname(name).replace('.', '').toUpperCase();
  if (mime.startsWith('image/')) return `${ext || 'Image'} Image`;
  if (mime === 'application/pdf') return 'PDF';
  return ext || 'Document';
}

app.get('/api/projects/:id/files', authMiddleware, requireProjectAccess, (req, res) => {
  res.json(db.getData().files.filter((f) => f.projectId === param(req, 'id')));
});

app.post(
  '/api/projects/:id/files',
  authMiddleware,
  requireProjectAccess,
  keepTenant(upload.single('file')),
  route((req, res) => {
    const user = req.user!;
    const project = getProject(req);
    const file = req.file;
    if (!file) throw new HttpError(400, 'Choose a file to upload');

    // Browsers send multipart filenames as latin1; recover UTF-8 names
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8').slice(0, 255);

    const newFile: ProjectFile = {
      id: newId('fil'),
      projectId: project.id,
      name: originalName,
      category: oneOf(req.body?.category, FILE_CATEGORIES, 'category') ?? 'general',
      fileSize: formatBytes(file.size),
      fileType: describeFileType(originalName, file.mimetype),
      uploadedBy: user.name,
      uploadedById: user.id,
      uploadedAt: now(),
      downloadUrl: '',
      storedName: file.filename,
      mimeType: file.mimetype,
    };
    newFile.downloadUrl = `/api/projects/${project.id}/files/${newFile.id}/download`;

    db.getData().files.unshift(newFile);
    logActivity(project.id, user, `uploaded file "${newFile.name}"`, 'file');
    db.save();
    res.status(201).json(newFile);
  })
);

app.get(
  '/api/projects/:id/files/:fileId/download',
  authMiddleware,
  requireProjectAccess,
  route((req, res) => {
    const file = db.getData().files.find((f) => f.id === param(req, 'fileId') && f.projectId === param(req, 'id'));
    if (!file) throw new HttpError(404, 'File not found');
    if (!file.storedName) throw new HttpError(404, 'This is a sample entry with no stored file content');
    const fullPath = path.join(currentTenant().uploadsDir, file.projectId, path.basename(file.storedName));
    if (!fs.existsSync(fullPath)) throw new HttpError(404, 'Stored file is missing on the server');
    res.download(fullPath, file.name);
  })
);

app.delete(
  '/api/projects/:id/files/:fileId',
  authMiddleware,
  requireProjectAccess,
  route((req, res) => {
    const user = req.user!;
    const database = db.getData();
    const project = getProject(req);
    const file = database.files.find((f) => f.id === param(req, 'fileId') && f.projectId === project.id);
    if (!file) throw new HttpError(404, 'File not found');
    if (file.uploadedById !== user.id && !canManageProject(user, project)) {
      throw new HttpError(403, 'Only the uploader or the project lead can delete this file');
    }

    database.files = database.files.filter((f) => f.id !== file.id);
    if (file.storedName) {
      fs.rmSync(path.join(currentTenant().uploadsDir, project.id, path.basename(file.storedName)), { force: true });
    }
    logActivity(project.id, user, `deleted file "${file.name}"`, 'file');
    db.save();
    res.json({ message: 'File deleted' });
  })
);

// 6. Notes & Wiki
app.get('/api/projects/:id/notes', authMiddleware, requireProjectAccess, (req, res) => {
  res.json(db.getData().notes.filter((n) => n.projectId === param(req, 'id')));
});

app.post(
  '/api/projects/:id/notes',
  authMiddleware,
  requireProjectAccess,
  route((req, res) => {
    const user = req.user!;
    const project = getProject(req);
    const body = req.body ?? {};

    const newNote: ProjectNote = {
      id: newId('not'),
      projectId: project.id,
      title: text(body.title, 'Note title', 200, true)!,
      content: text(body.content, 'Note content', 50000) ?? '',
      category: oneOf(body.category, NOTE_CATEGORIES, 'category') ?? 'meeting',
      authorId: user.id,
      authorName: user.name,
      updatedAt: now(),
    };

    db.getData().notes.unshift(newNote);
    logActivity(project.id, user, `published note "${newNote.title}"`, 'general');
    db.save();
    res.status(201).json(newNote);
  })
);

function findOwnedNote(req: AuthenticatedRequest): ProjectNote {
  const project = getProject(req);
  const note = db.getData().notes.find((n) => n.id === param(req, 'noteId') && n.projectId === project.id);
  if (!note) throw new HttpError(404, 'Note not found');
  if (note.authorId !== req.user!.id && !canManageProject(req.user!, project)) {
    throw new HttpError(403, 'Only the author or the project lead can change this note');
  }
  return note;
}

app.put(
  '/api/projects/:id/notes/:noteId',
  authMiddleware,
  requireProjectAccess,
  route((req, res) => {
    const note = findOwnedNote(req);
    const body = req.body ?? {};
    const title = text(body.title, 'Note title', 200);
    if (title !== undefined && title === '') throw new HttpError(400, 'Note title is required');
    if (title) note.title = title;
    const content = text(body.content, 'Note content', 50000);
    if (content !== undefined) note.content = content;
    const category = oneOf(body.category, NOTE_CATEGORIES, 'category');
    if (category) note.category = category;
    note.updatedAt = now();
    db.save();
    res.json(note);
  })
);

app.delete(
  '/api/projects/:id/notes/:noteId',
  authMiddleware,
  requireProjectAccess,
  route((req, res) => {
    const note = findOwnedNote(req);
    const database = db.getData();
    database.notes = database.notes.filter((n) => n.id !== note.id);
    db.save();
    res.json({ message: 'Note deleted' });
  })
);

// 7. Project Links
app.get('/api/projects/:id/links', authMiddleware, requireProjectAccess, (req, res) => {
  res.json(db.getData().links.filter((l) => l.projectId === param(req, 'id')));
});

app.post(
  '/api/projects/:id/links',
  authMiddleware,
  requireProjectAccess,
  route((req, res) => {
    const user = req.user!;
    const project = getProject(req);
    const body = req.body ?? {};

    const newLink: ProjectLink = {
      id: newId('lnk'),
      projectId: project.id,
      title: text(body.title, 'Link title', 200, true)!,
      url: httpUrl(body.url, 'URL', true)!,
      category: oneOf(body.category, LINK_CATEGORIES, 'category') ?? 'other',
      description: text(body.description, 'Description', 1000) ?? '',
      addedBy: user.name,
      addedById: user.id,
      addedAt: now(),
    };

    db.getData().links.unshift(newLink);
    db.save();
    res.status(201).json(newLink);
  })
);

function findOwnedLink(req: AuthenticatedRequest): ProjectLink {
  const project = getProject(req);
  const link = db.getData().links.find((l) => l.id === param(req, 'linkId') && l.projectId === project.id);
  if (!link) throw new HttpError(404, 'Link not found');
  if (link.addedById !== req.user!.id && !canManageProject(req.user!, project)) {
    throw new HttpError(403, 'Only the person who added this link or the project lead can change it');
  }
  return link;
}

app.put(
  '/api/projects/:id/links/:linkId',
  authMiddleware,
  requireProjectAccess,
  route((req, res) => {
    const link = findOwnedLink(req);
    const body = req.body ?? {};
    const title = text(body.title, 'Link title', 200);
    if (title) link.title = title;
    const url = httpUrl(body.url, 'URL');
    if (url) link.url = url;
    const category = oneOf(body.category, LINK_CATEGORIES, 'category');
    if (category) link.category = category;
    const description = text(body.description, 'Description', 1000);
    if (description !== undefined) link.description = description;
    db.save();
    res.json(link);
  })
);

app.delete(
  '/api/projects/:id/links/:linkId',
  authMiddleware,
  requireProjectAccess,
  route((req, res) => {
    const link = findOwnedLink(req);
    const database = db.getData();
    database.links = database.links.filter((l) => l.id !== link.id);
    db.save();
    res.json({ message: 'Link deleted' });
  })
);

// 8. Team Members
app.get('/api/projects/:id/team', authMiddleware, requireProjectAccess, (req, res) => {
  const project = getProject(req);
  const ids = projectMemberIds(project);
  res.json(db.getData().users.filter((u) => ids.has(u.id)));
});

app.post(
  '/api/projects/:id/team',
  authMiddleware,
  requireProjectAccess,
  requireProjectManager,
  route((req, res) => {
    const user = req.user!;
    const database = db.getData();
    const project = getProject(req);
    const targetEmployee = database.users.find((u) => u.id === req.body?.employeeId);
    if (!targetEmployee) throw new HttpError(404, 'Employee not found');

    if (!project.teamMemberIds.includes(targetEmployee.id)) {
      project.teamMemberIds.push(targetEmployee.id);
      logActivity(project.id, user, `added ${targetEmployee.name} to project team`, 'member');
      notify([targetEmployee.id], user, {
        kind: 'team',
        title: 'Added to Project Team',
        message: `${user.name} added you to "${project.name}".`,
        type: 'info',
        project,
      });
      db.save();
    }

    const ids = projectMemberIds(project);
    res.json(database.users.filter((u) => ids.has(u.id)));
  })
);

app.delete(
  '/api/projects/:id/team/:memberId',
  authMiddleware,
  requireProjectAccess,
  requireProjectManager,
  route((req, res) => {
    const user = req.user!;
    const database = db.getData();
    const project = getProject(req);
    const memberId = param(req, 'memberId');

    if (project.leadId === memberId) throw new HttpError(400, 'Cannot remove the Project Lead from the team');

    const idx = project.teamMemberIds.indexOf(memberId);
    if (idx !== -1) {
      project.teamMemberIds.splice(idx, 1);
      const removed = database.users.find((u) => u.id === memberId);
      // Close their tab unless they can still see the project (e.g. they are an admin)
      if (!removed || !canUserViewProject(removed, project)) removeProjectFromWorkspaces(project.id, [memberId]);
      logActivity(project.id, user, `removed ${removed ? removed.name : memberId} from project team`, 'member');
      db.save();
    }

    res.json({ message: 'Team member removed' });
  })
);

// 9. Activity History
app.get('/api/projects/:id/activity', authMiddleware, requireProjectAccess, (req, res) => {
  const items = db.getData().activities.filter((a) => a.projectId === param(req, 'id'));
  res.json(req.query.limit ? pageOf([...items].sort(byNewest), req) : items);
});

// ==========================================
// CLIENTS DIRECTORY & CRUD
// ==========================================

app.get('/api/clients', authMiddleware, (req, res) => {
  const database = db.getData();
  const { search } = req.query;
  let clients = database.clients;

  if (typeof search === 'string' && search.trim()) {
    const q = search.toLowerCase();
    clients = clients.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.company.toLowerCase().includes(q) ||
        c.contactPerson.toLowerCase().includes(q)
    );
  }

  // Derived from projects, so it can never drift out of sync
  res.json(
    clients.map((c) => ({
      ...c,
      activeProjectsCount: database.projects.filter((p) => p.clientId === c.id && p.status === 'active').length,
    }))
  );
});

function clientFields(body: any, isAdmin: boolean): Partial<Client> {
  const fields: Partial<Client> = {
    name: text(body.name, 'Client name', 200),
    company: text(body.company, 'Company', 200),
    industry: text(body.industry, 'Industry', 100),
    contactPerson: text(body.contactPerson, 'Contact person', 200),
    email: text(body.email, 'Email', 200),
    phone: text(body.phone, 'Phone', 50),
    status: oneOf(body.status, CLIENT_STATUSES, 'status'),
    notes: text(body.notes, 'Notes', 5000),
    website: body.website ? httpUrl(body.website, 'Website') : text(body.website, 'Website', 0),
  };
  if (isAdmin) fields.totalBilled = amount(body.totalBilled, 'Total billed');
  if (fields.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) throw new HttpError(400, 'Enter a valid email');
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
}

app.post(
  '/api/clients',
  authMiddleware,
  requireRole(['admin', 'pm']),
  route((req, res) => {
    const fields = clientFields(req.body ?? {}, req.user!.role === 'admin');
    if (!fields.name) throw new HttpError(400, 'Client name is required');

    const newClient: Client = {
      id: newId('cli'),
      name: fields.name,
      company: fields.company || fields.name,
      industry: fields.industry || 'Technology',
      contactPerson: fields.contactPerson || 'Primary Contact',
      email: fields.email || '',
      phone: fields.phone || '',
      status: fields.status || 'active',
      totalBilled: fields.totalBilled ?? 0,
      activeProjectsCount: 0,
      notes: fields.notes || '',
      website: fields.website || '',
    };

    db.getData().clients.unshift(newClient);
    db.save();
    res.status(201).json(newClient);
  })
);

app.put(
  '/api/clients/:id',
  authMiddleware,
  requireRole(['admin', 'pm']),
  route((req, res) => {
    const database = db.getData();
    const client = database.clients.find((c) => c.id === param(req, 'id'));
    if (!client) throw new HttpError(404, 'Client not found');

    const fields = clientFields(req.body ?? {}, req.user!.role === 'admin');
    if (fields.name === '') throw new HttpError(400, 'Client name is required');
    Object.assign(client, fields);

    if (fields.name) {
      for (const p of database.projects) if (p.clientId === client.id) p.clientName = client.name;
    }

    db.save();
    res.json({
      ...client,
      activeProjectsCount: database.projects.filter((p) => p.clientId === client.id && p.status === 'active').length,
    });
  })
);

// ==========================================
// GLOBAL TASKS & DASHBOARD STATS
// ==========================================

function visibleProjectIds(user: User): Set<string> {
  return new Set(
    db
      .getData()
      .projects.filter((p) => canUserViewProject(user, p))
      .map((p) => p.id)
  );
}

app.get('/api/tasks/global', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { filter, status } = req.query;
  const allowed = visibleProjectIds(user);

  let tasks = db.getData().tasks.filter((t) => allowed.has(t.projectId));

  if (filter === 'assigned_to_me') {
    tasks = tasks.filter((t) => t.assigneeId === user.id);
  }

  if (status && status !== 'all') {
    tasks = tasks.filter((t) => t.status === status);
  }

  res.json(tasks);
});

app.get('/api/dashboard/stats', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const database = db.getData();

  const visibleProjects = database.projects.filter((p) => canUserViewProject(user, p));
  const visibleIds = new Set(visibleProjects.map((p) => p.id));
  const accessibleTasks = database.tasks.filter((t) => visibleIds.has(t.projectId));
  const myTasks = accessibleTasks.filter((t) => t.assigneeId === user.id);

  const pendingMilestones = database.milestones
    .filter((m) => visibleIds.has(m.projectId) && m.status !== 'completed')
    .sort((a, b) => a.targetDate.localeCompare(b.targetDate))
    .slice(0, 5);

  const priorityRank = { urgent: 0, high: 1, medium: 2, low: 3 };
  const urgentTasks = accessibleTasks
    .filter((t) => t.status !== 'done' && (t.priority === 'urgent' || t.priority === 'high'))
    .sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority] || a.dueDate.localeCompare(b.dueDate))
    .slice(0, 6);

  res.json({
    activeProjectsCount: visibleProjects.filter((p) => p.status === 'active').length,
    completedProjectsCount: visibleProjects.filter((p) => p.status === 'completed').length,
    totalProjectsCount: visibleProjects.length,
    totalBudget: visibleProjects.reduce((sum, p) => sum + (p.budget || 0), 0),
    totalSpent: visibleProjects.reduce((sum, p) => sum + (p.spent || 0), 0),
    totalEmployees: database.users.length,
    activeClientsCount: database.clients.filter((c) => c.status === 'active').length,
    myPendingTasksCount: myTasks.filter((t) => t.status !== 'done').length,
    allPendingTasksCount: accessibleTasks.filter((t) => t.status !== 'done').length,
    pendingMilestones,
    urgentTasks,
    recentProjects: [...visibleProjects]
      .filter((p) => p.status !== 'archived')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 4),
  });
});

// ==========================================
// TASK COMMENTS & @MENTIONS
// ==========================================

function findTask(req: Request): { project: Project; task: Task } {
  const project = getProject(req);
  const task = db.getData().tasks.find((t) => t.id === param(req, 'taskId') && t.projectId === project.id);
  if (!task) throw new HttpError(404, 'Task not found');
  return { project, task };
}

// Mentions are sent as ids by the client; keep only people on the project whose name still appears in the text
function resolveMentions(project: Project, text: string, ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const members = projectMemberIds(project);
  const users = db.getData().users;
  return [...new Set(ids.map(String))].filter((id) => {
    const u = users.find((x) => x.id === id);
    return !!u && members.has(id) && text.includes(`@${u.name}`);
  });
}

app.get('/api/projects/:id/tasks/:taskId/comments', authMiddleware, requireProjectAccess, route((req, res) => {
  const { task } = findTask(req);
  res.json(db.getData().comments.filter((c) => c.taskId === task.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
}));

app.post(
  '/api/projects/:id/tasks/:taskId/comments',
  authMiddleware,
  requireProjectAccess,
  route((req, res) => {
    const user = req.user!;
    const { project, task } = findTask(req);
    const body = text(req.body?.text, 'Comment', 4000, true)!;
    const mentions = resolveMentions(project, body, req.body?.mentions);

    const comment: TaskComment = {
      id: newId('cmt'),
      taskId: task.id,
      projectId: project.id,
      authorId: user.id,
      authorName: user.name,
      authorAvatar: user.avatar,
      text: body,
      mentions,
      createdAt: now(),
    };
    db.getData().comments.push(comment);

    const preview = body.length > 120 ? `${body.slice(0, 117)}…` : body;
    notify(mentions, user, {
      title: 'You were mentioned',
      message: `${user.name} on "${task.title}": ${preview}`,
      type: 'info',
      kind: 'mentions',
      project,
      taskId: task.id,
    });
    // The assignee hears about comments on their task (unless they were already mentioned)
    if (!mentions.includes(task.assigneeId)) {
      notify([task.assigneeId], user, {
        title: 'New comment on your task',
        message: `${user.name} on "${task.title}": ${preview}`,
        type: 'info',
        kind: 'comments',
        project,
        taskId: task.id,
      });
    }

    db.save();
    res.status(201).json(comment);
  })
);

function findOwnedComment(req: AuthenticatedRequest): TaskComment {
  const { project, task } = findTask(req);
  const comment = db.getData().comments.find((c) => c.id === param(req, 'commentId') && c.taskId === task.id);
  if (!comment) throw new HttpError(404, 'Comment not found');
  const isAuthor = comment.authorId === req.user!.id;
  if (!isAuthor && !(req.method === 'DELETE' && canManageProject(req.user!, project))) {
    throw new HttpError(403, 'You can only change your own comments');
  }
  return comment;
}

app.put(
  '/api/projects/:id/tasks/:taskId/comments/:commentId',
  authMiddleware,
  requireProjectAccess,
  route((req, res) => {
    const comment = findOwnedComment(req);
    const project = getProject(req);
    comment.text = text(req.body?.text, 'Comment', 4000, true)!;
    comment.mentions = resolveMentions(project, comment.text, req.body?.mentions ?? comment.mentions);
    comment.editedAt = now();
    db.save();
    res.json(comment);
  })
);

app.delete(
  '/api/projects/:id/tasks/:taskId/comments/:commentId',
  authMiddleware,
  requireProjectAccess,
  route((req, res) => {
    const comment = findOwnedComment(req);
    const database = db.getData();
    database.comments = database.comments.filter((c) => c.id !== comment.id);
    db.save();
    res.json({ message: 'Comment deleted' });
  })
);

// ==========================================
// SEARCH (everything the person can see)
// ==========================================

app.get('/api/search', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const empty: SearchResults = { projects: [], tasks: [], notes: [], files: [], people: [] };
  const q = String(req.query.q ?? '').trim().toLowerCase();
  if (q.length < 2) {
    res.json(empty);
    return;
  }
  const database = db.getData();
  const visible = database.projects.filter((p) => canUserViewProject(req.user!, p));
  const ids = new Set(visible.map((p) => p.id));
  const nameOf = (projectId: string) => visible.find((p) => p.id === projectId)?.name ?? '';
  const has = (v?: string) => !!v && v.toLowerCase().includes(q);
  const LIMIT = 8;

  const snippet = (content: string) => {
    const at = content.toLowerCase().indexOf(q);
    if (at === -1) return content.slice(0, 90);
    const start = Math.max(0, at - 30);
    return `${start > 0 ? '…' : ''}${content.slice(start, at + q.length + 60).replace(/\s+/g, ' ')}…`;
  };

  const results: SearchResults = {
    projects: visible
      .filter((p) => has(p.name) || has(p.code) || has(p.clientName) || has(p.category))
      .slice(0, LIMIT)
      .map((p) => ({ id: p.id, name: p.name, code: p.code, clientName: p.clientName, status: p.status })),
    tasks: database.tasks
      .filter((t) => ids.has(t.projectId) && (has(t.title) || has(t.description) || t.tags.some(has)))
      .slice(0, LIMIT)
      .map((t) => ({ id: t.id, title: t.title, projectId: t.projectId, projectName: nameOf(t.projectId), status: t.status })),
    notes: database.notes
      .filter((n) => ids.has(n.projectId) && (has(n.title) || has(n.content)))
      .slice(0, LIMIT)
      .map((n) => ({ id: n.id, title: n.title, projectId: n.projectId, projectName: nameOf(n.projectId), snippet: has(n.title) ? n.content.slice(0, 90) : snippet(n.content) })),
    files: database.files
      .filter((f) => ids.has(f.projectId) && has(f.name))
      .slice(0, LIMIT)
      .map((f) => ({ id: f.id, name: f.name, projectId: f.projectId, projectName: nameOf(f.projectId) })),
    people: database.users
      .filter((u) => u.active !== false && (has(u.name) || has(u.title) || has(u.email)))
      .slice(0, LIMIT)
      .map((u) => ({ id: u.id, name: u.name, title: u.title, email: u.email, avatar: u.avatar })),
  };
  res.json(results);
});

// ==========================================
// YOUR PROFILE & NOTIFICATION PREFERENCES
// ==========================================

app.put(
  '/api/auth/me',
  authMiddleware,
  route((req, res) => {
    const user = req.user!;
    const body = req.body ?? {};
    const name = text(body.name, 'Name', 100);
    if (name !== undefined && !name) throw new HttpError(400, 'Name is required');
    if (name) renameUser(user, name);
    const title = text(body.title, 'Job title', 100);
    if (title) user.title = title;
    const phone = text(body.phone, 'Phone', 50);
    if (phone !== undefined) user.phone = phone;
    const status = oneOf(body.status, USER_STATUSES, 'status');
    if (status) user.status = status;
    db.save();
    res.json(user);
  })
);

// Profile photos are served without sign-in (an <img> can't send a token); the names are random.
// Each office keeps its own: /api/avatars/<office>/<file> (main-office photos from before offices: /api/avatars/<file>).
const avatarDir = (tenant = currentTenant()) => path.join(tenant.uploadsDir, 'avatars');
const AVATAR_TYPES: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const dir = avatarDir(tenantOf(req));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => cb(null, `${uuidv4()}${AVATAR_TYPES[file.mimetype] ?? '.img'}`),
  }),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype in AVATAR_TYPES),
});

// The file behind one of this office's photo URLs (never another office's)
function ownAvatarFile(avatar: string): string | null {
  const parts = avatar.startsWith('/api/avatars/') ? avatar.slice('/api/avatars/'.length).split('/') : [];
  const here = currentTenant().id;
  if (parts.length === 2 && parts[0] === here) return path.join(avatarDir(), path.basename(parts[1]));
  if (parts.length === 1 && here === MAIN_TENANT_ID) return path.join(avatarDir(), path.basename(parts[0]));
  return null;
}

app.post(
  '/api/auth/me/avatar',
  authMiddleware,
  keepTenant(avatarUpload.single('avatar')),
  route((req, res) => {
    const user = req.user!;
    if (!req.file) throw new HttpError(400, 'Choose a JPG, PNG, WebP or GIF image up to 2 MB');
    const previous = ownAvatarFile(user.avatar);
    user.avatar = `/api/avatars/${encodeURIComponent(currentTenant().id)}/${req.file.filename}`;
    db.save();
    if (previous) fs.rmSync(previous, { force: true });
    res.json(user);
  })
);

app.delete(
  '/api/auth/me/avatar',
  authMiddleware,
  route((req, res) => {
    const user = req.user!;
    const previous = ownAvatarFile(user.avatar);
    user.avatar = '';
    db.save();
    if (previous) fs.rmSync(previous, { force: true });
    res.json(user);
  })
);

function sendAvatar(res: Response, officeId: string, file: string) {
  const tenant = getTenant(officeId);
  if (!tenant || !/^[0-9a-f-]{36}\.(jpg|png|webp|gif)$/.test(file)) {
    res.status(404).end();
    return;
  }
  res.sendFile(path.join(avatarDir(tenant), file), { maxAge: '365d', immutable: true }, (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
}
app.get('/api/avatars/:office/:file', (req, res) => sendAvatar(res, param(req, 'office'), param(req, 'file')));
app.get('/api/avatars/:file', (req, res) => sendAvatar(res, MAIN_TENANT_ID, param(req, 'file')));

const KINDS = NOTIFICATION_KINDS.map((k) => k.kind) as readonly NotificationKind[];

app.get('/api/notification-preferences', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  res.json({ muted: ensureWorkspace(req.user!.id).mutedNotificationKinds ?? [] });
});

app.put(
  '/api/notification-preferences',
  authMiddleware,
  route((req, res) => {
    const muted = req.body?.muted;
    if (!Array.isArray(muted)) throw new HttpError(400, 'muted must be a list');
    const workspace = ensureWorkspace(req.user!.id);
    workspace.mutedNotificationKinds = [...new Set(muted.filter((k: unknown): k is NotificationKind => KINDS.includes(k as NotificationKind)))];
    db.save();
    res.json({ muted: workspace.mutedNotificationKinds });
  })
);

// ==========================================
// PHONE & DESKTOP NOTIFICATIONS (Web Push)
// ==========================================

app.get('/api/push/config', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  res.json({ enabled: !!pushPublicKey, publicKey: pushPublicKey });
});

// This device should get this person's notifications
app.post(
  '/api/push/subscribe',
  authMiddleware,
  route((req, res) => {
    if (!pushPublicKey) throw new HttpError(503, 'Phone notifications are not set up on this server');
    const sub = req.body?.subscription;
    if (!isValidSubscription(sub)) throw new HttpError(400, 'Invalid subscription');
    addSubscription(req.user!.id, sub, ensureWorkspace(req.user!.id));
    db.save();
    res.json({ ok: true });
  })
);

// This device should stop (turned off, or signing out)
app.post(
  '/api/push/unsubscribe',
  authMiddleware,
  route((req, res) => {
    const endpoint = req.body?.endpoint;
    if (typeof endpoint !== 'string') throw new HttpError(400, 'endpoint is required');
    const ws = ensureWorkspace(req.user!.id);
    if (ws.pushSubscriptions?.some((s) => s.endpoint === endpoint)) {
      removeSubscription(endpoint);
      db.save();
    }
    res.json({ ok: true });
  })
);

app.post(
  '/api/push/test',
  authMiddleware,
  route(async (req, res) => {
    const sent = await sendPush(req.user!.id, {
      title: 'HandleMyDesk',
      body: 'Phone notifications are working.',
      url: '/#/',
      tag: 'test',
    });
    if (sent === 0) throw new HttpError(400, 'No device received it. Turn notifications on again on this device.');
    res.json({ sent });
  })
);

// Offices, "Report a problem" and the HandleMyDesk owner console (see platform.ts)
registerPlatformRoutes(app, notify);

// ==========================================
// REMINDERS (run hourly)
// ==========================================

// Sends each assignee one "due tomorrow" and one "overdue" reminder per task and due date
export function runReminders(at = new Date()): number {
  const database = db.getData();
  const today = at.toISOString().split('T')[0];
  const tomorrow = new Date(at.getTime() + 86400000).toISOString().split('T')[0];
  let sent = 0;

  for (const task of database.tasks) {
    if (task.status === 'done' || !task.dueDate) continue;
    const project = database.projects.find((p) => p.id === task.projectId);
    if (!project || project.status === 'archived' || project.status === 'completed') continue;

    if (task.dueDate === tomorrow && task.remindedDue !== task.dueDate) {
      task.remindedDue = task.dueDate;
      sent += notify([task.assigneeId], null, {
        title: 'Due tomorrow',
        message: `"${task.title}" is due tomorrow.`,
        type: 'warning',
        kind: 'reminders',
        project,
        taskId: task.id,
      });
    }
    if (task.dueDate < today && task.remindedOverdue !== task.dueDate) {
      task.remindedOverdue = task.dueDate;
      sent += notify([task.assigneeId], null, {
        title: 'Task overdue',
        message: `"${task.title}" was due ${task.dueDate}.`,
        type: 'alert',
        kind: 'reminders',
        project,
        taskId: task.id,
      });
    }
  }
  db.save();
  return sent;
}

// ==========================================
// NOTIFICATIONS
// ==========================================

app.get('/api/notifications', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const notifs = db
    .getData()
    .notifications.filter((n) => n.userId === req.user!.id)
    .sort(byNewest);
  if (!req.query.limit) {
    res.json(notifs);
    return;
  }
  res.json({ ...pageOf(notifs, req), unreadCount: notifs.filter((n) => !n.read).length });
});

app.post('/api/notifications/read-all', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  for (const n of db.getData().notifications) {
    if (n.userId === req.user!.id) n.read = true;
  }
  db.save();
  res.json({ success: true });
});

app.post('/api/notifications/:id/read', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
  const notif = db.getData().notifications.find((n) => n.id === param(req, 'id') && n.userId === req.user!.id);
  if (!notif) {
    res.status(404).json({ error: 'Notification not found' });
    return;
  }
  notif.read = true;
  db.save();
  res.json({ success: true });
});

// Reset the database to seed data. Admin-only, and never available in production.
app.post('/api/system/reset', authMiddleware, requireRole(['admin']), (req, res) => {
  if (IS_PROD) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  db.resetToDefault();
  res.json({ message: 'Database reset to initial seed state' });
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// In production the server also serves the built client
const DIST_DIR = path.resolve(process.cwd(), 'dist');
if (IS_PROD && fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(DIST_DIR, 'index.html')));
}

// JSON error handler (validation errors, upload limits, unexpected failures)
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof multer.MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE' ? `Files must be ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB or smaller` : err.message;
    res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: message });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Malformed JSON body' });
    return;
  }
  logServerError(err, req as LoggedRequest);
  const requestId = (req as LoggedRequest).requestId;
  res.status(500).json({ error: `Something went wrong on the server. Reference: ${requestId}`, requestId });
});

// Start listening if not running in test mode
// One automatic backup a day: checked at start-up and then every hour
function runDailyBackup() {
  const newest = listBackups(currentTenant().backupDir).find((b) => !/-[a-z]+\.db$/.test(b.name));
  if (newest && Date.now() - Date.parse(newest.createdAt) < 23 * 3600 * 1000) return;
  try {
    const info = db.backup();
    console.log(`Backup saved for office ${currentTenant().id}: ${info.name}`);
  } catch (err) {
    console.error(`Automatic backup failed for office ${currentTenant().id}:`, err);
  }
}

// Hourly jobs run once for every office, inside that office
function forEveryOffice(job: () => unknown) {
  for (const tenant of allTenants()) {
    try {
      runInTenant(tenant, job);
    } catch (err) {
      console.error(`Hourly job failed for office ${tenant.id}:`, err);
    }
  }
}

if (process.env.NODE_ENV !== 'test') {
  if (IS_PROD && !fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
    console.warn('No built app found in dist/. Run "npm run build" before "npm start".');
  }
  forEveryOffice(runDailyBackup);
  setInterval(() => forEveryOffice(runDailyBackup), 3600 * 1000).unref();
  forEveryOffice(() => runReminders());
  setInterval(() => forEveryOffice(() => runReminders()), 3600 * 1000).unref();

  // From here on, all work must know its office (requests and the hourly jobs above do)
  requireOfficeContext();

  startFileWatch();
  const server = app.listen(PORT, () => {
    console.log(`HandleMyDesk server running on port ${PORT} (process ${process.pid})`);
  });
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`
Port ${PORT} is already in use by another program. Stop it, or set PORT to a free port.
`);
      process.exit(1);
    }
    throw err;
  });
}
