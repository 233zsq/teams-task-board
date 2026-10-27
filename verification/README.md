# 验证记录索引

本目录保存 S1～S4 与核心门禁的可复现证据，配合 [checklist.md](../checklist.md) 的 CHECK 编号与
[tasks.md](../tasks.md) 的切片验收卡使用。每条记录都写明**被测提交、环境、执行命令、结果与残留项**；
截图见 [screenshots](screenshots/)。切片级的 AI 过程记录见 [ai-log.md](../ai-log.md)。

**最新交付：受密码保护的公网演示已上线。** 本轮累计 188 项业务测试、服务器 API 50/50 和公网检查 12/12 通过；部署时生产依赖审计为 0 项。来源提交、环境与服务状态见 [公网部署记录](../deploy/DEPLOYMENT.md)，公网检查详情见 [public-deployment-checks.json](public-deployment-checks.json)。

本轮追加的 Chrome for Testing + Edge、浏览器 HTTP 故障/慢响应补验与候选打包入口见 [RELEASE-candidate.md](RELEASE-candidate.md)。下方 `c077db9` 保留为历史记录的被测提交，不冒称为新候选提交的结果。

## 被测版本与环境（2026-10-27）

| 项 | 值 |
| --- | --- |
| 被测代码提交 | `c077db9`（S1～S4 功能与回归脚本；文档与验证记录在其后合并，agent 记录见 `ai-log.md`） |
| 切片对照 | S1→TASK-015 记录；S2/S3→双浏览器与 API 回归记录；S4→TASK-017/018/032 记录 |
| Node / npm | v24.18.0 / 11.16.0 |
| 操作系统 | Windows 10.0.26200（x64） |
| 浏览器 | Microsoft Edge 156.0.4314.42（playwright-core 1.64.1 驱动，headless） |
| 内嵌浏览器 | Chromium 内核（UA `Chrome/146.0.7680.80`，ZCode 内置） |
| 数据库 | SQLite（better-sqlite3 11.10.0）；`data/team-plan-demo.sqlite` 为可丢弃演示库 |
| 本地未安装 | Google Chrome（CHECK-029/030 的 Chrome 品牌项待课程机补验，命令见下文） |
| 独立验收 | **未进行**：按切片规则需非主驾成员按原 CHECK 复验 |

## 记录清单

| 记录 | 内容 | 对应任务与 CHECK |
| --- | --- | --- |
| [TASK-015-first-integration.md](TASK-015-first-integration.md) | 第一次真实业务联调（真服务、真数据库、真 UI） | TASK-015 / CHECK-042 |
| [TASK-017-dual-browser.md](TASK-017-dual-browser.md) | 双浏览器刷新、覆盖、外部删除、失败恢复 | TASK-017 / CHECK-022～028、029、030 |
| [TASK-018-api-regression.md](TASK-018-api-regression.md) | 一键 HTTP 契约与安全边界回归 | TASK-018 / CHECK-031～036 |
| [TASK-032-final-regression.md](TASK-032-final-regression.md) | 最终版本核心回归与 CHECK-001～043 逐条结论 | TASK-032 / CHECK-001～043 |
| [member-a-s1/README.md](member-a-s1/README.md) | 成员 A 计划、独立 S1 创建与进程重启验证、交接证据 | S1 / CHECK-001、002、005、007、008、009、038、042 |

## 复现命令（摘要）

```bash
npm ci                 # 按锁文件安装（首次会编译 better-sqlite3）
npm run build:shared
npm run db:init        # 建库、迁移 0001、写入四名固定成员
npm run typecheck      # 三个包的类型检查
npm test               # shared + backend + frontend 单元/集成测试
npm run build          # shared → backend → frontend 构建
npm run check:api      # 一键 HTTP 回归（自带临时数据库与端口）
npm run db:demo        # 生成演示数据（10 看板 / 200 任务，独立演示库）
DATABASE_PATH=data/team-plan-demo.sqlite NODE_ENV=production npm start   # 单服务演示
npm run test:e2e       # 双浏览器 E2E（需上一步的服务在运行）
E2E_BROWSER=chrome npm run test:e2e   # 课程机上补记 Chrome 版本时使用
```
