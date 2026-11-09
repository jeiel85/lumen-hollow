// 운영 대시보드 화면 로직 테스트(이슈 #30 '대시보드 화면 코드에 자동 테스트가 없다').
// DOM 없이 돌도록 화면 코드에서 떼어 낸 server/dashboard/logic.js를 확인한다: 로그아웃 뒤 늦은 응답 버리기,
// 기간 전환, 응답 해석, 14일 판단의 만료 표시, 정리 작업·이야기 진행 문구.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createGate, fetchSummary, decisionView, cronView, storyView, errorMessage, NETWORK_ERROR, MESSAGES, DAY,
} from '../dashboard/logic.js';

const TOKEN = 'x'.repeat(43);
const iso = (t) => new Date(t).toISOString();

// 응답을 손으로 내보내는 가짜 fetch. 실제 fetch처럼 signal이 끊기면 AbortError로 거절한다.
function manualFetch() {
  const calls = [];
  const fetchFn = (url, init) => new Promise((resolve, reject) => {
    const call = { url, init, respond: (status, body) => resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })) };
    calls.push(call);
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
  return { fetchFn, calls };
}

const summary = (range) => ({ period: { range }, now: 1 });

test('로그아웃하면 이미 보낸 요청의 응답이 늦게 와도 쓰지 않는다', async () => {
  const gate = createGate();
  // 요청이 끊겨도 응답이 이미 오는 중일 수 있다: abort를 무시하고 응답을 돌려주는 fetch로 재현한다.
  let respond;
  const late = () => new Promise((resolve) => { respond = () => resolve(new Response(JSON.stringify(summary('launch')))); });
  const ticket = gate.start();
  const pending = fetchSummary(late, { token: TOKEN, range: 'launch', ticket });
  assert.equal(gate.busy, true);
  gate.cancel(); // 로그아웃
  assert.equal(gate.busy, false);
  assert.equal(ticket.signal.aborted, true, '요청도 끊는다');
  respond();
  assert.deepEqual(await pending, { type: 'stale' });
});

test('로그아웃으로 끊긴 요청은 오류 문구를 띄우지 않는다', async () => {
  const gate = createGate();
  const { fetchFn } = manualFetch();
  const ticket = gate.start();
  const pending = fetchSummary(fetchFn, { token: TOKEN, range: '7d', ticket });
  gate.cancel();
  assert.deepEqual(await pending, { type: 'stale' });
});

