import type { Task, TaskFieldInput } from '../contracts/types';
import { FIELD_MESSAGES } from './messages';
import { invalid, valid, type FieldErrors, type ValidationResult } from './result';
import { isUuid, isValidDateString } from './date';
import { isTaskStatus } from './status';
import { parseTaskPriority } from './priority';
import {
  normalizeBoardName,
  normalizeTaskDescription,
  normalizeTaskTitle,
} from './text';

/**
 * Build the full PUT body from an existing task. P0 has no status-only route:
 * status buttons and ordinary edits both submit all five business fields.
 */
export function taskToFieldInput(
  task: Task,
  patch: Partial<TaskFieldInput> = {},
): TaskFieldInput {
  return {
    title: task.title,
    description: task.description,
    dueDate: task.dueDate,
    assigneeId: task.assigneeId,
    status: task.status,
    ...(task.priority === undefined ? {} : { priority: task.priority }),
    ...patch,
  };
}

function hasOwn(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

export function parseBoardNameInput(
  body: Record<string, unknown>,
): ValidationResult<{ name: string }> {
  if (!hasOwn(body, 'name')) {
    return invalid('name', FIELD_MESSAGES.NAME_REQUIRED);
  }
  const name = normalizeBoardName(body.name);
  return name.ok ? valid({ name: name.value }) : name;
}

export function parseTaskTitle(raw: unknown): ValidationResult<string> {
  return normalizeTaskTitle(raw);
}

export function parseTaskDescription(raw: unknown): ValidationResult<string> {
  if (raw === undefined) {
    return invalid('description', FIELD_MESSAGES.DESCRIPTION_TYPE);
  }
  return normalizeTaskDescription(raw);
}

export function parseDueDate(raw: unknown): ValidationResult<string | null> {
  if (raw === null) {
    return valid(null);
  }
  if (typeof raw !== 'string') {
    return invalid('dueDate', FIELD_MESSAGES.DUE_DATE_TYPE);
  }
  if (!isValidDateString(raw)) {
    return invalid('dueDate', FIELD_MESSAGES.DUE_DATE_INVALID);
  }
  return valid(raw);
}

export function parseAssigneeId(raw: unknown): ValidationResult<string | null> {
  if (raw === null) {
    return valid(null);
  }
  if (typeof raw !== 'string') {
    return invalid('assigneeId', FIELD_MESSAGES.ASSIGNEE_TYPE);
  }
  if (!isUuid(raw)) {
    return invalid('assigneeId', FIELD_MESSAGES.ASSIGNEE_FORMAT);
  }
  return valid(raw);
}

export function parseTaskStatus(raw: unknown): ValidationResult<TaskFieldInput['status']> {
  if (typeof raw !== 'string') {
    return invalid('status', FIELD_MESSAGES.STATUS_TYPE);
  }
  if (!isTaskStatus(raw)) {
    return invalid('status', FIELD_MESSAGES.STATUS_INVALID);
  }
  return valid(raw);
}

/**
 * POST body: title is required; the other four fields may be omitted and fall
 * back to the creation defaults. `null` is only valid for dueDate/assigneeId.
 */
export function parseTaskCreateInput(
  body: Record<string, unknown>,
  priorityEnabled = false,
): ValidationResult<TaskFieldInput> {
  const fields: FieldErrors = {};

  let title = '';
  if (!hasOwn(body, 'title')) {
    fields.title = FIELD_MESSAGES.TITLE_REQUIRED;
  } else {
    const result = normalizeTaskTitle(body.title);
    if (result.ok) {
      title = result.value;
    } else {
      Object.assign(fields, result.fields);
    }
  }

  let description = '';
  if (hasOwn(body, 'description')) {
    const result = normalizeTaskDescription(body.description);
    if (result.ok) {
      description = result.value;
    } else {
      Object.assign(fields, result.fields);
    }
  }

  let dueDate: string | null = null;
  if (hasOwn(body, 'dueDate')) {
    const result = parseDueDate(body.dueDate);
    if (result.ok) {
      dueDate = result.value;
    } else {
      Object.assign(fields, result.fields);
    }
  }

  let assigneeId: string | null = null;
  if (hasOwn(body, 'assigneeId')) {
    const result = parseAssigneeId(body.assigneeId);
    if (result.ok) {
      assigneeId = result.value;
    } else {
      Object.assign(fields, result.fields);
    }
  }

  let status: TaskFieldInput['status'] = 'todo';
  if (hasOwn(body, 'status')) {
    const result = parseTaskStatus(body.status);
    if (result.ok) {
      status = result.value;
    } else {
      Object.assign(fields, result.fields);
    }
  }

  const priority = priorityEnabled ? parseTaskPriority(hasOwn(body, 'priority') ? body.priority : 'medium') : null;
  if (priority && !priority.ok) Object.assign(fields, priority.fields);
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return valid({ title, description, dueDate, assigneeId, status, ...(priority?.ok ? { priority: priority.value } : {}) });
}

/**
 * PUT body: all five fields are required; a missing field is not "clear it"
 * (spec §4.2). Explicit null clears dueDate/assigneeId, empty string clears
 * the description.
 */
export function parseTaskUpdateInput(
  body: Record<string, unknown>,
  priorityEnabled = false,
): ValidationResult<TaskFieldInput> {
  const fields: FieldErrors = {};

  let title = '';
  if (!hasOwn(body, 'title')) {
    fields.title = FIELD_MESSAGES.MISSING_TITLE;
  } else {
    const result = normalizeTaskTitle(body.title);
    if (result.ok) {
      title = result.value;
    } else {
      Object.assign(fields, result.fields);
    }
  }

  let description = '';
  if (!hasOwn(body, 'description')) {
    fields.description = FIELD_MESSAGES.MISSING_DESCRIPTION;
  } else {
    const result = normalizeTaskDescription(body.description);
    if (result.ok) {
      description = result.value;
    } else {
      Object.assign(fields, result.fields);
    }
  }

  let dueDate: string | null = null;
  if (!hasOwn(body, 'dueDate')) {
    fields.dueDate = FIELD_MESSAGES.MISSING_DUE_DATE;
  } else {
    const result = parseDueDate(body.dueDate);
    if (result.ok) {
      dueDate = result.value;
    } else {
      Object.assign(fields, result.fields);
    }
  }

  let assigneeId: string | null = null;
  if (!hasOwn(body, 'assigneeId')) {
    fields.assigneeId = FIELD_MESSAGES.MISSING_ASSIGNEE;
  } else {
    const result = parseAssigneeId(body.assigneeId);
    if (result.ok) {
      assigneeId = result.value;
    } else {
      Object.assign(fields, result.fields);
    }
  }

  let status: TaskFieldInput['status'] = 'todo';
  if (!hasOwn(body, 'status')) {
    fields.status = FIELD_MESSAGES.MISSING_STATUS;
  } else {
    const result = parseTaskStatus(body.status);
    if (result.ok) {
      status = result.value;
    } else {
      Object.assign(fields, result.fields);
    }
  }

  const priority = priorityEnabled ? parseTaskPriority(body.priority) : null;
  if (priority && !priority.ok) Object.assign(fields, priority.fields);
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return valid({ title, description, dueDate, assigneeId, status, ...(priority?.ok ? { priority: priority.value } : {}) });
}
