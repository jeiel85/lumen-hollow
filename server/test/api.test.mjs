// 공유 보급품 규칙 테스트. 설계: docs/online-caches.md 5.2절, 7~13절.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { RULES } from '../src/rules.js';
import { BLOCKED_SLOTS } from '../src/slots.js';
import { createD1 } from './d1.mjs';

const HOUR = 3600e3;
const DAY = 24 * HOUR;
const ORIGIN = 'https://jeiel85.github.io';
const FREE = [...Array(600).keys()].filter((s) => !BLOCKED_SLOTS.includes(s));

const pid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function setup({ rules = RULES, limiter = () => true, env: extra = {}, latency = false, verify } = {}) {
  const clock = { t: Date.UTC(2026, 10, 6, 12) };
  const db = createD1({ latency });
  const app = createApp({ now: () => clock.t, rules, verify });
  const rl = { limit: async ({ key }) => ({ success: limiter(key) }) };
  const env = { DB: db, IP_HASH_SECRET: 'test-secret', ALLOWED_ORIGINS: `${ORIGIN},http://localhost:8000`, RL_READ: rl, RL_WRITE: rl, ...extra };
  async function call(method, path, { player, body, ip = '203.0.113.1', origin = ORIGIN, headers = {} } = {}) {
    const h = { Origin: origin, 'CF-Connecting-IP': ip, ...headers };
    if (player !== undefined) h['X-Lumen-Player'] = player;
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const res = await app.fetch(new Request(`https://api.test${path}`, {
      method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    }), env);
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
  }
  const placeAs = (n, slot, kind = 'bandage', o = {}) => call('POST', '/v1/caches', { player: pid(n), body: { layout: 1, slot, kind, note: 1 }, ...o });
  return { clock, db, app, env, call, placeAs };
}

test('보급품을 두면 목록에 나오고, 주인 정보는 응답에 없다', async () => {
  const s = setup();
  const r = await s.placeAs(1, FREE[0]);
  assert.equal(r.status, 201);
  assert.match(r.body.cache.id, /^c_[a-z2-7]{26}$/);
  assert.equal(r.body.cache.charges, RULES.charges);
  assert.equal(r.body.cache.expiresAt, s.clock.t + RULES.lifetimeMs);
  const l = await s.call('GET', '/v1/caches?layout=1');
  assert.equal(l.status, 200);
  assert.equal(l.body.enabled, true);
  assert.deepEqual(Object.keys(l.body.caches[0]).sort(), ['charges', 'expiresAt', 'id', 'kind', 'note', 'slot', 'thanks']);
  assert.equal(l.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(l.headers.get('Cache-Control'), 'no-store');
});

test('형식이 틀린 두기 요청은 400·413으로 거절한다', async () => {
  const s = setup();
  const base = { layout: 1, slot: FREE[0], kind: 'bandage', note: 0 };
  const cases = [
    [{ ...base, layout: 2 }, 'bad_layout'],
    [{ ...base, slot: -1 }, 'bad_slot'],
    [{ ...base, slot: 600 }, 'bad_slot'],
    [{ ...base, slot: 1.5 }, 'bad_slot'],
    [{ ...base, slot: BLOCKED_SLOTS[0] }, 'bad_slot'],
    [{ ...base, kind: 'fuse' }, 'bad_kind'],
    [{ ...base, kind: 'gun' }, 'bad_kind'],
    [{ ...base, note: 8 }, 'bad_note'],
    [{ ...base, note: '1' }, 'bad_note'],
  ];
  for (const [body, code] of cases) {
    const r = await s.call('POST', '/v1/caches', { player: pid(1), body });
    assert.equal(r.status, 400, code);
    assert.equal(r.body.error, code);
  }
  assert.equal((await s.call('POST', '/v1/caches', { player: pid(1), body: '{nope' })).body.error, 'bad_json');
  assert.equal((await s.call('POST', '/v1/caches', { player: pid(1), body: { ...base, pad: 'x'.repeat(2000) } })).status, 413);
  assert.equal((await s.call('POST', '/v1/caches', { player: 'not-a-uuid', body: base })).body.error, 'bad_player');
  assert.equal((await s.call('POST', '/v1/caches', { body: base })).body.error, 'bad_player');
});

test('한 슬롯에는 살아 있는 보급품이 하나뿐이고, 만료되면 자리가 빈다', async () => {
  const s = setup();
  assert.equal((await s.placeAs(1, FREE[0])).status, 201);
  const dup = await s.placeAs(2, FREE[0]);
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error, 'slot_taken');
  s.clock.t += RULES.lifetimeMs + 1;
  assert.equal((await s.placeAs(2, FREE[0])).status, 201);
});

test('플레이어당 활성 3개, IP당 하루 6개, 마을 전체 상한을 지킨다', async () => {
  const s = setup();
  for (let i = 0; i < RULES.maxActivePerPlayer; i++) assert.equal((await s.placeAs(1, FREE[i])).status, 201);
  const over = await s.placeAs(1, FREE[10]);
  assert.equal(over.status, 429);
  assert.equal(over.body.error, 'player_limit');
  // 같은 IP에서 다른 ID로: 하루 6개까지
  for (let i = 0; i < RULES.maxPlacesPerIpPerDay - RULES.maxActivePerPlayer; i++) {
    assert.equal((await s.placeAs(100 + i, FREE[20 + i])).status, 201);
  }
  const ipOver = await s.placeAs(200, FREE[40]);
  assert.equal(ipOver.body.error, 'ip_daily');
  // 다음 날에는 다시 둘 수 있다(IP 키가 날짜와 함께 바뀐다)
  s.clock.t += DAY;
  assert.equal((await s.placeAs(200, FREE[40])).status, 201);

  const small = setup({ rules: { ...RULES, maxActiveTotal: 2 } });
  assert.equal((await small.placeAs(1, FREE[0], 'bandage', { ip: '198.51.100.1' })).status, 201);
  assert.equal((await small.placeAs(2, FREE[1], 'bandage', { ip: '198.51.100.2' })).status, 201);
  const full = await small.placeAs(3, FREE[2], 'bandage', { ip: '198.51.100.3' });
  assert.equal(full.status, 429);
  assert.equal(full.body.error, 'town_full');
});

