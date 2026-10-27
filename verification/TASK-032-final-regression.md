# TASK-032 最终版本核心回归（CHECK-001～043）

日期：2026-10-27｜被测提交：`c077db9`（本目录文档在其后单独提交）｜环境见 [README](README.md)

## 本轮执行的全部命令与结果

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 三个包（shared / backend / frontend）通过，无类型错误 |
| `npm test` | shared 16 + backend 111 + frontend 59 = **186 项通过**，无跳过 |
| `npm run build` | shared（ESM+CJS）→ backend（tsc）→ frontend（vue-tsc + vite）成功 |
| `npm run check:api` | **50/50 项通过**（自带临时库与随机端口，重复执行一致） |
| `npm run db:demo` | 演示库：10 看板 / 200 任务；重复执行不重复写入 |
| `npm run test:e2e` | **22/22 项通过**，Edge 156.0.4314.42 × 2 实例 |
| 干净检出复演 | `git clone` → `npm ci`（332 包，锁文件一致）→ `npm run build` → `db:init` → 生产启动 → 浏览器建板建任务并刷新持久 |
| 备份/恢复演练 | 停服备份（sha256 `a72a1e52…`）→ 启动并新增标记任务（201，可见）→ 停服恢复（哈希一致）→ 启动：健康 ok、10 看板 / 200 任务、标记任务消失 |
| 删除跨重启 | 建任务 → DELETE 204 → 重启同库 → GET 404；看板数不变 |
| 演示规模观察 | API：health 7.2 ms、看板列表 3.5 ms、任务列表平均 3.7 ms（最大 6.1 ms）；4 个浏览器会话同时加载同一看板，首卡可见 195/272/374/393 ms，各 20 张卡片 |
| 无头浏览器 UI 复核 | 空库引导建板并跳转、404 看板面板、断网刷新保留数据、离线保存保留输入、360 首屏与滚动提示、Esc 关闭与焦点恢复、XSS 纯文本、运行时错误页 |

## CHECK-001～043 逐条结论

