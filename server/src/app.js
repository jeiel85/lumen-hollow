// 공유 보급품 API (v1). 설계: docs/online-caches.md 7~13절.
// 서버는 남의 경험을 바꾸는 상태(남은 횟수·수명·슬롯·고마워요)만 지킨다. 한 판 안의 밸런스는 클라이언트 몫이다.
import { RULES } from './rules.js';
import { LAYOUT, SLOT_COUNT, BLOCKED_SLOTS } from './slots.js';

const BLOCKED = new Set(BLOCKED_SLOTS);
const PID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ID_RE = /^c_[a-z2-7]{26}$/;
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';
const enc = new TextEncoder();

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

// IP는 그날 날짜를 섞은 HMAC으로만 다룬다. 날짜가 바뀌면 같은 IP라도 다른 키가 된다.
async function ipKey(secret, day, ip) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(`${day}|${ip}`))).slice(0, 32);
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

export function createApp({ now = () => Date.now(), rules = RULES } = {}) {
  let listMemo = { at: -Infinity, body: null };
  let warned = false;
  let warnedRl = false;

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

  async function list(env, url, t) {
    const layout = Number(url.searchParams.get('layout'));
    if (layout !== LAYOUT) return { enabled: true, now: t, caches: [] }; // 다른 배치 버전에는 보급품이 없다
    if (t - listMemo.at < rules.listMemoMs && listMemo.body) return { ...listMemo.body, now: t };
    const db = env.DB;
    if (!(await enabled(db))) return { enabled: false, now: t, caches: [] };
    const { results } = await db.prepare(
      `SELECT id, slot, kind, note, charges, thanks, expires_at FROM caches
       WHERE layout = ?1 AND removed_at IS NULL AND expires_at > ?2 AND charges > 0
       ORDER BY created_at DESC LIMIT ?3`,
    ).bind(LAYOUT, t, rules.maxActiveTotal).all();
    const body = { enabled: true, caches: results.map(publicCache) };
    listMemo = { at: t, body };
    return { ...body, now: t };
  }

  // ---------------------------------------------------------------- 두기

  async function place(env, request, t, user, ip) {
    const b = await readJson(request, rules.maxBodyBytes);
    const { layout, slot, kind, note } = b;
    if (layout !== LAYOUT) throw new HttpError(400, 'bad_layout');
    if (!Number.isInteger(slot) || slot < 0 || slot >= SLOT_COUNT || BLOCKED.has(slot)) throw new HttpError(400, 'bad_slot');
    if (!rules.kinds.includes(kind)) throw new HttpError(400, 'bad_kind');
    if (!Number.isInteger(note) || note < 0 || note >= rules.noteCount) throw new HttpError(400, 'bad_note');
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

  // ---------------------------------------------------------------- 정리 작업 (하루 한 번)

  // 순서: ① 만료 표시 → ② 지난 며칠 집계 → ③ 오래된 사용·고마워요·접속 기록 삭제 → ④ 자식 기록이 없는 오래된 보급품 삭제 → ⑤ 한도 카운터 삭제
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
    stmts.push(
      db.prepare('DELETE FROM uses WHERE used_at < ?1').bind(cutoff),
      db.prepare('DELETE FROM thanks WHERE at < ?1').bind(cutoff),
      db.prepare('DELETE FROM seen WHERE day < ?1').bind(utcDay(cutoff)),
      db.prepare(
        `DELETE FROM caches WHERE removed_at IS NOT NULL AND removed_at < ?1
           AND NOT EXISTS (SELECT 1 FROM uses WHERE cache_id = caches.id)
           AND NOT EXISTS (SELECT 1 FROM thanks WHERE cache_id = caches.id)`,
      ).bind(cutoff),
      db.prepare('DELETE FROM rate_daily WHERE day < ?1').bind(utcDay(t - rules.rateKeepDays * DAY_MS)),
    );
    await db.batch(stmts);
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
      throw new HttpError(404, 'not_found');
    } catch (err) {
      if (err instanceof HttpError) return json(err.status, { error: err.code }, cors);
      console.error('[caches] 처리하지 못한 오류', err);
      return json(500, { error: 'internal' }, cors);
    }
  }

  return { fetch, scheduled: cleanup };
}
