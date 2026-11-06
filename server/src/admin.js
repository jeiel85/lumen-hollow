// 운영 대시보드 API(읽기 전용). 결정: DECISIONS.md D-003. 지표 정의: docs/online-caches.md 14절.
// 같은 Worker가 정적 자산(server/dashboard/)으로 페이지를 내고, 자산에 없는 경로만 여기로 온다.
// 게임 Worker(src/index.js)와 같은 D1을 읽기만 한다. 쓰기(킬 스위치·일괄 정리)는 admin.sql로 한다.
import { RULES } from './rules.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_TOKEN_LENGTH = 32;
const DAILY_MAX_DAYS = 30;
const RANGES = Object.freeze({ '1d': DAY_MS, '7d': 7 * DAY_MS, launch: null });
const enc = new TextEncoder();
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);

// docs/online-caches.md 14.2절의 판단 기준(출시 후 14일). 문서의 수치를 바꾸면 여기도 맞춘다.
export const DECISION = Object.freeze({
  days: 14,
  continueTakers: 20, // 계속: 남의 것을 쓴 플레이어가 이만큼 이상이고
  continueUsedPct: 40, //       쓰인 보급품 비율이 이만큼 이상
  reviewUsedPct: 20, // 재검토: 쓰인 보급품 비율이 이보다 낮음
  stopPlacers: 5, // 중단: 둔 플레이어가 이보다 적음
});

