import React, { useState } from 'react';
import { Plus, Check, Trash2, ListChecks, Download } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { downloadCsv } from '../../../services/exports';
import { Task } from '../../../../types';
import { useProject } from '../ProjectContext';
import { Avatar, PriorityBadge, formatDate, isOverdue } from '../../ui/Badges';
import { Button, IconButton, EmptyState, SearchInput, toolbarSelectClass } from '../../ui/Field';

export const TaskCheckbox: React.FC<{ task: Task; onToggle: () => void }> = ({ task, onToggle }) => (
  <button
    onClick={onToggle}
    role="checkbox"
    aria-checked={task.status === 'done'}
    aria-label={`Mark “${task.title}” as ${task.status === 'done' ? 'not done' : 'done'}`}
    // The visible box stays small; on touchscreens the button around it is finger-sized
    className="group/check shrink-0 flex items-center justify-center w-10 h-10 -m-3 pointer-fine:w-4 pointer-fine:h-4 pointer-fine:m-0"
  >
    <span
      aria-hidden="true"
      className={`w-[18px] h-[18px] pointer-fine:w-4 pointer-fine:h-4 rounded-[4px] border flex items-center justify-center transition-colors ${
        task.status === 'done' ? 'bg-accent border-accent text-on-accent' : 'border-line-strong group-hover/check:border-fg-faint bg-surface'
      }`}
    >
      {task.status === 'done' && <Check size={11} strokeWidth={3} />}
    </span>
  </button>
);

export const TASK_STATUS_OPTIONS: Array<{ value: Task['status']; label: string }> = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'To do' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'in_review', label: 'In review' },
  { value: 'done', label: 'Done' },
];

const STATUS_FILTERS = [{ value: 'open', label: 'Open' }, { value: 'all', label: 'All statuses' }, ...TASK_STATUS_OPTIONS];

export const TasksSection: React.FC = () => {
  const { projectId, project, tasks, teamMembers, updateTask, deleteTask, openTaskEditor } = useProject();
  const { showToast } = useApp();
  const [statusFilter, setStatusFilter] = useState('open');
  const [assigneeFilter, setAssigneeFilter] = useState('all');
  const [search, setSearch] = useState('');

  const q = search.toLowerCase();
  const visible = tasks
    .filter(
      (t) =>
        (statusFilter === 'all' || (statusFilter === 'open' ? t.status !== 'done' : t.status === statusFilter)) &&
        (assigneeFilter === 'all' || t.assigneeId === assigneeFilter) &&
        (!q || t.title.toLowerCase().includes(q) || t.tags.some((tag) => tag.toLowerCase().includes(q)))
    )
    .sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || a.dueDate.localeCompare(b.dueDate));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search tasks or tags" label="Search tasks" className="w-full sm:w-60" />
        <select aria-label="Filter by status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={`${toolbarSelectClass} flex-1 sm:flex-none`}>
          {STATUS_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <select aria-label="Filter by assignee" value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} className={`${toolbarSelectClass} flex-1 sm:flex-none min-w-0`}>
          <option value="all">Everyone</option>
          {teamMembers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <Button
          variant="secondary"
          className="ml-auto touch-hidden"
          onClick={() => downloadCsv(`/api/projects/${projectId}/export/tasks.csv`, `${project.code}-tasks`).catch((err) => showToast(err.message, 'error'))}
          title="All of this project's tasks, as a spreadsheet"
          aria-label="Export tasks as CSV"
        >
          <Download size={15} />
          <span className="hidden sm:inline">Export</span>
        </Button>
        {/* Full width on phones, so it's easy to reach */}
        <Button onClick={() => openTaskEditor()} className="w-full sm:w-auto">
          <Plus size={15} /> New task
        </Button>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          message={tasks.length === 0 ? 'No tasks in this project yet.' : 'No tasks match these filters.'}
          action={
            tasks.length === 0 && (
              <Button onClick={() => openTaskEditor()}>
                <Plus size={15} /> Create the first task
              </Button>
            )
          }
        />
      ) : (
        <div className="border border-line rounded-lg overflow-hidden">
          <div className="hidden md:grid grid-cols-[minmax(0,1fr)_120px_150px_90px_80px_32px] gap-3 px-3 h-8 items-center bg-subtle border-b border-line text-xs font-medium text-fg-faint">
            <span className="pl-7">Task</span>
            <span>Status</span>
            <span>Assignee</span>
            <span>Due</span>
            <span>Priority</span>
            <span aria-hidden="true" />
          </div>
          <ul className="divide-y divide-line">
            {visible.map((task) => {
              const overdue = isOverdue(task.dueDate, task.status === 'done');
              const doneSubtasks = task.subtasks.filter((s) => s.completed).length;
              return (
                <li key={task.id} className="group grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_120px_150px_90px_80px_32px] gap-x-3 gap-y-1.5 px-3 py-2 items-center hover:bg-subtle">
                  <div className="flex items-center gap-3 min-w-0">
                    <TaskCheckbox task={task} onToggle={() => updateTask(task, { status: task.status === 'done' ? 'todo' : 'done' })} />
                    <div className="min-w-0">
                      <button onClick={() => openTaskEditor(task)} className={`line-clamp-2 md:block md:truncate py-1 -my-1 pointer-fine:py-0 pointer-fine:my-0 text-body pointer-fine:text-sm text-left max-w-full hover:underline underline-offset-2 ${task.status === 'done' ? 'line-through text-fg-faint' : 'text-fg'}`}>
                        {task.title}
                      </button>
                      {(task.subtasks.length > 0 || task.tags.length > 0) && (
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-fg-faint mt-0.5">
                          {task.subtasks.length > 0 && (
                            <span className="inline-flex items-center gap-1">
                              <ListChecks size={12} />
                              {doneSubtasks}/{task.subtasks.length}
                            </span>
                          )}
                          {task.tags.map((tag) => (
                            <span key={tag}>#{tag}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <select
                    aria-label={`Status of ${task.title}`}
                    value={task.status}
                    onChange={(e) => updateTask(task, { status: e.target.value as Task['status'] })}
                    className="h-10 pointer-fine:h-7 pl-1.5 pr-6 bg-transparent border border-transparent hover:border-line rounded text-base pointer-fine:text-meta text-fg-muted focus:outline-none focus:border-accent justify-self-end md:justify-self-stretch"
                  >
                    {TASK_STATUS_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-1.5 min-w-0 text-meta text-fg-muted col-start-1 md:col-start-auto pl-7 md:pl-0">
                    <Avatar src={task.assigneeAvatar} name={task.assigneeName} size={18} />
                    <span className="truncate">{task.assigneeName}</span>
                  </div>
                  <span className={`text-meta tabular-nums ${overdue ? 'text-tone-red-fg' : 'text-fg-muted'} justify-self-end md:justify-self-start`}>{formatDate(task.dueDate)}</span>
                  <span className="hidden md:block">
                    <PriorityBadge priority={task.priority} />
                  </span>
                  <span className="hidden md:block">
                    <IconButton label={`Delete ${task.title}`} danger onClick={() => deleteTask(task)} className="hover-reveal">
                      <Trash2 size={14} />
                    </IconButton>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};
