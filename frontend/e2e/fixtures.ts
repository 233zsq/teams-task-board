import { test as base, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const backendUrl = 'http://127.0.0.1:3101';
export const test = base.extend<{ service: { restart(): Promise<void>; databasePath: string } }>({
  service: [async ({}, use) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'teamplan-s1-e2e-'));
    const databasePath = path.join(dir, 's1.sqlite');
    const env = { ...process.env, DATABASE_PATH: databasePath, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '3101', ALLOWED_HOSTS: '127.0.0.1,localhost,[::1]', ENABLE_PRIORITY: '0', ENABLE_FILTERS: '0', ENABLE_ORDERING: '0', ENABLE_SHARING: '0' };
    let server: ChildProcess | undefined;
    async function stop() {
      const child = server; server = undefined;
      if (!child || child.exitCode !== null) return;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Test backend did not exit')), 10_000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
        child.kill();
      });
    }
    async function start() {
      // Never attach to or terminate an unrelated developer service.
      const occupied = await fetch(`${backendUrl}/api/v1/health`).then(() => true, () => false);
      if (occupied) throw new Error('Port 3101 is already in use; stop that service or choose a test port.');
      server = spawn(process.execPath, [path.join(root, 'backend/dist/server.js')], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const child = server;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { child.kill(); reject(new Error('Backend startup timed out')); }, 15_000);
        let output = '';
        child.stdout!.on('data', chunk => { output += String(chunk); if (output.includes('server_started')) { clearTimeout(timer); resolve(); } });
        child.stderr!.on('data', chunk => { output += String(chunk); });
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', code => { clearTimeout(timer); reject(new Error(`Backend exited ${code}: ${output}`)); });
      });
      expect((await fetch(`${backendUrl}/api/v1/health`)).status).toBe(200);
    }
    try {
      await new Promise<void>((resolve, reject) => {
        const init = spawn(process.execPath, [path.join(root, 'backend/dist/db/init.js')], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        init.stderr!.on('data', chunk => { output += String(chunk); });
        init.once('error', reject); init.once('exit', code => code === 0 ? resolve() : reject(new Error(`db:init exited ${code}: ${output}`)));
      });
      await start();
      await use({ databasePath, restart: async () => { await stop(); await start(); } });
    } finally {
      await stop();
      // dir is a freshly created OS-temp fixture, never a user-configured path.
      const resolved = path.resolve(dir), tempRoot = path.resolve(os.tmpdir()) + path.sep;
      if (!resolved.startsWith(tempRoot) || !path.basename(resolved).startsWith('teamplan-s1-e2e-')) throw new Error('Unsafe cleanup path');
      await rm(resolved, { recursive: true, force: true });
    }
  }, { auto: true }],
});
export { expect };
