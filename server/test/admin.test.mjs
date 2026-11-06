// 운영 대시보드 API 테스트. 결정: DECISIONS.md D-003. 지표 정의: docs/online-caches.md 14절.
// 기록은 게임 API(app.js)로 실제와 같은 경로로 만들고, 대시보드가 그 기록을 어떻게 세는지 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createApp } from '../src/app.js';
import { createAdmin, verdict, DECISION } from '../src/admin.js';
import { RULES } from '../src/rules.js';
import { BLOCKED_SLOTS } from '../src/slots.js';
import { createD1 } from './d1.mjs';

const HOUR = 3600e3;
const DAY = 24 * HOUR;
const ORIGIN = 'https://jeiel85.github.io';
const TOKEN = 'test-admin-token-0123456789-abcdefghijklmnop';
const FREE = [...Array(600).keys()].filter((s) => !BLOCKED_SLOTS.includes(s));
const T0 = Date.UTC(2026, 10, 6, 12);
const LAUNCH = T0 - HOUR;

const pid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ownerHash = (n) => createHash('sha256').update(`lumen:${pid(n)}`).digest('hex');

function setup({ env: extra = {} } = {}) {
  const clock = { t: T0 };
  const db = createD1();
  const game = createApp({ now: () => clock.t });
  const admin = createAdmin({ now: () => clock.t });
  const rl = { limit: async () => ({ success: true }) };
  const gameEnv = { DB: db, IP_HASH_SECRET: 'test-secret', ALLOWED_ORIGINS: ORIGIN, RL_READ: rl, RL_WRITE: rl };
  const adminEnv = { DB: db, ADMIN_TOKEN: TOKEN, LAUNCH_AT: new Date(LAUNCH).toISOString(), ...extra };

  async function play(method, path, n, { body, ip = `203.0.113.${n}` } = {}) {
    const headers = { Origin: ORIGIN, 'CF-Connecting-IP': ip, 'X-Lumen-Player': pid(n) };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await game.fetch(new Request(`https://api.test${path}`, { method, headers, body: body && JSON.stringify(body) }), gameEnv);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  const place = async (n, slot, kind = 'bandage') => (await play('POST', '/v1/caches', n, { body: { layout: 1, slot, kind, note: 1 } })).cache.id;
  const use = (n, id) => play('POST', `/v1/caches/${id}/use`, n);
  const thank = (n, id) => play('POST', `/v1/caches/${id}/thanks`, n);
  const visit = (n) => play('GET', '/v1/me', n);

  async function call(path = '/api/summary', { method = 'GET', auth = `Bearer ${TOKEN}`, env = adminEnv } = {}) {
    const headers = auth === null ? {} : { Authorization: auth };
    const res = await admin.fetch(new Request(`https://admin.test${path}`, { method, headers }), env);
    return { status: res.status, body: await res.json(), headers: res.headers };
  }
  return { clock, db, game, gameEnv, adminEnv, call, place, use, thank, visit };
}

// 출시 날(UTC 11-06)에 p1이 둘, p2가 하나를 두고 p2·p3이 꺼내 쓴다. 다음 날 p1이 하나 더 두고, p4가 처음 들어온다.
async function seed(s) {
  const a = await s.place(1, FREE[0]);
  const b = await s.place(1, FREE[1]);
  await s.place(2, FREE[2], 'fuel');
  await s.use(2, a);
  await s.thank(2, a);
  await s.use(3, a);
  await s.use(3, b);
  for (const n of [1, 2, 3]) await s.visit(n);
  s.clock.t = T0 + DAY;
  await s.place(1, FREE[3]);
  await s.visit(4);
  s.clock.t = T0 + DAY + HOUR;
}

test('토큰이 없거나 짧게 설정되면 닫힌 채로 503', async () => {
  const s = setup();
  for (const ADMIN_TOKEN of [undefined, '', 'x'.repeat(31)]) {
    const r = await s.call('/api/summary', { env: { ...s.adminEnv, ADMIN_TOKEN } });
    assert.equal(r.status, 503);
    assert.equal(r.body.error, 'admin_not_configured');
  }
});

test('토큰이 없거나 틀리면 401이고 지표를 주지 않는다', async () => {
  const s = setup();
  await seed(s);
  for (const auth of [null, '', TOKEN, `Basic ${TOKEN}`, 'Bearer wrong', `Bearer ${TOKEN}x`, `Bearer  ${TOKEN}`, `Bearer ${TOKEN.slice(0, -1)}`]) {
    const r = await s.call('/api/summary', { auth });
    assert.equal(r.status, 401, String(auth));
    assert.deepEqual(r.body, { error: 'unauthorized' });
    assert.equal(r.headers.get('WWW-Authenticate'), 'Bearer');
  }
});

test('읽기 전용: GET 말고는 405, 모르는 경로는 404', async () => {
  const s = setup();
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const r = await s.call('/api/summary', { method });
    assert.equal(r.status, 405);
    assert.equal(r.headers.get('Allow'), 'GET');
  }
  for (const path of ['/', '/api', '/api/summary/x', '/v1/caches']) assert.equal((await s.call(path)).status, 404, path);
});

