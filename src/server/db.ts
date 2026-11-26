import fs from 'fs';
import path from 'path';
import os from 'os';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import { IS_TEST, IS_PROD, DATA_DIR, DB_PATH, LEGACY_DB_PATH, LOCK_FILE, BACKUP_DIR } from './paths';
import { createBackup, pruneBackups, BackupInfo } from './backups';
import {
  User,
  Client,
  Project,
  Task,
  ProjectMilestone,
  ProjectChatMessage,
  ProjectFile,
  ProjectNote,
  ProjectLink,
  ProjectDeliverable,
  ProjectActivity,
  UserWorkspace,
  NotificationItem,
  TaskComment,
  ProjectTemplate,
} from '../types';

export interface DatabaseSchema {
  users: User[];
  clients: Client[];
  projects: Project[];
  tasks: Task[];
  milestones: ProjectMilestone[];
  chatMessages: ProjectChatMessage[];
  files: ProjectFile[];
  notes: ProjectNote[];
  links: ProjectLink[];
  deliverables: ProjectDeliverable[];
  activities: ProjectActivity[];
  workspaces: Record<string, UserWorkspace>; // keyed by userId
  notifications: NotificationItem[];
  comments: TaskComment[];
  templates: ProjectTemplate[];
}

type CollectionKey = keyof DatabaseSchema;

const COLLECTIONS: CollectionKey[] = [
  'users',
  'clients',
  'projects',
  'tasks',
  'milestones',
  'chatMessages',
  'files',
  'notes',
  'links',
  'deliverables',
  'activities',
  'workspaces',
  'notifications',
  'comments',
  'templates',
];

export { DATA_DIR };
// Tests run against an in-memory database so they never touch real data
const DB_FILE = IS_TEST ? ':memory:' : DB_PATH;
const LEGACY_JSON_FILE = path.join(DATA_DIR, 'db.json');
export const UPLOADS_DIR = IS_TEST ? path.join(os.tmpdir(), 'handlemydesk-uploads-test') : path.join(DATA_DIR, 'uploads');

// Password given to every seeded employee account
export const SEED_PASSWORD = process.env.SEED_PASSWORD || 'handlemydesk123';

const INITIAL_USERS: User[] = [
  {
    id: 'emp-1',
    name: 'Sarah Connor',
    email: 'sarah.connor@handlemydesk.internal',
    avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
    role: 'admin',
    title: 'Director of Operations & Strategy',
    department: 'Operations',
    status: 'active',
    phone: '+1 (555) 019-2831',
    initials: 'SC',
  },
  {
    id: 'emp-2',
    name: 'Marcus Vance',
    email: 'marcus.vance@handlemydesk.internal',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    role: 'pm',
    title: 'Lead Systems Architect & PM',
    department: 'Engineering',
    status: 'active',
    phone: '+1 (555) 019-4820',
    initials: 'MV',
  },
  {
    id: 'emp-3',
    name: 'Elena Rostova',
    email: 'elena.rostova@handlemydesk.internal',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    role: 'pm',
    title: 'Head of Creative & Product PM',
    department: 'Design',
    status: 'active',
    phone: '+1 (555) 019-7711',
    initials: 'ER',
  },
  {
    id: 'emp-4',
    name: 'David Kim',
    email: 'david.kim@handlemydesk.internal',
    avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
    role: 'pm',
    title: 'Agile Delivery Lead',
    department: 'Engineering',
    status: 'busy',
    phone: '+1 (555) 019-3329',
    initials: 'DK',
  },
  {
    id: 'emp-5',
    name: 'Maya Patel',
    email: 'maya.patel@handlemydesk.internal',
    avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&auto=format&fit=crop&q=80',
    role: 'member',
    title: 'Senior UX/UI Designer',
    department: 'Design',
    status: 'active',
    phone: '+1 (555) 019-8842',
    initials: 'MP',
  },
  {
    id: 'emp-6',
    name: 'James Thornton',
    email: 'james.thornton@handlemydesk.internal',
    avatar: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150&auto=format&fit=crop&q=80',
    role: 'member',
    title: 'Senior Full-Stack Engineer',
    department: 'Engineering',
    status: 'active',
    phone: '+1 (555) 019-5561',
    initials: 'JT',
  },
  {
    id: 'emp-7',
    name: 'Chloe Bennet',
    email: 'chloe.bennet@handlemydesk.internal',
    avatar: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=150&auto=format&fit=crop&q=80',
    role: 'member',
    title: 'Frontend Specialist',
    department: 'Engineering',
    status: 'active',
    phone: '+1 (555) 019-1194',
    initials: 'CB',
  },
  {
    id: 'emp-8',
    name: 'Carlos Mendez',
    email: 'carlos.mendez@handlemydesk.internal',
    avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&auto=format&fit=crop&q=80',
    role: 'member',
    title: 'DevOps & Cloud Engineer',
    department: 'Engineering',
    status: 'away',
    phone: '+1 (555) 019-6638',
    initials: 'CM',
  },
  {
    id: 'emp-9',
    name: 'Priya Sharma',
    email: 'priya.sharma@handlemydesk.internal',
    avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80',
    role: 'member',
    title: 'QA Automation Lead',
    department: 'Engineering',
    status: 'active',
    phone: '+1 (555) 019-9922',
    initials: 'PS',
  },
  {
    id: 'emp-10',
    name: 'Alex Rivera',
    email: 'alex.rivera@handlemydesk.internal',
    avatar: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=150&auto=format&fit=crop&q=80',
    role: 'member',
    title: 'Product Analyst',
    department: 'Product',
    status: 'active',
    phone: '+1 (555) 019-4471',
    initials: 'AR',
  },
  {
    id: 'emp-11',
    name: 'Liam O\'Connor',
    email: 'liam.oconnor@handlemydesk.internal',
    avatar: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=150&auto=format&fit=crop&q=80',
    role: 'member',
    title: 'Backend Systems Engineer',
    department: 'Engineering',
    status: 'active',
    phone: '+1 (555) 019-1830',
    initials: 'LO',
  },
  {
    id: 'emp-12',
    name: 'Sophia Chen',
    email: 'sophia.chen@handlemydesk.internal',
    avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80',
    role: 'member',
    title: 'Brand Identity Designer',
    department: 'Design',
    status: 'busy',
    phone: '+1 (555) 019-8263',
    initials: 'SC',
  },
  {
    id: 'emp-13',
    name: 'Lucas Scott',
    email: 'lucas.scott@handlemydesk.internal',
    avatar: 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=150&auto=format&fit=crop&q=80',
    role: 'member',
    title: 'Mobile App Developer',
    department: 'Engineering',
    status: 'active',
    phone: '+1 (555) 019-3849',
    initials: 'LS',
  },
  {
    id: 'emp-14',
    name: 'Emma Watson',
    email: 'emma.watson@handlemydesk.internal',
    avatar: 'https://images.unsplash.com/photo-1534751516642-a171edd2521d?w=150&auto=format&fit=crop&q=80',
    role: 'member',
    title: 'Technical Documentation Writer',
    department: 'Operations',
    status: 'active',
    phone: '+1 (555) 019-7412',
    initials: 'EW',
  },
  {
    id: 'emp-15',
    name: 'Nathan Drake',
    email: 'nathan.drake@handlemydesk.internal',
    avatar: 'https://images.unsplash.com/photo-1501196354995-cbb51c65aaea?w=150&auto=format&fit=crop&q=80',
    role: 'member',
    title: 'Security & Compliance Specialist',
    department: 'Engineering',
    status: 'active',
    phone: '+1 (555) 019-9023',
    initials: 'ND',
  },
  {
    id: 'emp-16',
    name: 'Olivia Taylor',
    email: 'olivia.taylor@handlemydesk.internal',
    avatar: 'https://images.unsplash.com/photo-1567532939604-b6b5b0db2604?w=150&auto=format&fit=crop&q=80',
    role: 'member',
    title: 'Client Success Manager',
    department: 'Client Success',
    status: 'active',
    phone: '+1 (555) 019-6124',
    initials: 'OT',
  },
  {
    id: 'emp-17',
    name: 'Zoe Kravitz',
    email: 'zoe.kravitz@handlemydesk.internal',
    avatar: 'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=150&auto=format&fit=crop&q=80',
    role: 'member',
    title: 'Visual & Motion Designer',
    department: 'Design',
    status: 'active',
    phone: '+1 (555) 019-4509',
    initials: 'ZK',
  },
  {
    id: 'emp-18',
    name: 'Ethan Hunt',
    email: 'ethan.hunt@handlemydesk.internal',
    avatar: 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?w=150&auto=format&fit=crop&q=80',
    role: 'member',
    title: 'Data & Infrastructure Specialist',
    department: 'Engineering',
    status: 'active',
    phone: '+1 (555) 019-2187',
    initials: 'EH',
  },
];

