import type { TaskStatus } from '../contracts/types';

export const TASK_STATUSES: readonly TaskStatus[] = Object.freeze([
  'todo',
  'doing',
  'done',
]);

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: '待办',
  doing: '进行中',
  done: '已完成',
};

export function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}