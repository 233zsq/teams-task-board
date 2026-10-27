#!/usr/bin/env node
/**
 * TASK-018 one-click HTTP regression.
 *
 * Boots the built backend against a disposable SQLite file on a free port and
 * verifies the API contract and security boundaries without the UI:
 * status codes, error envelope, 32 KiB limit, media type, Host allowlist,
 * security headers, SQL/XSS-safe text handling and cross-board isolation.
 *
 * Usage: npm run check:api   (builds shared + backend first)
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendDir = path.join(rootDir, 'backend');
const serverEntry = path.join(backendDir, 'dist', 'server.js');
const initEntry = path.join(backendDir, 'dist', 'db', 'init.js');

if (!fs.existsSync(serverEntry) || !fs.existsSync(initEntry)) {
  console.error('缺少后端构建产物，请先执行：npm run build:backend');
  process.exit(2);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-plan-regression-'));
const databasePath = path.join(tempDir, 'regression.sqlite');
const port = 3400 + Math.floor(Math.random() * 400);

const results = [];
let failures = 0;

function check(name, condition, detail = '') {
  const ok = Boolean(condition);
  results.push({ name, ok, detail });
  if (!ok) {
    failures += 1;
  }
}

function request({ method = 'GET', requestPath = '/', headers = {}, body = undefined, host }) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(body);
    const finalHeaders = {
      Host: host ?? `127.0.0.1:${port}`,
      ...(payload === undefined
        ? {}
        : {
            'Content-Type': 'application/json',
            'Content-Length': String(payload.length),
          }),
      ...headers,
    };

    const req = http.request(
      { host: '127.0.0.1', port, method, path: requestPath, headers: finalHeaders },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = text === '' ? null : JSON.parse(text);
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      },
    );

    req.on('error', reject);
    if (payload !== undefined) {
      req.write(payload);
    }
    req.end();
  });
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: backendDir,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, output }));
  });
}

async function waitForHealth(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await request({ requestPath: '/api/v1/health' });
      if (response.status === 200) {
        return true;
      }
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

const env = { DATABASE_PATH: databasePath, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production', ALLOWED_HOSTS: '' };

async function main() {
  const init = await run(process.execPath, [initEntry], env);
  if (init.code !== 0) {
    console.error(init.output);
    throw new Error('数据库初始化失败，无法继续回归');
  }

  const server = spawn(process.execPath, [serverEntry], {
    cwd: backendDir,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  let serverLog = '';
  server.stdout.on('data', (chunk) => {
    serverLog += chunk;
  });
  server.stderr.on('data', (chunk) => {
    serverLog += chunk;
  });

  try {
    if (!(await waitForHealth())) {
      console.error(serverLog);
      throw new Error('后端未能在超时时间内启动');
    }

    await runChecks();
  } finally {
    server.kill();
    await new Promise((resolve) => setTimeout(resolve, 300));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  const pad = (value, width) => String(value).padEnd(width, ' ');
  for (const result of results) {
    const mark = result.ok ? 'PASS' : 'FAIL';
    console.log(`${pad(mark, 5)} ${result.name}${result.ok || result.detail === '' ? '' : ` → ${result.detail}`}`);
  }
  console.log(`\n${results.length - failures}/${results.length} 项通过`);

  if (failures > 0) {
    process.exitCode = 1;
  }
}

const SECURITY_HEADER_EXPECTATIONS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

function assertNoLeak(response, label) {
  const raw = response.text;
  const leaked =
    raw.includes('SELECT') ||
    raw.includes('node_modules') ||
    raw.includes(tempDir) ||
    raw.includes('at Object.') ||
    /\.sqlite/i.test(raw);
  check(`${label}：响应不泄漏 SQL/堆栈/数据库路径`, leaked === false, raw.slice(0, 120));
}

async function runChecks() {
  // --- health and headers ---
  const health = await request({ requestPath: '/api/v1/health' });
  check('GET /health 返回 200 与功能开关', health.status === 200 && health.json?.data?.status === 'ok');
  check(
    'GET /health 功能开关均为 false（P0 基线）',
    JSON.stringify(health.json?.data?.features) ===
      JSON.stringify({ priority: false, filters: false, ordering: false, sharing: false }),
  );
  for (const [header, expected] of Object.entries(SECURITY_HEADER_EXPECTATIONS)) {
    check(`响应头 ${header} = ${expected}`, health.headers[header] === expected, health.headers[header]);
  }
  check(
    '响应头包含 frame-ancestors 或 X-Frame-Options',
    (health.headers['content-security-policy'] ?? '').includes("frame-ancestors 'none'") ||
      health.headers['x-frame-options'] === 'DENY',
  );

  // --- Host allowlist (DNS rebinding) ---
  const evilHost = await request({ requestPath: '/api/v1/boards', host: 'evil.example' });
  check('自定义 Host 返回 403 FORBIDDEN', evilHost.status === 403 && evilHost.json?.error?.code === 'FORBIDDEN');

  // --- members ---
  const members = await request({ requestPath: '/api/v1/members' });
  check('GET /members 返回四条预置成员', members.status === 200 && members.json?.data?.length === 4);
  check(
    '成员按 A～D 顺序返回且无鉴权字段',
    members.json?.data?.map((item) => item.displayName).join(',') === '成员 A,成员 B,成员 C,成员 D' &&
      Object.keys(members.json.data[0]).sort().join(',') === 'displayName,id',
  );
  const memberId = members.json.data[1].id;

  // --- boards: happy path and validation ---
  const createdBoard = await request({
    method: 'POST',
    requestPath: '/api/v1/boards',
    body: JSON.stringify({ name: '  课程作业  ' }),
  });
  check('POST /boards 返回 201 且名称已 trim', createdBoard.status === 201 && createdBoard.json?.data?.name === '课程作业');
  const boardId = createdBoard.json?.data?.id;

  const injectionName = await request({
    method: 'POST',
    requestPath: '/api/v1/boards',
    body: JSON.stringify({ name: "' OR 1=1 --" }),
  });
  check('SQL 注入形态名称按纯文本保存', injectionName.status === 201 && injectionName.json?.data?.name === "' OR 1=1 --");

  const boardsList = await request({ requestPath: '/api/v1/boards' });
  check('SQL 注入不扩大查询范围（仍只返回本脚本创建的看板）', boardsList.json?.data?.length === 2);
  const secondBoardId = injectionName.json.data.id;

  // --- error envelope and boundaries ---
  const brokenJson = await request({ method: 'POST', requestPath: '/api/v1/boards', body: '{"name":' });
  check('损坏 JSON → 400 BAD_REQUEST', brokenJson.status === 400 && brokenJson.json?.error?.code === 'BAD_REQUEST');

  const arrayBody = await request({ method: 'POST', requestPath: '/api/v1/boards', body: '["name"]' });
  check('顶层数组 → 400', arrayBody.status === 400);

  const scalarBody = await request({ method: 'POST', requestPath: '/api/v1/boards', body: '42' });
  check('顶层标量 → 400', scalarBody.status === 400);

  const nullBody = await request({ method: 'POST', requestPath: '/api/v1/boards', body: 'null' });
  check('顶层 null → 400', nullBody.status === 400);

  const protoBody = await request({
    method: 'POST',
    requestPath: '/api/v1/boards',
    body: '{"name":"看板","__proto__":{"polluted":true}}',
  });
  check('__proto__ 危险键 → 400', protoBody.status === 400);

  const invalidField = await request({ method: 'POST', requestPath: '/api/v1/boards', body: JSON.stringify({ name: '   ' }) });
  check(
    '非法字段值 → 422 且 fields 为固定短文案',
    invalidField.status === 422 && invalidField.json?.error?.fields?.name === '看板名称不能为空',
  );

  const protectedField = await request({
    method: 'POST',
    requestPath: '/api/v1/boards',
    body: JSON.stringify({ name: '看板', id: boardId }),
  });
  check('客户端提交受保护字段 id → 400', protectedField.status === 400);

  const unknownQuery = await request({ requestPath: `/api/v1/boards?page=1` });
  check('未知查询参数 → 400', unknownQuery.status === 400);

  const notFound = await request({ requestPath: '/api/v1/boards/22222222-2222-4222-8222-222222222222' });
  check('合法 UUID 但不存在 → 404', notFound.status === 404 && notFound.json?.error?.code === 'NOT_FOUND');

  const malformedId = await request({ requestPath: '/api/v1/boards/not-a-uuid' });
  check('非法路径 UUID → 400', malformedId.status === 400);

  const bigBody = await request({
    method: 'POST',
    requestPath: '/api/v1/boards',
    body: JSON.stringify({ name: 'x'.repeat(33 * 1024) }),
  });
  check('超过 32 KiB 正文 → 413', bigBody.status === 413 && bigBody.json?.error?.code === 'PAYLOAD_TOO_LARGE');

  const wrongType = await request({
    method: 'POST',
    requestPath: '/api/v1/boards',
    headers: { 'Content-Type': 'text/plain' },
    body: 'name=看板',
  });
  check('非 JSON 写正文 → 415', wrongType.status === 415 && wrongType.json?.error?.code === 'UNSUPPORTED_MEDIA_TYPE');

  const unknownPathWithBody = await request({
    method: 'POST',
    requestPath: '/api/v1/does-not-exist',
    body: JSON.stringify({ name: 'x'.repeat(33 * 1024) }),
  });
  check(
    '未匹配路径带超大体 → 404 且 Connection: close',
    unknownPathWithBody.status === 404 && unknownPathWithBody.headers.connection === 'close',
  );

  const unknownMethod = await request({ method: 'DELETE', requestPath: '/api/v1/boards' });
  check('未知方法 → 404（P0 不使用 405）', unknownMethod.status === 404);

  // --- tasks: CRUD, defaults, cross-board isolation ---
  const xssTitle = '<script>alert(1)</script>';
  const createdTask = await request({
    method: 'POST',
    requestPath: `/api/v1/boards/${boardId}/tasks`,
    body: JSON.stringify({
      title: xssTitle,
      description: '第一行\n第二行',
      dueDate: '2026-10-23',
      assigneeId: memberId,
      status: 'doing',
    }),
  });
  check('POST /tasks 返回 201 与完整 Task', createdTask.status === 201 && createdTask.json?.data?.status === 'doing');
  check('HTML 形态标题按原文保存，不做执行', createdTask.json?.data?.title === xssTitle);
  check('创建时 updatedAt 等于 createdAt', createdTask.json?.data?.createdAt === createdTask.json?.data?.updatedAt);
  const taskId = createdTask.json.data.id;

  const titleOnly = await request({
    method: 'POST',
    requestPath: `/api/v1/boards/${boardId}/tasks`,
    body: JSON.stringify({ title: '仅标题' }),
  });
  check(
    '仅标题任务使用创建默认值',
    titleOnly.status === 201 &&
      titleOnly.json?.data?.description === '' &&
      titleOnly.json?.data?.dueDate === null &&
      titleOnly.json?.data?.assigneeId === null &&
      titleOnly.json?.data?.status === 'todo',
  );

  const taskList = await request({ requestPath: `/api/v1/boards/${boardId}/tasks` });
  check('任务列表按 createdAt 升序返回当前看板任务', taskList.json?.data?.length === 2);

  const crossBoardGet = await request({ requestPath: `/api/v1/boards/${secondBoardId}/tasks/${taskId}` });
  check('跨板读取任务 → 404', crossBoardGet.status === 404);

  const crossBoardPut = await request({
    method: 'PUT',
    requestPath: `/api/v1/boards/${secondBoardId}/tasks/${taskId}`,
    body: JSON.stringify({ title: 'x', description: '', dueDate: null, assigneeId: null, status: 'todo' }),
  });
  check('跨板写入任务 → 404', crossBoardPut.status === 404);

  const crossBoardDelete = await request({
    method: 'DELETE',
    requestPath: `/api/v1/boards/${secondBoardId}/tasks/${taskId}`,
  });
  check('跨板删除任务 → 404', crossBoardDelete.status === 404);

  const missingFieldPut = await request({
    method: 'PUT',
    requestPath: `/api/v1/boards/${boardId}/tasks/${taskId}`,
    body: JSON.stringify({ title: '只有标题' }),
  });
  check(
    'PUT 缺字段 → 422 且逐字段报告（缺字段不等于清空）',
    missingFieldPut.status === 422 && Object.keys(missingFieldPut.json?.error?.fields ?? {}).length === 4,
  );

  const badEnum = await request({
    method: 'PUT',
    requestPath: `/api/v1/boards/${boardId}/tasks/${taskId}`,
    body: JSON.stringify({ title: 'x', description: '', dueDate: null, assigneeId: null, status: 'Doing' }),
  });
  check('非法状态枚举 → 422', badEnum.status === 422);

  const badDate = await request({
    method: 'PUT',
    requestPath: `/api/v1/boards/${boardId}/tasks/${taskId}`,
    body: JSON.stringify({ title: 'x', description: '', dueDate: '2026-02-30', assigneeId: null, status: 'todo' }),
  });
  check('非法日期 → 422', badDate.status === 422);

  const unknownAssignee = await request({
    method: 'PUT',
    requestPath: `/api/v1/boards/${boardId}/tasks/${taskId}`,
    body: JSON.stringify({
      title: 'x',
      description: '',
      dueDate: null,
      assigneeId: '22222222-2222-4222-8222-222222222222',
      status: 'todo',
    }),
  });
  check('不存在的负责人 → 422 且指明 assigneeId', unknownAssignee.status === 422 && unknownAssignee.json?.error?.fields?.assigneeId === '负责人不存在');

  const updated = await request({
    method: 'PUT',
    requestPath: `/api/v1/boards/${boardId}/tasks/${taskId}`,
    body: JSON.stringify({ title: '完成接口联调', description: '', dueDate: null, assigneeId: null, status: 'done' }),
  });
  check('完整 PUT 成功并保留 id/boardId/createdAt', updated.status === 200 && updated.json?.data?.id === taskId && updated.json?.data?.boardId === boardId);
  check('任何成功 PUT 都刷新 updatedAt', updated.json?.data?.updatedAt !== createdTask.json?.data?.updatedAt);

  const wrongTypePut = await request({
    method: 'PUT',
    requestPath: `/api/v1/boards/${boardId}/tasks/${taskId}`,
    headers: { 'Content-Type': 'text/plain' },
    body: 'title=x',
  });
  check('PUT 非 JSON 正文 → 415', wrongTypePut.status === 415);

  const deleted = await request({ method: 'DELETE', requestPath: `/api/v1/boards/${boardId}/tasks/${taskId}` });
  check('DELETE 返回 204 无正文', deleted.status === 204 && deleted.text === '');

  const deletedAgain = await request({ method: 'DELETE', requestPath: `/api/v1/boards/${boardId}/tasks/${taskId}` });
  check('重复 DELETE → 404', deletedAgain.status === 404);

  // --- no leakage on any error response ---
  for (const [label, response] of [
    ['400', brokenJson],
    ['403', evilHost],
    ['404', notFound],
    ['413', bigBody],
    ['415', wrongType],
    ['422', invalidField],
  ]) {
    assertNoLeak(response, `${label} 错误响应`);
  }

  // --- SPA and API coexistence (build demo) ---
  const spaPage = await request({ requestPath: '/boards/' + boardId });
  check('深层路由返回 HTML 页面（SPA 回退）', spaPage.status === 200 && spaPage.text.includes('<div id="app">'));
  const apiUnknown = await request({ requestPath: '/api/v1/nope' });
  check('未知 API 路径仍返回 JSON 404，不返回 HTML', apiUnknown.status === 404 && apiUnknown.json?.error?.code === 'NOT_FOUND');
}

main().catch((error) => {
  console.error(`回归脚本失败：${error.message}`);
  process.exitCode = 1;
});