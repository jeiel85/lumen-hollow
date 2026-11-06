-- 운영용 SQL 모음. 필요한 문장만 골라 실행한다:
--   npx wrangler d1 execute lumen-hollow-caches --remote --command "<문장>"
-- (로컬에서 시험할 때는 --remote 대신 --local)
-- 아래 '관찰'과 '성공 지표'는 운영 대시보드(README '운영 대시보드')에서도 같은 정의로 볼 수 있다. 쓰기는 여기서만 한다.

-- ---------------------------------------------------------------- 킬 스위치
-- 끄기: 목록은 enabled:false, 쓰기는 503. 본인 기록 삭제(DELETE /v1/me)는 계속 받는다. Worker 메모리 목록은 최대 30초 늦게 반영된다.
UPDATE settings SET value = 'false' WHERE key = 'enabled';
-- 다시 켜기
UPDATE settings SET value = 'true' WHERE key = 'enabled';

-- ---------------------------------------------------------------- 일괄 정리
-- 특정 시각(Unix 밀리초) 이후에 생긴 보급품을 모두 내린다(스팸 대응).
UPDATE caches SET removed_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000, removed_by = 'admin'
WHERE removed_at IS NULL AND created_at >= 1793900000000;
-- 슬롯 하나를 비운다.
UPDATE caches SET removed_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000, removed_by = 'admin'
WHERE removed_at IS NULL AND layout = 1 AND slot = 291;
-- 한 소유자(해시)의 보급품을 모두 내린다. 해시는 아래 '최근 등록이 많은 소유자'에서 확인한다.
UPDATE caches SET removed_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000, removed_by = 'admin'
WHERE removed_at IS NULL AND owner = '<owner 해시>';

-- ---------------------------------------------------------------- 관찰
-- 최근 24시간 등록이 많은 소유자(남용 의심)
SELECT owner, count(*) AS n FROM caches
WHERE created_at > CAST(strftime('%s', 'now') AS INTEGER) * 1000 - 86400000
GROUP BY owner ORDER BY n DESC LIMIT 10;
-- 오늘 하루 한도에 가까운 IP 키(원문 IP가 아니라 HMAC)
SELECT action, key, count FROM rate_daily WHERE day = date('now') ORDER BY count DESC LIMIT 10;
-- 일별 집계(정리 작업이 지난 3일을 다시 계산해 둔다)
SELECT * FROM daily_stats ORDER BY day DESC, metric LIMIT 60;

-- ---------------------------------------------------------------- 성공 지표 (docs/online-caches.md 14절, 출시 후 14일)
-- 출시 시각(Unix 밀리초)을 1793900000000 자리에 넣는다.
-- 접속 플레이어
SELECT count(DISTINCT user_hash) AS players FROM seen WHERE day >= date(1793900000000 / 1000, 'unixepoch');
-- 보급품을 둔 플레이어
SELECT count(DISTINCT owner) AS placers FROM caches WHERE created_at >= 1793900000000 AND owner <> 'deleted';
-- 남의 보급품을 쓴 플레이어 (주인은 자기 상자를 못 쓰므로 사용 기록은 모두 남의 것)
SELECT count(DISTINCT user_hash) AS takers FROM uses WHERE used_at >= 1793900000000;
-- 쓰인 보급품 비율(%)
SELECT round(100.0 * count(DISTINCT u.cache_id) / NULLIF((SELECT count(*) FROM caches WHERE created_at >= 1793900000000), 0), 1) AS used_pct
FROM uses u JOIN caches c ON c.id = u.cache_id WHERE c.created_at >= 1793900000000;
-- 고마워요 비율(%)
SELECT round(100.0 * (SELECT count(*) FROM thanks WHERE at >= 1793900000000) / NULLIF(count(*), 0), 1) AS thanks_pct
FROM uses WHERE used_at >= 1793900000000;
-- 서로 다른 날에 두 번 이상 둔 플레이어
SELECT count(*) AS returning_placers FROM (
  SELECT owner FROM caches WHERE created_at >= 1793900000000 AND owner <> 'deleted'
  GROUP BY owner HAVING count(DISTINCT date(created_at / 1000, 'unixepoch')) >= 2
);
