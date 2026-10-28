#!/usr/bin/env node
// Full-feature HTTP + real UI acceptance. --api-only needs production deps only.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerTestSession } from './auth-session.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const temp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'teamplan-search-'));
const output = path.resolve(process.env.E2E_OUTPUT_DIR ?? path.join(root, '.artifacts/search-check'));
fs.mkdirSync(output, { recursive: true });
const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const env = { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(port), ALLOWED_HOSTS: '127.0.0.1,localhost', DATABASE_PATH: path.join(temp, 'search.sqlite'), ENABLE_PRIORITY: '1', ENABLE_FILTERS: '1', ENABLE_ORDERING: '0', ENABLE_SHARING: '0' };
const apiOnly = process.argv.includes('--api-only');
const results = [], browsers = [], runtimeErrors = [];
let server, activeBrowser, activePage, owner, member, outsider;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function check(name, action) { await action(); results.push({ name, status: 'passed' }); console.log('PASS ' + name); }
async function request(session, method, route, body) {
  const response = await fetch(`${base}/api/v1${route}`, { method, headers: { ...session?.headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
}
async function api(method, route, body) { const r = await request(owner, method, route, body); assert(r.status >= 200 && r.status < 300, `${method} ${route}: ${r.status}`); return r.body?.data; }
async function seed(label) {
  const board = await api('POST', '/boards', { name: `搜索筛选 ${label}` });
  await api('POST', `/boards/${board.id}/members`, { username: member.user.username });
  const tasks = [];
  for (const input of [
    { title: `${label} 接口 ALPHA 100%_`, description: '课程描述关键词', priority: 'high', assigneeId: owner.user.id, dueDate: '2026-10-28' },
    { title: `${label} 答辩材料`, description: '仅描述 ALPHA', priority: 'medium', assigneeId: member.user.id, dueDate: '2026-10-29' },
    { title: `${label} 资料整理`, priority: 'low', assigneeId: null, dueDate: null },
  ]) tasks.push(await api('POST', `/boards/${board.id}/tasks`, input));
  return { board, tasks };
}
async function count(page, amount) {
  await page.waitForFunction(amount => document.querySelectorAll('.task-card').length === amount && document.querySelector('.task-filter-bar')?.getAttribute('aria-busy') !== 'true', amount);
}
async function apply(page) { await page.locator('.task-filter-bar button[type=submit]').click(); }
async function clear(page, amount) { await page.getByRole('button', { name: '清空筛选', exact: true }).click(); await count(page, amount); }
async function editPriority(page, title, priority) {
  await page.locator('.task-card').filter({ hasText: title }).click();
  await page.getByRole('dialog', { name: '任务详情', exact: true }).getByRole('button', { name: '编辑', exact: true }).click();
  const form = page.getByRole('dialog', { name: '编辑任务', exact: true });
  await form.getByLabel('优先级', { exact: true }).selectOption(priority);
  await form.getByRole('button', { name: '保存任务', exact: true }).click(); await form.waitFor({ state: 'detached' });
}
try {
  const init = spawn(process.execPath, [path.join(root, 'backend/dist/db/init.js')], { cwd: root, env, windowsHide: true, stdio: 'ignore' });
  assert.equal((await once(init, 'exit'))[0], 0);
  server = spawn(process.execPath, [path.join(root, 'backend/dist/server.js')], { cwd: root, env, windowsHide: true, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/api/v1/health`)).ok) break; } catch {} if (i === 99) throw new Error('Startup timeout'); await pause(100); }
  owner = await registerTestSession(base, '搜索负责人'); member = await registerTestSession(base, '协作成员'); outsider = await registerTestSession(base, '外部账号');
  const fixture = await seed('HTTP'); const list = `/boards/${fixture.board.id}/tasks`;
  await check('HTTP default-enabled feature contract and priority persistence', async () => {
    const health = (await (await fetch(`${base}/api/v1/health`)).json()).data; assert.equal(health.features.priority,true); assert.equal(health.features.filters,true);
    assert.deepEqual((await api('GET', list)).map(task => task.priority).sort(), ['high','low','medium']);
    const defaults = await api('POST', list, {title:'默认优先级'}); assert.equal(defaults.priority,'medium'); await api('DELETE',`${list}/${defaults.id}`);
  });
  await check('HTTP title/description search, literal wildcard and combined inclusive range', async () => {
    assert.equal((await api('GET',list+'?q=alpha')).length,2); assert.equal((await api('GET',list+'?q=100%25_')).length,1);
    assert.equal((await api('GET',list+`?q=alpha&priority=high&assigneeId=${owner.user.id}&dueFrom=2026-10-28&dueTo=2026-10-28`)).length,1);
    assert.equal((await api('GET',list+'?dueFrom=0001-01-01')).length,2);
    assert.equal((await api('GET',list+'?assigneeId=unassigned&priority=low')).length,1);
  });
  await check('HTTP invalid query/PUT, anonymous and foreign-project boundaries', async () => {
    assert.equal((await request(owner,'GET',list+'?q=a&q=b')).status,400);
    assert.equal((await request(owner,'GET',list+'?priority=urgent')).status,422);
    assert.equal((await request(owner,'GET',list+'?dueFrom=2026-10-30&dueTo=2026-10-28')).status,422);
    assert.equal((await request(null,'GET',list+'?q=alpha')).status,401);
    assert.equal((await request(outsider,'GET',list+'?priority=urgent')).status,404);
    assert.equal((await request(owner,'GET',list+`?assigneeId=${outsider.user.id}`)).status,422);
    assert.equal((await request(owner,'PUT',`${list}/${fixture.tasks[0].id}`,{title:'缺少优先级',description:'',dueDate:null,assigneeId:null,status:'todo'})).status,422);
  });
  if (!apiOnly) {
    const { browserConfig, launchBrowser } = await import('./browser.mjs');
    for (const label of ['A','B']) {
      const config = browserConfig(process.env,label), launched = await launchBrowser(label,config); activeBrowser = launched.browser; browsers.push(launched.engine);
      const context = await activeBrowser.newContext({viewport:{width:1366,height:1100}}); await owner.apply(context); const page = await context.newPage(); activePage = page;
      page.setDefaultTimeout(15000); page.on('pageerror',error=>runtimeErrors.push(error.message));
      const { board, tasks } = await seed(config.channel); const prefix = config.channel;
      await page.goto(`${base}/boards/${board.id}`); await page.locator('.task-filter-bar').waitFor(); await count(page,3);
      await check(`${prefix} priority display, title/description and personal intersection`, async () => {
        assert.equal(await page.locator('.chip--priority-high').count(),1);
        await page.getByRole('searchbox',{name:'搜索任务',exact:true}).fill('alpha'); await apply(page); await count(page,2);
        await page.getByRole('button',{name:'我负责的',exact:true}).click(); await count(page,1);
        assert.equal(await page.locator('.project-summary > div').first().locator('strong').innerText(),'3');
        await page.getByRole('button',{name:'全部任务',exact:true}).click(); await count(page,2);
        await page.getByLabel('筛选优先级',{exact:true}).selectOption('high'); await apply(page); await count(page,1);
        for (const width of [1366,768,360]) { await page.setViewportSize({width,height:1100}); assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)); await page.screenshot({path:path.join(output,`${prefix}-${width}.png`),fullPage:true}); }
        await page.setViewportSize({width:1366,height:1100});
      });
      await check(`${prefix} combined filters, dates, empty state and clear`, async () => {
        await page.getByLabel('筛选负责人',{exact:true}).selectOption(member.user.id); await apply(page); await count(page,0); await page.getByText('没有匹配任务',{exact:true}).waitFor();
        await clear(page,3); await page.getByLabel('截止日期从',{exact:true}).fill('2026-10-28'); await page.getByLabel('截止日期至',{exact:true}).fill('2026-10-29'); await apply(page); await count(page,2);
        await page.getByLabel('筛选负责人',{exact:true}).selectOption('unassigned'); await apply(page); await count(page,0); await clear(page,3);
        await page.getByRole('searchbox',{name:'搜索任务',exact:true}).fill('100%_'); await apply(page); await count(page,1); await clear(page,3);
      });
      await check(`${prefix} priority edit leaves filter, create high priority and persists reload`, async () => {
        await page.getByLabel('筛选优先级',{exact:true}).selectOption('high'); await apply(page); await count(page,1);
        await editPriority(page,tasks[0].title,'low'); await count(page,0); await page.getByRole('status').filter({hasText:'不符合当前筛选条件'}).waitFor();
        await page.getByRole('button',{name:'在待办列新建任务',exact:true}).click(); const form=page.getByRole('dialog',{name:'新建任务',exact:true});
        assert.equal(await form.getByLabel('优先级',{exact:true}).inputValue(),'medium');
        await form.getByLabel('标题 *',{exact:true}).fill(`${prefix} 新建高优任务`); await form.getByLabel('优先级',{exact:true}).selectOption('high'); await form.getByRole('button',{name:'保存任务',exact:true}).click(); await form.waitFor({state:'detached'}); await count(page,1);
        await clear(page,4); await page.reload(); await page.locator('.task-filter-bar').waitFor(); await count(page,4);
        assert.equal((await api('GET',`/boards/${board.id}/tasks/${tasks[0].id}`)).priority,'low');
      });
      const queryPattern=`**/api/v1/boards/${board.id}/tasks?*`;
      await check(`${prefix} failed query is not empty; committed write is never replayed`, async () => {
        await page.getByLabel('筛选优先级',{exact:true}).selectOption('high'); await apply(page); await count(page,1);
        let writes=0; const onRequest=req=>{if(req.method()==='PUT'&&req.url().includes(`/boards/${board.id}/tasks/`))writes++;}; page.on('request',onRequest);
        await page.route(queryPattern,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'SERVICE_UNAVAILABLE',message:'test fixture'}})}));
        await editPriority(page,`${prefix} 新建高优任务`,'low'); await page.getByRole('status').filter({hasText:'任务已保存，筛选结果暂时读取失败'}).waitFor();
        assert.equal(writes,1); assert.equal(await page.getByText('没有匹配任务',{exact:true}).count(),0);
        const saved=(await api('GET',`/boards/${board.id}/tasks`)).find(task=>task.title===`${prefix} 新建高优任务`); assert.equal(saved.priority,'low');
        page.off('request',onRequest); await page.unroute(queryPattern); await page.locator('.board-column').first().getByRole('button',{name:'重试',exact:true}).click(); await count(page,0); await clear(page,4);
      });
      await check(`${prefix} slow query cannot overwrite a newer query`, async () => {
        const started=gate(), release=gate();
        await page.route(queryPattern,async route=>{if(new URL(route.request().url()).searchParams.get('q')!=='slow'){await route.continue();return;} const response=await route.fetch(); started.resolve(); await release.promise; await route.fulfill({response}).catch(()=>{});});
        await page.getByRole('searchbox',{name:'搜索任务',exact:true}).fill('slow'); await apply(page); await started.promise;
        await page.getByRole('searchbox',{name:'搜索任务',exact:true}).fill('alpha'); await apply(page); await count(page,2); release.resolve(); await pause(250); await count(page,2); await page.unroute(queryPattern);
      });
      await check(`${prefix} changing project resets pending conditions`, async () => {
        const started=gate(), release=gate();
        await page.route(queryPattern,async route=>{const response=await route.fetch(); started.resolve(); await release.promise; await route.fulfill({response}).catch(()=>{});});
        await page.getByRole('searchbox',{name:'搜索任务',exact:true}).fill('slow'); await apply(page); await started.promise;
        await page.locator('#new-board-sidebar-name').fill(`${prefix} 新项目`); await page.locator('.sidebar-create').getByRole('button',{name:'新建看板',exact:true}).click();
        await page.getByRole('heading',{name:`${prefix} 新项目`,exact:true}).waitFor(); await count(page,0); release.resolve(); await pause(200);
        assert.equal(await page.getByRole('searchbox',{name:'搜索任务',exact:true}).inputValue(),''); assert.equal(await page.getByLabel('筛选优先级',{exact:true}).inputValue(),'');
        await page.unroute(queryPattern);
      });
      await activeBrowser.close(); activeBrowser=null; activePage=null;
    }
  }
  assert.deepEqual(runtimeErrors,[]);
  fs.writeFileSync(path.join(output,apiOnly?'api-results.json':'results.json'),JSON.stringify({date:new Date().toISOString(),node:process.version,browsers,results,runtimeErrors,database:'temporary, cleaned'},null,2)+'\n');
  console.log(`Search acceptance: ${results.length}/${results.length}`);
} catch(error) {
  if(activePage&&!activePage.isClosed()) { await activePage.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{}); console.error(await activePage.locator('body').innerText().catch(()=>'')); }
  throw error;
} finally {
  await activeBrowser?.close(); if(server&&server.exitCode===null){server.kill();await once(server,'exit');}
  const relative=path.relative(fs.realpathSync(os.tmpdir()),temp); if(relative.startsWith('..')||path.isAbsolute(relative)||!path.basename(temp).startsWith('teamplan-search-'))throw new Error('Unsafe cleanup path');
  fs.rmSync(temp,{recursive:true,force:true});
}
