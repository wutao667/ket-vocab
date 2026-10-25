# KET 背单词应用跨浏览器数据同步设计

## 1. 需求理解

应用需要把背诵列表和生词收藏同步到服务端，使同一用户在不同浏览器登录后看到一致数据。 词库 1723 条只读种子数据继续随前端发布，服务端只保存列表结构、列表中的词条 ID 和收藏状态。 浏览器仍应以 IndexedDB 为即时数据源，断网时可读写；恢复网络后再自动同步。 用户名是用户可见的唯一登录名，但不能在没有第二凭据的情况下直接授予读写权限。 “更换用户名”按“切换账号”设计；账号改名是另一项能力，不应与切换账号混为一谈。

## 2. 安全方案

### 2.1 方案对比

| 方案 | 身份证明 | 实现成本 | 用户体验 | 主要风险 | 结论 |
|---|---|---:|---|---|---|
| A. 纯用户名 | 知道用户名即可 | 最低 | 首次输入一次，最省事 | 任何人输入“吴涛”即可读取、修改、删除全部数据；无法审计合法设备 | 仅适合明确接受数据公开且可被篡改的演示环境 |
| B. 用户名 + PIN/口令 | 用户名及 6 位 PIN 或短口令 | 中 | 新浏览器多输入一次；本机可保持登录 | PIN 熵低，需要限流、pepper 和安全哈希；忘记后恢复困难 | **推荐 MVP** |
| C. 用户名 + 设备令牌 | 首次签发随机 token，后续免输入 | 中 | 已登记设备顺畅 | 若只凭用户名签发首个 token，仍等同方案 A；新浏览器无法安全加入，必须扫码/恢复码/旧设备批准 | 可作为 B 的“受信设备”增强，不能单独满足任意新浏览器登录 |
| D. 邮箱魔法链接或第三方登录 | 邮箱所有权或 OAuth | 高 | 跨设备和找回体验最好 | 引入邮件/OAuth、隐私说明和外部依赖 | 用户量扩大后再做 |

### 2.2 推荐组合

MVP 采用方案 B：`用户名 + 6 位数字 PIN（最低）或 8–64 字符短口令（更推荐）`。 服务端验证成功后签发随机、不透明会话 token，并通过同源 Cookie 保存。 用户可以勾选“记住此设备”；不勾选时 Cookie 为浏览器会话级，勾选时滑动有效期 30 天、绝对上限 90 天。 这满足“输入后本地记住，下次不用重新输入”，同时避免把 PIN 长期明文保存到浏览器。
不要把 PIN、口令或长期 bearer token 放进 `localStorage`。 `localStorage` 和 IndexedDB 都能被同源 XSS 读取；二者在防 XSS 方面没有本质安全差异。 推荐会话 token 放 `Secure; HttpOnly; SameSite=Strict; Path=/api` Cookie，JavaScript 不可读取。 前端仅在 `localStorage` 保存最近使用的规范化用户名和非秘密的 `deviceId`，用于预填和诊断。 如未来实现方案 C，设备 token 仍优先使用 HttpOnly Cookie；必须由已登录设备批准或恢复码激活新设备。

### 2.3 用户名规范化

注册和登录必须调用同一规范化函数，生成不可见的 `username_key`：

```text
displayName = Unicode NFKC(input)
displayName = trim(displayName)
displayName = collapseUnicodeWhitespaceToSingleASCIIspace(displayName)
usernameKey = displayName.toLocaleLowerCase('und')
```

约束如下：

- 规范化后长度为 2–32 个 Unicode code point，而不是 UTF-16 code unit。
- 允许 Unicode 字母、Unicode 数字、下划线、连字符和单个内部空格。
- 不允许控制字符、换行、零宽字符、emoji、首尾标点和连续空格。
- 唯一性建立在 `username_key` 上；保留 `username_display` 用于界面显示。
- `WuTao`、`wutao` 和全角兼容形式视为同一用户名。
- 不试图自动合并形似字符，例如拉丁 `a` 与西里尔 `а`；界面应原样回显，避免用户误认。
- 服务端实现必须固定并测试该算法；不能依赖 SQLite `NOCASE`，因为它主要覆盖 ASCII。

用户名是登录标识而不是秘密。 外部接口以用户名定位账号，数据库内部仍使用随机 `user_id` 作外键，避免未来改名时级联重写所有数据。 这仍符合“用户名作为唯一标识区分用户”：一个规范化用户名只对应一个 `user_id`。

### 2.4 PIN/口令保存与验证

服务端不得保存明文 PIN。 使用 Node 内置 `node:crypto.scrypt`，每个用户生成 16 字节随机 salt，输出 32 字节摘要。 建议参数为 `N=32768, r=8, p=1, maxmem=64MiB`，上线前在目标主机测量登录耗时。 计算内容为 `scrypt(UTF8(pinOrPassphrase) || serverPepper, salt)`；pepper 放在权限 `0600` 的环境文件中，不进 SQLite 和仓库。 比较摘要必须使用 `timingSafeEqual`。 主机只有约 1.5GB 内存，认证哈希并发限制为 2，超出请求排队或返回 `503 AUTH_BUSY`，避免恶意并发引发 OOM。
6 位数字 PIN 只有 100 万种组合，数据库和 pepper 同时泄露后仍较弱。 因此 UI 默认推荐短口令，选择数字 PIN 时必须至少 6 位；4 位仅作为明确标注风险的兼容选项，不建议上线默认开放。 服务端按 `username_key + IP` 和 IP 两个维度限流：连续失败 5 次后指数退避，最长 15 分钟。 失败计数可持久化到 SQLite，成功登录后清除该账号维度的失败记录。 登录失败统一返回 `AUTH_INVALID`，不区分“用户不存在”和“PIN 错误”。
MVP 没有邮箱时无法可信地自动找回 PIN。 注册成功可一次性显示 128 位随机恢复码，只保存其哈希；用户若未保存，应明确告知“忘记 PIN 将无法恢复云端数据”。 恢复码登录后必须立即设置新 PIN，并撤销全部旧会话。