class HttpError extends Error {
  constructor(status, code, headers = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...headers,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

// 양쪽을 SHA-256으로 같은 길이로 만든 뒤 끝까지 비교한다. 첫 차이에서 멈추지 않아 걸리는 시간으로 값을 짐작할 수 없다.
async function sameSecret(a, b) {
  const [x, y] = await Promise.all([a, b].map(async (s) => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))));
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

const pct = (n, d) => (d > 0 ? Math.round((1000 * n) / d) / 10 : null);

// 14.2절 판단. 기준 사이에 걸치면('between') 문서가 정한 답이 없으니 사람이 정한다.
export function verdict(m) {
  if (m.placers < DECISION.stopPlacers) return 'stop';
  if (m.takers >= DECISION.continueTakers && m.usedPct >= DECISION.continueUsedPct) return 'continue';
  if (m.usedPct !== null && m.usedPct < DECISION.reviewUsedPct) return 'review';
  return 'between';
}

// 기간 [from, to)의 14.1절 지표. 접속 기록(seen)은 UTC 날짜 단위라 기간 경계가 날짜로 넓어진다.
function metricsStmt(db, from, to) {
  return db.prepare(
    `SELECT
       (SELECT count(DISTINCT user_hash) FROM seen WHERE day >= ?3 AND day <= ?4) AS players,
       (SELECT count(*) FROM caches WHERE created_at >= ?1 AND created_at < ?2) AS places,
       (SELECT count(DISTINCT owner) FROM caches WHERE created_at >= ?1 AND created_at < ?2 AND owner <> 'deleted') AS placers,
       (SELECT count(*) FROM uses WHERE used_at >= ?1 AND used_at < ?2) AS uses,
       (SELECT count(DISTINCT u.user_hash) FROM uses u JOIN caches c ON c.id = u.cache_id
          WHERE u.used_at >= ?1 AND u.used_at < ?2 AND u.user_hash <> c.owner) AS takers,
       (SELECT count(DISTINCT u.cache_id) FROM uses u JOIN caches c ON c.id = u.cache_id
          WHERE c.created_at >= ?1 AND c.created_at < ?2 AND u.used_at < ?2 AND u.user_hash <> c.owner) AS used_caches,
       (SELECT count(*) FROM thanks WHERE at >= ?1 AND at < ?2) AS thanks,
       (SELECT count(*) FROM (
          SELECT owner FROM caches WHERE created_at >= ?1 AND created_at < ?2 AND owner <> 'deleted'
          GROUP BY owner HAVING count(DISTINCT date(created_at / 1000, 'unixepoch')) >= 2)) AS returning_placers`,
  ).bind(from, to, utcDay(from), utcDay(Math.max(from, to - 1)));
}

function shapeMetrics(r) {
  return {
    players: r.players,
    places: r.places,
    placers: r.placers,
    uses: r.uses,
    takers: r.takers,
    usedCaches: r.used_caches,
    usedPct: pct(r.used_caches, r.places),
    thanks: r.thanks,
    thanksPct: pct(r.thanks, r.uses),
    returningPlacers: r.returning_placers,
  };
}

export function createAdmin({ now = () => Date.now(), rules = RULES } = {}) {
  let warned = false;

  function launchTime(env) {
    const t = Date.parse(env.LAUNCH_AT ?? '');
    if (env.DB && Number.isFinite(t)) return t;
    if (!warned) {
      warned = true;
      console.error('[admin] 설정 누락: DB 바인딩과 LAUNCH_AT(ISO 시각)이 있어야 합니다. 모든 요청에 503을 돌려줍니다.');
    }
    throw new HttpError(503, 'misconfigured');
  }

  async function authorize(request, token) {
    if (typeof token !== 'string' || token.length < MIN_TOKEN_LENGTH) throw new HttpError(503, 'admin_not_configured');
    const m = /^Bearer ([^\s]+)$/.exec(request.headers.get('Authorization') ?? '');
    if (!m || !(await sameSecret(m[1], token))) throw new HttpError(401, 'unauthorized', { 'WWW-Authenticate': 'Bearer' });
  }

  async function summary(db, url, t, launchAt) {
    const range = url.searchParams.get('range') ?? 'launch';
    if (!Object.hasOwn(RANGES, range)) throw new HttpError(400, 'bad_range');
    const periodFrom = RANGES[range] === null ? launchAt : t - RANGES[range];
    const untilNow = t + 1; // 기간은 [from, to)라서 지금 이 순간에 생긴 기록까지 넣으려면 1ms 뒤까지 센다
    const decisionEnd = launchAt + DECISION.days * DAY_MS;
    const decisionTo = Math.max(launchAt, Math.min(untilNow, decisionEnd));
    const today = Date.parse(utcDay(t));
    // 일별 추이도 고른 기간을 따른다(기간 시작 날부터 오늘까지, 최대 30일).
    const dailyFrom = Math.max(Date.parse(utcDay(periodFrom)), today - (DAILY_MAX_DAYS - 1) * DAY_MS);

    const daily = (table, col) =>
      db.prepare(`SELECT date(${col} / 1000, 'unixepoch') AS day, count(*) AS n FROM ${table} WHERE ${col} >= ?1 GROUP BY day`).bind(dailyFrom);
    const stmts = [
      metricsStmt(db, launchAt, decisionTo),
      metricsStmt(db, periodFrom, Math.max(periodFrom, untilNow)),
      db.prepare("SELECT value FROM settings WHERE key = 'enabled'"),
      db.prepare('SELECT kind, count(*) AS n FROM caches WHERE removed_at IS NULL AND expires_at > ?1 GROUP BY kind').bind(t),
      db.prepare('SELECT max(day) AS day FROM daily_stats'),
      db.prepare('SELECT day, count(*) AS n FROM seen WHERE day >= ?1 GROUP BY day').bind(utcDay(dailyFrom)),
      daily('caches', 'created_at'),
      daily('uses', 'used_at'),
      daily('thanks', 'at'),
      db.prepare(
        "SELECT owner, count(*) AS n FROM caches WHERE created_at > ?1 AND owner <> 'deleted' GROUP BY owner ORDER BY n DESC, owner LIMIT 5",
      ).bind(t - DAY_MS),
      db.prepare('SELECT action, key, count FROM rate_daily WHERE day = ?1 ORDER BY count DESC, key LIMIT 5').bind(utcDay(t)),
    ];
    let res;
    try {
      res = await db.batch(stmts);
    } catch (err) {
      // 무료 한도를 넘었거나 D1 장애일 때다. 원인은 wrangler tail로 본다.
      console.error('[admin] D1 조회 실패', err);
      throw new HttpError(503, 'db_unavailable');
    }
    const rows = res.map((r) => r.results);
    const [decisionRow, periodRow, settingRow, liveRows, statRow, seenD, placesD, usesD, thanksD, owners, rates] = rows;

    const decisionMetrics = shapeMetrics(decisionRow[0]);
    const live = { total: 0, bandage: 0, fuel: 0, battery: 0 };
    for (const r of liveRows) {
      live[r.kind] = r.n;
      live.total += r.n;
    }

    const lastAggregateDay = statRow[0]?.day ?? null;
    let cron;
    if (lastAggregateDay) cron = lastAggregateDay >= utcDay(t - 2 * DAY_MS) ? 'ok' : 'late';
    else cron = t - launchAt < 2 * DAY_MS ? 'pending' : 'late';

    const series = (list) => new Map(list.map((r) => [r.day, r.n]));
    const [s, p, u, th] = [seenD, placesD, usesD, thanksD].map(series);
    const days = [];
    for (let d = dailyFrom; d <= today; d += DAY_MS) {
      const day = utcDay(d);
      days.push({ day, players: s.get(day) ?? 0, places: p.get(day) ?? 0, uses: u.get(day) ?? 0, thanks: th.get(day) ?? 0 });
    }

    const limits = { place: rules.maxPlacesPerIpPerDay, use: rules.maxUsesPerIpPerDay };
    let rowsRead = null;
    for (const r of res) if (typeof r.meta?.rows_read === 'number') rowsRead = (rowsRead ?? 0) + r.meta.rows_read;

    return {
      now: t,
      launchAt,
      decision: {
        from: launchAt,
        to: decisionTo,
        endsAt: decisionEnd,
        final: t >= decisionEnd,
        metrics: decisionMetrics,
        verdict: verdict(decisionMetrics),
        criteria: DECISION,
      },
      period: { range, from: periodFrom, to: t, metrics: shapeMetrics(periodRow[0]) },
      status: {
        enabled: settingRow[0]?.value !== 'false',
        live,
        maxActiveTotal: rules.maxActiveTotal,
        lastAggregateDay,
        cron,
      },
      daily: days,
      abuse: {
        topOwners: owners.map((r) => ({ owner: r.owner, n: r.n })),
        maxActivePerPlayer: rules.maxActivePerPlayer,
        rate: rates.map((r) => ({ action: r.action, key: r.key.slice(0, 8), count: r.count, limit: limits[r.action] ?? null })),
      },
      cost: { rowsRead },
    };
  }

  async function fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname !== '/api/summary') throw new HttpError(404, 'not_found');
      if (request.method !== 'GET') throw new HttpError(405, 'method_not_allowed', { Allow: 'GET' });
      await authorize(request, env.ADMIN_TOKEN);
      const launchAt = launchTime(env);
      return json(200, await summary(env.DB, url, now(), launchAt));
    } catch (err) {
      if (err instanceof HttpError) return json(err.status, { error: err.code }, err.headers);
      console.error('[admin] 처리하지 못한 오류', err);
      return json(500, { error: 'internal' });
    }
  }

  return { fetch };
}

export default createAdmin();