test('쓰기: 본인 불가, 같은 사람 24시간 1회, 8번 쓰면 소진되어 목록에서 빠지고 슬롯이 빈다', async () => {
  const s = setup();
  const id = (await s.placeAs(1, FREE[0], 'fuel')).body.cache.id;
  const own = await s.call('POST', `/v1/caches/${id}/use`, { player: pid(1) });
  assert.equal(own.status, 403);
  assert.equal(own.body.error, 'own_cache');

  const first = await s.call('POST', `/v1/caches/${id}/use`, { player: pid(2) });
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, { kind: 'fuel', charges: RULES.charges - 1 });
  const again = await s.call('POST', `/v1/caches/${id}/use`, { player: pid(2) });
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'used_today');
  s.clock.t += RULES.reuseCooldownMs + 1;
  assert.equal((await s.call('POST', `/v1/caches/${id}/use`, { player: pid(2) })).body.charges, RULES.charges - 2);

  for (let n = 3; n <= RULES.charges; n++) {
    const r = await s.call('POST', `/v1/caches/${id}/use`, { player: pid(n), ip: `192.0.2.${n}` });
    assert.equal(r.status, 200);
  }
  const gone = await s.call('POST', `/v1/caches/${id}/use`, { player: pid(50) });
  assert.equal(gone.status, 410);
  assert.equal((await s.call('GET', '/v1/caches?layout=1')).body.caches.length, 0);
  const row = s.db.raw.prepare('SELECT charges, removed_by FROM caches WHERE id = ?').get(id);
  assert.deepEqual({ ...row }, { charges: 0, removed_by: 'exhausted' });
  assert.equal((await s.placeAs(9, FREE[0])).status, 201, '소진된 슬롯에 다시 둘 수 있다');
});

test('마지막 하나를 가져간 사람이 다시 물으면(응답이 끊겼던 경우) 소진된 상자라도 used_today', async () => {
  const s = setup();
  const id = (await s.placeAs(1, FREE[0], 'bandage')).body.cache.id;
  for (let n = 2; n < RULES.charges + 1; n++) {
    assert.equal((await s.call('POST', `/v1/caches/${id}/use`, { player: pid(n), ip: `192.0.2.${n}` })).status, 200);
  }
  const last = await s.call('POST', `/v1/caches/${id}/use`, { player: pid(90), ip: '192.0.2.90' });
  assert.equal(last.status, 200);
  assert.equal(last.body.charges, 0);
  const retry = await s.call('POST', `/v1/caches/${id}/use`, { player: pid(90), ip: '192.0.2.90' });
  assert.equal(retry.status, 409);
  assert.equal(retry.body.error, 'used_today');
  // 처음 오는 사람에게는 여전히 사라진 상자다
  assert.equal((await s.call('POST', `/v1/caches/${id}/use`, { player: pid(91), ip: '192.0.2.91' })).status, 410);
  // 한계: 재사용 대기(reuseCooldownMs)가 지나면 '최근에 썼다'를 알 수 없다(그때는 410). 상자 수명이 대기보다 길어
  // 만료된 뒤에 다시 물으면 확인할 수 없다 — 클라이언트는 이어하기에서 곧바로 다시 묻는다.
  s.clock.t += RULES.reuseCooldownMs + 1;
  assert.equal((await s.call('POST', `/v1/caches/${id}/use`, { player: pid(90), ip: '192.0.2.90' })).status, 410);
});

