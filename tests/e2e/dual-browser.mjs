#!/usr/bin/env node
/**
 * TASK-017 dual-browser end-to-end regression.
 *
 * Drives two independent browser instances (Microsoft Edge by default) against
 * one running backend (same database) and verifies the multi-session behaviour
 * from the spec: manual refresh propagation, full-PUT overwrite with the
 * overwrite prompt, external deletion (no PUT resurrect), responsive column
 * layout and keyboard basics. It never asserts realtime sync or conflict
 * merging.
 *
 * Usage:
 *   1. start the backend (optionally with the demo database)
 *   2. npm run test:e2e            (BASE_URL=http://127.0.0.1:3000 by default)
 *      E2E_BROWSER=chrome npm run test:e2e   (record a Chrome pass instead)
 *      E2E_BROWSER_A=chrome E2E_BROWSER_B=msedge npm run test:e2e
 *   E2E_EXECUTABLE_A/B optionally selects an explicit portable executable.
 *   A requested browser that cannot start fails; no substitute is launched.
 */
import { browserConfig, launchBrowser } from './browser.mjs';

const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const BOARD_NAME = `E2E 双浏览器验证 ${new Date().toISOString().slice(11, 19)}`;
const TASK_TITLE = 'E2E 任务';
const results = [];
let failures = 0;

function check(name, condition, detail = '') {
  const ok = Boolean(condition);
  results.push({ name, ok, detail });
  if (!ok) {
    failures += 1;
  }
}

