import { isUuid } from '@team-plan/shared';
import { AppError } from './errors';

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_DEPTH = 20;

export function assertJsonObject(value: unknown): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(400, 'BAD_REQUEST');
  }
}

export function assertSafeJson(value: unknown, depth = 0): void {
  if (depth > MAX_DEPTH) {
    throw new AppError(400, 'BAD_REQUEST');
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      assertSafeJson(item, depth + 1);
    }
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (DANGEROUS_KEYS.has(key)) {
        throw new AppError(400, 'BAD_REQUEST');
      }
      assertSafeJson((value as Record<string, unknown>)[key], depth + 1);
    }
  }
}

/** Reject any key outside the route's explicit whitelist. */
export function assertAllowedKeys(
  body: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(body)) {
    if (!allowedSet.has(key)) {
      throw new AppError(400, 'BAD_REQUEST');
    }
  }
}

/** Coerce an Express path parameter (wildcard-typed) to a plain string. */
export function pathParam(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : '';
}

/** Path UUIDs: a malformed value is a request error (400), not a missing resource. */
export function assertUuidParam(value: string): string {
  if (!isUuid(value)) {
    throw new AppError(400, 'BAD_REQUEST');
  }
  return value;
}

export interface ParsedQuery {
  [key: string]: string | undefined;
}

/** Reject unknown keys, duplicate keys and nested query objects. */
export function parseQuery(
  query: Record<string, unknown>,
  allowed: readonly string[],
): ParsedQuery {
  const allowedSet = new Set(allowed);
  const parsed: ParsedQuery = {};

  for (const [key, value] of Object.entries(query)) {
    if (!allowedSet.has(key)) {
      throw new AppError(400, 'BAD_REQUEST');
    }
    if (Array.isArray(value) || (value !== null && typeof value === 'object')) {
      throw new AppError(400, 'BAD_REQUEST');
    }
    parsed[key] = value === undefined ? undefined : String(value);
  }

  return parsed;
}