const INITIAL_CLIENTS: Client[] = [
  {
    id: 'cli-1',
    name: 'Acme Global Innovations',
    company: 'Acme Holdings Ltd.',
    industry: 'Fintech & Payments',
    contactPerson: 'Jonathan Hayes (VP Engineering)',
    email: 'j.hayes@acmeinnovations.com',
    phone: '+1 (415) 890-2100',
    status: 'active',
    totalBilled: 145000,
    activeProjectsCount: 2,
    notes: 'Key enterprise account. Strict compliance and monthly executive reporting required.',
    website: 'https://acmeinnovations.com',
  },
  {
    id: 'cli-2',
    name: 'Horizon Media Group',
    company: 'Horizon Publishing Inc.',
    industry: 'Digital Media & Streaming',
    contactPerson: 'Rebecca Vance (Chief Digital Officer)',
    email: 'rebecca@horizonmedia.tv',
    phone: '+1 (212) 555-7389',
    status: 'active',
    totalBilled: 92000,
    activeProjectsCount: 1,
    notes: 'Publishing migration in progress. Weekly sprint demos on Thursday at 2 PM EST.',
    website: 'https://horizonmedia.tv',
  },
  {
    id: 'cli-3',
    name: 'BluePeak Technologies',
    company: 'BluePeak SaaS Platforms',
    industry: 'Enterprise B2B Cloud',
    contactPerson: 'Arthur Pendelton (CTO)',
    email: 'arthur@bluepeakcloud.io',
    phone: '+1 (650) 441-9032',
    status: 'active',
    totalBilled: 180000,
    activeProjectsCount: 1,
    notes: 'High-availability multi-region cloud deployment. Critical SLA targets.',
    website: 'https://bluepeakcloud.io',
  },
  {
    id: 'cli-4',
    name: 'Nexus Retail Systems',
    company: 'Nexus Omnichannel LLC',
    industry: 'E-commerce & Omnichannel Retail',
    contactPerson: 'Melissa Wong (Head of Product)',
    email: 'm.wong@nexusretail.com',
    phone: '+1 (312) 782-9900',
    status: 'active',
    totalBilled: 110000,
    activeProjectsCount: 1,
    notes: 'Omnichannel mobile app roll-out for 120 retail stores.',
    website: 'https://nexusretail.com',
  },
  {
    id: 'cli-5',
    name: 'BioHealth Dynamics',
    company: 'BioHealth Research Group',
    industry: 'Biotech & Health Sciences',
    contactPerson: 'Dr. Gregory House (Director of Informatics)',
    email: 'ghouse@biohealthdynamics.org',
    phone: '+1 (617) 320-1122',
    status: 'active',
    totalBilled: 75000,
    activeProjectsCount: 1,
    notes: 'HIPAA compliance validation needed for diagnostic analytics platform.',
    website: 'https://biohealthdynamics.org',
  },
  {
    id: 'cli-6',
    name: 'Quantum Capital Partners',
    company: 'Quantum Asset Management',
    industry: 'Hedge Fund & Wealth Management',
    contactPerson: 'Charles Sterling (Managing Partner)',
    email: 'sterling@quantumcap.com',
    phone: '+1 (212) 880-9901',
    status: 'active',
    totalBilled: 220000,
    activeProjectsCount: 1,
    notes: 'Confidential client. Security audit and restricted project workspace required.',
    website: 'https://quantumcap.com',
  },
  {
    id: 'cli-7',
    name: 'Stellar Energy Ventures',
    company: 'Stellar CleanTech Corp',
    industry: 'Renewables & Grid Intelligence',
    contactPerson: 'Karin Larsson (VP Sustainability)',
    email: 'k.larsson@stellarenergy.de',
    phone: '+49 30 9923 8812',
    status: 'prospect',
    totalBilled: 25000,
    activeProjectsCount: 0,
    notes: 'Proposal submitted for grid telemetry dashboard and IoT integration.',
    website: 'https://stellarenergy.de',
  },
  {
    id: 'cli-8',
    name: 'Internal Operations',
    company: 'HandleMyDesk Internal',
    industry: 'Internal Office Management',
    contactPerson: 'Sarah Connor',
    email: 'sarah.connor@handlemydesk.internal',
    phone: '+1 (555) 019-2831',
    status: 'active',
    totalBilled: 0,
    activeProjectsCount: 1,
    notes: 'Internal office operations, knowledge base, employee tooling and tooling enhancements.',
    website: 'https://handlemydesk.internal',
  },
];

