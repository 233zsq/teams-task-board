/** Frozen P0 DTOs: spec v0.4. No database names or optional-extension fields. */
export const TASK_STATUSES = ['todo', 'doing', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: '待办', doing: '进行中', done: '已完成',
};
export interface Board { id: string; name: string; createdAt: string }
export interface Member { id: string; displayName: string }
export interface Task {
  id: string; boardId: string; title: string; description: string;
  dueDate: string | null; assigneeId: string | null; status: TaskStatus;
  createdAt: string; updatedAt: string;
}
export interface CreateBoardInput { name: string }
export interface TaskDraft {
  title: string; description: string; dueDate: string | null;
  assigneeId: string | null; status: TaskStatus;
}
export type CreateTaskInput = Pick<TaskDraft, 'title'> & Partial<Omit<TaskDraft, 'title'>>;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/** Validate unknown JSON as well as UI drafts. Association existence stays server-side. */
export function validateTaskInput(input: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (typeof input.title !== 'string' || !input.title.trim()) errors.title = '请输入任务标题';
  else if (INVALID_NAME.test(input.title)) errors.title = '标题不能包含换行、控制字符或隐藏字符';
  else if (Array.from(input.title.trim()).length > 100) errors.title = '标题最多 100 个字符';
  if (input.description !== undefined && (typeof input.description !== 'string' ||
    Array.from(input.description).length > 2000 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(input.description))) {
    errors.description = '描述最多 2000 个字符，且不能包含非法控制字符';
  }
  if (input.dueDate !== undefined && input.dueDate !== null && !isCalendarDate(input.dueDate)) {
    errors.dueDate = '请填写有效日期 YYYY-MM-DD，或留空';
  }
  if (input.assigneeId !== undefined && input.assigneeId !== null &&
    (typeof input.assigneeId !== 'string' || !UUID_PATTERN.test(input.assigneeId))) errors.assigneeId = '请选择有效负责人';
  if (input.status !== undefined && !TASK_STATUSES.includes(input.status as TaskStatus)) errors.status = '请选择有效任务状态';
  return errors;
}
export interface Features { priority: boolean; filters: boolean; ordering: boolean; sharing: boolean }
export interface Health { status: 'ok'; features: Features }
export interface ApiSuccess<T> { data: T }
export interface ApiErrorEnvelope {
  error: { code: string; message: string; fields?: Record<string, string> };
}
export const BUSINESS_TIME_ZONE = 'Asia/Shanghai';

// spec §4.1: C0/C1, NUL, single-line controls, zero-width and bidi controls.
// ZWNJ/ZWJ are intentionally allowed for emoji and text shaping.
const INVALID_NAME = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b\u200e\u200f\u2028-\u202e\u2060-\u2064\u2066-\u206f\ufeff]/u;
export function validateBoardName(raw: string): string | null {
  if (INVALID_NAME.test(raw)) return '名称不能包含换行、控制字符或隐藏字符';
  const length = Array.from(raw.trim()).length;
  if (length === 0) return '请输入看板名称';
  if (length > 50) return '看板名称最多 50 个字符';
  return null;
}

export function compareCreated(a: { createdAt: string; id: string }, b: { createdAt: string; id: string }): number {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
