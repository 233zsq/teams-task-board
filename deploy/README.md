# 小组公网演示部署

用户于 2026-10-27 确认继续部署，组员独立复验不作为本次上线前置条件；未执行的人工复验仍保留原状态。公网方案为 HTTPS + Nginx 整站统一密码 + 单个 Node 进程 + SQLite，不增加个人账号、按用户权限或只读分享。

## 当前目标与边界

- 域名：`tboard.bigdogaaa.cn`，DNSPod 已有 A 记录指向 `49.232.195.47`，腾讯云已有对应已签发证书；此次沿用，不修改其他域名。
- Nginx 对该域名所有页面、静态资源和 API 要求 Basic Auth；HTTP 仅重定向 HTTPS。
- 应用仅监听 `127.0.0.1:4100`，使用 `ALLOWED_HOSTS`；Nginx 在完成密码检查后移除上游 Authorization 头。
- 持有统一密码者均可编辑整个工作区；这是小组演示入口，不提供个人隔离。P2 分享和所有 P1 扩展保持关闭。
- `npm audit --omit=dev` 在本轮 Vue 3.5.44、body-parser 2.4.0 更新后为 0 项；开发依赖仍有审计项，生产安装使用 `npm ci --omit=dev`。

## 服务器布局

| 内容 | 路径 |
| --- | --- |
| 不可写代码版本与当前入口 | `/opt/team-task-board/releases/<commit>`、`/opt/team-task-board/current` |
| 服务账号 | `teamboard`，system user、nologin、无 sudo |
| 持久数据库 | `/var/lib/team-task-board/team-plan.sqlite` |
| 非秘密运行参数 | `/etc/team-task-board/runtime.env` |
| 站点访问密码哈希 | `/etc/team-task-board/users.htpasswd`（root:www-data，0640） |
| 初始账号密码交付文件 | `/etc/team-task-board/access.txt`（root，0600；不入仓库） |
| TLS 证书和密钥 | `/etc/team-task-board/tls/`；私钥 root，0600 |
| 独立 Nginx 配置 | `/etc/nginx/conf.d/team-task-board.conf` |
| 运行与备份单元 | `team-task-board.service`、`team-task-board-backup.service/.timer` |
| 部署回退材料 | `/var/backups/team-task-board/deployment-<UTC时间>/`（root，0700） |
| 一致性在线数据库备份 | `/var/backups/team-task-board/database/`（root，0700） |

定时备份在每天北京时间 02:30 后五分钟内执行，采用 SQLite backup API 获取一致快照，校验完整性后原子替换临时文件；不复制写入中的裸数据库，也不自动删除历史备份。

## 发布步骤

1. 本地执行业务测试、类型检查、生产构建和生产依赖审计，固定源码提交。
2. 将固定提交的源码和本轮构建产物传到独立暂存目录 `/home/ubuntu/team-task-board-stage-<commit>/app`；不传 `.env`、数据库、Windows node_modules 或 `.git`。
3. 在服务器以普通 `ubuntu` 身份执行 `npm ci --omit=dev`，取得适合服务器 Linux/Node 的 better-sqlite3；直接运行 `node scripts/http-regression.mjs`，用临时库验证真实服务器 API。
4. 将该域名证书放在暂存目录 `tls/fullchain.pem`、`tls/privkey.pem`，目录仅当前操作者可读。
5. 在服务器执行：

```bash
sudo bash /home/ubuntu/team-task-board-stage-<commit>/app/deploy/activate.sh \
  /home/ubuntu/team-task-board-stage-<commit> tboard.bigdogaaa.cn 4100
```

激活脚本校验证书域名/有效期/公私钥匹配，备份本项目旧配置，安装隔离服务，幂等初始化数据库；先检查回环健康，再执行 `nginx -t` 和 reload。失败时恢复本项目旧入口和 Nginx 配置；其他网站的配置文件不改写。不会清除持久数据库或重置已有访问密码。

## 必要上线检查

- 无密码访问页面及 API：401；错误密码仍 401，不能直接绕过静态资源进入 API。
- 正确密码访问首页、深链接、健康、成员和看板列表正常；未知 API 返回 JSON 404。
- HTTP → HTTPS；外部 TLS 域名和证书链正确。
- 后端端口仅回环监听，服务 enabled/active；在线备份能执行且 SQLite 完整性为 ok。
- 原主站/Fieldnotes/OpenCode 与发布前状态一致。

生产口令通过单独本地凭据文件交付，仓库、日志、报告和命令参数不记录明文。测试使用内存中的 Authorization，不在 URL 放账号密码。

## 升级、回退和恢复

升级使用新提交的新目录；数据库始终位于 `/var/lib`，不跟随源码版本切换。保留部署前备份；迁移仍只追加，数据库结构有不兼容变化时不得仅切旧代码，需先制定恢复步骤。

本次 P0 schema 未变时，可使用部署备份记录的 `previous-release.txt` 回指旧入口，恢复该备份内本项目的 `nginx.conf`、`runtime-config`、`service`，`systemctl daemon-reload` 后重启本应用，执行 `nginx -t` 再 reload。

数据库恢复需先停 `team-task-board`，保留故障库后由 root 复制指定已验证备份到固定数据库路径，恢复 `teamboard:teamboard`、0600，再启动并检查；不自动降级数据库结构。

证书为现有腾讯云证书，本脚本不自动续签。到期前下载新的同域名证书并在新发布暂存目录提供，或单独替换该项目 TLS 文件、验证 `nginx -t` 后 reload；不修改其他站点证书。

参考：[Nginx Basic Auth](https://nginx.org/en/docs/http/ngx_http_auth_basic_module.html)、[Nginx 反向代理](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)。实际部署提交、检查结果和证书到期时间写入 [DEPLOYMENT.md](DEPLOYMENT.md)。