### 2.5 会话、轮换与 CSRF

会话 token 使用 `randomBytes(32)`，Cookie 中保存 base64url 原值，数据库只保存 SHA-256 摘要。 每次登录签发新 token；持久会话空闲 30 天失效，创建后 90 天绝对失效。 距离上次轮换超过 7 天时，在一次成功 API 响应中原子替换 token；旧 token 保留最多 60 秒宽限，处理并发标签页。 退出登录删除当前会话；“退出所有设备”删除该用户全部会话。 会话表记录 `device_id`、创建时间、最后使用时间和粗粒度客户端描述，供后续展示设备列表。
虽然 `SameSite=Strict` 已降低 CSRF 风险，所有写接口仍校验 `Origin: https://ket.huaguo.site`。 缺失 Origin 的浏览器写请求拒绝；健康检查和受控本机运维请求除外。 响应统一加 `Cache-Control: no-store`，认证响应不进入共享缓存。 设置合理 CSP 并避免 `dangerouslySetInnerHTML`，因为 XSS 仍可借用户现有会话调用 API，即使读不到 Cookie。

### 2.6 防枚举与账号切换

不提供“列出所有用户名”、用户名搜索或公开用户资料接口。 登录接口对不存在用户和错误 PIN 使用相同状态、错误码和近似响应耗时。 注册时无法完全隐藏重名事实，可返回 `USERNAME_TAKEN`；对注册接口做 IP 限流即可。 日志不得记录 PIN、Cookie、恢复码、完整请求体或完整 IP。
“更换用户名”入口文案使用“切换账号”，流程必须：

1. 先尝试推送当前账号待同步操作，最长等待 5 秒。
2. 若仍有待同步项，显示准确数量，并提供“留在此设备稍后同步”而不是静默丢弃。
3. 用户确认后退出当前会话，但保留该账号的 IndexedDB 分区和 pending queue。
4. 输入新账号用户名与 PIN；成功后把 `activeProfileId` 切到服务端返回的 `userId`。
5. 绝不把账号 A 的本地缓存自动上传到账号 B。
6. 返回账号 A 时继续使用 A 的缓存和队列；提供单独的“清除此设备上的 A 数据”操作并二次确认。

## 3. 数据模型

### 3.1 存储选型

推荐 Node 24 内置 `node:sqlite`，不安装 `sqlite3` CLI 或任何原生第三方模块。 SQLite 提供事务、唯一约束、索引、WAL、原子提交和一致性备份，数据规模远低于其能力上限。 `DatabaseSync` 是同步 API，会短暂阻塞 Node 事件循环；本项目写入小且单实例，可接受，但所有事务应短小、禁止在事务中做网络 I/O 或 scrypt。
纯 JSON 文件不推荐：并发读改写容易丢更新，崩溃时可能留下半文件，删除墓碑和增量游标难以维护，备份时也缺少一致性边界。 PostgreSQL 等独立数据库对当前单机小应用运维过重；当需要多 API 实例、复杂审计或用户量明显增长时再迁移。

### 3.2 SQLite 初始化与表结构

数据库建议放 `/var/lib/ket-sync/ket-sync.sqlite3`，目录 owner 为运行服务的 `wutao`，权限 `0700`，数据库权限 `0600`。 不要放 `/var/www/ket`，避免被静态文件服务误暴露，也避免前端发布覆盖数据。 启动时执行 `PRAGMA foreign_keys=ON`、`PRAGMA journal_mode=WAL`、`PRAGMA synchronous=NORMAL`、`PRAGMA busy_timeout=5000`。

