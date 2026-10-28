# 账号协作版部署

2026-10-28 用户增加注册登录、任务发布者和项目负责人，并明确授权删除线上原有的 1 个项目及 1 个任务。其他历史数据不得自动清除；每次部署保留升级前配置和数据库备份。独立人工复验不阻塞上线，未执行状态保持真实。

## 当前访问方式

2026-10-28 S5 升级启用 `ENABLE_PRIORITY=1`、`ENABLE_FILTERS=1`，追加 0003 并保留所有现有记录。停服快照后，在重新开放写入前比较账号、会话、项目、成员、任务及动态的全部旧行；任何旧值改变则中止并回退。`node tests/e2e/task-search.mjs --api-only` 验证服务器开启模式；原 50 项 HTTP 脚本仅验证关闭模式兼容。

- 域名 `tboard.bigdogaaa.cn`，沿用原 DNS 和 TLS，不修改其他站点。
- 登录/注册页和静态资源公开；私有 API 由应用执行个人会话、CSRF 和项目成员授权。
- 不再要求 Nginx Basic Auth。旧 `team` 统一凭据不是个人账号；旧凭据文件保留在受保护目录，不继续使用或传播。
- Node 仅监听 `127.0.0.1:4100`。Nginx 覆盖 X-Forwarded-For/Proto，应用仅信任回环代理；生产域名 Cookie 为 Secure/HttpOnly/SameSite=Strict。
- 新注册账号没有其他人的项目访问权；建立项目即为负责人，添加伙伴需其已注册用户名。
- 账号数据在 SQLite 中，备份包含密码摘要及会话摘要，须与主数据库同样保护。无邮箱/短信服务，不提供自助找回密码。

## 服务器布局

| 内容 | 路径 |
| --- | --- |
| 固定版本 / 当前入口 | `/opt/team-task-board/releases/<commit>`、`/opt/team-task-board/current` |
| 服务账号 | `teamboard`，system user、nologin、无 sudo |
| SQLite 主库 | `/var/lib/team-task-board/team-plan.sqlite`，teamboard:teamboard，0600 |
| 运行参数 | `/etc/team-task-board/runtime.env` |
| TLS | `/etc/team-task-board/tls/`，私钥 root:root、0600 |
| 独立 Nginx | `/etc/nginx/conf.d/team-task-board.conf` |
| 应用 | `team-task-board.service` |
| 每日一致备份 | `team-task-board-backup.service/.timer`，北京时间 02:30 后五分钟内 |
| 升级前配置与数据库 | `/var/backups/team-task-board/deployment-<UTC>/`，root、0700 |
| 每日数据库备份 | `/var/backups/team-task-board/database/`，root、0700 |

## 发布

1. 通过完整测试、类型、生产构建、个人账号浏览器链路和生产依赖审计，固定提交。
2. 在 `/home/ubuntu/team-task-board-stage-<commit>/app` 放固定提交源码及构建产物，不含 `.env`、数据库、Git 或 Windows 运行依赖。
3. 以 ubuntu 执行 `npm ci --omit=dev`，并执行 `node scripts/http-regression.mjs`；该脚本仅使用临时真实 SQLite。
4. 在暂存 `tls/` 中准备该域名 fullchain.pem 和 privkey.pem，仅当前操作者可读；可由 root 从本项目现有 TLS 目录复制，避免再次下载或显示私钥。
5. 运行：

```bash
sudo bash /home/ubuntu/team-task-board-stage-<commit>/app/deploy/activate.sh \
  /home/ubuntu/team-task-board-stage-<commit> tboard.bigdogaaa.cn 4100
```

脚本核对证书、版本、Linux 依赖，备份本项目配置；短暂返回 503 关闭外部写入，停服后用 SQLite backup API 保存一致数据库，再执行追加迁移和服务启动。回环健康及匿名 API 401 正常后开放新配置，核对外部 HTTPS 登录页 200、私有 API 401。失败时先停服务，再一起恢复匹配的旧代码、配置和升级前数据库；失败库另存，不能只回退代码而保留新 schema。其他站点配置不改写。

部署脚本本身不删除业务数据。用户要求的旧项目清理由独立操作按已确认 ID 在事务中完成，保留部署前备份，禁止通用自动“清空全部数据”。

## 上线检查

- 无个人会话：首页和静态资源 200，auth/me 返回 user=null，项目/成员/任务 API 401。
- 两个真实账号完成注册、登录、邀请、任务发布/分配；第三账号或非成员直接访问项目 ID 为 404。
- 无/错误 CSRF、跨源写入被拒绝；负责人管理操作不接受普通成员；生产 Cookie 有安全属性。
- HTTP 308 保留路径/查询，TLS 链和域名有效，只有回环端口；服务及备份 timer active/enabled。
- 实际公网检查使用临时合成账号，结束后仅按该检查生成的 ID 清理，保留真实用户数据。
- 原主站、Fieldnotes、OpenCode 状态与发布前相同。

## 历史项目与恢复

0002 保留所有 0001 数据，不自动将历史项目交给首位注册用户。若保留旧项目，维护人先备份，在指定用户注册后显式运行：

```bash
sudo -u teamboard env DATABASE_PATH=/var/lib/team-task-board/team-plan.sqlite \
  /usr/local/bin/node /opt/team-task-board/current/backend/dist/db/claim-legacy.js \
  <已注册用户名> --all-unowned
```

只接管尚无负责人的项目，重复执行无变化；旧任务发布者仍为未知，原任务负责人不会被伪造为新账号。

稳定上线后若需回退，先关闭外部写入并停服，保全当前故障库与新数据，再选择恢复方案；升级前库不包含上线后注册/任务，不可无视新数据直接覆盖。证书不自动续签，沿用已有腾讯云证书，到期前单独更新本项目 TLS 并检查 Nginx。

实际源码、备份和上线证据见 [DEPLOYMENT.md](DEPLOYMENT.md)。
