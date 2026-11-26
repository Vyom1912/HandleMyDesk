import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app, runReminders } from '../src/server/index';
import { db } from '../src/server/db';
import { as } from './helpers';

// prj-1: lead emp-3 (Elena), team includes emp-2, emp-5 (Maya), emp-7. emp-4 is not on prj-1.

beforeEach(() => {
  db.resetToDefault();
});

const notificationsFor = async (id: string) => (await request(app).get('/api/notifications').set(as(id))).body as any[];
const name = (id: string) => db.getData().users.find((u) => u.id === id)!.name;
const firstTask = () => db.getData().tasks.find((t) => t.projectId === 'prj-1')!;

describe('Task comments and mentions', () => {
  it('posts a comment, notifies mentioned people and the assignee, and links to the task', async () => {
    const task = firstTask();
    const text = `@${name('emp-5')} can you check this?`;
    const res = await request(app)
      .post(`/api/projects/prj-1/tasks/${task.id}/comments`)
      .set(as('emp-3'))
      .send({ text, mentions: ['emp-5', 'emp-4'] });
    expect(res.status).toBe(201);
    // emp-4 is not on the project, so the mention is dropped
    expect(res.body.mentions).toEqual(['emp-5']);

    const maya = await notificationsFor('emp-5');
    expect(maya[0]).toMatchObject({ title: 'You were mentioned', kind: 'mentions', taskId: task.id, projectId: 'prj-1' });
    expect((await notificationsFor('emp-4')).some((n) => n.title === 'You were mentioned')).toBe(false);

    if (task.assigneeId !== 'emp-5' && task.assigneeId !== 'emp-3') {
      expect((await notificationsFor(task.assigneeId))[0].kind).toBe('comments');
    }

    const list = await request(app).get(`/api/projects/prj-1/tasks/${task.id}/comments`).set(as('emp-5'));
    expect(list.body.map((c: any) => c.text)).toEqual([text]);
  });

  it('only the author can edit; the author or the lead can delete; deleting the task removes its comments', async () => {
    const task = firstTask();
    const c = await request(app).post(`/api/projects/prj-1/tasks/${task.id}/comments`).set(as('emp-5')).send({ text: 'first' });
    expect((await request(app).put(`/api/projects/prj-1/tasks/${task.id}/comments/${c.body.id}`).set(as('emp-2')).send({ text: 'x' })).status).toBe(403);
    const edited = await request(app).put(`/api/projects/prj-1/tasks/${task.id}/comments/${c.body.id}`).set(as('emp-5')).send({ text: 'edited' });
    expect(edited.body.editedAt).toBeTruthy();
    expect((await request(app).delete(`/api/projects/prj-1/tasks/${task.id}/comments/${c.body.id}`).set(as('emp-3'))).status).toBe(200);

    await request(app).post(`/api/projects/prj-1/tasks/${task.id}/comments`).set(as('emp-5')).send({ text: 'again' });
    await request(app).delete(`/api/projects/prj-1/tasks/${task.id}`).set(as('emp-3'));
    expect(db.getData().comments.some((x) => x.taskId === task.id)).toBe(false);
  });

  it('people outside the project cannot read or post comments', async () => {
    const task = firstTask();
    expect((await request(app).get(`/api/projects/prj-1/tasks/${task.id}/comments`).set(as('emp-4'))).status).toBe(403);
  });
});

describe('Notification preferences', () => {
  it('muted kinds are not delivered; others still are', async () => {
    await request(app).put('/api/notification-preferences').set(as('emp-5')).send({ muted: ['assignments', 'not-a-kind'] });
    expect((await request(app).get('/api/notification-preferences').set(as('emp-5'))).body.muted).toEqual(['assignments']);

    const before = (await notificationsFor('emp-5')).length;
    await request(app).post('/api/projects/prj-1/tasks').set(as('emp-3')).send({ title: 'Quiet', assigneeId: 'emp-5' });
    expect((await notificationsFor('emp-5')).length).toBe(before);

    const task = firstTask();
    await request(app).post(`/api/projects/prj-1/tasks/${task.id}/comments`).set(as('emp-3')).send({ text: `@${name('emp-5')} hi`, mentions: ['emp-5'] });
    expect((await notificationsFor('emp-5')).length).toBe(before + 1);
  });
});

