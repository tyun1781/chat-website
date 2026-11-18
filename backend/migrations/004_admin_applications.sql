-- Administrator applications. A user can have at most one pending application.
CREATE TABLE admin_applications (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id),
 statement varchar(500) NOT NULL CHECK(char_length(statement) BETWEEN 1 AND 500),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 reviewed_by uuid REFERENCES users(id),
 reviewed_at timestamptz,
 review_reason varchar(500),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(
  (status='pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
  OR (status IN ('approved','rejected') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
 )
);
CREATE UNIQUE INDEX admin_applications_one_pending ON admin_applications(user_id) WHERE status='pending';
CREATE INDEX admin_applications_page ON admin_applications(created_at DESC,id DESC);
CREATE INDEX admin_applications_status_page ON admin_applications(status,created_at DESC,id DESC);
