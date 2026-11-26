import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import express, { Request, Response, NextFunction, RequestHandler } from 'express';
import { Database, Tenant, MAIN_TENANT, MAIN_TENANT_ID, runInTenant, currentTenant, db, SEED_PASSWORD, initialsOf, FirstAdmin } from './db';
import { DATA_DIR, IS_TEST, IS_PROD } from './paths';
import { JWT_SECRET, generateToken, authMiddleware, AuthenticatedRequest } from './auth';
import { closeStreamsFor } from './events';
import {
  User,
  NotificationItem,
  NotificationKind,
  OfficeStatus,
  OfficeSummary,
  OwnerProfile,
  OwnerLogEntry,
  SupportTicket,
  SupportCategory,
  SupportMessage,
} from '../types';

/*
 * HANDLEMYDESK OWNER LEVEL
 *
 *   HandleMyDesk owner (you)  — sees and can work inside every office
 *     └── Office (one customer company), each with its own database, uploads and backups
 *           └── Admin → Project managers → Members
 *
 * This file keeps the list of offices, the owner accounts, "Report a problem" tickets and a log of
 * what owners did, in DATA_DIR/platform.json. It also picks which office each request runs in.
 */

interface OfficeRecord {
  id: string;
  name: string;
  status: OfficeStatus;
  notes: string;
  createdAt: string;
}

interface OwnerRecord extends OwnerProfile {
  passwordHash: string;
  sessionVersion: number;
  createdAt: string;
  envFingerprint?: string;
}

interface PlatformData {
  offices: OfficeRecord[];
  owners: OwnerRecord[];
  tickets: SupportTicket[];
  log: OwnerLogEntry[];
}

const PLATFORM_FILE = path.join(DATA_DIR, 'platform.json');
const OFFICES_DIR = path.join(DATA_DIR, 'offices');
const LOG_KEEP = 1000;
const now = () => new Date().toISOString();
const newId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

// The HandleMyDesk support account that exists inside an office while the owner works there
export const SUPPORT_USER_ID = 'hmd-support';

function freshPlatform(): PlatformData {
  return { offices: [], owners: [], tickets: [], log: [] };
}

function loadPlatform(): PlatformData {
  if (IS_TEST) return freshPlatform();
  try {
    return { ...freshPlatform(), ...JSON.parse(fs.readFileSync(PLATFORM_FILE, 'utf-8')) };
  } catch (err: any) {
    if (err?.code !== 'ENOENT') console.error(`Could not read ${PLATFORM_FILE}; starting a new office list:`, err);
    return freshPlatform();
  }
}

const data = loadPlatform();