const INITIAL_PROJECTS: Project[] = [
  {
    id: 'prj-1',
    code: 'WEB-2026',
    name: 'Website Redesign & Brand Refresh',
    clientId: 'cli-1',
    clientName: 'Acme Global Innovations',
    description: 'Comprehensive redesign of Acme Global public website, customer onboarding flows, design token library, and corporate rebrand.',
    status: 'active',
    priority: 'high',
    leadId: 'emp-3',
    leadName: 'Elena Rostova',
    leadAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    budget: 65000,
    spent: 41200,
    startDate: '2026-08-01',
    targetDate: '2026-12-15',
    completionPercentage: 68,
    category: 'Design & Web Development',
    teamMemberIds: ['emp-1', 'emp-2', 'emp-3', 'emp-5', 'emp-7', 'emp-12', 'emp-17'],
    createdAt: '2026-07-20T10:00:00Z',
    updatedAt: '2026-10-25T14:30:00Z',
  },
  {
    id: 'prj-2',
    code: 'CLD-409',
    name: 'Cloud Infrastructure Migration',
    clientId: 'cli-3',
    clientName: 'BluePeak Technologies',
    description: 'Migrating legacy monolith workloads to Kubernetes clusters with automated GitOps pipelines, Terraform IaC, and 99.99% uptime SLA.',
    status: 'active',
    priority: 'urgent',
    leadId: 'emp-2',
    leadName: 'Marcus Vance',
    leadAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    budget: 95000,
    spent: 72400,
    startDate: '2026-06-15',
    targetDate: '2026-11-30',
    completionPercentage: 82,
    category: 'Cloud Architecture & DevOps',
    teamMemberIds: ['emp-1', 'emp-2', 'emp-6', 'emp-8', 'emp-11', 'emp-18'],
    createdAt: '2026-06-01T09:00:00Z',
    updatedAt: '2026-10-26T11:15:00Z',
  },
  {
    id: 'prj-3',
    code: 'RET-881',
    name: 'Customer Portal & Mobile App',
    clientId: 'cli-4',
    clientName: 'Nexus Retail Systems',
    description: 'Cross-platform native iOS & Android shopping application with real-time in-store inventory syncing, digital loyalty, and contactless checkout.',
    status: 'active',
    priority: 'high',
    leadId: 'emp-4',
    leadName: 'David Kim',
    leadAvatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
    budget: 82000,
    spent: 39500,
    startDate: '2026-07-10',
    targetDate: '2027-01-20',
    completionPercentage: 54,
    category: 'Mobile & Full-Stack App',
    teamMemberIds: ['emp-1', 'emp-4', 'emp-5', 'emp-6', 'emp-9', 'emp-13'],
    createdAt: '2026-07-01T08:30:00Z',
    updatedAt: '2026-10-24T16:45:00Z',
  },
  {
    id: 'prj-4',
    code: 'OPS-100',
    name: 'Internal Operations & OS Platform',
    clientId: 'cli-8',
    clientName: 'Internal Operations',
    description: 'Custom desktop-inspired CRM, workspace tab engine, employee directories, and company-wide workflow management system.',
    status: 'active',
    priority: 'medium',
    leadId: 'emp-1',
    leadName: 'Sarah Connor',
    leadAvatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
    budget: 35000,
    spent: 18700,
    startDate: '2026-09-01',
    targetDate: '2026-12-31',
    completionPercentage: 75,
    category: 'Internal Systems',
    teamMemberIds: ['emp-1', 'emp-2', 'emp-3', 'emp-4', 'emp-6', 'emp-7', 'emp-14'],
    createdAt: '2026-08-25T11:00:00Z',
    updatedAt: '2026-10-26T09:20:00Z',
  },
  {
    id: 'prj-5',
    code: 'MED-310',
    name: 'Digital Asset Management Platform',
    clientId: 'cli-2',
    clientName: 'Horizon Media Group',
    description: 'Enterprise media asset repository with video transcoding, AI tagging, copyright licensing workflows, and fast CDN edge delivery.',
    status: 'active',
    priority: 'medium',
    leadId: 'emp-3',
    leadName: 'Elena Rostova',
    leadAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    budget: 52000,
    spent: 29000,
    startDate: '2026-08-15',
    targetDate: '2026-12-20',
    completionPercentage: 60,
    category: 'Media Engineering',
    teamMemberIds: ['emp-1', 'emp-3', 'emp-6', 'emp-7', 'emp-10', 'emp-17'],
    createdAt: '2026-08-01T14:00:00Z',
    updatedAt: '2026-10-23T15:10:00Z',
  },
  {
    id: 'prj-6',
    code: 'BIO-902',
    name: 'AI Diagnostic Analytics Suite',
    clientId: 'cli-5',
    clientName: 'BioHealth Dynamics',
    description: 'Clinical trial analytics engine with predictive cohort modeling, DICOM imaging viewer integration, and regulatory validation.',
    status: 'on_hold',
    priority: 'urgent',
    leadId: 'emp-2',
    leadName: 'Marcus Vance',
    leadAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    budget: 120000,
    spent: 45000,
    startDate: '2026-05-01',
    targetDate: '2027-03-31',
    completionPercentage: 40,
    category: 'AI & Data Science',
    teamMemberIds: ['emp-1', 'emp-2', 'emp-9', 'emp-11', 'emp-15', 'emp-18'],
    createdAt: '2026-04-15T12:00:00Z',
    updatedAt: '2026-10-18T10:00:00Z',
  },
  {
    id: 'prj-7',
    code: 'MKT-115',
    name: 'Q3 Global Fintech Marketing Campaign',
    clientId: 'cli-1',
    clientName: 'Acme Global Innovations',
    description: 'Multi-channel brand campaign, animated web explainer assets, interactive product calculator, and high-conversion landing page variants.',
    status: 'completed',
    priority: 'medium',
    leadId: 'emp-3',
    leadName: 'Elena Rostova',
    leadAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    budget: 40000,
    spent: 38900,
    startDate: '2026-06-01',
    targetDate: '2026-09-30',
    completionPercentage: 100,
    category: 'Marketing & Creative',
    teamMemberIds: ['emp-1', 'emp-3', 'emp-5', 'emp-10', 'emp-12', 'emp-16'],
    createdAt: '2026-05-20T10:00:00Z',
    updatedAt: '2026-10-01T17:00:00Z',
  },
  {
    id: 'prj-8',
    code: 'SEC-770',
    name: 'Executive Security Audit & Vault',
    clientId: 'cli-6',
    clientName: 'Quantum Capital Partners',
    description: 'RESTRICTED: Penetration testing, zero-trust cryptographic key management, employee phishing resilience training, and SOC2 compliance audit.',
    status: 'active',
    priority: 'urgent',
    leadId: 'emp-2',
    leadName: 'Marcus Vance',
    leadAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    budget: 150000,
    spent: 89000,
    startDate: '2026-07-01',
    targetDate: '2026-12-01',
    completionPercentage: 62,
    category: 'Cybersecurity & Compliance',
    teamMemberIds: ['emp-1', 'emp-2', 'emp-4', 'emp-8', 'emp-15'],
    createdAt: '2026-06-25T11:00:00Z',
    updatedAt: '2026-10-26T08:00:00Z',
  },
];

