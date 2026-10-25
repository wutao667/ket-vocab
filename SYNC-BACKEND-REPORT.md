# KET 词匣同步后端：第一轮验收报告

验收日期：2026-10-25（Asia/Shanghai）

结论：本轮后端已完成。实现位于 `server/sync/`，18 项测试全部通过；健康检查、两步认证、同步、快照、冲突、幂等和双用户隔离均已用临时 SQLite 数据库实测。未改动前端、Caddy、systemd 或生产目录。

## 1. 十一项验收结果

### 1. 代码组织完整：通过

实测命令：

```bash
find server/sync -maxdepth 1 -type f -printf '%f\n' | sort
```

输出：

```text
README.md
auth.mjs
auth.test.mjs
config.mjs
db.mjs
db.test.mjs
package.json
server.mjs
server.test.mjs
sync.mjs
sync.test.mjs
test-runner.mjs
validate.mjs
```

`package.json` 与 `test-runner.mjs` 是 Node 24 的目录测试入口，用于确保要求的原样命令 `node --test server/sync/` 可执行；没有依赖。

### 2. 单元及 HTTP 测试：通过（18/18）

命令：

```bash
node --test server/sync/
```

完整最终输出：

```text
✔ username normalization handles case, NFKC, and whitespace folding (5.611005ms)
✔ username normalization rejects length and illegal characters (0.842603ms)
✔ lookup reports nonexistent, existing, and invalid usernames (14.884594ms)
✔ login creates, logs into existing account idempotently, and rejects missing account (10.863152ms)
✔ database initialization creates private directory and database file (8.7297ms)
✔ custom database path does not chmod an existing parent directory (7.855359ms)
✔ snapshot supports empty state, data, favorites, and list tombstones (11.96247ms)
✔ later rename wins within the list-name conflict domain (9.074893ms)
✔ different list vocab conflict domains preserve concurrent additions (9.076125ms)
✔ delete wins and a later vocab operation is rejected but appears in changes (10.358628ms)
✔ same name with different IDs remains two lists (9.839738ms)
✔ duplicate opId returns duplicate with original seq and has no second effect (7.844928ms)
✔ incremental changes honor cursor and paginate at 500 (48.281357ms)
✔ users are isolated in snapshots and change feeds (9.916874ms)
✔ validation rejects invalid vocab IDs and overlong list names (6.789462ms)
✔ HTTP health and two-step auth flow return unified JSON (78.75245ms)
✔ HTTP layer rejects forbidden/missing browser Origin and oversized body (33.868716ms)
✔ HTTP write limiter allows 60 requests per client IP and rejects the next one (148.678527ms)
ℹ tests 18
ℹ suites 0
ℹ pass 18
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 562.145953
```

### 3. 服务启动及健康检查：通过

启动命令（独立临时数据库，不接触生产）：

```bash
KET_SYNC_DB=/tmp/ket-sync-acceptance.sqlite3 KET_SYNC_PORT=43117 node server/sync/server.mjs
```

启动输出：

```text
[ket-sync] listening on http://127.0.0.1:43117
[ket-sync] database /tmp/ket-sync-acceptance.sqlite3
```

健康检查：

```bash
curl -sS -w '\nHTTP %{http_code}\n' http://127.0.0.1:43117/api/v1/health
```

```text
{"ok":true}
HTTP 200
```

### 4. 两步认证及创建：通过

lookup 命令：

```bash
curl -sS -w '\nHTTP %{http_code}\n' \
  -H 'Content-Type: application/json' \
  -d '{"username":"验收甲用户"}' \
  http://127.0.0.1:43117/api/v1/auth/lookup
```

实际响应（lookup 没有建号）：

```text
{"exists":false,"username":"验收甲用户","userId":null}
HTTP 200
```

明确 `create=true` 后创建：

```bash
curl -sS -w '\nHTTP %{http_code}\n' -c /tmp/ket-sync-alice.cookies \
  -H 'Content-Type: application/json' \
  -d '{"username":"验收甲用户","create":true,"deviceId":"device-a"}' \
  http://127.0.0.1:43117/api/v1/auth/login
```

```text
{"userId":"usr_06Vs98Yy2gJZMRDc","username":"验收甲用户","cursor":0,"created":true}
HTTP 201
```

