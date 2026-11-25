import React, { useState } from 'react';
import { Plus, ChevronLeft, ChevronRight, ListChecks } from 'lucide-react';
import { Task } from '../../../../types';
import { useProject } from '../ProjectContext';
import { Avatar, PriorityBadge, StatusDot, formatDate, isOverdue } from '../../ui/Badges';
import { Button } from '../../ui/Field';
import { TASK_STATUS_OPTIONS } from './TasksSection';

export const KanbanSection: React.FC = () => {
  const { tasks, updateTask, openTaskEditor } = useProject();
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<Task['status'] | null>(null);

  const move = (task: Task, status: Task['status']) => {
    if (task.status !== status) updateTask(task, { status });
  };

  const handleDrop = (status: Task['status']) => {
    const task = tasks.find((t) => t.id === dragTaskId);
    if (task) move(task, status);
    setDragTaskId(null);
    setOverColumn(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-fg-muted">Drag cards between columns, or use the arrows on each card.</p>
        <Button onClick={() => openTaskEditor()}>
          <Plus size={15} /> New task
        </Button>
      </div>

      <div className="grid grid-flow-col auto-cols-[minmax(196px,1fr)] gap-3 overflow-x-auto pb-3 snap-x">
        {TASK_STATUS_OPTIONS.map((column, colIndex) => {
          const columnTasks = tasks.filter((t) => t.status === column.value);
          const isOver = overColumn === column.value;
          return (
            <section
              key={column.value}
              aria-label={`${column.label}, ${columnTasks.length} cards`}
              onDragOver={(e) => {
                if (!dragTaskId) return;
                e.preventDefault();
                setOverColumn(column.value);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverColumn(null);
              }}
              onDrop={() => handleDrop(column.value)}
              className={`snap-start rounded-lg p-2 flex flex-col min-h-[420px] transition-colors ${isOver ? 'bg-accent-soft ring-1 ring-accent/40' : 'bg-subtle'}`}
            >
              <div className="flex items-center gap-2 h-7 px-1.5 mb-1.5">
                <StatusDot status={column.value} />
                <h3 className="text-[13px] font-medium text-fg">{column.label}</h3>
                <span className="text-[13px] text-fg-faint tabular-nums">{columnTasks.length}</span>
              </div>

              <ul className="space-y-1.5 flex-1">
                {columnTasks.map((t) => {
                  const done = t.subtasks.filter((s) => s.completed).length;
                  return (
                    <li
                      key={t.id}
                      draggable
                      onDragStart={(e) => {
                        setDragTaskId(t.id);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragEnd={() => {
                        setDragTaskId(null);
                        setOverColumn(null);
                      }}
                      className={`group p-2.5 bg-surface border border-line rounded-md shadow-[0_1px_2px_rgb(0_0_0/0.04)] hover:border-line-strong cursor-grab active:cursor-grabbing ${
                        dragTaskId === t.id ? 'opacity-40' : ''
                      }`}
                    >
                      <button onClick={() => openTaskEditor(t)} className="block w-full text-left text-sm text-fg leading-snug hover:underline underline-offset-2">
                        {t.title}
                      </button>
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        <PriorityBadge priority={t.priority} />
                        {t.subtasks.length > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs text-fg-faint">
                            <ListChecks size={12} />
                            {done}/{t.subtasks.length}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between mt-2.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Avatar src={t.assigneeAvatar} name={t.assigneeName} size={18} />
                          <span className={`text-xs ${isOverdue(t.dueDate, t.status === 'done') ? 'text-tone-red-fg' : 'text-fg-faint'}`}>{formatDate(t.dueDate)}</span>
                        </div>
                        {/* Keyboard and touch alternative to dragging */}
                        <div className="flex opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                          <button
                            disabled={colIndex === 0}
                            onClick={() => move(t, TASK_STATUS_OPTIONS[colIndex - 1].value)}
                            className="w-6 h-6 flex items-center justify-center rounded text-fg-faint hover:text-fg hover:bg-hover disabled:invisible"
                            aria-label={colIndex > 0 ? `Move “${t.title}” to ${TASK_STATUS_OPTIONS[colIndex - 1].label}` : undefined}
                          >
                            <ChevronLeft size={14} />
                          </button>
                          <button
                            disabled={colIndex === TASK_STATUS_OPTIONS.length - 1}
                            onClick={() => move(t, TASK_STATUS_OPTIONS[colIndex + 1].value)}
                            className="w-6 h-6 flex items-center justify-center rounded text-fg-faint hover:text-fg hover:bg-hover disabled:invisible"
                            aria-label={colIndex < TASK_STATUS_OPTIONS.length - 1 ? `Move “${t.title}” to ${TASK_STATUS_OPTIONS[colIndex + 1].label}` : undefined}
                          >
                            <ChevronRight size={14} />
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <button
                onClick={() => openTaskEditor(undefined, { status: column.value })}
                className="mt-1.5 w-full h-8 rounded-md text-[13px] text-fg-faint hover:text-fg hover:bg-hover flex items-center gap-1.5 px-2"
              >
                <Plus size={14} /> New
              </button>
            </section>
          );
        })}
      </div>
    </div>
  );
};
