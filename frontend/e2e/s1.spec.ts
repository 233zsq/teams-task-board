import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

async function createBoard(page: Page, name = '课程作业') {
  await page.getByRole('button', { name: '新建看板', exact: true }).click();
  await page.getByLabel('看板名称').fill(name);
  await page.getByRole('button', { name: '创建看板', exact: true }).click();
  await expect(page.getByRole('heading', { name: name.trim(), exact: true })).toBeVisible();
}
async function createTask(page: Page, title: string, status = 'todo', full = false) {
  await page.getByRole('button', { name: '＋ 新建任务', exact: true }).click();
  await page.getByLabel('任务标题').fill(title);
  await page.getByLabel('初始状态').selectOption(status);
  if (full) {
    await page.getByLabel('任务描述').fill('验收目标：真实 API 与 SQLite 一致。\n<script>window.__injected = true</script>');
    await page.getByLabel('负责人', { exact: true }).selectOption({ label: '成员 A' });
    await page.getByLabel('截止日期').fill('2028-02-29');
  }
  await page.getByRole('button', { name: '创建任务', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator(`[data-status="${status}"]`).getByRole('heading', { name: title, exact: true })).toBeVisible();
}

test('CHECK-001/005/007/008/009/038/042: real create, reload, process restart and screenshots', async ({ page, request, service }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '创建你的第一个看板' })).toBeVisible();
  await createBoard(page, '  课程作业  ');
  const boardUrl = page.url(), boardId = boardUrl.split('/').pop();
  for (const label of ['待办', '进行中', '已完成']) await expect(page.getByRole('region', { name: label })).toBeVisible();
  await createTask(page, '完成成员 A 最小真实闭环', 'doing', true);
  await createTask(page, '准备成员 C 独立验收');
  await createTask(page, '完成需求与契约核对', 'done');
  await createTask(page, '长标题布局验证：' + '持续检查任务文字换行和操作入口可见性'.repeat(3));
  const snapshot = await (await request.get(`/api/v1/boards/${boardId}/tasks`)).json();
  expect(snapshot.data).toHaveLength(4);
  expect(snapshot.data.find((t: { title: string }) => t.title === '准备成员 C 独立验收')).toMatchObject({ status: 'todo', description: '', assigneeId: null, dueDate: null });
  await page.getByRole('button', { name: /进行中 完成成员 A 最小真实闭环/ }).click();
  await expect(page.getByRole('dialog')).toContainText('<script>window.__injected = true</script>');
  await expect(page.getByRole('dialog')).toContainText('2028-02-29');
  expect(await page.evaluate(() => (window as unknown as { __injected?: boolean }).__injected)).toBeUndefined();
  await page.screenshot({ path: testInfo.outputPath('task-detail.png'), fullPage: true });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  for (const width of [1366, 768, 360]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.getByRole('button', { name: '＋ 新建任务', exact: true })).toBeInViewport();
    if (width < 1150) await expect(page.getByText('共 3 列 · 左右滑动查看待办、进行中和已完成')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`board-${width}.png`), fullPage: true });
  }
  await page.reload(); await expect(page.locator('[data-task-id]')).toHaveCount(4);
  await service.restart();
  await page.goto(boardUrl); await expect(page.locator('[data-task-id]')).toHaveCount(4);
  expect(await (await request.get(`/api/v1/boards/${boardId}/tasks`)).json()).toEqual(snapshot);
  const members = await (await request.get('/api/v1/members')).json(); expect(members.data).toHaveLength(4);
  const evidence = JSON.stringify({ date: new Date().toISOString(), boardId, taskIds: snapshot.data.map((t: { id: string }) => t.id), count: 4, reload: 'passed', processRestart: 'passed', browser: page.context().browser()?.version(), backendPort: 3101, frontendPort: 5174, database: 'isolated OS-temp SQLite fixture, removed after test' }, null, 2);
  await writeFile(testInfo.outputPath('persistence.json'), evidence);
  await testInfo.attach('persistence-evidence', { body: evidence, contentType: 'application/json' });
  expect(errors).toEqual([]);
});

