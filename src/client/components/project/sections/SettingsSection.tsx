import React, { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { Project, ProjectStage } from '../../../../types';
import { stageOf } from './OverviewSection';
import { api } from '../../../services/api';
import { useApp } from '../../../context/AppContext';
import { useProject } from '../ProjectContext';
import { Button, Field, inputClass, selectClass, textareaClass } from '../../ui/Field';

type Form = Pick<Project, 'name' | 'code' | 'description' | 'category' | 'status' | 'priority' | 'startDate' | 'targetDate'> & {
  stage: ProjectStage;
  budget: string;
  spent: string;
};

const toForm = (p: Project): Form => ({
  name: p.name,
  code: p.code,
  description: p.description,
  category: p.category,
  status: p.status,
  stage: stageOf(p),
  priority: p.priority,
  startDate: p.startDate,
  targetDate: p.targetDate,
  budget: String(p.budget),
  spent: String(p.spent),
});

const Row: React.FC<{ title: string; description: string; children: React.ReactNode }> = ({ title, description, children }) => (
  <div className="grid grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)] gap-x-8 gap-y-3 py-6 border-b border-line last:border-b-0">
    <div>
      <h3 className="text-sm font-medium text-fg">{title}</h3>
      <p className="text-[13px] text-fg-muted mt-0.5">{description}</p>
    </div>
    <div className="space-y-3">{children}</div>
  </div>
);

export const SettingsSection: React.FC = () => {
  const { projectId, project, setProject, canManage, reload } = useProject();
  const { confirm, showToast, navigate, refreshProjects } = useApp();
  const [form, setForm] = useState<Form>(() => toForm(project));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pick up changes made elsewhere (e.g. by a teammate) when there are no unsaved edits here
  const original = toForm(project);
  const dirty = JSON.stringify(form) !== JSON.stringify(original);
  useEffect(() => {
    if (!dirty) setForm(toForm(project));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  const save = async (patch?: Partial<Project>) => {
    setError(null);
    if (!patch && form.targetDate < form.startDate) return setError('Target date must be after the start date');
    setSaving(true);
    try {
      const body = patch ?? { ...form, budget: Number(form.budget), spent: Number(form.spent) };
      const updated = await api.put<Project>(`/api/projects/${projectId}`, body);
      setProject(updated);
      setForm(toForm(updated));
      reload('activity').catch(() => {});
      showToast(patch ? 'Project updated' : 'Settings saved', 'success');
    } catch (err: any) {
      setError(err.message || 'Failed to update settings');
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    const ok = await confirm({
      title: 'Archive project?',
      message: 'Members will lose access until it is restored. Admins and project managers can still open it.',
      confirmLabel: 'Archive',
      danger: true,
    });
    if (ok) save({ status: 'archived' });
  };

  const remove = async () => {
    const ok = await confirm({
      title: 'Delete project permanently?',
      message: 'This deletes the project with all of its tasks, milestones, files, notes, links, chat and history. This cannot be undone.',
      confirmLabel: 'Delete forever',
      danger: true,
      requireText: project.code,
    });
    if (!ok) return;
    try {
      await api.delete(`/api/projects/${projectId}`);
      await refreshProjects();
      navigate({ view: 'projects' });
      showToast(`Deleted ${project.name}`, 'info');
    } catch (err: any) {
      showToast(err.message || 'Failed to delete project', 'error');
    }
  };

  return (
    <div className="max-w-4xl">
      {!canManage && (
        <div className="flex items-start gap-2 mb-2 p-3 rounded-md bg-subtle text-[13px] text-fg-muted">
          <Lock size={14} className="shrink-0 mt-0.5" />
          Only the project lead ({project.leadName}) or an administrator can change these settings.
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <fieldset disabled={!canManage || saving}>
          <Row title="General" description="Name, code and what the project is about.">
            <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_150px] gap-3">
              <Field label="Project name" required>
                <input className={inputClass} value={form.name} onChange={(e) => set({ name: e.target.value })} required />
              </Field>
              <Field label="Code">
                <input className={`${inputClass} font-mono uppercase`} value={form.code} onChange={(e) => set({ code: e.target.value })} maxLength={20} />
              </Field>
            </div>
            <Field label="Category">
              <input className={inputClass} value={form.category} onChange={(e) => set({ category: e.target.value })} />
            </Field>
            <Field label="Description" hint="Shown on the project overview. Markdown supported.">
              <textarea rows={5} className={`${textareaClass} font-mono text-[13px]`} value={form.description} onChange={(e) => set({ description: e.target.value })} />
            </Field>
          </Row>

          <Row title="Status" description="Stage is where the work is; status says whether it's running.">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Stage">
                <select className={selectClass} value={form.stage} onChange={(e) => set({ stage: e.target.value as ProjectStage })}>
                  <option value="planning">Planning</option>
                  <option value="in_progress">In progress</option>
                  <option value="review">Review</option>
                  <option value="delivered">Delivered</option>
                </select>
              </Field>
              <Field label="Status">
                <select className={selectClass} value={form.status} onChange={(e) => set({ status: e.target.value as Project['status'] })}>
                  <option value="active">Active</option>
                  <option value="on_hold">On hold</option>
                  <option value="completed">Completed</option>
                  <option value="archived">Archived</option>
                </select>
              </Field>
              <Field label="Priority">
                <select className={selectClass} value={form.priority} onChange={(e) => set({ priority: e.target.value as Project['priority'] })}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </Field>
            </div>
          </Row>

          <Row title="Schedule & budget" description="Dates and money tracked on the overview.">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Start date">
                <input type="date" className={inputClass} value={form.startDate} onChange={(e) => set({ startDate: e.target.value })} />
              </Field>
              <Field label="Target date">
                <input type="date" className={inputClass} value={form.targetDate} min={form.startDate} onChange={(e) => set({ targetDate: e.target.value })} />
              </Field>
              <Field label="Budget ($)">
                <input type="number" min={0} className={inputClass} value={form.budget} onChange={(e) => set({ budget: e.target.value })} />
              </Field>
              <Field label="Spent to date ($)">
                <input type="number" min={0} className={inputClass} value={form.spent} onChange={(e) => set({ spent: e.target.value })} />
              </Field>
            </div>
          </Row>
        </fieldset>

        {canManage && (
          <div className="sticky bottom-0 -mx-1 px-1 py-3 bg-canvas border-t border-line flex flex-wrap items-center justify-end gap-2">
            {error && (
              <p role="alert" className="mr-auto text-sm text-tone-red-fg">
                {error}
              </p>
            )}
            {dirty && !error && <span className="mr-auto text-[13px] text-fg-faint">Unsaved changes</span>}
            <Button variant="secondary" disabled={!dirty} onClick={() => setForm(original)}>
              Discard
            </Button>
            <Button type="submit" disabled={!dirty || saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        )}
      </form>

      {canManage && (
        <section aria-labelledby="danger-zone" className="mt-10">
          <h3 id="danger-zone" className="text-sm font-medium text-fg mb-2">
            Danger zone
          </h3>
          <div className="border border-line rounded-lg divide-y divide-line">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3">
              <div>
                <div className="text-sm text-fg">{project.status === 'archived' ? 'Restore project' : 'Archive project'}</div>
                <p className="text-[13px] text-fg-muted">
                  {project.status === 'archived' ? 'Make the project active again for its whole team.' : 'Hide it from members without deleting anything.'}
                </p>
              </div>
              {project.status === 'archived' ? (
                <Button variant="secondary" onClick={() => save({ status: 'active' })}>
                  Restore
                </Button>
              ) : (
                <Button variant="secondary" onClick={archive}>
                  Archive
                </Button>
              )}
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3">
              <div>
                <div className="text-sm text-fg">Delete project</div>
                <p className="text-[13px] text-fg-muted">Permanently removes the project and everything in it.</p>
              </div>
              <Button variant="danger" onClick={remove}>
                Delete
              </Button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
};