test('같은 밀리초에 두 번 눌러도 횟수와 고마워요가 한 번만 반영된다', async () => {
  const s = setup();
  const id = (await s.placeAs(1, FREE[0])).body.cache.id;
  const [a, b] = await Promise.all([
    s.call('POST', `/v1/caches/${id}/use`, { player: pid(2) }),
    s.call('POST', `/v1/caches/${id}/use`, { player: pid(2) }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  await s.call('POST', `/v1/caches/${id}/thanks`, { player: pid(2) });
  await s.call('POST', `/v1/caches/${id}/thanks`, { player: pid(2) });
  const row = s.db.raw.prepare('SELECT charges, thanks FROM caches WHERE id = ?').get(id);
  assert.deepEqual({ ...row }, { charges: RULES.charges - 1, thanks: 1 });
});

test('만료된 보급품과 없는 ID는 쓸 수 없다', async () => {
  const s = setup();
  const id = (await s.placeAs(1, FREE[0])).body.cache.id;
  s.clock.t += RULES.lifetimeMs;
  assert.equal((await s.call('POST', `/v1/caches/${id}/use`, { player: pid(2) })).status, 410);
  assert.equal((await s.call('POST', '/v1/caches/c_aaaaaaaaaaaaaaaaaaaaaaaaaa/use', { player: pid(2) })).status, 404);
  assert.equal((await s.call('POST', '/v1/caches/zzz/use', { player: pid(2) })).status, 404);
});

test('하루 IP 한도 직전에 동시에 온 요청도 한도만큼만 통과한다(확인과 소모가 한 트랜잭션)', async () => {
  const s = setup({ rules: { ...RULES, maxPlacesPerIpPerDay: 1, maxUsesPerIpPerDay: 1 }, latency: true });
  const placed = await Promise.all([1, 2, 3].map((n) => s.placeAs(n, FREE[n])));
  assert.deepEqual(placed.map((r) => r.status).sort(), [201, 429, 429]);
  assert.ok(placed.filter((r) => r.status === 429).every((r) => r.body.error === 'ip_daily'));
  assert.equal(s.db.raw.prepare("SELECT count FROM rate_daily WHERE action = 'place'").get().count, 1);

  const ids = [];
  for (let n = 10; n < 13; n++) ids.push((await s.placeAs(n, FREE[n], 'bandage', { ip: `198.51.100.${n}` })).body.cache.id);
  const used = await Promise.all(ids.map((id) => s.call('POST', `/v1/caches/${id}/use`, { player: pid(50) })));
  assert.deepEqual(used.map((r) => r.status).sort(), [200, 429, 429]);
  const total = s.db.raw.prepare('SELECT sum(?1 - charges) AS n FROM caches WHERE id IN (?2, ?3, ?4)').get(RULES.charges, ...ids).n;
  assert.equal(total, 1, '횟수도 한 번만 줄었다');
});

test('IP당 하루 사용 한도', async () => {
  const s = setup({ rules: { ...RULES, maxUsesPerIpPerDay: 2 } });
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push((await s.placeAs(10 + i, FREE[i], 'bandage', { ip: `198.51.100.${i}` })).body.cache.id);
  assert.equal((await s.call('POST', `/v1/caches/${ids[0]}/use`, { player: pid(1) })).status, 200);
  assert.equal((await s.call('POST', `/v1/caches/${ids[1]}/use`, { player: pid(1) })).status, 200);
  const over = await s.call('POST', `/v1/caches/${ids[2]}/use`, { player: pid(1) });
  assert.equal(over.status, 429);
  assert.equal(over.body.error, 'ip_daily');
});

test('고마워요: 쓴 사람만 1회, 수명 +12시간, 만든 때부터 최대 7일', async () => {
  const s = setup();
  const placed = (await s.placeAs(1, FREE[0])).body.cache;
  const notUsed = await s.call('POST', `/v1/caches/${placed.id}/thanks`, { player: pid(2) });
  assert.equal(notUsed.status, 403);
  assert.equal(notUsed.body.error, 'not_used');
  assert.equal((await s.call('POST', `/v1/caches/${placed.id}/thanks`, { player: pid(1) })).body.error, 'not_used', '주인은 쓸 수 없으니 고마워요도 없다');

  await s.call('POST', `/v1/caches/${placed.id}/use`, { player: pid(2) });
  const ok = await s.call('POST', `/v1/caches/${placed.id}/thanks`, { player: pid(2) });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.thanks, 1);
  assert.equal(ok.body.expiresAt, placed.expiresAt + RULES.thanksExtendMs);
  const twice = await s.call('POST', `/v1/caches/${placed.id}/thanks`, { player: pid(2) });
  assert.equal(twice.status, 409);
  assert.equal(twice.body.error, 'already_thanked');

  // 8명이 모두 써서 소진돼도, 수명이 남은 동안은 쓴 사람이 고마워요를 보낼 수 있다. 수명은 7일을 넘지 않는다.
  let last;
  for (let n = 3; n <= RULES.charges + 1; n++) {
    await s.call('POST', `/v1/caches/${placed.id}/use`, { player: pid(n), ip: `192.0.2.${n}` });
    last = await s.call('POST', `/v1/caches/${placed.id}/thanks`, { player: pid(n), ip: `192.0.2.${n}` });
    assert.equal(last.status, 200);
  }
  assert.equal(last.body.thanks, RULES.charges);
  assert.equal(last.body.expiresAt, placed.expiresAt - RULES.lifetimeMs + RULES.maxLifetimeMs);
});

test('킬 스위치: 목록은 enabled:false, 쓰기는 503, 본인 삭제는 계속 받는다', async () => {
  const s = setup();
  await s.placeAs(1, FREE[0]);
  s.db.raw.exec("UPDATE settings SET value = 'false' WHERE key = 'enabled'");
  s.clock.t += RULES.listMemoMs; // 목록 메모가 지난 뒤
  const l = await s.call('GET', '/v1/caches?layout=1');
  assert.deepEqual([l.status, l.body.enabled, l.body.caches.length], [200, false, 0]);
  assert.equal((await s.placeAs(2, FREE[1])).status, 503);
  assert.equal((await s.call('GET', '/v1/me', { player: pid(1) })).status, 503);
  assert.equal((await s.call('DELETE', '/v1/me', { player: pid(1) })).status, 204);
});

test('레이트 리밋에 걸리면 429, 설정이 빠지면 503', async () => {
  const blocked = setup({ limiter: () => false });
  assert.equal((await blocked.call('GET', '/v1/caches?layout=1')).body.error, 'rate');
  assert.equal((await blocked.placeAs(1, FREE[0])).body.error, 'rate');
  const broken = setup({ env: { IP_HASH_SECRET: '' } });
  const r = await broken.call('GET', '/v1/caches?layout=1');
  assert.deepEqual([r.status, r.body.error], [503, 'misconfigured']);
});

test('분당 레이트 리밋 바인딩이 없어도 동작하고, 하루 한도는 그대로 지킨다', async () => {
  const s = setup({ env: { RL_READ: undefined, RL_WRITE: undefined } });
  assert.equal((await s.call('GET', '/v1/caches?layout=1')).status, 200);
  for (let i = 0; i < RULES.maxPlacesPerIpPerDay; i++) assert.equal((await s.placeAs(10 + i, FREE[i])).status, 201);
  assert.equal((await s.placeAs(99, FREE[30])).body.error, 'ip_daily');
});

test('레이트 리밋 키는 원문 IP가 아니고 날짜마다 바뀐다', async () => {
  const keys = [];
  const s = setup({ limiter: (key) => { keys.push(key); return true; } });
  await s.call('GET', '/v1/caches?layout=1', { ip: '203.0.113.7' });
  await s.call('GET', '/v1/caches?layout=1', { ip: '203.0.113.7' });
  s.clock.t += DAY;
  await s.call('GET', '/v1/caches?layout=1', { ip: '203.0.113.7' });
  assert.equal(keys[0], keys[1]);
  assert.notEqual(keys[0], keys[2]);
  assert.ok(!keys[0].includes('203.0.113.7'));
  const stored = s.db.raw.prepare("SELECT * FROM rate_daily").all();
  assert.equal(stored.length, 0, '읽기는 하루 카운터에 남지 않는다');
});

test('CORS: 허용된 출처에만 헤더를 주고, 사전 요청은 204', async () => {
  const s = setup();
  const pre = await s.call('OPTIONS', '/v1/caches');
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('Access-Control-Allow-Headers'), /X-Lumen-Player/);
  const other = await s.call('GET', '/v1/caches?layout=1', { origin: 'https://evil.example' });
  assert.equal(other.headers.get('Access-Control-Allow-Origin'), null);
});

test('다른 배치 버전의 목록은 비어 있다', async () => {
  const s = setup();
  await s.placeAs(1, FREE[0]);
  assert.equal((await s.call('GET', '/v1/caches?layout=2')).body.caches.length, 0);
});

test('내 소식: 활성·둔 수·쓴 사람 수·고마워요, 접속 기록은 하루 한 번', async () => {
  const s = setup();
  const a = (await s.placeAs(1, FREE[0])).body.cache.id;
  await s.placeAs(1, FREE[1]);
  await s.call('POST', `/v1/caches/${a}/use`, { player: pid(2) });
  await s.call('POST', `/v1/caches/${a}/use`, { player: pid(3) });
  await s.call('POST', `/v1/caches/${a}/thanks`, { player: pid(3) });
  const me = await s.call('GET', '/v1/me', { player: pid(1) });
  assert.deepEqual(me.body, { active: 2, placed: 2, uses: 2, users: 2, thanks: 1 });
  await s.call('GET', '/v1/me', { player: pid(1) });
  assert.equal(s.db.raw.prepare('SELECT count(*) AS n FROM seen').get().n, 1);
});

test('본인 삭제: 내 기록은 지우고, 내 보급품은 내리고 연결을 끊되 남의 사용 기록은 남긴다', async () => {
  const s = setup();
  const mine = (await s.placeAs(1, FREE[0])).body.cache.id;
  const theirs = (await s.placeAs(2, FREE[1])).body.cache.id;
  await s.call('POST', `/v1/caches/${mine}/use`, { player: pid(2) });
  await s.call('POST', `/v1/caches/${theirs}/use`, { player: pid(1) });
  await s.call('POST', `/v1/caches/${theirs}/thanks`, { player: pid(1) });
  await s.call('GET', '/v1/me', { player: pid(1) });
  assert.equal((await s.call('DELETE', '/v1/me', { player: pid(1) })).status, 204);
  const q = (sql) => s.db.raw.prepare(sql).all();
  assert.deepEqual(q(`SELECT owner, removed_by FROM caches WHERE id = '${mine}'`).map((r) => ({ ...r })), [{ owner: 'deleted', removed_by: 'owner' }]);
  assert.equal(q(`SELECT * FROM uses WHERE cache_id = '${theirs}'`).length, 0, '내 사용 기록 삭제');
  assert.equal(q('SELECT * FROM thanks').length, 0, '내 고마워요 삭제');
  assert.equal(q('SELECT * FROM seen').length, 0, '내 접속 기록 삭제');
  assert.equal(q(`SELECT * FROM uses WHERE cache_id = '${mine}'`).length, 1, '남이 내 상자를 쓴 기록은 남는다');
  assert.equal((await s.call('GET', '/v1/caches?layout=1')).body.caches.length, 1);
});

test('정리 작업: 집계 뒤 90일 지난 기록을 자식부터 지우고, 외래 키 오류가 없다', async () => {
  const s = setup();
  const id = (await s.placeAs(1, FREE[0])).body.cache.id;
  s.clock.t += RULES.lifetimeMs - HOUR;
  await s.call('POST', `/v1/caches/${id}/use`, { player: pid(2) });
  await s.call('POST', `/v1/caches/${id}/thanks`, { player: pid(2) });
  await s.call('GET', '/v1/me', { player: pid(2) });

  s.clock.t += DAY;
  await s.app.scheduled(s.env);
  const stats = Object.fromEntries(s.db.raw.prepare('SELECT metric, value FROM daily_stats WHERE value > 0').all().map((r) => [r.metric, r.value]));
  assert.ok(stats.uses >= 1 && stats.thanks >= 1 && stats.seen >= 1, JSON.stringify(stats));
  assert.equal(s.db.raw.prepare(`SELECT removed_by FROM caches WHERE id = '${id}'`).get().removed_by, 'expired');

  s.clock.t += RULES.retentionMs;
  await s.app.scheduled(s.env);
  const count = (tbl) => s.db.raw.prepare(`SELECT count(*) AS n FROM ${tbl}`).get().n;
  assert.deepEqual([count('caches'), count('uses'), count('thanks'), count('seen'), count('rate_daily')], [0, 0, 0, 0, 0]);
  assert.ok(count('daily_stats') > 0, '집계는 남는다');
});

test('부모를 먼저 지우면 외래 키가 막는다(연쇄 삭제 없음)', async () => {
  const s = setup();
  const id = (await s.placeAs(1, FREE[0])).body.cache.id;
  await s.call('POST', `/v1/caches/${id}/use`, { player: pid(2) });
  assert.throws(() => s.db.raw.prepare('DELETE FROM caches WHERE id = ?').run(id), /FOREIGN KEY/);
});

// ---------------------------------------------------------------- 클라이언트에 주는 규칙 수치 (#17)

test('목록 응답에 클라이언트 안내용 규칙 수치(rules)가 있고 서버 규칙을 따른다', async () => {
  const s = setup({ rules: { ...RULES, charges: 5, maxActivePerPlayer: 2 } });
  const expected = { charges: 5, maxActivePerPlayer: 2, reuseCooldownMs: RULES.reuseCooldownMs, maxLifetimeMs: RULES.maxLifetimeMs };
  const first = await s.call('GET', '/v1/caches?layout=1');
  assert.deepEqual(first.body.rules, expected);
  assert.deepEqual((await s.call('GET', '/v1/caches?layout=1')).body.rules, expected, 'Worker 메모리에 둔 목록에서도');
  assert.deepEqual((await s.call('GET', '/v1/caches?layout=2')).body.rules, expected, '다른 배치 버전에서도');
  s.db.raw.exec("UPDATE settings SET value = 'false' WHERE key = 'enabled'");
  s.clock.t += RULES.listMemoMs;
  assert.deepEqual((await s.call('GET', '/v1/caches?layout=1')).body.rules, expected, '킬 스위치가 내려가도');
  assert.deepEqual(first.body.caches, [], '보급품 목록 형식은 그대로');
});

// ---------------------------------------------------------------- 2단계 남용 대응 (#17, 설계 10절)

test('판 토큰: 목록마다 새로 주고, 기본(꺼짐)에서는 토큰 없이도 둘 수 있다', async () => {
  const s = setup();
  const a = (await s.call('GET', '/v1/caches?layout=1')).body.runToken;
  s.clock.t += 1000;
  const b = (await s.call('GET', '/v1/caches?layout=1')).body.runToken;
  assert.match(a, /^\d{13}\.[0-9a-f]{32}$/);
  assert.notEqual(a, b, 'Worker 메모리에 둔 목록이어도 토큰은 응답 시각으로 새로 만든다');
  assert.equal((await s.placeAs(1, FREE[0])).status, 201);
  const off = setup({ env: { RUN_TOKEN_REQUIRED: 'false' } });
  assert.equal((await off.placeAs(1, FREE[0])).status, 201);
});

test('판 토큰을 켜면: 없거나 위조·만료면 403 run_token, 받은 지 3분 전이면 403 too_early', async () => {
  const s = setup({ env: { RUN_TOKEN_REQUIRED: 'true' } });
  const place = (n, slot, runToken) => s.call('POST', '/v1/caches', { player: pid(n), body: { layout: 1, slot, kind: 'bandage', note: 0, runToken } });
  const token = (await s.call('GET', '/v1/caches?layout=1')).body.runToken;
  const missing = await place(1, FREE[0]);
  assert.deepEqual([missing.status, missing.body.error], [403, 'run_token']);
  const early = await place(1, FREE[0], token);
  assert.deepEqual([early.status, early.body.error], [403, 'too_early']);
  s.clock.t += RULES.runTokenMinAgeMs - 1;
  assert.equal((await place(1, FREE[0], token)).body.error, 'too_early');
  s.clock.t += 1;
  const [issued, sig] = token.split('.');
  const forged = [`${issued}.${'0'.repeat(32)}`, `${Number(issued) - 600000}.${sig}`, `${issued}.${sig.toUpperCase()}`, `${token}x`, 42];
  for (const bad of forged) assert.equal((await place(1, FREE[0], bad)).body.error, 'run_token', String(bad));
  assert.equal(s.db.raw.prepare('SELECT count(*) AS n FROM rate_daily').get().n, 0, '거절된 요청은 하루 한도를 쓰지 않는다');
  assert.equal((await place(1, FREE[0], token)).status, 201, '3분이 지나면 둘 수 있다');
  s.clock.t += RULES.runTokenMaxAgeMs;
  assert.equal((await place(1, FREE[1], token)).body.error, 'run_token', '24시간이 넘은 토큰은 받지 않는다');
  const other = setup({ env: { RUN_TOKEN_REQUIRED: 'true', IP_HASH_SECRET: 'another-secret' } });
  other.clock.t += RULES.runTokenMinAgeMs;
  const r = await other.call('POST', '/v1/caches', { player: pid(1), body: { layout: 1, slot: FREE[0], kind: 'bandage', note: 0, runToken: token } });
  assert.equal(r.body.error, 'run_token', '다른 비밀값으로 서명한 토큰은 받지 않는다');
});

test('사람 확인을 켜면 Turnstile로 확인하고, 실패·장애·설정 누락을 구분한다', async (t) => {
  t.mock.method(console, 'error', () => {});
  const calls = [];
  let reply = { success: true };
  const verify = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply));
  };
  const s = setup({ env: { HUMAN_CHECK_REQUIRED: 'true', TURNSTILE_SECRET: 'ts-secret' }, verify });
  const place = (n, slot, humanToken) => s.call('POST', '/v1/caches', { player: pid(n), body: { layout: 1, slot, kind: 'bandage', note: 0, humanToken } });

  assert.equal((await place(1, FREE[0])).body.error, 'human_check', '토큰이 없으면 확인 요청도 보내지 않는다');
  assert.equal(calls.length, 0);
  const long = 'h'.repeat(1800); // 실제 토큰은 1KB를 넘을 수 있다(최대 2048자)
  assert.equal((await place(1, FREE[0], long)).status, 201);
  assert.deepEqual(calls[0], { url: 'https://challenges.cloudflare.com/turnstile/v0/siteverify', body: { secret: 'ts-secret', response: long } });
  assert.ok(!('remoteip' in calls[0].body), '원문 IP를 보내지 않는다');

  reply = { success: false, 'error-codes': ['invalid-input-response'] };
  const denied = await place(2, FREE[1], 'x');
  assert.deepEqual([denied.status, denied.body.error], [403, 'human_check']);
  reply = new Error('network down');
  const down = await place(2, FREE[1], 'x');
  assert.deepEqual([down.status, down.body.error], [503, 'human_check_unavailable']);
  assert.equal((await place(2, FREE[1], 'h'.repeat(2049))).body.error, 'human_check', '2048자를 넘는 토큰');
  assert.equal(s.db.raw.prepare('SELECT count(*) AS n FROM caches').get().n, 1, '거절된 요청은 D1에 쓰지 않는다');

  const noSecret = setup({ env: { HUMAN_CHECK_REQUIRED: 'true' }, verify });
  const r = await noSecret.placeAs(1, FREE[0]);
  assert.deepEqual([r.status, r.body.error], [503, 'misconfigured'], '비밀값 없이 켜면 닫힌 채로 실패한다');

  const off = setup({ verify });
  calls.length = 0;
  assert.equal((await off.placeAs(1, FREE[0])).status, 201);
  assert.equal(calls.length, 0, '꺼져 있으면 확인 요청을 보내지 않는다');
});

