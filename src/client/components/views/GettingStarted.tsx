import React, { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { markOnboarding, readOnboarding, ONBOARDING_EVENT } from '../../services/onboarding';

/** A short first-week checklist on Home. Disappears once done or hidden. */
export const GettingStarted: React.FC = () => {
  const { currentUser, workspace, projects, allEmployees, setIsAccountOpen, setIsProjectPickerOpen, setIsShortcutsOpen, setIsNotificationsOpen, setIsCreateProjectOpen, navigate, openProject } =
    useApp();
  const [state, setState] = useState(() => readOnboarding(currentUser?.id ?? ''));

  useEffect(() => {
    const refresh = () => setState(readOnboarding(currentUser?.id ?? ''));
    refresh();
    window.addEventListener(ONBOARDING_EVENT, refresh);
    return () => window.removeEventListener(ONBOARDING_EVENT, refresh);
  }, [currentUser?.id]);

  if (!currentUser || state.dismissed) return null;

  const mine = projects.filter((p) => p.leadId === currentUser.id || p.teamMemberIds.includes(currentUser.id));
  const steps = [
    {
      done: !!currentUser.avatar,
      label: 'Add a profile photo',
      hint: 'Helps people recognise you on tasks and comments.',
      action: () => setIsAccountOpen(true),
    },
    {
      done: (workspace?.tabs.length ?? 0) > 0,
      label: 'Open one of your projects',
      hint: 'Your projects are in the left sidebar; expand one to jump to its tasks, board or files.',
      action: () => (mine[0] ? openProject(mine[0].id, 'overview') : navigate({ view: 'projects' })),
    },
    ...(currentUser.role !== 'member'
      ? [
          {
            done: projects.some((p) => p.leadId === currentUser.id),
            label: 'Create a project',
            hint: 'You become its lead and can describe it, add links and invite the team.',
            action: () => setIsCreateProjectOpen(true),
          },
        ]
      : []),
    ...(currentUser.role === 'admin'
      ? [
          {
            done: allEmployees.filter((u) => u.active !== false).length > 1,
            label: 'Add your colleagues',
            hint: 'Team → Add person gives each one a temporary password.',
            action: () => navigate({ view: 'team' }),
          },
        ]
      : []),
    {
      done: !!state.search,
      label: 'Find anything with search',
      hint: 'Press Ctrl K (or /) to search projects, tasks, notes, files and people.',
      action: () => setIsProjectPickerOpen(true),
    },
    {
      done: !!state.notifications,
      label: 'Choose what you are notified about',
      hint: 'Inbox → the gear icon.',
      action: () => setIsNotificationsOpen(true),
    },
    {
      done: !!state.shortcuts,
      label: 'Learn the keyboard shortcuts',
      hint: 'Press ? anywhere.',
      action: () => setIsShortcutsOpen(true),
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;

  return (
    <section aria-labelledby="getting-started" className="mb-10 border border-line rounded-lg">
      <div className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2">
        <div>
          <h2 id="getting-started" className="text-sm font-semibold text-fg">
            Getting started
          </h2>
          <p className="text-meta text-fg-muted">
            {doneCount} of {steps.length} done
          </p>
        </div>
        <button
          onClick={() => markOnboarding(currentUser.id, 'dismissed')}
          className="h-10 pointer-fine:h-7 px-2.5 pointer-fine:px-2 flex items-center gap-1 rounded-md text-meta text-fg-muted hover:text-fg hover:bg-hover"
          aria-label="Hide the getting started checklist"
        >
          <X size={14} /> Hide
        </button>
      </div>
      <div className="mx-4 h-1 rounded-full bg-hover overflow-hidden" aria-hidden="true">
        <div className="h-full bg-accent transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>
      <ul className="p-2 mt-2">
        {steps.map((s) => (
          <li key={s.label}>
            <button onClick={s.action} className="w-full flex items-start gap-3 px-2 py-2 rounded-md text-left hover:bg-subtle">
              <span
                className={`mt-0.5 w-4 h-4 shrink-0 rounded-full border flex items-center justify-center ${s.done ? 'bg-accent border-accent text-on-accent' : 'border-line-strong'}`}
                aria-hidden="true"
              >
                {s.done && <Check size={10} strokeWidth={3} />}
              </span>
              <span className="min-w-0">
                <span className={`block text-sm ${s.done ? 'text-fg-faint line-through' : 'text-fg'}`}>
                  <span className="sr-only">{s.done ? 'Done: ' : 'To do: '}</span>
                  {s.label}
                </span>
                {!s.done && <span className="block text-meta text-fg-muted">{s.hint}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};
