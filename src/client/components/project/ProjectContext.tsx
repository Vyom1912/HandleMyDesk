import React, { createContext, useContext } from 'react';
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
} from '../../../types';

export type ProjectResource = 'tasks' | 'milestones' | 'deliverables' | 'chat' | 'files' | 'notes' | 'links' | 'team' | 'activity';

export interface ProjectContextValue {
  projectId: string;
  project: Project;
  setProject: (p: Project) => void;
  tasks: Task[];
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  milestones: ProjectMilestone[];
  setMilestones: React.Dispatch<React.SetStateAction<ProjectMilestone[]>>;
  deliverables: ProjectDeliverable[];
  setDeliverables: React.Dispatch<React.SetStateAction<ProjectDeliverable[]>>;
  chatMessages: ProjectChatMessage[];
  setChatMessages: React.Dispatch<React.SetStateAction<ProjectChatMessage[]>>;
  files: ProjectFile[];
  setFiles: React.Dispatch<React.SetStateAction<ProjectFile[]>>;
  notes: ProjectNote[];
  setNotes: React.Dispatch<React.SetStateAction<ProjectNote[]>>;
  links: ProjectLink[];
  setLinks: React.Dispatch<React.SetStateAction<ProjectLink[]>>;
  teamMembers: User[];
  setTeamMembers: React.Dispatch<React.SetStateAction<User[]>>;
  activities: ProjectActivity[];
  // Chat and activity load the newest page first
  chatHasMore: boolean;
  activityHasMore: boolean;
  loadOlderChat: () => Promise<void>;
  loadMoreActivity: () => Promise<void>;
  // Re-fetch the project record and/or specific resources from the server
  reload: (...resources: Array<ProjectResource | 'project'>) => Promise<void>;
  canManage: boolean;
  // Task actions shared by the list, board, calendar and overview
  updateTask: (task: Task, patch: Partial<Task>) => Promise<void>;
  deleteTask: (task: Task) => void;
  openTaskEditor: (task?: Task, defaults?: Partial<Task>) => void;
  goToSection: (section: ProjectSection) => void;
}

export const ProjectContext = createContext<ProjectContextValue | null>(null);

export function useProject(): ProjectContextValue {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProject must be used inside a ProjectWorkspace');
  return ctx;
}
