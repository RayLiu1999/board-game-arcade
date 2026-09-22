CREATE TABLE IF NOT EXISTS qiju_user_preferences (
  user_id uuid PRIMARY KEY REFERENCES qiju_users(id) ON DELETE CASCADE,
  locale varchar(16) NOT NULL DEFAULT 'zh-Hant',
  theme text NOT NULL DEFAULT 'system' CHECK (theme IN ('system', 'light', 'dark')),
  sound_enabled boolean NOT NULL DEFAULT true,
  history_public boolean NOT NULL DEFAULT false,
  friend_invites boolean NOT NULL DEFAULT true,
  show_online_status boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL
);

COMMENT ON TABLE qiju_user_preferences IS '棋聚玩家的個人偏好設定。';

COMMENT ON COLUMN qiju_user_preferences.user_id IS '偏好設定所屬的玩家身份。';
COMMENT ON COLUMN qiju_user_preferences.locale IS '玩家偏好的語言地區。';
COMMENT ON COLUMN qiju_user_preferences.theme IS '玩家偏好的顯示主題。';
COMMENT ON COLUMN qiju_user_preferences.sound_enabled IS '是否啟用音效。';
COMMENT ON COLUMN qiju_user_preferences.history_public IS '是否允許公開查看對局歷史。';
COMMENT ON COLUMN qiju_user_preferences.friend_invites IS '是否接受好友邀請。';
COMMENT ON COLUMN qiju_user_preferences.show_online_status IS '是否顯示線上狀態。';
COMMENT ON COLUMN qiju_user_preferences.updated_at IS '偏好設定最後更新時間。';
