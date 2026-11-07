-- 마이그레이션 0001 (2026-11-08): 대시보드 조회 색인, 정리 작업 실행 기록, 이야기 진행 집계.
-- 이슈 #17 '하루 정리 작업(cron) 실패 감지', #30 '대시보드 조회가 표를 훑는다', #20·#32 이야기 진행 관측.
-- 적용 순서와 명령은 server/README.md '스키마 바꾸기(마이그레이션)'. 코드를 배포하기 전에 먼저 적용한다.
-- 모든 문장이 IF NOT EXISTS라 다시 적용해도 바뀌는 것이 없다. 바꿀 것이 생기면 이 파일을 고치지 말고 0002를 만든다.

-- 대시보드와 정리 작업이 기간으로 거르는 열. 색인이 없으면 조회마다 표 전체를 읽는다(D1 읽은 행 수).
-- 색인은 그 열을 쓰는 쓰기마다 1행을 더 쓴다. 보급품은 IP당 하루 6개라 쓰기 증가는 작다.
CREATE INDEX IF NOT EXISTS caches_created ON caches (created_at);
CREATE INDEX IF NOT EXISTS caches_live_expiry ON caches (expires_at) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS thanks_at ON thanks (at);

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