测试套件还实测了 `create=false` 的不存在用户返回 `409 USERNAME_NOT_FOUND`、已有用户重复登录不重复建号，以及 NFKC/大小写唯一键。

### 5. 建列表、同步和快照完整链路：通过

同步命令：

```bash
curl -sS -w '\nHTTP %{http_code}\n' -b /tmp/ket-sync-alice.cookies \
  -H 'Content-Type: application/json' \
  -d '{"protocolVersion":1,"deviceId":"device-a","cursor":0,"operations":[{"opId":"accept-create-1","kind":"list.create","entityId":"list-unit-3","payload":{"name":"Unit 3","vocabIds":["ket-0042","ket-0100"]},"clientTime":1792915100000},{"opId":"accept-favorite-1","kind":"favorite.set","entityId":"ket-0042","payload":{"present":true,"sourceListId":"list-unit-3"},"clientTime":1792915200000}]}' \
  http://127.0.0.1:43117/api/v1/sync
```

```text
{"results":[{"opId":"accept-create-1","status":"applied","seq":1},{"opId":"accept-favorite-1","status":"applied","seq":2}],"changes":[{"seq":1,"kind":"list.create","entityId":"list-unit-3","payload":{"name":"Unit 3","vocabIds":["ket-0042","ket-0100"]},"serverTime":1792891596772},{"seq":2,"kind":"favorite.set","entityId":"ket-0042","payload":{"present":true,"sourceListId":"list-unit-3"},"serverTime":1792891596772}],"cursor":2,"hasMore":false}
HTTP 200
```

快照命令：

```bash
curl -sS -w '\nHTTP %{http_code}\n' -b /tmp/ket-sync-alice.cookies \
  http://127.0.0.1:43117/api/v1/sync/snapshot
```

```text
{"protocolVersion":1,"cursor":2,"lists":[{"listId":"list-unit-3","name":"Unit 3","createdAt":1792891596772,"deletedAt":null,"vocab":[{"vocabId":"ket-0042","present":true},{"vocabId":"ket-0100","present":true}]}],"favorites":[{"vocabId":"ket-0042","present":true,"sourceListId":"list-unit-3","createdAt":1792891596772}]}
HTTP 200
```

### 6. 冲突粒度及服务端接收顺序：通过

先由 device-a 改名，再由 device-b 使用更小的 `clientTime` 后到改名。第二次响应同时返回 seq 3 和 4：

```text
{"results":[{"opId":"rename-device-a","status":"applied","seq":3}],"changes":[{"seq":3,"kind":"list.rename","entityId":"list-unit-3","payload":{"name":"A rename"},"serverTime":1792891604568}],"cursor":3,"hasMore":false}
HTTP 200
{"results":[{"opId":"rename-device-b","status":"applied","seq":4}],"changes":[{"seq":3,"kind":"list.rename","entityId":"list-unit-3","payload":{"name":"A rename"},"serverTime":1792891604568},{"seq":4,"kind":"list.rename","entityId":"list-unit-3","payload":{"name":"B rename wins"},"serverTime":1792891604578}],"cursor":4,"hasMore":false}
HTTP 200
```

最终甲用户快照中的名称为 `B rename wins`，证明胜负取决于服务端 seq，而不是 `clientTime`。测试还验证两个设备分别加不同词时两个成员都保留，以及同名不同 ID 的列表不会合并。

### 7. 删除优先及被拒操作进入 changes：通过

删除列表：

```text
{"results":[{"opId":"delete-list-1","status":"applied","seq":5}],"changes":[{"seq":5,"kind":"list.delete","entityId":"list-unit-3","payload":{},"serverTime":1792891604589}],"cursor":5,"hasMore":false}
HTTP 200
```

删除后再加词，即使使用很大的 `clientTime` 也被拒，但仍取得 seq 6 且出现在 changes：

```text
{"results":[{"opId":"add-after-delete","status":"rejected","seq":6,"code":"LIST_DELETED"}],"changes":[{"seq":6,"kind":"list.vocab.set","entityId":"list-unit-3","payload":{"vocabId":"ket-0001","present":true},"serverTime":1792891604600}],"cursor":6,"hasMore":false}
HTTP 200
```

快照保留墓碑：