test('응답은 캐시하지 않고, 다른 출처에 열지 않는다', async () => {
  const s = setup();
  const r = await s.call();
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
  assert.equal(r.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), null);
});

test('출시 시각이 없거나 틀리면 503 misconfigured, 기간 값이 틀리면 400', async () => {
  const s = setup();
  for (const LAUNCH_AT of [undefined, 'not-a-date']) {
    const r = await s.call('/api/summary', { env: { ...s.adminEnv, LAUNCH_AT } });
    assert.equal(r.status, 503);
    assert.equal(r.body.error, 'misconfigured');
  }
  const bad = await s.call('/api/summary?range=30d');
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'bad_range');
});

test('출시 이후 지표: 14.1절 정의대로 센다', async () => {
  const s = setup();
  await seed(s);
  const r = await s.call('/api/summary?range=launch');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.period.metrics, {
    players: 4, // p1~p4
    places: 4,
    placers: 2, // p1, p2
    uses: 3,
    takers: 2, // p2, p3
    usedCaches: 2, // a, b
    usedPct: 50,
    thanks: 1,
    thanksPct: 33.3,
    returningPlacers: 1, // p1: 서로 다른 두 날
  });
  assert.equal(r.body.period.from, LAUNCH);
  assert.equal(r.body.now, T0 + DAY + HOUR);
});

test('최근 24시간: 그 전에 생긴 기록은 빼되, 접속은 UTC 날짜 단위로 센다', async () => {
  const s = setup();
  await seed(s);
  const m = (await s.call('/api/summary?range=1d')).body.period.metrics;
  assert.equal(m.places, 1);
  assert.equal(m.placers, 1);
  assert.equal(m.uses, 0);
  assert.equal(m.takers, 0);
  assert.equal(m.usedPct, 0);
  assert.equal(m.thanksPct, null, '쓰임이 없으면 비율이 없다');
  assert.equal(m.returningPlacers, 0);
  assert.equal(m.players, 4, '24시간 전 시각이 어제 날짜라 어제 접속도 들어간다');
});

test('14일 판단: 기간 밖 기록은 빼고, 14일이 지나면 확정한다', async () => {
  const s = setup();
  await seed(s);
  let d = (await s.call()).body.decision;
  assert.equal(d.final, false);
  assert.equal(d.endsAt, LAUNCH + 14 * DAY);
  assert.equal(d.verdict, 'stop', '둔 플레이어가 5명 미만');
  assert.deepEqual(d.criteria, DECISION);

  s.clock.t = LAUNCH + 15 * DAY;
  await s.place(5, FREE[4]);
  const r = (await s.call()).body;
  d = r.decision;
  assert.equal(d.final, true);
  assert.equal(d.to, LAUNCH + 14 * DAY);
  assert.equal(d.metrics.placers, 2, '15일째에 둔 p5는 판단에 넣지 않는다');
  assert.equal(r.period.metrics.placers, 3, '출시 이후 기간에는 들어간다');
});

test('보존 기간(90일)이 지나 판단 기간 기록이 지워지기 시작하면 판정을 다시 내리지 않는다', async () => {
  const s = setup();
  await seed(s);
  let r = (await s.call()).body;
  assert.equal(r.decision.expired, false);
  assert.equal(r.period.partial, false);

  s.clock.t = LAUNCH + RULES.retentionMs - HOUR;
  r = (await s.call()).body;
  assert.equal(r.decision.expired, false, '보존 기간 안에서는 판정이 그대로');
  assert.equal(r.decision.verdict, 'stop');

  s.clock.t = LAUNCH + RULES.retentionMs + DAY;
  await s.game.scheduled(s.gameEnv);
  r = (await s.call()).body;
  assert.equal(r.decision.expired, true);
  assert.equal(r.decision.final, true);
  assert.equal(r.decision.metrics, null, '줄어든 기록으로 다시 센 수치를 내놓지 않는다');
  assert.equal(r.decision.verdict, null);
  assert.equal(r.period.partial, true, '출시 이후 합계에서 지워진 기록이 빠졌다고 알린다');
  assert.equal(r.period.metrics.uses, 0, '실제로 지워졌다');
  assert.equal((await s.call('/api/summary?range=7d')).body.period.partial, false);
});

test('판단 기준: 계속·재검토·중단, 그리고 기준 사이', () => {
  const m = (placers, takers, usedPct) => ({ placers, takers, usedPct });
  assert.equal(verdict(m(4, 100, 100)), 'stop');
  assert.equal(verdict(m(5, 20, 40)), 'continue');
  assert.equal(verdict(m(5, 19, 90)), 'between');
  assert.equal(verdict(m(5, 30, 19.9)), 'review');
  assert.equal(verdict(m(5, 30, 20)), 'between');
});

