import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../http/errors';

const COST = { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 };
let activeHashes = 0;

async function derive(password: string, salt: string): Promise<Buffer> {
  // Bound memory and CPU before entering the libuv queue.
  if (activeHashes >= 2) throw new AppError(429, 'RATE_LIMITED');
  activeHashes += 1;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, 64, COST, (error, result) => error ? reject(error) : resolve(result));
    });
  } finally {
    activeHashes -= 1;
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${(await derive(password, salt)).toString('hex')}`;
}

export async function verifyPassword(password: string, stored?: string): Promise<boolean> {
  const [, salt = '0'.repeat(32), expected = '0'.repeat(128)] = (stored ?? '').split('$');
  const actual = await derive(password, salt);
  const target = Buffer.from(expected, 'hex');
  return target.length === actual.length && timingSafeEqual(actual, target) && stored !== undefined;
}

export function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function csrfFor(token: string): string {
  return digest(`team-plan:csrf:${token}`);
}

export function sameSecret(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