const INITIAL_TASKS: Task[] = [
  // WEB-2026 Tasks
  {
    id: 'tsk-101',
    projectId: 'prj-1',
    projectCode: 'WEB-2026',
    projectName: 'Website Redesign & Brand Refresh',
    title: 'Finalize Figma design tokens and responsive typography scales',
    description: 'Ensure contrast ratios satisfy WCAG AAA standards for dark and light modes across all interactive elements.',
    status: 'done',
    priority: 'high',
    assigneeId: 'emp-5',
    assigneeName: 'Maya Patel',
    assigneeAvatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&auto=format&fit=crop&q=80',
    dueDate: '2026-10-20',
    tags: ['Design', 'Figma', 'Tokens'],
    subtasks: [
      { id: 'st-1', title: 'Export color palette to CSS variables', completed: true },
      { id: 'st-2', title: 'Document type scale in style guide', completed: true },
      { id: 'st-3', title: 'Verify mobile contrast ratios', completed: true },
    ],
    createdAt: '2026-10-05T09:00:00Z',
    updatedAt: '2026-10-19T14:00:00Z',
  },
  {
    id: 'tsk-102',
    projectId: 'prj-1',
    projectCode: 'WEB-2026',
    projectName: 'Website Redesign & Brand Refresh',
    title: 'Implement Interactive Pricing Calculator component',
    description: 'Build tier slider, annual billing discount toggle, and real-time ROI savings display.',
    status: 'in_progress',
    priority: 'urgent',
    assigneeId: 'emp-7',
    assigneeName: 'Chloe Bennet',
    assigneeAvatar: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=150&auto=format&fit=crop&q=80',
    dueDate: '2026-10-30',
    tags: ['Frontend', 'React', 'Animation'],
    subtasks: [
      { id: 'st-4', title: 'Calculator formula edge cases', completed: true },
      { id: 'st-5', title: 'Accessible keyboard range sliders', completed: true },
      { id: 'st-6', title: 'Animation micro-interactions', completed: false },
    ],
    createdAt: '2026-10-12T11:30:00Z',
    updatedAt: '2026-10-25T16:00:00Z',
  },
  {
    id: 'tsk-103',
    projectId: 'prj-1',
    projectCode: 'WEB-2026',
    projectName: 'Website Redesign & Brand Refresh',
    title: 'SEO schema markup and OpenGraph dynamic social cards',
    description: 'Add JSON-LD Organization and Product schemas, generate dynamic SVG-based social previews.',
    status: 'todo',
    priority: 'medium',
    assigneeId: 'emp-5',
    assigneeName: 'Maya Patel',
    assigneeAvatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&auto=format&fit=crop&q=80',
    dueDate: '2026-11-05',
    tags: ['SEO', 'Marketing'],
    subtasks: [
      { id: 'st-7', title: 'Structure schema.org metadata', completed: false },
      { id: 'st-8', title: 'Setup dynamic OG image generator', completed: false },
    ],
    createdAt: '2026-10-18T10:00:00Z',
    updatedAt: '2026-10-18T10:00:00Z',
  },
  {
    id: 'tsk-104',
    projectId: 'prj-1',
    projectCode: 'WEB-2026',
    projectName: 'Website Redesign & Brand Refresh',
    title: 'Customer onboarding video hero asset integration',
    description: 'Compress H.265/AV1 video streams with poster fallbacks and zero layout shift.',
    status: 'in_review',
    priority: 'medium',
    assigneeId: 'emp-17',
    assigneeName: 'Zoe Kravitz',
    assigneeAvatar: 'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=150&auto=format&fit=crop&q=80',
    dueDate: '2026-10-28',
    tags: ['Media', 'Motion', 'Video'],
    subtasks: [
      { id: 'st-9', title: 'Render 4K webm and mp4 variants', completed: true },
      { id: 'st-10', title: 'Test low-bandwidth fallback', completed: true },
    ],
    createdAt: '2026-10-15T14:00:00Z',
    updatedAt: '2026-10-24T18:00:00Z',
  },

  // CLD-409 Tasks
  {
    id: 'tsk-201',
    projectId: 'prj-2',
    projectCode: 'CLD-409',
    projectName: 'Cloud Infrastructure Migration',
    title: 'Configure automated blue/green deployment strategy in ArgoCD',
    description: 'Ensure automated rollbacks occur immediately if HTTP 5xx error rate exceeds 0.2% over a 3-minute window.',
    status: 'in_progress',
    priority: 'urgent',
    assigneeId: 'emp-8',
    assigneeName: 'Carlos Mendez',
    assigneeAvatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&auto=format&fit=crop&q=80',
    dueDate: '2026-11-02',
    tags: ['DevOps', 'Kubernetes', 'ArgoCD'],
    subtasks: [
      { id: 'st-11', title: 'Install Argo Rollouts controller', completed: true },
      { id: 'st-12', title: 'Write Prometheus analysis metric templates', completed: true },
      { id: 'st-13', title: 'Simulate load test failure and auto-rollback', completed: false },
    ],
    createdAt: '2026-10-10T08:00:00Z',
    updatedAt: '2026-10-26T09:00:00Z',
  },
  {
    id: 'tsk-202',
    projectId: 'prj-2',
    projectCode: 'CLD-409',
    projectName: 'Cloud Infrastructure Migration',
    title: 'Terraform state lock DynamoDB and S3 bucket migration',
    description: 'Enforce AES-256 encryption at rest, enable versioning, and configure strict cross-account IAM boundaries.',
    status: 'done',
    priority: 'high',
    assigneeId: 'emp-2',
    assigneeName: 'Marcus Vance',
    assigneeAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    dueDate: '2026-10-15',
    tags: ['Terraform', 'Security', 'AWS'],
    subtasks: [
      { id: 'st-14', title: 'Provision encrypted S3 bucket', completed: true },
      { id: 'st-15', title: 'Migrate legacy local state', completed: true },
    ],
    createdAt: '2026-10-01T10:00:00Z',
    updatedAt: '2026-10-15T15:00:00Z',
  },
  {
    id: 'tsk-203',
    projectId: 'prj-2',
    projectCode: 'CLD-409',
    projectName: 'Cloud Infrastructure Migration',
    title: 'Setup Grafana observability dashboards and PagerDuty routing',
    description: 'Instrument cluster node memory, CPU throttling, Pod restart frequency, and latency percentiles.',
    status: 'todo',
    priority: 'medium',
    assigneeId: 'emp-6',
    assigneeName: 'James Thornton',
    assigneeAvatar: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150&auto=format&fit=crop&q=80',
    dueDate: '2026-11-12',
    tags: ['Monitoring', 'Grafana', 'SRE'],
    subtasks: [],
    createdAt: '2026-10-20T11:00:00Z',
    updatedAt: '2026-10-20T11:00:00Z',
  },

  // RET-881 Tasks
  {
    id: 'tsk-301',
    projectId: 'prj-3',
    projectCode: 'RET-881',
    projectName: 'Customer Portal & Mobile App',
    title: 'Barcode & QR Scanner camera module integration',
    description: 'Integrate native camera barcode scanner for instant in-store price lookup and inventory verification.',
    status: 'in_progress',
    priority: 'high',
    assigneeId: 'emp-13',
    assigneeName: 'Lucas Scott',
    assigneeAvatar: 'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=150&auto=format&fit=crop&q=80',
    dueDate: '2026-11-08',
    tags: ['Mobile', 'React Native', 'Camera'],
    subtasks: [
      { id: 'st-16', title: 'Test iOS VisionKit framework', completed: true },
      { id: 'st-17', title: 'Configure Android ML Kit fallback', completed: true },
      { id: 'st-18', title: 'Handle permission denial UI state', completed: false },
    ],
    createdAt: '2026-10-14T09:30:00Z',
    updatedAt: '2026-10-25T11:00:00Z',
  },
  {
    id: 'tsk-302',
    projectId: 'prj-3',
    projectCode: 'RET-881',
    projectName: 'Customer Portal & Mobile App',
    title: 'Apple Pay and Google Pay one-tap checkout flow',
    description: 'Implement biometric authorization token handoff with payment gateway and idempotency key protection.',
    status: 'todo',
    priority: 'urgent',
    assigneeId: 'emp-6',
    assigneeName: 'James Thornton',
    assigneeAvatar: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150&auto=format&fit=crop&q=80',
    dueDate: '2026-11-20',
    tags: ['Fintech', 'Payments', 'Security'],
    subtasks: [],
    createdAt: '2026-10-18T14:00:00Z',
    updatedAt: '2026-10-18T14:00:00Z',
  },

  // OPS-100 Tasks
  {
    id: 'tsk-401',
    projectId: 'prj-4',
    projectCode: 'OPS-100',
    projectName: 'Internal Operations & OS Platform',
    title: 'Desktop Project Tab Workspace System implementation',
    description: 'Build persistent tab arrangement, instant switching without full reload, duplicate prevention, and access controls.',
    status: 'in_progress',
    priority: 'urgent',
    assigneeId: 'emp-1',
    assigneeName: 'Sarah Connor',
    assigneeAvatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
    dueDate: '2026-10-29',
    tags: ['Core OS', 'Tabs', 'Architecture'],
    subtasks: [
      { id: 'st-19', title: 'Horizontal tab bar with close icons', completed: true },
      { id: 'st-20', title: 'UserWorkspace database schema & API', completed: true },
      { id: 'st-21', title: 'Add project picker modal and dropdown', completed: true },
      { id: 'st-22', title: 'Automated integration tests', completed: false },
    ],
    createdAt: '2026-10-22T08:00:00Z',
    updatedAt: '2026-10-26T12:00:00Z',
  },
  {
    id: 'tsk-402',
    projectId: 'prj-4',
    projectCode: 'OPS-100',
    projectName: 'Internal Operations & OS Platform',
    title: 'Audit logging and role-based permission verification middleware',
    description: 'Server must validate project access on all endpoints and prevent member data leaks.',
    status: 'done',
    priority: 'high',
    assigneeId: 'emp-2',
    assigneeName: 'Marcus Vance',
    assigneeAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    dueDate: '2026-10-24',
    tags: ['Security', 'RBAC', 'Auth'],
    subtasks: [
      { id: 'st-23', title: 'JWT token signing and decoding', completed: true },
      { id: 'st-24', title: 'Project team membership guard', completed: true },
    ],
    createdAt: '2026-10-20T10:00:00Z',
    updatedAt: '2026-10-24T17:00:00Z',
  },
];

const INITIAL_MILESTONES: ProjectMilestone[] = [
  {
    id: 'mls-1',
    projectId: 'prj-1',
    title: 'Phase 1: Brand Strategy & Design System Freeze',
    description: 'Approved color tokens, typographic rhythm, component kits, and stakeholder signoff.',
    targetDate: '2026-09-30',
    status: 'completed',
    progress: 100,
    ownerId: 'emp-3',
    ownerName: 'Elena Rostova',
  },
  {
    id: 'mls-2',
    projectId: 'prj-1',
    title: 'Phase 2: Interactive Frontend Build & CMS Wiring',
    description: 'Build all key marketing templates, pricing calculator, responsive testing.',
    targetDate: '2026-11-15',
    status: 'in_progress',
    progress: 65,
    ownerId: 'emp-7',
    ownerName: 'Chloe Bennet',
  },
  {
    id: 'mls-3',
    projectId: 'prj-1',
    title: 'Phase 3: Final QA, Performance Audit & Launch',
    description: 'Core Web Vitals 95+ score, security audit, DNS cutover to production.',
    targetDate: '2026-12-15',
    status: 'pending',
    progress: 0,
    ownerId: 'emp-3',
    ownerName: 'Elena Rostova',
  },
  {
    id: 'mls-4',
    projectId: 'prj-2',
    title: 'Phase 1: VPC Architecture & Multi-AZ Cluster Provisioning',
    description: 'Establish isolated subnets, transit gateways, and resilient EKS cluster topology.',
    targetDate: '2026-08-30',
    status: 'completed',
    progress: 100,
    ownerId: 'emp-2',
    ownerName: 'Marcus Vance',
  },
  {
    id: 'mls-5',
    projectId: 'prj-2',
    title: 'Phase 2: Database Re-platforming & Zero-Downtime Replication',
    description: 'Migrate MySQL monolith to Aurora Serverless v2 with live binary log replication.',
    targetDate: '2026-10-31',
    status: 'in_progress',
    progress: 85,
    ownerId: 'emp-8',
    ownerName: 'Carlos Mendez',
  },
];

