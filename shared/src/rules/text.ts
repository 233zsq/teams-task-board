import { FIELD_MESSAGES } from './messages';
import { invalid, valid, type ValidationResult } from './result';

export const BOARD_NAME_MAX = 50;
export const TASK_TITLE_MAX = 100;
export const TASK_DESCRIPTION_MAX = 2000;

/** C0 controls, DEL and C1 controls. U+0000 is included in the first range. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * Zero-width and bidirectional control characters rejected in names and
 * titles. U+200C/U+200D stay allowed so emoji sequences and text shaping work.
 */
const NAME_INVISIBLE_CHARS =
  /[\u00ad\u200b\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff]/;

/**
 * Descriptions keep line breaks and tabs. Only those three controls are
 * allowed; bidi overrides are rejected (spec §4.1).
 */
const DESCRIPTION_FORBIDDEN_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
const DESCRIPTION_FORBIDDEN_BIDI = /[\u202a-\u202e\u2066-\u2069]/;

/** Unicode code point count, matching the backend/database character semantics. */
export function countCodePoints(value: string): number {
  return [...value].length;
}

function normalizeSingleLine(
  raw: unknown,
  field: 'name' | 'title',
  maxLength: number,
): ValidationResult<string> {
  if (typeof raw !== 'string') {
    return invalid(
      field,
      field === 'name' ? FIELD_MESSAGES.NAME_TYPE : FIELD_MESSAGES.TITLE_TYPE,
    );
  }

  const value = raw.trim();
  if (value.length === 0) {
    return invalid(
      field,
      field === 'name' ? FIELD_MESSAGES.NAME_REQUIRED : FIELD_MESSAGES.TITLE_REQUIRED,
    );
  }

  if (CONTROL_CHARS.test(value) || NAME_INVISIBLE_CHARS.test(value)) {
    return invalid(
      field,
      field === 'name'
        ? FIELD_MESSAGES.NAME_INVALID_CHARS
        : FIELD_MESSAGES.TITLE_INVALID_CHARS,
    );
  }

  if (countCodePoints(value) > maxLength) {
    return invalid(
      field,
      field === 'name' ? FIELD_MESSAGES.NAME_TOO_LONG : FIELD_MESSAGES.TITLE_TOO_LONG,
    );
  }

  return valid(value);
}

/** Board name: trim, 1–50 code points, no controls/zero-width/bidi characters. */
export function normalizeBoardName(raw: unknown): ValidationResult<string> {
  return normalizeSingleLine(raw, 'name', BOARD_NAME_MAX);
}

/** Task title: trim, 1–100 code points, no controls/zero-width/bidi characters. */
export function normalizeTaskTitle(raw: unknown): ValidationResult<string> {
  return normalizeSingleLine(raw, 'title', TASK_TITLE_MAX);
}

/**
 * Description: no trimming (line breaks and inner spacing are user content),
 * 0–2000 code points, newlines/tabs allowed, bidi overrides rejected.
 */
export function normalizeTaskDescription(raw: unknown): ValidationResult<string> {
  if (typeof raw !== 'string') {
    return invalid('description', FIELD_MESSAGES.DESCRIPTION_TYPE);
  }
  if (
    DESCRIPTION_FORBIDDEN_CONTROLS.test(raw) ||
    DESCRIPTION_FORBIDDEN_BIDI.test(raw)
  ) {
    return invalid('description', FIELD_MESSAGES.DESCRIPTION_INVALID_CHARS);
  }
  if (countCodePoints(raw) > TASK_DESCRIPTION_MAX) {
    return invalid('description', FIELD_MESSAGES.DESCRIPTION_TOO_LONG);
  }
  return valid(raw);
}