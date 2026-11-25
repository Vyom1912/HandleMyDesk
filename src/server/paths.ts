import path from 'path';
import os from 'os';

// Where everything the server stores on disk lives. Kept free of side effects so the
// backup/restore scripts can use it without opening the database.

export const IS_TEST = process.env.NODE_ENV === 'test';
export const IS_PROD = process.env.NODE_ENV === 'production';

export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), 'data');
export const DB_PATH = path.join(DATA_DIR, 'novadesk.db');
export const LOCK_FILE = path.join(DATA_DIR, 'server.lock');

export const BACKUP_DIR = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : IS_TEST
    ? path.join(os.tmpdir(), 'novadesk-backups-test')
    : path.join(DATA_DIR, 'backups');

// Number of automatic backups to keep (one per day by default)
export const BACKUP_KEEP = Math.max(1, Number(process.env.BACKUP_KEEP) || 30);
