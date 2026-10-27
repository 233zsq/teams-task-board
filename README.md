# 团队任务协作看板

“AI生成式软件”课程的四人协作项目，目标是实现轻量版 Trello：通过多个看板管理任务，展示负责人、截止日期和完成状态。

项目采用**人定义场景与验收、AI 生成端到端切片、机器回归、人独立复验**的开发方式。分工和进度不看代码行数，而看可运行、可演示的用户结果。

## 当前状态

**S0 已完成；S1～S4 的实现与自测完成（2026-10-27），非主驾独立验收尚未进行；S5 未选择；RELEASE 待打包与发布标签。**

仓库目前包含：

- 已评审的产品契约、架构与验证清单；切片计划、AI 记录与仓库代理约束；
- 原型截图和样式参考；
- shared 契约包（类型、错误码、文本/日期纯规则，ESM + CJS 双产物）；
- Express 后端：健康检查、请求与安全边界、成员/看板/任务 API、统一错误映射；
- SQLite P0 表、固定成员种子、连续迁移编号与校验和、演示数据与重置命令；
- Vue 3 前端：看板导航、三列任务视图、详情、表单、状态/删除/日期、刷新与竞态防护、健康门禁、响应式与键盘操作；
- 单元/集成测试 188 项、一键 HTTP 回归（50 项）、双浏览器 E2E 脚本（22 项）；
- 实测记录与截图：[verification/](verification/README.md)。

CHECK-001～043 已按候选提交执行并记录（41 项通过；CHECK-029/030 已补齐 Chrome/Edge 自动化，仍待人工独立复验），
逐条结论见 [checklist.md](checklist.md) 与 [verification/TASK-032-final-regression.md](verification/TASK-032-final-regression.md)。
S5（优先级、筛选、拖拽、分享）未选择、未实施。

最新补验与候选包说明见 [RELEASE-candidate.md](verification/RELEASE-candidate.md)：Chrome/Edge 完整尺寸操作、键盘、慢请求与故障恢复已补跑；候选包可通过 `npm run package:candidate` 生成，正式验收与发布仍待完成。

## 获取项目

```sh
git clone https://github.com/233zsq/teams-task-board.git
cd teams-task-board
```

## 本地运行

已验证环境：Windows 10.0.26200 x64、Node.js 24.18.0、npm 11.16.0、Edge 156.0.4314.42；
当前 `engines` 为 Node.js `>=18.17`，依赖版本以锁文件为准。课程机采用其他版本时，应实际复验并更新记录。

### 开发模式（Vite + Express）

```powershell
npm ci
Copy-Item .env.example .env
npm run db:init          # 建库、迁移 0001、写入四名固定成员；可重复执行
npm run dev              # shared 监听 + 后端 127.0.0.1:3000 + 前端 127.0.0.1:5173
```

打开 <http://127.0.0.1:5173>。Vite 代理 `/api` 到 `127.0.0.1:3000`。

### 构建后单服务演示

```powershell
npm run build
$env:DATABASE_PATH="data/team-plan-demo.sqlite"; $env:NODE_ENV="production"; npm start
```

打开 <http://127.0.0.1:3000>；静态页面与 API 同源，深链接刷新由 SPA 回退处理，未知 `/api` 仍返回 JSON 404。

### 演示数据与重置

```powershell
npm run db:demo           # 演示库写入 10 看板 / 200 任务；重复执行不重复写入
npm run db:reset-demo     # 只删除演示库，需输入 yes 确认；非交互用 db:reset-demo:yes
```

演示库默认 `data/team-plan-demo.sqlite`，与 `DATABASE_PATH` 的主库互相独立；重置命令拒绝删除文件名不含 `demo` 的数据库。

### 备份与恢复

```powershell
# 停服并确认连接已关闭后备份
Copy-Item data/team-plan.sqlite data/team-plan-YYYYMMDD.sqlite
# 恢复：停服后覆盖回配置路径，再启动（启动会核对迁移编号与校验和）
Copy-Item data/team-plan-YYYYMMDD.sqlite data/team-plan.sqlite
npm start
```

恢复失败不会自动删库或降级迁移。实测记录见 [verification/TASK-032-final-regression.md](verification/TASK-032-final-regression.md)。

### 检查命令

```powershell
npm run typecheck        # 三个包类型检查
npm test                 # shared + backend + frontend（188 项）
npm run check:api        # 一键 HTTP 契约与安全回归（临时库，50 项）
npm run test:e2e         # 双浏览器 E2E（需服务已启动；E2E_BROWSER=chrome 可换 Chrome）
npm run test:e2e:launcher # 浏览器选择与禁止静默回退的回归
# 隔离服务、临时库及 Chrome/Edge 配置见 verification/RELEASE-candidate.md
npm run check:browser
```

