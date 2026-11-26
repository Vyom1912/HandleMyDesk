import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server/index';
import { db } from '../src/server/db';
import { resetPlatformForTests } from '../src/server/platform';
import { as } from './helpers';

// The main office is the seeded demo company; the owner is the development owner account.
const OWNER = { email: 'owner@handlemydesk.internal', password: 'handlemydesk123' };
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function ownerToken(): Promise<string> {
  const res = await request(app).post('/api/auth/login').send(OWNER);
  expect(res.status).toBe(200);
  expect(res.body.kind).toBe('owner');
  return res.body.token;
}

/** Creates an office and signs its administrator in with a permanent password. */
async function newOffice(owner: string, name = 'Acme Studio', adminEmail = 'asha@acme.test') {
  const created = await request(app).post('/api/owner/offices').set(bearer(owner)).send({ name, adminName: 'Asha Rao', adminEmail });
  expect(created.status).toBe(201);
  const first = await request(app).post('/api/auth/login').send({ email: adminEmail, password: created.body.temporaryPassword });
  expect(first.status).toBe(200);
  expect(first.body.mustChangePassword).toBe(true);
  const changed = await request(app)
    .post('/api/auth/password')
    .set(bearer(first.body.token))
    .send({ currentPassword: created.body.temporaryPassword, newPassword: 'acme-secret-1' });
  expect(changed.status).toBe(200);
  return { officeId: created.body.office.id as string, admin: changed.body.token as string, adminId: first.body.user.id as string };
}

beforeEach(() => {
  db.resetToDefault();
  resetPlatformForTests();
});

describe('Offices: each customer company is walled off', () => {
  it('a new office starts empty and never sees the main office, and the reverse', async () => {
    const owner = await ownerToken();
    const acme = await newOffice(owner);

    expect((await request(app).get('/api/projects').set(bearer(acme.admin))).body).toEqual([]);
    expect((await request(app).get('/api/clients').set(bearer(acme.admin))).body).toEqual([]);
    const people = (await request(app).get('/api/employees').set(bearer(acme.admin))).body;
    expect(people.map((p: any) => p.email)).toEqual(['asha@acme.test']);
    // A main-office project id means nothing inside Acme
    expect((await request(app).get('/api/projects/prj-1').set(bearer(acme.admin))).status).toBe(404);

    const made = await request(app).post('/api/projects').set(bearer(acme.admin)).send({ name: 'Acme rebrand', clientName: 'Acme Retail' });
    expect(made.status).toBe(201);
    const mainProjects = (await request(app).get('/api/projects').set(as('emp-1'))).body;
    expect(mainProjects.some((p: any) => p.name === 'Acme rebrand')).toBe(false);
    expect(db.getData().clients.some((c) => c.name === 'Acme Retail')).toBe(false);
  });

  it("an office learns nothing about other offices' people: the same email can be used in two offices", async () => {
    const owner = await ownerToken();
    const acme = await newOffice(owner);
    const mainEmail = db.getData().users.find((u) => u.id === 'emp-5')!.email;

    // Allowed, so the answer gives nothing away; a duplicate inside the same office is still refused
    const copy = await request(app).post('/api/employees').set(bearer(acme.admin)).send({ name: 'Maya at Acme', email: mainEmail });
    expect(copy.status).toBe(201);
    expect((await request(app).post('/api/employees').set(bearer(acme.admin)).send({ name: 'Again', email: mainEmail })).status).toBe(400);

    // Different passwords: each password opens its own office
    const acmeFirst = await request(app).post('/api/auth/login').send({ email: mainEmail, password: copy.body.temporaryPassword });
    expect(acmeFirst.status).toBe(200);
    const acmeToken = (
      await request(app)
        .post('/api/auth/password')
        .set(bearer(acmeFirst.body.token))
        .send({ currentPassword: copy.body.temporaryPassword, newPassword: 'handlemydesk123' })
    ).body.token;
    expect((await request(app).get('/api/office').set(bearer(acmeToken))).body.name).toBe('Acme Studio');

    // Now the same email and password exist in both offices: the person chooses
    const both = await request(app).post('/api/auth/login').send({ email: mainEmail, password: 'handlemydesk123' });
    expect(both.status).toBe(409);
    expect(both.body.code).toBe('CHOOSE_OFFICE');
    expect(both.body.offices.map((o: any) => o.name).sort()).toEqual(['Acme Studio', 'Main office']);
    const chosen = await request(app).post('/api/auth/login').send({ email: mainEmail, password: 'handlemydesk123', officeId: 'main' });
    expect(chosen.status).toBe(200);
    expect((await request(app).get('/api/office').set(bearer(chosen.body.token))).body.id).toBe('main');
    // Someone without the password learns nothing
    expect((await request(app).post('/api/auth/login').send({ email: mainEmail, password: 'wrong-password' })).status).toBe(401);
  });

  it('owner tokens only open the owner console, and office tokens never open it', async () => {
    const owner = await ownerToken();
    expect((await request(app).get('/api/projects').set(bearer(owner))).status).toBe(401);
    expect((await request(app).get('/api/owner/offices').set(as('emp-1'))).status).toBe(401);
    const offices = (await request(app).get('/api/owner/offices').set(bearer(owner))).body;
    expect(offices[0]).toMatchObject({ id: 'main', status: 'active' });
    expect(offices[0].people).toBeGreaterThan(0);
  });

  it('the owner goes inside an office as support; its admins are told', async () => {
    const owner = await ownerToken();
    const acme = await newOffice(owner);
    const visit = await request(app).post(`/api/owner/offices/${acme.officeId}/enter`).set(bearer(owner));
    expect(visit.status).toBe(200);

    const office = await request(app).get('/api/office').set(bearer(visit.body.token));
    expect(office.body).toMatchObject({ id: acme.officeId, name: 'Acme Studio', supportVisit: true });
    // Works as an administrator there
    expect((await request(app).post('/api/projects').set(bearer(visit.body.token)).send({ name: 'Fix', clientName: 'Acme' })).status).toBe(201);

    const inbox = (await request(app).get('/api/notifications').set(bearer(acme.admin))).body;
    expect(inbox.some((n: any) => n.kind === 'support' && /support/.test(n.title))).toBe(true);
    const log = (await request(app).get('/api/owner/log').set(bearer(owner))).body;
    expect(log.some((l: any) => l.officeId === acme.officeId && l.action === 'went inside the office')).toBe(true);
  });

  it('a paused office cannot sign in, but support can still go in', async () => {
    const owner = await ownerToken();
    const acme = await newOffice(owner);
    expect((await request(app).put(`/api/owner/offices/${acme.officeId}`).set(bearer(owner)).send({ status: 'suspended' })).status).toBe(200);

    expect((await request(app).get('/api/projects').set(bearer(acme.admin))).status).toBe(403);
    expect((await request(app).post('/api/auth/login').send({ email: 'asha@acme.test', password: 'acme-secret-1' })).status).toBe(403);
    const visit = await request(app).post(`/api/owner/offices/${acme.officeId}/enter`).set(bearer(owner));
    expect((await request(app).get('/api/projects').set(bearer(visit.body.token))).status).toBe(200);

    await request(app).put(`/api/owner/offices/${acme.officeId}`).set(bearer(owner)).send({ status: 'active' });
    expect((await request(app).get('/api/projects').set(bearer(acme.admin))).status).toBe(200);
  });

  it('the support account cannot be signed in to with a password', async () => {
    const owner = await ownerToken();
    const acme = await newOffice(owner);
    await request(app).post(`/api/owner/offices/${acme.officeId}/enter`).set(bearer(owner));
    const reset = await request(app).post('/api/employees/hmd-support/reset-password').set(bearer(acme.admin));
    if (reset.status === 200) {
      const login = await request(app).post('/api/auth/login').send({ email: 'support@handlemydesk.app', password: reset.body.temporaryPassword });
      expect(login.status).toBe(401);
    }
  });
});

