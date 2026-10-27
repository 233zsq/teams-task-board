#!/usr/bin/env node
// Built production server + disposable SQLite + real browsers. Fault fixtures
// intercept HTTP only in the test context; successful writes use the real API.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserConfig, launchBrowser } from './browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempRoot = fs.realpathSync(os.tmpdir());
const temp = fs.mkdtempSync(path.join(tempRoot, 'team-plan-release-'));
const output = path.resolve(process.env.E2E_OUTPUT_DIR ?? path.join(root, '.artifacts/release-check'));
fs.mkdirSync(output, { recursive: true });
const results = [];
let server;
let base;
let serverLog = '';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function check(name, action) {
  await action();
  results.push({ name, status: 'passed' });
  console.log(`PASS ${name}`);
}

function run(entry, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry], { cwd: root, env, windowsHide: true, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${path.basename(entry)} exited ${code}`)));
  });
}

async function api(method, route, body) {
  const response = await fetch(`${base}/api/v1${route}`, {
    method,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  assert(response.ok, `${method} ${route}: ${response.status}`);
  return response.status === 204 ? null : (await response.json()).data;
}

async function ready(page, board) {
  await page.goto(`${base}/boards/${board.id}`);
  await page.getByRole('heading', { level: 1, name: board.name, exact: true }).waitFor();
  await page.locator('.board-columns').waitFor();
}

async function newTask(page, title) {
  await page.getByRole('button', { name: '在待办列新建任务', exact: true }).click();
  const form = page.getByRole('dialog', { name: '新建任务', exact: true });
  await form.getByLabel('标题 *', { exact: true }).fill(title);
  return form;
}

async function crud(page, browserLabel, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(base);
  await page.waitForURL('**/boards/*');
  await page.locator('.board-columns').waitFor();
  const name = `${browserLabel}-${width}`;
  await page.locator('#new-board-sidebar-name').fill(name);
  await page.locator('.sidebar-create').getByRole('button', { name: '新建看板', exact: true }).click();
  await page.getByRole('heading', { level: 1, name, exact: true }).waitFor();
  const board = (await api('GET', '/boards')).find((item) => item.name === name);
  assert(board);
  const title = `标题-${width}-` + '长文本'.repeat(20);
  const form = await newTask(page, title);
  await form.getByLabel('描述', { exact: true }).fill('长描述\n'.repeat(100));
  await form.getByLabel('截止日期', { exact: true }).fill('2026-01-01');
  await form.getByRole('button', { name: '保存任务', exact: true }).click();
  await form.waitFor({ state: 'detached' });
  const card = page.locator('.task-card').filter({ hasText: title });
  await card.waitFor();
  assert.match(await card.getAttribute('aria-label'), /已逾期/);
  assert.equal(await page.locator('.board-column').count(), 3);
  assert.equal(await page.locator('.scroll-hint').isVisible(), width <= 1024);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'page must not overflow horizontally');
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, `${browserLabel}-${width}.png`), fullPage: true });
  await card.click();
  const detail = page.getByRole('dialog', { name: '任务详情', exact: true });
  await detail.getByRole('button', { name: '编辑', exact: true }).click();
  const edit = page.getByRole('dialog', { name: '编辑任务', exact: true });
  await edit.getByLabel('标题 *', { exact: true }).fill(`编辑-${width}`);
  await edit.getByRole('button', { name: '保存任务', exact: true }).click();
  await edit.waitFor({ state: 'detached' });
  await page.locator('.task-card').filter({ hasText: `编辑-${width}` }).click();
  await detail.getByRole('button', { name: '已完成', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.task-card')?.getAttribute('aria-label')?.includes('状态 已完成'));
  assert.doesNotMatch(await page.locator('.task-card').getAttribute('aria-label'), /已逾期/);
  await detail.getByRole('button', { name: '删除', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: '删除任务', exact: true });
  await confirm.getByRole('button', { name: '删除任务', exact: true }).click();
  await confirm.waitFor({ state: 'detached' });
  assert.equal((await api('GET', `/boards/${board.id}/tasks`)).length, 0);
}

async function keyboard(page, board) {
  await page.setViewportSize({ width: 1366, height: 900 });
  await ready(page, board);
  // Starting focus is deterministic; subsequent navigation is keyboard only.
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  for (let index = 0; index < 80; index++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === '在待办列新建任务')) break;
  }
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '在待办列新建任务');
  await page.keyboard.press('Enter');
  const form = page.getByRole('dialog', { name: '新建任务', exact: true });
  await form.waitFor();
  await page.waitForFunction(() => document.activeElement?.id === 'task-title');
  await page.keyboard.type('Keyboard task');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '关闭');
  await page.keyboard.press('Shift+Tab');
  assert.equal((await page.evaluate(() => document.activeElement?.textContent))?.trim(), '保存任务');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '关闭');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await form.waitFor({ state: 'detached' });
  const card = page.locator('.task-card').filter({ hasText: 'Keyboard task' });
  await card.waitFor();
  await card.focus();
  await page.keyboard.press('Enter');
  const detail = page.getByRole('dialog', { name: '任务详情', exact: true });
  await detail.waitFor();
  await page.keyboard.press('Escape');
  await detail.waitFor({ state: 'detached' });
  assert.match(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? ''), /Keyboard task/);
  await page.keyboard.press('Enter');
  await detail.waitFor();
  for (let index = 0; index < 15; index++) {
    if ((await page.evaluate(() => document.activeElement?.textContent))?.trim() === '删除') break;
    await page.keyboard.press('Tab');
  }
  assert.equal((await page.evaluate(() => document.activeElement?.textContent))?.trim(), '删除');
  await page.keyboard.press('Enter');
  const confirm = page.getByRole('dialog', { name: '删除任务', exact: true });
  await confirm.waitFor();
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === '取消');
  await page.keyboard.press('Enter');
  await confirm.waitFor({ state: 'detached' });
  assert.equal((await api('GET', `/boards/${board.id}/tasks`)).length, 1);
  await page.keyboard.press('Escape');
}

async function faults(page, board) {
  for (const status of [422, 500, 503, 'timeout', 'lost-response']) {
    await ready(page, board);
    const title = `故障-${status}`;
    const form = await newTask(page, title);
    let requests = 0;
    const pattern = `**/api/v1/boards/${board.id}/tasks`;
    const handler = async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      requests++;
      if (status === 'lost-response') {
        const response = await route.fetch();
        assert.equal(response.status(), 201);
        await route.abort('failed');
      } else if (status === 'timeout') {
        await pause(10_500);
        await route.abort('timedout').catch(() => {});
      } else {
        await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: {
          code: status === 422 ? 'VALIDATION_ERROR' : status === 503 ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_ERROR',
          message: 'test fixture', ...(status === 422 ? { fields: { title: '测试字段错误' } } : {}),
        } }) });
      }
    };
    await page.route(pattern, handler);
    await form.getByRole('button', { name: '保存任务', exact: true }).click();
    const errorText = status === 422 ? '测试字段错误' : status === 500 ? '服务器内部错误' : status === 503 ? '服务暂不可用' : status === 'timeout' ? '请求超时，结果未知' : '无法连接服务';
    await form.getByText(errorText, { exact: false }).waitFor({ timeout: 15_000 });
    assert.equal(await form.getByLabel('标题 *', { exact: true }).inputValue(), title);
    assert.equal(await form.getByRole('button', { name: '保存任务', exact: true }).isEnabled(), true);
    await pause(status === 'timeout' ? 700 : 300);
    assert.equal(requests, 1, 'failed write must not replay automatically');
    await page.unroute(pattern, handler);
    const tasks = await api('GET', `/boards/${board.id}/tasks`);
    assert.equal(tasks.filter((task) => task.title === title).length, status === 'lost-response' ? 1 : 0);
    if (status === 'lost-response') {
      await form.getByRole('button', { name: '取消', exact: true }).click();
      await page.getByRole('alertdialog', { name: '确认丢弃修改' }).getByRole('button', { name: '丢弃修改', exact: true }).click();
      await page.getByRole('button', { name: '刷新看板', exact: true }).click();
      await page.locator('.task-card').filter({ hasText: title }).waitFor();
    } else {
      await form.getByRole('button', { name: '保存任务', exact: true }).click();
      await form.waitFor({ state: 'detached' });
      assert.equal((await api('GET', `/boards/${board.id}/tasks`)).filter((task) => task.title === title).length, 1);
    }
    console.log(`  verified HTTP fixture ${status}: input retained, no replay, recovery checked`);
  }
}

async function race(page, label) {
  const a = await api('POST', '/boards', { name: `${label} 慢响应 A` });
  const b = await api('POST', '/boards', { name: `${label} 目标 B` });
  await api('POST', `/boards/${a.id}/tasks`, { title: '仅属于 A' });
  await api('POST', `/boards/${b.id}/tasks`, { title: '仅属于 B' });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let entered;
  const intercepted = new Promise((resolve) => { entered = resolve; });
  const pattern = `**/api/v1/boards/${a.id}/tasks`;
  const handler = async (route) => {
    const response = await route.fetch();
    entered();
    await gate;
    await route.fulfill({ response }).catch(() => {}); // switching aborts the old fetch
  };
  await page.route(pattern, handler, { times: 1 });
  await page.goto(`${base}/boards/${a.id}`);
  await intercepted;
  await page.locator('.board-nav-item').filter({ hasText: b.name }).click();
  await page.locator('.task-card').filter({ hasText: '仅属于 B' }).waitFor();
  release();
  await pause(300);
  assert.equal(await page.locator('.task-card').filter({ hasText: '仅属于 A' }).count(), 0);
  await page.unroute(pattern, handler);
  await page.locator('.board-nav-item').filter({ hasText: a.name }).click();
  await page.locator('.task-card').filter({ hasText: '仅属于 A' }).waitFor();
}

async function main() {
  const configs = ['A', 'B'].map((label) => browserConfig(process.env, label));
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, DATABASE_PATH: path.join(temp, 'release.sqlite'), NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), ALLOWED_HOSTS: '127.0.0.1,localhost', ENABLE_PRIORITY: '0', ENABLE_FILTERS: '0', ENABLE_ORDERING: '0', ENABLE_SHARING: '0' };
  await run('backend/dist/db/init.js', env);
  server = spawn(process.execPath, ['backend/dist/server.js'], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [server.stdout, server.stderr]) stream.on('data', (chunk) => { serverLog = (serverLog + chunk).slice(-8000); });
  let healthy = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    try { if ((await fetch(`${base}/api/v1/health`)).ok) { healthy = true; break; } } catch {}
    if (server.exitCode !== null) break;
    await pause(100);
  }
  assert(healthy, 'isolated backend did not become healthy');
  await check('跨浏览器协同、覆盖与删除（现有双浏览器 E2E）', () => run('tests/e2e/dual-browser.mjs', { ...process.env, BASE_URL: base }));
  for (const [index, config] of configs.entries()) {
    const launched = await launchBrowser(index === 0 ? 'A' : 'B', config);
    console.log(`Browser: ${launched.engine}`);
    try {
      const context = await launched.browser.newContext({ viewport: { width: 1366, height: 900 } });
      const page = await context.newPage();
      page.setDefaultTimeout(12_000);
      const pageErrors = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      for (const width of [1366, 768, 360]) await check(`${config.channel} ${width}px 完整建板/任务/编辑/状态/删除`, () => crud(page, config.channel, width));
      const board = await api('POST', '/boards', { name: `Keyboard-${config.channel}` });
      await check(`${config.channel} 键盘提交/Tab 环绕/Escape 焦点恢复/回车取消删除`, () => keyboard(page, board));
      await check(`${config.channel} 422/500/503/10s 超时/已落库响应丢失`, () => faults(page, board));
      await check(`${config.channel} 真实 HTTP 慢响应切板隔离`, () => race(page, config.channel));
      assert.deepEqual(pageErrors, [], 'unexpected browser runtime errors');
      results.push({ browser: config.channel, version: launched.browser.version(), status: 'passed' });
    } finally { await launched.browser.close(); }
  }
}

try {
  await main();
} catch (error) {
  console.error(error.stack ?? error);
  results.push({ status: 'failed', message: error.message });
  if (server?.exitCode !== null) console.error(serverLog);
  process.exitCode = 1;
} finally {
  if (server && server.exitCode === null) { const stopped = once(server, 'exit'); server.kill(); await stopped; }
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ date: new Date().toISOString(), results }, null, 2) + '\n');
  const resolved = path.resolve(temp);
  if (path.dirname(resolved) === tempRoot && path.basename(resolved).startsWith('team-plan-release-')) fs.rmSync(resolved, { recursive: true, force: true });
}
