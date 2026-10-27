# 候选交付与独立复验（历史记录）

记录日期：2026-10-27。本页对应 `b53e7d2` 候选包交付阶段；后续已完成受密码保护的公网部署及生产依赖修复，最新状态见 [公网部署记录](../deploy/DEPLOYMENT.md)。S5 未选择，组员独立人工验收未执行，按用户决定不阻塞公网演示。

## 本轮实际验证

源码基线为 `fa401f4`，本轮改动为浏览器启动器修复、隔离浏览器回归、隐藏检出目录下的 SPA 深链接修复与打包工具；完整候选提交由交付包内 `package-manifest.json` 的 `sourceCommit` 固定。

| 检查 | 本轮结果 |
| --- | --- |
| `npm ci` | 按锁文件安装成功；Windows、Node 24.18.0、npm 11.16.0 |
| `npm test` | shared 16 + backend 113 + frontend 59 = 188 项通过（初轮 186 项，后新增 2 项 SPA 目录回归） |
| `npm run typecheck` / `npm run check:api` | 三包类型、完整生产构建和 50/50 API 回归通过 |
| `npm run test:e2e:launcher` | 5/5；指定浏览器失败不允许更换浏览器冒充通过 |
| 既有双浏览器 E2E | Chrome for Testing 156.0.8078.47 + Edge 156.0.4314.42，22/22 通过 |
| 两浏览器分别在 1366/768/360 CSS 像素操作 | 每个尺寸实际建板、建任务、编辑、改状态、删除；长文本、逾期文字、三列与滚动提示通过 |
| 两浏览器键盘操作 | Tab 到新建、回车提交、正反向焦点环绕、Esc 关闭并恢复焦点、删除确认默认取消通过 |
| 浏览器 HTTP 故障注入 | 422/500/503、超过 10 秒不响应、已落库但响应丢失：保留输入、恢复保存按钮、不自动重放、恢复后人工重试或刷新查证通过 |
| 真实请求慢响应切板 | 延迟 A 的真实任务响应，先显示 B，释放 A 后仍只显示 B；切回 A 正常 |

浏览器结果：[browser-results.json](browser-results.json)。截图：[Chrome 360](screenshots/release-chrome-360.png)、[Edge 1366](screenshots/release-msedge-1366.png)。

Chrome 使用 Google 官方 [Chrome for Testing Stable](https://googlechromelabs.github.io/chrome-for-testing/)，便携启动，无需安装到系统。它是完整 Chrome 测试浏览器；本轮自动化不能代替组员在课程机上的人工独立验收。HTTP 错误在浏览器测试上下文中注入；正常读写、响应丢失前的实际保存和慢响应读取均使用真实后端与临时 SQLite，不是模拟完整应用。

本轮先复现再修复两个测试脚本问题：Chrome 启动失败会静默回退 Edge；空数据库存在侧栏与引导两个同名建板按钮，旧 E2E 定位歧义。新增启动器测试在修复前为 1 通过/1 失败，修复后 5 项通过。新脚本首轮在首页默认跳板完成前输入导致失败，已明确等待路由与任务区就绪，完整场景复跑通过。

首个 ZIP 的解压复演额外发现交付缺陷：目录位于 `.artifacts` 等隐藏路径时，绝对路径 `sendFile` 触发点文件规则，深链接 404，API 回归为 49/50。最小测试确认普通目录通过、隐藏目录失败；修复为在明确的静态根内发送固定 `index.html`，继续保留公共目录中点文件的保护和未知 API 的 JSON 404。新增 2 项普通/隐藏目录真实 HTTP 回归，修复后均通过。早期候选 `7037183` 已失效，使用后续修复提交的候选包。

## 复跑浏览器检查

先运行 `npm ci` 和 `npm run build`。安装了 Chrome/Edge 的 Windows 机器：

```powershell
$env:E2E_BROWSER_A = 'chrome'
$env:E2E_BROWSER_B = 'msedge'
npm run test:e2e:launcher
npm run check:browser
```

便携 Chrome 可另设 `$env:E2E_EXECUTABLE_A = 'C:\path\to\chrome.exe'`。每个实例也支持 `E2E_EXECUTABLE_B`；没有显式路径时按 channel 启动，失败直接报错。保留原 `E2E_BROWSER` 同时选择两实例的用法。

`check:browser` 自动启动构建后的生产服务，选择空闲回环端口、创建并清理临时 SQLite，不接触现有 `data/`。结果和截图在 `.artifacts/release-check/`，可用 `E2E_OUTPUT_DIR` 指定目录。错误与超时为测试故障夹具，不修改业务服务。正常结束会关闭测试浏览器和服务。

## 生成和打开候选包

```powershell
# 源码先提交；打包命令拒绝脏工作区并重新构建
npm run package:candidate
```

输出在 `.artifacts/releases/`：ZIP、SHA256 校验文件。包内包含固定提交的源码、锁文件、迁移、文档、测试与构建产物，以及逐文件 SHA256 清单；排除 `.git`、`.env`、本地数据库、`node_modules`、浏览器二进制和临时测试输出。

将包解压到可写目录后，在包含 `package.json` 的目录执行：

```powershell
npm ci
Copy-Item .env.example .env  # 新解压目录首次执行；已有配置勿覆盖
npm run db:init
npm run build
npm start
```

打开 `http://127.0.0.1:3000`。需要本机 Node/npm 与安装依赖时的网络访问；本包不是包含 Node 和所有依赖的离线安装器。现有数据库备份/恢复仍按 README 停服操作。

## 交付前仍需完成

- C 复验 S1、D 复验 S2、A 复验 S3、B 复验 S4；记录实际人员、课程机环境、候选提交、原 CHECK 和结论。
- CHECK-029/030 已补齐 Chrome/Edge 自动化技术证据，保持未勾选直到人工独立复验；其他历史勾选也不等于团队已签署验收。
- CHECK-058、正式发布标签和对外发布保持待办；本包始终标识为 candidate。
- 该候选阶段的锁文件审计为 10 项（4 moderate、4 high、2 critical），当时未升级。后续公网部署已更新 Vue 和 body-parser，部署时生产依赖审计为 0 项；开发工具审计项没有列为已修复，详见 [部署记录](../deploy/DEPLOYMENT.md)。