const INITIAL_DELIVERABLES: ProjectDeliverable[] = [
  {
    id: 'del-1',
    projectId: 'prj-1',
    title: 'Corporate Brand Identity & Token Guidebook v2.0',
    description: 'Complete 84-page visual guidelines and Figma token exports.',
    dueDate: '2026-10-15',
    status: 'approved',
    ownerId: 'emp-5',
    ownerName: 'Maya Patel',
    signedOffBy: 'Jonathan Hayes (VP Engineering)',
    signedOffAt: '2026-10-16T11:20:00Z',
  },
  {
    id: 'del-2',
    projectId: 'prj-1',
    title: 'Production Staging Web Environment',
    description: 'Complete functional staging deployment for executive review.',
    dueDate: '2026-11-10',
    status: 'in_review',
    ownerId: 'emp-7',
    ownerName: 'Chloe Bennet',
  },
  {
    id: 'del-3',
    projectId: 'prj-1',
    title: 'SEO & Performance Benchmarking Certificate',
    description: 'Lighthouse 95+ desktop and mobile performance report with SEO telemetry.',
    dueDate: '2026-12-05',
    status: 'pending',
    ownerId: 'emp-3',
    ownerName: 'Elena Rostova',
  },
  {
    id: 'del-4',
    projectId: 'prj-2',
    title: 'Production Cluster Disaster Recovery Playbook',
    description: 'Detailed step-by-step procedures for cross-region failover under 15 minutes RTO.',
    dueDate: '2026-11-15',
    status: 'in_review',
    ownerId: 'emp-8',
    ownerName: 'Carlos Mendez',
  },
];

const INITIAL_CHAT_MESSAGES: ProjectChatMessage[] = [
  {
    id: 'msg-1',
    projectId: 'prj-1',
    senderId: 'emp-3',
    senderName: 'Elena Rostova',
    senderAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    senderRole: 'Head of Creative & Product PM',
    text: 'Good morning team! The client executive team just reviewed the Figma token system and gave their unconditional approval. Awesome work Maya! 🎉',
    timestamp: '2026-10-26T09:15:00Z',
    reactions: { '🎉': ['emp-5', 'emp-7', 'emp-1'] },
  },
  {
    id: 'msg-2',
    projectId: 'prj-1',
    senderId: 'emp-5',
    senderName: 'Maya Patel',
    senderAvatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&auto=format&fit=crop&q=80',
    senderRole: 'Senior UX/UI Designer',
    text: 'Thank you Elena! I pushed the latest interactive prototype link to the Project Links section for Chloe to test the responsive breakpoint transitions.',
    timestamp: '2026-10-26T09:30:00Z',
    reactions: { '❤️': ['emp-3'] },
  },
  {
    id: 'msg-3',
    projectId: 'prj-1',
    senderId: 'emp-7',
    senderName: 'Chloe Bennet',
    senderAvatar: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=150&auto=format&fit=crop&q=80',
    senderRole: 'Frontend Specialist',
    text: 'Checking it out now. The pricing slider formulas are already coded and integrated with our design system tokens.',
    timestamp: '2026-10-26T09:42:00Z',
  },
  {
    id: 'msg-4',
    projectId: 'prj-2',
    senderId: 'emp-2',
    senderName: 'Marcus Vance',
    senderAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    senderRole: 'Lead Systems Architect & PM',
    text: 'Cluster replication lag is down to 42 milliseconds. We will schedule the final dry run for Saturday midnight window.',
    timestamp: '2026-10-26T10:00:00Z',
    reactions: { '🚀': ['emp-8', 'emp-1'] },
  },
];

const INITIAL_FILES: ProjectFile[] = [
  {
    id: 'fil-1',
    projectId: 'prj-1',
    name: 'Master_Brand_Styleguide_v2.4.pdf',
    category: 'assets',
    fileSize: '14.8 MB',
    fileType: 'PDF Document',
    uploadedBy: 'Maya Patel',
    uploadedAt: '2026-10-20T14:10:00Z',
    downloadUrl: '#',
  },
  {
    id: 'fil-2',
    projectId: 'prj-1',
    name: 'Acme_Redesign_Service_Agreement_Signed.pdf',
    category: 'contracts',
    fileSize: '2.4 MB',
    fileType: 'Legal Document',
    uploadedBy: 'Sarah Connor',
    uploadedAt: '2026-08-02T11:00:00Z',
    downloadUrl: '#',
  },
  {
    id: 'fil-3',
    projectId: 'prj-1',
    name: 'Interactive_Pricing_Specs_v1.2.docx',
    category: 'specs',
    fileSize: '840 KB',
    fileType: 'Word Document',
    uploadedBy: 'Chloe Bennet',
    uploadedAt: '2026-10-18T16:20:00Z',
    downloadUrl: '#',
  },
  {
    id: 'fil-4',
    projectId: 'prj-2',
    name: 'Kubernetes_MultiRegion_Topology.drawio.png',
    category: 'specs',
    fileSize: '5.1 MB',
    fileType: 'PNG Image',
    uploadedBy: 'Carlos Mendez',
    uploadedAt: '2026-09-12T09:30:00Z',
    downloadUrl: '#',
  },
];

const INITIAL_NOTES: ProjectNote[] = [
  {
    id: 'not-1',
    projectId: 'prj-1',
    title: 'Executive Kickoff & Requirements Alignment',
    content: `# Acme Global Redesign — Executive Alignment Notes\n\n### Strategic Objectives\n1. **Conversion Velocity**: Increase demo request signups by 35% through streamlined hero copy and frictionless form flows.\n2. **Enterprise Credibility**: Modernize visual typography, micro-interactions, and dark/light system adaptation.\n3. **Global Localization**: Support 5 regional languages with RTL support for Middle East expansion.\n\n### Key Deliverables Timeline\n- Week 4: Brand Token Signoff (Completed)\n- Week 8: Staging Prototype Review (Current)\n- Week 12: Production Deployment and DNS Cutover\n\n### Stakeholders\n- Jonathan Hayes (Client VP Engineering)\n- Elena Rostova (Lead Creative Director)\n- Sarah Connor (Executive Operations Sponsor)`,
    category: 'meeting',
    authorId: 'emp-3',
    authorName: 'Elena Rostova',
    updatedAt: '2026-10-24T15:00:00Z',
  },
  {
    id: 'not-2',
    projectId: 'prj-1',
    title: 'Technical Frontend Architecture & Bundle Limits',
    content: `# Frontend Architectural Guidelines\n\n- **Bundle Budget**: Initial JS payload must strictly remain below 120kb gzipped.\n- **Font Loading**: Preconnect to font CDN, use \`font-display: swap\` with zero layout shift.\n- **Asset Strategy**: All hero vectors must be inlined; photographic assets served in modern AVIF/WebP formats with explicit width/height tags.\n- **Accessibility**: Keyboard navigable tab index, full ARIA roles for custom controls.`,
    category: 'architecture',
    authorId: 'emp-7',
    authorName: 'Chloe Bennet',
    updatedAt: '2026-10-25T11:30:00Z',
  },
  {
    id: 'not-3',
    projectId: 'prj-2',
    title: 'Disaster Recovery Runbook & Failover Thresholds',
    content: `# AWS Disaster Recovery Playbook\n\n### Target SLA Metrics\n- **RTO (Recovery Time Objective)**: < 15 minutes\n- **RPO (Recovery Point Objective)**: < 60 seconds\n\n### Automated Trigger Criteria\n- 5xx status error rate > 1.5% sustained for 3 minutes on Primary Region (us-east-1).\n- AWS Health Dashboard active regional outage notification.\n\n### Failover Command\n\`kubectl scale deployment core-gateway --replicas=24 -n prod-secondary\``,
    category: 'architecture',
    authorId: 'emp-2',
    authorName: 'Marcus Vance',
    updatedAt: '2026-10-22T17:15:00Z',
  },
];

