import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server/index';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { db, Database, SEED_PASSWORD } from '../src/server/db';
import { as } from './helpers';

// Seed facts used below:
// prj-1 is led by emp-3 (PM); emp-2 is a PM on its team but not the lead; emp-5 is a member on the team.
// prj-8 is restricted; emp-5 is not on it. emp-1 is the admin.

beforeEach(() => {
  db.resetToDefault();
});

const email = (id: string) => db.getData().users.find((u) => u.id === id)!.email;

describe('Authentication', () => {
  it('rejects requests without a token, and ignores the old x-user-id header', async () => {
    expect((await request(app).get('/api/workspace')).status).toBe(401);
    expect((await request(app).get('/api/workspace').set('x-user-id', 'emp-1')).status).toBe(401);
  });

  it('rejects a forged token', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });

  it('signs in with email and password and returns a working token', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: email('emp-5'), password: SEED_PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.user.id).toBe('emp-5');

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${login.body.token}`);
    expect(me.body.user.id).toBe('emp-5');
  });

  it('rejects a wrong password and an unknown email with the same message', async () => {
    const wrong = await request(app).post('/api/auth/login').send({ email: email('emp-1'), password: 'nope' });
    const unknown = await request(app).post('/api/auth/login').send({ email: 'x@y.z', password: 'nope' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error).toBe(unknown.body.error);
  });

  it('changes password: old one stops working, new one works', async () => {
    const change = await request(app)
      .post('/api/auth/password')
      .set(as('emp-5'))
      .send({ currentPassword: SEED_PASSWORD, newPassword: 'brand-new-pass' });
    expect(change.status).toBe(200);

    const oldLogin = await request(app).post('/api/auth/login').send({ email: email('emp-5'), password: SEED_PASSWORD });
    const newLogin = await request(app).post('/api/auth/login').send({ email: email('emp-5'), password: 'brand-new-pass' });
    expect(oldLogin.status).toBe(401);
    expect(newLogin.status).toBe(200);
  });

  it('only lets an admin reset the database', async () => {
    expect((await request(app).post('/api/system/reset')).status).toBe(401);
    expect((await request(app).post('/api/system/reset').set(as('emp-5'))).status).toBe(403);
    expect((await request(app).post('/api/system/reset').set(as('emp-1'))).status).toBe(200);
  });
});

describe('Authorization rules', () => {
  it('a PM on the team who is not the lead cannot edit project settings', async () => {
    const res = await request(app).put('/api/projects/prj-1').set(as('emp-2')).send({ name: 'Hijacked' });
    expect(res.status).toBe(403);
    const lead = await request(app).put('/api/projects/prj-1').set(as('emp-3')).send({ name: 'Renamed' });
    expect(lead.status).toBe(200);
    expect(lead.body.name).toBe('Renamed');
  });

  it('client updates only accept known fields', async () => {
    const before = db.getData().clients[0];
    const res = await request(app)
      .put(`/api/clients/${before.id}`)
      .set(as('emp-2'))
      .send({ id: 'cli-hacked', totalBilled: 1, notes: 'updated' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(before.id);
    expect(res.body.notes).toBe('updated');
    // totalBilled is admin-only
    expect(res.body.totalBilled).toBe(before.totalBilled);
  });

  it('users cannot mark other people’s notifications as read', async () => {
    const othersNotif = db.getData().notifications.find((n) => n.userId === 'emp-1')!;
    const res = await request(app).post(`/api/notifications/${othersNotif.id}/read`).set(as('emp-5'));
    expect(res.status).toBe(404);
    expect(db.getData().notifications.find((n) => n.id === othersNotif.id)!.read).toBe(false);
  });

  it('rejects links with non-http URLs', async () => {
    const res = await request(app)
      .post('/api/projects/prj-1/links')
      .set(as('emp-5'))
      .send({ title: 'Evil', url: 'javascript:alert(1)' });
    expect(res.status).toBe(400);
  });

  it('rejects invalid enum values', async () => {
    const res = await request(app).post('/api/projects/prj-1/tasks').set(as('emp-5')).send({ title: 'T', status: 'bogus' });
    expect(res.status).toBe(400);
  });

  it('members cannot open archived projects or see their tasks anywhere', async () => {
    await request(app).put('/api/projects/prj-1').set(as('emp-3')).send({ status: 'archived' });

    expect((await request(app).post('/api/workspace/open-tab').set(as('emp-5')).send({ projectId: 'prj-1' })).status).toBe(403);
    const global = await request(app).get('/api/tasks/global').set(as('emp-5'));
    expect(global.body.some((t: any) => t.projectId === 'prj-1')).toBe(false);
    const stats = await request(app).get('/api/dashboard/stats').set(as('emp-5'));
    expect(stats.body.urgentTasks.some((t: any) => t.projectId === 'prj-1')).toBe(false);
  });
});

describe('Bug fixes', () => {
  it('the Tasks view survives a reload', async () => {
    await request(app).put('/api/workspace').set(as('emp-1')).send({ tabs: [], activeTabId: 'tasks' });
    const res = await request(app).get('/api/workspace').set(as('emp-1'));
    expect(res.body.workspace.activeTabId).toBe('tasks');
  });

  it('deleting a project removes all of its data', async () => {
    expect(db.getData().tasks.some((t) => t.projectId === 'prj-1')).toBe(true);
    const res = await request(app).delete('/api/projects/prj-1').set(as('emp-3'));
    expect(res.status).toBe(200);
    const data = db.getData();
    for (const key of ['tasks', 'milestones', 'deliverables', 'chatMessages', 'files', 'notes', 'links', 'activities'] as const) {
      expect((data[key] as Array<{ projectId: string }>).some((i) => i.projectId === 'prj-1')).toBe(false);
    }
  });

  it('client active project counts follow project status', async () => {
    const clientId = db.getData().projects.find((p) => p.id === 'prj-1')!.clientId;
    const count = async () =>
      (await request(app).get('/api/clients').set(as('emp-1'))).body.find((c: any) => c.id === clientId).activeProjectsCount;
    const before = await count();
    await request(app).put('/api/projects/prj-1').set(as('emp-3')).send({ status: 'completed' });
    expect(await count()).toBe(before - 1);
  });

  it('deleting a task recalculates completion', async () => {
    const created = await request(app).post('/api/projects/prj-1/tasks').set(as('emp-3')).send({ title: 'Temp', status: 'done' });
    const withTask = db.getData().projects.find((p) => p.id === 'prj-1')!.completionPercentage;
    await request(app).delete(`/api/projects/prj-1/tasks/${created.body.id}`).set(as('emp-3'));
    const after = db.getData().projects.find((p) => p.id === 'prj-1')!.completionPercentage;
    expect(after).toBeLessThan(withTask);
  });

  it('tasks can only be assigned to project team members', async () => {
    const outsider = db.getData().users.find((u) => !db.getData().projects.find((p) => p.id === 'prj-1')!.teamMemberIds.includes(u.id) && u.id !== 'emp-3')!;
    const res = await request(app).post('/api/projects/prj-1/tasks').set(as('emp-3')).send({ title: 'T', assigneeId: outsider.id });
    expect(res.status).toBe(400);
  });

  it('SQLite persists changes, deletions and order across a reopen', () => {
    const file = path.join(os.tmpdir(), `handlemydesk-test-${Date.now()}.db`);
    try {
      const first = new Database(file);
      const data = first.getData();
      data.tasks.unshift({ ...data.tasks[0], id: 'tsk-new', title: 'Newest task' });
      data.links = data.links.slice(1);
      first.save();
      first.close();

      const second = new Database(file);
      const reopened = second.getData();
      second.close();
      expect(reopened.tasks[0].title).toBe('Newest task');
      expect(reopened.tasks.length).toBe(data.tasks.length);
      expect(reopened.links.length).toBe(data.links.length);
      expect(Object.keys(reopened.workspaces)).toEqual(Object.keys(data.workspaces));
    } finally {
      for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
    }
  });
});

describe('Features', () => {
  it('assigning a task notifies the assignee', async () => {
    await request(app).post('/api/projects/prj-1/tasks').set(as('emp-3')).send({ title: 'Ship it', assigneeId: 'emp-5' });
    const res = await request(app).get('/api/notifications').set(as('emp-5'));
    expect(res.body[0].title).toBe('New Task Assigned');
    expect(res.body[0].read).toBe(false);
  });

  it('mark all notifications read', async () => {
    await request(app).post('/api/notifications/read-all').set(as('emp-1'));
    const res = await request(app).get('/api/notifications').set(as('emp-1'));
    expect(res.body.every((n: any) => n.read)).toBe(true);
  });

  it('edits tasks including subtasks and tags', async () => {
    const created = await request(app).post('/api/projects/prj-1/tasks').set(as('emp-5')).send({ title: 'Edit me' });
    const res = await request(app)
      .put(`/api/projects/prj-1/tasks/${created.body.id}`)
      .set(as('emp-5'))
      .send({ title: 'Edited', tags: ['ui', 'ui', 'api'], subtasks: [{ title: 'Step 1', completed: true }] });
    expect(res.body.title).toBe('Edited');
    expect(res.body.tags).toEqual(['ui', 'api']);
    expect(res.body.subtasks[0]).toMatchObject({ title: 'Step 1', completed: true });
  });

  it('milestones: lead can create, update and delete; members cannot', async () => {
    expect((await request(app).post('/api/projects/prj-1/milestones').set(as('emp-5')).send({ title: 'M' })).status).toBe(403);
    const created = await request(app).post('/api/projects/prj-1/milestones').set(as('emp-3')).send({ title: 'Beta', targetDate: '2027-01-15' });
    expect(created.status).toBe(201);
    const updated = await request(app).put(`/api/projects/prj-1/milestones/${created.body.id}`).set(as('emp-3')).send({ status: 'completed' });
    expect(updated.body.progress).toBe(100);
    expect((await request(app).delete(`/api/projects/prj-1/milestones/${created.body.id}`).set(as('emp-3'))).status).toBe(200);
  });

  it('deliverables: approve records sign-off, reject clears it', async () => {
    const created = await request(app).post('/api/projects/prj-1/deliverables').set(as('emp-3')).send({ title: 'Spec' });
    const approved = await request(app).put(`/api/projects/prj-1/deliverables/${created.body.id}`).set(as('emp-3')).send({ status: 'approved' });
    expect(approved.body.signedOffBy).toBeTruthy();
    const rejected = await request(app).put(`/api/projects/prj-1/deliverables/${created.body.id}`).set(as('emp-3')).send({ status: 'rejected' });
    expect(rejected.body.signedOffBy).toBeUndefined();
  });

  it('uploads, downloads and deletes a real file', async () => {
    const up = await request(app)
      .post('/api/projects/prj-1/files')
      .set(as('emp-5'))
      .field('category', 'specs')
      .attach('file', Buffer.from('hello world'), 'notes.txt');
    expect(up.status).toBe(201);
    expect(up.body.name).toBe('notes.txt');
    expect(up.body.fileSize).toBe('11 B');

    const down = await request(app).get(`/api/projects/prj-1/files/${up.body.id}/download`).set(as('emp-5'));
    expect(down.status).toBe(200);
    expect(down.text).toBe('hello world');

    // Someone outside the project cannot download it
    expect((await request(app).get(`/api/projects/prj-1/files/${up.body.id}/download`).set(as('emp-4'))).status).toBe(403);

    expect((await request(app).delete(`/api/projects/prj-1/files/${up.body.id}`).set(as('emp-5'))).status).toBe(200);
  });

  it('notes: only the author or lead can edit', async () => {
    const note = await request(app).post('/api/projects/prj-1/notes').set(as('emp-5')).send({ title: 'Mine' });
    expect((await request(app).put(`/api/projects/prj-1/notes/${note.body.id}`).set(as('emp-2')).send({ title: 'X' })).status).toBe(403);
    expect((await request(app).put(`/api/projects/prj-1/notes/${note.body.id}`).set(as('emp-3')).send({ title: 'Lead edit' })).status).toBe(200);
  });
});

describe('Office workflow', () => {
  it('never locks people out after repeated failed sign-ins', async () => {
    for (let i = 0; i < 15; i++) {
      await request(app).post('/api/auth/login').send({ email: email('emp-5'), password: 'wrong' });
    }
    const ok = await request(app).post('/api/auth/login').send({ email: email('emp-5'), password: SEED_PASSWORD });
    expect(ok.status).toBe(200);
  });

  it('stars and unstars projects, and drops stars the user can no longer see', async () => {
    const starred = await request(app).post('/api/workspace/favorites').set(as('emp-5')).send({ projectId: 'prj-1', favorite: true });
    expect(starred.body.favoriteProjectIds).toEqual(['prj-1']);
    expect((await request(app).post('/api/workspace/favorites').set(as('emp-5')).send({ projectId: 'prj-8', favorite: true })).status).toBe(404);

    await request(app).put('/api/projects/prj-1').set(as('emp-3')).send({ status: 'archived' });
    const ws = await request(app).get('/api/workspace').set(as('emp-5'));
    expect(ws.body.workspace.favoriteProjectIds).toEqual([]);
  });

  it('reopening a project moves it to the end of the recent list', async () => {
    await request(app).post('/api/workspace/open-tab').set(as('emp-1')).send({ projectId: 'prj-3' });
    await request(app).post('/api/workspace/open-tab').set(as('emp-1')).send({ projectId: 'prj-4' });
    const res = await request(app).post('/api/workspace/open-tab').set(as('emp-1')).send({ projectId: 'prj-3' });
    const ids = res.body.tabs.map((t: any) => t.projectId);
    expect(ids[ids.length - 1]).toBe('prj-3');
    expect(ids.filter((id: string) => id === 'prj-3').length).toBe(1);
  });

  it('accepts live-site and domain links', async () => {
    for (const category of ['live', 'domain']) {
      const res = await request(app)
        .post('/api/projects/prj-1/links')
        .set(as('emp-3'))
        .send({ title: category, url: 'https://example.com', category });
      expect(res.status).toBe(201);
    }
  });
});

describe('Many people at once', () => {
  // 18 deliberately slow password checks at once: allow time on a busy machine
  it('signs everyone in concurrently and each session only ever sees its own user and data', { timeout: 20000 }, async () => {
    const users = db.getData().users;
    const logins = await Promise.all(
      users.map((u) => request(app).post('/api/auth/login').send({ email: u.email, password: SEED_PASSWORD }))
    );
    expect(logins.every((r) => r.status === 200)).toBe(true);

    // Fire every user's requests interleaved, as a busy office would
    const checks = await Promise.all(
      logins.flatMap((login, i) => {
        const auth = { Authorization: `Bearer ${login.body.token}` };
        return [
          request(app).get('/api/auth/me').set(auth).then((r) => r.body.user.id === users[i].id),
          request(app).get('/api/workspace').set(auth).then((r) => r.body.workspace.userId === users[i].id),
          request(app).get('/api/notifications').set(auth).then((r) => r.body.every((n: any) => n.userId === users[i].id)),
        ];
      })
    );
    expect(checks.every(Boolean)).toBe(true);
  });
});
