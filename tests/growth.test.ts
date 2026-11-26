import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import http from 'http';
import express from 'express';
import request from 'supertest';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { app } from '../src/server/index';
import { db, Database, SCHEMA_VERSION } from '../src/server/db';
import { listBackups } from '../src/server/backups';
import { toCsv } from '../src/server/csv';
import { as } from './helpers';

beforeEach(() => {
  db.resetToDefault();
});

describe('Paging long lists', () => {
  it('pages notifications newest first, with the unread count across all pages', async () => {
    const data = db.getData();
    for (let i = 0; i < 7; i++) {
      data.notifications.push({ id: `n-${i}`, userId: 'emp-5', title: `N${i}`, message: '', type: 'info', read: i % 2 === 0, timestamp: `2030-01-0${i + 1}T00:00:00.000Z` });
    }
    const unread = data.notifications.filter((n) => n.userId === 'emp-5' && !n.read).length;

    const first = await request(app).get('/api/notifications?limit=3').set(as('emp-5'));
    expect(first.body.items.map((n: any) => n.title)).toEqual(['N6', 'N5', 'N4']);
    expect(first.body.hasMore).toBe(true);
    expect(first.body.unreadCount).toBe(unread);

    const next = await request(app).get(`/api/notifications?limit=3&before=${first.body.items[2].timestamp}`).set(as('emp-5'));
    expect(next.body.items.map((n: any) => n.title)).toEqual(['N3', 'N2', 'N1']);
  });

  it('pages chat: the newest messages, in reading order', async () => {
    for (let i = 0; i < 5; i++) await request(app).post('/api/projects/prj-1/chat').set(as('emp-5')).send({ text: `msg ${i}` });
    const res = await request(app).get('/api/projects/prj-1/chat?limit=2').set(as('emp-5'));
    expect(res.body.items.map((m: any) => m.text)).toEqual(['msg 3', 'msg 4']);
    expect(res.body.hasMore).toBe(true);
  });

  it('pages activity', async () => {
    const res = await request(app).get('/api/projects/prj-1/activity?limit=1').set(as('emp-5'));
    expect(res.body.items).toHaveLength(1);
  });
});

describe('Project templates', () => {
  it('lists the built-in templates', async () => {
    const res = await request(app).get('/api/templates').set(as('emp-5'));
    expect(res.body.filter((t: any) => t.builtIn).map((t: any) => t.id)).toEqual(['tpl-website', 'tpl-onboarding', 'tpl-internal']);
  });

  it('creates a project from a template with its tasks and milestones dated from the start', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set(as('emp-2'))
      .send({ name: 'Bakery site', clientId: db.getData().clients[0].id, templateId: 'tpl-website', startDate: '2030-03-01' });
    expect(res.status).toBe(201);
    expect(res.body.category).toBe('Web Development');
    const tasks = db.getData().tasks.filter((t) => t.projectId === res.body.id);
    const milestones = db.getData().milestones.filter((m) => m.projectId === res.body.id);
    expect(tasks.length).toBe(11);
    expect(milestones.find((m) => m.title === 'Launch')!.targetDate).toBe('2030-05-24');
    expect(tasks.every((t) => t.assigneeId === 'emp-2')).toBe(true);
  });

  it('creates the client from a typed name, or reuses an existing client with the same name', async () => {
    const before = db.getData().clients.length;
    const created = await request(app).post('/api/projects').set(as('emp-2')).send({ name: 'Bakery site', clientName: 'Sunrise Bakery' });
    expect(created.status).toBe(201);
    expect(created.body.clientName).toBe('Sunrise Bakery');
    expect(db.getData().clients.length).toBe(before + 1);

    const again = await request(app).post('/api/projects').set(as('emp-2')).send({ name: 'Bakery app', clientName: '  sunrise bakery ' });
    expect(again.status).toBe(201);
    expect(again.body.clientId).toBe(created.body.clientId);
    expect(db.getData().clients.length).toBe(before + 1);

    expect((await request(app).post('/api/projects').set(as('emp-2')).send({ name: 'No client' })).status).toBe(400);
    expect((await request(app).post('/api/clients').set(as('emp-2')).send({ name: 'No email yet' })).status).toBe(201);
  });

  it('a lead saves their project as a template; only they or an admin can delete it; built-ins cannot be', async () => {
    const saved = await request(app).post('/api/projects/prj-1/save-as-template').set(as('emp-3')).send({ name: 'Brand refresh' });
    expect(saved.status).toBe(201);
    expect(saved.body.tasks.length).toBe(db.getData().tasks.filter((t) => t.projectId === 'prj-1').length);

    expect((await request(app).post('/api/projects/prj-1/save-as-template').set(as('emp-5')).send({ name: 'x' })).status).toBe(403);
    expect((await request(app).delete(`/api/templates/${saved.body.id}`).set(as('emp-2'))).status).toBe(403);
    expect((await request(app).delete('/api/templates/tpl-website').set(as('emp-1'))).status).toBe(400);
    expect((await request(app).delete(`/api/templates/${saved.body.id}`).set(as('emp-3'))).status).toBe(200);
  });
});

