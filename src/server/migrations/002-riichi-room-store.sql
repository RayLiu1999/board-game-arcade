ALTER TABLE qiju_rooms
  ADD COLUMN IF NOT EXISTS riichi_json jsonb;

COMMENT ON COLUMN qiju_rooms.riichi_json IS '日麻進行中的 session 快照。';

ALTER TABLE qiju_rooms
  DROP CONSTRAINT IF EXISTS qiju_rooms_game_check,
  DROP CONSTRAINT IF EXISTS qiju_rooms_game_check_v2;

ALTER TABLE qiju_rooms
  ADD CONSTRAINT qiju_rooms_game_check_v2 CHECK (
    game IN ('shogi', 'chess', 'xiangqi', 'checkers', 'gomoku', 'go', 'reversi', 'riichi')
  );

ALTER TABLE qiju_room_players
  DROP CONSTRAINT IF EXISTS qiju_room_players_seat_check,
  DROP CONSTRAINT IF EXISTS qiju_room_players_seat_check_v2;

ALTER TABLE qiju_room_players
  ADD CONSTRAINT qiju_room_players_seat_check_v2 CHECK (seat BETWEEN 0 AND 3);