function savePlatform() {
  if (IS_TEST) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${PLATFORM_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  fs.renameSync(tmp, PLATFORM_FILE);
}

// The original installation is always the "main" office
if (!data.offices.some((o) => o.id === MAIN_TENANT_ID)) {
  data.offices.unshift({ id: MAIN_TENANT_ID, name: process.env.MAIN_OFFICE_NAME?.trim() || 'Main office', status: 'active', notes: '', createdAt: now() });
}

// Which OWNER_PASSWORD was last applied (a keyed hash, never the password itself)
const envFingerprint = (password: string) => crypto.createHmac('sha256', 'handlemydesk-owner-password').update(password).digest('hex');

/*
 * Owner account from the OWNER_* settings (or a development default):
 * - created on first start;
 * - OWNER_PASSWORD changed on the server = the owner's password is reset to it ("forgot password"
 *   for the owner). A password changed in the console stays until OWNER_PASSWORD changes again.
 */
function bootstrapOwner() {
  const name = process.env.OWNER_NAME?.trim() || (IS_PROD ? '' : 'HandleMyDesk Owner');
  const email = process.env.OWNER_EMAIL?.trim().toLowerCase() || (IS_PROD ? '' : 'owner@handlemydesk.internal');
  const password = process.env.OWNER_PASSWORD || (IS_PROD ? '' : SEED_PASSWORD);
  if (!name || !email || password.length < 8) {
    if (data.owners.length === 0) console.warn('Owner console is off: set OWNER_NAME, OWNER_EMAIL and OWNER_PASSWORD (8+ characters). See DEPLOY.md.');
    return;
  }
  const existing = data.owners.find((o) => o.email === email);
  if (!existing) {
    data.owners.push({ id: newId('own'), name, email, passwordHash: bcrypt.hashSync(password, 10), sessionVersion: 0, createdAt: now(), envFingerprint: envFingerprint(password) });
    if (!IS_TEST) console.log(`Created the HandleMyDesk owner account: ${email}`);
  } else if (existing.envFingerprint !== envFingerprint(password)) {
    existing.passwordHash = bcrypt.hashSync(password, 10);
    existing.envFingerprint = envFingerprint(password);
    existing.sessionVersion++;
    console.log(`Owner password for ${email} reset from OWNER_PASSWORD`);
  }
}
bootstrapOwner();
savePlatform();

// ==========================================
// OFFICES (tenants)
// ==========================================

const tenants = new Map<string, Tenant>([[MAIN_TENANT_ID, MAIN_TENANT]]);

function openTenant(office: OfficeRecord, firstAdmin?: FirstAdmin): Tenant {
  const existing = tenants.get(office.id);
  if (existing) return existing;
  const dir = path.join(OFFICES_DIR, office.id);
  const backupDir = path.join(dir, 'backups');
  const tenant: Tenant = {
    id: office.id,
    db: new Database(IS_TEST ? ':memory:' : path.join(dir, 'handlemydesk.db'), { backupDir, firstAdmin }),
    uploadsDir: IS_TEST ? path.join(os.tmpdir(), 'handlemydesk-uploads-test', office.id) : path.join(dir, 'uploads'),
    backupDir,
  };
  tenants.set(office.id, tenant);
  return tenant;
}

const officeById = (id: string) => data.offices.find((o) => o.id === id);

export function getTenant(id: string): Tenant | undefined {
  const office = officeById(id);
  return office ? openTenant(office) : undefined;
}

export function officeName(id: string = currentTenant().id): string {
  return officeById(id)?.name ?? 'Office';
}

/** Every office, for hourly jobs (reminders, backups). */
export function allTenants(): Tenant[] {
  const list: Tenant[] = [];
  for (const office of data.offices) {
    try {
      list.push(openTenant(office));
    } catch (err) {
      console.error(`Could not open office ${office.id}:`, err);
    }
  }
  return list;
}

// Open them all at start-up so problems show in the log straight away
if (!IS_TEST) allTenants();

/** The office the request belongs to, for code that runs in callbacks (file uploads). */
export const tenantOf = (req: Request): Tenant => (req as any).tenant ?? currentTenant();

/**
 * Picks the office from the sign-in token and runs the rest of the request inside it.
 * The token is checked properly again by authMiddleware; this only chooses the database.
 */
export function tenantMiddleware(req: Request, res: Response, next: NextFunction): void {
  let tenant = MAIN_TENANT;
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    type Claims = { cid?: string; sup?: string; kind?: string };
    let claims: Claims | null = null;
    try {
      claims = jwt.verify(header.slice(7), JWT_SECRET) as Claims;
    } catch {
      // Invalid token: authMiddleware answers 401 on routes that need sign-in
    }
    if (claims && claims.kind !== 'owner') {
      const office = officeById(claims.cid ?? MAIN_TENANT_ID);
      if (!office) {
        res.status(401).json({ error: 'This office no longer exists.' });
        return;
      }
      if (office.status === 'suspended' && !claims.sup) {
        res.status(403).json({ error: 'This office is paused. Please contact HandleMyDesk.', code: 'OFFICE_SUSPENDED' });
        return;
      }
      tenant = openTenant(office);
    }
  }
  (req as any).tenant = tenant;
  runInTenant(tenant, () => next());
}

/**
 * Middleware such as file uploads finishes in a stream callback, which loses track of the office.
 * This puts the rest of the request back inside it.
 */
export function keepTenant(mw: RequestHandler): RequestHandler {
  return (req, res, next) => {
    const tenant = tenantOf(req);
    mw(req, res, (err?: unknown) => runInTenant(tenant, () => next(err as any)));
  };
}

// ==========================================
// SIGN-IN ACROSS OFFICES
// ==========================================

const emailOf = (u: { email: string }) => u.email.trim().toLowerCase();

