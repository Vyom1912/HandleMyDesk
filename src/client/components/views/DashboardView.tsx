import React, { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { DashboardStats, Task } from '../../../types';
import { Avatar, PriorityBadge, StatusDot, formatDate, isOverdue } from '../ui/Badges';
import { Button } from '../ui/Field';
import { PageShell } from '../layout/PageShell';
import { GettingStarted } from './GettingStarted';

const SectionTitle: React.FC<{ children: React.ReactNode; action?: React.ReactNode }> = ({ children, action }) => (
  <div className="flex items-center justify-between mb-2">
    <h2 className="text-meta font-medium text-fg-muted">{children}</h2>
    {action}
  </div>
);

const money = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1000)}k`);

export const DashboardView: React.FC = () => {
  const { currentUser, projects, workspace, openProject, navigate, setIsCreateProjectOpen } = useApp();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [myTasks, setMyTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.get<DashboardStats>('/api/dashboard/stats'), api.get<Task[]>('/api/tasks/global?filter=assigned_to_me')])
      .then(([s, t]) => {
        setStats(s);
        setMyTasks(t.filter((x) => x.status !== 'done').sort((a, b) => a.dueDate.localeCompare(b.dueDate)));
      })
      .catch((err) => setError(err.message));
  }, []);

  const canCreate = currentUser?.role === 'admin' || currentUser?.role === 'pm';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const recentIds = [...(workspace?.tabs ?? [])].reverse().map((t) => t.projectId);
  const recent = recentIds.map((id) => projects.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p).slice(0, 6);
  const dateLine = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <PageShell
      title={`${greeting}, ${currentUser?.name.split(' ')[0]}`}
      crumb="Home"
      description={dateLine}
      width="wide"
      actions={
        canCreate && (
          <Button onClick={() => setIsCreateProjectOpen(true)}>
            <Plus size={15} /> New project
          </Button>
        )
      }
    >
      {error && (
        <p role="alert" className="mb-6 p-3 rounded-md bg-tone-red-bg text-sm text-tone-red-fg">
          Couldn't load your summary: {error}
        </p>
      )}

      <GettingStarted />

      {/* Key numbers */}
      <div className="grid grid-cols-2 lg:grid-cols-4 border border-line rounded-lg divide-x divide-line mb-10 overflow-hidden">
        {[
          { label: 'My open tasks', value: stats?.myPendingTasksCount, onClick: () => navigate({ view: 'tasks' }) },
          { label: 'Active projects', value: stats?.activeProjectsCount, onClick: () => navigate({ view: 'projects' }) },
          { label: 'Open across my projects', value: stats?.allPendingTasksCount },
          { label: 'Budget used', value: stats ? `${money(stats.totalSpent)} / ${money(stats.totalBudget)}` : undefined },
        ].map((k, i) => {
          const body = (
            <>
              <div className="text-lg sm:text-2xl font-semibold text-fg tabular-nums break-words">{k.value ?? '–'}</div>
              <div className="text-meta text-fg-muted mt-0.5">{k.label}</div>
            </>
          );
          const cls = `text-left px-4 sm:px-5 py-3.5 sm:py-4 ${i >= 2 ? 'border-t lg:border-t-0 border-line' : ''}`;
          return k.onClick ? (
            <button key={k.label} onClick={k.onClick} className={`${cls} hover:bg-subtle`}>
              {body}
            </button>
          ) : (
            <div key={k.label} className={cls}>
              {body}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-x-12 gap-y-10">
        <div className="space-y-10 min-w-0">
          <section>
            <SectionTitle
              action={
                <button onClick={() => navigate({ view: 'tasks' })} className="py-2.5 -my-2.5 pointer-fine:py-0 pointer-fine:my-0 text-meta text-fg-muted hover:text-fg">
                  All my tasks →
                </button>
              }
            >
              Assigned to you
            </SectionTitle>
            {stats && myTasks.length === 0 ? (
              <p className="text-sm text-fg-faint py-3">Nothing assigned to you right now.</p>
            ) : (
              <ul className="border border-line rounded-lg divide-y divide-line">
                {myTasks.slice(0, 8).map((task) => {
                  const overdue = isOverdue(task.dueDate, false);
                  return (
                    <li key={task.id}>
                      <button onClick={() => openProject(task.projectId, 'tasks', task.id)} className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-subtle">
                        <StatusDot status={task.status} />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm text-fg truncate">{task.title}</span>
                          <span className="block text-xs text-fg-faint truncate">{task.projectName}</span>
                        </span>
                        <span className={`text-meta tabular-nums shrink-0 ${overdue ? 'text-tone-red-fg' : 'text-fg-muted'}`}>{overdue ? `Overdue · ${formatDate(task.dueDate)}` : formatDate(task.dueDate)}</span>
                        <span className="hidden sm:block shrink-0">
                          <PriorityBadge priority={task.priority} />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section>
            <SectionTitle>High-priority work across your projects</SectionTitle>
            {stats && stats.urgentTasks.length === 0 ? (
              <p className="text-sm text-fg-faint py-3">Nothing urgent.</p>
            ) : (
              <ul className="border border-line rounded-lg divide-y divide-line">
                {stats?.urgentTasks.map((task) => (
                  <li key={task.id}>
                    <button onClick={() => openProject(task.projectId, 'tasks', task.id)} className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-subtle">
                      <Avatar src={task.assigneeAvatar} name={task.assigneeName} size={20} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm text-fg truncate">{task.title}</span>
                        <span className="block text-xs text-fg-faint truncate">
                          {task.projectName} · {task.assigneeName}
                        </span>
                      </span>
                      <span className={`text-meta tabular-nums shrink-0 ${isOverdue(task.dueDate, false) ? 'text-tone-red-fg' : 'text-fg-muted'}`}>{formatDate(task.dueDate)}</span>
                      <PriorityBadge priority={task.priority} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-10 min-w-0">
          <section>
            <SectionTitle>Recently visited</SectionTitle>
            {recent.length === 0 ? (
              <p className="text-sm text-fg-faint">Projects you open will show up here.</p>
            ) : (
              <ul className="space-y-px">
                {recent.map((p) => (
                  <li key={p.id}>
                    <button onClick={() => openProject(p.id)} className="w-full flex items-center gap-2.5 h-9 px-2 rounded-md hover:bg-hover text-left">
                      <StatusDot status={p.status} />
                      <span className="flex-1 min-w-0 text-sm text-fg truncate">{p.name}</span>
                      <span className="text-xs text-fg-faint tabular-nums">{p.completionPercentage}%</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <SectionTitle>Upcoming milestones</SectionTitle>
            {stats && stats.pendingMilestones.length === 0 && <p className="text-sm text-fg-faint">No milestones coming up.</p>}
            <ul className="space-y-3">
              {stats?.pendingMilestones.map((m) => {
                const project = projects.find((p) => p.id === m.projectId);
                return (
                  <li key={m.id}>
                    <button onClick={() => openProject(m.projectId, 'timeline')} className="w-full flex items-start gap-3 text-left group">
                      <span className={`w-14 shrink-0 text-meta tabular-nums pt-px ${isOverdue(m.targetDate, false) ? 'text-tone-red-fg' : 'text-fg-faint'}`}>{formatDate(m.targetDate)}</span>
                      <span className="min-w-0">
                        <span className="block text-sm text-fg group-hover:underline underline-offset-2">{m.title}</span>
                        {project && <span className="block text-xs text-fg-faint truncate">{project.name}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </aside>
      </div>
    </PageShell>
  );
};
