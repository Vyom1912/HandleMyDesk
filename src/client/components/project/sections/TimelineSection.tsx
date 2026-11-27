import React, { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { ProjectMilestone } from '../../../../types';
import { api } from '../../../services/api';
import { useApp } from '../../../context/AppContext';
import { useProject } from '../ProjectContext';
import { StatusBadge, formatDate, isOverdue } from '../../ui/Badges';
import { Modal, useDirty } from '../../ui/Modal';
import { Button, Field, IconButton, inputClass, selectClass, textareaClass, EmptyState } from '../../ui/Field';

const MilestoneEditor: React.FC<{ milestone: ProjectMilestone | null; open: boolean; onClose: () => void }> = ({ milestone, open, onClose }) => {
  const { projectId, teamMembers, setMilestones, reload } = useProject();
  const { currentUser } = useApp();
  const [form, setForm] = useState({ title: '', description: '', targetDate: '', status: 'pending', progress: 0, ownerId: '' });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = useDirty(form, open);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm({
      title: milestone?.title ?? '',
      description: milestone?.description ?? '',
      targetDate: milestone?.targetDate ?? new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
      status: milestone?.status ?? 'pending',
      progress: milestone?.progress ?? 0,
      ownerId: milestone?.ownerId ?? currentUser?.id ?? '',
    });
  }, [open, milestone, currentUser]);

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (milestone) {
        const updated = await api.put<ProjectMilestone>(`/api/projects/${projectId}/milestones/${milestone.id}`, form);
        setMilestones((list) => list.map((m) => (m.id === updated.id ? updated : m)));
      } else {
        const created = await api.post<ProjectMilestone>(`/api/projects/${projectId}/milestones`, form);
        setMilestones((list) => [...list, created]);
      }
      reload('activity').catch(() => {});
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
      dirty={dirty && !saving}
      title={milestone ? 'Edit milestone' : 'New milestone'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="milestone-form" disabled={saving}>
            {saving ? 'Saving…' : 'Save milestone'}
          </Button>
        </>
      }
    >
      <form id="milestone-form" onSubmit={submit} className="space-y-3">
        {error && <p role="alert" className="text-sm text-tone-red-fg">{error}</p>}
        <Field label="Title" required>
          <input data-autofocus required className={inputClass} value={form.title} onChange={(e) => set({ title: e.target.value })} />
        </Field>
        <Field label="Description">
          <textarea rows={2} className={textareaClass} value={form.description} onChange={(e) => set({ description: e.target.value })} />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Target date">
            <input type="date" className={inputClass} value={form.targetDate} onChange={(e) => set({ targetDate: e.target.value })} />
          </Field>
          <Field label="Owner">
            <select className={selectClass} value={form.ownerId} onChange={(e) => set({ ownerId: e.target.value })}>
              {teamMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select className={selectClass} value={form.status} onChange={(e) => set({ status: e.target.value })}>
              <option value="pending">Pending</option>
              <option value="in_progress">In progress</option>
              <option value="completed">Completed</option>
            </select>
          </Field>
          <Field label={`Progress · ${form.progress}%`}>
            <input type="range" min={0} max={100} step={5} className="w-full accent-[var(--accent)] mt-2.5" value={form.progress} onChange={(e) => set({ progress: Number(e.target.value) })} />
          </Field>
        </div>
      </form>
    </Modal>
  );
};

export const TimelineSection: React.FC = () => {
  const { projectId, milestones, setMilestones, canManage, reload } = useProject();
  const { deleteWithUndo } = useApp();
  const [editing, setEditing] = useState<ProjectMilestone | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const sorted = [...milestones].sort((a, b) => a.targetDate.localeCompare(b.targetDate));

  const handleDelete = (m: ProjectMilestone) => {
    deleteWithUndo({
      id: m.id,
      message: `Deleted milestone “${m.title}”`,
      hide: () => setMilestones((list) => list.filter((x) => x.id !== m.id)),
      restore: () => setMilestones((list) => (list.some((x) => x.id === m.id) ? list : [...list, m])),
      commit: () => api.delete(`/api/projects/${projectId}/milestones/${m.id}`),
      done: () => reload('activity').catch(() => {}),
    });
  };

  const openEditor = (m: ProjectMilestone | null) => {
    setEditing(m);
    setEditorOpen(true);
  };

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-meta text-fg-muted">Key targets in date order.</p>
        {canManage && (
          <Button onClick={() => openEditor(null)}>
            <Plus size={15} /> New milestone
          </Button>
        )}
      </div>

      {sorted.length === 0 ? (
        <EmptyState message="No milestones yet." />
      ) : (
        <ol className="relative">
          {sorted.map((m, i) => {
            const overdue = m.status !== 'completed' && isOverdue(m.targetDate, false);
            const last = i === sorted.length - 1;
            return (
              <li key={m.id} className="group relative grid grid-cols-[72px_20px_minmax(0,1fr)] gap-x-3">
                <div className={`pt-0.5 text-meta tabular-nums text-right ${overdue ? 'text-tone-red-fg' : 'text-fg-faint'}`}>{formatDate(m.targetDate)}</div>
                <div className="relative flex justify-center">
                  {!last && <span aria-hidden="true" className="absolute top-5 bottom-0 w-px bg-line" />}
                  <span
                    aria-hidden="true"
                    className={`relative mt-1.5 w-2.5 h-2.5 rounded-full border-2 ${
                      m.status === 'completed' ? 'bg-tone-green-fg border-tone-green-fg' : overdue ? 'bg-canvas border-tone-red-fg' : 'bg-canvas border-fg-faint'
                    }`}
                  />
                </div>
                <div className="pb-7 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-medium text-fg">{m.title}</h3>
                    <StatusBadge status={overdue ? 'overdue' : m.status} />
                    {canManage && (
                      <div className="ml-auto flex gap-0.5 hover-reveal">
                        <IconButton label={`Edit ${m.title}`} onClick={() => openEditor(m)}>
                          <Pencil size={14} />
                        </IconButton>
                        <IconButton label={`Delete ${m.title}`} danger onClick={() => handleDelete(m)}>
                          <Trash2 size={14} />
                        </IconButton>
                      </div>
                    )}
                  </div>
                  {m.description && <p className="text-meta text-fg-muted mt-0.5">{m.description}</p>}
                  <div className="flex items-center gap-3 mt-2">
                    <div className="w-40 h-1 rounded-full bg-hover overflow-hidden" role="progressbar" aria-valuenow={m.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`${m.title} progress`}>
                      <div className={`h-full ${m.status === 'completed' ? 'bg-tone-green-fg' : 'bg-accent'}`} style={{ width: `${m.progress}%` }} />
                    </div>
                    <span className="text-xs text-fg-faint">
                      {m.progress}% · {m.ownerName}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <MilestoneEditor open={editorOpen} milestone={editing} onClose={() => setEditorOpen(false)} />
    </div>
  );
};