export interface OfficeLogin {
  tenant: Tenant;
  user: User;
  officeName: string;
  suspended: boolean;
}

/**
 * People sign in with just email + password; this finds their office. The same email may exist in
 * several offices (offices never learn about each other's people), so every office whose account
 * matches both the email and the password is returned; usually that is exactly one.
 */
export async function findOfficeLogins(email: string, password: string): Promise<OfficeLogin[]> {
  const found: OfficeLogin[] = [];
  for (const office of data.offices) {
    let tenant: Tenant;
    try {
      tenant = openTenant(office);
    } catch {
      continue;
    }
    const user = tenant.db.getData().users.find((u) => u.id !== SUPPORT_USER_ID && emailOf(u) === email);
    const hash = user ? tenant.db.getPasswordHash(user.id) : null;
    if (user && hash && (await bcrypt.compare(password, hash))) found.push({ tenant, user, officeName: office.name, suspended: office.status === 'suspended' });
  }
  return found;
}

const profileOf = (o: OwnerRecord): OwnerProfile => ({ id: o.id, name: o.name, email: o.email });
const ownerToken = (o: OwnerRecord) => jwt.sign({ kind: 'owner', id: o.id, sv: o.sessionVersion }, JWT_SECRET, { expiresIn: '12h' });

export async function findOwnerLogin(email: string, password: string): Promise<{ token: string; owner: OwnerProfile } | null> {
  const owner = data.owners.find((o) => o.email === email);
  if (!owner || !(await bcrypt.compare(password, owner.passwordHash))) return null;
  return { token: ownerToken(owner), owner: profileOf(owner) };
}

interface OwnerRequest extends Request {
  owner?: OwnerRecord;
}

function ownerAuth(req: OwnerRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  try {
    if (!header?.startsWith('Bearer ')) throw new Error();
    const claims = jwt.verify(header.slice(7), JWT_SECRET) as { kind?: string; id?: string; sv?: number };
    const owner = claims.kind === 'owner' ? data.owners.find((o) => o.id === claims.id) : undefined;
    if (!owner || owner.sessionVersion !== (claims.sv ?? 0)) throw new Error();
    req.owner = owner;
    next();
  } catch {
    res.status(401).json({ error: 'Owner sign-in required' });
  }
}

// ==========================================
// HELPERS
// ==========================================

class PlatformError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Handler<R extends Request> = (req: R, res: Response) => unknown;
const handle =
  <R extends Request>(fn: Handler<R>) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve()
      .then(() => fn(req as R, res))
      .catch((err) => (err instanceof PlatformError ? res.status(err.status).json({ error: err.message }) : next(err)));

function text(value: unknown, label: string, max: number, required = false): string {
  const s = typeof value === 'string' ? value.trim() : '';
  if (required && !s) throw new PlatformError(400, `${label} is required`);
  if (s.length > max) throw new PlatformError(400, `${label} must be ${max} characters or fewer`);
  return s;
}

function logAction(owner: OwnerRecord, action: string, officeId?: string) {
  data.log.unshift({ id: newId('log'), at: now(), ownerName: owner.name, action, officeId, officeName: officeId ? officeName(officeId) : undefined });
  data.log.length = Math.min(data.log.length, LOG_KEEP);
}

function temporaryPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const chars = Array.from(crypto.randomBytes(12), (b) => alphabet[b % alphabet.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8).join('')}`;
}

function summarize(office: OfficeRecord): OfficeSummary {
  const d = openTenant(office).db.getData();
  const today = now().slice(0, 10);
  const people = d.users.filter((u) => u.id !== SUPPORT_USER_ID && u.active !== false);
  const openTasks = d.tasks.filter((t) => t.status !== 'done');
  let lastActivity: string | null = null;
  for (const a of d.activities) if (!lastActivity || a.timestamp > lastActivity) lastActivity = a.timestamp;
  return {
    id: office.id,
    name: office.name,
    status: office.status,
    notes: office.notes,
    createdAt: office.createdAt,
    people: people.length,
    admins: people.filter((u) => u.role === 'admin').map((u) => ({ id: u.id, name: u.name, email: u.email })),
    activeProjects: d.projects.filter((p) => p.status === 'active').length,
    openTasks: openTasks.length,
    overdueTasks: openTasks.filter((t) => t.dueDate && t.dueDate < today).length,
    lastActivity,
    openTickets: data.tickets.filter((t) => t.officeId === office.id && t.status === 'open').length,
  };
}

/** The support account inside the current office; (re)created when the owner goes in. */
function ensureSupportUser(): User {
  const users = db.getData().users;
  let user = users.find((u) => u.id === SUPPORT_USER_ID);
  if (!user) {
    user = {
      id: SUPPORT_USER_ID,
      name: 'HandleMyDesk Support',
      email: 'support@handlemydesk.app',
      avatar: '',
      role: 'admin',
      title: 'HandleMyDesk support',
      department: 'HandleMyDesk',
      status: 'active',
      phone: '',
      initials: initialsOf('HandleMyDesk Support'),
      active: true,
    };
    users.push(user);
  }
  user.role = 'admin';
  user.active = true;
  db.save();
  // Nobody can sign in to it with a password; access is only through the owner console
  if (!db.getPasswordHash(SUPPORT_USER_ID)) db.setPasswordHash(SUPPORT_USER_ID, bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10));
  return user;
}

export type Notifier = (
  userIds: Iterable<string>,
  actor: User | null,
  n: { title: string; message: string; type: NotificationItem['type']; kind: NotificationKind }
) => number;

// Tell an office's admins (once an hour at most) that support is working in their office
const lastVisitNotice = new Map<string, number>();

// Simple in-memory limiter for public requests: at most `max` per `windowMs` for each key
const hits = new Map<string, number[]>();
function rateLimited(key: string, max: number, windowMs: number): boolean {
  if (IS_TEST && key.startsWith('ip:')) return false;
  const nowMs = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => nowMs - t < windowMs);
  const limited = recent.length >= max;
  if (!limited) recent.push(nowMs);
  hits.set(key, recent);
  return limited;
}

// ==========================================
// ROUTES
// ==========================================

export function registerPlatformRoutes(app: express.Express, notify: Notifier) {
  /*
   * "Forgot password?" on the sign-in screen. There is no email yet, so the request goes to whoever
   * can reset it: the office's administrators (Team → Reset password), and for an administrator,
   * HandleMyDesk (owner console → Problems). The reply is always the same, so it never reveals
   * whether an email has an account.
   */
  app.post(
    '/api/auth/forgot',
    handle(async (req, res) => {
      const email = text(req.body?.email, 'Email', 200, true).toLowerCase();
      const answer = { ok: true };
      if (rateLimited(`email:${email}`, 1, 15 * 60 * 1000) || rateLimited(`ip:${req.ip}`, 20, 3600 * 1000)) {
        res.json(answer);
        return;
      }

      for (const office of data.offices) {
        if (office.status === 'suspended') continue;
        const tenant = openTenant(office);
        const person = tenant.db.getData().users.find((u) => u.id !== SUPPORT_USER_ID && u.active !== false && emailOf(u) === email);
        if (!person) continue;

        runInTenant(tenant, () => {
          const otherAdmins = db
            .getData()
            .users.filter((u) => u.role === 'admin' && u.active !== false && u.id !== person.id && u.id !== SUPPORT_USER_ID)
            .map((u) => u.id);
          if (otherAdmins.length) {
            notify(otherAdmins, null, {
              title: 'Password help needed',
              message: `${person.name} (${person.email}) can't sign in. Open Team, find them and choose Reset password, then give them the new password.`,
              type: 'warning',
              kind: 'password',
            });
            db.save();
          }
        });

        // Administrators (or offices without another admin) are reset by HandleMyDesk
        const alreadyAsked = data.tickets.some((t) => t.officeId === office.id && t.userId === person.id && t.category === 'password' && t.status === 'open');
        const hasOtherAdmin = tenant.db.getData().users.some((u) => u.role === 'admin' && u.active !== false && u.id !== person.id && u.id !== SUPPORT_USER_ID);
        if ((person.role === 'admin' || !hasOtherAdmin) && !alreadyAsked) {
          data.tickets.unshift({
            id: newId('tkt'),
            officeId: office.id,
            userId: person.id,
            userName: person.name,
            userEmail: person.email,
            category: 'password',
            subject: `Password reset for ${person.name}`,
            status: 'open',
            messages: [
              {
                id: newId('msg'),
                from: 'customer',
                name: person.name,
                text: `${person.name} (${person.role === 'admin' ? 'administrator' : person.role === 'pm' ? 'project manager' : 'member'}) used "Forgot password?" and can't sign in. Reset their password, then give them the new one by phone or message.`,
                at: now(),
              },
            ],
            createdAt: now(),
            updatedAt: now(),
            unreadByOwner: true,
            unreadByCustomer: false,
          });
          savePlatform();
        }
      }
      res.json(answer);
    })
  );

  // ----- Inside an office: which office am I in? -----
  app.get('/api/office', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
    res.json({ id: currentTenant().id, name: officeName(), supportVisit: req.user!.id === SUPPORT_USER_ID });
  });

  // ----- Inside an office: "Report a problem" -----
  const mine = (req: AuthenticatedRequest) =>
    data.tickets.filter((t) => t.officeId === currentTenant().id && t.userId === req.user!.id);

  app.get('/api/support/tickets', authMiddleware, (req: AuthenticatedRequest, res: Response) => {
    res.json(mine(req));
  });

  app.post(
    '/api/support/tickets',
    authMiddleware,
    handle<AuthenticatedRequest>((req, res) => {
      const user = req.user!;
      const body = req.body ?? {};
      const category: SupportCategory = ['people', 'technical', 'other'].includes(body.category) ? body.category : 'other';
      const subject = text(body.subject, 'Subject', 200, true);
      const message = text(body.message, 'Message', 5000, true);
      const ticket: SupportTicket = {
        id: newId('tkt'),
        officeId: currentTenant().id,
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        category,
        subject,
        status: 'open',
        messages: [{ id: newId('msg'), from: 'customer', name: user.name, text: message, at: now() }],
        createdAt: now(),
        updatedAt: now(),
        unreadByOwner: true,
        unreadByCustomer: false,
      };
      data.tickets.unshift(ticket);
      savePlatform();
      res.status(201).json(ticket);
    })
  );

  const myTicket = (req: AuthenticatedRequest) => {
    const ticket = mine(req).find((t) => t.id === String(req.params.id));
    if (!ticket) throw new PlatformError(404, 'Report not found');
    return ticket;
  };

  app.post(
    '/api/support/tickets/:id/messages',
    authMiddleware,
    handle<AuthenticatedRequest>((req, res) => {
      const ticket = myTicket(req);
      const msg: SupportMessage = { id: newId('msg'), from: 'customer', name: req.user!.name, text: text(req.body?.text, 'Message', 5000, true), at: now() };
      ticket.messages.push(msg);
      ticket.status = 'open';
      ticket.unreadByOwner = true;
      ticket.updatedAt = now();
      savePlatform();
      res.json(ticket);
    })
  );

  app.post(
    '/api/support/tickets/:id/read',
    authMiddleware,
    handle<AuthenticatedRequest>((req, res) => {
      const ticket = myTicket(req);
      ticket.unreadByCustomer = false;
      savePlatform();
      res.json(ticket);
    })
  );

  // ----- Owner console -----
  const owner = express.Router();
  owner.use(ownerAuth);

  owner.get('/me', (req: OwnerRequest, res) => res.json({ owner: profileOf(req.owner!) }));

  owner.post(
    '/password',
    handle<OwnerRequest>(async (req, res) => {
      const o = req.owner!;
      const { currentPassword, newPassword } = req.body ?? {};
      if (typeof newPassword !== 'string' || newPassword.length < 8) throw new PlatformError(400, 'New password must be at least 8 characters');
      if (typeof currentPassword !== 'string' || !(await bcrypt.compare(currentPassword, o.passwordHash))) throw new PlatformError(400, 'Current password is incorrect');
      o.passwordHash = await bcrypt.hash(newPassword, 10);
      o.sessionVersion++;
      logAction(o, 'changed their owner password');
      savePlatform();
      res.json({ token: ownerToken(o) });
    })
  );

  owner.get('/offices', (_req, res) => res.json(data.offices.map(summarize)));

  owner.post(
    '/offices',
    handle<OwnerRequest>(async (req, res) => {
      const body = req.body ?? {};
      const name = text(body.name, 'Office name', 200, true);
      const adminName = text(body.adminName, 'Administrator name', 200, true);
      const adminEmail = text(body.adminEmail, 'Administrator email', 200, true).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) throw new PlatformError(400, 'Enter a valid administrator email');
      if (data.offices.some((o) => o.name.toLowerCase() === name.toLowerCase())) throw new PlatformError(400, 'An office with that name already exists');
      // The owner may choose the administrator's password; otherwise a temporary one is made
      const chosen = typeof body.adminPassword === 'string' ? body.adminPassword : '';
      if (chosen && (chosen.length < 8 || chosen.length > 200)) throw new PlatformError(400, 'Password must be at least 8 characters');
      const password = chosen || temporaryPassword();
      const mustChange = !chosen || body.mustChangePassword !== false;

      const office: OfficeRecord = { id: newId('off'), name, status: 'active', notes: text(body.notes, 'Notes', 2000), createdAt: now() };
      openTenant(office, { name: adminName, email: adminEmail, password, mustChange });
      data.offices.push(office);
      logAction(req.owner!, `added the office "${name}" with administrator ${adminEmail}`, office.id);
      savePlatform();
      res.status(201).json({ office: summarize(office), adminEmail, temporaryPassword: password, mustChangePassword: mustChange });
    })
  );

  const findOffice = (req: Request) => {
    const office = officeById(String(req.params.id));
    if (!office) throw new PlatformError(404, 'Office not found');
    return office;
  };

  owner.put(
    '/offices/:id',
    handle<OwnerRequest>((req, res) => {
      const office = findOffice(req);
      const body = req.body ?? {};
      if (body.name !== undefined) {
        const name = text(body.name, 'Office name', 200, true);
        if (name !== office.name) logAction(req.owner!, `renamed "${office.name}" to "${name}"`, office.id);
        office.name = name;
      }
      if (body.notes !== undefined) office.notes = text(body.notes, 'Notes', 2000);
      if (body.status !== undefined) {
        if (body.status !== 'active' && body.status !== 'suspended') throw new PlatformError(400, 'Status must be active or suspended');
        if (body.status !== office.status) logAction(req.owner!, body.status === 'suspended' ? 'paused the office' : 'resumed the office', office.id);
        office.status = body.status;
      }
      savePlatform();
      res.json(summarize(office));
    })
  );

  // Go inside an office as HandleMyDesk support (an administrator there), to fix or maintain things
  owner.post(
    '/offices/:id/enter',
    handle<OwnerRequest>((req, res) => {
      const office = findOffice(req);
      const o = req.owner!;
      const tenant = openTenant(office);
      const token = runInTenant(tenant, () => {
        const user = ensureSupportUser();
        const last = lastVisitNotice.get(office.id) ?? 0;
        if (Date.now() - last > 3600 * 1000) {
          lastVisitNotice.set(office.id, Date.now());
          const admins = db.getData().users.filter((u) => u.role === 'admin' && u.id !== SUPPORT_USER_ID).map((u) => u.id);
          notify(admins, null, {
            title: 'HandleMyDesk support is in your office',
            message: `${o.name} from HandleMyDesk support opened your workspace to help or do maintenance.`,
            type: 'info',
            kind: 'support',
          });
          db.save();
        }
        return generateToken(user, { support: o.id });
      });
      logAction(o, 'went inside the office', office.id);
      savePlatform();
      res.json({ token, officeName: office.name });
    })
  );

  // Reset anyone's password inside an office (normally its administrator, who has nobody above them)
  owner.post(
    '/offices/:id/people/:userId/reset-password',
    handle<OwnerRequest>(async (req, res) => {
      const office = findOffice(req);
      const body = req.body ?? {};
      const chosen = typeof body.password === 'string' ? body.password : '';
      if (chosen && (chosen.length < 8 || chosen.length > 200)) throw new PlatformError(400, 'Password must be at least 8 characters');
      const password = chosen || temporaryPassword();
      const mustChange = !chosen || body.mustChangePassword !== false;

      const user = await runInTenant(openTenant(office), async () => {
        const person = db.getData().users.find((u) => u.id === String(req.params.userId) && u.id !== SUPPORT_USER_ID);
        if (!person) throw new PlatformError(404, 'Person not found');
        db.setPasswordHash(person.id, await bcrypt.hash(password, 10), { mustChange });
        // Signs them out everywhere, in case someone else had their password
        db.bumpSessionVersion(person.id);
        closeStreamsFor(person.id);
        return person;
      });

      // Their "Forgot password?" requests are now done
      for (const t of data.tickets) {
        if (t.officeId === office.id && t.userId === user.id && t.category === 'password' && t.status === 'open') {
          t.status = 'resolved';
          t.unreadByOwner = false;
          t.unreadByCustomer = true;
          t.updatedAt = now();
          t.messages.push({ id: newId('msg'), from: 'owner', name: `${req.owner!.name} (HandleMyDesk)`, text: 'Your password was reset.', at: now() });
        }
      }
      logAction(req.owner!, `reset the password of ${user.name} (${user.email})`, office.id);
      savePlatform();
      res.json({ name: user.name, email: user.email, temporaryPassword: password, mustChangePassword: mustChange });
    })
  );

  owner.get('/tickets', (_req, res) => {
    res.json(data.tickets.map((t) => ({ ...t, officeName: officeName(t.officeId) })));
  });

  const findTicket = (req: Request) => {
    const ticket = data.tickets.find((t) => t.id === String(req.params.id));
    if (!ticket) throw new PlatformError(404, 'Report not found');
    return ticket;
  };

  // Tell the person who reported it, inside their office
  const tellReporter = (ticket: SupportTicket, title: string) => {
    const tenant = getTenant(ticket.officeId);
    if (!tenant) return;
    runInTenant(tenant, () => {
      notify([ticket.userId], null, { title, message: ticket.subject, type: 'info', kind: 'support' });
      db.save();
    });
  };

  owner.post(
    '/tickets/:id/messages',
    handle<OwnerRequest>((req, res) => {
      const ticket = findTicket(req);
      ticket.messages.push({ id: newId('msg'), from: 'owner', name: `${req.owner!.name} (HandleMyDesk)`, text: text(req.body?.text, 'Message', 5000, true), at: now() });
      ticket.unreadByCustomer = true;
      ticket.unreadByOwner = false;
      ticket.updatedAt = now();
      logAction(req.owner!, `replied to "${ticket.subject}"`, ticket.officeId);
      savePlatform();
      tellReporter(ticket, 'HandleMyDesk support replied');
      res.json({ ...ticket, officeName: officeName(ticket.officeId) });
    })
  );

  owner.put(
    '/tickets/:id',
    handle<OwnerRequest>((req, res) => {
      const ticket = findTicket(req);
      const status = req.body?.status;
      if (status !== 'open' && status !== 'resolved') throw new PlatformError(400, 'Status must be open or resolved');
      if (status !== ticket.status) {
        ticket.status = status;
        ticket.updatedAt = now();
        logAction(req.owner!, `${status === 'resolved' ? 'resolved' : 'reopened'} "${ticket.subject}"`, ticket.officeId);
        if (status === 'resolved') {
          ticket.unreadByCustomer = true;
          tellReporter(ticket, 'Your report was marked resolved');
        }
      }
      savePlatform();
      res.json({ ...ticket, officeName: officeName(ticket.officeId) });
    })
  );

  owner.post(
    '/tickets/:id/read',
    handle<OwnerRequest>((req, res) => {
      const ticket = findTicket(req);
      ticket.unreadByOwner = false;
      savePlatform();
      res.json({ ...ticket, officeName: officeName(ticket.officeId) });
    })
  );

  owner.get('/log', (_req, res) => res.json(data.log.slice(0, 300)));

  app.use('/api/owner', owner);
}

/** Tests only: start over with just the main office and the development owner. */
export function resetPlatformForTests() {
  hits.clear();
  data.offices.splice(1);
  data.tickets.length = 0;
  data.log.length = 0;
  for (const id of [...tenants.keys()]) if (id !== MAIN_TENANT_ID) tenants.delete(id);
}
