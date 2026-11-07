// 공유 보급품 API (v1). 설계: docs/online-caches.md 7~13절, 이야기 진행 집계·판 토큰·rules는 18절.
// 서버는 남의 경험을 바꾸는 상태(남은 횟수·수명·슬롯·고마워요)만 지킨다. 한 판 안의 밸런스는 클라이언트 몫이다.
import { RULES, publicRules } from './rules.js';
import { LAYOUT, SLOT_COUNT, BLOCKED_SLOTS } from './slots.js';

const BLOCKED = new Set(BLOCKED_SLOTS);
const PID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ID_RE = /^c_[a-z2-7]{26}$/;
const STORY_ID_RE = /^[a-z0-9]{1,24}$/;
const RUN_TOKEN_RE = /^(\d{13})\.[0-9a-f]{32}$/;
const TURNSTILE_VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TURNSTILE_MAX = 2048; // Turnstile 토큰 최대 길이(공식 문서)
const CLOCK_SKEW_MS = 60 * 1000;
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
const enc = new TextEncoder();
// 환경 변수 플래그는 문자열 "true"일 때만 켠다(빠지거나 오타면 꺼진 채).
const flag = (v) => v === true || v === 'true';

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const DAY_MS = 24 * 60 * 60 * 1000;

async function sha256(text) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}

// IP는 그날 날짜를 섞은 HMAC으로만 다룬다. 날짜가 바뀌면 같은 IP라도 다른 키가 된다.
const ipKey = async (secret, day, ip) => (await hmacHex(secret, `${day}|${ip}`)).slice(0, 32);

// 판 토큰: 목록을 준 시각과 그 서명. 2단계 남용 대응(설계 10절)에서 두기를 이 시각 3분 뒤부터만 받는다.
// 접두사 'run|'로 IP 키(날짜|IP)와 서명 대상이 겹치지 않게 한다.
const runToken = async (secret, issuedAt) => `${issuedAt}.${(await hmacHex(secret, `run|${issuedAt}`)).slice(0, 32)}`;

