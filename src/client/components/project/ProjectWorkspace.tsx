import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Star, Link as LinkIcon, AlertCircle, FileText } from 'lucide-react';
import {
  Project,
  Task,
  ProjectMilestone,
  ProjectDeliverable,
  ProjectChatMessage,
  ProjectFile,
  ProjectNote,
  ProjectLink,
  ProjectActivity,
  User,
  ProjectSection,
  Page,
} from '../../../types';
import { api } from '../../services/api';
import { useApp, canManage as canManageProject } from '../../context/AppContext';
import { ProjectContext, ProjectContextValue, ProjectResource } from './ProjectContext';
import { StatusBadge, PriorityBadge } from '../ui/Badges';
import { TopBar } from '../layout/PageShell';
import { TaskEditorModal } from './TaskEditorModal';
import { TaskPanel } from './TaskPanel';
import { NEW_TASK_EVENT } from '../ui/Shortcuts';
import { OverviewSection } from './sections/OverviewSection';
import { TasksSection } from './sections/TasksSection';
import { KanbanSection } from './sections/KanbanSection';
import { TimelineSection } from './sections/TimelineSection';
import { ChatSection } from './sections/ChatSection';
import { FilesSection } from './sections/FilesSection';
import { NotesSection } from './sections/NotesSection';
import { LinksSection } from './sections/LinksSection';
import { CalendarSection } from './sections/CalendarSection';
import { TeamSection } from './sections/TeamSection';
import { DeliverablesSection } from './sections/DeliverablesSection';
import { ActivitySection } from './sections/ActivitySection';
import { SettingsSection } from './sections/SettingsSection';
import { ReportSection } from './sections/ReportSection';

const SECTION_COMPONENTS: Record<ProjectSection, React.FC> = {
  overview: OverviewSection,
  tasks: TasksSection,
  kanban: KanbanSection,
  timeline: TimelineSection,
  chat: ChatSection,
  files: FilesSection,
  notes: NotesSection,
  links: LinksSection,
  calendar: CalendarSection,
  team: TeamSection,
  deliverables: DeliverablesSection,
  activity: ActivitySection,
  settings: SettingsSection,
  report: ReportSection,
};

const PAGE_SIZE = 50;

// Merge a fresh page into what's loaded, so older pages someone opened stay visible
function mergeById<T extends { id: string; timestamp: string }>(prev: T[], next: T[], newestFirst: boolean): T[] {
  const byId = new Map(prev.map((i) => [i.id, i]));
  for (const i of next) byId.set(i.id, i);
  return [...byId.values()].sort((a, b) => (newestFirst ? b.timestamp.localeCompare(a.timestamp) : a.timestamp.localeCompare(b.timestamp)));
}

const ENDPOINTS: Record<ProjectResource, string> = {
  tasks: 'tasks',
  milestones: 'milestones',
  deliverables: 'deliverables',
  // Long lists load the newest page; older items load on request
  chat: `chat?limit=${PAGE_SIZE}`,
  files: 'files',
  notes: 'notes',
  links: 'links',
  team: 'team',
  activity: `activity?limit=${PAGE_SIZE}`,
};

