import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { app } from '../src/server/index';
import { db, SEED_PASSWORD } from '../src/server/db';
import { BACKUP_DIR } from '../src/server/paths';
import { as } from './helpers';

// emp-1 is the only admin in the seed data; emp-2 is a PM; emp-5 is a member.

beforeEach(() => {
  db.resetToDefault();
});

const login = (email: string, password: string) => request(app).post('/api/auth/login').send({ email, password });
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const email = (id: string) => db.getData().users.find((u) => u.id === id)!.email;

async function addPerson(overrides: Record<string, string> = {}) {
  const res = await request(app)
    .post('/api/employees')
    .set(as('emp-1'))
    .send({ name: 'Nina Okafor', email: 'nina.okafor@handlemydesk.internal', title: 'Designer', department: 'Design', role: 'member', ...overrides });
  return res;
}

describe('Adding people', () => {
  it('lets an admin add someone, who must set their own password on first sign-in', async () => {
    const created = await addPerson();
    expect(created.status).toBe(201);
    expect(created.body.temporaryPassword).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);

    const first = await login('nina.okafor@handlemydesk.internal', created.body.temporaryPassword);
    expect(first.status).toBe(200);
    expect(first.body.mustChangePassword).toBe(true);

    // Until the password is changed, only the change-password flow works
    const blocked = await request(app).get('/api/projects').set(bearer(first.body.token));
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await request(app).get('/api/auth/me').set(bearer(first.body.token))).body.mustChangePassword).toBe(true);

    const changed = await request(app)
      .post('/api/auth/password')
      .set(bearer(first.body.token))
      .send({ currentPassword: created.body.temporaryPassword, newPassword: 'my-own-password' });
    expect(changed.status).toBe(200);
    expect((await request(app).get('/api/projects').set(bearer(changed.body.token))).status).toBe(200);
  });

  it('only admins can add people, and emails must be unique', async () => {
    const asPm = await request(app).post('/api/employees').set(as('emp-2')).send({ name: 'X', email: 'x@y.zz' });
    expect(asPm.status).toBe(403);
    const duplicate = await addPerson({ email: email('emp-5').toUpperCase() });
    expect(duplicate.status).toBe(400);
  });

  it('renaming someone updates their name on projects and tasks', async () => {
    const res = await request(app).put('/api/employees/emp-3').set(as('emp-1')).send({ name: 'Elena Rostova-Kim' });
    expect(res.status).toBe(200);
    expect(db.getData().projects.find((p) => p.leadId === 'emp-3')!.leadName).toBe('Elena Rostova-Kim');
  });
});

describe('Deactivating people', () => {
  it('signs them out immediately and blocks future sign-ins', async () => {
    const session = await login(email('emp-5'), SEED_PASSWORD);
    expect((await request(app).post('/api/employees/emp-5/deactivate').set(as('emp-1'))).status).toBe(200);

    expect((await request(app).get('/api/workspace').set(bearer(session.body.token))).status).toBe(401);
    expect((await login(email('emp-5'), SEED_PASSWORD)).status).toBe(403);

    await request(app).post('/api/employees/emp-5/reactivate').set(as('emp-1'));
    expect((await login(email('emp-5'), SEED_PASSWORD)).status).toBe(200);
  });

  it('never leaves the office without an administrator', async () => {
    expect((await request(app).post('/api/employees/emp-1/deactivate').set(as('emp-1'))).status).toBe(400);
    expect((await request(app).put('/api/employees/emp-1').set(as('emp-1')).send({ role: 'member' })).status).toBe(400);

    // Once there is a second admin, the first can step down
    await request(app).put('/api/employees/emp-2').set(as('emp-1')).send({ role: 'admin' });
    expect((await request(app).put('/api/employees/emp-1').set(as('emp-2')).send({ role: 'pm' })).status).toBe(200);
  });
});

describe('Ending sessions', () => {
  it('a password reset by an admin signs the person out everywhere', async () => {
    const session = await login(email('emp-5'), SEED_PASSWORD);
    const reset = await request(app).post('/api/employees/emp-5/reset-password').set(as('emp-1'));
    expect(reset.status).toBe(200);
    expect((await request(app).get('/api/workspace').set(bearer(session.body.token))).status).toBe(401);

    const next = await login(email('emp-5'), reset.body.temporaryPassword);
    expect(next.body.mustChangePassword).toBe(true);
  });

  it('changing your password ends your other sessions but keeps this one', async () => {
    const phone = await login(email('emp-5'), SEED_PASSWORD);
    const laptop = await login(email('emp-5'), SEED_PASSWORD);
    const changed = await request(app)
      .post('/api/auth/password')
      .set(bearer(laptop.body.token))
      .send({ currentPassword: SEED_PASSWORD, newPassword: 'a-better-password' });

    expect((await request(app).get('/api/workspace').set(bearer(phone.body.token))).status).toBe(401);
    expect((await request(app).get('/api/workspace').set(bearer(changed.body.token))).status).toBe(200);
  });

  it('"sign out everywhere" ends every session', async () => {
    const a = await login(email('emp-5'), SEED_PASSWORD);
    const b = await login(email('emp-5'), SEED_PASSWORD);
    await request(app).post('/api/auth/logout-all').set(bearer(a.body.token));
    expect((await request(app).get('/api/workspace').set(bearer(a.body.token))).status).toBe(401);
    expect((await request(app).get('/api/workspace').set(bearer(b.body.token))).status).toBe(401);
  });
});

describe('Backups', () => {
  it('admins can take, list and download a backup; others cannot', async () => {
    expect((await request(app).post('/api/admin/backups').set(as('emp-5'))).status).toBe(403);

    const made = await request(app).post('/api/admin/backups').set(as('emp-1'));
    expect(made.status).toBe(201);
    expect(fs.existsSync(path.join(BACKUP_DIR, made.body.name))).toBe(true);

    const list = await request(app).get('/api/admin/backups').set(as('emp-1'));
    expect(list.body.backups.some((b: any) => b.name === made.body.name)).toBe(true);

    const file = await request(app).get(`/api/admin/backups/${made.body.name}/download`).set(as('emp-1'));
    expect(file.status).toBe(200);

    // Names are checked, so the download route cannot read other files
    expect((await request(app).get('/api/admin/backups/..%2F..%2Fpackage.json/download').set(as('emp-1'))).status).toBe(400);
  });
});

describe('Security headers', () => {
  it('sends a content security policy and related headers', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
