# 第七阶段：管理员申请、站内通知、关于作者与 gal 导航

日期：2026-11-18（Asia/Shanghai）。本轮在现有第 6 阶段代码上增量实现，没有重写前端或后端。

## 管理员申请与权限

新增迁移 `backend/migrations/004_admin_applications.sql`：

- `admin_applications` 记录申请理由、状态、审批人、审批时间与拒绝理由。
- 同一用户同时最多一条 `pending` 申请。
- 通过申请会在同一事务内把用户角色改为 `admin`，并写 `admin_audit_logs`。
- 拒绝必须填写理由；不能审批自己的申请。

新增后端接口：

- `POST /api/admin-applications`、`GET /api/admin-applications/me`
- `GET /api/admin/applications`、`PATCH /api/admin/applications/:id`
- `GET /api/admin/users`、`PATCH /api/admin/users/:id/status`
- `DELETE /api/admin/messages/:id`

管理员保护：

- 只有 active admin 能访问管理接口。
- 不能禁用自己或最后一个 active admin（409 `LAST_ADMIN`）。
- 禁用用户会在同一事务撤销其全部会话。
- 管理员删除帖子会软删除、写入 `message.deleted` 事件并写审计，重复删除不重复发事件。

## 前端页面

- “工具”页新增“申请管理员权限”，显示未申请、审核中、已通过、已拒绝状态；通过后可刷新权限进入管理台。
- 管理台支持待审批/全部管理员申请、用户搜索与禁用/恢复、最近 50 条公开帖子的管理员删除。
- “关于作者”页使用用户确认的简介文案和 `https://space.bilibili.com/509574643`。
- 工具页新增“来点galgame？”入口，进入独立的 Galgame 导航页；当前收录 TouchGal、稻荷GAL、SakuGAL 等 11 个站点。
- 导航卡片使用本地图标、站点描述与标签；图标已下载到 `frontend/public/icons/gal/`，不依赖运行时外部图标服务。
- 管理员账号导航显示“管理”入口，并在旁边新增“日志通知”入口。
- “日志通知”页展示待审批管理员申请、最近 24 小时操作数，以及审批/禁用/删帖的审计时间线；日志接口为 `GET /api/admin/audit-logs`，不新增数据表。
- 新增 `pages.css`，新页面样式独立于旧样式层。
- 全站页面接入 `v-reveal` 渐显：元素进入视口时上移 18px 淡入，卡片按顺序小幅延迟；切换标签页会重新播放，`prefers-reduced-motion` 下自动关闭动画。实现位于 `frontend/src/reveal.ts` 与 `motion.css`。

## 帖子删除通知

新增迁移 `005_notifications.sql` 和通知接口：

- 管理员删除帖子时，在同一事务内给帖子作者写入 `message.deleted` 通知。
- 通知包含删除理由和被删帖子的 120 字摘要。
- 作者登录后导航栏显示“通知”和未读角标，通知页可逐条或全部标为已读。
- 未读数量每 30 秒刷新一次；通知不进入公共 SSE 或私聊事件流。

`docs/API-CONTRACT.md` 已补充管理员申请、管理接口和站内通知约定，根 README 已从第一阶段更新为当前状态。

## 最小验证

- 后端 `npm run typecheck`、`npm run build` 通过。
- 前端 `npm run typecheck`、`npm run build` 通过（Vite 构建产物 gzip：CSS 11.99 kB，JS 58.94 kB）。
- 开发库真实执行 `004_admin_applications.sql`、`005_notifications.sql` 成功，重复执行迁移不重复应用。
- `/api/ready` 返回 200，`database=up`、`schema=ready`。
- 前端 dev server `http://127.0.0.1:5173` 返回 200，标题为 `inch-community`；Vite 代理的 `/api/ready` 也返回 200。
- 未登录访问 `/api/admin/users`、`/api/admin/applications`、`/api/admin-applications/me`、`/api/notifications`、`/api/admin/audit-logs` 均返回 401，说明路由已注册且鉴权生效。
- 管理员日志 SQL（关联操作者、目标用户/帖子、分页和摘要）已在真实开发库只读验证。
- `notifications` 表已建立，包含分页索引和未读部分索引。
- 浏览器实际打开“工具 → 来点galgame？”，11 个站点卡片与本地图标正常显示；390px 视口 `scrollWidth=375`，无横向溢出；浏览器无页面错误。截图位于被忽略的 `frontend/artifacts/gal-nav-desktop.png` 与 `gal-nav-mobile.png`。
- 浏览器检查渐显：论坛、工具、关于作者、私聊、主页、gal 导航页的 `.reveal` 元素在进入视口后均变为 `is-visible`，没有可见元素卡在透明状态；切换标签页后会重新触发。截图 `frontend/artifacts/reveal-forum.png`（忽略提交）。
- `npm test`：3 项通过、1 项真实库集成测试跳过（未设置 `RUN_DB_TESTS=1`）。

## 未验证 / 后续

- 已将 `inch` 账号设为管理员，但没有保存或使用其登录会话，因此未在真实 HTTP 上跑完“管理员删除帖子 → 作者收到通知”的完整链路。
- 没有执行 SSE 管理删除广播验证，也没有跑完整专项测试。
- “来点galgame？”中的外部站点可访问性、内容分级与授权状态未逐一核验；图标来自公开 favicon 服务并已本地化，站点名称与图标归各自权利人所有。
- 渐显动效只做了桌面/390px 浏览器检查，未逐页人工核对所有节奏，也未做低端设备性能测试。
- 完整专项测试仍按用户要求暂停。
- Ciallo 彩蛋待用户确定方案。
- 邮箱验证/找回密码、生产部署未做。
