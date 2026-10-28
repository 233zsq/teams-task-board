/** Shared API contract types. Field names and shapes mirror spec.md §9. */

export type TaskStatus = 'todo' | 'doing' | 'done';
export type TaskPriority = 'low' | 'medium' | 'high';

export interface TaskFilters {
  q?: string;
  assigneeId?: string;
  priority?: TaskPriority;
  dueFrom?: string;
  dueTo?: string;
}

export interface Board {
  id: string;
  name: string;
  createdAt: string;
  owner?: Member | null;
  memberCount?: number;
  role?: 'owner' | 'member';
}

export interface Member {
  id: string;
  displayName: string;
}

export interface Task {
  id: string;
  boardId: string;
  title: string;
  description: string;
  dueDate: string | null;
  assigneeId: string | null;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  createdBy?: Member | null;
  priority?: TaskPriority;
}

export interface AccountUser extends Member {
  username: string;
  createdAt: string;
}

export interface AccountSession {
  user: AccountUser | null;
  csrfToken: string | null;
}

export interface ProjectMember extends AccountUser {
  role: 'owner' | 'member';
}

export interface ProjectActivity {
  id: number;
  actor: Member;
  action: string;
  subject: string;
  createdAt: string;
}

/** The five complete business fields submitted by PUT and produced by POST. */
export interface TaskFieldInput {
  title: string;
  description: string;
  dueDate: string | null;
  assigneeId: string | null;
  status: TaskStatus;
  priority?: TaskPriority;
}

export interface CreateBoardInput {
  name: string;
}

export interface FeatureFlags {
  priority: boolean;
  filters: boolean;
  ordering: boolean;
  sharing: boolean;
}

export interface HealthData {
  status: 'ok';
  features: FeatureFlags;
}

export interface DataResponse<T> {
  data: T;
}
