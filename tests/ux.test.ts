import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server/index';
import { db } from '../src/server/db';
import { resetPlatformForTests } from '../src/server/platform';
import { setMailSenderForTests, Mail, parseFrom } from '../src/server/mail';
import { as } from './helpers';

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const login = (email: string, password: string) => request(app).post('/api/auth/login').send({ email, password });
const png = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b40000000049454e44ae426082',
  'hex'
);

let outbox: Mail[] = [];
beforeEach(() => {
  db.resetToDefault();
  resetPlatformForTests();
  outbox = [];
});
afterEach(() => setMailSenderForTests(null));

const linkToken = (mail: Mail) => mail.text.match(/#\/reset\/([\w-]+)/)![1];

describe('Forgot password by email', () => {
  it('emails a one-time link; the person chooses a new password and old sessions end', async () => {
    setMailSenderForTests(async (m) => void outbox.push(m));
    const maya = db.getData().users.find((u) => u.id === 'emp-5')!;
    const oldSession = (await login(maya.email, 'handlemydesk123')).body.token;

    const asked = await request(app).post('/api/auth/forgot').send({ email: maya.email });
    expect(asked.body).toEqual({ ok: true, via: 'email' });
    expect(outbox).toHaveLength(1);
    expect(outbox[0].to).toBe(maya.email);
    expect(outbox[0].text).toContain('http://localhost:5173/?office=');
    // Email instead of bothering the admins
    const inbox = (await request(app).get('/api/notifications').set(as('emp-1'))).body;
    expect(inbox.filter((n: any) => n.kind === 'password')).toHaveLength(0);

    const token = linkToken(outbox[0]);
    const check = await request(app).post('/api/auth/reset/check').send({ token });
    expect(check.body).toMatchObject({ name: maya.name, email: maya.email });

    expect((await request(app).post('/api/auth/reset').send({ token, password: 'short' })).status).toBe(400);
    const done = await request(app).post('/api/auth/reset').send({ token, password: 'brand-new-pass-1' });
    expect(done.body).toMatchObject({ ok: true, email: maya.email, officeId: 'main' });

    const signIn = await login(maya.email, 'brand-new-pass-1');
    expect(signIn.status).toBe(200);
    expect(signIn.body.mustChangePassword).toBe(false);
    expect((await request(app).get('/api/projects').set(bearer(oldSession))).status).toBe(401);
    // Works once
    expect((await request(app).post('/api/auth/reset').send({ token, password: 'another-pass-1' })).status).toBe(400);
  });

  it('gives the same answer for unknown emails, sends nothing, and rejects made-up links', async () => {
    setMailSenderForTests(async (m) => void outbox.push(m));
    const res = await request(app).post('/api/auth/forgot').send({ email: 'nobody@nowhere.test' });
    expect(res.body).toEqual({ ok: true, via: 'email' });
    expect(outbox).toHaveLength(0);
    expect((await request(app).post('/api/auth/reset/check').send({ token: 'x'.repeat(43) })).status).toBe(400);
  });

  it('falls back to asking the administrators when the email cannot be sent', async () => {
    setMailSenderForTests(async () => {
      throw new Error('mail service down');
    });
    const maya = db.getData().users.find((u) => u.id === 'emp-5')!;
    await request(app).post('/api/auth/forgot').send({ email: maya.email });
    const inbox = (await request(app).get('/api/notifications').set(as('emp-1'))).body;
    expect(inbox.filter((n: any) => n.kind === 'password')).toHaveLength(1);
  });

  it('reads the sender name and address from MAIL_FROM (for Brevo)', () => {
    expect(parseFrom('HandleMyDesk <noreply@acme.com>')).toEqual({ name: 'HandleMyDesk', email: 'noreply@acme.com' });
    expect(parseFrom('"Acme Support" <help@acme.com>')).toEqual({ name: 'Acme Support', email: 'help@acme.com' });
    expect(parseFrom('plain@acme.com')).toEqual({ email: 'plain@acme.com' });
  });

  it('says help comes from an administrator when email is not set up', async () => {
    const res = await request(app).post('/api/auth/forgot').send({ email: 'nobody@nowhere.test' });
    expect(res.body).toEqual({ ok: true, via: 'admin' });
  });
});

describe('Office branding', () => {
  it('an administrator sets the colour, logo and sign-in link; the sign-in page can read them', async () => {
    const office = (await request(app).get('/api/office').set(as('emp-1'))).body;
    expect(office.slug).toMatch(/^[a-z0-9-]+$/);

    const set = await request(app).put('/api/office/brand').set(as('emp-1')).send({ color: '#0F766E', slug: 'acme-builders' });
    expect(set.body).toMatchObject({ color: '#0f766e', slug: 'acme-builders' });

    const logo = await request(app).post('/api/office/brand/logo').set(as('emp-1')).attach('logo', png, { filename: 'logo.png', contentType: 'image/png' });
    expect(logo.status).toBe(200);
    expect(logo.body.logoUrl).toMatch(/^\/api\/brand-logo\/main\/[0-9a-f-]{36}\.png$/);

    // Public, for the sign-in page
    const brand = await request(app).get('/api/brand/acme-builders');
    expect(brand.body).toMatchObject({ slug: 'acme-builders', color: '#0f766e', logoUrl: logo.body.logoUrl });
    expect((await request(app).get(logo.body.logoUrl)).status).toBe(200);
    expect((await request(app).get('/api/brand/no-such-office')).status).toBe(404);

    const removed = await request(app).delete('/api/office/brand/logo').set(as('emp-1'));
    expect(removed.body.logoUrl).toBeUndefined();
    expect((await request(app).get(logo.body.logoUrl)).status).toBe(404);
  });

  it('only administrators can change it, and values are checked', async () => {
    expect((await request(app).put('/api/office/brand').set(as('emp-5')).send({ color: '#000000' })).status).toBe(403);
    expect((await request(app).post('/api/office/brand/logo').set(as('emp-5')).attach('logo', png, { filename: 'l.png', contentType: 'image/png' })).status).toBe(403);
    expect((await request(app).put('/api/office/brand').set(as('emp-1')).send({ color: 'red' })).status).toBe(400);
    expect((await request(app).put('/api/office/brand').set(as('emp-1')).send({ slug: 'Not Valid!' })).status).toBe(400);
    const svg = await request(app).post('/api/office/brand/logo').set(as('emp-1')).attach('logo', Buffer.from('<svg/>'), { filename: 'l.svg', contentType: 'image/svg+xml' });
    expect(svg.status).toBe(400);
  });

  it('new offices get their own sign-in link name', async () => {
    const owner = (await login('owner@handlemydesk.internal', 'handlemydesk123')).body.token;
    const res = await request(app).post('/api/owner/offices').set(bearer(owner)).send({ name: 'Acme Builders & Sons', adminName: 'A', adminEmail: 'a@acme.test' });
    expect(res.body.office.slug).toBe('acme-builders-sons');
    // Another office can't take it
    const sol = await request(app).post('/api/owner/offices').set(bearer(owner)).send({ name: 'Solo', adminName: 'S', adminEmail: 's@solo.test', adminPassword: 'sol-pass-123', mustChangePassword: false });
    const solToken = (await login('s@solo.test', 'sol-pass-123')).body.token;
    expect(sol.status).toBe(201);
    expect((await request(app).put('/api/office/brand').set(bearer(solToken)).send({ slug: 'acme-builders-sons' })).status).toBe(400);
  });
});

describe('Exports for administrators', () => {
  it('downloads the office activity, filtered by date, as a spreadsheet', async () => {
    const res = await request(app).get('/api/admin/export/activity.csv?tz=Asia/Kolkata').set(as('emp-1'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toContain('Time (Asia/Kolkata)');
    expect(lines.length).toBeGreaterThan(1);

    const none = await request(app).get('/api/admin/export/activity.csv?from=2999-01-01').set(as('emp-1'));
    expect(none.text.trim().split('\r\n')).toHaveLength(1);
    expect((await request(app).get('/api/admin/export/activity.csv').set(as('emp-5'))).status).toBe(403);
  });

  it('downloads the people list with their workload', async () => {
    const res = await request(app).get('/api/admin/export/people.csv').set(as('emp-1'));
    expect(res.status).toBe(200);
    expect(res.text).toContain('Open tasks');
    expect(res.text).toContain('maya.patel@');
    expect((await request(app).get('/api/admin/export/people.csv').set(as('emp-5'))).status).toBe(403);
  });
});

describe('Project team', () => {
  const memberIds = (p: any) => new Set<string>([p.leadId, ...p.teamMemberIds]);

  it('an administrator adds someone from the office to a project, and they can then open it', async () => {
    const data = db.getData();
    const project = data.projects[0];
    const outsider = data.users.find((u) => u.role === 'member' && u.active !== false && !memberIds(project).has(u.id))!;
    expect(outsider).toBeDefined();
    expect((await request(app).get(`/api/projects/${project.id}`).set(as(outsider.id))).status).toBe(403);

    const res = await request(app).post(`/api/projects/${project.id}/team`).set(as('emp-1')).send({ employeeId: outsider.id });
    expect(res.status).toBe(200);
    expect(res.body.map((u: any) => u.id)).toContain(outsider.id);
    expect((await request(app).get(`/api/projects/${project.id}`).set(as(outsider.id))).status).toBe(200);
    const inbox = (await request(app).get('/api/notifications').set(as(outsider.id))).body;
    expect(inbox.some((n: any) => n.kind === 'team' && n.message.includes(project.name))).toBe(true);

    // Removing them takes the access away again
    expect((await request(app).delete(`/api/projects/${project.id}/team/${outsider.id}`).set(as('emp-1'))).status).toBe(200);
    expect((await request(app).get(`/api/projects/${project.id}`).set(as(outsider.id))).status).toBe(403);
  });

  it('only the project lead or an administrator can change the team', async () => {
    const data = db.getData();
    const project = data.projects.find((p) => data.users.some((u) => u.role === 'member' && p.teamMemberIds.includes(u.id)))!;
    const member = data.users.find((u) => u.role === 'member' && project.teamMemberIds.includes(u.id))!;
    const outsider = data.users.find((u) => u.active !== false && !memberIds(project).has(u.id))!;
    expect((await request(app).post(`/api/projects/${project.id}/team`).set(as(member.id)).send({ employeeId: outsider.id })).status).toBe(403);
    const lead = data.users.find((u) => u.id === project.leadId)!;
    if (lead.role === 'pm') {
      expect((await request(app).post(`/api/projects/${project.id}/team`).set(as(lead.id)).send({ employeeId: outsider.id })).status).toBe(200);
    }
  });

  it('refuses deactivated people and the HandleMyDesk support account, which offices never see', async () => {
    const data = db.getData();
    const project = data.projects[0];
    const someone = data.users.find((u) => u.role === 'member' && !memberIds(project).has(u.id))!;
    someone.active = false;
    db.save();
    expect((await request(app).post(`/api/projects/${project.id}/team`).set(as('emp-1')).send({ employeeId: someone.id })).status).toBe(400);

    const owner = (await login('owner@handlemydesk.internal', 'handlemydesk123')).body.token;
    await request(app).post('/api/owner/offices/main/enter').set(bearer(owner));
    expect(db.getData().users.some((u) => u.id === 'hmd-support')).toBe(true);
    const people = (await request(app).get('/api/employees').set(as('emp-1'))).body;
    expect(people.some((u: any) => u.id === 'hmd-support')).toBe(false);
    expect((await request(app).post(`/api/projects/${project.id}/team`).set(as('emp-1')).send({ employeeId: 'hmd-support' })).status).toBe(404);
  });
});