```sql
CREATE TABLE schema_meta ( key TEXT PRIMARY KEY, value TEXT NOT NULL );
INSERT INTO schema_meta(key, value) VALUES ('schema_version', '1');
CREATE TABLE users ( user_id TEXT PRIMARY KEY, username_key TEXT NOT NULL UNIQUE, username_display TEXT NOT NULL, password_salt BLOB NOT NULL, password_hash BLOB NOT NULL, password_kind TEXT NOT NULL CHECK (password_kind IN ('pin', 'passphrase')), recovery_hash BLOB, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, disabled_at INTEGER );
CREATE UNIQUE INDEX users_username_key_uq ON users(username_key);
CREATE TABLE sessions ( session_hash BLOB PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE, device_id TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, idle_expires_at INTEGER NOT NULL, absolute_expires_at INTEGER NOT NULL, rotated_to_hash BLOB, user_agent_summary TEXT );
CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_expiry_idx ON sessions(idle_expires_at);
CREATE TABLE login_attempts ( scope_key TEXT PRIMARY KEY, failed_count INTEGER NOT NULL, first_failed_at INTEGER NOT NULL, blocked_until INTEGER NOT NULL );
CREATE TABLE lists ( user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE, list_id TEXT NOT NULL, name TEXT NOT NULL, name_seq INTEGER NOT NULL, created_at INTEGER NOT NULL, created_seq INTEGER NOT NULL, deleted_at INTEGER, deleted_seq INTEGER, PRIMARY KEY (user_id, list_id) );
CREATE INDEX lists_user_active_idx ON lists(user_id, deleted_at);
CREATE TABLE list_vocab ( user_id TEXT NOT NULL, list_id TEXT NOT NULL, vocab_id TEXT NOT NULL, present INTEGER NOT NULL CHECK (present IN (0, 1)), changed_seq INTEGER NOT NULL, changed_at INTEGER NOT NULL, PRIMARY KEY (user_id, list_id, vocab_id), FOREIGN KEY (user_id, list_id) REFERENCES lists(user_id, list_id) ON DELETE CASCADE );
CREATE INDEX list_vocab_list_present_idx ON list_vocab(user_id, list_id, present);
CREATE TABLE favorites ( user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE, vocab_id TEXT NOT NULL, present INTEGER NOT NULL CHECK (present IN (0, 1)), source_list_id TEXT, created_at INTEGER, changed_at INTEGER NOT NULL, changed_seq INTEGER NOT NULL, PRIMARY KEY (user_id, vocab_id) );
CREATE INDEX favorites_user_present_idx ON favorites(user_id, present);
CREATE TABLE operations ( seq INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE, op_id TEXT NOT NULL, device_id TEXT NOT NULL, kind TEXT NOT NULL, entity_id TEXT NOT NULL, payload_json TEXT NOT NULL, received_at INTEGER NOT NULL, UNIQUE (user_id, op_id) );
CREATE INDEX operations_user_seq_idx ON operations(user_id, seq);
CREATE INDEX operations_received_idx ON operations(received_at);
CREATE TABLE devices ( user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE, device_id TEXT NOT NULL, last_ack_seq INTEGER NOT NULL DEFAULT 0, last_seen_at INTEGER NOT NULL, PRIMARY KEY (user_id, device_id) );
```

`present=0` 和 `deleted_seq` 是持久墓碑，不能随操作日志一起删除，否则离线旧设备会让已删除数据“复活”。 服务端只接受 `ket-0001` 到 `ket-1723` 范围内的 `vocab_id`。 名称规范为 trim 后 1–80 个 code point；单个列表最多 1723 个不同词条。 每用户最多 200 个列表，请求批次最多 100 个操作、请求体最多 256KiB，避免滥用和内存尖峰。

### 3.3 前端 IndexedDB v3

把数据库版本升到 v3，保留 `lists`、`selections`、`favorites`，新增 `pendingOps`、`syncMeta` 和必要字段。 临时选择 `TemporarySelection` 仍是本地 24 小时草稿，不同步到服务器。

```ts
type SyncState = 'synced' | 'pending'
// profileId：登录后为服务端 userId；游客为 'local'
interface LocalStudyList extends StudyList { profileId: string; nameSeq: number; createdSeq: number; deletedAt?: number; deletedSeq?: number; syncState: SyncState }
// key = `${profileId}:${listId}:${vocabId}`
interface LocalListVocabState { key: string; profileId: string; listId: string; vocabId: string; present: boolean; changedSeq: number }
interface LocalFavoriteRecord extends FavoriteRecord { present: boolean; changedSeq: number; changedAt: number; syncState: SyncState }
type OperationKind = 'list.create' | 'list.rename' | 'list.delete' | 'list.vocab.set' | 'favorite.set'
interface PendingOperation { opId: string; profileId: string; deviceId: string; kind: OperationKind; entityId: string; payload: Record<string, unknown>; createdAt: number; attemptCount: number; nextAttemptAt: number }
interface SyncMeta { profileId: string; cursor: number; lastSyncAt?: number; migrationVersion?: number; dataFormatVersion: 1 }
```

为兼容现有 UI，可以继续在读出列表时组装 `vocabIds: string[]`。 推荐 v3 新建 `listVocab` store，而不是继续把整个 `vocabIds` 数组作为唯一同步单元。 索引至少包括 `pendingOps.by-profile-next-attempt`、`listVocab.by-profile-list`、现有 `lists.by-profile` 和 `favorites.by-profile`。

## 4. 同步协议

### 4.1 总体原则

采用本地优先、服务端收敛模型。 每次 UI 写操作先在一个 IndexedDB transaction 中同时更新本地投影并加入 `pendingOps`，成功后立即更新界面。 断网时除登录和首次下载外，列表、收藏和临时选择均可继续使用。 网络恢复后，客户端先推送 pending operations，再拉取服务端 changes，并重放尚未确认的本地操作。
MVP 使用增量同步，不在每次进入页面传输全部数据。 首次登录或游标过旧时获取全量 snapshot；之后使用单调递增的服务端 `seq` 作为 cursor。 客户端时间 `updatedAt` 只用于界面显示和迁移提示，不能决定跨设备冲突，因为设备时钟不可信。

### 4.2 操作格式与幂等

每个本地修改生成稳定的 `opId = crypto.randomUUID()`；网络重试必须复用同一个 opId。 服务端在一个 SQLite transaction 中检查 `(user_id, op_id)`，已存在则返回原 seq，不重复执行。 新操作先插入 `operations` 获得 seq，再用该 seq 更新物化表，最后提交。