test('상태: 킬 스위치, 살아 있는 보급품, 정리 작업 확인', async () => {
  const s = setup();
  await seed(s);
  let st = (await s.call()).body.status;
  assert.equal(st.enabled, true);
  assert.deepEqual(st.live, { total: 4, bandage: 3, fuel: 1, battery: 0 });
  assert.equal(st.maxActiveTotal, RULES.maxActiveTotal);
  assert.equal(st.lastAggregateDay, null);
  assert.equal(st.cron, 'pending', '출시 이틀 안에는 아직 정리 작업이 안 돌았을 수 있다');

  await s.game.scheduled(s.gameEnv);
  st = (await s.call()).body.status;
  assert.equal(st.lastAggregateDay, '2026-11-06');
  assert.equal(st.cron, 'ok');

  s.db.raw.prepare("UPDATE settings SET value = 'false' WHERE key = 'enabled'").run();
  s.clock.t += 3 * DAY;
  st = (await s.call()).body.status;
  assert.equal(st.enabled, false);
  assert.equal(st.cron, 'late', '사흘 동안 집계가 없으면 늦음');
  assert.equal(st.live.total, 0, '72시간 수명이 지났다');
});

test('일별 추이: 기간 시작 날부터 오늘까지(UTC), 빈 날은 0', async () => {
  const s = setup();
  await seed(s);
  assert.deepEqual((await s.call()).body.daily, [
    { day: '2026-11-06', players: 3, places: 3, uses: 3, thanks: 1 },
    { day: '2026-11-07', players: 1, places: 1, uses: 0, thanks: 0 },
  ]);
  const week = (await s.call('/api/summary?range=7d')).body.daily;
  assert.deepEqual(week.map((d) => d.day), ['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07'],
    '고른 기간의 시작 날부터');
  assert.equal((await s.call('/api/summary?range=1d')).body.daily.length, 2);
  s.clock.t = T0 + 40 * DAY;
  const daily = (await s.call()).body.daily;
  assert.equal(daily.length, 30, '최대 30일');
  assert.equal(daily.at(-1).day, '2026-12-16');
  assert.ok(daily.every((d) => d.players === 0 && d.places === 0));
});

test('남용 살펴보기: 24시간 등록이 많은 소유자와 오늘 IP 한도', async () => {
  const s = setup();
  await seed(s);
  const a = (await s.call()).body.abuse;
  assert.deepEqual(a.topOwners, [{ owner: ownerHash(1), n: 1 }]);
  assert.equal(a.maxActivePerPlayer, RULES.maxActivePerPlayer);
  assert.equal(a.rate.length, 1);
  assert.equal(a.rate[0].action, 'place');
  assert.equal(a.rate[0].count, 1);
  assert.equal(a.rate[0].limit, RULES.maxPlacesPerIpPerDay);
  assert.match(a.rate[0].key, /^[0-9a-f]{8}$/, 'IP 키는 앞 8자만');
});

test('본인 삭제한 소유자는 둔 플레이어·남용 목록에서 빠진다', async () => {
  const s = setup();
  await seed(s);
  const res = await s.game.fetch(new Request('https://api.test/v1/me', {
    method: 'DELETE', headers: { Origin: ORIGIN, 'CF-Connecting-IP': '203.0.113.1', 'X-Lumen-Player': pid(1) },
  }), s.gameEnv);
  assert.equal(res.status, 204);
  const r = (await s.call()).body;
  assert.equal(r.period.metrics.placers, 1);
  assert.equal(r.period.metrics.places, 4, '보급품 행은 정리 작업 전까지 남는다');
  assert.deepEqual(r.abuse.topOwners, []);
});

test('D1 조회가 실패하면 503 db_unavailable', async (t) => {
  const s = setup();
  t.mock.method(console, 'error', () => {});
  const broken = { ...s.db, batch: async () => { throw new Error('D1_ERROR: limit exceeded'); } };
  const r = await s.call('/api/summary', { env: { ...s.adminEnv, DB: broken } });
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'db_unavailable');
  assert.equal(console.error.mock.callCount(), 1, '원인은 로그로 남긴다');
});

test('D1이 읽은 행 수를 알려 주면 합해서 보여 준다', async () => {
  const s = setup();
  assert.equal((await s.call()).body.cost.rowsRead, null, '모르면 null');
  const counting = { ...s.db, batch: async (stmts) => (await s.db.batch(stmts)).map((r) => ({ ...r, meta: { rows_read: 2 } })) };
  const r = await s.call('/api/summary', { env: { ...s.adminEnv, DB: counting } });
  assert.equal(r.body.cost.rowsRead, 22);
});
