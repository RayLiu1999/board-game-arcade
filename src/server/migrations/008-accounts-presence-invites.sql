ALTER TABLE qiju_users
  ADD COLUMN IF NOT EXISTS public_code varchar(13),
  ADD COLUMN IF NOT EXISTS login_name varchar(24),
  ADD COLUMN IF NOT EXISTS password_hash varchar(256);

DO $$
DECLARE
  user_row record;
  generated_code varchar(13);
BEGIN
  FOR user_row IN
    SELECT id FROM qiju_users WHERE public_code IS NULL ORDER BY id
  LOOP
    LOOP
      generated_code := 'QJ-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM qiju_users WHERE public_code = generated_code
      );
    END LOOP;
    UPDATE qiju_users SET public_code = generated_code WHERE id = user_row.id;
  END LOOP;
END $$;

ALTER TABLE qiju_users
  ALTER COLUMN public_code SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'qiju_users'::regclass
      AND conname = 'qiju_users_public_code_format'
  ) THEN
    ALTER TABLE qiju_users
      ADD CONSTRAINT qiju_users_public_code_format
      CHECK (public_code ~ '^QJ-[0-9A-F]{10}$');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'qiju_users'::regclass
      AND conname = 'qiju_users_account_pair'
  ) THEN
    ALTER TABLE qiju_users
      ADD CONSTRAINT qiju_users_account_pair
      CHECK ((login_name IS NULL) = (password_hash IS NULL));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'qiju_users'::regclass
      AND conname = 'qiju_users_login_name_format'
  ) THEN
    ALTER TABLE qiju_users
      ADD CONSTRAINT qiju_users_login_name_format
      CHECK (login_name IS NULL OR login_name ~ '^[a-z0-9][a-z0-9_]{2,23}$');
  END IF;
END $$;

COMMENT ON COLUMN qiju_users.public_code IS '玩家可分享的非機密代碼，不可用來登入或重連房間。';
COMMENT ON COLUMN qiju_users.login_name IS '跨裝置登入帳號；以小寫 ASCII 正規化，未升級訪客時為 NULL。';
COMMENT ON COLUMN qiju_users.password_hash IS '密碼的 scrypt 驗證值與隨機 salt，不保存原始密碼；僅供伺服器驗證且不得由 API 輸出。';
COMMENT ON CONSTRAINT qiju_users_public_code_format ON qiju_users IS '玩家代碼固定為 QJ- 加 10 位大寫十六進位字元。';
COMMENT ON CONSTRAINT qiju_users_account_pair ON qiju_users IS '登入帳號與密碼驗證值必須同時存在或同時為 NULL。';
COMMENT ON CONSTRAINT qiju_users_login_name_format ON qiju_users IS '登入帳號僅允許小寫英數字與底線，且以英數字開頭。';

CREATE UNIQUE INDEX IF NOT EXISTS qiju_users_public_code_uidx
  ON qiju_users (public_code);
COMMENT ON INDEX qiju_users_public_code_uidx IS '確保分享用玩家代碼全站唯一。';

CREATE UNIQUE INDEX IF NOT EXISTS qiju_users_login_name_uidx
  ON qiju_users (login_name)
  WHERE login_name IS NOT NULL;
COMMENT ON INDEX qiju_users_login_name_uidx IS '確保已升級帳號的登入名稱唯一。';

ALTER TABLE qiju_user_preferences
  ADD COLUMN IF NOT EXISTS show_in_leaderboard boolean NOT NULL DEFAULT false;
ALTER TABLE qiju_user_preferences
  ALTER COLUMN show_online_status SET DEFAULT false;
UPDATE qiju_user_preferences
SET show_online_status = false
WHERE show_online_status = true;
COMMENT ON COLUMN qiju_user_preferences.show_in_leaderboard IS '是否同意以顯示名稱與評分出現在公開排行榜；預設不公開。';
COMMENT ON COLUMN qiju_user_preferences.show_online_status IS '是否同意好友查看上線狀態；預設不公開，需由玩家主動開啟。';

CREATE TABLE IF NOT EXISTS qiju_user_presence (
  connection_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES qiju_users(id) ON DELETE CASCADE,
  touched_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT qiju_user_presence_expiry_check CHECK (expires_at > touched_at)
);

COMMENT ON TABLE qiju_user_presence IS '玩家即時連線租約；每列代表一條已驗證的 WebSocket 連線，過期即視為離線。';
COMMENT ON COLUMN qiju_user_presence.connection_id IS '單一 WebSocket 連線的隨機識別碼，不是玩家憑證。';
COMMENT ON COLUMN qiju_user_presence.user_id IS '已驗證 session 所屬玩家身份。';
COMMENT ON COLUMN qiju_user_presence.touched_at IS '伺服器最近一次確認此連線存活的時間。';
COMMENT ON COLUMN qiju_user_presence.expires_at IS '連線租約到期時間；逾期資料不會被當成上線。';
COMMENT ON CONSTRAINT qiju_user_presence_expiry_check ON qiju_user_presence IS '連線租約到期時間必須晚於最近確認時間。';

CREATE INDEX IF NOT EXISTS qiju_user_presence_user_expiry_idx
  ON qiju_user_presence (user_id, expires_at);
COMMENT ON INDEX qiju_user_presence_user_expiry_idx IS '依玩家與租約到期時間查詢仍有效的多裝置連線。';

