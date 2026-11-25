// npm run backup: copy the database to data/backups now. Safe while the server is running.
import '../src/server/env';
import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH, BACKUP_DIR } from '../src/server/paths';
import { createBackup } from '../src/server/backups';

if (!fs.existsSync(DB_PATH)) {
  console.error(`No database found at ${DB_PATH}`);
  process.exit(1);
}

const source = new DatabaseSync(DB_PATH, { readOnly: true });
const info = createBackup(source, 'manual');
source.close();
console.log(`Backup saved: ${path.join(BACKUP_DIR, info.name)} (${(info.sizeBytes / 1024).toFixed(0)} KB)`);