// ---------------------------------------------------------------- 이야기 진행 집계 (#20, #32)

const storyRows = (s) => s.db.raw.prepare('SELECT day, kind, id, n, skipped FROM story_daily ORDER BY kind, id').all().map((r) => ({ ...r }));
const sendStory = (s, events, o = {}) => s.call('POST', '/v1/story', { body: { events }, ...o });

test('이야기 집계: 플레이어 ID 없이 날짜·종류·id별 횟수와 건너뛴 횟수만 더한다', async () => {
  const s = setup();
  const r = await sendStory(s, [
    { kind: 'scene', id: 'arrival', skipped: false },
    { kind: 'scene', id: 'arrival', skipped: true },
    { kind: 'scene', id: 'dusk' },
    { kind: 'chapter', id: '2' },
    { kind: 'clear', id: '2', skipped: false },
  ]);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { accepted: 5 });
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  await sendStory(s, [{ kind: 'scene', id: 'arrival', skipped: false }], { ip: '198.51.100.9' });
  assert.deepEqual(storyRows(s), [
    { day: '2026-11-06', kind: 'chapter', id: '2', n: 1, skipped: 0 },
    { day: '2026-11-06', kind: 'clear', id: '2', n: 1, skipped: 0 },
    { day: '2026-11-06', kind: 'scene', id: 'arrival', n: 3, skipped: 1 },
    { day: '2026-11-06', kind: 'scene', id: 'dusk', n: 1, skipped: 0 },
    { day: '2026-11-06', kind: 'total', id: '', n: 6, skipped: 0 },
  ]);
  assert.deepEqual(s.db.raw.prepare('PRAGMA table_info(story_daily)').all().map((c) => c.name), ['day', 'kind', 'id', 'n', 'skipped'], '사람을 가리키는 열이 없다');
  assert.equal(s.db.raw.prepare('SELECT count(*) AS n FROM rate_daily').get().n, 0, 'IP 키도 남기지 않는다');
  assert.equal(s.db.raw.prepare('SELECT count(*) AS n FROM seen').get().n, 0);
  s.clock.t += DAY;
  await sendStory(s, [{ kind: 'scene', id: 'arrival' }]);
  assert.equal(s.db.raw.prepare("SELECT n FROM story_daily WHERE day = '2026-11-07' AND kind = 'scene'").get().n, 1, 'UTC 날짜가 바뀌면 새 행');
});

