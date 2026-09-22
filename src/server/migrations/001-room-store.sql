CREATE TABLE IF NOT EXISTS qiju_rooms (
  code varchar(6) PRIMARY KEY,
  game text NOT NULL CHECK (
    game IN ('shogi', 'chess', 'xiangqi', 'checkers', 'gomoku', 'go', 'reversi', 'riichi')
  ),
  state_json jsonb NOT NULL,
  riichi_json jsonb,
  rounds smallint NOT NULL CHECK (rounds BETWEEN 0 AND 2),
  rematch_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  touched_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

COMMENT ON TABLE qiju_rooms IS '棋聚進行中的遊戲房間與可恢復狀態。';

COMMENT ON COLUMN qiju_rooms.code IS '房間代碼。';
COMMENT ON COLUMN qiju_rooms.game IS '房間使用的棋種。';
COMMENT ON COLUMN qiju_rooms.state_json IS '一般棋類目前棋局狀態快照。';
COMMENT ON COLUMN qiju_rooms.riichi_json IS '日麻進行中的 session 快照。';
COMMENT ON COLUMN qiju_rooms.rounds IS '日麻對局回合設定。';
COMMENT ON COLUMN qiju_rooms.rematch_json IS '同意再戰的座位清單。';
COMMENT ON COLUMN qiju_rooms.revision IS '房間快照的樂觀鎖版本。';
COMMENT ON COLUMN qiju_rooms.touched_at IS '房間最後活動時間。';
COMMENT ON COLUMN qiju_rooms.expires_at IS '房間過期時間。';

CREATE TABLE IF NOT EXISTS qiju_room_players (
  room_code varchar(6) NOT NULL REFERENCES qiju_rooms(code) ON DELETE CASCADE,
  seat smallint NOT NULL CHECK (seat BETWEEN 0 AND 3),
  name varchar(20) NOT NULL,
  token_hash char(64) NOT NULL,
  bot boolean NOT NULL DEFAULT false,
  PRIMARY KEY (room_code, seat)
);

COMMENT ON TABLE qiju_room_players IS '棋聚房間中的玩家座位、重連 token 雜湊與身份綁定。';

COMMENT ON COLUMN qiju_room_players.room_code IS '所屬房間代碼。';
COMMENT ON COLUMN qiju_room_players.seat IS '房間內座位索引。';
COMMENT ON COLUMN qiju_room_players.name IS '玩家在房間中的顯示名稱。';
COMMENT ON COLUMN qiju_room_players.token_hash IS '重連 token 的雜湊值。';
COMMENT ON COLUMN qiju_room_players.bot IS '是否為 AI 玩家。';

CREATE INDEX IF NOT EXISTS qiju_rooms_expires_at_idx
  ON qiju_rooms (expires_at);
