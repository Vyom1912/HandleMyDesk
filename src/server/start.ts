import './env';
import { prepareFromCloud } from './cloud';

/*
 * Server entry point (npm start). With DATABASE_URL set, an empty data folder is first filled from
 * the cloud database (see cloud.ts); then the app starts as usual.
 */
try {
  await prepareFromCloud();
} catch (err: any) {
  console.error(`\nCould not prepare the data from the cloud database:\n${err?.message ?? err}\n`);
  process.exit(1);
}
await import('./index');