const INITIAL_LINKS: ProjectLink[] = [
  {
    id: 'lnk-1',
    projectId: 'prj-1',
    title: 'Figma Production Workspace',
    url: 'https://figma.com/@handlemydesk/acme-redesign-2026',
    category: 'design',
    description: 'Design tokens, component library, high-fidelity responsive screens and mobile prototypes.',
    addedBy: 'Maya Patel',
    addedAt: '2026-08-05T10:00:00Z',
  },
  {
    id: 'lnk-2',
    projectId: 'prj-1',
    title: 'Staging Environment Preview',
    url: 'https://staging.acme.handlemydesk.internal',
    category: 'staging',
    description: 'Continuous deployment staging branch running the latest commits from main.',
    addedBy: 'Chloe Bennet',
    addedAt: '2026-09-01T14:30:00Z',
  },
  {
    id: 'lnk-3',
    projectId: 'prj-1',
    title: 'GitHub Enterprise Repository',
    url: 'https://github.com/handlemydesk-internal/acme-web-platform',
    category: 'repository',
    description: 'Main monorepo containing frontend application, CMS integrations, and end-to-end test suites.',
    addedBy: 'Chloe Bennet',
    addedAt: '2026-08-01T09:00:00Z',
  },
  {
    id: 'lnk-4',
    projectId: 'prj-2',
    title: 'ArgoCD GitOps Dashboard',
    url: 'https://argocd.bluepeak.internal',
    category: 'staging',
    description: 'Kubernetes cluster state synchronization, rollouts and canary status monitor.',
    addedBy: 'Carlos Mendez',
    addedAt: '2026-09-10T12:00:00Z',
  },
];

const INITIAL_ACTIVITIES: ProjectActivity[] = [
  {
    id: 'act-1',
    projectId: 'prj-1',
    userId: 'emp-3',
    userName: 'Elena Rostova',
    userAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    action: 'approved deliverable "Corporate Brand Identity & Token Guidebook v2.0"',
    timestamp: '2026-10-26T09:10:00Z',
    type: 'milestone',
  },
  {
    id: 'act-2',
    projectId: 'prj-1',
    userId: 'emp-7',
    userName: 'Chloe Bennet',
    userAvatar: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=150&auto=format&fit=crop&q=80',
    action: 'updated task "Implement Interactive Pricing Calculator" to In Progress',
    timestamp: '2026-10-25T16:00:00Z',
    type: 'task',
  },
  {
    id: 'act-3',
    projectId: 'prj-1',
    userId: 'emp-5',
    userName: 'Maya Patel',
    userAvatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&auto=format&fit=crop&q=80',
    action: 'uploaded file "Master_Brand_Styleguide_v2.4.pdf"',
    timestamp: '2026-10-20T14:10:00Z',
    type: 'file',
  },
  {
    id: 'act-4',
    projectId: 'prj-2',
    userId: 'emp-2',
    userName: 'Marcus Vance',
    userAvatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    action: 'completed milestone "Phase 1: VPC Architecture & Multi-AZ Cluster Provisioning"',
    timestamp: '2026-10-15T15:00:00Z',
    type: 'milestone',
  },
];

const INITIAL_WORKSPACES: Record<string, UserWorkspace> = {
  // Sarah Connor (Admin)
  'emp-1': {
    id: 'ws-emp-1',
    userId: 'emp-1',
    tabs: [
      { projectId: 'prj-1', tabOrder: 0, openedAt: '2026-10-26T08:00:00Z' },
      { projectId: 'prj-2', tabOrder: 1, openedAt: '2026-10-26T08:05:00Z' },
      { projectId: 'prj-4', tabOrder: 2, openedAt: '2026-10-26T08:10:00Z' },
    ],
    activeTabId: 'prj-1',
    updatedAt: '2026-10-26T09:00:00Z',
  },
  // Marcus Vance (PM)
  'emp-2': {
    id: 'ws-emp-2',
    userId: 'emp-2',
    tabs: [
      { projectId: 'prj-2', tabOrder: 0, openedAt: '2026-10-26T08:15:00Z' },
      { projectId: 'prj-8', tabOrder: 1, openedAt: '2026-10-26T08:20:00Z' },
    ],
    activeTabId: 'prj-2',
    updatedAt: '2026-10-26T08:25:00Z',
  },
  // Elena Rostova (PM)
  'emp-3': {
    id: 'ws-emp-3',
    userId: 'emp-3',
    tabs: [
      { projectId: 'prj-1', tabOrder: 0, openedAt: '2026-10-26T08:30:00Z' },
      { projectId: 'prj-5', tabOrder: 1, openedAt: '2026-10-26T08:35:00Z' },
    ],
    activeTabId: 'prj-1',
    updatedAt: '2026-10-26T08:40:00Z',
  },
  // Maya Patel (Member)
  'emp-5': {
    id: 'ws-emp-5',
    userId: 'emp-5',
    tabs: [
      { projectId: 'prj-1', tabOrder: 0, openedAt: '2026-10-26T08:45:00Z' },
      { projectId: 'prj-3', tabOrder: 1, openedAt: '2026-10-26T08:50:00Z' },
    ],
    activeTabId: 'prj-1',
    updatedAt: '2026-10-26T08:55:00Z',
  },
};

const INITIAL_NOTIFICATIONS: NotificationItem[] = [
  {
    id: 'notif-1',
    userId: 'emp-1',
    title: 'New Milestone Completed',
    message: 'Phase 1: Brand Strategy & Design System Freeze for Website Redesign was approved.',
    projectId: 'prj-1',
    projectName: 'Website Redesign & Brand Refresh',
    type: 'success',
    read: false,
    timestamp: '2026-10-26T09:12:00Z',
  },
  {
    id: 'notif-2',
    userId: 'emp-1',
    title: 'Task Assignment',
    message: 'You were assigned to lead Desktop Project Tab Workspace System.',
    projectId: 'prj-4',
    projectName: 'Internal Operations & OS Platform',
    type: 'info',
    read: false,
    timestamp: '2026-10-26T08:00:00Z',
  },
  {
    id: 'notif-3',
    userId: 'emp-2',
    title: 'Urgent Task Status Change',
    message: 'Carlos Mendez updated task "Configure automated blue/green deployment strategy".',
    projectId: 'prj-2',
    projectName: 'Cloud Infrastructure Migration',
    type: 'alert',
    read: false,
    timestamp: '2026-10-26T09:00:00Z',
  },
];

function freshSeed(): DatabaseSchema {
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
  return {
    users: clone(INITIAL_USERS),
    clients: clone(INITIAL_CLIENTS),
    projects: clone(INITIAL_PROJECTS),
    tasks: clone(INITIAL_TASKS),
    milestones: clone(INITIAL_MILESTONES),
    chatMessages: clone(INITIAL_CHAT_MESSAGES),
    files: clone(INITIAL_FILES),
    notes: clone(INITIAL_NOTES),
    links: clone(INITIAL_LINKS),
    deliverables: clone(INITIAL_DELIVERABLES),
    activities: clone(INITIAL_ACTIVITIES),
    workspaces: clone(INITIAL_WORKSPACES),
    notifications: clone(INITIAL_NOTIFICATIONS),
    comments: [],
    templates: [],
  };
}