```text
{"protocolVersion":1,"cursor":6,"lists":[{"listId":"list-unit-3","name":"B rename wins","createdAt":1792891596772,"deletedAt":1792891604589,"vocab":[{"vocabId":"ket-0042","present":true},{"vocabId":"ket-0100","present":true}]}],"favorites":[{"vocabId":"ket-0042","present":true,"sourceListId":"list-unit-3","createdAt":1792891596772}]}
HTTP 200
```

### 8. opId 幂等及增量分页：通过

重新提交同一个 `add-after-delete` opId：

```text
{"results":[{"opId":"add-after-delete","status":"duplicate","seq":6,"code":"LIST_DELETED"}],"changes":[],"cursor":6,"hasMore":false}
HTTP 200
```

原 seq 和原拒绝代码被保留，没有二次执行。测试套件另用 501 条真实数据库 operations 验证第一页恰好 500 条、`hasMore=true`，用新 cursor 拉取第二页得到剩余 1 条且 `hasMore=false`。

### 9. 双用户数据隔离：通过

乙用户创建并只收藏 `ket-1723`：

```text
{"userId":"usr_gstFOCa-QUp1YK6r","username":"验收乙用户","cursor":0,"created":true}
HTTP 201
{"results":[{"opId":"bob-favorite","status":"applied","seq":7}],"changes":[{"seq":7,"kind":"favorite.set","entityId":"ket-1723","payload":{"present":true},"serverTime":1792891604635}],"cursor":7,"hasMore":false}
HTTP 200
```

乙用户快照完全看不到甲用户列表和收藏：

```text
{"protocolVersion":1,"cursor":7,"lists":[],"favorites":[{"vocabId":"ket-1723","present":true,"createdAt":1792891604635}]}
HTTP 200
```

甲用户快照仍只含自己的 `list-unit-3` 和 `ket-0042`，看不到乙用户的 `ket-1723`。单元测试同时验证两用户的增量 changes 各自隔离。

### 10. 校验、安全中间件及数据库权限：通过

自动测试已覆盖：非法 `vocabId`、81 code point 列表名称和超过 256 KiB 的真实 HTTP 请求。超大请求实际返回 `413 PAYLOAD_TOO_LARGE`；非法/缺失浏览器 Origin 返回 403；所有错误使用统一结构。

实现还包括：

- `ket-0001` 至 `ket-1723` 的严格范围校验；
- 单批最多 100 operations；
- 每用户最多 200 个未删除列表；
- 写请求按代理传入的客户端 IP 每分钟 60 次；
- Cookie 只下发原始随机 token，SQLite 只存 SHA-256；
- 每次认证请求滑动续期 30 天；
- 响应统一 `Cache-Control: no-store`；
- SQLite 外键、WAL、NORMAL synchronous 和 5 秒 busy timeout；
- 新建数据库目录 `0700`、数据库文件 `0600`。

权限测试还保证自定义 `KET_SYNC_DB` 位于已有共享父目录时不会擅自 chmod 该父目录。验收后确认：

```text
1777 root:root /tmp
600 wutao:wutao /tmp/ket-sync-acceptance.sqlite3
```

### 11. 零依赖、范围控制与进程清理：通过

- `server/sync/package.json` 只有 `type`、`main`、`private`，没有 `dependencies` 或 `devDependencies`。
- `git diff -- app` 无输出，前端未修改。
- 未修改 `/etc/caddy/Caddyfile`，未调用 `systemctl`，未写 `/var/www/`。
- 验收服务通过 `SIGINT` 优雅停止；`pgrep -af '^node server/sync/server\.mjs$'` 无输出，没有遗留测试服务。
- 仓库中验收前已经存在的未跟踪文档 `SYNC-BACKEND-BRIEF.md`、`SYNC-BRIEF.md`、`SYNC-DESIGN.md`、`SYNC-OFFLINE-ANALYSIS.md`、`SYNC-OFFLINE-BRIEF.md` 均未修改。

## 2. 冲突处理实现对应关系

