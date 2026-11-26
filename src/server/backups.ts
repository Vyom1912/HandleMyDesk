import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { BACKUP_DIR, BACKUP_KEEP } from './paths';

// Every office has its own backup folder; `dir` defaults to the main office's (BACKUP_DIR).

export interface BackupInfo {
  name: string;
  sizeBytes: number;
  createdAt: string;
}

// Backups made before the rename start with "novadesk-"; they stay listed and restorable
const NAME_PATTERN = /^(handlemydesk|novadesk)-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(-[a-z]+)?\.db$/;

export const isBackupName = (name: string) => NAME_PATTERN.test(name);

export function backupPath(name: string, dir: string = BACKUP_DIR): string {
  if (!isBackupName(name)) throw new Error('Invalid backup name');
  return path.join(dir, name);
}

/**
 * Writes a consistent copy of the database with SQLite's VACUUM INTO. Safe while the server
 * is running and writing. `label` marks why it was taken (manual, pre-restore…).
 */
export function createBackup(source: DatabaseSync, label?: string, dir: string = BACKUP_DIR): BackupInfo {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  const name = `handlemydesk-${stamp}${label ? `-${label}` : ''}.db`;
  const target = path.join(dir, name);
  // A backup from this same second already holds the same data
  if (!fs.existsSync(target)) source.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  return { name, sizeBytes: fs.statSync(target).size, createdAt: new Date().toISOString() };
}

export function listBackups(dir: string = BACKUP_DIR): BackupInfo[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(isBackupName)
    .map((name) => {
      const stat = fs.statSync(path.join(dir, name));
      return { name, sizeBytes: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// Keep the newest automatic backups; labelled ones (manual, pre-restore) are kept until removed by hand
export function pruneBackups(keep = BACKUP_KEEP, dir: string = BACKUP_DIR): string[] {
  const automatic = listBackups(dir).filter((b) => !/-[a-z]+\.db$/.test(b.name));
  const removed = automatic.slice(keep).map((b) => b.name);
  for (const name of removed) fs.rmSync(path.join(dir, name), { force: true });
  return removed;
}