CREATE TABLE IF NOT EXISTS qiju_room_invites (
  id uuid PRIMARY KEY,
  room_code varchar(6) NOT NULL REFERENCES qiju_rooms(code) ON DELETE CASCADE,
  game text NOT NULL CONSTRAINT qiju_room_invites_game_valid CHECK (
    game IN ('shogi', 'riichi', 'chess', 'xiangqi', 'checkers', 'gomoku', 'go', 'reversi')
  ),
  inviter_id uuid NOT NULL REFERENCES qiju_users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES qiju_users(id) ON DELETE CASCADE,
  status text NOT NULL CONSTRAINT qiju_room_invites_status_valid CHECK (
    status IN ('pending', 'accepted', 'rejected', 'joined', 'cancelled')
  ),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  responded_at timestamptz,
  entry_token_hash char(64),
  entry_token_expires_at timestamptz,
  CONSTRAINT qiju_room_invites_not_self CHECK (inviter_id <> recipient_id),
  CONSTRAINT qiju_room_invites_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT qiju_room_invites_entry_pair_complete CHECK (
    (status IN ('accepted', 'joined') AND
      entry_token_hash IS NOT NULL AND entry_token_expires_at IS NOT NULL)
    OR
    (status NOT IN ('accepted', 'joined') AND
      entry_token_hash IS NULL AND entry_token_expires_at IS NULL)
  )
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'qiju_room_invites'::regclass
      AND conname = 'qiju_room_invites_game_valid'
  ) THEN
    ALTER TABLE qiju_room_invites
      ADD CONSTRAINT qiju_room_invites_game_valid CHECK (
        game IN ('shogi', 'riichi', 'chess', 'xiangqi', 'checkers', 'gomoku', 'go', 'reversi')
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'qiju_room_invites'::regclass
      AND conname = 'qiju_room_invites_status_valid'
  ) THEN
    ALTER TABLE qiju_room_invites
      ADD CONSTRAINT qiju_room_invites_status_valid CHECK (
        status IN ('pending', 'accepted', 'rejected', 'joined', 'cancelled')
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'qiju_room_invites'::regclass
      AND conname = 'qiju_room_invites_entry_pair_complete'
  ) THEN
    ALTER TABLE qiju_room_invites
      ADD CONSTRAINT qiju_room_invites_entry_pair_complete CHECK (
        (status IN ('accepted', 'joined') AND
          entry_token_hash IS NOT NULL AND entry_token_expires_at IS NOT NULL)
        OR
        (status NOT IN ('accepted', 'joined') AND
          entry_token_hash IS NULL AND entry_token_expires_at IS NULL)
      );
  END IF;
END $$;

COMMENT ON TABLE qiju_room_invites IS '好友加入指定私人房間的短期授權；每列代表一位邀請對象的一次邀請。';
COMMENT ON COLUMN qiju_room_invites.id IS '房間邀請識別碼，僅用於定位資料，不單獨授予加入權限。';
COMMENT ON COLUMN qiju_room_invites.room_code IS '邀請所屬房間代碼；房間刪除時一併刪除邀請。';
COMMENT ON COLUMN qiju_room_invites.game IS '邀請房間使用的棋種，供收件者辨識邀請。';
COMMENT ON COLUMN qiju_room_invites.inviter_id IS '發出房間邀請的玩家身份。';
COMMENT ON COLUMN qiju_room_invites.recipient_id IS '唯一可接受此邀請的玩家身份。';
COMMENT ON COLUMN qiju_room_invites.status IS '邀請狀態：pending、accepted、rejected、joined 或 cancelled。';
COMMENT ON COLUMN qiju_room_invites.created_at IS '邀請建立時間。';
COMMENT ON COLUMN qiju_room_invites.expires_at IS '邀請最晚接受時間；過期邀請不可使用。';
COMMENT ON COLUMN qiju_room_invites.responded_at IS '接受或拒絕時間；尚未回覆時為 NULL。';
COMMENT ON COLUMN qiju_room_invites.entry_token_hash IS '接受後一次性房間進入 token 的 SHA-256 雜湊，不保存原始 token。';
COMMENT ON COLUMN qiju_room_invites.entry_token_expires_at IS '一次性房間進入 token 的短期到期時間。';
COMMENT ON CONSTRAINT qiju_room_invites_game_valid ON qiju_room_invites IS '房間邀請只能指向目前支援的棋種。';
COMMENT ON CONSTRAINT qiju_room_invites_status_valid ON qiju_room_invites IS '限制房間邀請只能使用明確定義的生命週期狀態。';
COMMENT ON CONSTRAINT qiju_room_invites_not_self ON qiju_room_invites IS '禁止玩家邀請自己進入房間。';
COMMENT ON CONSTRAINT qiju_room_invites_expiry_check ON qiju_room_invites IS '邀請到期時間必須晚於建立時間。';
COMMENT ON CONSTRAINT qiju_room_invites_entry_pair_complete ON qiju_room_invites IS 'accepted 與 joined 狀態必須保存完整短期 token 雜湊與到期時間，其餘狀態不可保留進房憑證。';

CREATE UNIQUE INDEX IF NOT EXISTS qiju_room_invites_active_pair_uidx
  ON qiju_room_invites (room_code, recipient_id)
  WHERE status IN ('pending', 'accepted');
COMMENT ON INDEX qiju_room_invites_active_pair_uidx IS '同一房間不可同時存在兩筆對同一玩家有效的邀請。';

CREATE INDEX IF NOT EXISTS qiju_room_invites_recipient_pending_idx
  ON qiju_room_invites (recipient_id, created_at DESC)
  WHERE status = 'pending';
COMMENT ON INDEX qiju_room_invites_recipient_pending_idx IS '快速列出玩家尚未處理的房間邀請。';
