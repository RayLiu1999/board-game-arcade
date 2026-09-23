CREATE TABLE IF NOT EXISTS qiju_friend_requests (
  id uuid PRIMARY KEY,
  requester_id uuid NOT NULL REFERENCES qiju_users(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES qiju_users(id) ON DELETE CASCADE,
  status text NOT NULL CONSTRAINT qiju_friend_requests_status_valid CHECK (
    status IN ('pending', 'accepted', 'rejected', 'cancelled')
  ),
  created_at timestamptz NOT NULL,
  responded_at timestamptz,
  CONSTRAINT qiju_friend_requests_distinct_users CHECK (requester_id <> recipient_id),
  CONSTRAINT qiju_friend_requests_response_timestamp CHECK (
    (status = 'pending' AND responded_at IS NULL) OR
    (status <> 'pending' AND responded_at IS NOT NULL)
  )
);

COMMENT ON TABLE qiju_friend_requests IS
  '棋聚玩家之間的好友邀請與處理狀態；一列代表一筆單向邀請及其終態。';

COMMENT ON COLUMN qiju_friend_requests.id IS '好友邀請的唯一識別碼。';
COMMENT ON COLUMN qiju_friend_requests.requester_id IS '提出好友邀請的玩家身份。';
COMMENT ON COLUMN qiju_friend_requests.recipient_id IS '收到好友邀請的玩家身份。';
COMMENT ON COLUMN qiju_friend_requests.status IS '邀請狀態：pending、accepted、rejected 或 cancelled。';
COMMENT ON COLUMN qiju_friend_requests.created_at IS '邀請建立時間。';
COMMENT ON COLUMN qiju_friend_requests.responded_at IS '邀請離開待處理狀態的時間；pending 時為 NULL。';
COMMENT ON CONSTRAINT qiju_friend_requests_status_valid ON qiju_friend_requests IS
  '限制好友邀請只能使用明確定義的生命週期狀態。';
COMMENT ON CONSTRAINT qiju_friend_requests_distinct_users ON qiju_friend_requests IS
  '禁止玩家向自己的身份送出好友邀請。';
COMMENT ON CONSTRAINT qiju_friend_requests_response_timestamp ON qiju_friend_requests IS
  '待處理邀請沒有回覆時間，任何終態邀請都必須記錄回覆時間。';

CREATE UNIQUE INDEX IF NOT EXISTS qiju_friend_requests_pending_pair_idx
  ON qiju_friend_requests (
    LEAST(requester_id, recipient_id),
    GREATEST(requester_id, recipient_id)
  )
  WHERE status = 'pending';
COMMENT ON INDEX qiju_friend_requests_pending_pair_idx IS
  '每對玩家同一時間最多有一筆待處理邀請，無論邀請方向為何。';

CREATE INDEX IF NOT EXISTS qiju_friend_requests_recipient_pending_idx
  ON qiju_friend_requests (recipient_id, created_at)
  WHERE status = 'pending';
COMMENT ON INDEX qiju_friend_requests_recipient_pending_idx IS
  '快速列出玩家收到且尚未處理的好友邀請。';

CREATE INDEX IF NOT EXISTS qiju_friend_requests_requester_pending_idx
  ON qiju_friend_requests (requester_id, created_at)
  WHERE status = 'pending';
COMMENT ON INDEX qiju_friend_requests_requester_pending_idx IS
  '快速列出玩家送出且尚未處理的好友邀請。';

CREATE INDEX IF NOT EXISTS qiju_friend_requests_pair_history_idx
  ON qiju_friend_requests (
    LEAST(requester_id, recipient_id),
    GREATEST(requester_id, recipient_id),
    created_at DESC,
    id DESC
  );
COMMENT ON INDEX qiju_friend_requests_pair_history_idx IS
  '依玩家對查詢好友邀請歷史，並可按時間倒序排列。';

CREATE TABLE IF NOT EXISTS qiju_friendships (
  user_low uuid NOT NULL REFERENCES qiju_users(id) ON DELETE CASCADE,
  user_high uuid NOT NULL REFERENCES qiju_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_low, user_high),
  CONSTRAINT qiju_friendships_sorted_pair CHECK (user_low < user_high)
);

COMMENT ON TABLE qiju_friendships IS
  '棋聚已接受的雙向好友關係；一列代表依 UUID 排序保存的一對好友。';

COMMENT ON COLUMN qiju_friendships.user_low IS '好友對中 UUID 較小的玩家身份。';
COMMENT ON COLUMN qiju_friendships.user_high IS '好友對中 UUID 較大的玩家身份。';
COMMENT ON COLUMN qiju_friendships.created_at IS '雙方好友關係建立時間。';
COMMENT ON CONSTRAINT qiju_friendships_sorted_pair ON qiju_friendships IS
  '以固定 UUID 順序保存無方向的好友對，避免同一關係重複。';

CREATE INDEX IF NOT EXISTS qiju_friendships_user_high_idx
  ON qiju_friendships (user_high, created_at DESC);
COMMENT ON INDEX qiju_friendships_user_high_idx IS
  '從 UUID 較大的玩家查詢好友關係。';

CREATE TABLE IF NOT EXISTS qiju_user_blocks (
  blocker_id uuid NOT NULL REFERENCES qiju_users(id) ON DELETE CASCADE,
  blocked_user_id uuid NOT NULL REFERENCES qiju_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (blocker_id, blocked_user_id),
  CONSTRAINT qiju_user_blocks_distinct_users CHECK (blocker_id <> blocked_user_id)
);

COMMENT ON TABLE qiju_user_blocks IS
  '棋聚玩家封鎖關係；一列代表 blocker 不接受 blocked_user 的好友邀請。';

COMMENT ON COLUMN qiju_user_blocks.blocker_id IS '執行封鎖、擁有此設定的玩家身份。';
COMMENT ON COLUMN qiju_user_blocks.blocked_user_id IS '被封鎖而不能送出好友邀請的玩家身份。';
COMMENT ON COLUMN qiju_user_blocks.created_at IS '封鎖關係建立時間。';
COMMENT ON CONSTRAINT qiju_user_blocks_distinct_users ON qiju_user_blocks IS
  '禁止玩家封鎖自己的身份。';

CREATE INDEX IF NOT EXISTS qiju_user_blocks_blocked_user_idx
  ON qiju_user_blocks (blocked_user_id);
COMMENT ON INDEX qiju_user_blocks_blocked_user_idx IS
  '快速查詢封鎖某玩家的所有封鎖關係。';