test('이야기 집계: 본문 형식을 엄격하게 확인한다', async () => {
  const s = setup();
  const cases = [
    [{ events: [] }, 'bad_events'],
    [{ events: 'scene' }, 'bad_events'],
    [{}, 'bad_events'],
    [{ events: Array.from({ length: RULES.storyMaxEvents + 1 }, () => ({ kind: 'scene', id: 'a' })) }, 'bad_events'],
    [{ events: [{ kind: 'total', id: 'a' }] }, 'bad_event'],
    [{ events: [{ kind: 'scene', id: 'Arrival' }] }, 'bad_event'],
    [{ events: [{ kind: 'scene', id: '' }] }, 'bad_event'],
    [{ events: [{ kind: 'scene', id: 'a'.repeat(25) }] }, 'bad_event'],
    [{ events: [{ kind: 'scene', id: 'a b' }] }, 'bad_event'],
    [{ events: [{ kind: 'scene', id: 7 }] }, 'bad_event'],
    [{ events: [{ kind: 'scene', id: 'a', skipped: 'yes' }] }, 'bad_event'],
    [{ events: [{ kind: 'chapter', id: '2', skipped: true }] }, 'bad_event'],
    [{ events: [{ kind: 'scene', id: 'ok' }, null] }, 'bad_event'],
  ];
  for (const [body, code] of cases) {
    const r = await s.call('POST', '/v1/story', { body });
    assert.deepEqual([r.status, r.body.error], [400, code], JSON.stringify(body).slice(0, 80));
  }
  const huge = `{"events":[${Array(90).fill('{"kind":"scene","id":"a"}').join(',')}]}`;
  assert.equal((await s.call('POST', '/v1/story', { body: huge })).status, 413);
  assert.equal(storyRows(s).length, 0, '하나라도 틀리면 아무것도 세지 않는다');
  const max = Array.from({ length: RULES.storyMaxEvents }, () => ({ kind: 'scene', id: 'z'.repeat(24), skipped: true }));
  assert.equal((await sendStory(s, max)).body.accepted, RULES.storyMaxEvents, '가장 긴 id로 가득 채운 요청도 본문 한도 안이다');
});