test('기간을 빨리 바꾸면 앞 기간의 늦은 응답은 버리고 마지막 기간만 그린다', async () => {
  const gate = createGate();
  const { fetchFn, calls } = manualFetch();
  const a = gate.start();
  const first = fetchSummary(fetchFn, { token: TOKEN, range: '7d', ticket: a });
  const b = gate.start(); // 사용자가 곧바로 '출시 이후'를 누른다
  const second = fetchSummary(fetchFn, { token: TOKEN, range: 'launch', ticket: b });
  assert.equal(a.current, false);
  assert.equal(calls[0].init.signal.aborted, true, '앞 요청은 끊는다');
  assert.deepEqual(calls.map((c) => c.url), ['/api/summary?range=7d', '/api/summary?range=launch']);
  assert.equal(calls[1].init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(calls[1].init.cache, 'no-store');
  calls[1].respond(200, summary('launch'));
  calls[0].respond(200, summary('7d')); // 늦게 와도(이미 끊겨 무시됨)
  assert.deepEqual(await second, { type: 'ok', body: summary('launch') });
  assert.deepEqual(await first, { type: 'stale' });
  a.finish(); // 앞 요청의 마무리가 뒤 요청의 '불러오는 중' 상태를 풀지 않는다
  assert.equal(gate.busy, true);
  b.finish();
  assert.equal(gate.busy, false);
});

test('기간 값은 주소에 안전하게 넣는다', async () => {
  const { fetchFn, calls } = manualFetch();
  const ticket = createGate().start();
  const pending = fetchSummary(fetchFn, { token: TOKEN, range: '7d&x=1', ticket });
  assert.equal(calls[0].url, '/api/summary?range=7d%26x%3D1');
  calls[0].respond(400, { error: 'bad_range' });
  assert.deepEqual(await pending, { type: 'error', message: MESSAGES.bad_range });
});

test('응답 해석: 401은 다시 로그인, 알려진 오류는 안내 문구, 모르는 오류·깨진 본문은 HTTP 상태, 연결 실패는 네트워크 문구', async () => {
  const run = async (status, body) => {
    const { fetchFn, calls } = manualFetch();
    const ticket = createGate().start();
    const p = fetchSummary(fetchFn, { token: TOKEN, range: 'launch', ticket });
    calls[0].respond(status, body);
    return p;
  };
  assert.deepEqual(await run(401, { error: 'unauthorized' }), { type: 'unauthorized' });
  assert.deepEqual(await run(503, { error: 'db_unavailable' }), { type: 'error', message: MESSAGES.db_unavailable });
  assert.deepEqual(await run(429, { error: 'rate' }), { type: 'error', message: MESSAGES.rate });
  assert.deepEqual(await run(500, { error: 'brand_new' }), { type: 'error', message: '서버 오류가 났어요(HTTP 500).' });
  assert.deepEqual(await run(200, '<html>not json'), { type: 'error', message: '서버 오류가 났어요(HTTP 200).' });
  const offline = await fetchSummary(() => Promise.reject(new TypeError('Failed to fetch')), { token: TOKEN, range: 'launch', ticket: createGate().start() });
  assert.deepEqual(offline, { type: 'error', message: NETWORK_ERROR });
  assert.equal(errorMessage(undefined, 502), '서버 오류가 났어요(HTTP 502).');
});

// ---------------------------------------------------------------- 14일 판단

const LAUNCH = Date.UTC(2026, 10, 6, 5, 35);
const criteria = { days: 14, continueTakers: 20, continueUsedPct: 40, reviewUsedPct: 20, stopPlacers: 5 };
const decision = (over) => ({
  from: LAUNCH, endsAt: LAUNCH + 14 * DAY, final: false, expired: false, verdict: 'stop', criteria,
  metrics: { takers: 3, usedPct: 50, placers: 2 }, ...over,
});

test('14일 판단: 판단일 전에는 며칠째·남은 날과 "지금 수치로는"을 보인다', () => {
  const v = decisionView(decision(), LAUNCH + 2.5 * DAY, iso);
  assert.equal(v.when, `출시 3일째 · 판단일 ${iso(LAUNCH + 14 * DAY)} (12일 남음)`);
  assert.deepEqual(v.meter, { value: 2.5, max: 14 });
  assert.equal(v.headline, '지금 수치로는: 중단');
  assert.match(v.note, /14일째에도 이대로면 킬 스위치로/);
  assert.deepEqual(v.criteria.map((c) => [c.shown, c.met]), [['3 / 20명', false], ['50% / 40%', true], ['2 / 5명', false]]);
});

test('14일 판단: 판단일이 지나면 확정 판정으로 바꾼다', () => {
  const v = decisionView(decision({ final: true, verdict: 'continue', metrics: { takers: 25, usedPct: null, placers: 9 } }), LAUNCH + 20 * DAY, iso);
  assert.equal(v.headline, '판정: 계속');
  assert.match(v.when, /^판단 기간이 끝났어요/);
  assert.deepEqual(v.meter, { value: 14, max: 14 });
  assert.doesNotMatch(v.note, /14일째에도/);
  assert.equal(v.criteria[1].shown, '— / 40%', '쓰인 비율을 모르면 대시');
  assert.equal(v.criteria[1].met, false);
});

test('14일 판단: 기록이 보존 기간을 지나 지워지기 시작하면(만료) 판정 대신 기록 자리를 가리킨다', () => {
  const v = decisionView(decision({ final: true, expired: true, metrics: null, verdict: null }), LAUNCH + 100 * DAY, iso);
  assert.equal(v.expired, true);
  assert.equal(v.headline, '다시 계산하지 않아요');
  assert.match(v.note, /14\.4절/);
  assert.match(v.when, /보존 기간\(90일\)을 지나/);
  assert.deepEqual(v.criteria, []);
  assert.deepEqual(v.meter, { value: 14, max: 14 });
});

test('14일 판단: 14.4절(판정 기록 자리)이 설계 문서에 실제로 있다', () => {
  const doc = readFileSync(new URL('../../docs/online-caches.md', import.meta.url), 'utf8');
  assert.match(doc, /^### 14\.4 /m);
});

// ---------------------------------------------------------------- 정리 작업

const T = Date.UTC(2026, 10, 9, 4);

test('정리 작업 문구: 실패면 시각·이유·마지막 성공, 정상이면 지운 행과 최근 실패', () => {
  const failed = cronView({ cron: 'failed', cronLog: { lastRun: { at: T, ok: false, error: 'D1_ERROR: boom' }, lastSuccessAt: T - DAY, lastFailure: { at: T, error: 'D1_ERROR: boom' } } }, iso);
  assert.deepEqual([failed.kind, failed.text], ['bad', '실패 — 확인 필요']);
  assert.match(failed.note, /D1_ERROR: boom/);
  assert.match(failed.note, new RegExp(`마지막 성공은 ${iso(T - DAY)}`));
  const never = cronView({ cron: 'failed', cronLog: { lastRun: { at: T, ok: false, error: null }, lastSuccessAt: null, lastFailure: { at: T, error: null } } }, iso);
  assert.match(never.note, /성공한 기록이 없어요/);

  const ok = cronView({ cron: 'ok', cronLog: { lastRun: { at: T, ok: true, deleted: 1234 }, lastSuccessAt: T, lastFailure: { at: T - DAY, error: 'x' } } }, iso);
  assert.deepEqual([ok.kind, ok.text], ['good', '정상']);
  assert.match(ok.note, /지운 행 1,234개/);
  assert.match(ok.note, new RegExp(`최근 실패: ${iso(T - DAY)} — x`));

  const late = cronView({ cron: 'late', lastAggregateDay: '2026-11-07', cronLog: { lastRun: { at: T - 2 * DAY, ok: true }, lastSuccessAt: T - 2 * DAY, lastFailure: null } }, iso);
  assert.deepEqual([late.kind, late.icon], ['bad', '⚠']);
  assert.match(late.note, /빠졌어요/);
});

test('정리 작업 문구: 실행 기록 표가 없으면(마이그레이션 전) 집계 날짜로 보고 그렇다고 알린다', () => {
  const ok = cronView({ cron: 'ok', lastAggregateDay: '2026-11-08', cronLog: null }, iso);
  assert.match(ok.note, /마지막 집계 날짜 2026-11-08\(UTC\)/);
  assert.match(ok.note, /마이그레이션 0001/);
  const pending = cronView({ cron: 'pending', lastAggregateDay: null, cronLog: { lastRun: null, lastSuccessAt: null, lastFailure: null } }, iso);
  assert.equal(pending.kind, 'warn');
  assert.doesNotMatch(pending.note, /마이그레이션/, '표가 있으면 알리지 않는다');
  assert.match(cronView({ cron: 'late', lastAggregateDay: null, cronLog: null }, iso).note, /한 번도 돌지 않았을/);
});

// ---------------------------------------------------------------- 이야기 진행

test('이야기 진행: 장은 들어감·마침으로 묶고, 장면은 건너뛴 비율을 계산한다', () => {
  const v = storyView({
    from: '2026-11-06',
    rows: [
      { kind: 'scene', id: 'arrival', n: 8, skipped: 3 },
      { kind: 'chapter', id: '10', n: 1, skipped: 0 },
      { kind: 'chapter', id: '2', n: 5, skipped: 0 },
      { kind: 'clear', id: '2', n: 2, skipped: 0 },
      { kind: 'scene', id: 'dusk', n: 0, skipped: 0 },
      { kind: 'mystery', id: 'x', n: 1, skipped: 0 },
    ],
    today: { events: 1200, max: 10000, full: false },
  });
  assert.deepEqual(v.chapters, [{ id: '2', entered: 5, cleared: 2 }, { id: '10', entered: 1, cleared: 0 }], '장 번호는 숫자 순');
  assert.deepEqual(v.scenes, [{ id: 'arrival', n: 8, skipped: 3, skippedPct: 37.5 }, { id: 'dusk', n: 0, skipped: 0, skippedPct: null }]);
  assert.equal(v.today, '오늘(UTC) 받은 사건 1,200 / 하루 상한 10,000건');
  assert.equal(v.full, false);
  const full = storyView({ from: '2026-11-06', rows: [], today: { events: 10000, max: 10000, full: true } });
  assert.match(full.today, /^⚠ .*상한 10,000건에 닿아/);
  assert.equal(storyView(null), null, '표가 없으면(마이그레이션 전) null');
});

test('이야기 진행: 웹·앱으로 나눠 본다 — 앱은 앱 몫, 웹은 전체 − 앱(#53)', () => {
  const story = {
    from: '2026-11-09',
    rows: [
      { kind: 'scene', id: 'arrival', n: 10, skipped: 4 },
      { kind: 'scene', id: 'dusk', n: 3, skipped: 0 },
      { kind: 'chapter', id: '2', n: 2, skipped: 0 },
      { kind: 'clear', id: '1', n: 4, skipped: 0 },
    ],
    app: [
      { kind: 'chapter', id: '2', n: 2, skipped: 0 },
      { kind: 'clear', id: '1', n: 1, skipped: 0 },
      { kind: 'scene', id: 'arrival', n: 2, skipped: 1 },
      { kind: 'scene', id: 'dusk', n: 3, skipped: 0 },
    ],
    today: { events: 19, max: 10000, full: false },
  };
  const app = storyView(story, 'app');
  assert.deepEqual([app.src, app.unknown], ['app', false]);
  assert.deepEqual(app.chapters, [{ id: '1', entered: 0, cleared: 1 }, { id: '2', entered: 2, cleared: 0 }]);
  assert.deepEqual(app.scenes.map((x) => [x.id, x.n, x.skippedPct]), [['dusk', 3, 0], ['arrival', 2, 50]], '앱 몫으로 많이 도달한 순');
  const web = storyView(story, 'web');
  assert.deepEqual(web.chapters, [{ id: '1', entered: 0, cleared: 3 }], '2장은 모두 앱이라 웹에서 빠진다');
  assert.deepEqual(web.scenes.map((x) => [x.id, x.n, x.skipped]), [['arrival', 8, 3]], '0이 된 장면(dusk)은 뺀다');
  assert.deepEqual(storyView(story, 'all').scenes.map((x) => x.id), ['arrival', 'dusk'], '전체는 서버 순서 그대로');
  assert.equal(storyView(story, 'nope').src, 'all', '모르는 값은 전체로');
  const before = storyView({ ...story, app: null }, 'web');
  assert.deepEqual([before.unknown, before.chapters, before.scenes], [true, [], []], '앱 표가 없으면(마이그레이션 0002 전) 나눌 수 없다');
  assert.equal(storyView({ ...story, app: null }, 'all').unknown, false, '전체는 그대로 볼 수 있다');
});

test('화면 코드는 logic.js의 것만 쓰고, 서버 값은 textContent로만 넣는다', () => {
  const src = readFileSync(new URL('../dashboard/dashboard.js', import.meta.url), 'utf8');
  assert.match(src, /from '\.\/logic\.js'/);
  assert.doesNotMatch(src, /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML\(|document\.write\(/);
});
