ALTER TABLE qiju_matches
  DROP CONSTRAINT IF EXISTS qiju_matches_mode_check;

ALTER TABLE qiju_matches
  ADD CONSTRAINT qiju_matches_mode_check CHECK (
    mode IN ('ai', 'local', 'friend', 'public', 'rated')
  );

COMMENT ON CONSTRAINT qiju_matches_mode_check ON qiju_matches IS
  '對局模式允許 AI、同機、好友房、公開配對與 rated 競技房。';
