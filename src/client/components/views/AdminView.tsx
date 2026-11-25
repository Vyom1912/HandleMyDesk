import React, { useCallback, useEffect, useState } from 'react';
import { Download, DatabaseBackup } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { BackupInfo } from '../../../types';
import { Button } from '../ui/Field';
import { formatDateTime, timeAgo } from '../ui/Badges';
import { PageShell } from '../layout/PageShell';

const size = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`);

export const AdminView: React.FC = () => {
  const { currentUser, navigate, showToast } = useApp();
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const [directory, setDirectory] = useState('');
  const [keep, setKeep] = useState(30);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ backups: BackupInfo[]; directory: string; keep: number }>('/api/admin/backups');
      setBackups(res.backups);
      setDirectory(res.directory);
      setKeep(res.keep);
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (currentUser?.role === 'admin') load();
  }, [currentUser?.role, load]);

  if (currentUser?.role !== 'admin') {
    return (
      <PageShell title="Admin">
        <p className="text-sm text-fg-muted">Only administrators can open this page.</p>
      </PageShell>
    );
  }

  const backupNow = async () => {
    setWorking(true);
    try {
      const info = await api.post<BackupInfo>('/api/admin/backups');
      showToast(`Backup saved: ${info.name}`, 'success');
      await load();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setWorking(false);
    }
  };

  const download = async (b: BackupInfo) => {
    try {
      await api.download(`/api/admin/backups/${encodeURIComponent(b.name)}/download`, b.name);
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const newest = backups[0];

  return (
    <PageShell title="Admin" description="Workspace administration" width="narrow">
      <section className="mb-10">
        <h2 className="text-base font-semibold text-fg">People</h2>
        <p className="text-sm text-fg-muted mt-1">Add people, change roles, reset passwords and deactivate accounts from the Team page.</p>
        <Button variant="secondary" className="mt-3" onClick={() => navigate({ view: 'team' })}>
          Manage people
        </Button>
      </section>

      <section aria-labelledby="backups-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="backups-heading" className="text-base font-semibold text-fg">
              Backups
            </h2>
            <p className="text-sm text-fg-muted mt-1">
              A copy of all data is saved automatically once a day; the newest {keep} daily copies are kept. Manual backups are kept until removed.
            </p>
          </div>
          <Button onClick={backupNow} disabled={working}>
            <DatabaseBackup size={15} /> {working ? 'Backing up…' : 'Back up now'}
          </Button>
        </div>

        <div className={`mt-4 p-3 rounded-md text-[13px] ${newest ? 'bg-subtle text-fg-muted' : 'bg-tone-amber-bg text-tone-amber-fg'}`}>
          {newest ? (
            <>
              Last backup <strong className="text-fg font-medium">{timeAgo(newest.createdAt)}</strong>. Files are stored on the server in{' '}
              <code className="font-mono text-fg break-all">{directory}</code>. Copy them somewhere else regularly (another disk or cloud storage) so a broken
              disk can't take the backups with it.
            </>
          ) : (
            'No backups yet. Take one now.'
          )}
        </div>

        {loading ? (
          <p className="text-sm text-fg-muted py-6" role="status">
            Loading…
          </p>
        ) : (
          backups.length > 0 && (
            <ul className="mt-4 border border-line rounded-lg divide-y divide-line">
              {backups.map((b) => (
                <li key={b.name} className="flex items-center gap-3 px-3 py-2 hover:bg-subtle">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-fg font-mono truncate">{b.name}</div>
                    <div className="text-xs text-fg-faint">
                      {formatDateTime(b.createdAt)} · {size(b.sizeBytes)}
                      {/-manual\.db$/.test(b.name) && ' · manual'}
                      {/-prerestore\.db$/.test(b.name) && ' · saved before a restore'}
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => download(b)}>
                    <Download size={14} /> Download
                  </Button>
                </li>
              ))}
            </ul>
          )
        )}

        <div className="mt-6 text-[13px] text-fg-muted">
          <h3 className="text-sm font-medium text-fg mb-1">Restoring a backup</h3>
          Restoring replaces all current data, so it's done on the server: stop NovaDesk, run <code className="font-mono text-fg">npm run restore -- &lt;file name&gt;</code>,
          then start it again. The current data is saved first, just in case. See SETUP.md.
        </div>
      </section>
    </PageShell>
  );
};