// 길이가 같은 두 문자열을 끝까지 비교한다(첫 차이에서 멈추지 않는다).
function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(17));
  let bits = 0;
  let acc = 0;
  let out = '';
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5 && out.length < 26) {
      out += B32[(acc >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return `c_${out}`;
}

function corsHeaders(origin, allowed) {
  const list = (allowed ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const h = { Vary: 'Origin' };
  if (origin && list.includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'GET, POST, DELETE, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'Content-Type, X-Lumen-Player';
    h['Access-Control-Max-Age'] = '600';
  }
  return h;
}

function json(status, body, headers) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function readJson(request, max) {
  const len = Number(request.headers.get('Content-Length') ?? 0);
  if (len > max) throw new HttpError(413, 'too_large');
  const text = await request.text();
  if (enc.encode(text).length > max) throw new HttpError(413, 'too_large');
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
    return v;
  } catch {
    throw new HttpError(400, 'bad_json');
  }
}

const publicCache = (r) => ({
  id: r.id, slot: r.slot, kind: r.kind, note: r.note, charges: r.charges, thanks: r.thanks, expiresAt: r.expires_at,
});

// verify: Turnstile 확인 요청에 쓰는 fetch(테스트에서 바꿔 끼운다).
export function createApp({ now = () => Date.now(), rules = RULES, verify = (url, init) => fetch(url, init) } = {}) {
  let listMemo = { at: -Infinity, body: null };
  let warned = false;
  let warnedRl = false;
  let warnedHuman = false;
  const shared = publicRules(rules);

  function configured(env) {
    const ok = env.DB && env.IP_HASH_SECRET;
    if (!ok && !warned) {
      warned = true;
      console.error('[caches] 설정 누락: DB 바인딩과 IP_HASH_SECRET이 있어야 합니다. 모든 요청에 503을 돌려줍니다.');
    }
    if (ok && !(env.RL_READ && env.RL_WRITE) && !warnedRl) {
      warnedRl = true;
      console.warn('[caches] 분당 레이트 리밋 바인딩(RL_READ, RL_WRITE)이 없어 분당 한도 없이 동작합니다. 하루 한도(D1)는 그대로 적용됩니다.');
    }
    return ok;
  }

  async function enabled(db) {
    const row = await db.prepare("SELECT value FROM settings WHERE key = 'enabled'").first();
    return row?.value !== 'false';
  }

  // 분당 한도는 선택이다(server/README.md 참고: 무료 플랜에서 쓸 수 없으면 wrangler.toml에서 빼고 배포한다).
  async function limit(binding, key) {
    if (!binding) return;
    const { success } = await binding.limit({ key });
    if (!success) throw new HttpError(429, 'rate');
  }

  // 하루 한도 카운터: 쓰기와 같은 batch(트랜잭션) 안에서 확인하고 소모한다. 따로 읽고 나중에 올리면
  // 한도 직전에 동시에 온 요청들이 같은 낮은 값을 읽고 모두 통과한다.
  const usedToday = (dayParam, keyParam, action) =>
    `coalesce((SELECT count FROM rate_daily WHERE day = ${dayParam} AND key = ${keyParam} AND action = '${action}'), 0)`;

  // 바로 앞 문장이 행을 바꿨을 때만(changes() = 1) 카운터를 1 올린다.
  function bumpIfChanged(db, day, key, action) {
    return db.prepare(
      `INSERT INTO rate_daily (day, key, action, count) SELECT ?1, ?2, '${action}', 1 WHERE changes() = 1
       ON CONFLICT (day, key, action) DO UPDATE SET count = count + 1`,
    ).bind(day, key);
  }

  async function player(request) {
    const pid = request.headers.get('X-Lumen-Player') ?? '';
    if (!PID_RE.test(pid)) throw new HttpError(400, 'bad_player');
    return sha256(`lumen:${pid}`);
  }

  // ---------------------------------------------------------------- 목록

  // 응답마다 붙이는 것: 지금 시각, 규칙 수치(클라이언트 안내 문구용), 판 토큰(2단계 대응을 켰을 때 두기에 필요).
  // 판 토큰은 강제 여부와 상관없이 늘 준다. 켜는 순간 이미 판을 시작한 클라이언트도 토큰을 갖고 있게 하기 위해서다.
  async function list(env, url, t) {
    const layout = Number(url.searchParams.get('layout'));
    if (layout !== LAYOUT) return { enabled: true, now: t, caches: [], rules: shared }; // 다른 배치 버전에는 보급품이 없다
    const stamp = async (body) => ({ ...body, now: t, rules: shared, runToken: await runToken(env.IP_HASH_SECRET, t) });
    if (t - listMemo.at < rules.listMemoMs && listMemo.body) return stamp(listMemo.body);
    const db = env.DB;
    if (!(await enabled(db))) return { enabled: false, now: t, caches: [], rules: shared };
    const { results } = await db.prepare(
      `SELECT id, slot, kind, note, charges, thanks, expires_at FROM caches
       WHERE layout = ?1 AND removed_at IS NULL AND expires_at > ?2 AND charges > 0
       ORDER BY created_at DESC LIMIT ?3`,
    ).bind(LAYOUT, t, rules.maxActiveTotal).all();
    const body = { enabled: true, caches: results.map(publicCache) };
    listMemo = { at: t, body };
    return stamp(body);
  }

  // ---------------------------------------------------------------- 2단계 남용 대응 (기본 꺼짐)

  async function checkRunToken(env, value, t) {
    const m = typeof value === 'string' ? RUN_TOKEN_RE.exec(value) : null;
    if (!m) throw new HttpError(403, 'run_token');
    const issuedAt = Number(m[1]);
    if (!sameText(value, await runToken(env.IP_HASH_SECRET, issuedAt))) throw new HttpError(403, 'run_token');
    if (issuedAt > t + CLOCK_SKEW_MS || t - issuedAt > rules.runTokenMaxAgeMs) throw new HttpError(403, 'run_token');
    if (t - issuedAt < rules.runTokenMinAgeMs) throw new HttpError(403, 'too_early');
  }

  // Cloudflare Turnstile 서버 확인. 원문 IP(remoteip)는 보내지 않는다.
  async function checkHuman(env, value) {
    if (!env.TURNSTILE_SECRET) {
      if (!warnedHuman) {
        warnedHuman = true;
        console.error('[caches] HUMAN_CHECK_REQUIRED가 켜졌지만 TURNSTILE_SECRET이 없습니다. 두기 요청에 503을 돌려줍니다.');
      }
      throw new HttpError(503, 'misconfigured');
    }
    if (typeof value !== 'string' || value.length === 0 || value.length > TURNSTILE_MAX) throw new HttpError(403, 'human_check');
    let result;
    try {
      const res = await verify(TURNSTILE_VERIFY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: value }),
      });
      result = await res.json();
    } catch (err) {
      console.error('[caches] Turnstile 확인 요청 실패', err);
      throw new HttpError(503, 'human_check_unavailable');
    }
    if (result?.success !== true) throw new HttpError(403, 'human_check');
  }

  // ---------------------------------------------------------------- 두기

  async function place(env, request, t, user, ip) {
    const human = flag(env.HUMAN_CHECK_REQUIRED);
    // 사람 확인을 켜면 본문에 Turnstile 토큰(최대 2048자)이 더 들어온다.
    const b = await readJson(request, rules.maxBodyBytes + (human ? TURNSTILE_MAX : 0));
    const { layout, slot, kind, note } = b;
    if (layout !== LAYOUT) throw new HttpError(400, 'bad_layout');
    if (!Number.isInteger(slot) || slot < 0 || slot >= SLOT_COUNT || BLOCKED.has(slot)) throw new HttpError(400, 'bad_slot');
    if (!rules.kinds.includes(kind)) throw new HttpError(400, 'bad_kind');
    if (!Number.isInteger(note) || note < 0 || note >= rules.noteCount) throw new HttpError(400, 'bad_note');
    // 2단계 대응은 D1을 건드리기 전에 확인한다(거절된 요청이 한도·쓰기를 쓰지 않게).
    if (flag(env.RUN_TOKEN_REQUIRED)) await checkRunToken(env, b.runToken, t);
    if (human) await checkHuman(env, b.humanToken);
    const db = env.DB;
    const day = utcDay(t);
    const id = newId();
    const expires = t + rules.lifetimeMs;
    const [, , , check] = await db.batch([
      // 같은 슬롯의 만료된 보급품을 먼저 정리해 자리를 비운다.
      db.prepare(
        "UPDATE caches SET removed_at = expires_at, removed_by = 'expired' WHERE layout = ?1 AND slot = ?2 AND removed_at IS NULL AND expires_at <= ?3",
      ).bind(LAYOUT, slot, t),
      db.prepare(
        `INSERT INTO caches (id, layout, slot, kind, note, owner, charges, thanks, created_at, expires_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?9
         WHERE NOT EXISTS (SELECT 1 FROM caches WHERE layout = ?2 AND slot = ?3 AND removed_at IS NULL)
           AND (SELECT count(*) FROM caches WHERE owner = ?6 AND removed_at IS NULL AND expires_at > ?8) < ?10
           AND (SELECT count(*) FROM caches WHERE layout = ?2 AND removed_at IS NULL AND expires_at > ?8) < ?11
           AND ${usedToday('?12', '?13', 'place')} < ?14`,
      ).bind(id, LAYOUT, slot, kind, note, user, rules.charges, t, expires, rules.maxActivePerPlayer, rules.maxActiveTotal,
        day, ip, rules.maxPlacesPerIpPerDay),
      bumpIfChanged(db, day, ip, 'place'),
      db.prepare(
        `SELECT (SELECT count(*) FROM caches WHERE id = ?1) AS ok,
                (SELECT count(*) FROM caches WHERE layout = ?2 AND slot = ?3 AND removed_at IS NULL) AS slot_live,
                (SELECT count(*) FROM caches WHERE owner = ?4 AND removed_at IS NULL AND expires_at > ?5) AS mine,
                ${usedToday('?6', '?7', 'place')} AS today`,
      ).bind(id, LAYOUT, slot, user, t, day, ip),
    ]);
    const c = check.results[0];
    if (!c.ok) {
      if (c.today >= rules.maxPlacesPerIpPerDay) throw new HttpError(429, 'ip_daily');
      if (c.slot_live) throw new HttpError(409, 'slot_taken');
      if (c.mine >= rules.maxActivePerPlayer) throw new HttpError(429, 'player_limit');
      throw new HttpError(429, 'town_full');
    }
    listMemo.at = -Infinity;
    return { cache: { id, slot, kind, note, charges: rules.charges, thanks: 0, expiresAt: expires } };
  }

  // ---------------------------------------------------------------- 쓰기

  async function use(env, id, t, user, ip) {
    const db = env.DB;
    const day = utcDay(t);
    const since = t - rules.reuseCooldownMs;
    const [, , , check] = await db.batch([
      db.prepare(
        `INSERT INTO uses (cache_id, user_hash, used_at)
         SELECT id, ?2, ?3 FROM caches
         WHERE id = ?1 AND removed_at IS NULL AND expires_at > ?3 AND charges > 0 AND owner <> ?2
           AND NOT EXISTS (SELECT 1 FROM uses WHERE cache_id = ?1 AND user_hash = ?2 AND used_at > ?4)
           AND ${usedToday('?5', '?6', 'use')} < ?7`,
      ).bind(id, user, t, since, day, ip, rules.maxUsesPerIpPerDay),
      // batch는 한 연결에서 차례로 도는 트랜잭션이라 changes()는 바로 앞 문장이 바꾼 행 수다.
      // 같은 밀리초의 중복 요청이 앞 기록을 자기 것으로 착각하지 않도록, 시각 비교 대신 이것으로 판정한다.
      // SET 식의 charges는 갱신 전 값이다. 마지막 1회를 쓰면 소진으로 내려 슬롯을 비운다.
      db.prepare(
        `UPDATE caches SET charges = charges - 1,
           removed_at = CASE WHEN charges <= 1 THEN ?2 ELSE removed_at END,
           removed_by = CASE WHEN charges <= 1 THEN 'exhausted' ELSE removed_by END
         WHERE id = ?1 AND changes() = 1`,
      ).bind(id, t),
      bumpIfChanged(db, day, ip, 'use'),
      // 여기서 changes()는 카운터 문장의 결과다. 사용이 반영됐을 때만 1이다.
      db.prepare(
        `SELECT kind, charges, owner, removed_at, expires_at, changes() AS ok,
                (SELECT count(*) FROM uses WHERE cache_id = ?1 AND user_hash = ?2 AND used_at > ?3) AS recent,
                ${usedToday('?4', '?5', 'use')} AS today
         FROM caches WHERE id = ?1`,
      ).bind(id, user, since, day, ip),
    ]);
    const c = check.results[0];
    if (!c) throw new HttpError(404, 'not_found');
    if (!c.ok) {
      if (c.today >= rules.maxUsesPerIpPerDay) throw new HttpError(429, 'ip_daily');
      const alive = c.removed_at === null && c.expires_at > t && c.charges > 0;
      if (!alive) throw new HttpError(410, 'gone');
      if (c.owner === user) throw new HttpError(403, 'own_cache');
      if (c.recent) throw new HttpError(409, 'used_today');
      throw new HttpError(410, 'gone');
    }
    listMemo.at = -Infinity;
    return { kind: c.kind, charges: c.charges };
  }

  // ---------------------------------------------------------------- 고마워요

  async function thank(env, id, t, user) {
    const db = env.DB;
    const [, , check] = await db.batch([
      // 소진된 상자도 수명이 남아 있으면 마지막으로 쓴 사람이 고마워요를 보낼 수 있다.
      db.prepare(
        `INSERT INTO thanks (cache_id, user_hash, at)
         SELECT id, ?2, ?3 FROM caches
         WHERE id = ?1 AND (removed_at IS NULL OR removed_by = 'exhausted') AND expires_at > ?3
           AND EXISTS (SELECT 1 FROM uses WHERE cache_id = ?1 AND user_hash = ?2)
           AND NOT EXISTS (SELECT 1 FROM thanks WHERE cache_id = ?1 AND user_hash = ?2)`,
      ).bind(id, user, t),
      db.prepare(
        `UPDATE caches SET thanks = thanks + 1, expires_at = MIN(expires_at + ?2, created_at + ?3)
         WHERE id = ?1 AND changes() = 1`,
      ).bind(id, rules.thanksExtendMs, rules.maxLifetimeMs),
      db.prepare(
        `SELECT thanks, expires_at, removed_at, removed_by, changes() AS ok,
                (SELECT count(*) FROM thanks WHERE cache_id = ?1 AND user_hash = ?2) AS before,
                (SELECT count(*) FROM uses WHERE cache_id = ?1 AND user_hash = ?2) AS used
         FROM caches WHERE id = ?1`,
      ).bind(id, user),
    ]);
    const c = check.results[0];
    if (!c) throw new HttpError(404, 'not_found');
    if (!c.ok) {
      if (c.before) throw new HttpError(409, 'already_thanked');
      const alive = (c.removed_at === null || c.removed_by === 'exhausted') && c.expires_at > t;
      if (!alive) throw new HttpError(410, 'gone');
      if (!c.used) throw new HttpError(403, 'not_used');
      throw new HttpError(409, 'already_thanked');
    }
    listMemo.at = -Infinity;
    return { thanks: c.thanks, expiresAt: c.expires_at };
  }

  // ---------------------------------------------------------------- 내 기록

  async function me(env, t, user) {
    const db = env.DB;
    const [, mine, used] = await db.batch([
      db.prepare('INSERT OR IGNORE INTO seen (day, user_hash) VALUES (?1, ?2)').bind(utcDay(t), user),
      db.prepare(
        `SELECT count(*) AS placed,
                coalesce(sum(CASE WHEN removed_at IS NULL AND expires_at > ?2 THEN 1 ELSE 0 END), 0) AS active,
                coalesce(sum(thanks), 0) AS thanks
         FROM caches WHERE owner = ?1`,
      ).bind(user, t),
      db.prepare(
        `SELECT count(*) AS uses, count(DISTINCT u.user_hash) AS users
         FROM uses u JOIN caches c ON c.id = u.cache_id WHERE c.owner = ?1`,
      ).bind(user),
    ]);
    const m = mine.results[0];
    const u = used.results[0];
    return { active: m.active, placed: m.placed, uses: u.uses, users: u.users, thanks: m.thanks };
  }

  // 내 사용·고마워요·접속 기록을 지우고, 내 보급품은 내리고 나와의 연결을 끊는다.
  // 남이 내 보급품을 쓴 기록은 그 사람의 기록이라 남기고, 부모 행은 정리 작업이 보존 기간 뒤에 지운다.
  async function forget(env, t, user) {
    const db = env.DB;
    await db.batch([
      db.prepare('DELETE FROM uses WHERE user_hash = ?1').bind(user),
      db.prepare('DELETE FROM thanks WHERE user_hash = ?1').bind(user),
      db.prepare('DELETE FROM seen WHERE user_hash = ?1').bind(user),
      db.prepare(
        "UPDATE caches SET removed_at = coalesce(removed_at, ?2), removed_by = coalesce(removed_by, 'owner'), owner = 'deleted' WHERE owner = ?1",
      ).bind(user, t),
    ]);
    listMemo.at = -Infinity;
  }

  // ---------------------------------------------------------------- 이야기 진행 집계

  // 누가 보냈는지는 남기지 않는다(플레이어 ID·IP 없음). UTC 날짜·종류·id마다 횟수와 건너뛴 횟수만 더한다.
  // 하루 전체 상한(storyMaxEventsPerDay)을 넘으면 그날은 더 세지 않는다. 남용이 게임의 D1 쓰기 한도를 다 쓰지 못하게 하기 위해서다.
  // 상한 확인과 더하기는 한 batch(트랜잭션)에서 한다: ① 그날 받은 사건 수(kind='total' 행)를 올리되, 넘치면 '가득 참'(상한+1)으로 둔다
  // → ② 가득 차지 않았을 때만 id별 행을 더한다. 이미 가득 찬 날의 요청은 ①도 행을 바꾸지 않아 D1에 쓰지 않는다.
  async function story(env, request, t) {
    const b = await readJson(request, rules.storyMaxBodyBytes);
    const events = b.events;
    if (!Array.isArray(events) || events.length === 0 || events.length > rules.storyMaxEvents) throw new HttpError(400, 'bad_events');
    const counts = new Map();
    for (const e of events) {
      const ok = e && typeof e === 'object' && rules.storyKinds.includes(e.kind) && typeof e.id === 'string' && STORY_ID_RE.test(e.id);
      const skipped = e?.skipped ?? false;
      // 건너뛰기는 장면에만 있다.
      if (!ok || typeof skipped !== 'boolean' || (skipped && e.kind !== 'scene')) throw new HttpError(400, 'bad_event');
      const key = `${e.kind}|${e.id}`;
      const c = counts.get(key) ?? { kind: e.kind, id: e.id, n: 0, skipped: 0 };
      c.n += 1;
      if (skipped) c.skipped += 1;
      counts.set(key, c);
    }
    const db = env.DB;
    const day = utcDay(t);
    const cap = rules.storyMaxEventsPerDay;
    const res = await db.batch([
      db.prepare(
        `INSERT INTO story_daily (day, kind, id, n, skipped) VALUES (?1, 'total', '', ?2, 0)
         ON CONFLICT (day, kind, id) DO UPDATE SET n = CASE WHEN n + excluded.n <= ?3 THEN n + excluded.n ELSE ?3 + 1 END
         WHERE n <= ?3`,
      ).bind(day, events.length, cap),
      ...[...counts.values()].map((c) => db.prepare(
        `INSERT INTO story_daily (day, kind, id, n, skipped)
         SELECT ?1, ?2, ?3, ?4, ?5 WHERE (SELECT n FROM story_daily WHERE day = ?1 AND kind = 'total' AND id = '') <= ?6
         ON CONFLICT (day, kind, id) DO UPDATE SET n = n + excluded.n, skipped = skipped + excluded.skipped`,
      ).bind(day, c.kind, c.id, c.n, c.skipped, cap)),
      db.prepare("SELECT n FROM story_daily WHERE day = ?1 AND kind = 'total' AND id = ''").bind(day),
    ]);
    const total = res.at(-1).results[0]?.n ?? 0;
    return { accepted: total <= cap ? events.length : 0 };
  }

  // ---------------------------------------------------------------- 정리 작업 (하루 한 번)

  // 실행 결과를 cron_runs에 남긴다(최근 cronRunsKept번만). 대시보드가 마지막 성공·실패를 보여 준다.
  // 성공을 남기지 못하면 예외를 던져 Cloudflare의 Cron 실행 기록에도 실패로 드러나게 한다.
  async function recordRun(db, at, ok, deleted, err) {
    const message = err ? String(err?.message ?? err).slice(0, 200) : null;
    try {
      await db.batch([
        db.prepare('INSERT INTO cron_runs (at, ok, ms, deleted, error) VALUES (?1, ?2, ?3, ?4, ?5)')
          .bind(at, ok ? 1 : 0, Math.max(0, now() - at), deleted, message),
        db.prepare('DELETE FROM cron_runs WHERE id <= (SELECT id FROM cron_runs ORDER BY id DESC LIMIT 1 OFFSET ?1)').bind(rules.cronRunsKept),
      ]);
    } catch (e) {
      console.error('[caches] 정리 작업 결과를 기록하지 못했습니다', e);
      if (ok) throw e;
    }
  }

  // 순서: ① 만료 표시 → ② 지난 며칠 집계 → ③ 오래된 사용·고마워요·접속 기록 삭제 → ④ 자식 기록이 없는 오래된 보급품 삭제
  // → ⑤ 한도 카운터·오래된 이야기 집계 삭제. 모두 한 batch(트랜잭션)라 중간에 실패하면 아무것도 바뀌지 않는다.
  async function cleanup(env) {
    if (!env.DB) throw new Error('DB 바인딩이 없습니다.');
    const db = env.DB;
    const t = now();
    const cutoff = t - rules.retentionMs;
    const today = Date.parse(utcDay(t));
    const stmts = [
      db.prepare("UPDATE caches SET removed_at = expires_at, removed_by = 'expired' WHERE removed_at IS NULL AND expires_at <= ?1").bind(t),
    ];
    for (let k = 1; k <= rules.aggregateDays; k++) {
      const s = today - k * DAY_MS;
      const e = s + DAY_MS;
      // D1은 UNION으로 잇는 항목 수를 작게 제한하므로, 그 제한을 받지 않는 여러 행 VALUES로 쓴다.
      stmts.push(db.prepare(
        `INSERT OR REPLACE INTO daily_stats (day, metric, value) VALUES
         (?1, 'places', (SELECT count(*) FROM caches WHERE created_at >= ?2 AND created_at < ?3)),
         (?1, 'placers', (SELECT count(DISTINCT owner) FROM caches WHERE created_at >= ?2 AND created_at < ?3)),
         (?1, 'uses', (SELECT count(*) FROM uses WHERE used_at >= ?2 AND used_at < ?3)),
         (?1, 'users', (SELECT count(DISTINCT user_hash) FROM uses WHERE used_at >= ?2 AND used_at < ?3)),
         (?1, 'thanks', (SELECT count(*) FROM thanks WHERE at >= ?2 AND at < ?3)),
         (?1, 'seen', (SELECT count(*) FROM seen WHERE day = ?1))`,
      ).bind(utcDay(s), s, e));
    }
    const deletes = [
      db.prepare('DELETE FROM uses WHERE used_at < ?1').bind(cutoff),
      db.prepare('DELETE FROM thanks WHERE at < ?1').bind(cutoff),
      db.prepare('DELETE FROM seen WHERE day < ?1').bind(utcDay(cutoff)),
      db.prepare(
        `DELETE FROM caches WHERE removed_at IS NOT NULL AND removed_at < ?1
           AND NOT EXISTS (SELECT 1 FROM uses WHERE cache_id = caches.id)
           AND NOT EXISTS (SELECT 1 FROM thanks WHERE cache_id = caches.id)`,
      ).bind(cutoff),
      db.prepare('DELETE FROM rate_daily WHERE day < ?1').bind(utcDay(t - rules.rateKeepDays * DAY_MS)),
      db.prepare('DELETE FROM story_daily WHERE day < ?1').bind(utcDay(t - rules.storyKeepDays * DAY_MS)),
    ];
    let deleted;
    try {
      const res = await db.batch([...stmts, ...deletes]);
      deleted = res.slice(-deletes.length).reduce((sum, r) => sum + (r.meta?.changes ?? 0), 0);
    } catch (err) {
      await recordRun(db, t, false, null, err);
      throw err;
    }
    await recordRun(db, t, true, deleted, null);
    return { deleted };
  }

  // ---------------------------------------------------------------- 라우팅

  async function fetch(request, env) {
    const cors = corsHeaders(request.headers.get('Origin'), env.ALLOWED_ORIGINS);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    try {
      if (!configured(env)) throw new HttpError(503, 'misconfigured');
      const url = new URL(request.url);
      const t = now();
      const ip = await ipKey(env.IP_HASH_SECRET, utcDay(t), request.headers.get('CF-Connecting-IP') ?? 'unknown');
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] !== 'v1') throw new HttpError(404, 'not_found');
      const route = parts.slice(1);
      const m = request.method;

      if (route[0] === 'caches' && route.length === 1 && m === 'GET') {
        await limit(env.RL_READ, ip);
        return json(200, await list(env, url, t), cors);
      }
      if (m === 'GET' || m === 'POST' || m === 'DELETE') await limit(m === 'GET' ? env.RL_READ : env.RL_WRITE, ip);

      // 본인 기록 삭제는 킬 스위치가 내려가 있어도 받는다.
      if (route[0] === 'me' && route.length === 1 && m === 'DELETE') {
        await forget(env, t, await player(request));
        return json(204, null, cors);
      }
      if (!(await enabled(env.DB))) throw new HttpError(503, 'disabled');

      if (route[0] === 'caches' && route.length === 1 && m === 'POST') {
        return json(201, await place(env, request, t, await player(request), ip), cors);
      }
      if (route[0] === 'caches' && route.length === 3 && m === 'POST' && (route[2] === 'use' || route[2] === 'thanks')) {
        if (!ID_RE.test(route[1])) throw new HttpError(404, 'not_found');
        const user = await player(request);
        if (route[2] === 'use') return json(200, await use(env, route[1], t, user, ip), cors);
        return json(200, await thank(env, route[1], t, user), cors);
      }
      if (route[0] === 'me' && route.length === 1 && m === 'GET') {
        return json(200, await me(env, t, await player(request)), cors);
      }
      if (route[0] === 'story' && route.length === 1 && m === 'POST') {
        return json(200, await story(env, request, t), cors);
      }
      throw new HttpError(404, 'not_found');
    } catch (err) {
      if (err instanceof HttpError) return json(err.status, { error: err.code }, cors);
      console.error('[caches] 처리하지 못한 오류', err);
      return json(500, { error: 'internal' }, cors);
    }
  }

  return { fetch, scheduled: cleanup };
}