test('이야기 집계: text/plain 본문(sendBeacon)도 받는다', async () => {
  const s = setup();
  const r = await s.call('POST', '/v1/story', {
    body: JSON.stringify({ events: [{ kind: 'scene', id: 'dawn' }] }),
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
  });
  assert.equal(r.status, 200);
  assert.equal(storyRows(s).find((x) => x.id === 'dawn').n, 1);
});

test('이야기 집계: 하루 전체 상한을 넘으면 그날은 더 세지 않고, 다음 날 다시 센다', async () => {
  const s = setup({ rules: { ...RULES, storyMaxEventsPerDay: 5 } });
  const ev = (n) => Array.from({ length: n }, () => ({ kind: 'scene', id: 'arrival' }));
  assert.equal((await sendStory(s, ev(3))).body.accepted, 3);
  assert.equal((await sendStory(s, ev(2))).body.accepted, 2, '상한까지는 받는다');
  assert.equal((await sendStory(s, ev(1))).body.accepted, 0);
  // 가득 찬 뒤의 요청은 D1 행을 하나도 바꾸지 않는다(남용 요청이 게임의 하루 쓰기 한도를 쓰지 않게).
  const batch = s.db.batch;
  let changes = null;
  s.db.batch = async (stmts) => {
    const res = await batch(stmts);
    changes = res.map((r) => r.meta.changes ?? 0).reduce((a, b) => a + b, 0);
    return res;
  };
  assert.equal((await sendStory(s, ev(3))).body.accepted, 0, '가득 찬 뒤로는 계속 0');
  assert.equal(changes, 0);
  s.db.batch = batch;
  const rows = storyRows(s);
  assert.equal(rows.find((r) => r.kind === 'scene').n, 5);
  assert.equal(rows.find((r) => r.kind === 'total').n, 6, '가득 참은 상한+1로 표시한다');
  s.clock.t += DAY;
  assert.equal((await sendStory(s, ev(1))).body.accepted, 1);
});