```json
{ "protocolVersion": 1, "deviceId": "8af70af7-2ca2-4c08-91f7-a46be4d4f590", "cursor": 124, "operations": [ { "opId": "d5706e40-11a0-4bf3-9429-6f0678bcc04e", "kind": "list.rename", "entityId": "a2ef7f55-eeb5-4e57-af1a-3eea5427b036", "payload": { "name": "Unit 3 易错词" }, "clientTime": 1792915200000 }, { "opId": "c119cd54-aea7-4ce0-b676-fea2a53e5eb1", "kind": "list.vocab.set", "entityId": "a2ef7f55-eeb5-4e57-af1a-3eea5427b036", "payload": { "vocabId": "ket-0042", "present": true }, "clientTime": 1792915200100 } ] }
```

### 4.3 冲突规则

不使用向量时钟：当前只有单个中心服务端，服务端 seq 已能建立确定的总顺序，向量时钟会显著增加客户端和墓碑复杂度。 也不以整个列表的 `updatedAt` 做 last-write-wins，因为 A 改名、B 加词时会丢掉其中一个修改。 采用“字段/集合元素级、按服务端接收 seq 的 LWW”：

- 列表名称是一个冲突域；对同一名称的两次修改，后被服务端提交者胜出。
- 每个 `(listId, vocabId)` 是独立冲突域；同一个词的添加/移除以后提交者胜出。
- 每个 `vocabId` 收藏状态是独立冲突域；收藏/取消收藏以后提交者胜出。
- 列表删除是终态墓碑，优先于随后到达的 rename 或 vocab 操作；这些操作返回 `LIST_DELETED`，不自动复活。
- 恢复删除列表若以后需要，应创建新 listId 或增加显式 `list.restore` 操作；MVP 不提供隐式恢复。
- 两个设备创建同一显示名称但不同 listId 时保留两个列表，不按名称猜测合并。

因此 A 离线改名、B 离线加词，两个操作同步后都会保留。 A 删除 `ket-0042`、B 添加同一个词时，最终状态由服务端收到两操作的先后决定，并在所有设备收敛。 这种规则牺牲了离线期间的“真实发生时间”顺序，但不信任客户端时钟，行为可解释且实现成本适中。

### 4.4 服务端应用伪代码

```text
function applyBatch(userId, deviceId, operations):
  validateBatchLimitsAndEveryPayload(); BEGIN IMMEDIATE
  results = []
  for op in operations:
    old = SELECT seq FROM operations WHERE user_id=userId AND op_id=op.opId
    if old exists: results.push({opId, status: "duplicate", seq: old.seq}); continue
    seq = INSERT operations(...) RETURNING seq
    if op.kind != "list.create" and target list has deleted_seq: 
      results.push({opId, status: "rejected", code: "LIST_DELETED", seq}); continue
    switch op.kind:
      list.create:
        INSERT list if absent; if same id exists, validate same owner and treat as duplicate-like conflict
        UPSERT each initial vocab membership with changed_seq=seq
      list.rename:
        UPDATE lists SET name=payload.name, name_seq=seq WHERE user_id=? AND list_id=?
      list.vocab.set:
        UPSERT list_vocab SET present=payload.present, changed_seq=seq, changed_at=serverNow
      list.delete:
        UPDATE lists SET deleted_at=serverNow, deleted_seq=seq WHERE deleted_seq IS NULL
      favorite.set:
        UPSERT favorites SET present=payload.present, changed_seq=seq, changed_at=serverNow
    results.push({opId, status: "applied", seq})
  UPSERT devices SET last_seen_at=serverNow
  COMMIT; return results
```

无效操作必须在开启事务前尽量完成结构校验。 批次内某一操作业务拒绝不应回滚其他合法操作，但数据库错误应回滚整个事务并让客户端原批重试。 被业务拒绝的操作仍占 seq 并进入 changes，使发起设备能确定结束重试；其 payload 只保留必要、已清理的字段。

### 4.5 客户端同步伪代码

```text
async function sync(profileId):
  if alreadySyncing(profileId) or offline: return
  lock(profileId); try:
    pending = pendingOps due now, ordered by createdAt, limit 100
    response = POST /api/v1/sync {cursor, deviceId, operations: pending}
    transaction(local stores):
      for result in response.results:
        if result.status in ["applied", "duplicate"]: delete pendingOps[result.opId]
        else if result.code is permanent: move to visible syncErrors; delete from pendingOps
      apply response.changes in ascending seq to local materialized records
      set cursor = response.cursor
      // 远端投影可能暂时覆盖本地乐观值；重新应用仍未确认的操作
      replay all remaining pendingOps for this profile in createdAt order
  catch network/5xx: increment attemptCount; set jittered backoff (max 5 minutes)
  finally: unlock(profileId)
```

跨标签页用 Web Locks API（键为 `ket-sync:${profileId}`）确保一个账号同一时刻只有一个同步器。 不支持 Web Locks 时，以 IndexedDB 租约实现 15 秒锁；服务端幂等仍是最终保护。 收到 `401` 时暂停推送并显示“登录已过期”，不得删除 pending queue。 收到永久校验错误时展示可处理的同步错误，不得无限重试。

### 4.6 同步时机

- 登录成功后立即全量或增量同步。
- 页面启动和切回 `visibilityState=visible` 时同步。
- 每次本地变更后 debounce 500ms 推送；连续编辑合成一个批次，但不改变 opId。
- 浏览器 `online` 事件触发同步，但不能把它当作网络真实可用的唯一依据。
- 前台每 60 秒轻量增量同步一次，以接收其他设备修改。
- 提供“立即同步”按钮和状态：已同步、正在同步、离线、待同步 N 项、登录过期、有错误。
- `beforeunload` 不承担可靠同步；可以尝试小型 keepalive 请求，但正确性依赖持久 pending queue。