describe('Exports', () => {
  it('exports a project’s tasks as CSV', async () => {
    const res = await request(app).get('/api/projects/prj-1/export/tasks.csv').set(as('emp-5'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename=".*tasks-\d{4}-\d{2}-\d{2}\.csv"/);
    const lines = res.text.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toContain('Task,Status,Priority');
    expect(lines.length - 1).toBe(db.getData().tasks.filter((t) => t.projectId === 'prj-1').length);
  });

  it('only exports what the person can see', async () => {
    expect((await request(app).get('/api/projects/prj-8/export/tasks.csv').set(as('emp-5'))).status).toBe(403);
    const all = await request(app).get('/api/projects/export.csv').set(as('emp-5'));
    const restricted = db.getData().projects.find((p) => p.id === 'prj-8')!;
    expect(all.text).not.toContain(restricted.name);
  });

  it('neutralises spreadsheet formulas and quotes properly', () => {
    const csv = toCsv(['a', 'b'], [['=HYPERLINK("x")', 'say "hi", ok']]);
    expect(csv).toBe('﻿a,b\r\n"\'=HYPERLINK(""x"")","say ""hi"", ok"\r\n');
  });
});

describe('Operations', () => {
  it('gives every response a request id', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('updates an older database once, recording the version and taking a backup first', () => {
    const file = path.join(os.tmpdir(), `handlemydesk-migrate-${Date.now()}.db`);
    try {
      // An "older" database: data present, no stages, no migration history
      new Database(file).close();
      const raw = new DatabaseSync(file);
      raw.exec('DELETE FROM schema_migrations');
      for (const row of raw.prepare('SELECT id, data FROM projects').all() as Array<{ id: string; data: string }>) {
        const p = JSON.parse(row.data);
        delete p.stage;
        raw.prepare('UPDATE projects SET data = ? WHERE id = ?').run(JSON.stringify(p), row.id);
      }
      raw.close();
      const backupsBefore = listBackups().length;

      const upgraded = new Database(file);
      expect(upgraded.schemaVersion()).toBe(SCHEMA_VERSION);
      expect(upgraded.getData().projects.every((p) => !!p.stage)).toBe(true);
      expect(listBackups().length).toBe(backupsBefore + 1);
      expect(listBackups()[0].name).toMatch(/-premigrate\.db$/);
      upgraded.close();

      // Opening again changes nothing
      const again = new Database(file);
      expect(listBackups().length).toBe(backupsBefore + 1);
      again.close();
    } finally {
      for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
    }
  });
});

// ---------- Single sign-on against a mock OpenID Connect provider ----------

describe('Single sign-on', () => {
  let server: http.Server;
  let issuer = '';
  const codes = new Map<string, { email: string; name: string; nonce: string; challenge: string; verified?: boolean }>();
  let privateKey: CryptoKey;

  beforeAll(async () => {
    const keys = await generateKeyPair('RS256');
    privateKey = keys.privateKey as CryptoKey;
    const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };

    const provider = express();
    provider.use(express.urlencoded({ extended: false }));
    provider.get('/.well-known/openid-configuration', (req, res) =>
      res.json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` })
    );
    provider.get('/jwks', (req, res) => res.json({ keys: [jwk] }));
    provider.post('/token', async (req, res) => {
      const entry = codes.get(req.body.code);
      const challenge = crypto.createHash('sha256').update(req.body.code_verifier ?? '').digest('base64url');
      if (!entry || challenge !== entry.challenge || req.body.client_secret !== 'secret') {
        res.status(400).json({ error: 'invalid_grant' });
        return;
      }
      const idToken = await new SignJWT({ email: entry.email, name: entry.name, nonce: entry.nonce, email_verified: entry.verified ?? true })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setIssuer(issuer)
        .setAudience('handlemydesk-client')
        .setSubject(entry.email)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);
      res.json({ id_token: idToken, access_token: 'x', token_type: 'Bearer' });
    });
    await new Promise<void>((resolve) => {
      server = provider.listen(0, () => resolve());
    });
    issuer = `http://127.0.0.1:${(server.address() as any).port}`;
    Object.assign(process.env, {
      SSO_ISSUER: issuer,
      SSO_CLIENT_ID: 'handlemydesk-client',
      SSO_CLIENT_SECRET: 'secret',
      SSO_REDIRECT_URL: 'http://localhost/api/auth/sso/callback',
      SSO_LABEL: 'Microsoft',
    });
  });

  afterAll(() => {
    server?.close();
    for (const k of ['SSO_ISSUER', 'SSO_CLIENT_ID', 'SSO_CLIENT_SECRET', 'SSO_REDIRECT_URL', 'SSO_LABEL', 'SSO_AUTO_CREATE']) delete process.env[k];
  });

  // Runs the browser's part of the flow: start, (provider login), callback
  async function signInAs(email: string, opts: { verified?: boolean; tamperNonce?: boolean } = {}) {
    const start = await request(app).get('/api/auth/sso/start');
    expect(start.status).toBe(302);
    const url = new URL(start.headers.location);
    const code = crypto.randomBytes(8).toString('hex');
    codes.set(code, {
      email,
      name: 'Sam Rivera',
      nonce: opts.tamperNonce ? 'wrong' : url.searchParams.get('nonce')!,
      challenge: url.searchParams.get('code_challenge')!,
      verified: opts.verified,
    });
    const state = url.searchParams.get('state')!;
    const callback = await request(app).get(`/api/auth/sso/callback?code=${code}&state=${state}`);
    return { callback, state, code };
  }

  it('reports whether SSO is set up, with its button label', async () => {
    expect((await request(app).get('/api/auth/sso/config')).body).toEqual({ enabled: true, label: 'Microsoft' });
  });

  it('signs in an existing person by email and the one-time code works exactly once', async () => {
    const email = db.getData().users.find((u) => u.id === 'emp-5')!.email.toUpperCase();
    const { callback } = await signInAs(email);
    expect(callback.status).toBe(302);
    const oneTime = callback.headers.location.match(/^\/#\/sso\/(.+)$/)?.[1];
    expect(oneTime).toBeTruthy();

    const exchanged = await request(app).post('/api/auth/sso/exchange').send({ code: oneTime });
    expect(exchanged.body.user.id).toBe('emp-5');
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${exchanged.body.token}`)).body.user.id).toBe('emp-5');
    expect((await request(app).post('/api/auth/sso/exchange').send({ code: oneTime })).status).toBe(401);
  });

  it('refuses unknown people unless automatic accounts are on', async () => {
    const { callback } = await signInAs('new.person@handlemydesk.internal');
    expect(decodeURIComponent(callback.headers.location)).toContain("There's no HandleMyDesk account for new.person@handlemydesk.internal");

    process.env.SSO_AUTO_CREATE = 'true';
    const second = await signInAs('new.person@handlemydesk.internal');
    delete process.env.SSO_AUTO_CREATE;
    expect(second.callback.headers.location).toMatch(/^\/#\/sso\//);
    const created = db.getData().users.find((u) => u.email === 'new.person@handlemydesk.internal')!;
    expect(created).toMatchObject({ role: 'member', name: 'Sam Rivera', active: true });
  });

  it('rejects deactivated people, unverified emails, replayed state and mismatched responses', async () => {
    db.getData().users.find((u) => u.id === 'emp-6')!.active = false;
    const deactivated = await signInAs(db.getData().users.find((u) => u.id === 'emp-6')!.email);
    expect(decodeURIComponent(deactivated.callback.headers.location)).toContain('deactivated');

    const unverified = await signInAs(db.getData().users.find((u) => u.id === 'emp-5')!.email, { verified: false });
    expect(decodeURIComponent(unverified.callback.headers.location)).toContain('not verified');

    const ok = await signInAs(db.getData().users.find((u) => u.id === 'emp-5')!.email);
    const replay = await request(app).get(`/api/auth/sso/callback?code=${ok.code}&state=${ok.state}`);
    expect(decodeURIComponent(replay.headers.location)).toContain('expired');

    const tampered = await signInAs(db.getData().users.find((u) => u.id === 'emp-5')!.email, { tamperNonce: true });
    expect(tampered.callback.headers.location).toMatch(/^\/#\/sso-error\//);
  });
});
