-- 공유 보급품 D1(SQLite) 스키마. 설계: docs/online-caches.md 7절.
-- 시각은 모두 Unix 밀리초 정수다(SQLite INTEGER는 64비트). Postgres로 옮길 때는 *_at 열을 BIGINT로 바꾼다.
-- 자식 테이블(uses, thanks)의 외래 키에는 일부러 연쇄 삭제를 걸지 않는다. 정리 순서는 src/app.js의 cleanup 참고.
-- 새 데이터베이스는 이 파일 하나로 만든다(npm run db:local). 이미 있는 데이터베이스는 migrations/를 차례로 적용한다.
-- 이 파일을 바꾸면 같은 내용의 마이그레이션도 더한다. test/schema.test.mjs가 둘이 같은지 확인한다.

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
-- 대시보드·정리 작업이 기간으로 거르는 열(migrations/0001)
CREATE INDEX IF NOT EXISTS caches_created ON caches (created_at);
CREATE INDEX IF NOT EXISTS caches_live_expiry ON caches (expires_at) WHERE removed_at IS NULL;

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
CREATE INDEX IF NOT EXISTS thanks_at ON thanks (at);

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

-- 정리 작업(cron) 실행 기록. 최근 30번만 남긴다(src/rules.js cronRunsKept). 개인 정보는 없다
CREATE TABLE IF NOT EXISTS cron_runs (
  id      INTEGER PRIMARY KEY,               -- 실행 순서
  at      INTEGER NOT NULL,                  -- 시작 시각(Unix 밀리초)
  ok      INTEGER NOT NULL CHECK (ok IN (0, 1)),
  ms      INTEGER NOT NULL,                  -- 걸린 시간
  deleted INTEGER,                           -- 지운 행 수(사용·고마워요·접속·보급품·카운터·이야기 집계 합). 실패면 NULL
  error   TEXT                               -- 실패했을 때 오류 메시지 앞 200자
);

-- 이야기 진행 집계(POST /v1/story). 누가 보냈는지는 남기지 않는다: 플레이어 ID·IP 없이 UTC 날짜별 횟수만.
-- kind = 'scene'(장면이 끝남, skipped는 건너뛴 횟수) / 'chapter'(장에 들어감) / 'clear'(장을 마침).
-- kind = 'total', id = '' 행은 그날 받은 사건 수(하루 상한 확인용)다. 400일 뒤 지운다
CREATE TABLE IF NOT EXISTS story_daily (
  day     TEXT    NOT NULL,                  -- UTC 'YYYY-MM-DD'
  kind    TEXT    NOT NULL CHECK (kind IN ('scene', 'chapter', 'clear', 'total')),
  id      TEXT    NOT NULL,                  -- 장면·장 id (^[a-z0-9]{1,24}$)
  n       INTEGER NOT NULL,
  skipped INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind, id)
);

-- 서버 설정. enabled = 'false'면 킬 스위치(목록은 enabled:false, 쓰기는 503)
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO settings (key, value) VALUES ('enabled', 'true');
