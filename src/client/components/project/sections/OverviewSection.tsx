import React, { useState } from 'react';
import { Pencil, Plus, ExternalLink, Check } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { useProject } from '../ProjectContext';
import { api } from '../../../services/api';
import { Project, Task, ProjectLink, ProjectStage } from '../../../../types';
import { Avatar, PriorityBadge, StatusBadge, Tag, formatDate, isOverdue, timeAgo } from '../../ui/Badges';
import { Button, textareaClass } from '../../ui/Field';
import { Markdown } from '../../ui/Markdown';
import { TaskCheckbox } from './TasksSection';
import { LINK_CATEGORIES, LinkEditor, hostOf } from './LinksSection';

const today = () => new Date().toISOString().split('T')[0];

export function projectHealth(project: Project, tasks: Task[]) {
  if (project.status === 'completed') return { label: 'Completed', tone: 'blue' as const, reasons: [] as string[] };
  if (project.status === 'on_hold') return { label: 'Paused', tone: 'amber' as const, reasons: ['Project is on hold'] };
  if (project.status === 'archived') return { label: 'Archived', tone: 'gray' as const, reasons: [] as string[] };

  const reasons: string[] = [];
  const overdue = tasks.filter((t) => isOverdue(t.dueDate, t.status === 'done')).length;
  if (overdue > 0) reasons.push(`${overdue} overdue task${overdue === 1 ? '' : 's'}`);
  if (project.spent > project.budget) reasons.push('Over budget');
  const start = Date.parse(project.startDate);
  const end = Date.parse(project.targetDate);
  if (end > start) {
    const elapsed = Math.min(1, Math.max(0, (Date.now() - start) / (end - start)));
    if (elapsed - project.completionPercentage / 100 > 0.25) reasons.push('Behind schedule');
  }
  if (project.targetDate < today()) reasons.push('Past target date');

  if (reasons.length === 0) return { label: 'On track', tone: 'green' as const, reasons };
  if (reasons.length === 1) return { label: 'Needs attention', tone: 'amber' as const, reasons };
  return { label: 'At risk', tone: 'red' as const, reasons };
}

const DESCRIPTION_PLACEHOLDER = `## Goal
What this project delivers and for whom.

## Scope
- Key feature or deliverable
- Another one

## Notes
Anything the team should know: environments, access, contacts.`;

const STAGES: Array<{ value: ProjectStage; label: string; hint: string }> = [
  { value: 'planning', label: 'Planning', hint: 'Scope, plan and team' },
  { value: 'in_progress', label: 'In progress', hint: 'The work is being done' },
  { value: 'review', label: 'Review', hint: 'Internal or client review' },
  { value: 'delivered', label: 'Delivered', hint: 'Handed over' },
];

// Projects created before stages existed have none: infer one from their status
export const stageOf = (p: Project): ProjectStage => p.stage ?? (p.status === 'completed' ? 'delivered' : 'in_progress');

