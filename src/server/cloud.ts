import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pg from 'pg';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR, DB_PATH, IS_TEST } from './paths';

/*
 * KEEPING DATA IN NEON (free Postgres) SO IT SURVIVES RESTARTS
 *
 * Render's free plan has no disk: every deploy or restart starts with an empty folder. With
 * DATABASE_URL set, the server keeps working on its local SQLite files exactly as before, and also
 * copies every change to Postgres (Neon) about a second later:
 *
 *   - database rows: each office's tables, row by row, as they change
 *   - files: uploads, profile photos, logos and the office list (platform.json)
 *
 * When the server starts on an empty folder, it first downloads everything from Postgres and
 * rebuilds the local files, then starts as usual. On shutdown (Render sends SIGTERM before a
 * deploy) it finishes sending the last changes.
 *
 * Safety: Postgres remembers which installation it belongs to. A server whose local folder holds
 * data from somewhere else refuses to start, instead of overwriting the copy in Postgres.
 */

export const CLOUD_ENABLED = !IS_TEST && !!process.env.DATABASE_URL?.trim();

export interface MirrorTable {
  name: string;
  /** CREATE TABLE / CREATE INDEX statement */
  sql: string;
  /** Primary-key column; '' for indexes */
  key: string;
  rows: Array<Record<string, unknown>>;
}
/** A database that can hand over a full copy of itself (see Database.mirrorSnapshot). */
export interface Mirrorable {
  mirrorSnapshot(): MirrorTable[];
}

const MARKER_FILE = path.join(DATA_DIR, '.cloud-dataset');
const PLATFORM_FILE = path.join(DATA_DIR, 'platform.json');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS hmd_meta (key text PRIMARY KEY, value text NOT NULL);
CREATE TABLE IF NOT EXISTS hmd_dbs (office text PRIMARY KEY, path text NOT NULL);
CREATE TABLE IF NOT EXISTS hmd_tables (office text NOT NULL, tbl text NOT NULL, sql text NOT NULL, key text NOT NULL, PRIMARY KEY (office, tbl));
CREATE TABLE IF NOT EXISTS hmd_rows (office text NOT NULL, tbl text NOT NULL, key text NOT NULL, row text NOT NULL, PRIMARY KEY (office, tbl, key));
CREATE TABLE IF NOT EXISTS hmd_files (path text PRIMARY KEY, size bigint NOT NULL, mtime_ms bigint NOT NULL, data bytea NOT NULL);
`;

let pool: pg.Pool | null = null;
function db(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 30_000 });
    // Neon closes idle connections when it pauses; that's normal, the pool reconnects
    pool.on('error', () => undefined);
  }
  return pool;
}

async function inTransaction(fn: (c: pg.PoolClient) => Promise<void>) {
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    await fn(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Joins a stored relative path onto DATA_DIR, refusing anything that would land outside it. */
function insideDataDir(rel: string): string {
  const full = path.resolve(DATA_DIR, rel);
  if (path.isAbsolute(rel) || !full.startsWith(path.resolve(DATA_DIR) + path.sep)) throw new Error(`Refusing to write outside DATA_DIR: ${rel}`);
  return full;
}
const relPath = (full: string) => path.relative(DATA_DIR, full).split(path.sep).join('/');
const quoteId = (name: string) => `"${name.replace(/"/g, '""')}"`;

// ==========================================
// START-UP: download when the local folder is empty
// ==========================================

