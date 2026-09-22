CREATE TABLE IF NOT EXISTS qiju_users (
  id uuid PRIMARY KEY,
  display_name varchar(20) NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'suspended', 'deactivated')),
  created_at timestamptz NOT NULL,
  last_active_at timestamptz NOT NULL
);

COMMENT ON TABLE qiju_users IS '棋聚玩家身份與基本個人資料。';

COMMENT ON COLUMN qiju_users.id IS '玩家唯一識別碼。';
COMMENT ON COLUMN qiju_users.display_name IS '玩家顯示名稱。';
COMMENT ON COLUMN qiju_users.status IS '玩家身份狀態。';
COMMENT ON COLUMN qiju_users.created_at IS '玩家身份建立時間。';
COMMENT ON COLUMN qiju_users.last_active_at IS '玩家最後活動時間。';

CREATE TABLE IF NOT EXISTS qiju_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES qiju_users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

COMMENT ON TABLE qiju_sessions IS '棋聚玩家的登入／訪客 session，僅保存 token 雜湊。';

COMMENT ON COLUMN qiju_sessions.id IS 'session 唯一識別碼。';
COMMENT ON COLUMN qiju_sessions.user_id IS 'session 所屬玩家身份。';
COMMENT ON COLUMN qiju_sessions.token_hash IS 'session token 的雜湊值。';
COMMENT ON COLUMN qiju_sessions.created_at IS 'session 建立時間。';
COMMENT ON COLUMN qiju_sessions.expires_at IS 'session 到期時間。';
COMMENT ON COLUMN qiju_sessions.revoked_at IS 'session 撤銷時間；尚未撤銷時為 NULL。';

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

COMMENT ON TABLE qiju_matches IS '棋聚對局主檔與生命週期、結果摘要。';

COMMENT ON COLUMN qiju_matches.id IS '對局唯一識別碼。';
COMMENT ON COLUMN qiju_matches.room_code IS '建立對局的房間代碼。';
COMMENT ON COLUMN qiju_matches.game IS '對局使用的棋種。';
COMMENT ON COLUMN qiju_matches.mode IS '對局模式。';
COMMENT ON COLUMN qiju_matches.status IS '對局生命週期狀態。';
COMMENT ON COLUMN qiju_matches.started_at IS '對局開始時間。';
COMMENT ON COLUMN qiju_matches.completed_at IS '對局完成時間；尚未完成時為 NULL。';
COMMENT ON COLUMN qiju_matches.outcome_json IS '對局結果摘要。';
COMMENT ON COLUMN qiju_matches.schema_version IS '對局資料格式版本。';
COMMENT ON COLUMN qiju_matches.retention_until IS '對局資料保留期限；沒有期限時為 NULL。';

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

COMMENT ON TABLE qiju_match_participants IS '棋聚對局參與者、座位與勝負結果。';

COMMENT ON COLUMN qiju_match_participants.match_id IS '所屬對局識別碼。';
COMMENT ON COLUMN qiju_match_participants.seat IS '對局中的座位索引。';
COMMENT ON COLUMN qiju_match_participants.user_id IS '綁定的玩家身份；匿名或已解除綁定時為 NULL。';
COMMENT ON COLUMN qiju_match_participants.display_name IS '玩家在該局使用的顯示名稱。';
COMMENT ON COLUMN qiju_match_participants.bot IS '是否為 AI 參與者。';
COMMENT ON COLUMN qiju_match_participants.result IS '參與者在該局的結果。';
COMMENT ON COLUMN qiju_match_participants.joined_at IS '參與者加入對局的時間。';

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

COMMENT ON TABLE qiju_match_events IS '棋聚對局事件流水，供稽核與必要的重建使用。';

COMMENT ON COLUMN qiju_match_events.match_id IS '所屬對局識別碼。';
COMMENT ON COLUMN qiju_match_events.sequence IS '對局內事件的遞增序號。';
COMMENT ON COLUMN qiju_match_events.event_type IS '事件類型。';
COMMENT ON COLUMN qiju_match_events.actor_seat IS '觸發事件的座位索引；系統事件時為 NULL。';
COMMENT ON COLUMN qiju_match_events.payload_json IS '事件內容。';
COMMENT ON COLUMN qiju_match_events.created_at IS '事件建立時間。';
COMMENT ON COLUMN qiju_match_events.schema_version IS '事件資料格式版本。';

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

COMMENT ON TABLE qiju_audit_log IS '棋聚產品操作稽核紀錄。';

COMMENT ON COLUMN qiju_audit_log.id IS '稽核紀錄唯一識別碼。';
COMMENT ON COLUMN qiju_audit_log.action IS '被記錄的操作名稱。';
COMMENT ON COLUMN qiju_audit_log.user_id IS '觸發操作的玩家身份；系統操作時為 NULL。';
COMMENT ON COLUMN qiju_audit_log.match_id IS '相關對局識別碼；無關聯時為 NULL。';
COMMENT ON COLUMN qiju_audit_log.request_id IS '外部請求識別碼。';
COMMENT ON COLUMN qiju_audit_log.metadata_json IS '操作附加資料。';
COMMENT ON COLUMN qiju_audit_log.created_at IS '稽核紀錄建立時間。';

CREATE INDEX IF NOT EXISTS qiju_audit_log_created_at_idx
  ON qiju_audit_log (created_at DESC);

ALTER TABLE qiju_rooms
  ADD COLUMN IF NOT EXISTS match_id uuid REFERENCES qiju_matches(id) ON DELETE SET NULL;

ALTER TABLE qiju_rooms
  ADD COLUMN IF NOT EXISTS event_sequence bigint NOT NULL DEFAULT 0 CHECK (event_sequence >= 0);

ALTER TABLE qiju_room_players
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES qiju_users(id) ON DELETE SET NULL;

COMMENT ON COLUMN qiju_rooms.match_id IS '關聯的產品對局識別碼。';
COMMENT ON COLUMN qiju_rooms.event_sequence IS '房間下一個對局事件序號。';
COMMENT ON COLUMN qiju_room_players.user_id IS '綁定的產品玩家身份；匿名座位時為 NULL。';
