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
  cronRunsKept: 30, // 정리 작업 실행 기록(cron_runs)을 남기는 횟수
  // 2단계 남용 대응(판 토큰). 켜고 끄기는 wrangler.toml의 RUN_TOKEN_REQUIRED
  runTokenMinAgeMs: 3 * 60 * 1000, // 목록을 받은 뒤 이만큼 지나야 둘 수 있다(게임 속 하루)
  runTokenMaxAgeMs: 24 * HOUR, // 이보다 오래된 판 토큰은 받지 않는다
  // 이야기 진행 집계(POST /v1/story). 개인 식별 정보 없이 날짜별 횟수만 센다
  storyKinds: Object.freeze(['scene', 'chapter', 'clear']),
  storyMaxEvents: 20, // 요청 하나에 담을 수 있는 사건 수
  storyMaxBodyBytes: 2048,
  storyMaxEventsPerDay: 10000, // 하루(UTC) 전체 상한. D1 하루 쓰기 한도(10만 행)를 게임과 함께 쓰므로 그 10%로 묶는다
  storyKeepDays: 400, // 이야기 집계를 남기는 날 수(익명 집계라 다른 기록보다 길게 둔다)
  // 이 출처(Origin 헤더)에서 온 이야기 사건은 앱 표(story_app_daily)에도 센다. Capacitor 앱의 WebView 출처다(wrangler.toml ALLOWED_ORIGINS와 같은 값)
  storyAppOrigin: 'https://localhost',
});

// 클라이언트에 알려 주는 규칙 수치(GET /v1/caches 응답의 rules). 안내 문구가 서버 수치를 따라가게 한다.
// 이름은 공개 API라 바꾸지 않고, 더할 때는 끝에 더한다(클라이언트는 모르는 필드를 무시한다).
export const publicRules = (rules) => ({
  charges: rules.charges,
  maxActivePerPlayer: rules.maxActivePerPlayer,
  reuseCooldownMs: rules.reuseCooldownMs,
  maxLifetimeMs: rules.maxLifetimeMs,
});
