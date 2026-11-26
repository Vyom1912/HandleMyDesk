import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server/index';
import { db, runInTenant, MAIN_TENANT, requireOfficeContext, NoOfficeError } from '../src/server/db';
import { generateToken } from '../src/server/auth';
import { resetPlatformForTests } from '../src/server/platform';

/*
 * The real server refuses any work that has lost track of its office (instead of quietly using the
 * main office). These requests run in that strict mode: if any part of a request lost its office
 * (for example inside a file-upload callback), it would fail here with a 500.
 */

const main = <T>(fn: () => T) => runInTenant(MAIN_TENANT, fn);
const as = (userId: string) => main(() => ({ Authorization: `Bearer ${generateToken(db.getData().users.find((u) => u.id === userId)!)}` }));
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b40000000049454e44ae426082',
  'hex'
);

beforeAll(() => requireOfficeContext(true));
afterAll(() => requireOfficeContext(false));
beforeEach(() => {
  main(() => db.resetToDefault());
  resetPlatformForTests();
});

describe('Strict office mode', () => {
  it('refuses data access that does not know its office', () => {
    expect(() => db.getData()).toThrow(NoOfficeError);
    expect(main(() => db.getData().users.length)).toBeGreaterThan(0);
  });

  it('everyday requests, uploads and the owner console all keep their office', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: 'maya.patel@handlemydesk.internal', password: 'handlemydesk123' });
    expect(login.status).toBe(200);
    expect((await request(app).get('/api/projects').set(bearer(login.body.token))).status).toBe(200);
    expect((await request(app).get('/api/notifications?limit=20').set(bearer(login.body.token))).status).toBe(200);

    const admin = as('emp-1');
    const project = await request(app).post('/api/projects').set(admin).send({ name: 'Strict check', clientName: 'Strict Co' });
    expect(project.status).toBe(201);
    const task = await request(app).post(`/api/projects/${project.body.id}/tasks`).set(admin).send({ title: 'Do it', assigneeId: 'emp-1' });
    expect(task.status).toBe(201);
    expect(
      (await request(app).post(`/api/projects/${project.body.id}/files`).set(admin).attach('file', PNG, { filename: 'a.png', contentType: 'image/png' })).status
    ).toBe(201);
    const avatar = await request(app).post('/api/auth/me/avatar').set(admin).attach('avatar', PNG, { filename: 'me.png', contentType: 'image/png' });
    expect(avatar.status).toBe(200);
    expect((await request(app).get(avatar.body.avatar)).status).toBe(200);
    expect((await request(app).post('/api/support/tickets').set(admin).send({ subject: 'Help', message: 'Please' })).status).toBe(201);

    const owner = (await request(app).post('/api/auth/login').send({ email: 'owner@handlemydesk.internal', password: 'handlemydesk123' })).body.token;
    const office = await request(app).post('/api/owner/offices').set(bearer(owner)).send({ name: 'Strict Office', adminName: 'Sam', adminEmail: 'sam@strict.test' });
    expect(office.status).toBe(201);
    const visit = await request(app).post(`/api/owner/offices/${office.body.office.id}/enter`).set(bearer(owner));
    expect(visit.status).toBe(200);
    const inside = await request(app).post('/api/projects').set(bearer(visit.body.token)).send({ name: 'Inside', clientName: 'Them' });
    expect(inside.status).toBe(201);
    expect(
      (await request(app).post(`/api/projects/${inside.body.id}/files`).set(bearer(visit.body.token)).attach('file', PNG, { filename: 'b.png', contentType: 'image/png' })).status
    ).toBe(201);
    expect((await request(app).get('/api/owner/offices').set(bearer(owner))).status).toBe(200);
  });
});
