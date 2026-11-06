-- 공유 보급품 D1(SQLite) 스키마. 설계: docs/online-caches.md 7절.
-- 시각은 모두 Unix 밀리초 정수다(SQLite INTEGER는 64비트). Postgres로 옮길 때는 *_at 열을 BIGINT로 바꾼다.
-- 자식 테이블(uses, thanks)의 외래 키에는 일부러 연쇄 삭제를 걸지 않는다. 정리 순서는 src/app.js의 cleanup 참고.

CREATE TABLE IF NOT EXISTS caches (
  id          TEXT    PRIMARY KEY,           -- 서버가 만든 무작위 ID (c_ + base32 26자)
  layout      INTEGER NOT NULL,              -- 마을 배치 버전 (src/slots.js의 SLOT_LAYOUT)
  slot        INTEGER NOT NULL CHECK (slot >= 0 AND slot < 600),
  kind        TEXT    NOT NULL CHECK (kind IN ('bandage', 'fuel', 'battery')),
  note        INTEGER NOT NULL DEFAULT 0,    -- 미리 정한 문구 번호
  owner       TEXT    NOT NULL,              -- sha256(플레이어 ID). 본인 삭제 후에는 'deleted'. 응답에 넣지 않는다
  charges     INTEGER NOT NULL,              -- 남은 사용 횟수
  thanks      INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  removed_at  INTEGER,                       -- 만료 정리·소진·본인 삭제·관리자 삭제 시각
  removed_by  TEXT CHECK (removed_by IN ('expired', 'exhausted', 'owner', 'admin'))
);
-- 한 슬롯에는 정리되지 않은 보급품이 하나만 있을 수 있다.
CREATE UNIQUE INDEX IF NOT EXISTS caches_slot_live ON caches (layout, slot) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS caches_owner ON caches (owner);

-- 사용 기록: 24시간 1회 판정, 고마워요 자격, 지표
CREATE TABLE IF NOT EXISTS uses (
  cache_id  TEXT    NOT NULL REFERENCES caches (id),
  user_hash TEXT    NOT NULL,
  used_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS uses_lookup ON uses (cache_id, user_hash, used_at);
CREATE INDEX IF NOT EXISTS uses_user ON uses (user_hash);
CREATE INDEX IF NOT EXISTS uses_time ON uses (used_at);

-- 고마워요: 상자당 1인 1회
CREATE TABLE IF NOT EXISTS thanks (
  cache_id  TEXT    NOT NULL REFERENCES caches (id),
  user_hash TEXT    NOT NULL,
  at        INTEGER NOT NULL,
  PRIMARY KEY (cache_id, user_hash)
);
CREATE INDEX IF NOT EXISTS thanks_user ON thanks (user_hash);

-- 접속 플레이어 수(지표의 분모). 하루 한 번
CREATE TABLE IF NOT EXISTS seen (
  day       TEXT NOT NULL,                   -- UTC 'YYYY-MM-DD'
  user_hash TEXT NOT NULL,
  PRIMARY KEY (day, user_hash)
);
CREATE INDEX IF NOT EXISTS seen_user ON seen (user_hash);

-- 하루 단위 남용 한도 카운터. key는 HMAC(IP) — 원문 IP는 저장하지 않는다. 이틀 뒤 지운다
CREATE TABLE IF NOT EXISTS rate_daily (
  day    TEXT    NOT NULL,
  key    TEXT    NOT NULL,
  action TEXT    NOT NULL CHECK (action IN ('place', 'use')),
  count  INTEGER NOT NULL,
  PRIMARY KEY (day, key, action)
);

-- 원본 기록을 지운 뒤에도 남기는 일별 집계
CREATE TABLE IF NOT EXISTS daily_stats (
  day    TEXT    NOT NULL,
  metric TEXT    NOT NULL,
  value  INTEGER NOT NULL,
  PRIMARY KEY (day, metric)
);

-- 서버 설정. enabled = 'false'면 킬 스위치(목록은 enabled:false, 쓰기는 503)
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO settings (key, value) VALUES ('enabled', 'true');
