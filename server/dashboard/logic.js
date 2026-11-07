// 운영 대시보드 화면에서 DOM을 쓰지 않는 부분: 요청 순서 관리, 응답 해석, 화면 문구.
// dashboard.js가 이것을 불러 그리고, test/dashboard.test.mjs가 Node에서 확인한다(브라우저 없이).

export const DAY = 24 * 60 * 60 * 1000;
export const MIN_TOKEN_LENGTH = 32;

export const MESSAGES = {
  admin_not_configured: '서버에 ADMIN_TOKEN이 아직 없어요. server/README.md의 운영 대시보드 배포 순서를 보세요.',
  misconfigured: '서버 설정(LAUNCH_AT 또는 D1 연결)이 빠졌어요.',
  db_unavailable: 'D1 조회에 실패했어요. 무료 한도를 넘었거나 D1 장애일 수 있어요. npx wrangler tail -c wrangler.admin.toml로 원인을 보세요.',
  bad_range: '기간 값이 잘못됐어요.',
  rate: '요청이 너무 잦아요. 1분쯤 뒤에 다시 시도하세요.',
  internal: '서버 오류가 났어요. npx wrangler tail -c wrangler.admin.toml로 원인을 보세요.',
};
export const NETWORK_ERROR = '서버에 닿지 못했어요. 네트워크를 확인하고 다시 시도하세요.';

export const errorMessage = (code, status) => MESSAGES[code] ?? `서버 오류가 났어요(HTTP ${status}).`;

const when = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' });
const num = new Intl.NumberFormat('ko-KR');
export const formatWhen = (t) => when.format(t);
export const fmt = (n) => (n === null || n === undefined ? '—' : num.format(n));
export const pct = (n) => (n === null || n === undefined ? '—' : `${n}%`);

// ---------------------------------------------------------------- 요청 순서

// 요청마다 번호를 올린다. 새 요청을 보내거나 로그아웃하면(cancel) 앞 요청은 끊기고, 이미 도착 중인 응답도 쓰지 않는다
// (로그아웃 뒤 지표가 다시 그려지거나, 늦게 온 앞 기간의 응답이 새 기간 화면을 덮어쓰지 않게).
export function createGate() {
  let generation = 0;
  let inflight = null;
  const gate = {
    start() {
      gate.cancel();
      const mine = generation;
      const controller = new AbortController();
      inflight = controller;
      return {
        signal: controller.signal,
        get current() {
          return mine === generation;
        },
        finish() {
          if (mine === generation) inflight = null;
        },
      };
    },
    cancel() {
      generation += 1;
      inflight?.abort();
      inflight = null;
    },
    get busy() {
      return inflight !== null;
    },
  };
  return gate;
}

