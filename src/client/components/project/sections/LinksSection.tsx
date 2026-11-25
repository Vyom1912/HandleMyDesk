import React, { useEffect, useState } from 'react';
import { Plus, GitBranch, Globe, AtSign, Server, PenTool, BookText, Link2, ExternalLink, Pencil, Trash2 } from 'lucide-react';
import { ProjectLink } from '../../../../types';
import { api } from '../../../services/api';
import { useApp } from '../../../context/AppContext';
import { useProject } from '../ProjectContext';
import { Modal } from '../../ui/Modal';
import { Button, Field, IconButton, inputClass, selectClass, SectionHeader, EmptyState } from '../../ui/Field';

export const LINK_CATEGORIES: Array<{ value: ProjectLink['category']; label: string; icon: React.ElementType; placeholder: string }> = [
  { value: 'repository', label: 'Repository', icon: GitBranch, placeholder: 'https://github.com/org/repo' },
  { value: 'live', label: 'Live site', icon: Globe, placeholder: 'https://app.example.com' },
  { value: 'domain', label: 'Domain', icon: AtSign, placeholder: 'example.com' },
  { value: 'staging', label: 'Staging', icon: Server, placeholder: 'https://staging.example.com' },
  { value: 'design', label: 'Design', icon: PenTool, placeholder: 'https://www.figma.com/file/…' },
  { value: 'docs', label: 'Docs', icon: BookText, placeholder: 'https://docs.example.com' },
  { value: 'other', label: 'Other', icon: Link2, placeholder: 'https://…' },
];

export const categoryMeta = (c: ProjectLink['category']) => LINK_CATEGORIES.find((x) => x.value === c) ?? LINK_CATEGORIES[LINK_CATEGORIES.length - 1];

export const hostOf = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return url;
  }
};

// People paste bare domains; store them as full URLs
const normalizeUrl = (raw: string) => {
  const v = raw.trim();
  return v && !/^https?:\/\//i.test(v) ? `https://${v}` : v;
};

export const LinkEditor: React.FC<{ link: ProjectLink | null; defaultCategory?: ProjectLink['category']; open: boolean; onClose: () => void }> = ({
  link,
  defaultCategory = 'other',
  open,
  onClose,
}) => {
  const { projectId, setLinks } = useProject();
  const [form, setForm] = useState({ title: '', url: '', category: defaultCategory as ProjectLink['category'], description: '' });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm({ title: link?.title ?? '', url: link?.url ?? '', category: link?.category ?? defaultCategory, description: link?.description ?? '' });
  }, [open, link, defaultCategory]);

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const meta = categoryMeta(form.category);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const body = { ...form, url: normalizeUrl(form.url), title: form.title.trim() || meta.label };
    try {
      if (link) {
        const updated = await api.put<ProjectLink>(`/api/projects/${projectId}/links/${link.id}`, body);
        setLinks((list) => list.map((l) => (l.id === updated.id ? updated : l)));
      } else {
        const created = await api.post<ProjectLink>(`/api/projects/${projectId}/links`, body);
        setLinks((list) => [created, ...list]);
      }
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={link ? 'Edit link' : 'Add link'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="link-form" disabled={saving || !form.url.trim()}>
            {saving ? 'Saving…' : 'Save link'}
          </Button>
        </>
      }
    >
      <form id="link-form" onSubmit={submit} className="space-y-3">
        {error && <p role="alert" className="text-sm text-tone-red-fg">{error}</p>}
        <Field label="Type">
          <select className={selectClass} value={form.category} onChange={(e) => set({ category: e.target.value as ProjectLink['category'] })}>
            {LINK_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="URL" required hint={form.category === 'domain' ? 'A bare domain like example.com is fine' : undefined}>
          <input data-autofocus required className={inputClass} value={form.url} onChange={(e) => set({ url: e.target.value })} placeholder={meta.placeholder} />
        </Field>
        <Field label="Title" hint={`Defaults to “${meta.label}”`}>
          <input className={inputClass} value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder={meta.label} />
        </Field>
        <Field label="Note">
          <input className={inputClass} value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="e.g. Main branch deploys automatically" />
        </Field>
      </form>
    </Modal>
  );
};

export const LinksSection: React.FC = () => {
  const { projectId, links, setLinks, canManage } = useProject();
  const { currentUser, confirm, showToast } = useApp();
  const [editing, setEditing] = useState<ProjectLink | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const remove = async (link: ProjectLink) => {
    const ok = await confirm({ title: 'Remove link?', message: `“${link.title}” will be removed from the project.`, confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    try {
      await api.delete(`/api/projects/${projectId}/links/${link.id}`);
      setLinks((list) => list.filter((l) => l.id !== link.id));
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const grouped = LINK_CATEGORIES.map((c) => ({ ...c, items: links.filter((l) => l.category === c.value) })).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-6 max-w-4xl">
      <SectionHeader
        title="Links"
        subtitle="Repositories, live and staging sites, domains, designs and docs"
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setEditorOpen(true);
            }}
          >
            <Plus size={15} /> Add link
          </Button>
        }
      />

      {links.length === 0 ? (
        <EmptyState message="No links yet. Add the repository, live site and domain so everyone can find them." />
      ) : (
        grouped.map((group) => (
          <section key={group.value} aria-labelledby={`links-${group.value}`}>
            <h3 id={`links-${group.value}`} className="flex items-center gap-1.5 text-[13px] font-medium text-fg-muted mb-1.5">
              <group.icon size={14} /> {group.label}
            </h3>
            <ul className="border border-line rounded-lg divide-y divide-line">
              {group.items.map((link) => {
                const canEdit = link.addedById === currentUser?.id || canManage;
                return (
                  <li key={link.id} className="group flex items-center gap-3 px-3 py-2.5 hover:bg-subtle">
                    <a href={link.url} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 text-sm text-fg font-medium">
                        <span className="truncate">{link.title}</span>
                        <ExternalLink size={12} className="text-fg-faint shrink-0" aria-label="(opens in a new tab)" />
                      </div>
                      <div className="text-[13px] text-fg-faint truncate">
                        {hostOf(link.url)}
                        {link.description && ` · ${link.description}`}
                      </div>
                    </a>
                    {canEdit && (
                      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                        <IconButton
                          label={`Edit ${link.title}`}
                          onClick={() => {
                            setEditing(link);
                            setEditorOpen(true);
                          }}
                        >
                          <Pencil size={14} />
                        </IconButton>
                        <IconButton label={`Remove ${link.title}`} danger onClick={() => remove(link)}>
                          <Trash2 size={14} />
                        </IconButton>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      <LinkEditor open={editorOpen} link={editing} onClose={() => setEditorOpen(false)} />
    </div>
  );
};
