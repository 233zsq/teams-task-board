#!/usr/bin/env node
// Real registration UI, two browser brands, two identities, a temporary DB.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserConfig, launchBrowser } from './browser.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'teamplan-accounts-'));
const output = path.resolve(process.env.E2E_OUTPUT_DIR ?? path.join(root, '.artifacts/accounts-check'));
fs.mkdirSync(output, { recursive: true });
const probe = net.createServer();
probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), ALLOWED_HOSTS: '127.0.0.1,localhost',
  DATABASE_PATH: path.join(temp, 'test.sqlite'), ENABLE_PRIORITY: '0', ENABLE_FILTERS: '0', ENABLE_ORDERING: '0', ENABLE_SHARING: '0' };
const results = [], errors = [], launched = [];
let server, pageA, pageB, boardId;
const password = `Test-${randomBytes(16).toString('hex')}`, newPassword = `Changed-${randomBytes(16).toString('hex')}`;
async function check(name, run) { await run(); results.push({ name, status: 'passed' }); console.log(`PASS ${name}`); }
async function api(page, method, route, body) {
  return page.evaluate(async ({ method, route, body }) => {
    const session = (await (await fetch('/api/v1/auth/me')).json()).data;
    const response = await fetch(`/api/v1${route}`, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken ?? '' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  }, { method, route, body });
}
async function register(page, username, displayName) {
  await page.goto(base); await page.getByRole('button', { name: '注册账号', exact: true }).click();
  await page.getByLabel('用户名', { exact: true }).fill(username); await page.getByLabel('昵称', { exact: true }).fill(displayName);
  await page.getByLabel('密码', { exact: true }).fill(password); await page.getByLabel('确认密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '注册并开始协作 →', exact: true }).click();
  await page.getByRole('button', { name: displayName, exact: true }).waitFor(); await page.locator('#new-board-sidebar-name').waitFor();
}
async function refresh(page) {
  await page.getByRole('button', { name: '刷新看板', exact: true }).click();
  await page.locator('.refresh-note').filter({ hasText: '最后刷新' }).waitFor();
}
async function task(page, title, assignee, status = 'todo', dueDate = '') {
  await page.getByRole('button', { name: '在待办列新建任务', exact: true }).click();
  const form = page.getByRole('dialog', { name: '新建任务', exact: true });
  await form.getByLabel('标题 *', { exact: true }).fill(title);
  if (assignee) await form.getByLabel('负责人', { exact: true }).selectOption({ label: assignee });
  await form.getByLabel('状态', { exact: true }).selectOption(status);
  if (dueDate) await form.getByLabel('截止日期', { exact: true }).fill(dueDate);
  await form.getByRole('button', { name: '保存任务', exact: true }).click(); await form.waitFor({ state: 'detached' });
}
async function members(page) {
  await page.getByRole('button', { name: /^项目成员 ·/ }).click();
  const dialog = page.getByRole('dialog', { name: '项目成员', exact: true });
  await dialog.locator('.project-member-list li').first().waitFor(); return dialog;
}
try {
  const init = spawn(process.execPath, [path.join(root, 'backend/dist/db/init.js')], { cwd: root, env, windowsHide: true, stdio: 'ignore' });
  assert.equal((await once(init, 'exit'))[0], 0);
  server = spawn(process.execPath, [path.join(root, 'backend/dist/server.js')], { cwd: root, env, windowsHide: true, stdio: 'ignore' });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${base}/api/v1/health`)).ok) break; } catch {}
    if (i === 79) throw new Error('Backend startup timeout'); await new Promise(resolve => setTimeout(resolve, 100));
  }
  for (const label of ['A', 'B']) launched.push(await launchBrowser(label, browserConfig(process.env, label)));
  pageA = await (await launched[0].browser.newContext({ viewport: { width: 1366, height: 1000 } })).newPage();
  pageB = await (await launched[1].browser.newContext({ viewport: { width: 1366, height: 1000 } })).newPage();
  for (const page of [pageA, pageB]) { page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message)); }
  await check('login desktop/mobile and anonymous API protection', async () => {
    assert.equal((await fetch(`${base}/api/v1/boards`)).status, 401); await pageA.goto(base);
    await pageA.getByRole('heading', { name: '欢迎回来', exact: true }).waitFor();
    for (const width of [1366, 360]) { await pageA.setViewportSize({ width, height: 1000 }); assert(await pageA.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await pageA.screenshot({ path: path.join(output, `login-${width}.png`), fullPage: true }); }
    await pageA.setViewportSize({ width: 1366, height: 1000 });
  });
  await check('two real UI registrations and automatic project ownership', async () => {
    await register(pageA, 'project_owner', '林同学'); await register(pageB, 'project_member', '周同学');
    await pageA.locator('#new-board-sidebar-name').fill('课程项目 · 协作空间');
    await pageA.locator('.sidebar-create').getByRole('button', { name: '新建看板', exact: true }).click();
    await pageA.waitForURL('**/boards/*'); await pageA.getByRole('heading', { name: '课程项目 · 协作空间', exact: true }).waitFor();
    boardId = new URL(pageA.url()).pathname.split('/').pop();
    assert.equal(await pageA.locator('.project-owner strong').innerText(), '林同学'); assert.equal((await api(pageB, 'GET', `/boards/${boardId}`)).status, 404);
  });
  await check('owner adds a partner; ordinary member cannot manage membership', async () => {
    const dialog = await members(pageA); await dialog.getByLabel('成员用户名', { exact: true }).fill('project_member');
    await dialog.getByRole('button', { name: '添加到项目', exact: true }).click(); await dialog.getByText('项目成员已更新', { exact: true }).waitFor();
    assert.equal(await dialog.locator('.project-member-list li').count(), 2); await pageA.keyboard.press('Escape');
    await pageB.goto(`${base}/boards/${boardId}`); await pageB.locator('.board-columns').waitFor();
    const other = await members(pageB); assert.equal(await other.getByRole('button', { name: '添加到项目', exact: true }).count(), 0); await pageB.keyboard.press('Escape');
    assert.equal((await api(pageB, 'POST', `/boards/${boardId}/members`, { username: 'project_owner' })).status, 403);
  });
  await check('publisher/assignee, project progress and personal views', async () => {
    await task(pageA, '搭建业务接口', '周同学', 'todo', '2020-01-01'); await task(pageA, '编写项目说明', '林同学', 'done'); await task(pageA, '准备答辩材料');
    await refresh(pageB); await task(pageB, '补充联调反馈', '周同学', 'doing'); await refresh(pageA);
    assert.equal(await pageA.locator('.task-card').count(), 4); assert((await pageA.locator('.project-summary').innerText()).includes('25%'));
    for (const [page, assigned, published] of [[pageA, 1, 3], [pageB, 2, 1]]) {
      await page.getByRole('button', { name: '我负责的', exact: true }).click(); assert.equal(await page.locator('.task-card').count(), assigned);
      await page.getByRole('button', { name: '我发布的', exact: true }).click(); assert.equal(await page.locator('.task-card').count(), published);
      await page.getByRole('button', { name: '全部任务', exact: true }).click();
    }
    await pageA.locator('.task-card').filter({ hasText: '搭建业务接口' }).click(); const detail = pageA.getByRole('dialog', { name: '任务详情', exact: true });
    assert.equal(await detail.locator('dl > div').filter({ hasText: '发布者' }).locator('dd').innerText(), '林同学');
    assert.equal(await detail.locator('dl > div').filter({ hasText: /^负责人/ }).locator('dd').innerText(), '周同学');
    await pageA.screenshot({ path: path.join(output, 'task-detail.png'), fullPage: true }); await pageA.keyboard.press('Escape');
  });
  await check('1366/768/360 project layout without page overflow', async () => {
    for (const width of [1366, 768, 360]) { await pageA.setViewportSize({ width, height: 1000 }); assert(await pageA.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); assert.equal(await pageA.locator('.board-column').count(), 3); await pageA.screenshot({ path: path.join(output, `project-${width}.png`), fullPage: true }); }
    await pageA.setViewportSize({ width: 1366, height: 1000 });
  });
  await check('activity from both identities and live nickname labels', async () => {
    await pageA.getByRole('button', { name: '最近动态', exact: true }).click(); const activity = pageA.getByRole('dialog', { name: '最近动态', exact: true });
    await activity.locator('.activity-list li').first().waitFor(); const text = await activity.innerText(); assert(text.includes('林同学') && text.includes('周同学') && text.includes('发布了任务'));
    await pageA.screenshot({ path: path.join(output, 'activity.png'), fullPage: true }); await pageA.keyboard.press('Escape');
    await pageA.getByRole('button', { name: '账号设置', exact: true }).click(); const settings = pageA.getByRole('dialog', { name: '账号设置', exact: true });
    await settings.getByLabel('昵称', { exact: true }).fill('林同学 · 组长'); await settings.getByRole('button', { name: '保存昵称', exact: true }).click();
    await settings.getByText('昵称已更新', { exact: true }).waitFor(); await pageA.keyboard.press('Escape');
    await pageA.locator('.project-owner strong').filter({ hasText: '林同学 · 组长' }).waitFor();
    assert.equal((await api(pageA, 'GET', `/boards/${boardId}/tasks`)).body.data[0].createdBy.displayName, '林同学 · 组长');
  });
  await check('password update, logout, invalid old password, new login and reload', async () => {
    await pageA.getByRole('button', { name: '账号设置', exact: true }).click(); const settings = pageA.getByRole('dialog', { name: '账号设置', exact: true });
    await settings.getByLabel('当前密码', { exact: true }).fill(password); await settings.getByLabel('新密码', { exact: true }).fill(newPassword); await settings.getByLabel('确认新密码', { exact: true }).fill(newPassword);
    await settings.getByRole('button', { name: '更新密码', exact: true }).click(); await settings.getByText('密码已更新，其他登录会话已退出', { exact: true }).waitFor(); await pageA.keyboard.press('Escape');
    await pageA.getByRole('button', { name: '退出登录', exact: true }).click(); await pageA.getByLabel('用户名', { exact: true }).fill('project_owner'); await pageA.getByLabel('密码', { exact: true }).fill(password);
    await pageA.getByRole('button', { name: '登录工作空间 →', exact: true }).click(); await pageA.getByRole('alert').filter({ hasText: '用户名或密码不正确' }).waitFor();
    await pageA.getByLabel('密码', { exact: true }).fill(newPassword); await pageA.getByRole('button', { name: '登录工作空间 →', exact: true }).click(); await pageA.locator('.board-columns').waitFor();
    await pageA.reload(); await pageA.locator('.board-columns').waitFor();
  });
  await check('owner transfer, member removal, revoked access and cleared assignee', async () => {
    const dialog = await members(pageA); pageA.once('dialog', dialog => dialog.accept());
    await dialog.locator('li').filter({ hasText: '周同学' }).getByRole('button', { name: '转交负责人', exact: true }).click(); await dialog.getByText('项目成员已更新', { exact: true }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: '添加到项目', exact: true }).count(), 0); await pageA.keyboard.press('Escape'); await refresh(pageB);
    const other = await members(pageB); pageB.once('dialog', dialog => dialog.accept());
    await other.locator('li').filter({ hasText: '林同学 · 组长' }).getByRole('button', { name: '移除', exact: true }).click(); await other.getByText('项目成员已更新', { exact: true }).waitFor(); await pageB.keyboard.press('Escape');
    assert.equal((await api(pageA, 'GET', `/boards/${boardId}/tasks`)).status, 404);
    assert.equal((await api(pageB, 'GET', `/boards/${boardId}/tasks`)).body.data.find(task => task.title === '编写项目说明').assigneeId, null);
    await pageB.reload(); await pageB.locator('.board-columns').waitFor(); assert.equal(await pageB.locator('.project-owner strong').innerText(), '周同学');
  });
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ date: new Date().toISOString(), node: process.version, browsers: launched.map(({ engine }) => engine), results, runtimeErrors: errors, database: 'temporary, cleaned' }, null, 2) + '\n');
  console.log(`Accounts/projects browser acceptance: ${results.length}/${results.length}; ${output}`);
} catch (error) {
  for (const [index, page] of [pageA, pageB].entries()) if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(output, `failure-${index}.png`), fullPage: true }).catch(() => {});
    console.error(`Page ${index}:`, await page.locator('body').innerText().catch(() => 'unavailable'));
  }
  throw error;
} finally {
  for (const { browser } of launched) await browser.close();
  if (server && server.exitCode === null) { server.kill(); await once(server, 'exit'); }
  const relative = path.relative(os.tmpdir(), temp);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(temp).startsWith('teamplan-accounts-')) throw new Error('Unsafe cleanup path');
  fs.rmSync(temp, { recursive: true, force: true });
}
