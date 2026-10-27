# 公网部署记录

**已上线：<https://tboard.bigdogaaa.cn/>**。启用时间：2026-10-27 21:35（北京时间）。用户已明确不等待组员独立复验，本次不宣称其已执行。

| 项 | 实际值 |
| --- | --- |
| 部署源码 | `2de2cde136b6b93c4b4f02f6f6533ac4b2f6df01` |
| 部署包 SHA256 | `20a70be99f45bf0cd9e2a5764598ad72f35c64d356d212570974ab93a063ca07`（服务器传输后核对一致） |
| 服务器 | `49.232.195.47`，Linux，Node 24.9.0、npm 11.6.0、Nginx 1.28.3 |
| 代码入口 | `/opt/team-task-board/current` → `/opt/team-task-board/releases/2de2cde136b6b93c4b4f02f6f6533ac4b2f6df01` |
| 服务/监听 | `team-task-board.service`：active、enabled；仅 `127.0.0.1:4100` |
| 数据库 | `/var/lib/team-task-board/team-plan.sqlite`，teamboard:teamboard、0600；初始四成员、空工作区 |
| 访问边界 | Nginx 全站 Basic Auth，账号 `team`；页面、资源、API 均保护，持有密码者均可编辑 |
| TLS | SAN 匹配 `tboard.bigdogaaa.cn`，有效到 2027-01-25 18:59:59（北京时间），私钥 root:root、0600 |
| 口令权限 | 交付文件 root:root、0600；Nginx 哈希文件 root:www-data、0640；明文未写入 Git 或报告 |
| 部署备份 | `/var/backups/team-task-board/deployment-20261027T133532Z/` |
| 数据定时备份 | `team-task-board-backup.timer` enabled，每天北京时间 02:30 后五分钟内执行 |
| 首次在线备份 | 成功；`/var/backups/team-task-board/database/team-plan-20261027T133535411935Z.sqlite`，完整性为 ok |

## 实际检查

- 本轮本地 188 项业务测试、typecheck、build 通过，Vue/SSR 与 body-parser 的生产依赖审计项已处理，`npm audit --omit=dev` 为 0。
- 服务器以 ubuntu 普通账户安装 134 个 Linux 运行依赖，生产审计 0 项；`node scripts/http-regression.mjs` 使用临时 SQLite，50/50 通过。该检查在 `928a692` 暂存版本执行；最终 `2de2cde` 仅调整部署脚本/记录，应用代码与锁文件相同，并经 `cmp` 核对后复用该批运行依赖。
- 最终站点公网检查 **12/12 通过**：匿名页面/API/深链接与匿名写入为 401，错误密码为 401；正确凭据访问首页/资源/健康/成员/看板成功；未知 API 为 JSON 404；HTTP 308 保留路径与查询；真实 Edge 浏览器成功加载空工作区，无运行期错误。
- 公网检查未新增业务看板或任务；匿名写入被拦截后数据库看板数仍为 0。
- 发布后主站/Fieldnotes/OpenCode 为 **200/200/302**，与发布前一致；独立配置未改写这些站点。
- 最后 `nginx -t` 成功，服务及备份 timer 均 enabled；数据库和秘密不在前端静态目录。三个暂存目录中的私钥副本已删除，用户原始 ZIP 保留。

公网检查详情：[public-deployment-checks.json](../verification/public-deployment-checks.json)。

![实际公网工作区](../verification/screenshots/public-desktop-20261027.png)

## 本轮失败与修正

1. 首次 Windows Git archive 导出 CRLF shell 文件，被 Linux `bash -n` 在激活前拦截；新增 deploy 文件的 LF 属性后重新打包，包内无 CR 字节。
2. 首次激活在 Nginx 热重载后立即校验 HTTPS，命中过渡期旧 worker 的默认证书；脚本成功自动回退，原站点状态一致。增加有限重试且保留 TLS 验证后，第 2 次探测取得正确域名证书和 401 保护页，上线成功。
3. 本地口令交付目录的 ACL 处理曾造成所有者读取失败；自动审批拒绝额外向 SYSTEM/管理员授权后，采用仅恢复现有文件所有者权限的方案，随后公网登录检查成功。未增加其他访问主体，也未显示明文口令。

证书不自动续签，操作方式见 [README](README.md)。后续更新使用新固定提交；不覆盖 `/var/lib` 持久库，不自动重置口令。
