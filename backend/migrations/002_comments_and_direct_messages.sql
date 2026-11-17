CREATE TABLE comments (
 id uuid PRIMARY KEY, message_id uuid NOT NULL REFERENCES messages(id),
 author_id uuid NOT NULL REFERENCES users(id), author_nickname varchar(32) NOT NULL,
 body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 500),
 created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE INDEX comments_page ON comments(message_id,created_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE TABLE comment_idempotency_keys (
 user_id uuid NOT NULL REFERENCES users(id), key uuid NOT NULL, request_hash char(64) NOT NULL,
 comment_id uuid NOT NULL REFERENCES comments(id), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,key)
);
ALTER TABLE message_events DROP CONSTRAINT message_events_event_type_check;
ALTER TABLE message_events ADD CONSTRAINT message_events_event_type_check CHECK(event_type IN ('message.created','message.deleted','comment.created','comment.deleted'));

CREATE TABLE dm_conversations (
 id uuid PRIMARY KEY, user_low uuid NOT NULL REFERENCES users(id), user_high uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_low,user_high), CHECK(user_low<user_high)
);
CREATE INDEX dm_conversations_low ON dm_conversations(user_low,created_at DESC,id DESC);
CREATE INDEX dm_conversations_high ON dm_conversations(user_high,created_at DESC,id DESC);
CREATE TABLE dm_messages (
 id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES dm_conversations(id),
 sender_id uuid NOT NULL REFERENCES users(id), sender_nickname varchar(32) NOT NULL,
 body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 500), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dm_messages_page ON dm_messages(conversation_id,created_at DESC,id DESC);
CREATE TABLE dm_idempotency_keys (
 user_id uuid NOT NULL REFERENCES users(id), key uuid NOT NULL, request_hash char(64) NOT NULL,
 message_id uuid NOT NULL REFERENCES dm_messages(id), created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,key)
);
CREATE TABLE dm_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES dm_conversations(id),
 event_type text NOT NULL CHECK(event_type IN ('conversation.created','dm.message.created')),
 payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dm_events_conversation ON dm_events(conversation_id,id);
