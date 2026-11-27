import React, { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Check, X, Send } from 'lucide-react';
import { ProjectDeliverable } from '../../../../types';
import { api } from '../../../services/api';
import { useApp } from '../../../context/AppContext';
import { useProject } from '../ProjectContext';
import { StatusBadge, formatDate, isOverdue } from '../../ui/Badges';
import { Modal, useDirty } from '../../ui/Modal';
import { Button, Field, IconButton, inputClass, selectClass, textareaClass, EmptyState } from '../../ui/Field';

const DeliverableEditor: React.FC<{ deliverable: ProjectDeliverable | null; open: boolean; onClose: () => void }> = ({ deliverable, open, onClose }) => {
  const { projectId, teamMembers, setDeliverables, reload } = useProject();
  const { currentUser } = useApp();
  const [form, setForm] = useState({ title: '', description: '', dueDate: '', ownerId: '' });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = useDirty(form, open);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm({
      title: deliverable?.title ?? '',
      description: deliverable?.description ?? '',
      dueDate: deliverable?.dueDate ?? new Date(Date.now() + 45 * 86400000).toISOString().split('T')[0],
      ownerId: deliverable?.ownerId ?? currentUser?.id ?? '',
    });
  }, [open, deliverable, currentUser]);

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (deliverable) {
        const updated = await api.put<ProjectDeliverable>(`/api/projects/${projectId}/deliverables/${deliverable.id}`, form);
        setDeliverables((list) => list.map((d) => (d.id === updated.id ? updated : d)));
      } else {
        const created = await api.post<ProjectDeliverable>(`/api/projects/${projectId}/deliverables`, form);
        setDeliverables((list) => [...list, created]);
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
      title={deliverable ? 'Edit deliverable' : 'New deliverable'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="deliverable-form" disabled={saving}>
            {saving ? 'Saving…' : 'Save deliverable'}
          </Button>
        </>
      }
    >
      <form id="deliverable-form" onSubmit={submit} className="space-y-3">
        {error && <p role="alert" className="text-sm text-tone-red-fg">{error}</p>}
        <Field label="Title" required>
          <input data-autofocus required className={inputClass} value={form.title} onChange={(e) => set({ title: e.target.value })} />
        </Field>
        <Field label="Description">
          <textarea rows={2} className={textareaClass} value={form.description} onChange={(e) => set({ description: e.target.value })} />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Due date">
            <input type="date" className={inputClass} value={form.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />
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
        </div>
      </form>
    </Modal>
  );
};

export const DeliverablesSection: React.FC = () => {
  const { projectId, deliverables, setDeliverables, canManage, reload } = useProject();
  const { showToast, deleteWithUndo } = useApp();
  const [editing, setEditing] = useState<ProjectDeliverable | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const setStatus = async (d: ProjectDeliverable, status: ProjectDeliverable['status']) => {
    try {
      const updated = await api.put<ProjectDeliverable>(`/api/projects/${projectId}/deliverables/${d.id}`, { status });
      setDeliverables((list) => list.map((x) => (x.id === d.id ? updated : x)));
      reload('activity').catch(() => {});
      if (status === 'approved') showToast(`“${d.title}” signed off`, 'success');
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const handleDelete = (d: ProjectDeliverable) => {
    deleteWithUndo({
      id: d.id,
      message: `Deleted deliverable “${d.title}”`,
      hide: () => setDeliverables((list) => list.filter((x) => x.id !== d.id)),
      restore: () => setDeliverables((list) => (list.some((x) => x.id === d.id) ? list : [...list, d])),
      commit: () => api.delete(`/api/projects/${projectId}/deliverables/${d.id}`),
    });
  };

  const sorted = [...deliverables].sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-meta text-fg-muted">Formal deliverables and their sign-off.</p>
        {canManage && (
          <Button
            onClick={() => {
              setEditing(null);
              setEditorOpen(true);
            }}
          >
            <Plus size={15} /> New deliverable
          </Button>
        )}
      </div>

      {sorted.length === 0 ? (
        <EmptyState message="No deliverables yet." />
      ) : (
        <ul className="border border-line rounded-lg divide-y divide-line">
          {sorted.map((d) => {
            const overdue = d.status !== 'approved' && isOverdue(d.dueDate, false);
            return (
              <li key={d.id} className="group px-4 py-3 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-subtle">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-medium text-fg">{d.title}</h3>
                    <StatusBadge status={d.status} />
                  </div>
                  {d.description && <p className="text-meta text-fg-muted mt-0.5">{d.description}</p>}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-fg-faint mt-1">
                    <span>{d.ownerName}</span>
                    <span className={overdue ? 'text-tone-red-fg' : ''}>Due {formatDate(d.dueDate)}</span>
                    {d.signedOffBy && d.signedOffAt && (
                      <span className="text-tone-green-fg">
                        Signed off by {d.signedOffBy}, {formatDate(d.signedOffAt)}
                      </span>
                    )}
                  </div>
                </div>

                {canManage && (
                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    {d.status === 'pending' && (
                      <Button size="sm" variant="secondary" onClick={() => setStatus(d, 'in_review')}>
                        <Send size={13} /> Send to review
                      </Button>
                    )}
                    {d.status !== 'approved' && (
                      <Button size="sm" variant="secondary" onClick={() => setStatus(d, 'approved')}>
                        <Check size={13} className="text-tone-green-fg" /> Approve
                      </Button>
                    )}
                    {d.status !== 'rejected' && (
                      <Button size="sm" variant="secondary" onClick={() => setStatus(d, 'rejected')}>
                        <X size={13} className="text-tone-red-fg" /> {d.status === 'approved' ? 'Revoke' : 'Reject'}
                      </Button>
                    )}
                    <IconButton
                      label={`Edit ${d.title}`}
                      onClick={() => {
                        setEditing(d);
                        setEditorOpen(true);
                      }}
                    >
                      <Pencil size={14} />
                    </IconButton>
                    <IconButton label={`Delete ${d.title}`} danger onClick={() => handleDelete(d)}>
                      <Trash2 size={14} />
                    </IconButton>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <DeliverableEditor open={editorOpen} deliverable={editing} onClose={() => setEditorOpen(false)} />
    </div>
  );
};
