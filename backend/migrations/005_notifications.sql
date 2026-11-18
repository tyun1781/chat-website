-- In-site notifications. The first type is sent when an administrator deletes a post.
CREATE TABLE notifications (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id),
 type text NOT NULL CHECK(type IN ('message.deleted')),
 title varchar(120) NOT NULL CHECK(char_length(title) BETWEEN 1 AND 120),
 body varchar(500) NOT NULL CHECK(char_length(body) BETWEEN 1 AND 500),
 data jsonb NOT NULL DEFAULT '{}'::jsonb,
 read_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_page ON notifications(user_id,created_at DESC,id DESC);
CREATE INDEX notifications_user_unread ON notifications(user_id) WHERE read_at IS NULL;