export const ProjectWorkspace: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { currentUser, route, openProject, navigate, showToast, subscribe, refreshProjects, favoriteIds, toggleFavorite } = useApp();
  const activeSection: ProjectSection = route.view === 'project' ? route.section : 'overview';
  const openTaskId = route.view === 'project' ? route.taskId : undefined;

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [milestones, setMilestones] = useState<ProjectMilestone[]>([]);
  const [deliverables, setDeliverables] = useState<ProjectDeliverable[]>([]);
  const [chatMessages, setChatMessages] = useState<ProjectChatMessage[]>([]);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [notes, setNotes] = useState<ProjectNote[]>([]);
  const [links, setLinks] = useState<ProjectLink[]>([]);
  const [teamMembers, setTeamMembers] = useState<User[]>([]);
  const [activities, setActivities] = useState<ProjectActivity[]>([]);
  const [chatHasMore, setChatHasMore] = useState(false);
  const [activityHasMore, setActivityHasMore] = useState(false);

  const [editor, setEditor] = useState<{ task?: Task; defaults?: Partial<Task> } | null>(null);
  // Tasks hidden locally while their delete can still be undone
  const pendingDeletes = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const setters: Record<ProjectResource, (data: any) => void> = {
    tasks: (list: Task[]) => setTasks(list.filter((t) => !pendingDeletes.current.has(t.id))),
    milestones: setMilestones,
    deliverables: setDeliverables,
    chat: (page: Page<ProjectChatMessage>) => {
      setChatMessages((prev) => mergeById(prev, page.items, false));
      setChatHasMore((more) => more || page.hasMore);
    },
    files: setFiles,
    notes: setNotes,
    links: setLinks,
    team: setTeamMembers,
    activity: (page: Page<ProjectActivity>) => {
      setActivities((prev) => mergeById(prev, page.items, true));
      setActivityHasMore((more) => more || page.hasMore);
    },
  };

  const reload = useCallback(
    async (...resources: Array<ProjectResource | 'project'>) => {
      const wanted = resources.length ? resources : (['project', ...Object.keys(ENDPOINTS)] as Array<ProjectResource | 'project'>);
      await Promise.all(
        wanted.map(async (r) => {
          if (r === 'project') setProject(await api.get<Project>(`/api/projects/${projectId}`));
          else setters[r](await api.get(`/api/projects/${projectId}/${ENDPOINTS[r]}`));
        })
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId]
  );

  useEffect(() => {
    setLoading(true);
    reload()
      .catch((err: any) => setLoadError(err.message || 'Permission denied or project does not exist'))
      .finally(() => setLoading(false));
  }, [reload]);

  // Live refresh when a teammate changes something in this project
  useEffect(
    () =>
      subscribe((event) => {
        // Back after a dropped connection: anything may have changed
        if (event.type === 'reconnected') {
          reload().catch(() => {});
          return;
        }
        if (event.type !== 'project-updated' || event.projectId !== projectId || event.actorId === currentUser?.id) return;
        const map: Record<string, Array<ProjectResource | 'project'>> = {
          project: ['project', 'activity'],
          tasks: ['tasks', 'project', 'activity'],
          team: ['team', 'project', 'activity'],
          chat: ['chat'],
        };
        const resources = map[event.resource] ?? ([event.resource, 'activity'] as Array<ProjectResource | 'project'>);
        reload(...resources.filter((r) => r === 'project' || r in ENDPOINTS)).catch(() => {
          // Access may have been revoked
        });
      }),
    [subscribe, projectId, currentUser?.id, reload]
  );

  // Keyboard shortcut "n": new task in this project
  useEffect(() => {
    const onNewTask = () => setEditor({});
    window.addEventListener(NEW_TASK_EVENT, onNewTask);
    return () => window.removeEventListener(NEW_TASK_EVENT, onNewTask);
  }, []);

  // Flush pending deletes if the project closes before the undo window ends
  useEffect(() => {
    const pending = pendingDeletes.current;
    return () => {
      pending.forEach((timer) => clearTimeout(timer));
      pending.forEach((_, taskId) => api.delete(`/api/projects/${projectId}/tasks/${taskId}`).catch(() => {}));
      pending.clear();
    };
  }, [projectId]);

  const projectsCrumb = (
    <button onClick={() => navigate({ view: 'projects' })} className="py-2.5 -my-2.5 pointer-fine:py-0 pointer-fine:my-0 hover:text-fg hover:underline underline-offset-2">
      Projects
    </button>
  );

  if (loading && !project) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <TopBar crumbs={[projectsCrumb, '…']} />
        <div className="flex-1 flex items-center justify-center text-fg-muted text-sm" role="status">
          <div className="w-5 h-5 border-2 border-line-strong border-t-fg rounded-full animate-spin" aria-hidden="true"></div>
          <span className="sr-only">Loading project</span>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <TopBar crumbs={[projectsCrumb, 'Unavailable']} />
        <div className="flex-1 flex items-center justify-center px-4">
          <div role="alert" className="flex flex-col items-center gap-2 max-w-sm text-center">
            <AlertCircle size={24} className="text-fg-faint" />
            <h1 className="text-base font-semibold text-fg">Project unavailable</h1>
            <p className="text-sm text-fg-muted">{loadError ?? 'You do not have access to this project, or it no longer exists.'}</p>
          </div>
        </div>
      </div>
    );
  }

  const updateTask = async (task: Task, patch: Partial<Task>) => {
    // Optimistic: show the change immediately, roll back on failure
    setTasks((list) => list.map((t) => (t.id === task.id ? { ...t, ...patch } : t)));
    try {
      const updated = await api.put<Task>(`/api/projects/${projectId}/tasks/${task.id}`, patch);
      setTasks((list) => list.map((t) => (t.id === task.id ? updated : t)));
      reload('project', 'activity').catch(() => {});
    } catch (err: any) {
      setTasks((list) => list.map((t) => (t.id === task.id ? task : t)));
      showToast(err.message || 'Failed to update task', 'error');
    }
  };

  const deleteTask = (task: Task) => {
    const index = tasks.findIndex((t) => t.id === task.id);
    setTasks((list) => list.filter((t) => t.id !== task.id));
    const timer = setTimeout(async () => {
      pendingDeletes.current.delete(task.id);
      try {
        await api.delete(`/api/projects/${projectId}/tasks/${task.id}`);
        reload('project', 'activity').catch(() => {});
      } catch (err: any) {
        setTasks((list) => [...list.slice(0, index), task, ...list.slice(index)]);
        showToast(err.message || 'Failed to delete task', 'error');
      }
    }, 6000);
    pendingDeletes.current.set(task.id, timer);
    showToast(`Deleted “${task.title}”`, 'info', {
      label: 'Undo',
      onClick: () => {
        clearTimeout(timer);
        pendingDeletes.current.delete(task.id);
        setTasks((list) => [...list.slice(0, index), task, ...list.slice(index)]);
      },
    });
  };

  const ctx: ProjectContextValue = {
    projectId,
    project,
    setProject: (p) => {
      setProject(p);
      refreshProjects();
    },
    tasks,
    setTasks,
    milestones,
    setMilestones,
    deliverables,
    setDeliverables,
    chatMessages,
    setChatMessages,
    files,
    setFiles,
    notes,
    setNotes,
    links,
    setLinks,
    teamMembers,
    setTeamMembers,
    activities,
    chatHasMore,
    activityHasMore,
    loadOlderChat: async () => {
      const oldest = chatMessages[0];
      if (!oldest) return;
      const page = await api.get<Page<ProjectChatMessage>>(`/api/projects/${projectId}/chat?limit=${PAGE_SIZE}&before=${encodeURIComponent(oldest.timestamp)}`);
      setChatMessages((prev) => mergeById(prev, page.items, false));
      setChatHasMore(page.hasMore);
    },
    loadMoreActivity: async () => {
      const oldest = activities[activities.length - 1];
      if (!oldest) return;
      const page = await api.get<Page<ProjectActivity>>(`/api/projects/${projectId}/activity?limit=${PAGE_SIZE}&before=${encodeURIComponent(oldest.timestamp)}`);
      setActivities((prev) => mergeById(prev, page.items, true));
      setActivityHasMore(page.hasMore);
    },
    reload,
    canManage: canManageProject(currentUser, project),
    updateTask,
    deleteTask,
    // Existing tasks open in the side panel (with their own link); new ones in the create dialog
    openTaskEditor: (task, defaults) => (task ? openProject(projectId, activeSection, task.id) : setEditor({ defaults })),
    goToSection: (section) => openProject(projectId, section),
  };

  const openCount = tasks.filter((t) => t.status !== 'done').length;
  const sections: Array<{ id: ProjectSection; label: string; count?: number }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'tasks', label: 'Tasks', count: openCount },
    { id: 'kanban', label: 'Board' },
    { id: 'calendar', label: 'Calendar' },
    { id: 'timeline', label: 'Milestones', count: milestones.length },
    { id: 'deliverables', label: 'Deliverables', count: deliverables.length },
    { id: 'files', label: 'Files', count: files.length },
    { id: 'notes', label: 'Notes', count: notes.length },
    { id: 'links', label: 'Links', count: links.length },
    { id: 'chat', label: 'Chat' },
    { id: 'team', label: 'Team', count: teamMembers.length },
    { id: 'activity', label: 'Activity' },
    { id: 'settings', label: 'Settings' },
  ];

  const Section = SECTION_COMPONENTS[activeSection];
  const isFavorite = favoriteIds.includes(projectId);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast('Link copied', 'success');
    } catch {
      showToast('Could not copy the link', 'error');
    }
  };

  return (
    <ProjectContext.Provider value={ctx}>
      <div className="flex-1 flex flex-col min-h-0">
        <TopBar
          crumbs={[projectsCrumb, project.name]}
          actions={
            <>
              <button
                onClick={() => openProject(projectId, 'report')}
                className="h-10 pointer-fine:h-7 px-2.5 pointer-fine:px-2 flex items-center gap-1.5 rounded-md text-[13px] text-fg-muted hover:bg-hover hover:text-fg"
                title="A printable summary to share with the client"
              >
                <FileText size={14} />
                <span className="hidden sm:inline">Client summary</span>
              </button>
              <button onClick={copyLink} className="h-10 pointer-fine:h-7 px-2.5 pointer-fine:px-2 flex items-center gap-1.5 rounded-md text-[13px] text-fg-muted hover:bg-hover hover:text-fg" title="Copy a link to this page">
                <LinkIcon size={14} />
                <span className="hidden sm:inline">Copy link</span>
              </button>
              <button
                onClick={() => toggleFavorite(projectId)}
                className={`w-10 h-10 pointer-fine:w-7 pointer-fine:h-7 flex items-center justify-center rounded-md hover:bg-hover ${isFavorite ? 'text-tone-amber-fg' : 'text-fg-muted hover:text-fg'}`}
                aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                aria-pressed={isFavorite}
                title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              >
                <Star size={15} fill={isFavorite ? 'currentColor' : 'none'} />
              </button>
            </>
          }
        />

        <div className="flex-1 overflow-y-auto">
          {/* Project header */}
          <div className="mx-auto px-4 sm:px-8 lg:px-12 pt-4 sm:pt-8 max-w-6xl">
            <div className="flex flex-wrap items-center gap-2 text-xs text-fg-faint mb-2">
              <span className="font-mono">{project.code}</span>
              <span aria-hidden="true">·</span>
              <span>{project.clientName}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="text-2xl sm:text-[28px] leading-tight font-semibold tracking-tight text-fg">{project.name}</h1>
              <div className="flex items-center gap-1.5">
                <StatusBadge status={project.status} />
                <PriorityBadge priority={project.priority} />
              </div>
            </div>

            {/* Section tabs */}
            <div className="mt-5 -mx-1 border-b border-line">
              <nav aria-label="Project sections" className="flex items-center overflow-x-auto no-scrollbar">
                {sections.map((s) => {
                  const active = activeSection === s.id;
                  return (
                    <button
                      key={s.id}
                      onClick={() => openProject(projectId, s.id)}
                      aria-current={active ? 'page' : undefined}
                      className={`relative shrink-0 h-11 pointer-fine:h-9 px-2.5 mx-0.5 text-[15px] pointer-fine:text-sm whitespace-nowrap transition-colors ${
                        active ? 'text-fg font-medium' : 'text-fg-muted hover:text-fg'
                      }`}
                    >
                      <span className={`inline-flex items-center gap-1.5 px-1 py-0.5 rounded ${active ? '' : 'hover:bg-hover'}`}>
                        {s.label}
                        {s.count !== undefined && s.count > 0 && <span className="text-xs text-fg-faint tabular-nums">{s.count}</span>}
                      </span>
                      {active && <span aria-hidden="true" className="absolute left-2 right-2 -bottom-px h-0.5 bg-fg rounded-full" />}
                    </button>
                  );
                })}
              </nav>
            </div>
          </div>

          <div className="mx-auto px-4 sm:px-8 lg:px-12 py-6 max-w-6xl">
            <Section />
          </div>
        </div>

        <TaskEditorModal open={!!editor} task={editor?.task} defaults={editor?.defaults} onClose={() => setEditor(null)} />
        {openTaskId && <TaskPanel key={openTaskId} taskId={openTaskId} onClose={() => openProject(projectId, activeSection)} />}
      </div>
    </ProjectContext.Provider>
  );
};
