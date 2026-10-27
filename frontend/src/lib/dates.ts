import { BUSINESS_TIME_ZONE, type Task } from '@team-plan/shared';

/** Only timestamps go through Date. Calendar dueDate strings stay untouched. */
export function businessToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (name: string) => parts.find(p => p.type === name)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function formatTimestamp(value: string | null): string {
  if (!value) return '尚未刷新';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(value));
}
export function isOverdue(task: Pick<Task, 'dueDate' | 'status'>, today: string): boolean {
  return task.dueDate !== null && task.dueDate < today && task.status !== 'done';
}
