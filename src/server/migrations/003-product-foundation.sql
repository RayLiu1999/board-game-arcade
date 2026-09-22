CREATE TABLE IF NOT EXISTS qiju_users (
  id uuid PRIMARY KEY,
  display_name varchar(20) NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'suspended', 'deactivated')),
  created_at timestamptz NOT NULL,
  last_active_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS qiju_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES qiju_users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS qiju_sessions_user_id_idx
  ON qiju_sessions (user_id);

CREATE INDEX IF NOT EXISTS qiju_sessions_expires_at_idx
  ON qiju_sessions (expires_at);

CREATE TABLE IF NOT EXISTS qiju_matches (
  id uuid PRIMARY KEY,
  room_code varchar(6) NOT NULL,
  game text NOT NULL CHECK (
    game IN ('shogi', 'chess', 'xiangqi', 'checkers', 'gomoku', 'go', 'reversi', 'riichi')
  ),
  mode text NOT NULL CHECK (mode IN ('ai', 'local', 'friend', 'rated')),
  status text NOT NULL CHECK (
    status IN ('active', 'completed', 'cancelled', 'aborted')
  ),
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  outcome_json jsonb,
  schema_version integer NOT NULL CHECK (schema_version > 0),
  retention_until timestamptz
);

CREATE INDEX IF NOT EXISTS qiju_matches_room_code_idx
  ON qiju_matches (room_code);

CREATE INDEX IF NOT EXISTS qiju_matches_started_at_idx
  ON qiju_matches (started_at DESC);

CREATE TABLE IF NOT EXISTS qiju_match_participants (
  match_id uuid NOT NULL REFERENCES qiju_matches(id) ON DELETE CASCADE,
  seat smallint NOT NULL CHECK (seat >= 0),
  user_id uuid REFERENCES qiju_users(id) ON DELETE SET NULL,
  display_name varchar(20) NOT NULL,
  bot boolean NOT NULL DEFAULT false,
  result text NOT NULL DEFAULT 'unknown' CHECK (
    result IN ('win', 'loss', 'draw', 'unknown')
  ),
  joined_at timestamptz NOT NULL,
  PRIMARY KEY (match_id, seat)
);

CREATE TABLE IF NOT EXISTS qiju_match_events (
  match_id uuid NOT NULL REFERENCES qiju_matches(id) ON DELETE CASCADE,
  sequence bigint NOT NULL CHECK (sequence > 0),
  event_type text NOT NULL,
  actor_seat smallint CHECK (actor_seat IS NULL OR actor_seat >= 0),
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  schema_version integer NOT NULL CHECK (schema_version > 0),
  PRIMARY KEY (match_id, sequence)
);

CREATE INDEX IF NOT EXISTS qiju_match_events_created_at_idx
  ON qiju_match_events (created_at);

CREATE TABLE IF NOT EXISTS qiju_audit_log (
  id uuid PRIMARY KEY,
  action text NOT NULL,
  user_id uuid REFERENCES qiju_users(id) ON DELETE SET NULL,
  match_id uuid REFERENCES qiju_matches(id) ON DELETE SET NULL,
  request_id text,
  metadata_json jsonb NOT NULL DEFAULT 'null'::jsonb,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS qiju_audit_log_created_at_idx
  ON qiju_audit_log (created_at DESC);

ALTER TABLE qiju_rooms
  ADD COLUMN IF NOT EXISTS match_id uuid REFERENCES qiju_matches(id) ON DELETE SET NULL;

ALTER TABLE qiju_rooms
  ADD COLUMN IF NOT EXISTS event_sequence bigint NOT NULL DEFAULT 0 CHECK (event_sequence >= 0);

ALTER TABLE qiju_room_players
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES qiju_users(id) ON DELETE SET NULL;
