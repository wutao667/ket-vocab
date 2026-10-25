# KET 词匣同步后端

零第三方依赖的 Node.js 同步服务，使用 Node 24 内置 `node:http`、`node:crypto` 和 `node:sqlite`。服务只监听 `127.0.0.1`，默认端口为 `3117`。

## 启动

```bash
node server/sync/server.mjs
```

首次启动会创建数据库目录和表。默认目录权限为 `0700`，数据库主文件权限为 `0600`。

环境变量：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `KET_SYNC_DB` | `/var/lib/ket-sync/ket-sync.sqlite3` | SQLite 数据库路径；测试时可指向临时文件 |
| `KET_SYNC_PORT` | `3117` | 监听端口 |
| `KET_SYNC_ORIGIN` | `https://ket.huaguo.site` | 允许的浏览器写请求 Origin |

开发环境示例：

```bash
KET_SYNC_DB=/tmp/ket-sync-dev.sqlite3 KET_SYNC_PORT=43117 node server/sync/server.mjs
```

运行测试：

```bash
node --test server/sync/
```

`package.json` 和 `test-runner.mjs` 仅用于让上述 Node 24 目录测试命令可直接执行，不包含或安装依赖。

## 接口速查

所有响应均为 UTF-8 JSON（`204` 除外），并带有 `Cache-Control: no-store`。错误结构统一为：

```json
{ "error": { "code": "ERROR_CODE", "message": "description", "retryable": false } }
```

| 方法 | 路径 | 认证 | 用途 |
|---|---|---:|---|
| `GET` | `/api/v1/health` | 否 | 健康检查 |
| `POST` | `/api/v1/auth/lookup` | 否 | 规范化用户名并查询是否存在，不创建账号 |
| `POST` | `/api/v1/auth/login` | 否 | 按明确的 `create` 标志登录或创建账号 |
| `GET` | `/api/v1/auth/session` | 是 | 获取当前用户与 cursor |
| `POST` | `/api/v1/auth/logout` | 否 | 删除当前会话并清除 Cookie |
| `GET` | `/api/v1/sync/snapshot` | 是 | 获取列表、列表墓碑和当前收藏的完整快照 |
| `POST` | `/api/v1/sync` | 是 | 提交操作并拉取 cursor 之后的增量变更 |

认证 Cookie 名为 `ket_session`，属性为 `HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=2592000`。数据库只保存 token 的 SHA-256 摘要，会话在每次已认证请求时滑动续期 30 天。

同步请求最多包含 100 个操作，请求体上限 256 KiB，单页最多返回 500 条 changes。支持的操作只有：

- `list.create`
- `list.rename`
- `list.delete`
- `list.vocab.set`
- `favorite.set`

列表名称、列表词条和收藏分别使用独立冲突域。服务端接收顺序（全局 `seq`）决定同域胜负，不使用 `clientTime` 决定覆盖。列表删除后不能复活；被拒操作仍分配 seq 并进入 changes。`(user_id, op_id)` 唯一约束保证重试幂等。

## 数据与运维说明

- SQLite 启用 `foreign_keys=ON`、WAL、`synchronous=NORMAL` 和 5 秒 busy timeout。
- 墓碑保存在状态表内，不依赖 operations 日志。
- `user_sync_state.min_cursor` 已用于 `CURSOR_EXPIRED` 判定。当前版本不自动清理 180 天前的 operations；将来增加清理任务时，应先按用户推进 `min_cursor`，再删除旧日志。
- 写请求按客户端 IP 每分钟限制 60 次。服务只监听 loopback，并使用反向代理传入的首个 `X-Forwarded-For` 地址作为限流键。
- 浏览器写请求必须携带正确 Origin；无 Origin 的本机 curl/服务端调用可用。
