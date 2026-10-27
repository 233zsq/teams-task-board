# 验证记录索引

本目录保存 P0 核心验收与回归的可复现证据，配合 [checklist.md](../checklist.md) 的 CHECK 编号使用。
每条记录都写明**被测提交、环境、执行命令、结果与残留项**；截图见 [screenshots](screenshots/)。

## 被测版本与环境（2026-10-27）

| 项 | 值 |
| --- | --- |
| 被测提交 | `c077db9`（P0 功能与回归脚本；本目录文档在其后单独提交） |
| Node / npm | v24.18.0 / 11.16.0 |
| 操作系统 | Windows 10.0.26200（x64） |
| 浏览器 | Microsoft Edge 156.0.4314.42（playwright-core 1.64.1 驱动，headless） |
| 内嵌浏览器 | Chromium 内核（UA `Chrome/146.0.7680.80`，ZCode 内置） |
| 数据库 | SQLite（better-sqlite3 11.10.0）；`data/team-plan-demo.sqlite` 为可丢弃演示库 |
| 本地未安装 | Google Chrome（CHECK-029/030 的 Chrome 品牌项待课程机补验，命令见下文） |

## 记录清单

| 记录 | 内容 | 对应任务与 CHECK |
| --- | --- | --- |
| [TASK-015-first-integration.md](TASK-015-first-integration.md) | 第一次真实业务联调（真服务、真数据库、真 UI） | TASK-015 / CHECK-042 |
| [TASK-017-dual-browser.md](TASK-017-dual-browser.md) | 双浏览器刷新、覆盖、外部删除、失败恢复 | TASK-017 / CHECK-022～028、029、030 |
| [TASK-018-api-regression.md](TASK-018-api-regression.md) | 一键 HTTP 契约与安全边界回归 | TASK-018 / CHECK-031～036 |
| [TASK-032-final-regression.md](TASK-032-final-regression.md) | 最终版本核心回归与 CHECK-001～043 逐条结论 | TASK-032 / CHECK-001～043 |

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