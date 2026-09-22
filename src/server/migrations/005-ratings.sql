CREATE TABLE IF NOT EXISTS qiju_ratings (
  user_id uuid NOT NULL REFERENCES qiju_users(id) ON DELETE CASCADE,
  game text NOT NULL CHECK (
    game IN ('shogi', 'chess', 'xiangqi', 'checkers', 'gomoku', 'go', 'reversi')
  ),
  rating integer NOT NULL CHECK (rating >= 0),
  games_played integer NOT NULL CHECK (games_played >= 0),
  wins integer NOT NULL CHECK (wins >= 0),
  losses integer NOT NULL CHECK (losses >= 0),
  draws integer NOT NULL CHECK (draws >= 0),
  provisional boolean NOT NULL,
  rating_version integer NOT NULL CHECK (rating_version > 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, game),
  CHECK (wins + losses + draws = games_played)
);

COMMENT ON TABLE qiju_ratings IS '棋聚玩家依棋種保存的目前 rated 評分與戰績摘要；一列代表一名玩家在一個棋種的評分。';

COMMENT ON COLUMN qiju_ratings.user_id IS '評分所屬的玩家身份。';
COMMENT ON COLUMN qiju_ratings.game IS '評分所屬的棋種。';
COMMENT ON COLUMN qiju_ratings.rating IS '目前 ELO 評分，初始值為 1500。';
COMMENT ON COLUMN qiju_ratings.games_played IS '已完成並納入 rated 結算的對局數。';
COMMENT ON COLUMN qiju_ratings.wins IS 'rated 勝場數。';
COMMENT ON COLUMN qiju_ratings.losses IS 'rated 敗場數。';
COMMENT ON COLUMN qiju_ratings.draws IS 'rated 和局數。';
COMMENT ON COLUMN qiju_ratings.provisional IS '是否仍處於前幾場的大幅變動 provisional 狀態。';
COMMENT ON COLUMN qiju_ratings.rating_version IS '評分演算法版本，供日後模型遷移與重算辨識。';
COMMENT ON COLUMN qiju_ratings.updated_at IS '這筆評分最後一次因 rated 結算更新的時間。';

CREATE INDEX IF NOT EXISTS qiju_ratings_game_rating_idx
  ON qiju_ratings (game, rating DESC, user_id);

CREATE TABLE IF NOT EXISTS qiju_rating_results (
  match_id uuid NOT NULL REFERENCES qiju_matches(id) ON DELETE CASCADE,
  seat smallint NOT NULL CHECK (seat >= 0),
  user_id uuid NOT NULL REFERENCES qiju_users(id) ON DELETE RESTRICT,
  game text NOT NULL CHECK (
    game IN ('shogi', 'chess', 'xiangqi', 'checkers', 'gomoku', 'go', 'reversi')
  ),
  result text NOT NULL CHECK (result IN ('win', 'loss', 'draw')),
  rating_before integer NOT NULL CHECK (rating_before >= 0),
  rating_after integer NOT NULL CHECK (rating_after >= 0),
  rating_delta integer NOT NULL,
  games_before integer NOT NULL CHECK (games_before >= 0),
  games_after integer NOT NULL CHECK (games_after = games_before + 1),
  k_factor smallint NOT NULL CHECK (k_factor > 0),
  provisional boolean NOT NULL,
  rating_version integer NOT NULL CHECK (rating_version > 0),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (match_id, seat),
  UNIQUE (match_id, user_id)
);

COMMENT ON TABLE qiju_rating_results IS '棋聚 rated 對局的不可重複評分結算明細；一列代表一名參與者在一局中的分數變化。';

COMMENT ON COLUMN qiju_rating_results.match_id IS '產生這次評分變化的 rated 對局。';
COMMENT ON COLUMN qiju_rating_results.seat IS '玩家在該局的座位索引。';
COMMENT ON COLUMN qiju_rating_results.user_id IS '接受這次評分變化的玩家身份。';
COMMENT ON COLUMN qiju_rating_results.game IS '評分變化所屬的棋種。';
COMMENT ON COLUMN qiju_rating_results.result IS '玩家在該局的結果：win、loss 或 draw。';
COMMENT ON COLUMN qiju_rating_results.rating_before IS '結算前的 ELO 評分。';
COMMENT ON COLUMN qiju_rating_results.rating_after IS '結算後的 ELO 評分。';
COMMENT ON COLUMN qiju_rating_results.rating_delta IS '本局造成的評分增減，可為負值。';
COMMENT ON COLUMN qiju_rating_results.games_before IS '結算前已完成的 rated 對局數。';
COMMENT ON COLUMN qiju_rating_results.games_after IS '結算後已完成的 rated 對局數。';
COMMENT ON COLUMN qiju_rating_results.k_factor IS '本次結算使用的 ELO K factor。';
COMMENT ON COLUMN qiju_rating_results.provisional IS '結算後玩家是否仍處於 provisional 狀態。';
COMMENT ON COLUMN qiju_rating_results.rating_version IS '本次結算使用的評分演算法版本。';
COMMENT ON COLUMN qiju_rating_results.created_at IS '評分結算建立時間。';

CREATE INDEX IF NOT EXISTS qiju_rating_results_user_created_idx
  ON qiju_rating_results (user_id, created_at DESC);