### 4.7 操作日志保留与全量重置

物化表中的墓碑长期保留。 `operations` 日志可保留 180 天；清理前记录每用户当前可用的 `minCursor`。 若客户端 cursor 小于 `minCursor`，`/sync` 返回 `409 CURSOR_EXPIRED`，客户端改取 snapshot。 snapshot 覆盖远端物化投影后，必须重放本地 pendingOps，不能清空离线修改。 活跃设备的 `last_ack_seq` 用于判断是否可延后清理，但不能让永久离线设备无限阻止日志压缩。

### 4.8 首次登录合并

首次登录不能静默把 `profileId='default'` 的历史数据上传到任意刚输入的账号。 登录后检测本地 default 数据与服务器 snapshot：

- 本地空、服务端非空：直接下载服务端数据。
- 本地非空、服务端空：提示“上传本机数据到此账号”，默认推荐上传，列出列表数和收藏数。
- 两边均非空：默认推荐无损合并，并显示预计结果；也允许仅使用云端且保留本地归档。
- 两边均空：正常开始。

无损合并规则：

- 不同 listId 全部保留，即使名称相同。
- 同一 listId（理论上来自同一历史副本）时，服务端名称优先，词条成员取并集，避免首次迁移丢词。
- 收藏取并集；`createdAt` 取较早值，已有 `sourceListId` 优先保留。
- v2 没有删除墓碑，因此迁移不能推断历史删除；只导入当前存在的数据。
- 导入转换为正常的 create/set operations，使用稳定迁移 opId，重试不会重复。
- 迁移完成记录 `migrationVersion=1`，但 default 原数据至少保留 30 天或直到用户主动清理。

## 5. 接口清单

所有业务接口位于同源 `/api/v1`，请求和响应使用 UTF-8 JSON。 Cookie 由浏览器自动携带，前端 `fetch` 使用同源默认 credentials 即可。 成功响应包含 `requestId` 便于查日志；时间均为 Unix epoch 毫秒。

### 5.1 认证接口

`POST /api/v1/auth/register`

```json
{ "username": "吴涛", "credential": "830521", "credentialKind": "pin", "remember": true, "deviceId": "8af70af7-2ca2-4c08-91f7-a46be4d4f590" }
```

`201 Created`，同时设置会话 Cookie：

```json
{ "dataFormatVersion": 1, "user": { "userId": "usr_01J...", "username": "吴涛" }, "recoveryCode": "B7YK-...-P9Q2", "requestId": "req_01J..." }
```

`POST /api/v1/auth/login` 请求字段与 register 相同，成功返回 `200`，不返回恢复码。

```json
{ "dataFormatVersion": 1, "user": { "userId": "usr_01J...", "username": "吴涛" }, "session": { "idleExpiresAt": 1795507200000, "absoluteExpiresAt": 1800691200000 }, "requestId": "req_01J..." }
```

`GET /api/v1/auth/session`：恢复页面时返回当前用户和会话期限；未登录返回 `401 AUTH_REQUIRED`。
`POST /api/v1/auth/logout`：撤销当前会话并清 Cookie，返回 `204`。
`POST /api/v1/auth/logout-all`：撤销该用户所有会话并清 Cookie，返回 `204`。
`POST /api/v1/auth/recover`：提交用户名、恢复码、新凭据和 deviceId；成功后撤销旧会话、签发新会话，并返回新的单次恢复码。

### 5.2 同步接口

`GET /api/v1/sync/snapshot`
`200 OK`：

```json
{ "protocolVersion": 1, "dataFormatVersion": 1, "cursor": 281, "lists": [ { "id": "a2ef7f55-eeb5-4e57-af1a-3eea5427b036", "name": "Unit 3", "nameSeq": 201, "createdAt": 1792915100000, "createdSeq": 190, "deletedAt": null, "deletedSeq": null, "vocab": [ { "vocabId": "ket-0042", "present": true, "changedSeq": 205 } ] } ], "favorites": [ { "vocabId": "ket-0042", "present": true, "sourceListId": "a2ef7f55-eeb5-4e57-af1a-3eea5427b036", "createdAt": 1792915200000, "changedAt": 1792915200000, "changedSeq": 207 } ], "requestId": "req_01J..." }
```

snapshot 包含当前状态及仍需传播的墓碑，不包含 `present=0` 的所有历史成员时，必须以“完整替换远端投影”语义处理。 列表删除墓碑必须包含；收藏完整集合之外的项视为未收藏。
`POST /api/v1/sync`：原子接收一批操作，并返回从请求 cursor 之后的 changes。

```json
{ "protocolVersion": 1, "deviceId": "8af70af7-2ca2-4c08-91f7-a46be4d4f590", "cursor": 278, "operations": [] }
```

`200 OK`：

```json
{ "results": [ { "opId": "d5706e40-11a0-4bf3-9429-6f0678bcc04e", "status": "applied", "seq": 279 } ], "changes": [ { "seq": 279, "kind": "list.rename", "entityId": "a2ef7f55-eeb5-4e57-af1a-3eea5427b036", "payload": { "name": "Unit 3 易错词" }, "serverTime": 1792915201000 } ], "cursor": 281, "hasMore": false, "requestId": "req_01J..." }
```

单次最多返回 500 changes；`hasMore=true` 时客户端立即用新 cursor 继续拉取，operations 传空数组。 响应 cursor 必须是本响应已完整包含的最大 seq，不能直接返回数据库全局最大值而跳过未返回 changes。
`GET /api/v1/health`：仅返回进程和数据库可用状态，不返回用户数、路径或秘密；Caddy/监控可用。

