export type UserRole = 'admin' | 'pm' | 'member';

export type UserStatus = 'active' | 'away' | 'busy';

export interface User {
  id: string;
  name: string;
  email: string;
  avatar: string;
  role: UserRole;
  title: string;
  department: string;
  status: UserStatus;
  phone: string;
  initials: string;
  // false when an administrator has deactivated the account (kept for history)
  active?: boolean;
}

export type ClientStatus = 'active' | 'prospect' | 'inactive';

export interface Client {
  id: string;
  name: string;
  company: string;
  industry: string;
  contactPerson: string;
  email: string;
  phone: string;
  status: ClientStatus;
  totalBilled: number;
  activeProjectsCount: number;
  notes: string;
  website: string;
}

export type ProjectStatus = 'active' | 'on_hold' | 'completed' | 'archived';
export type ProjectPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface Project {
  id: string;
  code: string;
  name: string;
  clientId: string;
  clientName: string;
  description: string;
  status: ProjectStatus;
  priority: ProjectPriority;
  leadId: string;
  leadName: string;
  leadAvatar: string;
  budget: number;
  spent: number;
  startDate: string;
  targetDate: string;
  completionPercentage: number;
  category: string;
  teamMemberIds: string[];
  createdAt: string;
  updatedAt: string;
  // Where the work is: separate from status (active/on hold…), which says whether it's running
  stage?: ProjectStage;
}

export const PROJECT_STAGES = ['planning', 'in_progress', 'review', 'delivered'] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

// Built-in (non-project) workspace views. Anything else in activeTabId is a project id.
export const SYSTEM_TABS = ['dashboard', 'directory', 'tasks', 'clients', 'team', 'admin'] as const;
export type SystemTab = (typeof SYSTEM_TABS)[number];

export function isSystemTab(tabId: string): tabId is SystemTab {
  return (SYSTEM_TABS as readonly string[]).includes(tabId);
}

export interface WorkspaceTab {
  projectId: string;
  tabOrder: number;
  openedAt: string;
}

export interface UserWorkspace {
  id: string;
  userId: string;
  tabs: WorkspaceTab[];
  activeTabId: string; // one of SYSTEM_TABS, or a specific projectId
  favoriteProjectIds?: string[];
  // Notification kinds this person turned off
  mutedNotificationKinds?: NotificationKind[];
  updatedAt: string;
}

export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface TaskSubtask {
  id: string;
  title: string;
  completed: boolean;
}

export interface Task {
  id: string;
  projectId: string;
  projectCode?: string;
  projectName?: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string;
  assigneeName: string;
  assigneeAvatar: string;
  dueDate: string;
  tags: string[];
  subtasks: TaskSubtask[];
  createdAt: string;
  updatedAt: string;
  remindedDue?: string;
  remindedOverdue?: string;
}

export type MilestoneStatus = 'pending' | 'in_progress' | 'completed' | 'overdue';

export interface ProjectMilestone {
  id: string;
  projectId: string;
  title: string;
  description: string;
  targetDate: string;
  status: MilestoneStatus;
  progress: number;
  ownerId: string;
  ownerName: string;
}

export interface ProjectChatMessage {
  id: string;
  projectId: string;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  senderRole: string;
  text: string;
  timestamp: string;
  reactions?: Record<string, string[]>;
}

export interface ProjectFile {
  id: string;
  projectId: string;
  name: string;
  category: 'contracts' | 'assets' | 'deliverables' | 'specs' | 'general';
  fileSize: string;
  fileType: string;
  uploadedBy: string;
  uploadedById?: string;
  uploadedAt: string;
  downloadUrl: string;
  // Present only for files with stored content on disk (seed entries have none)
  storedName?: string;
  mimeType?: string;
}

export interface ProjectNote {
  id: string;
  projectId: string;
  title: string;
  content: string;
  category: 'meeting' | 'architecture' | 'spec' | 'feedback';
  authorId: string;
  authorName: string;
  updatedAt: string;
}

export interface ProjectLink {
  id: string;
  projectId: string;
  title: string;
  url: string;
  category: 'repository' | 'live' | 'domain' | 'staging' | 'design' | 'docs' | 'other';
  description: string;
  addedBy: string;
  addedById?: string;
  addedAt: string;
}