test('이야기 집계: 동시에 온 요청도 상한을 넘겨 세지 않는다(확인과 더하기가 한 트랜잭션)', async () => {
  const s = setup({ rules: { ...RULES, storyMaxEventsPerDay: 4 }, latency: true });
  const res = await Promise.all([1, 2, 3, 4, 5].map(() => sendStory(s, [{ kind: 'scene', id: 'dusk' }])));
  assert.equal(res.reduce((sum, r) => sum + r.body.accepted, 0), 4);
  assert.equal(storyRows(s).find((r) => r.kind === 'scene').n, 4);
});

const appRows = (s) => s.db.raw.prepare('SELECT day, kind, id, n, skipped FROM story_app_daily ORDER BY kind, id').all().map((r) => ({ ...r }));

test('이야기 집계: 앱 출처(https://localhost)에서 온 사건은 앱 표에도 세고, 웹 출처는 앱 표에 닿지 않는다(#53)', async () => {
  const s = setup();
  await sendStory(s, [{ kind: 'scene', id: 'arrival' }, { kind: 'scene', id: 'arrival', skipped: true }, { kind: 'clear', id: '1' }], { origin: RULES.storyAppOrigin });
  await sendStory(s, [{ kind: 'scene', id: 'arrival' }, { kind: 'chapter', id: '2' }]);
  await sendStory(s, [{ kind: 'scene', id: 'dusk' }], { origin: 'https://localhost:8443' });
  const r = await s.call('POST', '/v1/story', { body: { events: [{ kind: 'scene', id: 'dusk' }] }, headers: { Origin: '' } });
  assert.equal(r.status, 200, 'Origin이 비어도 웹으로 받는다');
  assert.deepEqual(appRows(s), [
    { day: '2026-11-06', kind: 'clear', id: '1', n: 1, skipped: 0 },
    { day: '2026-11-06', kind: 'scene', id: 'arrival', n: 2, skipped: 1 },
  ], '앱에서 온 것만, 출처가 정확히 같을 때만');
  assert.deepEqual(storyRows(s).map((x) => [x.kind, x.id, x.n]), [
    ['chapter', '2', 1], ['clear', '1', 1], ['scene', 'arrival', 3], ['scene', 'dusk', 2], ['total', '', 7],
  ], '전체 표는 출처와 상관없이 모두 센다');
  assert.deepEqual(s.db.raw.prepare('PRAGMA table_info(story_app_daily)').all().map((c) => c.name), ['day', 'kind', 'id', 'n', 'skipped'], '사람을 가리키는 열이 없다');
});

test('이야기 집계: 하루 상한에 닿은 날에는 앱 표도 더 세지 않는다', async () => {
  const s = setup({ rules: { ...RULES, storyMaxEventsPerDay: 3 } });
  const ev = (n) => Array.from({ length: n }, () => ({ kind: 'scene', id: 'arrival' }));
  const app = { origin: RULES.storyAppOrigin };
  assert.equal((await sendStory(s, ev(2), app)).body.accepted, 2);
  assert.equal((await sendStory(s, ev(2), app)).body.accepted, 0);
  assert.equal(appRows(s)[0].n, 2);
  assert.equal(storyRows(s).find((x) => x.kind === 'scene').n, 2, '전체와 앱이 어긋나지 않는다');
});

