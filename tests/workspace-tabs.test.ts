import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/server/index';
import { db } from '../src/server/db';
import { as } from './helpers';

describe('Desktop Project Tabs Workspace System & Access Control', () => {
  beforeEach(() => {
    // Reset database to known seed state before each test
    db.resetToDefault();
  });

  it('1. Opening a project creates and activates a tab in user workspace', async () => {
    // Sarah Connor (emp-1, Admin) opens prj-3
    const res = await request(app)
      .post('/api/workspace/open-tab')
      .set(as('emp-1'))
      .send({ projectId: 'prj-3' });

    expect(res.status).toBe(200);
    expect(res.body.activeTabId).toBe('prj-3');
    const tabExists = res.body.tabs.some((t: any) => t.projectId === 'prj-3');
    expect(tabExists).toBe(true);
  });

  it('2. Opening the same project again does not create a duplicate tab', async () => {
    // Sarah Connor already has prj-1 open in initial state
    const beforeRes = await request(app)
      .get('/api/workspace')
      .set(as('emp-1'));

    const initialTabsCount = beforeRes.body.workspace.tabs.length;
    expect(beforeRes.body.workspace.tabs.some((t: any) => t.projectId === 'prj-1')).toBe(true);

    // Try opening prj-1 again
    const afterRes = await request(app)
      .post('/api/workspace/open-tab')
      .set(as('emp-1'))
      .send({ projectId: 'prj-1' });

    expect(afterRes.status).toBe(200);
    expect(afterRes.body.activeTabId).toBe('prj-1');
    expect(afterRes.body.tabs.length).toBe(initialTabsCount);

    const matches = afterRes.body.tabs.filter((t: any) => t.projectId === 'prj-1');
    expect(matches.length).toBe(1);
  });

  it('3. Clicking a different tab switches active project correctly', async () => {
    // Update active tab to prj-2
    const res = await request(app)
      .put('/api/workspace')
      .set(as('emp-1'))
      .send({
        tabs: [
          { projectId: 'prj-1', tabOrder: 0 },
          { projectId: 'prj-2', tabOrder: 1 },
        ],
        activeTabId: 'prj-2',
      });

    expect(res.status).toBe(200);
    expect(res.body.activeTabId).toBe('prj-2');

    // Verify it persists on subsequent fetch
    const fetchRes = await request(app)
      .get('/api/workspace')
      .set(as('emp-1'));

    expect(fetchRes.body.workspace.activeTabId).toBe('prj-2');
  });

  it('4 & 5. Closing a tab removes it from workspace but NEVER deletes or archives the project', async () => {
    // Verify project exists in database
    const initialPrjRes = await request(app)
      .get('/api/projects/prj-1')
      .set(as('emp-1'));
    expect(initialPrjRes.status).toBe(200);
    expect(initialPrjRes.body.id).toBe('prj-1');
    expect(initialPrjRes.body.status).toBe('active');

    // Close tab prj-1 for emp-1
    const closeRes = await request(app)
      .post('/api/workspace/close-tab')
      .set(as('emp-1'))
      .send({ projectId: 'prj-1' });

    expect(closeRes.status).toBe(200);
    const hasPrj1Tab = closeRes.body.tabs.some((t: any) => t.projectId === 'prj-1');
    expect(hasPrj1Tab).toBe(false);

    // Verify project STILL exists in database and is untouched!
    const verifyPrjRes = await request(app)
      .get('/api/projects/prj-1')
      .set(as('emp-1'));
    expect(verifyPrjRes.status).toBe(200);
    expect(verifyPrjRes.body.id).toBe('prj-1');
    expect(verifyPrjRes.body.status).toBe('active');

    // Verify project tasks still exist untouched
    const tasksRes = await request(app)
      .get('/api/projects/prj-1/tasks')
      .set(as('emp-1'));
    expect(tasksRes.status).toBe(200);
    expect(tasksRes.body.length).toBeGreaterThan(0);
  });

  it('6. When active tab is closed, activates previous tab or dashboard if none left', async () => {
    // Set workspace with exactly one tab: prj-2
    await request(app)
      .put('/api/workspace')
      .set(as('emp-1'))
      .send({
        tabs: [{ projectId: 'prj-2', tabOrder: 0 }],
        activeTabId: 'prj-2',
      });

    // Close prj-2
    const closeRes = await request(app)
      .post('/api/workspace/close-tab')
      .set(as('emp-1'))
      .send({ projectId: 'prj-2' });

    expect(closeRes.status).toBe(200);
    expect(closeRes.body.tabs.length).toBe(0);
    expect(closeRes.body.activeTabId).toBe('dashboard');
  });

  it('7 & 8. Each employee has an independent tab arrangement and persistence', async () => {
    // Sarah (emp-1) tabs
    const sarahRes = await request(app)
      .get('/api/workspace')
      .set(as('emp-1'));

    // Marcus (emp-2) tabs
    const marcusRes = await request(app)
      .get('/api/workspace')
      .set(as('emp-2'));

    // Maya (emp-5) tabs
    const mayaRes = await request(app)
      .get('/api/workspace')
      .set(as('emp-5'));

    // Verify workspaces are distinct
    expect(sarahRes.body.workspace.userId).toBe('emp-1');
    expect(marcusRes.body.workspace.userId).toBe('emp-2');
    expect(mayaRes.body.workspace.userId).toBe('emp-5');

    // Sarah modifies her workspace by closing prj-2
    await request(app)
      .post('/api/workspace/close-tab')
      .set(as('emp-1'))
      .send({ projectId: 'prj-2' });

    // Marcus's workspace should still have prj-2 open!
    const marcusCheck = await request(app)
      .get('/api/workspace')
      .set(as('emp-2'));

    const marcusHasPrj2 = marcusCheck.body.workspace.tabs.some((t: any) => t.projectId === 'prj-2');
    expect(marcusHasPrj2).toBe(true);
  });

  it('9. Unauthorized projects cannot be accessed through tabs, URLs, or search', async () => {
    // Project prj-8 is restricted to emp-1 (admin), emp-2 (lead), emp-4, emp-8, emp-15
    // emp-5 (Maya Patel, Member) is NOT in prj-8 team

    // 1. Trying to fetch project directly returns 403 Forbidden
    const directFetch = await request(app)
      .get('/api/projects/prj-8')
      .set(as('emp-5'));
    expect(directFetch.status).toBe(403);

    // 2. Trying to fetch sub-resources (tasks, chat) returns 403 Forbidden
    const taskFetch = await request(app)
      .get('/api/projects/prj-8/tasks')
      .set(as('emp-5'));
    expect(taskFetch.status).toBe(403);

    // 3. Trying to open tab for prj-8 returns 403 Forbidden
    const openTabAttempt = await request(app)
      .post('/api/workspace/open-tab')
      .set(as('emp-5'))
      .send({ projectId: 'prj-8' });
    expect(openTabAttempt.status).toBe(403);

    // 4. In directory search, prj-8 is NOT returned for Maya
    const searchRes = await request(app)
      .get('/api/projects?search=Security')
      .set(as('emp-5'));
    expect(searchRes.status).toBe(200);
    const hasPrj8 = searchRes.body.some((p: any) => p.id === 'prj-8');
    expect(hasPrj8).toBe(false);

    // 5. But for Sarah (Admin) or Marcus (Lead), it IS accessible
    const marcusFetch = await request(app)
      .get('/api/projects/prj-8')
      .set(as('emp-2'));
    expect(marcusFetch.status).toBe(200);
    expect(marcusFetch.body.id).toBe('prj-8');
  });

  it('10. Graceful tab pruning: Inaccessible/deleted tabs are purged automatically from workspace', async () => {
    // Suppose Marcus has prj-8 open. If Marcus is removed or project deleted, workspace sanitizes it.
    // Let's test server workspace sanitization:
    // Insert an invalid/deleted projectId into workspace
    const rawDb = db.getData();
    rawDb.workspaces['emp-5'].tabs.push({
      projectId: 'prj-nonexistent-999',
      tabOrder: 99,
      openedAt: new Date().toISOString(),
    });
    // Also add prj-8 to Maya's tabs in DB manually to simulate permission revocation
    rawDb.workspaces['emp-5'].tabs.push({
      projectId: 'prj-8',
      tabOrder: 100,
      openedAt: new Date().toISOString(),
    });
    db.save();

    // When Maya fetches her workspace, server MUST sanitize out prj-nonexistent-999 and prj-8!
    const res = await request(app)
      .get('/api/workspace')
      .set(as('emp-5'));

    expect(res.status).toBe(200);
    const sanitizedProjectIds = res.body.workspace.tabs.map((t: any) => t.projectId);
    expect(sanitizedProjectIds).not.toContain('prj-nonexistent-999');
    expect(sanitizedProjectIds).not.toContain('prj-8');
  });
});