export type DeliverableStatus = 'pending' | 'in_review' | 'approved' | 'rejected';

export interface ProjectDeliverable {
  id: string;
  projectId: string;
  title: string;
  description: string;
  dueDate: string;
  status: DeliverableStatus;
  ownerId: string;
  ownerName: string;
  signedOffBy?: string;
  signedOffAt?: string;
}

export interface ProjectActivity {
  id: string;
  projectId: string;
  userId: string;
  userName: string;
  userAvatar: string;
  action: string;
  timestamp: string;
  type: 'task' | 'milestone' | 'file' | 'member' | 'status' | 'general';
}

export interface NotificationItem {
  id: string;
  userId: string;
  title: string;
  message: string;
  projectId?: string;
  projectName?: string;
  type: 'info' | 'success' | 'warning' | 'alert';
  read: boolean;
  timestamp: string;
  kind?: NotificationKind;
  // Opens straight to the task when set
  taskId?: string;
}

export const NOTIFICATION_KINDS = [
  { kind: 'assignments', label: 'Tasks assigned to me' },
  { kind: 'mentions', label: 'Someone @mentions me' },
  { kind: 'comments', label: 'Comments on my tasks' },
  { kind: 'reminders', label: 'Due-tomorrow and overdue reminders' },
  { kind: 'task_completed', label: 'Tasks completed on projects I lead' },
  { kind: 'status', label: 'Project status, stage and milestone changes' },
  { kind: 'deliverables', label: 'Deliverables I own' },
  { kind: 'team', label: 'Being added to a project' },
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number]['kind'];

export interface TaskComment {
  id: string;
  taskId: string;
  projectId: string;
  authorId: string;
  authorName: string;
  authorAvatar: string;
  text: string;
  // Ids of people @mentioned in the text
  mentions: string[];
  createdAt: string;
  editedAt?: string;
}

export interface SearchResults {
  projects: Array<{ id: string; name: string; code: string; clientName: string; status: string }>;
  tasks: Array<{ id: string; title: string; projectId: string; projectName: string; status: string }>;
  notes: Array<{ id: string; title: string; projectId: string; projectName: string; snippet: string }>;
  files: Array<{ id: string; name: string; projectId: string; projectName: string }>;
  people: Array<{ id: string; name: string; title: string; email: string; avatar: string }>;
}

export type ProjectSection =
  | 'overview'
  | 'tasks'
  | 'kanban'
  | 'timeline'
  | 'chat'
  | 'files'
  | 'notes'
  | 'links'
  | 'calendar'
  | 'team'
  | 'deliverables'
  | 'activity'
  | 'settings'
  | 'report';

export interface DashboardStats {
  activeProjectsCount: number;
  completedProjectsCount: number;
  totalProjectsCount: number;
  totalBudget: number;
  totalSpent: number;
  totalEmployees: number;
  activeClientsCount: number;
  myPendingTasksCount: number;
  allPendingTasksCount: number;
  pendingMilestones: ProjectMilestone[];
  urgentTasks: Task[];
  recentProjects: Project[];
}

// Server-sent events pushed over /api/events
export type AppEvent =
  | { type: 'notification'; notification: NotificationItem }
  | { type: 'project-updated'; projectId: string; resource: string; actorId: string }
  | { type: 'project-deleted'; projectId: string; actorId: string }
  // Client-only: the live connection came back after a drop, so data may be stale
  | { type: 'reconnected' };

export interface BackupInfo {
  name: string;
  sizeBytes: number;
  createdAt: string;
}

// A reusable starting point for new projects: tasks and milestones are placed relative to the start date
export interface TemplateTask {
  title: string;
  description: string;
  priority: TaskPriority;
  offsetDays: number;
  tags: string[];
  subtasks: string[];
}

export interface TemplateMilestone {
  title: string;
  description: string;
  offsetDays: number;
}

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  tasks: TemplateTask[];
  milestones: TemplateMilestone[];
  // Built-in templates ship with the app and can't be deleted
  builtIn?: boolean;
  createdById?: string;
  createdByName?: string;
  createdAt: string;
}

// Paged lists return the items plus whether older ones exist
export interface Page<T> {
  items: T[];
  hasMore: boolean;
}
