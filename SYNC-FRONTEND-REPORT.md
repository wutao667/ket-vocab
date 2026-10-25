# KET 词匣前端接入同步（第二轮）验收报告

日期：2026-10-25（Asia/Shanghai）

## 结论

前端已接入纯用户名登录、本地优先写入、IndexedDB v3、双向增量同步、账号隔离、离线启动、legacy 数据迁移提示与同步状态 UI。未部署，未修改生产配置、`src/data/vocab.json`、`server/sync/` 或系统服务。

最终自动验证：类型检查、42 个测试和 lint 均通过；Vite 构建成功。使用临时 SQLite 后端与 Vite dev proxy 完成了真实 HTTP 全链路联调。当前环境没有 Chromium/Playwright，因此无法做真实图形浏览器点击和浏览器网络面板断网回归；相关逻辑由单元/SSR 测试覆盖，但验收第 10、18 项据此标为“部分通过”，不伪报为完整浏览器实测。

## 构建与自动测试证据

在 `app/` 执行：

```text
$ npx tsc --noEmit
退出码 0，无输出

$ npm test
Test Files  13 passed (13)
Tests       42 passed (42)
Duration    1.39s

$ npm run lint
> eslint src
退出码 0，0 error

$ npx vite build
✓ 1632 modules transformed.
dist/index.html                   0.46 kB │ gzip:   0.31 kB
dist/assets/index-DEqRbJ-D.css   20.41 kB │ gzip:   4.77 kB
dist/assets/index-R26-QWU7.js   808.58 kB │ gzip: 230.31 kB
✓ built in 3.14s
```

`dist/` 磁盘占用为 824 KiB。JS 有 Vite 的大于 500 KiB 警告，但构建成功。

新增测试覆盖：

- v2 数据库原样升级到 v3，旧列表与旧收藏仍在，6 个 store 全部存在；
- repository 本地投影与 `pendingOps` 同事务写入；
- applied 结果删除队列、远端 changes 落地、cursor 更新；
- 退避基准序列、±20% 抖动和 5 分钟封顶；
- SHA-256 migration opId 的稳定性与账号隔离；
- 无本地登录态路由守卫，以及有本地登录态时不请求服务器即可启动；
- 6 种同步状态文案。

原有 34 个测试全部保留并通过；新增 8 个，共 42 个。

## 真实前后端联调证据

启动命令（测试后已停止）：

```bash
KET_SYNC_DB=/tmp/ket-sync-frontend-round2.sqlite3 \
KET_SYNC_ORIGIN=http://localhost:5173 \
node server/sync/server.mjs

cd app && npx vite --host 127.0.0.1
```

所有 API 均请求 `http://localhost:5173/api/...`，即经过 Vite proxy；写请求带 `Origin: http://localhost:5173`。结果摘要：

```text
GET /api/v1/health → {"ok":true}
lookup("前端联调用户") → exists:false（未建号）
login(create:true, device-a) → 201, created:true, Set-Cookie: ket_session=...; Secure; SameSite=Strict
snapshot(device-a) → cursor:0, lists:[], favorites:[]
login(create:false, device-b) → 200, created:false（同一 userId）

device-a list.create → applied seq:1
device-b snapshot → “联调列表”，ket-0001/ket-0002
device-a list.rename + favorite.set → applied seq:2/3
device-b cursor=1 增量拉取 → 收到 rename 与 favorite 两条 changes，cursor:3
device-a list.delete → applied seq:4
device-b snapshot → 同一列表 deletedAt 非空，收藏 ket-0002 present:true

新建“隔离账号” → 不同 userId
该账号 snapshot → cursor:0, lists:[], favorites:[]
```

这同时验证了开发 Origin 配置、同源代理、Secure session cookie 在 localhost curl 联调中的传递、两设备同账号、改名、删除墓碑、收藏及账号隔离。

## 18 条验收结果

| # | 结果 | 证据 |
|---|---|---|
| 1 | 通过 | `npx vite build` 成功；产物 824 KiB，文件大小见上。 |
| 2 | 通过 | `npx tsc --noEmit` 退出码 0。 |
| 3 | 通过 | 13 files / 42 tests；原 34 个全部保留。 |
| 4 | 通过 | `npm run lint` 退出码 0，0 error。 |
| 5 | 通过 | `engine.test.ts` 真实建立 v2 DB、写旧记录、升 v3 后断言旧记录与新 store。upgrade 只创建缺失 store。 |
| 6 | 通过 | App 路由守卫测试从 `/lists/private` 无本地态只能渲染登录页，并导航至 `/login`。 |
| 7 | 通过 | UI 先 lookup，再显示“将创建新账号…/这是新账号，数据为空”，确认按钮才调用 `login(create=true)`；curl 证明 lookup 不建号、确认登录才返回 201。 |
| 8 | 通过 | 登录后取 snapshot、应用到账号投影再进入 `/`；真实 cookie snapshot 联调成功。 |
| 9 | 通过 | 单元测试断言列表立即存在且队列有 `list.create`；同步结果测试断言 applied 后队列为 0。真实 API create 也得到 seq:1。 |
| 10 | 部分通过 | repository 事务和网络失败不回滚设计已测试，离线/退避状态有实现；当前环境无可用图形浏览器，未完成浏览器 DevTools 真断网→恢复网络的端到端点击实测。 |
| 11 | 通过（自动化） | SSR 路由测试预置 `ket-active-profile` 且无服务端会话，直接渲染应用首页与离线用户名；启动路径没有 session API 前置校验。 |
| 12 | 通过 | 两个独立 cookie jar 以同一用户名登录；B snapshot 看到 A 创建的数据。 |
| 13 | 通过 | A 改名 seq:2；B 从 cursor 1 拉到 rename change 与新名称。 |
| 14 | 通过 | A 删除 seq:4；B snapshot 收到 `deletedAt` 墓碑，客户端读取会过滤。 |
| 15 | 通过 | A 收藏 ket-0002 seq:3；B 增量和 snapshot 均收到 present:true。 |
| 16 | 通过 | 新账号得到不同 userId 且 snapshot 为空；本地读取按 active profile 过滤，直接列表 URL也校验 profile。离线切换标记 `needsOnlineLogin`，恢复网络先重建目标账号 cookie 再同步，避免前一账号会话串用。 |
| 17 | 通过 | `SyncStatus.test.tsx` 覆盖已同步、待同步、同步中、离线、登录暂停、拒绝错误文案。 |
| 18 | 部分通过 | 选词/学习/背诵/生词本原 34 个测试全部通过，TTS 未改；未执行真实图形浏览器的全页面人工操作回归。 |

