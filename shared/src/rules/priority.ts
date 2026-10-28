import type { TaskPriority } from '../contracts/types';
import { invalid, valid, type ValidationResult } from './result';

export const TASK_PRIORITIES: readonly TaskPriority[] = ['high', 'medium', 'low'];
export const PRIORITY_LABELS: Record<TaskPriority, string> = { high: '高优先级', medium: '中优先级', low: '低优先级' };

export function parseTaskPriority(raw: unknown): ValidationResult<TaskPriority> {
  return typeof raw === 'string' && TASK_PRIORITIES.includes(raw as TaskPriority)
    ? valid(raw as TaskPriority)
    : invalid('priority', '请选择高、中或低优先级');
}