/** Where the project is, as four steps. The lead (or an admin) clicks a step to move it. */
const StageTracker: React.FC = () => {
  const { projectId, project, setProject, canManage } = useProject();
  const { showToast } = useApp();
  const current = STAGES.findIndex((s) => s.value === stageOf(project));

  const move = async (stage: ProjectStage) => {
    if (!canManage || stage === stageOf(project)) return;
    try {
      setProject(await api.put<Project>(`/api/projects/${projectId}`, { stage }));
    } catch (err: any) {
      showToast(err.message || 'Could not change the stage', 'error');
    }
  };

  return (
    <section aria-label="Project stage">
      <ol className="grid grid-cols-4 gap-1.5">
        {STAGES.map((s, i) => {
          const state = i < current ? 'done' : i === current ? 'current' : 'next';
          return (
            <li key={s.value}>
              <button
                onClick={() => move(s.value)}
                disabled={!canManage}
                aria-current={state === 'current' ? 'step' : undefined}
                title={canManage && state !== 'current' ? `Move the project to ${s.label}` : s.hint}
                className={`w-full text-left rounded-md px-2.5 py-2 border transition-colors disabled:cursor-default ${
                  state === 'current'
                    ? 'border-accent bg-accent-soft'
                    : state === 'done'
                      ? 'border-line bg-subtle enabled:hover:bg-hover'
                      : 'border-dashed border-line-strong enabled:hover:bg-hover'
                }`}
              >
                <span className={`block h-1 rounded-full mb-2 ${state === 'next' ? 'bg-hover' : 'bg-accent'}`} aria-hidden="true" />
                <span className={`flex items-center gap-1.5 text-meta font-medium ${state === 'next' ? 'text-fg-muted' : 'text-fg'}`}>
                  {state === 'done' && <Check size={13} className="text-accent-ink shrink-0" aria-label="Done:" />}
                  <span className="truncate">{s.label}</span>
                </span>
                <span className="hidden md:block text-xs text-fg-faint truncate mt-0.5">{s.hint}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {canManage && <p className="text-xs text-fg-faint mt-1.5">Click a step to move the project. The team is notified.</p>}
    </section>
  );
};

const AboutBlock: React.FC = () => {
  const { projectId, project, setProject, canManage } = useProject();
  const { showToast } = useApp();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const start = () => {
    setDraft(project.description);
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      setProject(await api.put<Project>(`/api/projects/${projectId}`, { description: draft }));
      setEditing(false);
    } catch (err: any) {
      showToast(err.message || 'Could not save the description', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="about-heading">
      <div className="flex items-center justify-between mb-2">
        <h2 id="about-heading" className="text-meta font-medium text-fg-muted">
          About this project
        </h2>
        {canManage && !editing && (
          <button onClick={start} className="h-10 pointer-fine:h-7 px-2.5 pointer-fine:px-2 flex items-center gap-1.5 rounded-md text-meta text-fg-muted hover:bg-hover hover:text-fg">
            <Pencil size={13} /> Edit
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea
            autoFocus
            rows={14}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') save();
              if (e.key === 'Escape') setEditing(false);
            }}
            placeholder={DESCRIPTION_PLACEHOLDER}
            className={`${textareaClass} font-mono text-meta leading-relaxed`}
            aria-label="Project description"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-fg-faint">
              Markdown supported: <code className="font-mono">## heading</code>, <code className="font-mono">- list</code>, <code className="font-mono">- [ ] checklist</code>, <code className="font-mono">**bold**</code>, links. Ctrl+Enter to save.
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </div>
      ) : project.description.trim() ? (
        <Markdown source={project.description} />
      ) : canManage ? (
        <button onClick={start} className="w-full text-left px-3 py-6 rounded-lg border border-dashed border-line-strong text-sm text-fg-faint hover:bg-subtle">
          Describe the project: goals, scope, environments and anything the team needs to know.
        </button>
      ) : (
        <p className="text-sm text-fg-faint">The project lead hasn't written a description yet.</p>
      )}
    </section>
  );
};

const KeyLinks: React.FC = () => {
  const { links } = useProject();
  const [editorOpen, setEditorOpen] = useState(false);
  const [category, setCategory] = useState<ProjectLink['category']>('repository');

  const primary = LINK_CATEGORIES.filter((c) => ['repository', 'live', 'domain', 'staging'].includes(c.value));
  const others = links.filter((l) => !['repository', 'live', 'domain', 'staging'].includes(l.category));

  const add = (c: ProjectLink['category']) => {
    setCategory(c);
    setEditorOpen(true);
  };

  return (
    <section aria-labelledby="links-heading">
      <div className="flex items-center justify-between mb-1.5">
        <h2 id="links-heading" className="text-meta font-medium text-fg-muted">
          Links
        </h2>
        <button onClick={() => add('other')} className="w-10 h-10 pointer-fine:w-7 pointer-fine:h-7 flex items-center justify-center rounded-md text-fg-faint hover:bg-hover hover:text-fg" aria-label="Add link" title="Add link">
          <Plus size={14} />
        </button>
      </div>
      <ul className="space-y-px">
        {primary.map((c) => {
          const items = links.filter((l) => l.category === c.value);
          if (items.length === 0) {
            return (
              <li key={c.value}>
                <button onClick={() => add(c.value)} className="w-full flex items-center gap-2.5 h-10 pointer-fine:h-8 px-2 rounded-md text-meta text-fg-faint hover:bg-hover">
                  <c.icon size={14} className="shrink-0" />
                  <span>Add {c.label.toLowerCase()}</span>
                </button>
              </li>
            );
          }
          return items.map((l) => (
            <li key={l.id}>
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="group flex items-center gap-2.5 h-10 pointer-fine:h-8 px-2 rounded-md hover:bg-hover" title={l.url}>
                <c.icon size={14} className="shrink-0 text-fg-muted" />
                <span className="text-meta text-fg-muted w-20 shrink-0">{c.label}</span>
                <span className="text-meta text-fg truncate">{hostOf(l.url)}</span>
                <ExternalLink size={12} className="ml-auto shrink-0 text-fg-faint hover-reveal" aria-hidden="true" />
              </a>
            </li>
          ));
        })}
        {others.map((l) => {
          const c = LINK_CATEGORIES.find((x) => x.value === l.category)!;
          return (
            <li key={l.id}>
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="group flex items-center gap-2.5 h-10 pointer-fine:h-8 px-2 rounded-md hover:bg-hover" title={l.url}>
                <c.icon size={14} className="shrink-0 text-fg-muted" />
                <span className="text-meta text-fg truncate">{l.title}</span>
                <ExternalLink size={12} className="ml-auto shrink-0 text-fg-faint hover-reveal" aria-hidden="true" />
              </a>
            </li>
          );
        })}
      </ul>
      <LinkEditor open={editorOpen} link={null} defaultCategory={category} onClose={() => setEditorOpen(false)} />
    </section>
  );
};

const Property: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-start gap-3 min-h-8 py-1">
    <dt className="w-24 shrink-0 text-meta text-fg-faint pt-0.5">{label}</dt>
    <dd className="flex-1 min-w-0 text-meta text-fg pt-0.5">{children}</dd>
  </div>
);

export const OverviewSection: React.FC = () => {
  const { project, tasks, milestones, teamMembers, activities, goToSection, updateTask, openTaskEditor } = useProject();

  const health = projectHealth(project, tasks);
  const openTasks = tasks.filter((t) => t.status !== 'done');
  const overdueCount = openTasks.filter((t) => isOverdue(t.dueDate, false)).length;
  const upcoming = milestones.filter((m) => m.status !== 'completed').sort((a, b) => a.targetDate.localeCompare(b.targetDate));
  const focus = [...openTasks]
    .sort((a, b) => {
      const rank = { urgent: 0, high: 1, medium: 2, low: 3 };
      return rank[a.priority] - rank[b.priority] || a.dueDate.localeCompare(b.dueDate);
    })
    .slice(0, 5);
  const budgetPct = project.budget ? Math.round((project.spent / project.budget) * 100) : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-x-12 gap-y-8">
      {/* Main column */}
      <div className="space-y-10 min-w-0">
        <StageTracker />
        <AboutBlock />

        <section aria-labelledby="progress-heading">
          <h2 id="progress-heading" className="text-meta font-medium text-fg-muted mb-3">
            Progress
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 border border-line rounded-lg divide-x divide-line overflow-hidden">
            {[
              { label: 'Complete', value: `${project.completionPercentage}%` },
              { label: 'Open tasks', value: openTasks.length },
              { label: 'Overdue', value: overdueCount, warn: overdueCount > 0 },
              { label: 'Milestones', value: `${milestones.length - upcoming.length}/${milestones.length}` },
            ].map((s, i) => (
              <div key={s.label} className={`px-4 py-3 ${i >= 2 ? 'border-t sm:border-t-0 border-line' : ''}`}>
                <div className={`text-xl font-semibold tabular-nums ${s.warn ? 'text-tone-red-fg' : 'text-fg'}`}>{s.value}</div>
                <div className="text-xs text-fg-faint mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 h-1.5 rounded-full bg-hover overflow-hidden" role="progressbar" aria-valuenow={project.completionPercentage} aria-valuemin={0} aria-valuemax={100} aria-label="Project completion">
            <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${project.completionPercentage}%` }} />
          </div>
        </section>

        <section aria-labelledby="focus-heading">
          <div className="flex items-center justify-between mb-2">
            <h2 id="focus-heading" className="text-meta font-medium text-fg-muted">
              Priority work
            </h2>
            <button onClick={() => goToSection('tasks')} className="py-2.5 -my-2.5 pointer-fine:py-0 pointer-fine:my-0 text-meta text-fg-muted hover:text-fg">
              All tasks →
            </button>
          </div>
          {focus.length === 0 ? (
            <p className="text-sm text-fg-faint">No open tasks.</p>
          ) : (
            <ul className="border border-line rounded-lg divide-y divide-line">
              {focus.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-3 py-2 hover:bg-subtle">
                  <TaskCheckbox task={t} onToggle={() => updateTask(t, { status: t.status === 'done' ? 'todo' : 'done' })} />
                  <button onClick={() => openTaskEditor(t)} className="flex-1 min-w-0 text-left py-2.5 -my-2.5 pointer-fine:py-0 pointer-fine:my-0">
                    <div className="text-sm text-fg truncate">{t.title}</div>
                  </button>
                  <span className={`hidden sm:inline text-xs shrink-0 ${isOverdue(t.dueDate, false) ? 'text-tone-red-fg' : 'text-fg-faint'}`}>{formatDate(t.dueDate)}</span>
                  <Avatar src={t.assigneeAvatar} name={t.assigneeName} size={20} />
                  <PriorityBadge priority={t.priority} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="milestones-heading">
          <div className="flex items-center justify-between mb-2">
            <h2 id="milestones-heading" className="text-meta font-medium text-fg-muted">
              Upcoming milestones
            </h2>
            <button onClick={() => goToSection('timeline')} className="py-2.5 -my-2.5 pointer-fine:py-0 pointer-fine:my-0 text-meta text-fg-muted hover:text-fg">
              All milestones →
            </button>
          </div>
          {upcoming.length === 0 ? (
            <p className="text-sm text-fg-faint">No upcoming milestones.</p>
          ) : (
            <ul className="space-y-2">
              {upcoming.slice(0, 4).map((m) => {
                const overdue = isOverdue(m.targetDate, false);
                return (
                  <li key={m.id} className="flex items-center gap-3">
                    <span className={`text-xs tabular-nums w-16 shrink-0 ${overdue ? 'text-tone-red-fg' : 'text-fg-faint'}`}>{formatDate(m.targetDate)}</span>
                    <span className="text-sm text-fg flex-1 min-w-0 truncate">{m.title}</span>
                    <div className="w-20 h-1 rounded-full bg-hover overflow-hidden hidden sm:block" aria-hidden="true">
                      <div className="h-full bg-fg-faint" style={{ width: `${m.progress}%` }} />
                    </div>
                    <StatusBadge status={overdue ? 'overdue' : m.status} />
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="recent-heading">
          <div className="flex items-center justify-between mb-2">
            <h2 id="recent-heading" className="text-meta font-medium text-fg-muted">
              Recent activity
            </h2>
            <button onClick={() => goToSection('activity')} className="py-2.5 -my-2.5 pointer-fine:py-0 pointer-fine:my-0 text-meta text-fg-muted hover:text-fg">
              View all →
            </button>
          </div>
          <ul className="space-y-2.5">
            {activities.slice(0, 5).map((a) => (
              <li key={a.id} className="flex items-start gap-2.5 text-sm">
                <Avatar src={a.userAvatar} name={a.userName} size={20} className="mt-px" />
                <span className="flex-1 min-w-0 text-fg-muted">
                  <span className="text-fg font-medium">{a.userName}</span> {a.action}
                </span>
                <span className="text-xs text-fg-faint shrink-0">{timeAgo(a.timestamp)}</span>
              </li>
            ))}
            {activities.length === 0 && <li className="text-sm text-fg-faint">Nothing yet.</li>}
          </ul>
        </section>
      </div>

      {/* Properties column */}
      <aside className="space-y-8 min-w-0">
        <section aria-label="Properties">
          <dl>
            <Property label="Status">
              <StatusBadge status={project.status} />
            </Property>
            <Property label="Health">
              <span title={health.reasons.join(', ')}>
                <Tag tone={health.tone}>{health.label}</Tag>
              </span>
              {health.reasons.length > 0 && <div className="text-xs text-fg-faint mt-1">{health.reasons.join(' · ')}</div>}
            </Property>
            <Property label="Priority">
              <PriorityBadge priority={project.priority} />
            </Property>
            <Property label="Lead">
              <span className="inline-flex items-center gap-1.5">
                <Avatar src={project.leadAvatar} name={project.leadName} size={18} />
                {project.leadName}
              </span>
            </Property>
            <Property label="Client">{project.clientName}</Property>
            <Property label="Category">{project.category}</Property>
            <Property label="Timeline">
              {formatDate(project.startDate)} → <span className={isOverdue(project.targetDate, project.status === 'completed') ? 'text-tone-red-fg' : ''}>{formatDate(project.targetDate)}</span>
            </Property>
            <Property label="Budget">
              <span className="tabular-nums">
                ${project.spent.toLocaleString()} <span className="text-fg-faint">of ${project.budget.toLocaleString()}</span>
              </span>
              <div className="mt-1.5 h-1 rounded-full bg-hover overflow-hidden" aria-label={`${budgetPct}% of budget spent`}>
                <div className={`h-full ${budgetPct > 100 ? 'bg-tone-red-fg' : 'bg-fg-faint'}`} style={{ width: `${Math.min(100, budgetPct)}%` }} />
              </div>
            </Property>
            <Property label="Team">
              <button onClick={() => goToSection('team')} className="flex items-center -space-x-1.5 hover:opacity-80 py-2.5 -my-2.5 pointer-fine:py-0 pointer-fine:my-0" aria-label={`${teamMembers.length} team members, view team`}>
                {teamMembers.slice(0, 6).map((m) => (
                  <Avatar key={m.id} src={m.avatar} name={m.name} size={22} className="ring-2 ring-canvas" />
                ))}
                {teamMembers.length > 6 && (
                  <span className="w-[22px] h-[22px] rounded-full bg-hover ring-2 ring-canvas text-micro text-fg-muted flex items-center justify-center">+{teamMembers.length - 6}</span>
                )}
              </button>
            </Property>
          </dl>
        </section>

        <KeyLinks />
      </aside>
    </div>
  );
};
