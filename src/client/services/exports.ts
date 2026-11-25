import { api } from './api';

// Downloads a CSV export from the server (it needs the sign-in token, so not a plain link)
export async function downloadCsv(url: string, baseName: string) {
  await api.download(url, `${baseName}-${new Date().toISOString().slice(0, 10)}.csv`);
}