| CHECK | 结论 | 证据 |
| --- | --- | --- |
| 001 建板/去空白/自动选中/双击只建一个 | 通过 | Edge 实测（含截图）；`boards-api.test.ts`；`board-nav.test.ts` 提交锁 |
| 002 名称边界与绕过 UI 校验 | 通过 | `boards-api.test.ts`（50/51/空白 422）；`board-nav.test.ts` 前端校验不发请求 |
| 003 两板切换与直接路由不串数据 | 通过 | Edge 实测切换与深链；`workspace.test.ts` 切板清空 + 骨架；API 顺序断言 |
| 004 空库引导与不存在看板 | 通过 | Edge（空库 3100/3200/3400 端口实测）；`board-nav`/`workspace`/`home-page` 测试 |
| 005 初始化幂等与四成员 | 通过 | `migrations.test.ts`；`members-api.test.ts` 重复种子；Edge 表单选项 |
| 006 负责人四选/清空/非法/成员读取失败 | 通过 | `tasks-api.test.ts`；断网实测「负责人信息不可用」+ 保存禁用 + 重试 |
| 007 全字段建任务与列归属 | 通过 | Edge 实测 + 截图；`tasks-api.test.ts` 201/形状 |
| 008 仅标题默认值与双击保存 | 通过 | `tasks-api.test.ts` 默认值；`task-form.test.ts` 保存锁单请求 |
| 009 三态/多负责人/空日期/长文本与骨架 | 通过 | Edge 实测；`task-board.test.ts`（骨架 vs 空态、长标题、逾期文字） |
| 010 详情字段与时间、外部删除 404 | 通过 | Edge 实测创建/更新时间；E2E 删除后 404 提示 |
| 011 五字段编辑/清空/updatedAt/缺字段/覆盖提示 | 通过 | `tasks-api.test.ts`（含相同值刷新 updatedAt）；E2E 覆盖提示与取消 |
| 012 删除确认文案与默认焦点 | 通过 | `status-delete.test.ts`；E2E 焦点与「不可恢复」文案 |
| 013 删除 204/重启不存在/重复 404/焦点转移 | 通过 | 删除跨重启脚本；`status-delete.test.ts` 焦点到相邻卡片 |
| 014 六种状态流转/同状态/非法枚举 | 通过 | `tasks-api.test.ts`；`status-delete.test.ts` 完整 PUT |
| 015 日期与闰年边界 | 通过 | `shared/tests/rules.test.ts`、`tasks-api.test.ts`（2026-02-30、1900-02-29 等） |
| 016 昨天/今天/明天与完成态 | 通过 | `rules.test.ts` 逾期公式；Edge 看到逾期出现与消失 |
| 017 午夜与设备时区、非法日期 | 通过 | `rules.test.ts` 15:59:59Z/16:00:00Z；API 0000-01-01、月份 00/13、null/空串 |
| 018 持久化与备份恢复 | 通过 | 备份/恢复演练（哈希一致、标记任务消失）；重启后字段不变 |
| 019 跨板读写删 404 且数据不变 | 通过 | `tasks-api.test.ts`；`check:api` 跨板三连断言 |
| 020 数据库约束与失败无部分写入 | 通过 | `migrations.test.ts`（FK/长度/枚举/日期格式）；`api-unavailable.test.ts` 锁失败回滚 |
| 021 文本边界/控制字符/零宽/emoji | 通过 | `rules.test.ts`（ZWJ 允许、NUL/零宽/BOM/RLO 拒绝）；`tasks-api.test.ts` |
| 022 错误恢复、输入保留、无自动重放、运行期异常 | 通过 | `api-client.test.ts`（超时/取消/不重放）；离线实测；运行时错误页实测。500/503 用单元测试注入，见 TASK-017 记录 |
| 023 失败态与空态区分、健康阻断、离开确认 | 通过 | 断网刷新保留 + 过期标记；开发模式（后端停止）阻断面板 + 重试；`workspace`/`home-page` 测试；丢弃确认实测 |
| 024 删除失败保留卡片与详情 | 通过 | `status-delete.test.ts`（500/404）；离线写失败保留卡片 |
| 025 双浏览器手动刷新与最后刷新时间 | 通过 | `test:e2e` 25 项中相关 5 项；内嵌浏览器第二标签页同语义 |
| 026 完整 PUT 覆盖语义与覆盖提示 | 通过 | `test:e2e`：提示 → 取消未写 → 确认后五字段等于 B 的 PUT |
| 027 外部删除后编辑/重复删除 404，不重建 | 通过 | `test:e2e`：旧表单保存提示已不存在，服务端无任务 |
| 028 慢响应不覆盖新看板 | 通过（自动化） | `workspace.test.ts` 延迟 Promise 竞态用例；浏览器级延迟注入未执行 |
| 029 360/768/1366 双浏览器核心操作 | 部分通过 | Edge 156 完成建板→建任务→编辑→状态→删除并验 360/768/1366 + 滚动提示；内嵌 Chromium 146 同样实测；**Google Chrome 本机未安装**，待课程机 `E2E_BROWSER=chrome npm run test:e2e` 补验 |
| 030 键盘可用性与焦点管理 | 部分通过 | Edge 实测：Esc 关闭并恢复焦点、删除默认焦点取消、回车不误删、键盘输入 + 回车提交建任务、标签齐备、状态/逾期含文字；Chrome 品牌项同上待补 |
| 031 错误码/正文限制/泄漏 | 通过 | `check:api` 20 项错误断言 + `api-security`/`error-contract`/`media-type`/`body-limit` 测试 |
| 032 SQL 注入形态按文本 | 通过 | `check:api`、`api-security.test.ts` |
| 033 XSS 纯文本渲染 | 通过 | Edge 实测（无脚本节点、无弹窗）+ API 原文保存 |
| 034 伪造受保护字段/未知输入/非法 UUID | 通过 | `check:api`、`api-security.test.ts`（含 `boardId` 不能改归属） |
| 035 默认回环/Host 校验/同源与代理 | 通过 | `check:api` Host 403；生产同源；开发代理 5173→3000 实测 200 |
| 036 健康与日志/响应头/忽略清单 | 通过 | `check:api` 头部断言；`logger.test.ts` 脱敏；`.gitignore` 排除 `.env`/`data/`；health 503 真实反映不可读 |
| 037 迁移/种子幂等与演示重置分离 | 通过 | `migrations.test.ts`（缺号/重号/校验和）；`db:demo` 幂等；`db:reset-demo` 默认确认且拒绝非 demo 文件名 |
| 038 干净检出安装启动 | 通过 | `/tmp/team-plan-clean`：`npm ci` → build → `db:init` → 生产启动 → 浏览器建板建任务 → 刷新后仍在 |
| 039 构建后单服务演示与深链 | 通过 | `check:api`（深链 HTML、未知 `/api` JSON 404）；Edge 深链刷新 |
| 040 启动失败分类 | 通过 | `config.test.ts`/`startup.test.ts`/`migrations.test.ts`；运行期数据库不可读 → health 503，写锁 → 503 |
| 041 非作者按 README 执行测试/构建/回归 | 通过 | 本记录所有命令；README 记录命令、Node/浏览器版本与锁文件 |
| 042 第一次真实联调 | 通过 | [TASK-015-first-integration.md](TASK-015-first-integration.md) |
| 043 演示规模观察与干净环境复演 | 通过 | 规模：10 板/200 任务/4 会话（首卡 195–393 ms）；干净检出复演；不将观察值当生产承诺 |

