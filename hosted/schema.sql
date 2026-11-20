CREATE TABLE connections (
  id uuid PRIMARY KEY,
  client_id text NOT NULL,
  redirect_uri text NOT NULL,
  challenge text NOT NULL,
  code_hash text UNIQUE,
  code_until timestamptz NOT NULL,
  access_hash text UNIQUE,
  encrypted_grant text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX ON connections (expires_at);
