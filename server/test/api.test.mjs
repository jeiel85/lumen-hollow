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

function setup({ rules = RULES, limiter = () => true, env: extra = {}, latency = false } = {}) {
  const clock = { t: Date.UTC(2026, 10, 6, 12) };
  const db = createD1({ latency });
  const app = createApp({ now: () => clock.t, rules });
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
