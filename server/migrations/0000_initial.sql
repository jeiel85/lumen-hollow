-- 마이그레이션 0000: 출시(2026-11-06, PR #13·#29) 때의 스키마. 그때의 schema.sql과 같고, 고치지 않는다.
-- 운영 D1에는 이미 schema.sql로 적용돼 있다. 모든 문장이 IF NOT EXISTS / OR IGNORE라 다시 적용해도 바뀌는 것이 없다.
-- 이 파일은 test/schema.test.mjs가 "0000부터 차례로 적용한 결과 = schema.sql"을 확인하는 기준점이기도 하다.

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
