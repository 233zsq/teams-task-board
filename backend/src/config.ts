import path from 'node:path';

export type NodeEnvironment = 'development' | 'test' | 'production';

export interface FeatureFlags {
  priority: boolean;
  filters: boolean;
  ordering: boolean;
  sharing: boolean;
}

export interface AppConfig {
  env: NodeEnvironment;
  host: string;
  port: number;
  databasePath: string;
  allowedHosts: string[];
  features: FeatureFlags;
}

export class ConfigError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super('配置无效');
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

const ENVIRONMENTS = new Set<NodeEnvironment>(['development', 'test', 'production']);
const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];
const HOSTNAME_PATTERN = /^[a-z0-9.-]+$/;
const IPV6_BRACKET_PATTERN = /^\[[0-9a-f:.]+\]$/;

function read(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  return value === undefined ? undefined : value.trim();
}

function readFlag(
  env: NodeJS.ProcessEnv,
  key: string,
  problems: string[],
  defaultValue = false,
): boolean {
  const raw = read(env, key);
  if (raw === undefined) {
    return defaultValue;
  }
  if (raw === '0') {
    return false;
  }
  if (raw === '1') {
    return true;
  }
  problems.push(`${key} 只接受 0 或 1`);
  return false;
}

function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.includes(host) || host.startsWith('127.');
}

function normalizeAllowedHost(raw: string, problems: string[]): string | null {
  const host = raw.toLowerCase();

  if (host.startsWith('[')) {
    if (!IPV6_BRACKET_PATTERN.test(host)) {
      problems.push('ALLOWED_HOSTS 包含无效的 IPv6 地址');
      return null;
    }
    return host;
  }

  if (host.includes(':')) {
    problems.push('ALLOWED_HOSTS 的条目不能包含端口');
    return null;
  }

  if (!HOSTNAME_PATTERN.test(host)) {
    problems.push('ALLOWED_HOSTS 包含无效的主机名或 IP');
    return null;
  }

  return host;
}

export function loadConfig(env: NodeJS.ProcessEnv, projectRoot: string): AppConfig {
  const problems: string[] = [];
  const root = path.resolve(projectRoot);

  const rawEnv = read(env, 'NODE_ENV');
  const nodeEnv: NodeEnvironment =
    rawEnv === undefined || rawEnv === '' ? 'development' : (rawEnv as NodeEnvironment);
  if (!ENVIRONMENTS.has(nodeEnv)) {
    problems.push('NODE_ENV 只能是 development、test 或 production');
  }

  const host = read(env, 'HOST') ?? '127.0.0.1';
  if (host === '') {
    problems.push('HOST 不能为空');
  } else if (host.includes('://') || /[/\s]/.test(host)) {
    problems.push('HOST 必须是主机名或 IP，不能包含协议或路径');
  }

  const rawPort = read(env, 'PORT');
  let port = 3000;
  if (rawPort !== undefined) {
    if (!/^\d+$/.test(rawPort)) {
      problems.push('PORT 必须是 1-65535 的整数');
    } else {
      const parsed = Number(rawPort);
      if (parsed < 1 || parsed > 65535) {
        problems.push('PORT 必须是 1-65535 的整数');
      } else {
        port = parsed;
      }
    }
  }

  const rawDatabasePath = read(env, 'DATABASE_PATH');
  let databasePath = path.resolve(root, 'data/team-plan.sqlite');
  if (rawDatabasePath !== undefined) {
    if (rawDatabasePath === '') {
      problems.push('DATABASE_PATH 不能为空');
    } else {
      databasePath = path.resolve(root, rawDatabasePath);
    }
  }

  const features: FeatureFlags = {
    priority: readFlag(env, 'ENABLE_PRIORITY', problems, true),
    filters: readFlag(env, 'ENABLE_FILTERS', problems, true),
    ordering: readFlag(env, 'ENABLE_ORDERING', problems),
    sharing: readFlag(env, 'ENABLE_SHARING', problems),
  };

  if (features.filters && !features.priority) {
    problems.push('ENABLE_FILTERS=1 需要 ENABLE_PRIORITY=1');
  }

  if (features.ordering || features.sharing) {
    problems.push(
      '扩展功能尚未实现；ENABLE_ORDERING、ENABLE_SHARING 必须为 0',
    );
  }

  const rawAllowedHosts = read(env, 'ALLOWED_HOSTS');
  const allowedHosts: string[] = [];
  if (rawAllowedHosts) {
    for (const entry of rawAllowedHosts.split(',').map((value) => value.trim()).filter(Boolean)) {
      const normalized = normalizeAllowedHost(entry, problems);
      if (normalized !== null && !allowedHosts.includes(normalized)) {
        allowedHosts.push(normalized);
      }
    }
  } else if (isLoopbackHost(host)) {
    allowedHosts.push(...LOOPBACK_HOSTS);
  } else {
    problems.push('监听非回环地址时必须显式配置 ALLOWED_HOSTS');
  }

  if (problems.length > 0) {
    throw new ConfigError(problems);
  }

  return {
    env: nodeEnv,
    host,
    port,
    databasePath,
    allowedHosts: Object.freeze(allowedHosts) as string[],
    features: Object.freeze(features) as FeatureFlags,
  };
}
