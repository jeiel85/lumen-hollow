// 공유 보급품 규칙 수치. 설계: docs/online-caches.md 5.2절, 10절.
// 바꿀 때는 이 파일만 고치면 된다. 분당 요청 한도는 wrangler.toml의 [[ratelimits]]에 있다.
// 종류(kinds)나 문구 수(noteCount)를 바꾸면 schema.sql의 CHECK와 클라이언트 src/online.js도 맞춘다.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const RULES = Object.freeze({
  kinds: Object.freeze(['bandage', 'fuel', 'battery']),
  noteCount: 8,
  charges: 8, // 상자 하나가 줄 수 있는 횟수
  lifetimeMs: 72 * HOUR, // 처음 수명
  thanksExtendMs: 12 * HOUR, // 고마워요 1건당 연장
  maxLifetimeMs: 7 * DAY, // 만든 때부터의 최대 수명
  reuseCooldownMs: 24 * HOUR, // 같은 사람이 같은 상자를 다시 쓰기까지
  maxActivePerPlayer: 3,
  maxActiveTotal: 400,
  maxPlacesPerIpPerDay: 6,
  maxUsesPerIpPerDay: 40,
  retentionMs: 90 * DAY, // 사용·고마워요·접속 기록과 정리된 보급품 보존 기간
  rateKeepDays: 2, // 하루 한도 카운터 보존 일수
  aggregateDays: 3, // 정리 작업이 다시 집계하는 지난 날 수(정리 작업을 하루 걸러도 빠지지 않게)
  maxBodyBytes: 1024,
  listMemoMs: 30 * 1000, // 목록 응답을 Worker 메모리에 두는 시간
});
