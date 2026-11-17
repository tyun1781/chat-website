SELECT pg_advisory_xact_lock(817462033);
ALTER TABLE messages ADD COLUMN tag varchar(16) NOT NULL DEFAULT 'daily'
 CHECK(tag IN ('daily','anime','games','music','share'));
CREATE INDEX messages_tag_page ON messages(tag,created_at DESC,id DESC) WHERE deleted_at IS NULL;

-- Additive payload upgrade: replaying old public events has the same tag as GET.
UPDATE message_events e
SET payload=jsonb_set(e.payload,'{message,tag}',to_jsonb(m.tag),true)
FROM messages m
WHERE e.message_id=m.id AND e.event_type='message.created';
