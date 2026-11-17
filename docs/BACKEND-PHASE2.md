# 后端第二阶段：账号闭环

日期：2026-11-17（Asia/Shanghai）。现有 API-CONTRACT.md 的接口形状保持不变。该文档的“未实现”描述属于第一阶段；本阶段实际完成情况以本文为准。

## 已实现

- 注册、登录、恢复会话、退出、昵称修改、密码修改。
- Argon2id：64 MiB、3 次、parallelism 1；用户名统一小写，密码按 Unicode 码点校验，不裁剪。
- 服务端会话和 CSRF token 仅保存 SHA-256 摘要；HttpOnly、SameSite=Lax Cookie，生产使用 Secure 和 __Host-session。
- 登录创建新会话；恢复会话轮换 CSRF；改密在事务内撤销全部会话；鉴权检查状态、有效期和撤销记录。
- 写接口严格验证 Origin、字段和 CSRF；默认注册 5 次/IP/小时，登录 20 次/IP/15 分钟、10 次/用户名/15 分钟；改密额外限制 20 次/IP/15 分钟。
- 管理员初始化命令，只允许系统尚无管理员时创建，密码从标准输入接收，没有默认密码。
- 密码、会话 token、CSRF 和数据库凭据不写入日志或业务响应。

## 本地 PostgreSQL

已安装项目内开发依赖 embedded-postgres 18.6.0-beta.19；npm 锁文件固定版本和完整性。它提供实际 PostgreSQL 18.6 Windows x64 二进制，不是内存模拟。

来源：npm registry https://registry.npmjs.org/ ，项目 https://github.com/leinelissen/embedded-postgres ，上游二进制项目 https://github.com/zonkyio/embedded-postgres 。包版本带 beta 指包装器版本，不代表用于公网的生产部署方案。

仅监听 127.0.0.1:55432，无系统服务、无全局安装。数据位于 backend/.local/pgdata，随机生成的本地凭据位于 .local/database.json；应用使用非超级用户 message_board，独立 message_board_dev 和 message_board_test 两个数据库。.local、.env 和 .env.test 已被忽略，不应上传。

在 backend 目录执行：

```powershell
npm ci
npm run db:start
```

数据库命令持续运行。在另一个终端执行：

```powershell
npm run migrate
npm run build
npm start
```

服务默认 http://127.0.0.1:3000；就绪检查 /api/ready。首次 db:start 自动生成 .env 和 .env.test，已有文件不覆盖。若文件存在且指向别处，需先自行核对。停止数据库可在数据库终端按 Ctrl+C，或在另一终端执行 npm run db:stop。只停止本项目实例，不删除数据。

前端允许来源：http://localhost:5173、http://127.0.0.1:5173、http://127.0.0.1:3000。可通过 ALLOWED_ORIGINS 逗号列表配置。生产必须显式配置 HTTPS 来源。

测试库迁移和独立测试服务：

```powershell
$env:DOTENV_CONFIG_PATH='.env.test'
npm run migrate
$env:PORT='3001'
npm start
```

测试请求 Origin 使用上述允许来源，例如 http://localhost:5173。测试进程保留真实限流；重新启动该进程会重置内存限流桶，数据库内容保持。

管理员初始化（在开发库配置下）：

```powershell
$secret = Read-Host '初始管理员密码（12～128字符）' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
  [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) | npm run admin:create -- admin 管理员
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  Remove-Variable secret,pointer
}
```

这不会把密码字面量写入命令历史。没有预先创建默认管理员。

## 验证结果

- npm run typecheck、npm run build 通过。
- 原有 3 项健康/配置单元测试通过。
- 开发库初始迁移实际成功；再次迁移不重复执行。独立测试库初始迁移成功。
- 开发服务 3000、测试服务 3001 的 /api/ready 实际均返回 200，database=up、schema=ready。
- npm run test:integration 使用真实 message_board_test，账号生命周期测试通过：注册和重复账号、未知字段拒绝、Origin 拒绝、Argon2id 存储、Cookie 属性、摘要存储、错误密码、CSRF 轮换和拒绝、资料修改、多会话改密失效、旧密码失效、退出失效、重复退出、禁用账号及限流。只清理该次随机 it_ 用户。
- 测试命令 npm test 默认跳过真实库测试；使用 npm run test:integration 明确执行真实库验证。真实库测试拒绝使用非 message_board_test 数据库。

## 后续范围及限制

留言、SSE、管理员管理接口、邮箱验证和找回密码尚未实现。不能据账号成功宣称完整留言网站完成。

限流为单进程内存实现，适合当前单实例；多实例需要共享限流存储。真实库集成测试不等同浏览器端验收，前端和测试 agent 继续联调。迁移防篡改和失败回滚的故障注入仍需后续专项验证；本阶段已验证真实初始化及重复迁移。
