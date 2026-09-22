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
