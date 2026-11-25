import { Project, ProjectTemplate, ProjectMilestone, Task, User } from '../types';

const t = (title: string, offsetDays: number, priority: 'low' | 'medium' | 'high' | 'urgent' = 'medium', subtasks: string[] = [], tags: string[] = []) => ({
  title,
  description: '',
  priority,
  offsetDays,
  tags,
  subtasks,
});

// Shipped with the app so every office has sensible starting points
export const BUILT_IN_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'tpl-website',
    name: 'Website project',
    description: 'Discovery, design, build, content, launch and handover for a client website.',
    category: 'Web Development',
    builtIn: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    milestones: [
      { title: 'Discovery complete', description: 'Goals, audience and sitemap agreed with the client.', offsetDays: 14 },
      { title: 'Design approved', description: 'Key page designs signed off.', offsetDays: 35 },
      { title: 'Site built', description: 'All pages built on staging with real content.', offsetDays: 70 },
      { title: 'Launch', description: 'Live on the production domain.', offsetDays: 84 },
    ],
    tasks: [
      t('Kick-off meeting with the client', 2, 'high', ['Agree goals and success measures', 'Confirm stakeholders', 'Share the timeline']),
      t('Collect brand assets and content', 7, 'medium', ['Logo and brand guide', 'Existing copy', 'Photography']),
      t('Sitemap and page list', 10, 'medium'),
      t('Wireframes for key pages', 21, 'medium', [], ['design']),
      t('Visual design for key pages', 32, 'high', [], ['design']),
      t('Set up repository and staging', 38, 'medium', ['Repository', 'Staging site', 'Automatic deploys'], ['dev']),
      t('Build page templates', 60, 'high', [], ['dev']),
      t('Content entry and review', 70, 'medium', [], ['content']),
      t('Accessibility and performance check', 77, 'high', ['Keyboard navigation', 'Colour contrast', 'Page speed'], ['qa']),
      t('Domain, analytics and launch', 84, 'urgent', ['DNS and HTTPS', 'Analytics', 'Redirects from the old site'], ['launch']),
      t('Handover and training', 90, 'medium'),
    ],
  },
  {
    id: 'tpl-onboarding',
    name: 'Client onboarding',
    description: 'Contract, access, kick-off and the first deliverable for a new client.',
    category: 'Client Services',
    builtIn: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    milestones: [
      { title: 'Contract signed', description: '', offsetDays: 5 },
      { title: 'First deliverable', description: 'Something useful in the client’s hands.', offsetDays: 30 },
    ],
    tasks: [
      t('Send contract and statement of work', 1, 'high'),
      t('Create client in NovaDesk and add contacts', 2, 'medium'),
      t('Request access to client systems', 5, 'medium', ['Accounts', 'Repositories', 'Analytics']),
      t('Kick-off meeting', 7, 'high', ['Agenda', 'Notes shared with the client']),
      t('Agree communication rhythm', 7, 'low'),
      t('Plan the first deliverable', 10, 'medium'),
      t('30-day check-in with the client', 30, 'medium'),
    ],
  },
  {
    id: 'tpl-internal',
    name: 'Internal improvement',
    description: 'A small internal project: problem, plan, build, roll out, review.',
    category: 'Internal',
    builtIn: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    milestones: [
      { title: 'Plan agreed', description: '', offsetDays: 7 },
      { title: 'Rolled out', description: '', offsetDays: 35 },
    ],
    tasks: [
      t('Write down the problem and who it affects', 2, 'medium'),
      t('Agree the plan and owner', 7, 'high'),
      t('Build or change', 28, 'medium'),
      t('Roll out and tell the team', 35, 'high'),
      t('Review after two weeks', 49, 'low'),
    ],
  },
];

const dayMs = 86400000;
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * dayMs).toISOString().split('T')[0];
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMs);

/** The tasks and milestones a template adds to a new project, assigned to the project's creator. */
export function instantiateTemplate(template: ProjectTemplate, project: Project, owner: User, makeId: (prefix: string) => string) {
  const now = new Date().toISOString();
  const tasks: Task[] = template.tasks.map((tt) => ({
    id: makeId('tsk'),
    projectId: project.id,
    projectCode: project.code,
    projectName: project.name,
    title: tt.title,
    description: tt.description,
    status: 'todo',
    priority: tt.priority,
    assigneeId: owner.id,
    assigneeName: owner.name,
    assigneeAvatar: owner.avatar,
    dueDate: addDays(project.startDate, tt.offsetDays),
    tags: [...tt.tags],
    subtasks: tt.subtasks.map((title) => ({ id: makeId('sub'), title, completed: false })),
    createdAt: now,
    updatedAt: now,
  }));
  const milestones: ProjectMilestone[] = template.milestones.map((m) => ({
    id: makeId('mls'),
    projectId: project.id,
    title: m.title,
    description: m.description,
    targetDate: addDays(project.startDate, m.offsetDays),
    status: 'pending',
    progress: 0,
    ownerId: owner.id,
    ownerName: owner.name,
  }));
  return { tasks, milestones };
}

/** Turns an existing project's tasks and milestones into a template (dates become offsets from the start). */
export function templateFromProject(project: Project, tasks: Task[], milestones: ProjectMilestone[]) {
  const offset = (date: string) => Math.max(0, daysBetween(project.startDate, date));
  return {
    category: project.category,
    tasks: tasks
      .slice()
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .map((task) => ({
        title: task.title,
        description: task.description,
        priority: task.priority,
        offsetDays: offset(task.dueDate),
        tags: [...task.tags],
        subtasks: task.subtasks.map((s) => s.title),
      })),
    milestones: milestones
      .slice()
      .sort((a, b) => a.targetDate.localeCompare(b.targetDate))
      .map((m) => ({ title: m.title, description: m.description, offsetDays: offset(m.targetDate) })),
  };
}
