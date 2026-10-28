import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config';

const ROOT = path.resolve('/workspace/team-plan');

function captureProblems(env: NodeJS.ProcessEnv): string[] {
  try {
    loadConfig(env, ROOT);
  } catch (error) {
    if (error instanceof ConfigError) {
      return error.problems;
    }
    throw error;
  }
  return [];
}

describe('loadConfig', () => {
  it('uses the documented defaults', () => {
    const config = loadConfig({}, ROOT);

    expect(config.env).toBe('development');
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(3000);
    expect(config.databasePath).toBe(path.resolve(ROOT, 'data/team-plan.sqlite'));
    expect(config.allowedHosts).toEqual(['127.0.0.1', 'localhost', '[::1]']);
    expect(config.features).toEqual({
      priority: true,
      filters: true,
      ordering: false,
      sharing: false,
    });
  });

  it('rejects invalid PORT values without echoing them', () => {
    for (const port of ['0', '65536', '3000abc', '-1']) {
      const problems = captureProblems({ PORT: port });
      expect(problems.some((problem) => problem.includes('PORT'))).toBe(true);
      expect(problems.join(' ')).not.toContain(port);
    }
  });

  it('only accepts 0 or 1 for ENABLE_* flags', () => {
    const problems = captureProblems({ ENABLE_PRIORITY: '2' });
    expect(problems.some((problem) => problem.includes('ENABLE_PRIORITY'))).toBe(true);
  });

  it('requires priority when filters are enabled', () => {
    const problems = captureProblems({ ENABLE_PRIORITY: '0', ENABLE_FILTERS: '1' });

    expect(problems.some((problem) => problem.includes('ENABLE_FILTERS=1 需要'))).toBe(true);
    expect(captureProblems({ ENABLE_PRIORITY: '1', ENABLE_FILTERS: '1' })).toEqual([]);
    expect(captureProblems({ ENABLE_PRIORITY: '1', ENABLE_FILTERS: '0' })).toEqual([]);
    expect(captureProblems({ ENABLE_PRIORITY: '0', ENABLE_FILTERS: '0' })).toEqual([]);
  });

  it('rejects sharing in the TASK-002 stage', () => {
    const problems = captureProblems({ ENABLE_SHARING: '1' });
    expect(problems.some((problem) => problem.includes('扩展功能尚未实现'))).toBe(true);
  });

  it('resolves DATABASE_PATH against the project root', () => {
    const config = loadConfig({ DATABASE_PATH: 'data/custom.sqlite' }, ROOT);
    expect(config.databasePath).toBe(path.resolve(ROOT, 'data/custom.sqlite'));
  });

  it('requires ALLOWED_HOSTS when listening on a non-loopback address', () => {
    const problems = captureProblems({ HOST: '192.168.1.10' });
    expect(problems.some((problem) => problem.includes('ALLOWED_HOSTS'))).toBe(true);

    const config = loadConfig(
      { HOST: '0.0.0.0', ALLOWED_HOSTS: 'example.com, 127.0.0.1' },
      ROOT,
    );
    expect(config.allowedHosts).toEqual(['example.com', '127.0.0.1']);
  });

  it('rejects ALLOWED_HOSTS entries with ports', () => {
    const problems = captureProblems({
      HOST: '0.0.0.0',
      ALLOWED_HOSTS: 'example.com:3000',
    });
    expect(problems.some((problem) => problem.includes('ALLOWED_HOSTS'))).toBe(true);
  });

  it('rejects invalid NODE_ENV and HOST values', () => {
    expect(captureProblems({ NODE_ENV: 'staging' }).length).toBeGreaterThan(0);
    expect(captureProblems({ HOST: 'http://example.com' }).length).toBeGreaterThan(0);
  });
});
