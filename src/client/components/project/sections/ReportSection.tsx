import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, ArrowLeft } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { useProject } from '../ProjectContext';
import { Markdown } from '../../ui/Markdown';
import { formatDate, label } from '../../ui/Badges';
import { Button } from '../../ui/Field';
import { stageOf } from './OverviewSection';
import { LINK_CATEGORIES, hostOf } from './LinksSection';

const STAGES = ['planning', 'in_progress', 'review', 'delivered'] as const;

interface Options {
  budget: boolean;
  openTasks: boolean;
  links: boolean;
}

/** The summary document itself, used both on screen and for printing. */
const ReportBody: React.FC<{ options: Options }> = ({ options }) => {
  const { project, tasks, milestones, deliverables, links } = useProject();
  const { currentUser } = useApp();
  const stage = stageOf(project);
  const done = tasks.filter((t) => t.status === 'done').length;
  const open = tasks.filter((t) => t.status !== 'done').sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const sortedMilestones = [...milestones].sort((a, b) => a.targetDate.localeCompare(b.targetDate));
  const sortedDeliverables = [...deliverables].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const shareable = links.filter((l) => ['live', 'domain', 'staging', 'docs', 'design'].includes(l.category));

  const th = 'text-left text-xs font-medium text-fg-muted py-2 pr-4 border-b border-line';
  const td = 'text-sm text-fg py-2 pr-4 border-b border-line align-top';

  return (
    <article className="report max-w-3xl text-fg">
      <header className="pb-6 mb-6 border-b border-line">
        <p className="text-xs text-fg-faint">
          Project summary · {new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight mt-1">{project.name}</h1>
        <p className="text-sm text-fg-muted mt-1">
          Prepared for {project.clientName} · Reference {project.code}
        </p>
      </header>

      <section className="mb-8">
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4">
          <div>
            <dt className="text-xs text-fg-faint">Stage</dt>
            <dd className="text-sm font-medium mt-0.5">{label(stage)}</dd>
          </div>
          <div>
            <dt className="text-xs text-fg-faint">Progress</dt>
            <dd className="text-sm font-medium mt-0.5">{project.completionPercentage}% complete</dd>
          </div>
          <div>
            <dt className="text-xs text-fg-faint">Timeline</dt>
            <dd className="text-sm font-medium mt-0.5">
              {formatDate(project.startDate)} – {formatDate(project.targetDate)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-fg-faint">Project lead</dt>
            <dd className="text-sm font-medium mt-0.5">{project.leadName}</dd>
          </div>
          {options.budget && (
            <div>
              <dt className="text-xs text-fg-faint">Budget used</dt>
              <dd className="text-sm font-medium mt-0.5">
                ${project.spent.toLocaleString()} of ${project.budget.toLocaleString()}
              </dd>
            </div>
          )}
        </dl>

        <ol className="grid grid-cols-4 gap-1.5 mt-6" aria-label="Stages">
          {STAGES.map((s, i) => {
            const reached = i <= STAGES.indexOf(stage);
            return (
              <li key={s}>
                <span className={`block h-1.5 rounded-full ${reached ? 'bg-accent' : 'bg-hover'}`} />
                <span className={`block text-xs mt-1.5 ${s === stage ? 'font-semibold text-fg' : 'text-fg-muted'}`}>{label(s)}</span>
              </li>
            );
          })}
        </ol>
      </section>

      {project.description.trim() && (
        <section className="mb-8">
          <h2 className="text-base font-semibold mb-2">About the project</h2>
          <Markdown source={project.description} className="text-sm" />
        </section>
      )}

      {sortedMilestones.length > 0 && (
        <section className="mb-8 break-inside-avoid">
          <h2 className="text-base font-semibold mb-2">Milestones</h2>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>Milestone</th>
                <th className={th}>Target</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {sortedMilestones.map((m) => (
                <tr key={m.id}>
                  <td className={td}>
                    {m.title}
                    {m.description && <div className="text-xs text-fg-muted mt-0.5">{m.description}</div>}
                  </td>
                  <td className={`${td} whitespace-nowrap`}>{formatDate(m.targetDate)}</td>
                  <td className={`${td} whitespace-nowrap`}>{m.status === 'completed' ? 'Completed' : `${label(m.status)} · ${m.progress}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {sortedDeliverables.length > 0 && (
        <section className="mb-8 break-inside-avoid">
          <h2 className="text-base font-semibold mb-2">Deliverables</h2>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>Deliverable</th>
                <th className={th}>Due</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {sortedDeliverables.map((d) => (
                <tr key={d.id}>
                  <td className={td}>{d.title}</td>
                  <td className={`${td} whitespace-nowrap`}>{formatDate(d.dueDate)}</td>
                  <td className={`${td} whitespace-nowrap`}>
                    {d.status === 'approved' && d.signedOffAt ? `Approved ${formatDate(d.signedOffAt)}` : label(d.status)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="mb-8">
        <h2 className="text-base font-semibold mb-2">Work</h2>
        <p className="text-sm">
          {done} of {tasks.length} tasks completed{open.length ? `; ${open.length} in progress or planned.` : '.'}
        </p>
        {options.openTasks && open.length > 0 && (
          <ul className="mt-2 space-y-1">
            {open.slice(0, 25).map((t) => (
              <li key={t.id} className="text-sm flex justify-between gap-4 border-b border-line py-1.5">
                <span>{t.title}</span>
                <span className="text-fg-muted whitespace-nowrap">{formatDate(t.dueDate)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {options.links && shareable.length > 0 && (
        <section className="mb-8">
          <h2 className="text-base font-semibold mb-2">Links</h2>
          <ul className="space-y-1">
            {shareable.map((l) => (
              <li key={l.id} className="text-sm">
                <span className="text-fg-muted">{LINK_CATEGORIES.find((c) => c.value === l.category)?.label}:</span> {l.title} · {hostOf(l.url)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="pt-4 border-t border-line text-xs text-fg-faint">Prepared by {currentUser?.name} with NovaDesk</footer>
    </article>
  );
};

export const ReportSection: React.FC = () => {
  const { goToSection } = useProject();
  const [options, setOptions] = useState<Options>({ budget: false, openTasks: false, links: true });
  const toggle = (key: keyof Options) => setOptions((o) => ({ ...o, [key]: !o[key] }));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6 p-3 rounded-lg bg-subtle">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-fg-muted">
          <span className="text-fg font-medium">Include:</span>
          {(
            [
              ['links', 'Live site and other links'],
              ['openTasks', 'Open tasks'],
              ['budget', 'Budget'],
            ] as const
          ).map(([key, text]) => (
            <label key={key} className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={options[key]} onChange={() => toggle(key)} className="accent-accent" />
              {text}
            </label>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => goToSection('overview')}>
            <ArrowLeft size={14} /> Back
          </Button>
          <Button onClick={() => window.print()}>
            <Printer size={14} /> Print or save as PDF
          </Button>
        </div>
      </div>

      <div className="border border-line rounded-lg p-6 sm:p-10">
        <ReportBody options={options} />
      </div>

      {/* Printing shows only this copy (see the print rules in index.css) */}
      {createPortal(
        <div className="print-only">
          <ReportBody options={options} />
        </div>,
        document.body
      )}
    </div>
  );
};
