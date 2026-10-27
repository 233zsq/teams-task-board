# TASK-015 第一次真实业务联调（CHECK-042）

日期：2026-10-27｜被测提交：`c077db9`｜环境见 [README](README.md)

## 目的与准入

贯通「建板 → 读成员 → 建任务 → 展示 → 刷新」的真实链路：真实后端进程、真实 SQLite 文件、真实浏览器页面，
本轮链路不使用 mock 或内存替身（当时的记录如下，缺陷见文末）。

## 步骤与结果

| # | 操作 | 观察结果 |
| --- | --- | --- |
| 1 | `npm run db:init`（`data/team-plan.sqlite`） | 迁移 0001 应用，成员 4 条；健康检查 200 |
| 2 | `NODE_ENV=production npm start`（127.0.0.1:3000，同源提供前端构建） | 服务启动，`GET /api/v1/health` 返回 `{"status":"ok","features":{...全 false}}` |
| 3 | 浏览器打开 `http://127.0.0.1:3000/` | 健康门禁通过，进入看板工作区 |
| 4 | 侧栏新建看板 `  课程作业  ` | 服务端 201；名称去空白；页面自动切换到该看板并显示三个空列；侧栏显示「创建于 2026-10-27 16:31」 |
| 5 | 新建看板 `答辩准备` | 201，ID 不同，列表按创建时间升序；页面切换到新看板 |
| 6 | `GET /api/v1/members` | 返回成员 A～D 四条（顺序固定，无鉴权字段） |
| 7 | 表单新建任务：标题 `完成接口联调`、描述 `覆盖创建、编辑和状态修改`、截止日期 `2026-10-23`、负责人 `成员 B`、状态 `进行中` | 201；卡片出现在「进行中」列，显示负责人、截止日期与「⚠ 逾期」（当天为 2026-10-27，日期在过去且未完成） |
| 8 | 打开任务详情 | 标题/描述/负责人/截止日期/创建时间 `2026-10-27 16:32`/最后更新一致（UTC 08:32 → Asia/Shanghai 16:32） |
| 9 | 详情中点击状态「已完成」 | 卡片移动到「已完成」列，逾期标记消失；服务端 `PUT` 200 且 `updatedAt` 变化 |
| 10 | 刷新浏览器页面（数据来自 SQLite） | 看板、任务、状态与刷新前一致 |

关键请求/响应（节选）：

```text
POST /api/v1/boards            {"name":"  课程作业  "}            → 201 {"data":{"id":"fc2252d2-...","name":"课程作业","createdAt":"2026-10-27T08:31:..."}}
POST /api/v1/boards/:id/tasks  {"title":"完成接口联调", ...}       → 201 {"data":{..., "status":"doing", "createdAt":"...","updatedAt":"..."}}
PUT  /api/v1/boards/:id/tasks/:taskId {"status":"done", 五字段完整} → 200 updatedAt 刷新
DELETE /api/v1/boards/:id/tasks/:taskId（联调顺带验证）           → 204 无正文
```

## 跨层一致性

- 页面显示的成员名来自 `/members`，任务只保存 `assigneeId`，没有前端成员副本。
- 卡片/详情中的日期与时间戳与 `GET` 响应逐字一致；逾期按 Asia/Shanghai 计算。
- 失败分支（任务已删、读取失败、断网）在后续 TASK-017 记录中单独验证。

## 本轮发现的缺陷与修复

| 缺陷 | 复现 | 处理 |
| --- | --- | --- |
| 空库首页从「创建引导」新建看板后，看板已写入服务端但页面停留在「正在打开看板」 | 空库打开 `/`，在引导表单建板；`GET /boards` 已有新看板，URL 仍是 `/` | 引导表单被卸载导致 `created` 事件丢失；改为页面提供 `createAndOpen` 回调完成创建与跳转（提交 `08f8df3`），并补回归测试与浏览器复验 |
| 侧栏与引导同时渲染同一表单，产生重复 `id="new-board-name"` | 空库首页 `document.querySelectorAll('#new-board-name').length === 2` | `CreateBoardForm` 增加 `inputId`，两个入口使用唯一 ID（提交 `08f8df3`） |

## 证据

- 截图：[board-with-task.png](screenshots/board-with-task.png)、[task-detail.png](screenshots/task-detail.png)
- 自动化：`backend/tests/tasks-api.test.ts`、`boards-api.test.ts`、`members-api.test.ts`、前端 `task-board.test.ts`

## 结论

CHECK-042 通过：真服务、真数据库、无 mock，跨层字段一致；发现的两处缺陷已修复并复验。