**核心门禁结论：CHECK-001～043 中 41 项通过、2 项（029、030）为「Edge/Chromium 通过、Chrome 品牌待补验」。**

## 选做范围

M4（REQ-016～019：优先级、筛选、拖拽、分享）**未选择、未实施**：契约、数据库结构、界面和 CHECK-044～057
均保持未勾选，符合 spec §11「未选做不影响核心通过，也不得勾为已通过」。功能开关仍为全 0，
健康响应四开关为 false，交付范围与 README 描述一致。

## 发现并修复的缺陷（本轮）

| 编号 | 缺陷 | 影响 | 修复 |
| --- | --- | --- | --- |
| D-1 | 空态引导建板后不跳转，页面停在「正在打开看板」 | REQ-001「创建成功后主动选中新看板」在空库场景失效 | `08f8df3`；新增 `home-page.test.ts` 回归（修复前该测试失败） |
| D-2 | 侧栏与引导渲染同一表单，出现重复 DOM id | REQ-013 标签/焦点归属错误，测试定位歧义 | `08f8df3`（`inputId` 属性） |
| D-3 | 覆盖提示只在打开表单瞬间比较一次，编辑期间他人保存不提示 | REQ-006 覆盖提示不完整 | `08f8df3`（保存前实时比对 `updatedAt`） |
| D-4 | 请求体为 JSON `null` 时被当作空对象，返回 422 而非 400 | spec §9.1 顶层 null 应 400 | `e50a977`（`json-body.ts`） |

## 已知限制与残留项

1. **Chrome 品牌浏览器未验证**（本机未安装）；Edge 与 Chromium 内核已验，补齐命令：
   `E2E_BROWSER=chrome npm run test:e2e`，并在本记录补记版本与结果。
2. CHECK-028 的浏览器级延迟注入未执行，证据为自动化竞态测试；如需浏览器级证据，可在代理层注入延迟后重跑。
3. 500/503/超时的浏览器级注入未执行（同上）。
4. P0 固有限制（与 spec 一致，不算缺陷）：完整 PUT 覆盖、无实时同步、无分页、SQLite 单实例写串行、
   客户端 10 秒超时后需人工刷新查证。
5. TASK-035（C：最终打包与发布标签）尚未执行；本记录覆盖的是候选提交的核心回归。