## IndexedDB v3 迁移方案

- `DB_VERSION` 从 2 升到 3；`PROFILE_ID='default'` 以 `LEGACY_PROFILE_ID` 保留，不再是登录用户的业务默认值。
- upgrade 不删除、不清空、不重建既有 `lists`、`selections`、`favorites`；只补建 `pendingOps`、`syncMeta`、`listVocab` 及指定索引。
- v2 记录缺少 `deletedAt/present/syncState` 时按“仍可见”兼容读取，不需要破坏性回填。
- 首次在线登录先应用服务端 snapshot。检测到 legacy 数据时显示列表/收藏计数：云端为空则询问上传，云端有数据则询问无删除合并。
- 用户确认后复制到 userId 投影并入队，legacy 原记录不删除。迁移列表 ID 由用户与 legacy key 的稳定哈希派生；opId 为 `SHA-256("migration-v1\\0" + userId + kind + legacyKey)`。完成后写 `migrationVersion=1`。
- 临时选择按当前 profile 留在本机，始终不创建同步操作。

## 同步引擎与状态机

正常路径为 `local-only → syncing → synced`；异常状态为 `offline`、`retry-wait`、`auth-paused`、`permanent-error`。

每轮取当前账号已到期操作，按 `createdAt` 排序且最多 50 条。请求成功后在一个事务中删除 applied/duplicate/rejected（rejected 进入可见错误列表）、按 seq 应用 changes、更新 cursor，再按创建顺序重放所有未确认操作，防止远端投影盖掉乐观本地值。`hasMore=true` 时下一次请求发送空 operations 继续拉取。`CURSOR_EXPIRED` 会取 snapshot，应用后同样重放 pending。

网络/可重试失败使用 `1s, 2s, 5s, 10s, 30s, 60s`，此后指数增长并封顶 5 分钟，每次 ±20% 抖动；只增加本次实际尝试操作的 attemptCount。401 进入 `auth-paused`，不清登录态、不回滚本地更改。触发源为登录成功、应用启动、visible、online、本地更改 500ms debounce、60 秒轮询和手动按钮。Web Locks key 为 `ket-sync:${profileId}`。

## 已知缺陷与未完成项

1. 当前执行环境没有 Chromium/Chrome、Playwright 或 Puppeteer；已用 curl 经过真实 Vite proxy 完成协议链路，但第 10、18 项缺少真实图形浏览器点击和断网面板证据。
2. rejected 错误列表目前只存在当前页面内存；刷新后不会保留历史拒绝详情。pending 队列和本地数据本身会持久化。
3. legacy 迁移采用 MVP 的一次确认合并；没有提供逐列表选择或迁移预览。用户拒绝迁移时不写 migrationVersion，因此以后登录仍会再次询问。
4. 单个 JS chunk 为 808.58 kB（gzip 230.31 kB），Vite 给出 chunk size warning；不影响本轮功能，但第三轮应做路由级拆包。
5. 本轮不包含 Service Worker/PWA 静态资源缓存。断网刷新能依赖本地登录态与 IndexedDB，但只有页面资源已在浏览器 HTTP cache 中时才有机会加载；完整“首次离线打开”属于第三轮。

## 第三轮 PWA 与部署注意事项

- 加入带版本管理的 Service Worker/app shell 预缓存；不要缓存写 API 响应，也不要让旧 SW 长期持有旧 schema 的 bundle。
- 明确 API 与静态资源缓存策略，`/api/v1/auth/*`、`/api/v1/sync*` 使用 network-only；词库静态资产可 content-hash cache-first。
- 部署前用 HTTPS 真域名验证 Secure/Strict cookie、Caddy `/api/*` 转发、Origin=`https://ket.huaguo.site`、离线刷新和 SW 更新流程。
- 用两个独立真实浏览器 profile 做完整 UI E2E：首次/已有账号、断网创建与恢复、账号切换、cursor expired、500+ changes 分页、多标签 Web Lock。
- 为 rejected 错误增加持久化审计或可清除的本地错误 store，并评估路由懒加载以消除大 chunk 警告。
- 发布前保留 v2→v3 升级夹具，并再用生产前备份数据跑一次升级；不要提前删除 legacy `default` 数据。

## 清理

联调完成后已停止 Vite dev server 和临时同步后端。临时数据库路径为 `/tmp/ket-sync-frontend-round2.sqlite3`，未触碰生产数据库。