/** Runs before the app opens any database (see start.ts). */
export async function prepareFromCloud(): Promise<void> {
  if (!CLOUD_ENABLED) return;
  const started = Date.now();
  await db().query(SCHEMA);
  let dataset: string | undefined = (await db().query("SELECT value FROM hmd_meta WHERE key = 'dataset'")).rows[0]?.value;
  const cloudHasData = (await db().query('SELECT 1 FROM hmd_dbs LIMIT 1')).rowCount! > 0;
  const localHasData = fs.existsSync(DB_PATH) || fs.existsSync(PLATFORM_FILE);
  let marker: string | null = null;
  try {
    marker = fs.readFileSync(MARKER_FILE, 'utf-8').trim();
  } catch {
    // No marker yet
  }

  if (!cloudHasData) {
    if (!dataset) {
      dataset = crypto.randomUUID();
      await db().query("INSERT INTO hmd_meta (key, value) VALUES ('dataset', $1) ON CONFLICT (key) DO NOTHING", [dataset]);
      dataset = (await db().query("SELECT value FROM hmd_meta WHERE key = 'dataset'")).rows[0].value;
    }
    writeMarker(dataset!);
    console.log('Cloud database is empty: this server’s data will be copied there.');
    return;
  }

  if (!localHasData) {
    await restore();
    writeMarker(dataset!);
    console.log(`Downloaded the data from the cloud database in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
    return;
  }

  if (marker === dataset) {
    console.log('Using the local data; it is kept in step with the cloud database.');
    return;
  }

  throw new Error(
    `DATABASE_URL already holds data from another HandleMyDesk installation, and ${DATA_DIR} has different data.\n` +
      `Nothing was changed. Either empty ${DATA_DIR} to use the data in the cloud database, or use a new, empty cloud database.`
  );
}

function writeMarker(dataset: string) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(MARKER_FILE, dataset);
}

async function restore() {
  const dbs = (await db().query<{ office: string; path: string }>('SELECT office, path FROM hmd_dbs')).rows;
  for (const { office, path: rel } of dbs) {
    const file = insideDataDir(rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true });

    const tables = (await db().query<{ tbl: string; sql: string; key: string }>('SELECT tbl, sql, key FROM hmd_tables WHERE office = $1', [office])).rows;
    // Tables before indexes
    tables.sort((a, b) => Number(a.key === '') - Number(b.key === ''));
    const rows = (await db().query<{ tbl: string; row: string }>('SELECT tbl, row FROM hmd_rows WHERE office = $1', [office])).rows;

    const sqlite = new DatabaseSync(file);
    try {
      sqlite.exec('BEGIN');
      for (const t of tables) sqlite.exec(t.sql);
      const inserts = new Map<string, ReturnType<DatabaseSync['prepare']>>();
      for (const r of rows) {
        const row = JSON.parse(r.row) as Record<string, string | number | null>;
        const cols = Object.keys(row);
        const sig = `${r.tbl}\u0000${cols.join('\u0000')}`;
        let insert = inserts.get(sig);
        if (!insert) {
          insert = sqlite.prepare(`INSERT INTO ${quoteId(r.tbl)} (${cols.map(quoteId).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`);
          inserts.set(sig, insert);
        }
        insert.run(...cols.map((c) => row[c]));
      }
      sqlite.exec('COMMIT');
    } finally {
      sqlite.close();
    }
    console.log(`  ${office}: ${rows.length} rows`);
  }

  const files = (await db().query<{ path: string; size: string; mtime_ms: string }>('SELECT path, size, mtime_ms FROM hmd_files')).rows;
  for (const f of files) {
    const full = insideDataDir(f.path);
    const { data } = (await db().query<{ data: Buffer }>('SELECT data FROM hmd_files WHERE path = $1', [f.path])).rows[0];
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, data);
    const when = Number(f.mtime_ms) / 1000;
    fs.utimesSync(full, when, when);
    known.set(f.path, `${f.size}|${f.mtime_ms}`);
  }
  knownLoaded = true;
  console.log(`  files: ${files.length}`);
}

// ==========================================
// WHILE RUNNING: copy every change
// ==========================================

type Change = { office: string; tbl: string; key: string; row: string | null };
const pending = new Map<string, Change>();
const databases = new Map<string, { db: Mirrorable; path: string }>();
const needsFullCopy = new Set<string>();
let filesDirty = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing: Promise<void> | null = null;
let flushAgain = false;
let failures = 0;
let lastError: string | null = null;
let lastSyncAt: string | null = null;
let lastLoggedError = 0;

const changeKey = (c: { office: string; tbl: string; key: string }) => `${c.office}\u0000${c.tbl}\u0000${c.key}`;

function schedule(delay = 300) {
  if (!CLOUD_ENABLED || timer) return;
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, delay);
}

/** A database file opened by the app. It is copied in full once, then change by change. */
export function registerDatabase(office: string, file: string, database: Mirrorable) {
  if (!CLOUD_ENABLED) return;
  databases.set(office, { db: database, path: relPath(file) });
  needsFullCopy.add(office);
  schedule(0);
}

/** One row was written (row) or deleted (null). */
export function recordRow(office: string, tbl: string, key: string, row: Record<string, unknown> | null) {
  if (!CLOUD_ENABLED) return;
  const c: Change = { office, tbl, key, row: row ? JSON.stringify(row) : null };
  pending.set(changeKey(c), c);
  schedule();
}

/** Files may have changed (an upload, a new logo, the office list). */
export function filesMayHaveChanged(delay = 1000) {
  if (!CLOUD_ENABLED) return;
  filesDirty = true;
  schedule(delay);
}

/** Checks the files once a minute too, for anything written outside a request. */
export function startFileWatch() {
  if (!CLOUD_ENABLED) return;
  filesMayHaveChanged(0);
  setInterval(() => filesMayHaveChanged(0), 60_000).unref();
}

async function flush(): Promise<void> {
  if (flushing) {
    flushAgain = true;
    return flushing;
  }
  flushing = (async () => {
    try {
      for (const office of [...needsFullCopy]) {
        const entry = databases.get(office)!;
        // Read synchronously: the copy includes every change queued so far for this office
        const tables = entry.db.mirrorSnapshot();
        for (const [k, c] of pending) if (c.office === office) pending.delete(k);
        needsFullCopy.delete(office);
        try {
          await copyWholeDatabase(office, entry.path, tables);
        } catch (err) {
          needsFullCopy.add(office);
          throw err;
        }
      }
      if (pending.size) {
        const batch = [...pending.values()];
        pending.clear();
        try {
          await copyChanges(batch);
        } catch (err) {
          // Put them back unless something newer for the same row arrived meanwhile
          for (const c of batch) if (!pending.has(changeKey(c))) pending.set(changeKey(c), c);
          throw err;
        }
      }
      if (filesDirty) {
        filesDirty = false;
        try {
          await syncFiles();
        } catch (err) {
          filesDirty = true;
          throw err;
        }
      }
      failures = 0;
      lastError = null;
      lastSyncAt = new Date().toISOString();
    } catch (err: any) {
      failures++;
      lastError = err?.message ?? String(err);
      if (Date.now() - lastLoggedError > 60_000) {
        lastLoggedError = Date.now();
        console.error(`Could not copy changes to the cloud database (will keep retrying): ${lastError}`);
      }
      schedule(Math.min(30_000, 1000 * 2 ** Math.min(failures, 5)));
    } finally {
      flushing = null;
      if (flushAgain) {
        flushAgain = false;
        schedule(0);
      }
    }
  })();
  return flushing;
}

async function insertRows(client: pg.PoolClient, rows: Change[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const part = rows.slice(i, i + 500);
    await client.query(
      `INSERT INTO hmd_rows (office, tbl, key, row)
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[])
       ON CONFLICT (office, tbl, key) DO UPDATE SET row = excluded.row`,
      [part.map((c) => c.office), part.map((c) => c.tbl), part.map((c) => c.key), part.map((c) => c.row)]
    );
  }
}

async function copyWholeDatabase(office: string, rel: string, tables: MirrorTable[]) {
  const rows: Change[] = [];
  for (const t of tables) for (const r of t.rows) rows.push({ office, tbl: t.name, key: String(r[t.key]), row: JSON.stringify(r) });
  await inTransaction(async (client) => {
    await client.query('INSERT INTO hmd_dbs (office, path) VALUES ($1, $2) ON CONFLICT (office) DO UPDATE SET path = excluded.path', [office, rel]);
    await client.query('DELETE FROM hmd_tables WHERE office = $1', [office]);
    for (const t of tables) await client.query('INSERT INTO hmd_tables (office, tbl, sql, key) VALUES ($1, $2, $3, $4)', [office, t.name, t.sql, t.key]);
    await client.query('DELETE FROM hmd_rows WHERE office = $1', [office]);
    await insertRows(client, rows);
  });
}

async function copyChanges(batch: Change[]) {
  const upserts = batch.filter((c) => c.row !== null);
  const deletes = batch.filter((c) => c.row === null);
  await inTransaction(async (client) => {
    await insertRows(client, upserts);
    if (deletes.length) {
      await client.query(
        `DELETE FROM hmd_rows WHERE (office, tbl, key) IN (SELECT * FROM unnest($1::text[], $2::text[], $3::text[]))`,
        [deletes.map((c) => c.office), deletes.map((c) => c.tbl), deletes.map((c) => c.key)]
      );
    }
  });
}

// ----- Files -----

// What the cloud database holds: path → "size|mtime"
const known = new Map<string, string>();
let knownLoaded = false;

const SKIP_FILE = /(\.db|\.db-wal|\.db-shm|\.db-journal|\.tmp)$/;
const SKIP_NAMES = new Set(['server.lock', '.cloud-dataset']);

function localFiles(): Map<string, { full: string; sig: string; size: number; mtime: number }> {
  const found = new Map<string, { full: string; sig: string; size: number; mtime: number }>();
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      // Backups stay local: the cloud database is itself the off-site copy
      if (e.isDirectory()) {
        if (e.name !== 'backups') walk(full);
      } else if (e.isFile() && !SKIP_FILE.test(e.name) && !SKIP_NAMES.has(e.name)) {
        const st = fs.statSync(full);
        const mtime = Math.floor(st.mtimeMs);
        found.set(relPath(full), { full, sig: `${st.size}|${mtime}`, size: st.size, mtime });
      }
    }
  };
  walk(DATA_DIR);
  return found;
}

async function syncFiles() {
  if (!knownLoaded) {
    for (const r of (await db().query<{ path: string; size: string; mtime_ms: string }>('SELECT path, size, mtime_ms FROM hmd_files')).rows) {
      known.set(r.path, `${r.size}|${r.mtime_ms}`);
    }
    knownLoaded = true;
  }
  const local = localFiles();
  for (const [rel, f] of local) {
    if (known.get(rel) === f.sig) continue;
    let data: Buffer;
    try {
      data = fs.readFileSync(f.full);
    } catch {
      continue; // Removed while we looked
    }
    await db().query(
      'INSERT INTO hmd_files (path, size, mtime_ms, data) VALUES ($1, $2, $3, $4) ON CONFLICT (path) DO UPDATE SET size = excluded.size, mtime_ms = excluded.mtime_ms, data = excluded.data',
      [rel, f.size, f.mtime, data]
    );
    known.set(rel, f.sig);
  }
  const gone = [...known.keys()].filter((rel) => !local.has(rel));
  if (gone.length) {
    await db().query('DELETE FROM hmd_files WHERE path = ANY($1::text[])', [gone]);
    for (const rel of gone) known.delete(rel);
  }
}

// ==========================================
// SHUTDOWN AND STATUS
// ==========================================

/** Sends whatever is still waiting, within the time Render gives before stopping the server. */
export async function flushBeforeExit(timeoutMs = 20_000): Promise<void> {
  if (!CLOUD_ENABLED) return;
  filesDirty = true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    await flush();
    if (!pending.size && !needsFullCopy.size && !filesDirty) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (pending.size || needsFullCopy.size || filesDirty) console.error('Stopping before every change reached the cloud database.');
  await pool?.end().catch(() => undefined);
}

export function cloudStatus() {
  if (!CLOUD_ENABLED) return { enabled: false };
  return { enabled: true, waiting: pending.size + needsFullCopy.size + (filesDirty ? 1 : 0), lastSyncAt, lastError };
}
