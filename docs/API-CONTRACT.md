# 实时留言板接口契约 v0.1

状态：第一阶段设计契约。当前只有 `GET /api/health`、`GET /api/ready` 实现，其余下述接口均待第二阶段实现，不能对真实后端调用并预期成功。前端可据此制作 mock。邮箱验证、找回密码为后续规划。

## 通用约定

- 同源部署，前缀 `/api`，JSON UTF-8，所有时间为 UTC ISO 8601（例如 `2026-11-16T08:00:00.000Z`）。UUID 字符串作为业务 ID；事件 ID 为十进制字符串，禁止转为 JS Number。
- 成功：`{"data": ...}`；分页额外提供 `"page":{"nextCursor":null,"hasMore":false}`。204 无响应体。
- 失败：`{"error":{"code":"VALIDATION_ERROR","message":"输入不符合要求","requestId":"...","fields":{"body":"请输入 1～500 字"}}}`。fields 可省略。不得返回 SQL、堆栈、凭证。
- 状态码：400 VALIDATION_ERROR / INVALID_CURSOR；401 UNAUTHENTICATED / INVALID_CREDENTIALS；403 FORBIDDEN / ACCOUNT_DISABLED / CSRF_INVALID；404 NOT_FOUND；409 USERNAME_TAKEN / IDEMPOTENCY_CONFLICT / LAST_ADMIN；410 EVENT_CURSOR_EXPIRED；413 PAYLOAD_TOO_LARGE；429 RATE_LIMITED（Retry-After 秒）；500 INTERNAL_ERROR；503 NOT_READY。
- 昵称 1～32 Unicode 码点，去首尾空白；正文去首尾空白后 1～500 Unicode 码点，纯文本保留内部换行；统一换行 LF。用户名转小写，匹配 `[a-z0-9_]{3,32}`。密码 12～128 字符，不裁剪、不悄悄截断。请求体上限 16 KiB。未知字段拒绝。
- 默认普通用户；角色和账号状态不得由注册、资料更新请求设置。公开 UserSummary 只有 id、nickname。用户名、邮箱、状态、角色不得出现在公开留言作者中。

## 用户与会话

User：`{id,username,nickname,role:"user"|"admin",status:"active"|"disabled",createdAt,updatedAt}`；当前版本不收集邮箱，数据库邮箱列为预留。

| 方法和路径 | 权限 | 请求 | 成功响应 |
|---|---|---|---|
| POST /auth/register | 公开 | `{username,password,nickname}` | 201 `{data:{user:User}}`，不自动登录 |
| POST /auth/login | 公开 | `{username,password}` | 200 `{data:{user:User,csrfToken,expiresAt}}`，设置会话 cookie |
| GET /auth/session | 登录 | 无 | 200 `{data:{user:User,csrfToken,expiresAt}}`，页面重载恢复登录 |
| POST /auth/logout | 会话＋CSRF | 无 | 204，撤销当前会话并清 cookie；已失效会话也返回 204 |
| PATCH /users/me | 登录＋CSRF | `{nickname}` | 200 `{data:{user:User}}` |
| POST /users/me/password | 登录＋CSRF | `{currentPassword,newPassword}` | 204，撤销全部会话并清 cookie，需重新登录 |

安全实施要求：Argon2id（起点 memoryCost=65536 KiB、timeCost=3、parallelism=1，压测后调整），加密安全随机 32 字节会话 token，数据库仅存 SHA-256 token_hash；绝对有效期 7 天，不滑动续期。正式环境 cookie 名 `__Host-session`，Secure、HttpOnly、SameSite=Lax、Path=/，不设 Domain；本地 HTTP 用独立名称 `dev_session`，仅开发模式允许非 Secure。每次鉴权查询用户是否 disabled 和会话是否撤销/过期。登录必须换新 token，日志不记录密码、cookie、CSRF token、完整连接字符串。

CSRF token 为独立高熵 token，服务端只存 hash；登录时返回原值；GET /auth/session 轮换并返回新的 CSRF token（多标签页遇到 CSRF_INVALID 时重新获取后重试一次）。已登录的写请求必须携带 `X-CSRF-Token`，同时检查 Origin 与允许的站点一致；公开注册/登录也检查 Origin，禁用跨源凭证访问。登出无有效会话时仍检查 Origin。SSE 仅读不改变状态。

限制规划：登录每 IP 15 分钟 20 次、每用户名 15 分钟 10 次；注册每 IP 每小时 5 次；发言每用户每分钟 10 次、每 IP 每分钟 30 次。代理 IP 只信任明确配置的反向代理。错误登录统一提示账号或密码错误；账号禁用只在密码正确后返回 ACCOUNT_DISABLED。

## 留言 HTTP 接口

Message：`{id,author:{id,nickname},body,createdAt}`，昵称为发布时快照，之后修改昵称不改变旧留言。

| 方法和路径 | 权限 | 请求 | 成功响应 |
|---|---|---|---|
| GET /messages | 公开 | query: cursor 可选，limit 默认20、最大100 | 200 `{data:Message[],page:{nextCursor,hasMore},sync:{eventCursor}}` |
| POST /messages | 登录＋CSRF | `{body}`，必填 `Idempotency-Key: UUID` | 首次201 `{data:{message:Message}}`；重放200，同一结果，头 `Idempotency-Replayed: true` |
| DELETE /messages/:id | 作者本人＋CSRF | 无 | 204；非本人403，不存在404；本人重复删除204，不重复发事件 |

