# 实时公共留言板 · 第一阶段

工程位置：`C:\Users\26425\AI-Work\realtime-message-board`。

本阶段完成后端骨架、PostgreSQL 初始迁移、健康检查和接口契约；注册登录、留言业务、管理后台和 SSE 尚未实现。完整契约见 `docs/API-CONTRACT.md`。

## 本地启动

要求 Node.js 22+、npm、PostgreSQL 16+。在 PowerShell 中：

```powershell
cd C:\Users\26425\AI-Work\realtime-message-board\backend
npm ci
Copy-Item .env.example .env
# 将 .env 的 DATABASE_URL 修改为你专用于本项目的开发数据库连接。
npm run migrate
npm run dev
```

默认监听 `127.0.0.1:3000`。数据库就绪检查：http://127.0.0.1:3000/api/ready；进程检查：http://127.0.0.1:3000/api/health。没有数据库时进程仍可启动，但 ready 必须503，不能据 health 200宣称项目已完整可用。

需要新建隔离开发数据库时，在已有 PostgreSQL 管理连接中执行（自行替换开发密码，切勿用于生产）：

```sql
CREATE ROLE message_board LOGIN PASSWORD 'replace-with-local-development-password';
CREATE DATABASE message_board_dev OWNER message_board;
```

不要改动已有业务数据库。当前阶段没有自动安装 PostgreSQL、Docker 或系统服务，也没有默认管理员账号。迁移会使用当前 DATABASE_URL 指向的库，运行前务必核对库名。

## 构建和验证

```powershell
npm run typecheck
npm test
npm run build
npm start
```

单元测试使用替身数据库，只验证健康检查分支及配置检查；不能证明真实 PostgreSQL 可连接或迁移通过。实际验证记录见 `docs/VALIDATION.md`。

## 结构和设计

- `backend/src/app.ts`：应用工厂，健康接口和统一错误处理。
- `backend/src/server.ts`：监听、连接池生命周期和优雅关闭。
- `backend/src/migrate.ts`：排序执行 SQL，迁移级事务、advisory lock、校验和防止修改已应用迁移。使用 `npm run migrate`（源码执行），无自动回滚；撤销结构需新建迁移。
- `backend/migrations/001_initial.sql`：用户、会话、留言、请求幂等、事件历史、管理审计。
- `backend/.env.example`：示例配置；真实 `.env` 已忽略，不提交。

UUID 由应用的 crypto.randomUUID 生成；创建时间由数据库生成；更新用户时应用须显式维护 updated_at。用户名小写唯一，公开昵称为留言发布时快照。角色/状态、长度、引用关系也有数据库约束。软删除保留审计依据；只查询未删除留言。

密码、会话、CSRF、管理员初始化及事务一致性细节见接口契约；这些是下一阶段实施要求，当前未实现认证模块。初始迁移的邮箱字段仅预留。事件与幂等记录第一版不自动清理，上线前制定保留和备份计划。

公网部署未执行；未来使用 HTTPS、反向代理、独立凭证、数据库备份，并按契约配置 SSE。不要直接把本地示例密码用于公网。
