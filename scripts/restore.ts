// npm run restore -- <backup file name>
// Replaces the live database with a backup. The server must be stopped first.
import '../src/server/env';
import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { currentDbPath, LOCK_FILE, BACKUP_DIR } from '../src/server/paths';
import { createBackup, listBackups, isBackupName } from '../src/server/backups';

const name = process.argv[2];

if (!name) {
  console.log('Usage: npm run restore -- <backup name>\n\nAvailable backups (newest first):');
  for (const b of listBackups()) console.log(`  ${b.name}   ${(b.sizeBytes / 1024).toFixed(0)} KB`);
  process.exit(0);
}

if (!isBackupName(name) || !fs.existsSync(path.join(BACKUP_DIR, name))) {
  console.error(`Backup "${name}" not found in ${BACKUP_DIR}. Run "npm run restore" to list them.`);
  process.exit(1);
}

// Refuse while a server is using the database, or its in-memory copy would overwrite the restore
if (fs.existsSync(LOCK_FILE)) {
  const pid = Number(fs.readFileSync(LOCK_FILE, 'utf-8'));
  let running = false;
  try {
    process.kill(pid, 0);
    running = true;
  } catch {
    // Stale lock
  }
  if (running) {
    console.error(`The HandleMyDesk server is running (process ${pid}). Stop it, then run the restore again.`);
    process.exit(1);
  }
}

const DB_PATH = currentDbPath();

// Keep the current data, in case the restore was a mistake
if (fs.existsSync(DB_PATH)) {
  const current = new DatabaseSync(DB_PATH, { readOnly: true });
  const safety = createBackup(current, 'prerestore');
  current.close();
  console.log(`Current data saved first as ${safety.name}`);
}

for (const suffix of ['-wal', '-shm']) fs.rmSync(`${DB_PATH}${suffix}`, { force: true });
fs.copyFileSync(path.join(BACKUP_DIR, name), DB_PATH);
console.log(`Restored ${name}. Start the server again with "npm start" (or "npm run dev").`);