test('CHECK-001/002/008: boundary validation, duplicate-click locks and same-name boards', async ({ page, request }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建看板', exact: true }).click();
  await page.getByLabel('看板名称').fill('  ');
  await page.getByRole('button', { name: '创建看板', exact: true }).click();
  await expect(page.getByText('请输入看板名称')).toBeVisible();
  await page.getByLabel('看板名称').fill('x'.repeat(51));
  await page.getByRole('button', { name: '创建看板', exact: true }).click();
  await expect(page.getByText('看板名称最多 50 个字符')).toBeVisible();
  const boundary = '😀'.repeat(50);
  await page.getByLabel('看板名称').fill(boundary);
  // Dispatch two clicks in one browser task to exercise the handler guard as well as disabled UI.
  await page.getByRole('button', { name: '创建看板', exact: true }).evaluate(el => { (el as HTMLButtonElement).click(); (el as HTMLButtonElement).click(); });
  await expect(page.getByRole('heading', { name: boundary, exact: true })).toBeVisible();
  expect((await (await request.get('/api/v1/boards')).json()).data).toHaveLength(1);
  await createBoard(page, boundary);
  const boards = (await (await request.get('/api/v1/boards')).json()).data;
  expect(boards).toHaveLength(2); expect(boards[0].id).not.toBe(boards[1].id);
  await page.getByRole('button', { name: '＋ 新建任务', exact: true }).click();
  await page.getByLabel('任务标题').fill('只创建一次');
  await page.getByRole('button', { name: '创建任务', exact: true }).evaluate(el => { (el as HTMLButtonElement).click(); (el as HTMLButtonElement).click(); });
  await expect(page.locator('[data-task-id]')).toHaveCount(1);
  const id = page.url().split('/').pop();
  expect((await (await request.get(`/api/v1/boards/${id}/tasks`)).json()).data).toHaveLength(1);
});

test('explicit fault injection: preserve draft, retry reads, block unhealthy startup', async ({ page }) => {
  await page.route('**/api/v1/health', route => route.fulfill({ status: 503, json: { error: { code: 'SERVICE_UNAVAILABLE' } } }));
  await page.goto('/'); await expect(page.getByRole('heading', { name: '暂时无法进入工作区' })).toBeVisible();
  await page.unroute('**/api/v1/health'); await page.getByRole('button', { name: '重试连接' }).click();
  await createBoard(page);
  await page.route('**/api/v1/boards/*/tasks', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 422, json: { error: { code: 'VALIDATION_ERROR', fields: { title: '测试注入：标题校验失败' } } } }) : route.continue());
  await page.getByRole('button', { name: '＋ 新建任务', exact: true }).click();
  await page.getByLabel('任务标题').fill('失败后保留输入');
  await page.getByRole('button', { name: '创建任务', exact: true }).click();
  await expect(page.getByText('测试注入：标题校验失败')).toBeVisible();
  await expect(page.getByLabel('任务标题')).toHaveValue('失败后保留输入');
  await page.unroute('**/api/v1/boards/*/tasks');
  await page.getByRole('button', { name: '创建任务', exact: true }).click();
  await expect(page.locator('[data-task-id]')).toHaveCount(1);
  await page.route('**/api/v1/boards/*/tasks', route => route.fulfill({ status: 503, json: { error: { code: 'SERVICE_UNAVAILABLE' } } }));
  await page.getByRole('button', { name: '刷新看板' }).click();
  await expect(page.getByRole('alert')).toContainText('可能已过期');
  await expect(page.locator('[data-task-id]')).toHaveCount(1);
  await page.unroute('**/api/v1/boards/*/tasks');
  await page.getByRole('button', { name: '重试读取' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('committed create with lost response is not replayed; user verifies before retry', async ({ page, request }) => {
  await page.goto('/'); await createBoard(page);
  const id = page.url().split('/').pop();
  let posts = 0;
  await page.route('**/api/v1/boards/*/tasks', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    posts++;
    const response = await route.fetch(); expect(response.status()).toBe(201);
    await route.abort('connectionfailed');
  });
  await page.getByRole('button', { name: '＋ 新建任务', exact: true }).click();
  await page.getByLabel('任务标题').fill('服务端已保存但响应丢失');
  await page.getByRole('button', { name: '创建任务', exact: true }).click();
  await expect(page.getByText('创建结果尚不确定。', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: '创建任务', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '刷新查证' }).click();
  await expect(page.getByRole('alert')).toContainText('已有 1 条同名记录');
  expect(posts).toBe(1);
  expect((await (await request.get(`/api/v1/boards/${id}/tasks`)).json()).data).toHaveLength(1);
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByLabel('任务标题')).toHaveValue('服务端已保存但响应丢失');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('[data-task-id]')).toHaveCount(1);
});
