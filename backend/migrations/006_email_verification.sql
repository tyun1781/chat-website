-- 注册改为必须绑定邮箱，并记录邮箱验证码。
--
-- 注意：历史账号（本规则上线前创建）的 email 仍可能为 NULL，因此不在数据库层
-- 加 NOT NULL 约束，而是在 /api/auth/email-code 与 /api/auth/register 中强制校验。
-- 这样已有数据不受影响，新注册的账号一定带已验证邮箱。

CREATE TABLE email_verifications (
 id uuid PRIMARY KEY,
 email varchar(254) NOT NULL CHECK (email = lower(email)),
 code_hash char(64) NOT NULL,
 attempts smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0),
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (expires_at > created_at)
);

CREATE INDEX email_verifications_lookup ON email_verifications(lower(email), created_at DESC);
CREATE INDEX email_verifications_expiry ON email_verifications(expires_at);