test('이야기 집계: 정리 작업은 앱 표도 보존 기간(storyKeepDays)이 지나면 지운다', async () => {
  const s = setup();
  await sendStory(s, [{ kind: 'scene', id: 'arrival' }], { origin: RULES.storyAppOrigin });
  s.clock.t += RULES.storyKeepDays * DAY;
  await s.app.scheduled(s.env);
  assert.equal(appRows(s).length, 1, '보존 기간 마지막 날까지는 남긴다');
  s.clock.t += DAY;
  await s.app.scheduled(s.env);
  assert.deepEqual([appRows(s).length, storyRows(s).length], [0, 0]);
});

test('이야기 집계: 킬 스위치·분당 한도·설정 누락을 따른다', async () => {
  const s = setup();
  s.db.raw.exec("UPDATE settings SET value = 'false' WHERE key = 'enabled'");
  assert.equal((await sendStory(s, [{ kind: 'scene', id: 'a' }])).status, 503);
  assert.equal(storyRows(s).length, 0);
  const keys = [];
  const blocked = setup({ limiter: (key) => { keys.push(key); return false; } });
  const r = await sendStory(blocked, [{ kind: 'scene', id: 'a' }]);
  assert.deepEqual([r.status, r.body.error], [429, 'rate']);
  assert.ok(keys.length === 1 && !keys[0].includes('203.0.113'), '게임과 같은 분당 한도(RL_WRITE, IP 해시 키)');
  assert.equal((await sendStory(setup({ env: { IP_HASH_SECRET: '' } }), [{ kind: 'scene', id: 'a' }])).status, 503);
  assert.equal((await s.call('OPTIONS', '/v1/story')).status, 204);
});

// ---------------------------------------------------------------- 정리 작업 실행 기록 (#17, #30)

const cronRuns = (s) => s.db.raw.prepare('SELECT id, at, ok, ms, deleted, error FROM cron_runs ORDER BY id').all().map((r) => ({ ...r }));

test('정리 작업: 성공하면 시각·지운 행 수를 cron_runs에 남긴다', async () => {
  const s = setup();
  const id = (await s.placeAs(1, FREE[0])).body.cache.id;
  await s.call('POST', `/v1/caches/${id}/use`, { player: pid(2) });
  await s.call('POST', `/v1/caches/${id}/thanks`, { player: pid(2) });
  await s.call('GET', '/v1/me', { player: pid(2) });
  await sendStory(s, [{ kind: 'scene', id: 'arrival' }]);
  await s.app.scheduled(s.env);
  assert.deepEqual(cronRuns(s), [{ id: 1, at: s.clock.t, ok: 1, ms: 0, deleted: 0, error: null }]);

  s.clock.t += RULES.lifetimeMs + RULES.retentionMs + DAY;
  // uses 1 + thanks 1 + seen 1 + caches 1 + rate_daily(place, use) 2. 이야기 집계는 400일 보존이라 아직 남는다
  assert.deepEqual(await s.app.scheduled(s.env), { deleted: 6 });
  assert.equal(cronRuns(s).at(-1).deleted, 6);
  assert.equal(storyRows(s).length, 2);
  s.clock.t += RULES.storyKeepDays * DAY;
  await s.app.scheduled(s.env);
  assert.equal(storyRows(s).length, 0, '400일이 지나면 이야기 집계도 지운다');
  assert.equal(cronRuns(s).at(-1).deleted, 2);
});

test('정리 작업: 실패하면 오류 메시지(200자)를 남기고 다시 던진다. 아무것도 지우지 않는다', async (t) => {
  t.mock.method(console, 'error', () => {});
  const s = setup();
  await s.placeAs(1, FREE[0]);
  const reason = `D1_ERROR: ${'x'.repeat(300)}`;
  const broken = {
    ...s.db,
    batch: async (stmts) => (stmts.some((x) => x.sql.includes('DELETE FROM uses')) ? Promise.reject(new Error(reason)) : s.db.batch(stmts)),
  };
  await assert.rejects(s.app.scheduled({ ...s.env, DB: broken }), { message: reason });
  const [run] = cronRuns(s);
  assert.deepEqual({ ok: run.ok, deleted: run.deleted }, { ok: 0, deleted: null });
  assert.equal(run.error, reason.slice(0, 200));
  assert.equal(s.db.raw.prepare('SELECT count(*) AS n FROM daily_stats').get().n, 0, '한 트랜잭션이라 집계도 남지 않았다');
  assert.equal(s.db.raw.prepare('SELECT count(*) AS n FROM caches').get().n, 1);
});

test('정리 작업: 성공을 기록하지 못하면 실패로 드러낸다', async (t) => {
  t.mock.method(console, 'error', () => {});
  const s = setup();
  const broken = {
    ...s.db,
    batch: async (stmts) => (stmts.some((x) => x.sql.includes('INTO cron_runs')) ? Promise.reject(new Error('cron_runs 없음')) : s.db.batch(stmts)),
  };
  await assert.rejects(s.app.scheduled({ ...s.env, DB: broken }), /cron_runs 없음/);
  assert.equal(console.error.mock.callCount(), 1);
});

test('정리 작업: 실행 기록은 최근 30번만 남긴다', async () => {
  const s = setup();
  for (let i = 0; i < RULES.cronRunsKept + 5; i++) {
    await s.app.scheduled(s.env);
    s.clock.t += HOUR;
  }
  const runs = cronRuns(s);
  assert.equal(runs.length, RULES.cronRunsKept);
  assert.equal(runs[0].id, 6);
  assert.equal(runs.at(-1).id, RULES.cronRunsKept + 5);
});
