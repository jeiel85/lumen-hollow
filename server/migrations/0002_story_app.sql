-- 마이그레이션 0002 (2026-11-09): 안드로이드 앱에서 온 이야기 사건을 따로 센다(#53 비공개 테스트 측정).
-- story_daily는 웹·앱을 합한 전체 그대로 두고, 앱(출처 https://localhost)에서 온 것만 이 표에 한 번 더 더한다.
-- 웹 = story_daily − story_app_daily. 표를 다시 만들지 않는 것은 마이그레이션을 다시 적용해도 바뀌는 것이 없어야 해서다.
-- 적용 순서와 명령은 server/README.md '스키마 바꾸기(마이그레이션)'. 코드를 배포하기 전에 먼저 적용한다.

-- 누가 보냈는지는 남기지 않는다: 플레이어 ID·IP 없이 UTC 날짜별 횟수만. 하루 상한은 story_daily의 'total' 행이 함께 맡는다.
-- kind·id·skipped의 뜻은 story_daily와 같다. 400일 뒤 지운다
CREATE TABLE IF NOT EXISTS story_app_daily (
  day     TEXT    NOT NULL,                  -- UTC 'YYYY-MM-DD'
  kind    TEXT    NOT NULL CHECK (kind IN ('scene', 'chapter', 'clear')),
  id      TEXT    NOT NULL,                  -- 장면·장 id (^[a-z0-9]{1,24}$)
  n       INTEGER NOT NULL,
  skipped INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind, id)
);
