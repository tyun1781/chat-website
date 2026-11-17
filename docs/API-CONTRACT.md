# 实时留言板接口契约 v0.1

## 第六阶段扩展：论坛标签

帖子使用单标签，`GET /api/tags` 公开返回 `{data:[{id:"daily",label:"日常"},{id:"anime",label:"动漫"},{id:"games",label:"游戏"},{id:"music",label:"音乐"},{id:"share",label:"分享"}]}`。“全部”只作为前端过滤器，不是标签目录或存储值。

- `POST /api/messages` 接受 `{body,tag?}`，tag 必须为目录中的 ID，缺省 daily；其余注册、权限、CSRF、Origin 和 Idempotency-Key 规则不变。null、空串及未知标签返回400 VALIDATION_ERROR。同键同正文但不同标签返回409 IDEMPOTENCY_CONFLICT；省略tag和显式daily等价。
- `GET /api/messages?tag=anime&cursor=...&limit=20` 按指定标签筛选；不传tag为全部。过滤与分页均在数据库执行，游标只在同一标签筛选下复用。切换标签需取消旧请求、清空分页并从首屏重新开始。
- Message 变为 `{id,author:{id,nickname},body,tag,createdAt}`，列表、发布响应、幂等重放和公共 message.created 事件都含tag。现有帖子及历史创建事件补充daily，原事件ID不变。旧客户端省略tag仍正常发布，忽略新增响应字段即可。
- 公共 SSE 和 HTTP 事件补拉仍返回全部公开帖子/评论事件，不接受tag过滤，sync.eventCursor仍是公共流全局水位。前端推进每个事件游标，只将匹配当前标签的新增帖子加入可见列表；删除事件始终按ID移除。不得因忽略其他标签事件而停止推进水位。
- 评论仍绑定帖子ID，不增加评论标签。私聊接口、数据表和独立事件流不受影响，不进入标签目录或公开筛选。

固定目录目前只读；本阶段不提供自定义标签或修改已发布帖子标签。

## 第五阶段扩展：匿名在线人数

`GET /api/presence` 为公开只读接口，返回 `200 {"data":{"onlineCount":3}}`，仅返回匿名整数人数，不返回访客ID、账号或连接详情。前端建议每15秒读取一次，页面隐藏时可暂停轮询。

“在线”近似定义为当前单个后端实例具有有效公共 `/api/events` SSE 连接的浏览器数；未登录访客和登录用户均统计，私聊流不额外增加人数。仅访问页面但尚未建立公共实时连接不计入。

服务端随机生成并签名 HttpOnly、SameSite=Lax、Path=/ 的会话 cookie（开发 dev_presence，生产 __Host-presence 且 Secure），将同一浏览器的多个标签页去重。公开列表、在线查询和公共流可设置此cookie。通常在公共列表完成后再建立SSE即可共享标识。不同浏览器、隐私窗口或清除cookie后视为不同访客；首次多个无cookie标签同时打开可能短暂产生不同标识，因此不是精确的自然人人数。

浏览器最后一个公共连接关闭后立即移除；异常断网需等待底层连接检测，页面数字还受15秒轮询间隔影响。重启清空内存并随客户端重连自动重新统计；不持久化访客标识，也不改变公共事件游标/补拉语义。

基本限制：现有公共流总上限200；每个浏览器最多8个公共流；每IP每分钟最多60次公共建连、600次在线查询。超限返回429及Retry-After，容量满返回503；仅保留活跃访客，限流状态沿用有容量上限和定时清理的内存表。多实例部署前需要共享在线状态，目前该数值仅代表此本地实例。

## 第四阶段扩展：帖子评论和一对一私聊

原 messages 接口保持兼容，前端可将其称为“帖子”。新增接口以下均带 `/api` 前缀。成功/错误、Cookie、CSRF、Origin 和字符串事件 ID 沿用原规则；新增写接口必须登录并携带 X-CSRF-Token。评论、私信正文均为纯文本，统一换行、去首尾空白，1～500 Unicode 码点。发布评论和发送私信必须携带 UUID `Idempotency-Key`；同用户同键同目标和正文重放 200，首次 201，不一致 409。删除后的评论不能由重放复活。

Comment：`{id,messageId,author:{id,nickname},body,createdAt}`。作者昵称为发布时快照。

| 方法和路径 | 权限与请求 | 响应 |
|---|---|---|
| GET /messages/:id/comments | 公开，cursor 可选、limit 默认20/最多100 | `{data:Comment[],page:{nextCursor,hasMore},sync:{eventCursor}}` |
| POST /messages/:id/comments | 登录+CSRF，`{body}`，Idempotency-Key | `{data:{comment:Comment}}`，201/重放200 |
| DELETE /comments/:id | 评论作者本人+CSRF | 204，重复删除不重复发事件 |

评论按 createdAt、id 倒序分页，前端可按设计倒转显示；游标不透明、原样传回。帖子不存在或已删除返回404。删除帖子后其评论不再公开查询，但保留数据库记录。GET 评论的 eventCursor 是公共流快照水位，打开评论后可从此水位补拉以消除加载期间缺口，不应直接推进整个公共列表的已处理水位。

公共 SSE `/events` 和公共 HTTP `/messages/events` 增加：

