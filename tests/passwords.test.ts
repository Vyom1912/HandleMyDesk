import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server/index';
import { db } from '../src/server/db';
import { resetPlatformForTests } from '../src/server/platform';
import { as } from './helpers';

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const login = (email: string, password: string) => request(app).post('/api/auth/login').send({ email, password });
const ownerToken = async () => (await login('owner@handlemydesk.internal', 'handlemydesk123')).body.token as string;

beforeEach(() => {
  db.resetToDefault();
  resetPlatformForTests();
});

describe('Choosing passwords', () => {
  it('the owner sets the new office administrator’s password, and can let them keep it', async () => {
    const owner = await ownerToken();
    const kept = await request(app)
      .post('/api/owner/offices')
      .set(bearer(owner))
      .send({ name: 'Kept Co', adminName: 'Kim', adminEmail: 'kim@kept.test', adminPassword: 'chosen-pass-1', mustChangePassword: false });
    expect(kept.status).toBe(201);
    expect(kept.body).toMatchObject({ temporaryPassword: 'chosen-pass-1', mustChangePassword: false });
    const signIn = await login('kim@kept.test', 'chosen-pass-1');
    expect(signIn.status).toBe(200);
    expect(signIn.body.mustChangePassword).toBe(false);

    // Chosen but must change; and too short
    const change = await request(app).post('/api/owner/offices').set(bearer(owner)).send({ name: 'Change Co', adminName: 'Cy', adminEmail: 'cy@change.test', adminPassword: 'chosen-pass-2' });
    expect(change.body.mustChangePassword).toBe(true);
    expect((await login('cy@change.test', 'chosen-pass-2')).body.mustChangePassword).toBe(true);
    expect((await request(app).post('/api/owner/offices').set(bearer(owner)).send({ name: 'Short', adminName: 'S', adminEmail: 's@s.test', adminPassword: 'short' })).status).toBe(400);
  });

  it('an office administrator sets a new person’s password, or gets a temporary one', async () => {
    const chosen = await request(app).post('/api/employees').set(as('emp-1')).send({ name: 'Priya', email: 'priya@x.test', password: 'priya-pass-1', mustChangePassword: false });
    expect(chosen.status).toBe(201);
    expect((await login('priya@x.test', 'priya-pass-1')).body.mustChangePassword).toBe(false);

    const generated = await request(app).post('/api/employees').set(as('emp-1')).send({ name: 'Ravi', email: 'ravi@x.test', mustChangePassword: false });
    // A generated password is always temporary
    expect(generated.body.mustChangePassword).toBe(true);
    expect((await request(app).post('/api/employees').set(as('emp-1')).send({ name: 'Tiny', email: 'tiny@x.test', password: '123' })).status).toBe(400);
  });
});

describe('Forgot password', () => {
  it('asks the office administrators to reset a member, and never reveals whether an email exists', async () => {
    const maya = db.getData().users.find((u) => u.id === 'emp-5')!;
    const known = await request(app).post('/api/auth/forgot').send({ email: maya.email });
    const unknown = await request(app).post('/api/auth/forgot').send({ email: 'nobody@nowhere.test' });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual(unknown.body);

    const adminInbox = (await request(app).get('/api/notifications').set(as('emp-1'))).body;
    expect(adminInbox.filter((n: any) => n.kind === 'password' && n.message.includes(maya.email))).toHaveLength(1);

    // Asking again straight away doesn't flood the admins
    await request(app).post('/api/auth/forgot').send({ email: maya.email });
    const again = (await request(app).get('/api/notifications').set(as('emp-1'))).body;
    expect(again.filter((n: any) => n.kind === 'password')).toHaveLength(1);

    // The admin resets it from Team
    const reset = await request(app).post('/api/employees/emp-5/reset-password').set(as('emp-1'));
    expect((await login(maya.email, reset.body.temporaryPassword)).status).toBe(200);
  });

  it('an office administrator who forgot goes to HandleMyDesk; the owner resets it and old sessions end', async () => {
    const owner = await ownerToken();
    await request(app).post('/api/owner/offices').set(bearer(owner)).send({ name: 'Solo Co', adminName: 'Sol', adminEmail: 'sol@solo.test', adminPassword: 'sol-pass-123', mustChangePassword: false });
    const oldSession = (await login('sol@solo.test', 'sol-pass-123')).body.token;

    await request(app).post('/api/auth/forgot').send({ email: 'sol@solo.test' });
    const tickets = (await request(app).get('/api/owner/tickets').set(bearer(owner))).body;
    const ticket = tickets.find((t: any) => t.category === 'password');
    expect(ticket).toMatchObject({ userEmail: 'sol@solo.test', officeName: 'Solo Co', status: 'open', unreadByOwner: true });

    const reset = await request(app)
      .post(`/api/owner/offices/${ticket.officeId}/people/${ticket.userId}/reset-password`)
      .set(bearer(owner))
      .send({ password: 'sol-new-pass-1', mustChangePassword: false });
    expect(reset.status).toBe(200);
    expect((await request(app).get('/api/projects').set(bearer(oldSession))).status).toBe(401);
    expect((await login('sol@solo.test', 'sol-pass-123')).status).toBe(401);
    expect((await login('sol@solo.test', 'sol-new-pass-1')).status).toBe(200);

    const after = (await request(app).get('/api/owner/tickets').set(bearer(owner))).body.find((t: any) => t.id === ticket.id);
    expect(after.status).toBe('resolved');
    const log = (await request(app).get('/api/owner/log').set(bearer(owner))).body;
    expect(log.some((l: any) => /reset the password of Sol/.test(l.action))).toBe(true);
  });

  it('owner reset only works for people in that office', async () => {
    const owner = await ownerToken();
    const office = await request(app).post('/api/owner/offices').set(bearer(owner)).send({ name: 'Other Co', adminName: 'O', adminEmail: 'o@other.test' });
    // emp-5 lives in the main office, not in Other Co
    expect((await request(app).post(`/api/owner/offices/${office.body.office.id}/people/emp-5/reset-password`).set(bearer(owner))).status).toBe(404);
    expect((await request(app).post('/api/owner/offices/main/people/hmd-support/reset-password').set(bearer(owner))).status).toBe(404);
  });
});
