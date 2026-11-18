# 更新记录

## 2026-11-19

### 新增：注册必须绑定邮箱（验证码）

- 新用户注册时必须填写邮箱，并通过 6 位验证码验证，验证通过后 `users.email_verified_at` 落库。
- 新增接口 `POST /api/auth/email-code`：发送验证码，走 SMTP（`nodemailer`）。
- `POST /api/auth/register` 增加 `email`、`code` 两个字段。
- 新增数据库迁移 `006_email_verification.sql`：`email_verifications` 表。
- 前端注册表单新增邮箱、验证码输入框与「获取验证码」按钮（60 秒倒计时）。
- 安全限制：验证码 10 分钟有效、最多试 5 次、一次性消费；同 IP 每小时 10 次发码、同邮箱 5 次、注册 5 个账号。
- 未配置 SMTP 时站点正常运行，仅注册返回 `503 MAIL_NOT_CONFIGURED`。
- 历史账号（本功能上线前创建）不受影响。

### 修复：部署脚本误判失败

- `deploy.sh` 原先从服务器内部访问自己的公网域名做自检。云厂商一般不支持这种 hairpin 访问，会把成功部署误判为失败。
- 改为 `curl --resolve` 打到 `127.0.0.1`，仍走完整 TLS → Caddy → 反向代理链路，但不离开本机。
- 另外增加独立的「外网可达性」检查，443 不通时明确提示去云控制台放通端口。

### 修复：构建上下文缺少 Caddyfile

- `.dockerignore` 误将 `Caddyfile`、`Dockerfile`、`docker-compose.yml` 排除，导致 `COPY Caddyfile` 失败（`"/Caddyfile": not found`）。

### 新增：生产部署配置

- `Dockerfile`（多阶段构建 api / web 两个 target）
- `docker-compose.yml`（postgres + api + caddy，API 不对外发布端口）
- `Caddyfile`（自动 HTTPS、SPA 回退、SSE 不缓冲）
- `deploy.sh` / `setup-ubuntu.sh`（一键部署 / 服务器初始化）
- `DEPLOY.md`（完整部署指南）
- `config.ts` 新增 `TRUST_PROXY`：反向代理后取真实客户端 IP，否则限流会互相干扰。