- `comment.created` → `{comment:Comment}`
- `comment.deleted` → `{commentId,messageId,deletedAt}`

评论与公开帖子共用公共事件序号。原客户端可忽略不认识的事件；新客户端对当前展开帖子合并评论并按 ID 去重。私聊永不进入公共事件表或公共 API。

私聊 UserSummary：`{id,nickname}`；DirectMessage：`{id,conversationId,sender:{id,nickname},body,createdAt}`。
Conversation：`{id,otherUser:{id,nickname},createdAt,updatedAt,lastMessage:DirectMessage|null}`，仅会话参与者可取得。

| 方法和路径 | 权限与请求 | 响应 |
|---|---|---|
| GET /users/search?q=昵称 | 登录，q为1～32字，limit默认20/最多20 | `{data:UserSummary[]}`；只查活跃账号，排除本人，不返回用户名/邮箱 |
| GET /dm/conversations | 登录，cursor可选、limit默认20/最多100 | `{data:Conversation[],page:{nextCursor,hasMore},sync:{eventCursor}}` |
| POST /dm/conversations | 登录+CSRF，`{userId}` | `{data:{conversation:Conversation}}`；新建201，已有200；不允许自己或禁用用户 |
| GET /dm/conversations/:id/messages | 仅参与者，cursor可选、limit默认30/最多100 | `{data:DirectMessage[],page:{nextCursor,hasMore},sync:{eventCursor}}` |
| POST /dm/conversations/:id/messages | 仅参与者+CSRF，`{body}`，Idempotency-Key | `{data:{message:DirectMessage}}`；首次201/重放200 |
| GET /dm/events?after=事件ID | 登录，limit默认100/最多500 | `{data:[{id,type,data,createdAt}],page:{nextCursor,hasMore}}`；仅本人参与会话事件 |
| GET /dm/stream?after=事件ID | 登录，独立 SSE，会话 Cookie 鉴权 | 只推送本人参与的会话事件，Last-Event-ID 优先 |

会话列表按创建时间及ID倒序稳定分页；可在客户端按 updatedAt 展示近期活跃会话，但翻页仍原样使用服务端游标。私信按创建时间及ID倒序分页，聊天窗口反转后显示旧→新。双方会话唯一，并发打开不会重复创建。非参与者查询/写入会话统一404，不泄漏会话存在性。对方禁用时拒绝新发送403 RECIPIENT_UNAVAILABLE（仅对方不可用，不应退出本人登录），已有历史仅活跃的参与者可读。新增评论限制每用户20次/分钟，私信每用户30次/分钟，新增会话每用户20次/分钟，搜索每用户60次/分钟。

私聊事件采用与公共流独立的字符串 ID，不得混用游标：

- `conversation.created` → `{conversationId}`；接收后刷新会话列表。
- `dm.message.created` → `{conversationId,message:DirectMessage}`；更新当前会话，并刷新会话列表预览。
- `auth.expired` → `{}`，关闭流；前端立即清空私聊状态并要求重新登录。
- `sync.reset` → `{reason:"invalid_cursor"}`，关闭流；重新查询会话列表获取新水位。

首次从会话列表 sync.eventCursor 建立私聊 SSE；重连通过 `/dm/events` 补拉，空页游标保持after。流每次读取事件前重新验证会话/账号状态，退出、过期、禁用后不再传出私聊内容；约500ms内关闭连接。普通 GET/写操作均独立鉴权。私聊事件只允许参与者读取，不提供全局私聊列表。前端在退出或切换账号时立即关闭私聊连接、取消请求并清空所有私聊缓存。

以上为当前阶段新增约定，后文“待实现”状态描述保留作第一阶段历史；实际实现进度见 BACKEND-PHASE4.md。

状态：第一阶段设计契约。当前只有 `GET /api/health`、`GET /api/ready` 实现，其余下述接口均待第二阶段实现，不能对真实后端调用并预期成功。前端可据此制作 mock。邮箱验证、找回密码为后续规划。

## 通用约定

- 同源部署，前缀 `/api`，JSON UTF-8，所有时间为 UTC ISO 8601（例如 `2026-11-16T08:00:00.000Z`）。UUID 字符串作为业务 ID；事件 ID 为十进制字符串，禁止转为 JS Number。
- 成功：`{"data": ...}`；分页额外提供 `"page":{"nextCursor":null,"hasMore":false}`。204 无响应体。
- 失败：`{"error":{"code":"VALIDATION_ERROR","message":"输入不符合要求","requestId":"...","fields":{"body":"请输入 1～500 字"}}}`。fields 可省略。不得返回 SQL、堆栈、凭证。
- 状态码：400 VALIDATION_ERROR / INVALID_CURSOR；401 UNAUTHENTICATED / INVALID_CREDENTIALS；403 FORBIDDEN / ACCOUNT_DISABLED / RECIPIENT_UNAVAILABLE / CSRF_INVALID；404 NOT_FOUND；409 USERNAME_TAKEN / IDEMPOTENCY_CONFLICT / LAST_ADMIN；410 EVENT_CURSOR_EXPIRED；413 PAYLOAD_TOO_LARGE；429 RATE_LIMITED（Retry-After 秒）；500 INTERNAL_ERROR；503 NOT_READY。
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