| 规则 | 实现位置与方式 |
|---|---|
| 全局单调 seq | `db.mjs` 的 `operations.seq INTEGER PRIMARY KEY AUTOINCREMENT`；`sync.mjs` 在应用状态前先插入 operation |
| 名称独立冲突域 | `lists.name_seq`；每次 `list.rename` 只更新名称和 `name_seq` |
| 每个列表词独立冲突域 | `list_vocab` 以 `(user_id, list_id, vocab_id)` 为主键，每行保存自己的 `changed_seq` |
| 每个收藏独立冲突域 | `favorites` 以 `(user_id, vocab_id)` 为主键，每行保存自己的 `changed_seq` |
| 后到覆盖先到 | `synchronize()` 使用 `BEGIN IMMEDIATE`，按请求中顺序插入并执行；完全不使用 `clientTime` 判断胜负 |
| 删除优先 | `applyOperation()` 在 rename/vocab.set 前检查 `lists.deleted_at`，返回并持久化 `LIST_DELETED`，不清除墓碑 |
| 被拒操作仍进入变更流 | operation 先插入取得 seq，`reject()` 再写 `result_status/result_code`；`getChanges()` 从完整 operations 流读取 |
| 重复 opId | 数据库 `UNIQUE(user_id, op_id)` 加提交前查询；重复时返回 `duplicate`、原 seq 和原拒绝代码，不再执行 |
| 同名不同 ID | 列表主键是 `(user_id, list_id)`，名称没有唯一约束或合并逻辑 |
| 墓碑独立于日志 | 删除状态在 `lists.deleted_at`；词与收藏的 present 状态在各自状态表，未来清理 operations 不丢状态 |
| cursor 过期 | `user_sync_state.min_cursor` 持久化每用户下限；请求 cursor 小于下限时返回 `409 CURSOR_EXPIRED` |

## 3. 实施中遇到的障碍与处理

1. Node v24.20.0 在此环境中执行 `node --test server/sync/` 时把目录当作待加载模块，而不会自动发现 `.test.mjs`。因此加入无依赖的目录 `package.json` 和 `test-runner.mjs`，使用户指定的命令原样通过。
2. 数据库权限复查发现，如果无条件 chmod `KET_SYNC_DB` 的已有父目录，自定义 `/tmp/file.sqlite3` 路径理论上会试图修改 `/tmp`。本机因目录归 root 所有没有发生权限变化，确认 `/tmp` 始终为 `1777`；实现已改为只 chmod 新建目录或默认 `/var/lib/ket-sync`，并增加回归测试。

## 4. 已知缺陷与未完成项

- 当前没有定时清理 180 天前的 operations 和过期 sessions。状态墓碑与 `min_cursor` 机制已就绪，因此不影响当前正确性；长期运行后数据库会增长，需要后续增加维护任务。
- IP 限流器为单进程内存状态，服务重启会清零；当前部署模型是单实例，因此满足本轮简单限流要求。
- 数据库迁移目前只有初始 schema version，没有面向未来字段变更的逐版本 ALTER 迁移器。
- 纯用户名身份按已确认方案实现；知道用户名的人可以登录并读写该账号，这是已接受的模型风险。

## 5. 第二轮前端改造注意事项

1. 启动后必须先调用 `/auth/session`；401 时强制进入登录页，不提供游客路径。
2. 新用户名必须按 lookup → 明确确认 → login(create=true) 的两步 UI；已有用户名使用 `create=false` 即可。所有 fetch 使用 `credentials: 'same-origin'`。
3. 本地应持久化稳定的 `deviceId` 和每个待提交操作的 `opId`；网络重试必须复用原 opId，不能重新生成。
4. 列表名称、每个 `(listId, vocabId)` 成员和每个 `vocabId` 收藏要独立合并。不要用整个列表的 `updatedAt` 覆盖服务端快照。
5. 收到 `LIST_DELETED` 后终止该列表 rename/vocab 操作的重试，并应用服务端墓碑；绝不能用本地草稿复活。
6. `hasMore=true` 时立即以响应中的新 cursor 再调用 `/sync`，operations 传空数组，直到 `hasMore=false`。
7. 遇到 `409 CURSOR_EXPIRED` 时丢弃旧增量基线，重新获取 snapshot，再重放仍有效且尚未确认的本地操作。
8. 只同步列表和收藏；滑动选词的临时选择继续保留在本地，不能转换为同步 operation。
9. 前端用户名规范化应与 `auth.mjs` 完全一致：NFKC、trim、空白折叠、2–32 code point、允许 Unicode 字母/数字及内部 `_`、`-`、单空格，唯一键小写。
10. 服务端时间和 seq 是同步顺序依据；`clientTime` 只作为诊断元数据，前端不能用它覆盖服务端结果。