describe('Report a problem', () => {
  it('only the reporter and the owner see a report; owner replies reach the reporter', async () => {
    const owner = await ownerToken();
    const report = await request(app)
      .post('/api/support/tickets')
      .set(as('emp-5'))
      .send({ category: 'people', subject: 'Disagreement about deadlines', message: 'Please help us sort this out.' });
    expect(report.status).toBe(201);

    // Not visible to a colleague, even an admin of the same office
    expect((await request(app).get('/api/support/tickets').set(as('emp-1'))).body).toEqual([]);
    expect((await request(app).post(`/api/support/tickets/${report.body.id}/messages`).set(as('emp-1')).send({ text: 'x' })).status).toBe(404);

    const all = (await request(app).get('/api/owner/tickets').set(bearer(owner))).body;
    expect(all[0]).toMatchObject({ id: report.body.id, officeName: 'Main office', unreadByOwner: true, category: 'people' });

    const reply = await request(app).post(`/api/owner/tickets/${report.body.id}/messages`).set(bearer(owner)).send({ text: 'Calling you at 3 pm.' });
    expect(reply.status).toBe(200);
    const inbox = (await request(app).get('/api/notifications').set(as('emp-5'))).body;
    expect(inbox[0]).toMatchObject({ kind: 'support', title: 'HandleMyDesk support replied' });

    const mine = (await request(app).get('/api/support/tickets').set(as('emp-5'))).body;
    expect(mine[0].messages.map((m: any) => m.from)).toEqual(['customer', 'owner']);
    expect(mine[0].unreadByCustomer).toBe(true);

    const resolved = await request(app).put(`/api/owner/tickets/${report.body.id}`).set(bearer(owner)).send({ status: 'resolved' });
    expect(resolved.body.status).toBe('resolved');
  });

  it("another office's people never see the report", async () => {
    const owner = await ownerToken();
    await request(app).post('/api/support/tickets').set(as('emp-5')).send({ subject: 'Login trouble', message: 'Cannot upload files' });
    const acme = await newOffice(owner);
    expect((await request(app).get('/api/support/tickets').set(bearer(acme.admin))).body).toEqual([]);
  });
});
