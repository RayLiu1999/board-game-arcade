CREATE TABLE IF NOT EXISTS qiju_rooms (
  code varchar(6) PRIMARY KEY,
  game text NOT NULL CHECK (
    game IN ('shogi', 'chess', 'xiangqi', 'checkers', 'gomoku', 'go', 'reversi')
  ),
  state_json jsonb NOT NULL,
  rounds smallint NOT NULL CHECK (rounds BETWEEN 0 AND 2),
  rematch_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  touched_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS qiju_room_players (
  room_code varchar(6) NOT NULL REFERENCES qiju_rooms(code) ON DELETE CASCADE,
  seat smallint NOT NULL CHECK (seat BETWEEN 0 AND 1),
  name varchar(20) NOT NULL,
  token_hash char(64) NOT NULL,
  bot boolean NOT NULL DEFAULT false,
  PRIMARY KEY (room_code, seat)
);

CREATE INDEX IF NOT EXISTS qiju_rooms_expires_at_idx
  ON qiju_rooms (expires_at);
