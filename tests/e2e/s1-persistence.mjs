#!/usr/bin/env node
/** Real S1 browser acceptance; owns its backend and temporary database. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../../', import.meta.url));
const temp = await mkdtemp(path.join(os.tmpdir(), 'teamplan-s1-pr-'));
const output = path.join(root, '.verification', 's1-evidence');
const probe = net.createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = probe.address().port;
await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, HOST: '127.0.0.1', PORT: String(port), NODE_ENV: 'production',
  DATABASE_PATH: path.join(temp, 's1.sqlite'), ALLOWED_HOSTS: '127.0.0.1,localhost,[::1]',
  ENABLE_PRIORITY: '0', ENABLE_FILTERS: '0', ENABLE_ORDERING: '0', ENABLE_SHARING: '0' };
let server;
let browser;
let page;

async function runInit() {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'backend/dist/db/init.js')],
      { cwd: root, env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let errors = '';
    child.stderr.on('data', chunk => { errors += String(chunk); });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`db:init failed (${code}): ${errors}`)));
  });
}
async function stop() {
  const child = server; server = undefined;
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Backend did not stop')), 10_000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.kill();
  });
}
async function start() {
  server = spawn(process.execPath, [path.join(root, 'backend/dist/server.js')],
    { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const child = server;
  await new Promise((resolve, reject) => {
    let text = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Backend startup timed out')); }, 15_000);
    child.stdout.on('data', chunk => { text += String(chunk); if (text.includes('server_started')) { clearTimeout(timer); resolve(); } });
    child.stderr.on('data', chunk => { text += String(chunk); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Backend exited (${code}): ${text}`)); });
  });
}
async function get(route) {
  const response = await fetch(`${base}/api/v1${route}`);
  assert.equal(response.status, 200, `GET ${route}`);
  return (await response.json()).data;
}

try {
  await mkdir(output, { recursive: true });
  await runInit(); await start();
  const members = await get('/members');
  assert.equal(members.length, 4);
  browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? 'msedge', headless: true });
  page = await browser.newPage({ viewport: { width: 1366, height: 1000 } });
  page.setDefaultTimeout(15_000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(base);
  const boardName = '成员 A · S1 持久化验收';
  await page.locator('#new-board-sidebar-name').fill(`  ${boardName}  `);
  await page.locator('#new-board-sidebar-name').press('Enter');
  await page.getByRole('heading', { level: 1, name: boardName, exact: true }).waitFor();
  const boards = await get('/boards');
  assert.equal(boards.length, 1);
  const boardId = boards[0].id;
  const description = '真实浏览器、真实 API、真实 SQLite。\n<script>window.__s1Injected = true</script>';
  for (const [index, status] of ['todo', 'doing', 'done'].entries()) {
    await page.getByRole('button', { name: '在待办列新建任务', exact: true }).click();
    const form = page.getByRole('dialog', { name: '新建任务', exact: true });
    await form.getByRole('textbox', { name: '标题 *', exact: true }).fill(`验收任务 ${index + 1}`);
    await form.getByLabel('描述', { exact: true }).fill(description);
    await form.getByLabel('负责人', { exact: true }).selectOption(members[index].id);
    await form.getByLabel('截止日期', { exact: true }).fill('2028-02-29');
    await form.getByLabel('状态', { exact: true }).selectOption(status);
    await form.getByRole('button', { name: '保存任务', exact: true }).click();
    await form.waitFor({ state: 'detached' });
  }
  await page.getByRole('button', { name: '在待办列新建任务', exact: true }).click();
  const form = page.getByRole('dialog', { name: '新建任务', exact: true });
  await form.getByRole('textbox', { name: '标题 *', exact: true }).fill('仅标题默认值');
  await form.getByRole('button', { name: '保存任务', exact: true }).click();
  await form.waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.querySelectorAll('.task-card').length === 4);
  const before = await get(`/boards/${boardId}/tasks`);
  assert.equal(before.length, 4);
  assert.deepEqual(before.map(task => task.status).sort(), ['doing', 'done', 'todo', 'todo']);
  const minimal = before.find(task => task.title === '仅标题默认值');
  assert.equal(minimal.description, ''); assert.equal(minimal.assigneeId, null); assert.equal(minimal.dueDate, null);
  await page.getByRole('button', { name: /验收任务 1，状态/ }).click();
  const detail = page.getByRole('dialog', { name: '任务详情', exact: true });
  await detail.waitFor();
  assert.ok((await detail.innerText()).includes('<script>window.__s1Injected = true</script>'));
  assert.equal(await page.evaluate(() => window.__s1Injected), undefined);
  await page.screenshot({ path: path.join(output, 'task-detail.png'), fullPage: true });
  await page.keyboard.press('Escape'); await detail.waitFor({ state: 'detached' });
  for (const width of [1366, 768, 360]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.locator('.board-column').count(), 3);
    if (width <= 1024) assert.equal(await page.locator('.scroll-hint').isVisible(), true);
    await page.screenshot({ path: path.join(output, `board-${width}.png`), fullPage: true });
  }
  await page.reload(); await page.waitForFunction(() => document.querySelectorAll('.task-card').length === 4);
  assert.deepEqual(await get(`/boards/${boardId}/tasks`), before);
  await stop(); await runInit(); await runInit(); await start();
  await page.goto(`${base}/boards/${boardId}`);
  await page.waitForFunction(() => document.querySelectorAll('.task-card').length === 4);
  assert.deepEqual(await get(`/boards/${boardId}/tasks`), before);
  assert.deepEqual(await get('/boards'), boards); assert.deepEqual(await get('/members'), members);
  assert.deepEqual(pageErrors, []);
  await writeFile(path.join(output, 'persistence.json'), JSON.stringify({
    date: new Date().toISOString(), browser: browser.version(), node: process.version,
    boardId, taskIds: before.map(task => task.id), count: 4, reload: 'passed',
    processRestart: 'passed', repeatedInitialization: 'passed', pureText: 'passed',
    screenshots: [1366, 768, 360], database: 'temporary SQLite fixture, cleaned after run',
  }, null, 2) + '\n');
  console.log('S1 real browser acceptance: passed (create, detail, reload, process restart, repeated init, plaintext, 3 widths)');
  console.log(`Browser: ${browser.version()}; evidence: .verification/s1-evidence`);
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
    console.error('Browser failure state:', await page.locator('body').innerText().catch(() => 'unavailable'));
  }
  throw error;
} finally {
  await browser?.close(); await stop();
  const relative = path.relative(os.tmpdir(), path.resolve(temp));
  if (relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(temp).startsWith('teamplan-s1-pr-')) throw new Error('Unsafe temporary database cleanup path');
  await rm(temp, { recursive: true, force: true });
}
