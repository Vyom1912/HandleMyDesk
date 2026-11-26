import React, { useCallback, useEffect, useState } from 'react';
import { Download, DatabaseBackup } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { BackupInfo, ProjectTemplate } from '../../../types';
import { Button } from '../ui/Field';
import { formatDateTime, timeAgo } from '../ui/Badges';
import { PageShell } from '../layout/PageShell';
import { BrandingSection, ExportSection } from './AdminSections';
import { ListSkeleton } from '../ui/Skeleton';

const size = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`);

/** Built-in and office-made project templates; office-made ones can be removed. */
const TemplatesSection: React.FC = () => {
  const { confirm, showToast } = useApp();
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);

  const load = useCallback(() => {
    api.get<ProjectTemplate[]>('/api/templates').then(setTemplates).catch((err) => showToast(err.message, 'error'));
  }, [showToast]);
  useEffect(load, [load]);

  const remove = async (t: ProjectTemplate) => {
    const ok = await confirm({ title: `Delete “${t.name}”?`, message: 'Projects already made from it are not affected.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api.delete(`/api/templates/${t.id}`);
      load();
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  return (
    <section className="mb-10" aria-labelledby="templates-heading">
      <h2 id="templates-heading" className="text-base font-semibold text-fg">
        Project templates
      </h2>
      <p className="text-sm text-fg-muted mt-1">
        Offered under New project → Start from. Project leads add their own with Settings → Save as template.
      </p>
      <ul className="mt-3 border border-line rounded-lg divide-y divide-line">
        {templates.map((t) => (
          <li key={t.id} className="flex items-center gap-3 px-3 py-2 hover:bg-subtle">
            <div className="flex-1 min-w-0">
              <div className="text-sm text-fg">{t.name}</div>
              <div className="text-xs text-fg-faint truncate">
                {t.tasks.length} tasks · {t.milestones.length} milestones · {t.builtIn ? 'built in' : `by ${t.createdByName ?? 'someone'}`}
              </div>
            </div>
            {!t.builtIn && (
              <Button variant="ghost" size="sm" onClick={() => remove(t)}>
                Delete
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
};

/** Whether company single sign-on is on; it's switched on in the server's .env file. */
const SignInSection: React.FC = () => {
  const [sso, setSso] = useState<{ enabled: boolean; label?: string } | null>(null);
  useEffect(() => {
    api.get<{ enabled: boolean; label?: string }>('/api/auth/sso/config').then(setSso).catch(() => setSso({ enabled: false }));
  }, []);
  return (
    <section className="mb-10" aria-labelledby="signin-heading">
      <h2 id="signin-heading" className="text-base font-semibold text-fg">
        Sign-in
      </h2>
      <p className="text-sm text-fg-muted mt-1">
        {sso?.enabled
          ? `Company single sign-on is on: people can sign in with ${sso.label}. Passwords still work, for example for accounts outside the company directory.`
          : 'People sign in with email and password. Company single sign-on (Microsoft 365, Google Workspace and others) can be switched on in the server settings; see SETUP.md.'}
      </p>
    </section>
  );
};

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

      <BrandingSection />
      <ExportSection />
      <TemplatesSection />
      <SignInSection />

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
          <ListSkeleton rows={3} label="Loading backups" className="mt-4" />
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
          Restoring replaces all current data, so it's done on the server: stop HandleMyDesk, run <code className="font-mono text-fg">npm run restore -- &lt;file name&gt;</code>,
          then start it again. The current data is saved first, just in case. See SETUP.md.
        </div>
      </section>
    </PageShell>
  );
};