### 5.3 HTTP 状态与错误结构

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "列表名称不能为空", "field": "operations[0].payload.name", "retryable": false }, "requestId": "req_01J..." }
```

| HTTP | code | 含义与客户端处理 |
|---:|---|---|
| 400 | `BAD_JSON` / `VALIDATION_ERROR` | 请求格式错误，不重试原请求 |
| 401 | `AUTH_REQUIRED` / `AUTH_INVALID` | 需要登录或凭据错误；登录错误不泄露用户名是否存在 |
| 403 | `ORIGIN_FORBIDDEN` / `ACCOUNT_DISABLED` | 来源不合法或账号禁用 |
| 404 | `NOT_FOUND` | 路由或目标资源不存在 |
| 409 | `USERNAME_TAKEN` / `CURSOR_EXPIRED` / `LIST_DELETED` | 按 code 走注册提示、snapshot 或永久拒绝处理 |
| 413 | `BODY_TOO_LARGE` / `BATCH_TOO_LARGE` | 缩小请求，不原样重试 |
| 429 | `RATE_LIMITED` | 遵循 `Retry-After` |
| 500 | `INTERNAL_ERROR` | 带退避重试，不显示内部堆栈 |
| 503 | `DB_BUSY` / `AUTH_BUSY` | 短暂不可用，带抖动退避重试 |

生产环境通过 Caddy 把 `/api/*` 反代到同一站点，因此不需要 CORS 响应头，也不接受跨域凭据请求。 本地 Vite 开发用 dev proxy 将 `/api` 转到 `127.0.0.1:3117`，仍保持浏览器视角同源。 若未来确需跨域，必须使用精确 allowlist、`Vary: Origin` 和 credentials 配置，不能使用 `*`。

## 6. 前端改造点

### 6.1 `app/src/db/schema.ts`

- `DB_VERSION` 从 2 升到 3。
- 移除业务代码对常量 `PROFILE_ID='default'` 的默认依赖；保留它仅作为 v2 迁移来源常量并重命名为 `LEGACY_PROFILE_ID`。
- 增加 `listVocab`、`pendingOps`、`syncMeta` stores 及对应类型和索引。
- 给列表、收藏加入服务端 seq、墓碑和 sync 状态字段。
- v3 upgrade 只做结构迁移，不在 versionchange transaction 中访问网络。

### 6.2 `app/src/db/repository.ts`

保持现有 UI 方法名和主要返回类型，避免一次性重写页面。 把 repository 改成 facade：内部依赖 `profileStore`、`localRepository` 和 `syncQueue`。 `profileId` 不再靠默认参数隐式传入，而由当前 session 注入；游客使用固定隔离分区 `local`。
每个修改方法在同一个 IndexedDB transaction 中完成本地投影与 pending op：

- `createList` 写 list、初始 listVocab 和 `list.create`。
- `renameList` 更新本地 name 并写 `list.rename`。
- `removeVocab` 更新该成员并写 `list.vocab.set(present=false)`。
- 未来 add 方法复用 `list.vocab.set(present=true)`。
- `deleteList` 写 tombstone，不再物理删除。
- `setFavorite` 写 `present` 状态，不再物理删除取消收藏记录。
- `getLists`、`getFavoriteRecords` 默认过滤墓碑和 `present=false`。
- `loadSelection` 等临时选择方法仍只操作本地，不进同步队列。

接口“保持”指 UI 调用方式尽量不变，不表示继续保留有歧义的默认 profile 参数。 测试中应禁止未初始化 active profile 时写入，避免数据落回错误账号。

### 6.3 建议新增文件

- `app/src/auth/username.ts`：与服务端共享测试向量的用户名规范化和前端校验。
- `app/src/auth/session.ts`：session 恢复、登录、注册、退出和 active profile 管理。
- `app/src/sync/types.ts`：协议 v1 请求、响应和 operation 类型。
- `app/src/sync/client.ts`：调用 snapshot/sync、错误映射，不直接操作 UI。
- `app/src/sync/engine.ts`：锁、push/pull、重放、退避与触发时机。
- `app/src/sync/status.ts`：向 React 暴露同步状态和待同步数量。
- `app/src/db/migrate-v3.ts`：v2 数据转换与 legacy default 数据盘点。
- `app/src/components/AccountDialog.tsx`：登录、注册、切换账号、迁移确认。
- `app/src/components/SyncStatus.tsx`：同步状态、重试和错误详情。

### 6.4 未登录行为

推荐允许游客离线使用，profile 为 `local`，不强制登录。 这样现有用户升级后不会被登录墙挡住，也保留纯本地隐私选择。 游客数据永不自动同步；登录时走明确的首次合并流程。 界面持续但不打扰地提示“当前仅保存在此浏览器”，创建第二个列表或收藏后可更明显提示登录同步。

## 7. 部署方案

### 7.1 服务目录与进程

新增独立零第三方依赖服务，建议目录 `/var/www/ket-sync`，入口 `/var/www/ket-sync/server.mjs`。 使用 `node:http`、`node:sqlite`、`node:crypto`，代码风格参考现有 `server/tts-proxy.mjs`。 监听 `127.0.0.1:3117`；3116 保留给现有 TTS 服务，不监听公网地址。 API 和 TTS 保持两个进程，避免同步服务异常影响发音，也便于分别重启和限资源。
建议 systemd 单元内容如下，仅作为实施说明，本次不写入 `/etc/systemd/system`：

```ini
[Unit]
Description=KET vocabulary sync API
After=network.target
[Service]
Type=simple
User=wutao
Group=wutao
WorkingDirectory=/var/www/ket-sync
Environment=NODE_ENV=production
Environment=PORT=3117
Environment=DB_PATH=/var/lib/ket-sync/ket-sync.sqlite3
EnvironmentFile=/etc/ket-sync.env
ExecStart=/usr/bin/node /var/www/ket-sync/server.mjs
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/ket-sync
UMask=0077
MemoryMax=256M
[Install]
WantedBy=multi-user.target
```

`/etc/ket-sync.env` 权限设为 `0600`，包含随机生成的 `KET_SYNC_PEPPER`，备份时单独安全保存。 由于 scrypt 并发会吃内存，`MemoryMax`、认证并发 2 和请求体上限需同时存在；上线压测后可调整。 服务启动应先检查目录权限、schema version 和数据库可写性，不符合时退出让 systemd 明确报警。

### 7.2 Caddy 路由

在现有站点中把 API matcher 放在静态 SPA fallback 之前：

```caddyfile
handle /api/* {
    reverse_proxy 127.0.0.1:3117
}
handle {
    root * /var/www/ket
    try_files {path} /index.html
    file_server
}
```

现有 `/tts/*` matcher 保持原样并同样放在静态 handle 前。 具体合并时要保留当前已上线配置结构，先 `caddy validate` 再 reload；本设计不直接修改生产 Caddyfile。 Caddy 继续负责 TLS，Node 只信任来自本机反代的流量。 若依据客户端 IP 限流，只信任 Caddy 写入的受控转发头，不接受公网直连带来的伪造头；3117 仅绑定 loopback 是前提。

### 7.3 并发写入

单个 Node 进程内所有写入都走短事务；`DatabaseSync` 调用天然在事件循环中串行。 使用 `BEGIN IMMEDIATE` 尽早获得写锁，`busy_timeout=5000` 处理备份或短暂竞争。 不要启动多个 ket-sync 实例共享同一 SQLite 文件；未来需要多实例时迁移 PostgreSQL，而不是依赖网络文件系统上的 SQLite。 读 snapshot 可在事务中获取一致视图，但要分页构建 JSON，避免一次复制过多对象。

### 7.4 备份与恢复

每日备份数据库，至少保留 7 个日备、4 个周备、6 个月备，并把备份复制到另一块磁盘或另一主机。 不要直接复制正在运行且处于 WAL 模式的单个 `.sqlite3` 文件；会漏掉 `-wal` 内容。 由于没有 sqlite3 CLI，编写独立的 Node 维护脚本，使用 `node:sqlite` 的备份能力（实施时先核对 Node 24 API）或短暂停写后复制数据库、`-wal`、`-shm` 整组文件。 更稳妥的实施优先级是：调用运行中 API 的受保护本机 maintenance endpoint 执行一致性 checkpoint/backup，或停服务数秒做冷备。 备份文件权限 `0600`，包含用户数据和口令哈希，应加密后传出主机。
每周自动做恢复演练到临时路径：打开备份、执行 `PRAGMA integrity_check`、核对 schema version 和关键表行数，然后删除临时副本。 恢复步骤必须同时恢复匹配的 pepper；丢失 pepper 会导致所有 PIN 无法验证，但数据本身仍在。 部署新 schema 前额外做一次冷备，并准备只向前的数据库迁移脚本。

## 8. 迁移方案

### 8.1 数据与协议版本

三个版本号分开管理：

- IndexedDB `DB_VERSION=3`：仅表示浏览器本地结构。
- API 路径 `/api/v1` 和 `protocolVersion=1`：表示线上同步协议。
- `dataFormatVersion=1`：表示列表、收藏和 operation payload 的语义版本。

服务端 SQLite `schema_meta.schema_version=1` 独立递增。 不要把前端构建版本当作数据版本；服务端应至少兼容当前和上一个前端协议过渡期。

### 8.2 老用户平滑升级步骤

1. 发布能打开 IndexedDB v2 并升级到 v3 的前端；升级只新增 store/字段，不删除原数据。
2. 将旧 `default` 列表和收藏标记为 legacy source，临时选择继续保留在 `temporary:default` 直到 TTL 到期。
3. 未登录时通过 `local` 视图继续展示旧数据，用户感知不应是“升级后数据消失”。
4. 用户注册或登录后，先拉服务端 snapshot，再显示两边数量和合并选项。
5. 用户确认上传时，把旧列表转成 `list.create`，收藏转成 `favorite.set(true)`；每条使用可重现迁移 opId。
6. 同步成功且重新拉取核对数量后，写 `migrationVersion=1` 和完成时间。
7. 保留 legacy 数据至少 30 天，不自动物理删除；提供导出 JSON 和手动清理入口。
8. 若迁移中断，下次从相同 opId 重试；服务端唯一约束保证不重复创建。

稳定迁移 opId 可由 `SHA-256("migration-v1\0" + userId + "\0" + kind + "\0" + legacyKey)` 截取并编码得到。 这里使用服务端 `userId`，保证同一本地数据若明确迁到不同账号，会产生不同操作；但 UI 必须再次确认，避免误传。 列表原 UUID 可保留；若服务端同 userId 已存在同 listId，则按首次合并规则处理而不是随机覆盖。

### 8.3 回滚兼容

v3 发布后旧前端不能理解新墓碑和 pending queue，因此不应让旧构建继续写同一数据库。 静态资源使用内容哈希并在新版本加载时提示刷新；Service Worker 如存在，必须避免长期缓存旧 `index.html`。 服务端在迁移窗口继续接受 protocol v1；前端发布回滚只能回到同样理解 IndexedDB v3 的兼容构建。 上线前用 fake-indexeddb 覆盖 v2→v3、迁移中断、重复提交、游标过期和账号切换测试。

## 9. 分期建议

### 9.1 MVP

- 用户名规范化、注册、用户名 + PIN/短口令登录、HttpOnly 会话、退出。
- scrypt + pepper、认证并发限制、基础限流、Origin 校验和统一错误。
- SQLite schema、WAL、短事务、单实例 systemd 和 `/api/*` 同源反代。
- IndexedDB v3、本地优先 repository facade、pending queue 和操作幂等。
- snapshot + 增量 sync、服务端 seq、墓碑、字段/元素级 LWW。
- 登录后首次无损合并、legacy 数据保留、账号切换隔离。
- 同步状态 UI、自动重试和手动“立即同步”。
- 每日一致性备份与至少一次实际恢复演练。

MVP 也必须包含安全与备份；它们不是可延后的“优化”。

### 9.2 后续迭代

- 一次性恢复码、修改 PIN、设备列表和“退出所有设备”的完整 UI。
- 已登录设备扫码批准新设备，作为方案 C 的无口令便利入口。
- 操作日志压缩、180 天清理任务和更细致的配额管理。
- 冲突历史/撤销删除；当前 MVP 只保证确定收敛，不提供人工选版本。
- 加密异地备份、指标告警、结构化审计日志和异常登录提示。
- 用户规模需要多实例时迁移 PostgreSQL；保持 HTTP 协议不变以减少前端改动。
- 若确有账号找回需求，再引入邮箱魔法链接，不要设计安全问题答案。

## 10. 风险清单

1. **纯用户名越权风险**：若为了省一步输入而退回方案 A，知道或猜到用户名的人可读取、篡改、删除数据；必须坚持第二凭据。
2. **低熵 PIN 风险**：6 位 PIN 可被在线猜测或在数据库与 pepper 同时泄露后离线枚举；需默认推荐短口令、限流、scrypt、pepper 和会话撤销。
3. **XSS 代操作风险**：HttpOnly 阻止读取 token，但不能阻止同源恶意脚本发请求；需要 CSP、依赖审查、输出转义和 Origin 校验。
4. **离线冲突的意外结果**：同一字段在两设备离线修改时以服务端接收顺序决定，可能不符合用户主观时间；UI 应显示最后同步状态，后续可加历史撤销。
5. **墓碑或游标实现错误**：物理删除、错误推进 cursor 或 snapshot 后不重放 pending ops 都会导致数据复活或丢失；必须有确定性多设备测试。
6. **首次迁错账号**：把 legacy default 自动上传会造成隐私泄露；必须展示目标用户名、数量并由用户明确选择，原数据保留可回退。
7. **SQLite 备份不一致**：在 WAL 模式只复制主文件可能得到缺数据备份；必须使用一致性备份或冷备并做恢复演练。
8. **单机故障风险**：SQLite、API、静态站均在同一主机，磁盘或主机损坏会整体不可用；备份必须离机。
9. **内存耗尽风险**：并发 scrypt、大请求或大 snapshot 可能触发既有 OOM 问题；限制认证并发、请求体、批量和 systemd 内存，并监控重启。
10. **账号无法找回**：没有邮箱时忘记 PIN 无法验证所有权；应提供恢复码并在创建账号时清楚提示。

## 11. 待确认问题

1. **是否接受用户名 + 第二凭据？** 推荐：接受，默认短口令，数字模式至少 6 位；不采用纯用户名。
2. **未登录是否可继续本地使用？** 推荐：可以，使用隔离的 `local` profile，登录后明确选择迁移。
3. **“更换用户名”是切换账号还是修改账号名？** 推荐：MVP 只做切换账号；账号改名后续单独设计。
4. **首次登录两边都有数据时如何处理？** 推荐：默认无损合并，不同 listId 均保留、收藏并集，并保留本地归档 30 天。
5. **是否接受同字段冲突按服务端接收顺序 LWW？** 推荐：接受；不同字段和不同单词成员仍会合并，MVP 不上向量时钟。
6. **会话记住多久？** 推荐：空闲 30 天、绝对 90 天、每 7 天轮换，可随时退出全部设备。
7. **是否在 MVP 提供恢复码？** 推荐：提供；无邮箱场景下这是低依赖的账号恢复手段。
8. **备份保存周期和异地位置？** 推荐：7 日备、4 周备、6 月备，并加密复制到另一主机或对象存储。
9. **配额是否合适？** 推荐：每用户 200 个列表、每列表最多 1723 词、每批 100 操作、请求体 256KiB，观察后调整。
10. **是否允许 4 位 PIN？** 推荐：不允许；若产品强制要求，必须加强限流且明确它只适合低价值数据，仍不推荐。

## 交付说明

- 推荐方案组合：用户名 + 6 位 PIN/短口令、HttpOnly 滑动会话、SQLite、IndexedDB 本地优先操作队列、服务端 seq 增量同步与元素级 LWW 墓碑。
- 最大的 3 个风险：低熵 PIN/身份冒用、离线冲突或游标错误造成数据丢失、WAL 备份不一致或单机故障导致不可恢复。
- 待确认问题：10 条。