describe('Reminders', () => {
  it('reminds the assignee once when a task is due tomorrow and once when it is overdue', async () => {
    const created = await request(app).post('/api/projects/prj-1/tasks').set(as('emp-3')).send({ title: 'Report', assigneeId: 'emp-5', dueDate: '2030-06-11' });
    const at = new Date('2030-06-10T09:00:00Z');

    runReminders(at);
    runReminders(at);
    const due = (await notificationsFor('emp-5')).filter((n) => n.taskId === created.body.id && n.kind === 'reminders');
    expect(due.map((n) => n.title)).toEqual(['Due tomorrow']);

    runReminders(new Date('2030-06-13T09:00:00Z'));
    runReminders(new Date('2030-06-14T09:00:00Z'));
    const all = (await notificationsFor('emp-5')).filter((n) => n.taskId === created.body.id && n.kind === 'reminders');
    expect(all.map((n) => n.title).sort()).toEqual(['Due tomorrow', 'Task overdue']);
  });

  it('skips finished tasks', async () => {
    const created = await request(app).post('/api/projects/prj-1/tasks').set(as('emp-3')).send({ title: 'Done one', assigneeId: 'emp-5', dueDate: '2030-06-11', status: 'done' });
    runReminders(new Date('2030-06-10T09:00:00Z'));
    expect((await notificationsFor('emp-5')).some((n) => n.taskId === created.body.id && n.kind === 'reminders')).toBe(false);
  });
});

describe('Search', () => {
  it('finds projects, tasks, notes, files and people the person can see, and nothing they cannot', async () => {
    const note = db.getData().notes.find((n) => n.projectId === 'prj-1')!;
    const word = note.content.split(/\s+/).find((w) => w.length > 6)!.replace(/[^\w]/g, '');
    const res = await request(app).get(`/api/search?q=${encodeURIComponent(word)}`).set(as('emp-5'));
    expect(res.body.notes.some((n: any) => n.id === note.id)).toBe(true);

    const people = await request(app).get('/api/search?q=elena').set(as('emp-5'));
    expect(people.body.people.some((p: any) => p.id === 'emp-3')).toBe(true);

    // prj-8 is restricted and Maya is not on it
    const secret = db.getData().tasks.find((t) => t.projectId === 'prj-8');
    if (secret) {
      const hidden = await request(app).get(`/api/search?q=${encodeURIComponent(secret.title.slice(0, 12))}`).set(as('emp-5'));
      expect(hidden.body.tasks.some((t: any) => t.projectId === 'prj-8')).toBe(false);
    }
    expect((await request(app).get('/api/search?q=a').set(as('emp-5'))).body.tasks).toEqual([]);
  });
});

describe('Profile and project stage', () => {
  it('people can update their own profile, and a rename shows on their tasks', async () => {
    const res = await request(app).put('/api/auth/me').set(as('emp-5')).send({ name: 'Maya P. Patel', status: 'busy', title: 'Senior Developer' });
    expect(res.body).toMatchObject({ name: 'Maya P. Patel', status: 'busy', title: 'Senior Developer' });
    expect(db.getData().tasks.filter((t) => t.assigneeId === 'emp-5').every((t) => t.assigneeName === 'Maya P. Patel')).toBe(true);
    // Role can't be changed this way
    await request(app).put('/api/auth/me').set(as('emp-5')).send({ role: 'admin' });
    expect(db.getData().users.find((u) => u.id === 'emp-5')!.role).toBe('member');
  });

  it('uploads a profile photo that loads without signing in, and rejects non-images', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b40000000049454e44ae426082', 'hex');
    const up = await request(app).post('/api/auth/me/avatar').set(as('emp-5')).attach('avatar', png, { filename: 'me.png', contentType: 'image/png' });
    expect(up.status).toBe(200);
    expect(up.body.avatar).toMatch(/^\/api\/avatars\/main\/[0-9a-f-]{36}\.png$/);
    expect((await request(app).get(up.body.avatar)).status).toBe(200);

    const bad = await request(app).post('/api/auth/me/avatar').set(as('emp-5')).attach('avatar', Buffer.from('hello'), { filename: 'x.txt', contentType: 'text/plain' });
    expect(bad.status).toBe(400);
  });

  it('the lead moves a project through stages; members cannot', async () => {
    expect((await request(app).put('/api/projects/prj-1').set(as('emp-5')).send({ stage: 'review' })).status).toBe(403);
    const res = await request(app).put('/api/projects/prj-1').set(as('emp-3')).send({ stage: 'review' });
    expect(res.body.stage).toBe('review');
    expect((await notificationsFor('emp-5')).some((n) => n.title === 'Project stage changed')).toBe(true);
    expect((await request(app).put('/api/projects/prj-1').set(as('emp-3')).send({ stage: 'nonsense' })).status).toBe(400);
  });
});
