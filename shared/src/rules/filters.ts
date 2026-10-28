import type { TaskFilters } from '../contracts/types';
import { parseAssigneeId, parseDueDate } from './input';
import { parseTaskPriority } from './priority';
import { normalizeTaskTitle } from './text';
import { valid, type FieldErrors, type ValidationResult } from './result';

/** The same filter normalization and field errors are used by UI and HTTP. */
export function parseTaskFilters(raw: Record<string, unknown>): ValidationResult<TaskFilters> {
  const fields: FieldErrors = {};
  const value: TaskFilters = {};
  if (raw.q !== undefined && raw.q !== '') {
    if (typeof raw.q !== 'string') fields.q = '关键词必须是文本';
    else if (raw.q.trim() !== '') {
      const q = normalizeTaskTitle(raw.q);
      if (q.ok) value.q = q.value;
      else fields.q = '关键词限 100 个字符，不含换行或不可见控制字符';
    }
  }
  if (raw.assigneeId !== undefined && raw.assigneeId !== '') {
    if (raw.assigneeId === 'unassigned') value.assigneeId = 'unassigned';
    else {
      const parsed = parseAssigneeId(raw.assigneeId);
      if (parsed.ok && parsed.value !== null) value.assigneeId = parsed.value;
      else fields.assigneeId = '请选择有效的项目成员或未分配';
    }
  }
  if (raw.priority !== undefined && raw.priority !== '') {
    const parsed = parseTaskPriority(raw.priority);
    if (parsed.ok) value.priority = parsed.value;
    else Object.assign(fields, parsed.fields);
  }
  for (const key of ['dueFrom', 'dueTo'] as const) {
    if (raw[key] !== undefined && raw[key] !== '') {
      const parsed = parseDueDate(raw[key]);
      if (parsed.ok && parsed.value !== null) value[key] = parsed.value;
      else fields[key] = '请填写有效的日期';
    }
  }
  if (value.dueFrom && value.dueTo && value.dueFrom > value.dueTo) fields.dueTo = '截止范围结束日期不能早于开始日期';
  return Object.keys(fields).length ? { ok: false, fields } : valid(value);
}

export function hasTaskFilters(filters: TaskFilters): boolean {
  return Object.values(filters).some((value) => value !== undefined && value !== '');
}
