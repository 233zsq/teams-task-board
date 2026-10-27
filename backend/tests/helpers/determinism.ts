/** Deterministic helpers for timestamp and ID assertions in API tests. */

export interface TestClock {
  (): Date;
  advance(ms: number): void;
}

/** A clock that starts at a fixed UTC instant and steps on every read. */
export function createTestClock(
  startIso = '2026-10-20T02:00:00.000Z',
  stepMs = 60_000,
): TestClock {
  let current = new Date(startIso).getTime();

  const clock = ((): Date => {
    const value = new Date(current);
    current += stepMs;
    return value;
  }) as TestClock;

  clock.advance = (ms: number): void => {
    current += ms;
  };

  return clock;
}

/** Sequential UUID v4-shaped IDs: ...-4333-8333-000000000001, ...0002, ... */
export function createSequentialUuid(
  prefix = '33333333-3333-4333-8333',
): () => string {
  let counter = 0;
  return (): string => {
    counter += 1;
    return `${prefix}-${String(counter).padStart(12, '0')}`;
  };
}

export const SEED_MEMBER_IDS = [
  '11111111-1111-4111-8111-111111111111',
  '11111111-1111-4111-8111-111111111112',
  '11111111-1111-4111-8111-111111111113',
  '11111111-1111-4111-8111-111111111114',
] as const;