function emptySchema(): DatabaseSchema {
  return {
    users: [],
    clients: [],
    projects: [],
    tasks: [],
    milestones: [],
    chatMessages: [],
    files: [],
    notes: [],
    links: [],
    deliverables: [],
    activities: [],
    workspaces: {},
    notifications: [],
    comments: [],
    templates: [],
  };
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/**
 * A fresh production install starts empty (no demo accounts with a known password) and
 * creates its first administrator from INITIAL_ADMIN_* settings in .env.
 */
export interface FirstAdmin {
  name: string;
  email: string;
  password: string;
  // false: the password stays; otherwise they choose their own at first sign-in
  mustChange?: boolean;
}

function bootstrapAdminFromEnv(given?: FirstAdmin): { user: User; password: string } {
  const name = (given?.name ?? process.env.INITIAL_ADMIN_NAME)?.trim();
  const email = (given?.email ?? process.env.INITIAL_ADMIN_EMAIL)?.trim().toLowerCase();
  const password = given?.password ?? process.env.INITIAL_ADMIN_PASSWORD ?? '';
  if (given && (!name || !email || password.length < 8)) {
    throw new Error('The first administrator needs a name, an email and a password of 8+ characters');
  }
  if (!name || !email || password.length < 8) {
    console.error(
      '\nThis is a new installation with an empty database.\n' +
        'Set INITIAL_ADMIN_NAME, INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD (8+ characters) in .env,\n' +
        'then start the server again. See SETUP.md.\n'
    );
    process.exit(1);
  }
  return {
    password,
    user: {
      id: 'emp-admin',
      name,
      email,
      avatar: '',
      role: 'admin',
      title: 'Administrator',
      department: 'Operations',
      status: 'active',
      phone: '',
      initials: initialsOf(name),
      active: true,
    },
  };
}

// Demo data is for development only, unless explicitly requested with SEED_DEMO=true
const SEED_DEMO = process.env.SEED_DEMO ? process.env.SEED_DEMO === 'true' : !IS_PROD;

/**
 * Database changes, applied once each, in order, and recorded in schema_migrations.
 * `sql` runs before the data is loaded (table/column changes); `data` runs after, on the
 * loaded documents (backfills). Add new entries at the end; never edit an applied one.
 */
interface Migration {
  version: number;
  name: string;
  sql?: (sql: DatabaseSync) => void;
  data?: (data: DatabaseSchema, sql: DatabaseSync) => void;
}

const columnsOf = (sql: DatabaseSync, table: string) =>
  (sql.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'Sign-in: session versions and forced password changes',
    sql: (sql) => {
      const columns = columnsOf(sql, 'credentials');
      if (!columns.includes('session_version')) sql.exec('ALTER TABLE credentials ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0');
      if (!columns.includes('must_change')) sql.exec('ALTER TABLE credentials ADD COLUMN must_change INTEGER NOT NULL DEFAULT 0');
    },
  },
  {
    version: 2,
    name: 'Projects: record a stage for projects created before stages existed',
    data: (data) => {
      for (const p of data.projects) if (!p.stage) p.stage = p.status === 'completed' ? 'delivered' : 'in_progress';
    },
  },
  {
    version: 3,
    name: 'Rename the demo company from Novadesk to HandleMyDesk',
    // Only the made-up demo domain, demo client and demo password change; real accounts are untouched
    data: (data, sql) => {
      const oldDomain = '@novadesk.internal';
      const swap = (v: string) => v.replace(/novadesk/g, 'handlemydesk').replace(/Nova[Dd]esk/g, 'HandleMyDesk');
      const demoUsers = data.users.filter((u) => u.email.toLowerCase().endsWith(oldDomain));
      for (const u of demoUsers) u.email = u.email.replace(oldDomain, '@handlemydesk.internal');
      for (const c of data.clients) {
        if (c.email.endsWith(oldDomain) || /novadesk/i.test(c.name)) {
          c.name = swap(c.name);
          c.company = swap(c.company);
          c.email = swap(c.email);
          c.website = swap(c.website);
        }
      }
      for (const p of data.projects) p.clientName = data.clients.find((c) => c.id === p.clientId)?.name ?? p.clientName;
      for (const l of data.links) if (/novadesk/.test(l.url)) l.url = swap(l.url);

      // Demo accounts still on the old demo password move to the new one
      const get = sql.prepare('SELECT password_hash FROM credentials WHERE user_id = ?');
      const set = sql.prepare('UPDATE credentials SET password_hash = ? WHERE user_id = ?');
      for (const u of demoUsers) {
        const row = get.get(u.id) as { password_hash: string } | undefined;
        if (row && bcrypt.compareSync('novadesk123', row.password_hash)) set.run(getSeedPasswordHash(), u.id);
      }
    },
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

let seedPasswordHash: string | null = null;
function getSeedPasswordHash(): string {
  if (!seedPasswordHash) seedPasswordHash = bcrypt.hashSync(SEED_PASSWORD, 10);
  return seedPasswordHash;
}

/**
 * SQLite-backed store. Each collection is a table of JSON documents keyed by id, with a
 * position column that preserves array order. Routes work against the in-memory copy
 * returned by getData(); save() writes only the rows that changed, inside one transaction,
 * so a crash mid-write can never leave a half-written database.
 */
export class Database {
  private sql: DatabaseSync;
  private data!: DatabaseSchema;
  // Last persisted "pos|json" per row, used to find what changed on save()
  private persisted = new Map<CollectionKey, Map<string, string>>();

  // Where this office's backups go
  public readonly backupDir: string;
  // Set for a brand-new office: its first administrator (instead of demo data or .env settings)
  private readonly firstAdmin?: FirstAdmin;

  constructor(file: string = DB_FILE, opts: { backupDir?: string; firstAdmin?: FirstAdmin } = {}) {
    this.backupDir = opts.backupDir ?? BACKUP_DIR;
    this.firstAdmin = opts.firstAdmin;
    if (!IS_TEST) fs.mkdirSync(file === ':memory:' ? DATA_DIR : path.dirname(file), { recursive: true });
    this.sql = new DatabaseSync(file);
    if (!IS_TEST) this.sql.exec('PRAGMA journal_mode = WAL;');
    for (const c of COLLECTIONS) {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS ${c} (id TEXT PRIMARY KEY, pos INTEGER NOT NULL, data TEXT NOT NULL)`);
    }
    this.sql.exec('CREATE TABLE IF NOT EXISTS credentials (user_id TEXT PRIMARY KEY, password_hash TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');

    const applied = new Set((this.sql.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map((r) => r.version));
    const pending = MIGRATIONS.filter((m) => !applied.has(m.version));
    const { n: existingUsers } = this.sql.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };

    // Existing data gets a safety copy before it's changed
    if (pending.length && existingUsers > 0 && file !== ':memory:') {
      const info = createBackup(this.sql, 'premigrate', this.backupDir);
      console.log(`Saved ${info.name} before updating the database`);
    }

    for (const m of pending) m.sql?.(this.sql);
    this.load();
    if (pending.some((m) => m.data)) {
      for (const m of pending) m.data?.(this.data, this.sql);
      this.save();
    }
    const record = this.sql.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)');
    for (const m of pending) {
      record.run(m.version, m.name, new Date().toISOString());
      if (existingUsers > 0) console.log(`Database updated: ${m.version}. ${m.name}`);
    }
  }

  public schemaVersion(): number {
    const row = this.sql.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number | null };
    return row.v ?? 0;
  }

  private load() {
    const { n } = this.sql.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
    if (n === 0 && this.firstAdmin) {
      const { user, password } = bootstrapAdminFromEnv(this.firstAdmin);
      user.id = `emp-${crypto.randomUUID().slice(0, 8)}`;
      this.data = emptySchema();
      this.data.users.push(user);
      this.save();
      this.setPasswordHash(user.id, bcrypt.hashSync(password, 10), { mustChange: this.firstAdmin.mustChange !== false });
      return;
    }
    if (n === 0) {
      const legacy = this.importLegacyJson();
      if (legacy || SEED_DEMO) {
        this.data = legacy ?? freshSeed();
        this.save();
        this.seedMissingCredentials();
        return;
      }
      const { user, password } = bootstrapAdminFromEnv();
      this.data = emptySchema();
      this.data.users.push(user);
      this.save();
      // The password from .env must be replaced at first sign-in
      this.setPasswordHash(user.id, bcrypt.hashSync(password, 10), { mustChange: true });
      console.log(`Created the first administrator account: ${user.email}`);
      return;
    }

    const data = {} as Record<CollectionKey, unknown>;
    for (const c of COLLECTIONS) {
      const rows = this.sql.prepare(`SELECT id, pos, data FROM ${c} ORDER BY pos`).all() as Array<{
        id: string;
        pos: number;
        data: string;
      }>;
      const snapshot = new Map<string, string>();
      const docs = rows.map((r) => {
        snapshot.set(r.id, `${r.pos}|${r.data}`);
        return JSON.parse(r.data);
      });
      this.persisted.set(c, snapshot);
      data[c] = c === 'workspaces' ? Object.fromEntries(docs.map((w: UserWorkspace) => [w.userId, w])) : docs;
    }
    this.data = data as unknown as DatabaseSchema;
    this.seedMissingCredentials();
  }

  // One-time migration from the old data/db.json store
  private importLegacyJson(): DatabaseSchema | null {
    if (IS_TEST || !fs.existsSync(LEGACY_JSON_FILE)) return null;
    try {
      const legacy = JSON.parse(fs.readFileSync(LEGACY_JSON_FILE, 'utf-8')) as Record<string, unknown>;
      const seed = freshSeed() as unknown as Record<string, unknown>;
      for (const c of COLLECTIONS) {
        if (!legacy[c]) legacy[c] = seed[c];
      }
      fs.renameSync(LEGACY_JSON_FILE, `${LEGACY_JSON_FILE}.migrated`);
      console.log(`Imported legacy ${LEGACY_JSON_FILE} into SQLite (original kept as db.json.migrated)`);
      return legacy as unknown as DatabaseSchema;
    } catch (err) {
      console.error('Could not import legacy db.json, starting from seed data instead:', err);
      return null;
    }
  }

  private seedMissingCredentials() {
    const insert = this.sql.prepare('INSERT OR IGNORE INTO credentials (user_id, password_hash) VALUES (?, ?)');
    for (const u of this.data.users) insert.run(u.id, getSeedPasswordHash());
  }

  private rowsOf(c: CollectionKey): Array<[string, unknown]> {
    if (c === 'workspaces') return Object.values(this.data.workspaces).map((w) => [w.userId, w]);
    return (this.data[c] as Array<{ id: string }>).map((doc) => [doc.id, doc]);
  }

  public save() {
    this.sql.exec('BEGIN');
    try {
      for (const c of COLLECTIONS) {
        const before = this.persisted.get(c) ?? new Map<string, string>();
        const after = new Map<string, string>();
        const upsert = this.sql.prepare(
          `INSERT INTO ${c} (id, pos, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET pos = excluded.pos, data = excluded.data`
        );
        this.rowsOf(c).forEach(([id, doc], pos) => {
          const json = JSON.stringify(doc);
          const key = `${pos}|${json}`;
          after.set(id, key);
          if (before.get(id) !== key) upsert.run(id, pos, json);
        });
        const remove = this.sql.prepare(`DELETE FROM ${c} WHERE id = ?`);
        for (const id of before.keys()) {
          if (!after.has(id)) remove.run(id);
        }
        this.persisted.set(c, after);
      }
      this.sql.exec('COMMIT');
    } catch (err) {
      this.sql.exec('ROLLBACK');
      // In-memory state may now be ahead of disk; force a full rewrite on the next save
      this.persisted.clear();
      throw err;
    }
  }

  public getData(): DatabaseSchema {
    return this.data;
  }

  /** Per-user sign-in state: bumping session_version signs the user out everywhere. */
  public getAuthState(userId: string): { sessionVersion: number; mustChange: boolean } {
    const row = this.sql.prepare('SELECT session_version, must_change FROM credentials WHERE user_id = ?').get(userId) as
      | { session_version: number; must_change: number }
      | undefined;
    return { sessionVersion: row?.session_version ?? 0, mustChange: !!row?.must_change };
  }

  public bumpSessionVersion(userId: string): number {
    this.sql.prepare('UPDATE credentials SET session_version = session_version + 1 WHERE user_id = ?').run(userId);
    return this.getAuthState(userId).sessionVersion;
  }

  public backup(label?: string): BackupInfo {
    const info = createBackup(this.sql, label, this.backupDir);
    pruneBackups(undefined, this.backupDir);
    return info;
  }

  public getPasswordHash(userId: string): string | null {
    const row = this.sql.prepare('SELECT password_hash FROM credentials WHERE user_id = ?').get(userId) as
      | { password_hash: string }
      | undefined;
    return row?.password_hash ?? null;
  }

  public setPasswordHash(userId: string, hash: string, { mustChange = false } = {}) {
    this.sql
      .prepare(
        'INSERT INTO credentials (user_id, password_hash, must_change) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET password_hash = excluded.password_hash, must_change = excluded.must_change'
      )
      .run(userId, hash, mustChange ? 1 : 0);
  }

  public close() {
    this.sql.close();
  }

  public resetToDefault(): DatabaseSchema {
    this.data = freshSeed();
    this.save();
    this.sql.exec('DELETE FROM credentials');
    this.seedMissingCredentials();
    return this.data;
  }
}

/**
 * Only one server process may use the data directory. Each process keeps the data in memory,
 * so a second copy would serve stale data and overwrite the first one's changes. Every user
 * is served by the one process (Node handles many concurrent requests); scaling out would
 * need a shared database server instead.
 */
function acquireSingleInstanceLock() {
  const lockFile = LOCK_FILE;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  try {
    fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx' });
  } catch (err: any) {
    if (err.code !== 'EEXIST') throw err;
    const owner = Number(fs.readFileSync(lockFile, 'utf-8'));
    let ownerAlive = false;
    try {
      process.kill(owner, 0);
      ownerAlive = owner !== process.pid;
    } catch {
      // Stale lock left by a process that crashed or was killed
    }
    if (ownerAlive) {
      console.error(
        `\nAnother HandleMyDesk server (process ${owner}) is already running on ${DATA_DIR}.\n` +
          `Stop it first (close its terminal, or run: taskkill /PID ${owner} /T /F) and start again.\n`
      );
      process.exit(1);
    }
    fs.writeFileSync(lockFile, String(process.pid));
  }

  const release = () => {
    try {
      if (fs.readFileSync(lockFile, 'utf-8') === String(process.pid)) fs.unlinkSync(lockFile);
    } catch {
      // Already gone
    }
  };
  process.on('exit', release);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => process.exit(0));
}

// The product was renamed: move the old database file (with its WAL journal) to the new name.
// Safe here because this process holds the single-server lock, so nothing else has it open.
function renameLegacyDatabase() {
  if (!fs.existsSync(LEGACY_DB_PATH)) return;
  if (fs.existsSync(DB_PATH)) {
    console.warn(
      `Both ${path.basename(DB_PATH)} and ${path.basename(LEGACY_DB_PATH)} exist in ${DATA_DIR}. Using ${path.basename(DB_PATH)}; ` +
        `if your data is in ${path.basename(LEGACY_DB_PATH)}, stop the server, move ${path.basename(DB_PATH)} (and its -wal/-shm files) away and start again.`
    );
    return;
  }
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(LEGACY_DB_PATH + suffix)) fs.renameSync(LEGACY_DB_PATH + suffix, DB_PATH + suffix);
  }
  console.log(`Renamed ${path.basename(LEGACY_DB_PATH)} to ${path.basename(DB_PATH)}`);
}

if (!IS_TEST) {
  acquireSingleInstanceLock();
  renameLegacyDatabase();
}

/*
 * OFFICES. Every customer office has its own Database (its own SQLite file, uploads and backups).
 * Each request runs "inside" one office, chosen from the sign-in token (see platform.ts), and
 * `db` always means the current office's database. Outside a request (tests, scripts, start-up)
 * it means the main office: the original installation.
 */
export interface Tenant {
  id: string;
  db: Database;
  uploadsDir: string;
  backupDir: string;
}

export const MAIN_TENANT_ID = 'main';
const tenantStore = new AsyncLocalStorage<Tenant>();
export const MAIN_TENANT: Tenant = { id: MAIN_TENANT_ID, db: new Database(), uploadsDir: UPLOADS_DIR, backupDir: BACKUP_DIR };

// Once the server is serving, work that doesn't know its office is refused instead of quietly
// using the main office's data (see requireOfficeContext).
let strict = false;

/**
 * From now on, reading or writing data without an office throws. The server turns this on before it
 * starts serving, so a mistake in the code fails loudly instead of touching the wrong office.
 */
export function requireOfficeContext(on = true) {
  strict = on;
}

export class NoOfficeError extends Error {
  constructor() {
    super('No office selected for this work; refusing to use the main office by default');
  }
}

export function currentTenant(): Tenant {
  const tenant = tenantStore.getStore();
  if (tenant) return tenant;
  if (strict) throw new NoOfficeError();
  return MAIN_TENANT;
}

/** Runs fn (and everything it awaits) inside an office. */
export function runInTenant<T>(tenant: Tenant, fn: () => T): T {
  return tenantStore.run(tenant, fn);
}

export const db: Database = new Proxy({} as Database, {
  get(_target, prop) {
    const target = currentTenant().db;
    const value = (target as any)[prop];
    return typeof value === 'function' ? value.bind(target) : value;
  },
});