async function api(method, path, body) {
  const response = await fetch(`${BASE_URL}/api/v1${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, body: text === '' ? null : JSON.parse(text) };
}

async function openBoard(page, boardId) {
  await page.goto(`${BASE_URL}/boards/${boardId}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.board-columns').waitFor({ state: 'visible' });
}

async function createTask(page, { title, description = '', dueDate = '' }) {
  await page.getByRole('button', { name: '在待办列新建任务' }).click();
  const form = page.getByRole('dialog', { name: '新建任务' });
  await form.getByRole('textbox', { name: '标题 *' }).fill(title);
  if (description !== '') {
    await form.getByRole('textbox', { name: '描述' }).fill(description);
  }
  if (dueDate !== '') {
    await form.getByLabel('截止日期', { exact: true }).fill(dueDate);
  }
  await form.getByRole('button', { name: '保存任务' }).click();
  await form.waitFor({ state: 'detached' });
}

async function main() {
  const health = await api('GET', '/health');
  if (health.status !== 200) {
    throw new Error(`后端未运行或健康检查失败（${BASE_URL}），请先启动后端`);
  }

  const configs = ['A', 'B'].map((label) => browserConfig(process.env, label));
  const browsers = [];
  try {
    const a = await launchBrowser('A', configs[0]);
    browsers.push(a.browser);
    const b = await launchBrowser('B', configs[1]);
    browsers.push(b.browser);
    const contextA = await a.browser.newContext({ viewport: { width: 1366, height: 900 } });
    const contextB = await b.browser.newContext({ viewport: { width: 1366, height: 900 } });
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    // --- 1. Board creation is isolated to browser A ---
    await pageA.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await pageA.locator('#new-board-sidebar-name').waitFor({ state: 'visible' });
    await pageA.locator('#new-board-sidebar-name').fill(BOARD_NAME);
    await pageA.locator('.sidebar-create').getByRole('button', { name: '新建看板', exact: true }).click();
    await pageA.getByRole('heading', { level: 1, name: BOARD_NAME }).waitFor({ state: 'visible' });

    const boards = await api('GET', '/boards');
    const board = boards.body.data.find((item) => item.name === BOARD_NAME);
    check('新建看板后自动选中并写入服务端', board !== undefined);

    // --- 2. Manual refresh propagation (CHECK-025) ---
    await openBoard(pageB, board.id);
    const bEmptyBefore = (await pageB.locator('.board-column').allTextContents()).join(' ');
    check('浏览器 B 打开看板时任务为空（快照隔离）', bEmptyBefore.includes('暂无任务'));

    await createTask(pageA, { title: TASK_TITLE, description: '双浏览器刷新验证' });
    await pageA.getByText('双浏览器刷新验证').first().waitFor({ state: 'visible' });

    const bBeforeRefresh = (await pageB.locator('.board-column').allTextContents()).join(' ');
    check('A 保存后 B 不会自动实时更新', bBeforeRefresh.includes(TASK_TITLE) === false);

    const refreshNoteBefore = await pageB.locator('.refresh-note').innerText();
    // The label shows seconds; wait past a second boundary so the change is visible.
    await pageB.waitForTimeout(1100);
    await pageB.getByRole('button', { name: '刷新看板' }).click();
    await pageB.getByText(TASK_TITLE).first().waitFor({ state: 'visible' });
    const refreshNoteAfter = await pageB.locator('.refresh-note').innerText();
    check('B 点击刷新后读到已提交数据', true);
    check('刷新后最后刷新时间更新', refreshNoteBefore !== refreshNoteAfter, `${refreshNoteBefore} → ${refreshNoteAfter}`);
    check('刷新失败标记未出现（成功刷新）', refreshNoteAfter.includes('可能已过期') === false);

    // --- 3. Full-PUT overwrite and the overwrite prompt (CHECK-026) ---
    const tasks = await api('GET', `/boards/${board.id}/tasks`);
    const taskId = tasks.body.data[0].id;

    await pageB.getByRole('button', { name: new RegExp(TASK_TITLE) }).first().click();
    await pageB.getByRole('dialog', { name: '任务详情' }).getByRole('button', { name: '编辑' }).click();
    const formB = pageB.getByRole('dialog', { name: '编辑任务' });
    await formB.waitFor({ state: 'visible' });
    await formB.getByRole('textbox', { name: '描述' }).fill('描述被 B 修改');

    // A edits the title and saves while B keeps its stale form open.
    await pageA.getByRole('button', { name: new RegExp(TASK_TITLE) }).first().click();
    await pageA.getByRole('dialog', { name: '任务详情' }).getByRole('button', { name: '编辑' }).click();
    const formA = pageA.getByRole('dialog', { name: '编辑任务' });
    await formA.waitFor({ state: 'visible' });
    await formA.getByRole('textbox', { name: '标题 *' }).fill('标题被 A 修改');
    await formA.getByRole('button', { name: '保存任务' }).click();
    await formA.waitFor({ state: 'detached' });
    const afterA = await api('GET', `/boards/${board.id}/tasks/${taskId}`);
    check('A 的编辑已提交（标题为 A 的值）', afterA.body.data.title === '标题被 A 修改');

    await formB.getByRole('button', { name: '保存任务' }).click();
    const prompt = pageB.getByLabel('覆盖确认');
    await prompt.waitFor({ state: 'visible' });
    check('B 保存前出现“可能覆盖他人修改”提示', true);

    await prompt.getByRole('button', { name: '取消' }).click();
    await prompt.waitFor({ state: 'detached' });
    const afterCancel = await api('GET', `/boards/${board.id}/tasks/${taskId}`);
    check('取消覆盖后数据库不变', afterCancel.body.data.title === '标题被 A 修改');

    await formB.getByRole('button', { name: '保存任务' }).click();
    await pageB.getByLabel('覆盖确认').getByRole('button', { name: '仍然保存' }).click();
    await formB.waitFor({ state: 'detached' });
    const afterOverwrite = await api('GET', `/boards/${board.id}/tasks/${taskId}`);
    check(
      '最终五字段等于 B 的完整 PUT（A 的标题被旧值覆盖，描述为 B 的值）',
      afterOverwrite.body.data.title === TASK_TITLE &&
        afterOverwrite.body.data.description === '描述被 B 修改',
      JSON.stringify(afterOverwrite.body.data),
    );

    // --- 4. External delete: no resurrection, clear notice (CHECK-027) ---
    await pageB.getByRole('button', { name: new RegExp(TASK_TITLE) }).first().click();
    await pageB.getByRole('dialog', { name: '任务详情' }).getByRole('button', { name: '编辑' }).click();
    const staleForm = pageB.getByRole('dialog', { name: '编辑任务' });
    await staleForm.waitFor({ state: 'visible' });

    // A refreshes to pick up B's full-PUT result, then deletes the task.
    await pageA.getByRole('button', { name: '刷新看板' }).click();
    await pageA.getByRole('button', { name: new RegExp(TASK_TITLE) }).first().waitFor({ state: 'visible' });
    await pageA.getByRole('button', { name: new RegExp(TASK_TITLE) }).first().click();
    await pageA.getByRole('dialog', { name: '任务详情' }).getByRole('button', { name: '删除' }).click();
    const confirmDialog = pageA.getByRole('dialog', { name: '删除任务' });
    const focusedText = await pageA.evaluate(() => document.activeElement?.textContent ?? '');
    check('删除确认默认焦点在“取消”', focusedText.includes('取消'), focusedText);
    await confirmDialog.getByRole('button', { name: '删除任务' }).click();
    await confirmDialog.waitFor({ state: 'detached' });
    const deleted = await api('GET', `/boards/${board.id}/tasks/${taskId}`);
    check('删除后服务端返回 404', deleted.status === 404);

    await staleForm.getByRole('textbox', { name: '标题 *' }).fill('删除后尝试保存');
    await staleForm.getByRole('button', { name: '保存任务' }).click();
    await pageB.getByText('该任务已不存在').waitFor({ state: 'visible' });
    check('用旧表单保存返回已不存在提示，而不是静默重建任务', true);
    const stillDeleted = await api('GET', `/boards/${board.id}/tasks`);
    check('任务没有被 PUT 重建', stillDeleted.body.data.length === 0);

    // --- 5. Responsive columns and scroll hint (CHECK-029 support) ---
    await createTask(pageA, { title: '响应式任务', description: '用于布局检查' });
    await pageA.getByText('响应式任务').first().waitFor({ state: 'visible' });

    for (const width of [1366, 768, 360]) {
      await pageA.setViewportSize({ width, height: 900 });
      await pageA.waitForTimeout(200);
      const columns = await pageA.locator('.board-column').count();
      const hintVisible = await pageA.locator('.scroll-hint').isVisible();
      check(`${width}px 下三列均存在`, columns === 3, `columns=${columns}`);
      check(
        `${width}px 下滚动提示${width <= 1024 ? '可见' : '隐藏'}`,
        hintVisible === width <= 1024,
        `hintVisible=${hintVisible}`,
      );
    }
    await pageA.setViewportSize({ width: 1366, height: 900 });

    // --- 6. Keyboard: Escape closes, focus returns, Enter never deletes (CHECK-030 support) ---
    await pageA.getByRole('button', { name: /响应式任务/ }).first().click();
    const detail = pageA.getByRole('dialog', { name: '任务详情' });
    await detail.waitFor({ state: 'visible' });
    await pageA.keyboard.press('Escape');
    await detail.waitFor({ state: 'detached' });
    const focusAfterEscape = await pageA.evaluate(
      () => document.activeElement?.getAttribute('aria-label') ?? '',
    );
    check('Escape 可关闭弹窗且焦点回到原卡片', focusAfterEscape.includes('响应式任务'));

    await pageA.getByRole('button', { name: /响应式任务/ }).first().click();
    await pageA.getByRole('dialog', { name: '任务详情' }).getByRole('button', { name: '删除' }).click();
    await pageA.getByRole('dialog', { name: '删除任务' }).waitFor({ state: 'visible' });
    await pageA.keyboard.press('Enter');
    await pageA.waitForTimeout(300);
    const stillThere = await api('GET', `/boards/${board.id}/tasks`);
    check('删除确认中直接回车不会误删（默认焦点在取消）', stillThere.body.data.length === 1);
    if ((await pageA.getByRole('dialog', { name: '删除任务' }).count()) > 0) {
      await pageA.keyboard.press('Escape');
    }

    console.log(`引擎：A = ${a.engine}；B = ${b.engine}`);
  } finally {
    await Promise.allSettled(browsers.map((browser) => browser.close()));
  }

  const pad = (value, width) => String(value).padEnd(width, ' ');
  for (const result of results) {
    console.log(`${pad(result.ok ? 'PASS' : 'FAIL', 5)} ${result.name}${result.ok || result.detail === '' ? '' : ` → ${result.detail}`}`);
  }
  console.log(`\n${results.length - failures}/${results.length} 项通过`);

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`双浏览器回归失败：${error.message}`);
  process.exitCode = 1;
});