- `npm run db:init` 只应用待执行迁移并幂等写入四名固定成员，可重复执行，不删除看板或任务。
- 数据库未初始化、结构不兼容或配置无效时，服务明确失败，不回退到内存库或另一个空库。
- 配置键以 `.env.example` 为入口；`.env` 和本地数据库不提交仓库。

## 预期效果

![看板三列视图（预期效果）](prototype/screenshots/board.png)

原型用于给 AI 与评审提供视觉和交互目标，不代表功能已经运行。更多场景见 [prototype/screenshots](prototype/screenshots/)，样式参考 [global.css](prototype/styles/global.css)。

实际运行界面（2026-10-27 实测）：[看板与任务卡片](verification/screenshots/board-with-task.png)、
[任务详情](verification/screenshots/task-detail.png)、[360 窄屏](verification/screenshots/narrow-360.png)、
[演示库看板](verification/screenshots/board-demo.png)。

## 文档导航

| 目的 | 入口 |
| --- | --- |
| 了解分工、当前切片和完成门禁 | [tasks.md](tasks.md) |
| 查看用户场景、业务规则、字段和 API 契约 | [spec.md](spec.md) |
| 理解实际架构、关键约束与技术决策 | [architecture.md](architecture.md) |
| 执行切片验收与最终复演 | [checklist.md](checklist.md) |
| 给编码代理提供仓库操作约束 | [AGENTS.md](AGENTS.md) |
| 查看 AI 输入、首次结果、人工修正与验证证据 | [ai-log.md](ai-log.md) |
| 查看实测记录、截图与逐条 CHECK 结论 | [verification/](verification/README.md) |
| 运行浏览器补验、打包与组员独立复验 | [候选交付说明](verification/RELEASE-candidate.md) |

课程补充材料：[飞书文档](https://hypersmart.feishu.cn/wiki/IK4YwAvp6i3X9hk5Ih1csuTjn9g)。外部材料的具体要求以课程方发布为准。

## 切片分工

| 切片 | 用户结果 | 主驾 | 独立验收 |
| --- | --- | --- | --- |
| S1 | 建看板、建任务、三列/详情、真实持久化 | A | C |
| S2 | 多看板切换、直接链接、空态与加载恢复 | B | D |
| S3 | 编辑、删除、状态、日期、键盘和窄屏操作 | C | A |
| S4 | 双浏览器、异常、安全、备份恢复与交付加固 | D | B |
| S5 | 核心通过后选择一个完整扩展 | 待定 | 非主驾成员 |

S1 后，S2 与 S3 可并行。每个切片同时交付所需的 UI、API、数据变更、测试和真实演示，不再按技术层等待联调。完整范围与旧任务映射见 [tasks.md](tasks.md)。

## 产品边界

- **P0 必做：** 看板创建/查看/切换；任务增删改查、负责人、截止日期、状态与逾期；SQLite 持久化、错误恢复、多浏览器人工刷新、本地交付。
- **P1 选做：** 优先级、筛选、拖拽与排序。
- **P2 选做：** 带完整访问控制的只读分享。

核心版使用预置成员 A～D，不包含登录、成员管理、实时同步或自动冲突合并。任务状态为 `todo`、`doing`、`done`，允许任意双向流转。完整规则以 [spec.md](spec.md) 为准。

## 已知限制

- **完整 PUT 覆盖**：后提交成功的更新覆盖先前更新，不合并字段、无版本锁；编辑前比对 `updatedAt` 给出覆盖提示。
- **无实时同步**：其他浏览器需手动“刷新看板”；刷新失败保留当前数据并标记可能已过期。
- **单实例 SQLite**：写事务串行，锁等待超过 5000 ms 返回 503；不承诺并发写吞吐。
- **客户端 10 秒超时**只结束本地等待，超时后请先刷新查证；客户端不自动重放写请求。
- 无登录、无按用户权限、无分页、无撤销删除；P2 分享未实施；服务默认无 TLS，仅用于可信本机/局域网演示。
- 演示规模观察值（10 看板 / 200 任务 / 4 会话，首卡 195～393 ms）是本机观察，不是生产容量承诺。

## 每轮 AI 开发留下什么

1. 人事先确定的 REQ、CHECK 和失败例子；
2. 给 AI 的相关代码、原型、约束与代表性提示；
3. 首次生成结果及真实失败；
4. 人工采用、拒绝和修正的理由；
5. 自动化、真实浏览器与独立验收证据。

记录入口为 [ai-log.md](ai-log.md)。不保存全部聊天，不补造历史记录，不让 AI 自己宣布验收通过。

## 协作约定

- 一个短分支交付一个用户切片或一个可复现缺陷修复，`main` 保持可启动。
- PR 关联切片/REQ/CHECK，包含实际测试、真实操作、契约或迁移影响和 AI 记录。
- 业务或 API 变化在同一 PR 更新 spec、实现和验证；数据库只新增后续迁移，不改写已应用版本。
- 提交标题使用`类型: 中文说明`，例如`feat: 打通看板与任务创建闭环`。
