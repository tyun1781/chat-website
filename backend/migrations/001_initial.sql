CREATE TABLE users (
 id uuid PRIMARY KEY, username varchar(32) NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_]{3,32}$'),
 nickname varchar(32) NOT NULL CHECK (char_length(nickname) BETWEEN 1 AND 32), password_hash text NOT NULL,
 role text NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
 email varchar(254), email_verified_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_unique ON users(lower(email)) WHERE email IS NOT NULL;
CREATE TABLE sessions (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), token_hash char(64) NOT NULL UNIQUE,
 csrf_token_hash char(64) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 revoked_at timestamptz, CHECK(expires_at>created_at)
);
CREATE INDEX sessions_user_id ON sessions(user_id);
CREATE INDEX sessions_expires_at ON sessions(expires_at);
CREATE TABLE messages (
 id uuid PRIMARY KEY, author_id uuid NOT NULL REFERENCES users(id), author_nickname varchar(32) NOT NULL,
 body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 500), created_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz, deleted_by uuid REFERENCES users(id)
);
CREATE INDEX messages_page ON messages(created_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX messages_author ON messages(author_id);
CREATE TABLE idempotency_keys (
 user_id uuid NOT NULL REFERENCES users(id), key uuid NOT NULL, request_hash char(64) NOT NULL,
 message_id uuid NOT NULL REFERENCES messages(id), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,key)
);
CREATE TABLE message_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 event_type text NOT NULL CHECK(event_type IN ('message.created','message.deleted')),
 message_id uuid NOT NULL REFERENCES messages(id), payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX message_events_created ON message_events(created_at);
CREATE TABLE admin_audit_logs (
 id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES users(id), action text NOT NULL,
 target_type text NOT NULL CHECK(target_type IN ('user','message')), target_id uuid NOT NULL,
 reason varchar(500), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_created ON admin_audit_logs(created_at DESC);