// 조회 한 번. 결과 종류: ok(지표) / unauthorized(토큰 틀림) / error(보여 줄 문장) / stale(무효가 된 요청이라 버림).
export async function fetchSummary(fetchFn, { token, range, ticket }) {
  let res;
  let body;
  try {
    res = await fetchFn(`/api/summary?range=${encodeURIComponent(range)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: ticket.signal,
    });
    body = await res.json().catch(() => null);
  } catch {
    // 일부러 끊은 요청(로그아웃·새 요청)은 오류가 아니다.
    return ticket.current ? { type: 'error', message: NETWORK_ERROR } : { type: 'stale' };
  }
  if (!ticket.current) return { type: 'stale' };
  if (res.status === 401) return { type: 'unauthorized' };
  if (!res.ok || !body) return { type: 'error', message: errorMessage(body?.error, res.status) };
  return { type: 'ok', body };
}

// ---------------------------------------------------------------- 14일 판단

// [이름, 이유, 할 일] — docs/online-caches.md 14.2절. 판단일 전에는 '14일째에도 이대로면'을 붙인다.
export const VERDICT = {
  continue: ['계속', '남의 것을 쓴 플레이어와 쓰인 비율이 기준을 넘었어요', '랜턴 등 2단계로 넘어갑니다'],
  review: ['재검토', '둔 사람은 있는데 쓰인 비율이 20% 미만이에요', '수명·노출을 조정해 한 번 더 측정합니다'],
  stop: ['중단', '둔 플레이어가 5명 미만이에요', '킬 스위치로 끄고, 30일 뒤 데이터를 지울지 정합니다'],
  between: ['기준 사이', '어느 기준에도 딱 맞지 않아요', '수치를 보고 직접 정합니다'],
};

// 판단 기간 기록이 보존 기간(90일)을 지나 지워지기 시작하면(expired) 남은 기록으로 판정을 다시 내지 않는다.
export function decisionView(d, now, format = formatWhen) {
  if (d.expired) {
    return {
      expired: true,
      when: `판단 기간(${format(d.from)} ~ ${format(d.endsAt)}) 기록이 보존 기간(90일)을 지나 지워지기 시작했어요.`,
      meter: { value: d.criteria.days, max: d.criteria.days },
      headline: '다시 계산하지 않아요',
      note: ' — 남은 기록으로 세면 판정이 틀어집니다. 판단일에 남겨 둔 결정 기록(docs/online-caches.md 14.4절)을 보세요.',
      criteria: [],
    };
  }
  const elapsed = Math.max(0, now - d.from);
  const dayNo = Math.min(d.criteria.days, Math.floor(elapsed / DAY) + 1);
  const left = Math.ceil((d.endsAt - now) / DAY);
  const [name, reason, action] = VERDICT[d.verdict] ?? [d.verdict, '', ''];
  const m = d.metrics;
  const c = d.criteria;
  return {
    expired: false,
    when: d.final
      ? `판단 기간이 끝났어요: ${format(d.from)} ~ ${format(d.endsAt)}`
      : `출시 ${dayNo}일째 · 판단일 ${format(d.endsAt)} (${left}일 남음)`,
    meter: { value: Math.min(elapsed / DAY, c.days), max: c.days },
    headline: d.final ? `판정: ${name}` : `지금 수치로는: ${name}`,
    note: ` — ${reason}. ${d.final ? '' : '14일째에도 이대로면 '}${action}.`,
    criteria: [
      { label: '남의 것을 쓴 플레이어(계속 기준)', value: m.takers, target: c.continueTakers, shown: `${fmt(m.takers)} / ${c.continueTakers}명`, met: m.takers >= c.continueTakers },
      { label: '쓰인 보급품 비율(계속 기준)', value: m.usedPct ?? 0, target: c.continueUsedPct, shown: `${pct(m.usedPct)} / ${c.continueUsedPct}%`, met: (m.usedPct ?? -1) >= c.continueUsedPct },
      { label: '둔 플레이어(중단을 피하는 최소)', value: m.placers, target: c.stopPlacers, shown: `${fmt(m.placers)} / ${c.stopPlacers}명`, met: m.placers >= c.stopPlacers },
    ],
  };
}

// ---------------------------------------------------------------- 정리 작업 상태

// status.cron과 status.cronLog(실행 기록, 없으면 null)로 [종류, 아이콘, 글, 설명]을 만든다.
export function cronView(s, format = formatWhen) {
  const log = s.cronLog;
  const run = log?.lastRun;
  const noLog = log === null || log === undefined ? ' 실행 기록 표가 없어 집계 날짜로만 봅니다(마이그레이션 0001을 적용하세요).' : '';
  const lastFail = log?.lastFailure && run?.ok ? ` 최근 실패: ${format(log.lastFailure.at)} — ${log.lastFailure.error ?? '이유 없음'}.` : '';
  if (s.cron === 'ok') {
    const note = run
      ? `마지막 성공 ${format(log.lastSuccessAt)} · 지운 행 ${fmt(run.deleted)}개.${lastFail}`
      : `마지막 집계 날짜 ${s.lastAggregateDay}(UTC).${noLog}`;
    return { kind: 'good', icon: '✓', text: '정상', note };
  }
  if (s.cron === 'pending') {
    return { kind: 'warn', icon: '…', text: '첫 실행 전', note: `출시 뒤 첫 03:17 UTC(한국 시간 12:17)에 처음 돕니다.${noLog}` };
  }
  if (s.cron === 'failed') {
    const since = log.lastSuccessAt ? `마지막 성공은 ${format(log.lastSuccessAt)}예요.` : '성공한 기록이 없어요.';
    return {
      kind: 'bad',
      icon: '✕',
      text: '실패 — 확인 필요',
      note: `${format(run.at)}에 실패했어요: ${run.error ?? '이유 없음'}. ${since} 90일 보존 삭제가 밀릴 수 있어요(npx wrangler tail로 다음 실행을 확인).`,
    };
  }
  let note;
  if (log?.lastSuccessAt) note = `마지막 성공이 ${format(log.lastSuccessAt)}예요. 하루 한 번 돌아야 하는데 빠졌어요(npx wrangler tail로 확인).${lastFail}`;
  else if (s.lastAggregateDay) note = `마지막 집계가 ${s.lastAggregateDay}(UTC)예요. 정리 작업이 돌지 않았을 수 있어요(npx wrangler tail로 확인).${noLog}`;
  else note = `집계 기록이 없어요. 정리 작업(cron)이 한 번도 돌지 않았을 수 있어요.${noLog}`;
  return { kind: 'bad', icon: '⚠', text: '늦음 — 확인 필요', note };
}

// ---------------------------------------------------------------- 이야기 진행

const byId = (a, b) => a.id.localeCompare(b.id, 'en', { numeric: true });

// 서버의 story(없으면 null)를 장 표와 장면 표로 나눈다. 장면은 서버가 정한 순서(많이 도달한 순)를 그대로 쓴다.
export function storyView(story) {
  if (!story) return null;
  const chapters = new Map();
  const scenes = [];
  for (const r of story.rows) {
    if (r.kind === 'scene') {
      scenes.push({ id: r.id, n: r.n, skipped: r.skipped, skippedPct: r.n > 0 ? Math.round((1000 * r.skipped) / r.n) / 10 : null });
    } else if (r.kind === 'chapter' || r.kind === 'clear') {
      const c = chapters.get(r.id) ?? { id: r.id, entered: 0, cleared: 0 };
      if (r.kind === 'chapter') c.entered += r.n;
      else c.cleared += r.n;
      chapters.set(r.id, c);
    }
  }
  const t = story.today;
  return {
    from: story.from,
    chapters: [...chapters.values()].sort(byId),
    scenes,
    today: t.full
      ? `⚠ 오늘(UTC) 하루 상한 ${fmt(t.max)}건에 닿아 더 세지 않아요. 남용이 아니라면 src/rules.js의 storyMaxEventsPerDay를 늘릴지 봅니다.`
      : `오늘(UTC) 받은 사건 ${fmt(t.events)} / 하루 상한 ${fmt(t.max)}건`,
    full: t.full,
  };
}
