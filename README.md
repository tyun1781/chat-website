# INCH Community

INCH 是一个本地运行的二次元社区网站：Vue 3 + TypeScript 前端，Node.js + Fastify + TypeScript 后端，PostgreSQL 数据库。

当前代码包含账号、公开帖子、论坛标签、评论、一对一私聊、实时更新、匿名在线人数，以及管理员申请与管理台。管理员功能仍在本地开发验证阶段。公网部署步骤见 [DEPLOY.md](DEPLOY.md)。

## 已实现

- 注册（**必须绑定邮箱并输入验证码**）、登录、会话恢复、退出、昵称修改、密码修改
- 公开帖子、游标分页、发帖、本人删除、幂等提交
- 日常 / 动漫 / 游戏 / 音乐 / 分享五类论坛标签与筛选
- 帖子评论、实时评论事件、本人删除
- 一对一私聊、昵称搜索、独立实时事件流
- 公共 SSE、HTTP 事件补拉、断线恢复
- 匿名在线人数
- 管理员申请、审批、用户禁用/恢复、管理员删除帖子、审计日志
- 管理员“日志通知”页：待审批申请、最近 24 小时操作数和审计时间线
- 管理员删除帖子时，作者会收到站内通知，包含删除理由和帖子摘要
- INCH 入场页、关于作者页、“来点galgame？”导航页、全站渐显入场动画、移动端布局

管理员、邮箱验证和找回密码、完整专项测试仍属于后续范围。没有默认管理员账号。

## 本地启动

要求 Node.js 22+、npm。项目依赖已安装时可跳过 `npm ci`。

### 1. 启动项目内 PostgreSQL

在第一个终端：

```powershell
cd C:\Users\26425\AI-Work\realtime-message-board\backend
npm run db:start
```

数据库监听 `127.0.0.1:55432`，开发库为 `message_board_dev`。首次启动会生成已被 Git 忽略的 `.env` 与 `.local`。停止数据库使用 `npm run db:stop`，或在数据库终端按 Ctrl+C。

### 2. 迁移并启动后端

在第二个终端：

```powershell
cd C:\Users\26425\AI-Work\realtime-message-board\backend
npm run migrate
npm run build
npm start
```

后端：`http://127.0.0.1:3000`。就绪检查：`http://127.0.0.1:3000/api/ready`。返回 200 且 `schema` 为 `ready` 才表示数据库和迁移可用。

### 3. 启动前端

在第三个终端：

```powershell
cd C:\Users\26425\AI-Work\realtime-message-board\frontend
npm run dev
```

访问：`http://127.0.0.1:5173`。前端通过 Vite 的 `/api` 代理连接后端。

## 管理员初始化

系统没有默认管理员。当前开发库已将 `inch` 账号设为管理员，不需要再执行初始化命令；只有全新数据库或还没有管理员时才需要下面的步骤。密码只从标准输入读取，不写入命令历史：

```powershell
cd C:\Users\26425\AI-Work\realtime-message-board\backend
$secret = Read-Host '初始管理员密码（12～128字符）' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
  [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) | npm run admin:create -- admin 管理员
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  Remove-Variable secret,pointer
}
```

已有管理员时该命令会拒绝再次创建。普通用户可在“工具 → 申请管理员权限”提交申请，由现有管理员审批。

## 验证

```powershell
cd backend
npm run typecheck
npm run build
npm test

cd ..\frontend
npm run typecheck
npm run build
```

`npm test` 只包含健康检查和配置单元测试；真实数据库的账号集成测试默认跳过。完整专项验收仍按用户安排在后续恢复，不应把当前检查当成全站验收。

## 数据与安全

- `.env`、`.env.test`、`backend/.local/`、`node_modules/`、`dist/`、截图产物都被 Git 忽略，不应提交。
- 发布前必须使用正式 PostgreSQL、HTTPS、独立密钥和数据库备份；项目内嵌 PostgreSQL 仅用于本地开发。
- 生产环境需要配置反向代理、`trustProxy` 和真实 IP，否则 IP 限流会共享代理地址。
- 管理员申请、账号禁用、管理员删除帖子都会写 `admin_audit_logs`。
