CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  player_id uuid REFERENCES players(id),
  operator text,
  admin_expires_at timestamptz,
  csrf text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE email_tokens (
  token_hash text PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES players(id),
  email text NOT NULL,
  purpose text NOT NULL CHECK(purpose IN ('verify','recover')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE INDEX email_tokens_player ON email_tokens(player_id, purpose);
CREATE TABLE rate_limits (
  key text PRIMARY KEY,
  count integer NOT NULL DEFAULT 1,
  resets_at timestamptz NOT NULL
);
