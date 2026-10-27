# TASK-018 API 契约与安全边界回归（CHECK-031～036）

日期：2026-10-27｜被测提交：`c077db9`｜环境见 [README](README.md)

## 一键回归脚本

```bash
npm run check:api
# 构建 shared/backend/frontend 后，用临时 SQLite 与随机端口启动真实服务，
# 逐个断言后关闭并删除临时目录。
# 输出：50/50 项通过
```

脚本：[scripts/http-regression.mjs](../scripts/http-regression.mjs)。它绕过 UI，直接覆盖以下边界。

| 类别 | 断言 | 结果 |
| --- | --- | --- |
| 健康 | 200、`status=ok`、四个开关均 false、`Cache-Control: no-store`、`nosniff`、`frame-ancestors`/`X-Frame-Options` | PASS |
| Host 白名单 | `Host: evil.example` → 403 `FORBIDDEN`，不返回业务数据 | PASS |
| 成员 | 四条、A～D 顺序、字段仅 `id/displayName` | PASS |
| 看板 | 201 + trim + 服务端 ID/时间；同名不同 ID；非法/空白/超长 422 | PASS |
| JSON 边界 | 损坏 JSON → 400；顶层数组/标量/null → 400；`__proto__` → 400；未知/受保护字段 → 400 | PASS |
| 路径/查询 | 非法 UUID → 400；合法但不存在 → 404；未知查询参数 → 400；未知方法 → 404 | PASS |
| 正文限制 | 33 KiB → 413；非 JSON 写正文 → 415；未匹配路径带 33 KiB → 404 且 `Connection: close` | PASS |
| 任务契约 | 201/默认值/`updatedAt=createdAt`；完整 PUT 刷新 `updatedAt`；缺字段 422（逐字段）；非法枚举/日期/成员 422；DELETE 204 无正文；重复 DELETE 404 | PASS |
| 跨板隔离 | 以看板 B 的 URL 访问看板 A 的任务：GET/PUT/DELETE 全部 404，数据不变 | PASS |
| 注入与转义 | SQL 注入形态名称/标题按纯文本保存，查询范围不变；错误响应与成功响应均不含 SQL/堆栈/数据库路径 | PASS |
| SPA 与 API | 深层路由返回 HTML；未知 `/api` 仍为 JSON 404 | PASS |

## 后端自动化测试（同一提交）

```bash
npm run test:backend    # 14 个文件、111 项测试通过
```

与 CHECK-031～036 直接相关的补充用例：

- `tests/api-security.test.ts`：业务路由的 Host 403、安全响应头、32 KiB、未匹配路径 `Connection: close`、
  受保护字段 400、非法 UUID 400、错误不回显用户输入、SQL 形态文本、禁止借正文改归属。
- `tests/api-unavailable.test.ts`：另一连接持有写锁时，写请求在 `busy_timeout` 后返回 503，
  且失败不留下部分写入；释放锁后同一请求成功。
- `tests/error-contract.test.ts`、`tests/media-type.test.ts`、`tests/body-limit.test.ts`、`tests/not-found.test.ts`：
  统一错误对象、415/413/400 优先级、未定义路径 404。
- `tests/logger.test.ts`：日志只记录方法/脱敏路径/状态/耗时，不记录正文、密钥或 token；
  `/api/v1/shares/:token` 与 `/share/:token` 脱敏。

## 浏览器侧（CHECK-033 / 035）

- XSS：任务标题 `<script>alert(1)</script>`、描述 `<img src=x onerror=alert(2)>` 在页面按纯文本显示，
  未生成脚本节点、无弹窗（Edge 156 实测）。
- 同源与代理：生产模式由 Express 同源提供页面与 API；开发模式 `vite:5173` 代理 `/api` 到 `127.0.0.1:3000`
  （`curl http://127.0.0.1:5173/api/v1/health` → 200）。Host 白名单只接受 `127.0.0.1`/`localhost`/`[::1]`。
- 安全头：API 响应带 `no-store`、`nosniff`、`frame-ancestors 'none'`、`X-Frame-Options: DENY`，无 `X-Powered-By`。

## 未在浏览器注入的项

500/503/超时在浏览器中的故障注入未执行（需要代理层改写响应）；这些路径由前端单元测试与本目录的服务端测试覆盖，
记录为自动化证据，不宣称浏览器级注入已验证。

## 结论

CHECK-031～036 通过；一键脚本可重复运行，无 SQL/堆栈/路径泄漏，跨板与安全边界符合 spec §9。