分页按 `(created_at DESC,id DESC)` 稳定键集排序，cursor 为 base64url 编码的 `{createdAt,id}`；严格校验，不使用 offset。只返回未删除留言。nextCursor 为最后一条的键，末页 null。不同页不保证冻结快照，新留言由实时流补充。空列表同样返回 eventCursor。

首屏查询在同一 REPEATABLE READ 事务读取留言及最大已提交事件 ID，sync.eventCursor 是该快照水位。后续分页返回的水位不应覆盖客户端已经处理的水位。事件写入事务必须使用统一的事务级 advisory lock（在分配事件序号前获取，持有至提交），保证提交顺序和序号一致，避免并发事务造成水位跳过事件。

发布：校验后在同一事务插入留言、幂等记录和 message.created 事件，提交后才向 SSE 连接分发；失败整体回滚。幂等键按用户隔离，同键同规范化正文返回原留言，同键不同正文409。并发同键最多创建一条留言。幂等记录第一版不自动清理；已删除留言的键重放返回409 IDEMPOTENCY_CONFLICT，不复活留言。网络重试沿用同键，用户编辑正文重新提交时使用新键。

删除：软删除；消息删除和 message.deleted 事件在同一事务写入。普通用户只能删自己留言；管理员使用专门管理接口。首屏快照之后产生的新建/删除均由事件重放补齐。

## 管理接口

所有接口要求 active admin，写接口另外要求 CSRF。管理员初始账号通过后续专用一次性命令创建，不能公开注册管理员；本阶段不植入默认密码。

| 方法和路径 | 请求 | 成功响应 |
|---|---|---|
| GET /admin/users | query: q（用户名/昵称，最多64字符）、status（active/disabled）、cursor、limit（20/最大100） | 200 `{data:User[],page:{nextCursor,hasMore}}`，按创建时间和ID倒序 |
| PATCH /admin/users/:id/status | `{status:"active"|"disabled",reason}`，reason 1～500字 | 200 `{data:{user:User}}` |
| DELETE /admin/messages/:id | `{reason}`，1～500字 | 204 |

禁用用户、撤销全部会话和审计写入同一事务；恢复账号不恢复旧会话。禁止禁用自己和最后一个 active admin（409 LAST_ADMIN，事务锁保护并发）。状态相同请求返回当前用户，不重复审计。管理删除重复请求204，不重复事件/审计。审计记录操作者、操作、目标、理由、时间，不保存凭证。第一阶段不实现改角色、删除账号、用户自行注销。

## 实时事件和补拉

`GET /events?after=<eventId>`：公开 SSE，Content-Type text/event-stream；初连必须使用首屏 eventCursor，自动重连优先使用 Last-Event-ID，query after 为后备。EventSource 同源连接不需要额外 token。

事件示例：

```text
id: 123
event: message.created
data: {"message":{"id":"UUID","author":{"id":"UUID","nickname":"小明"},"body":"你好","createdAt":"2026-11-16T08:00:00.000Z"}}

id: 124
event: message.deleted
data: {"messageId":"UUID","deletedAt":"2026-11-16T08:01:00.000Z"}

```

- 每15秒发送注释心跳 `: heartbeat`；建议 retry 3000ms，客户端展示连接状态。
- 先重放 after 之后持久化事件，再连续跟进；追赶与订阅衔接不得丢事件（使用数据库事件游标轮询或“订阅后补拉”策略）。只在数据库提交后发送，事件 ID 严格递增但不保证连续，至少一次交付。
- `GET /messages/events?after=123&limit=100` 提供 HTTP 补拉，limit 最大500，返回 `{data:[{id,type,data,createdAt}],page:{nextCursor:"124",hasMore:false}}`；没有新事件时 nextCursor 保持 after。
- 客户端按事件 ID 去重，留言按 id 合并，删除事件重复应用无副作用；按顺序处理，已删除记录不被旧重复新建事件复活。分页请求期间缓冲事件，合并该页后按顺序应用。
- 第一版持久化事件不自动过期。未来启用清理后，过老游标：HTTP 410 EVENT_CURSOR_EXPIRED；SSE 发送 `event: sync.reset`、`data: {"reason":"cursor_expired"}` 后关闭。未来游标同样要求重新同步，错误 reason 为 invalid_cursor。SSE 建连前格式错误返回400。
- 网络重连时先保持现有列表并补拉；reset 则取消旧分页请求、清空旧列表和去重缓存、重新加载首屏并建立新流。异常断流没有 reset 时沿用最后已处理 ID。
- 反向代理关闭 SSE 缓冲和压缩，读超时大于心跳间隔；单实例起步，扩容多实例须接入跨实例通知，持久化事件仍作为补拉来源。

## 健康检查（本阶段已实现）

- GET /api/health → 200 `{data:{status:"ok"}}`，仅表示 HTTP 进程可响应，不依赖数据库。
- GET /api/ready → 200 `{data:{status:"ready",database:"up",schema:"ready"}}`，执行 SELECT 1 并检查核心表；不可连接或缺表返回503 NOT_READY。设有连接和查询超时。
- 未实现接口返回404 NOT_FOUND，不提供假成功数据。

## 后续规划，尚未实现

- POST /auth/email-verification/request：登录＋CSRF，绑定邮箱并发送验证链接；POST /auth/email-verification/confirm：一次性 token。
- POST /auth/password-reset/request：邮箱，统一202避免枚举账号；POST /auth/password-reset/confirm：token＋newPassword，成功撤销全部会话。
- token 使用安全随机数，仅保存 hash、用途、关联用户、过期时间和消费时间；一次性消费，建议有效期30分钟，申请限流；需要独立迁移及邮件服务后才开放。
