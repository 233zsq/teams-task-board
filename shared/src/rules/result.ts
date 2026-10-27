export interface FieldErrors {
  [field: string]: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; fields: FieldErrors };

export function valid<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}

export function invalid<T>(field: string, message: string): ValidationResult<T> {
  return { ok: false, fields: { [field]: message } };
}

export function mergeFieldErrors(results: ValidationResult<unknown>[]): FieldErrors {
  const fields: FieldErrors = {};
  for (const result of results) {
    if (!result.ok) {
      Object.assign(fields, result.fields);
    }
  }
  return fields;
}