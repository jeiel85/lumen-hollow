// 운영 대시보드 화면. API는 같은 출처의 /api/summary(server/src/admin.js), 결정은 DECISIONS.md D-003.
// 서버에서 온 값은 모두 textContent로 넣는다(innerHTML을 쓰지 않는다).
// DOM을 쓰지 않는 부분(요청 순서·응답 해석·문구)은 logic.js에 있고 test/dashboard.test.mjs가 확인한다.
import { MIN_TOKEN_LENGTH, createGate, fetchSummary, decisionView, cronView, storyView, fmt, pct } from './logic.js';

const KEY = 'lumen-admin.token';
const SVG = 'http://www.w3.org/2000/svg';
const $ = (id) => document.getElementById(id);

const KIND = { bandage: '붕대', fuel: '연료', battery: '배터리' };
const ACTION = { place: '두기', use: '쓰기' };

const clock = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

let token = null;
let range = 'launch';
let last = null;
const gate = createGate();

// ---------------------------------------------------------------- 토큰 보관

function storedToken() {
  try {
    return sessionStorage.getItem(KEY) ?? localStorage.getItem(KEY);
  } catch {
    return null; // 저장소를 못 쓰는 환경이면 매번 입력한다
  }
}

function keepToken(value, persist) {
  try {
    sessionStorage.setItem(KEY, value);
    if (persist) localStorage.setItem(KEY, value);
    else localStorage.removeItem(KEY);
  } catch {
    // 저장소를 못 쓰면 이 페이지가 열려 있는 동안만 기억한다(token 변수).
  }
}

function setBusy(busy) {
  document.body.classList.toggle('loading', busy);
  $('refresh').disabled = busy;
}

// 진행 중인 요청을 끊고, 이미 도착 중인 응답도 쓰지 않게 한다.
function cancelLoad() {
  gate.cancel();
  setBusy(false);
}

function dropToken() {
  cancelLoad();
  token = null;
  try {
    sessionStorage.removeItem(KEY);
    localStorage.removeItem(KEY);
  } catch {
    // 저장소를 못 쓰는 환경에는 지울 것도 없다.
  }
}

// ---------------------------------------------------------------- 화면 전환

function showLogin(message = '') {
  $('board').hidden = true;
  $('top-actions').hidden = true;
  $('board-error').hidden = true;
  $('login').hidden = false;
  $('login-error').textContent = message;
  $('token').value = '';
  $('token').focus();
}

function showBoard() {
  $('login').hidden = true;
  $('board').hidden = false;
  $('top-actions').hidden = false;
}

function showError(message) {
  if (!$('login').hidden) {
    $('login-error').textContent = message;
    return;
  }
  // 처음 불러오기가 실패해도 새로고침·로그아웃은 할 수 있게 위쪽 버튼을 보인다.
  $('board-error').textContent = message;
  $('board-error').hidden = false;
  $('top-actions').hidden = false;
}

// ---------------------------------------------------------------- 불러오기

async function load(nextRange = range) {
  if (!token) return;
  const ticket = gate.start();
  setBusy(true);
  try {
    const r = await fetchSummary(fetch, { token, range: nextRange, ticket });
    if (r.type === 'stale') return;
    if (r.type === 'unauthorized') {
      dropToken();
      showLogin('토큰이 맞지 않아요.');
      return;
    }
    if (r.type === 'error') {
      showError(r.message);
      return;
    }
    last = r.body;
    range = r.body.period.range;
    showBoard();
    $('board-error').hidden = true;
    render(r.body);
  } finally {
    if (ticket.current) {
      ticket.finish();
      setBusy(false);
    }
  }
}

// ---------------------------------------------------------------- 그리기 도우미

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function setMeter(meter, value, max, label) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  meter.firstElementChild.style.width = `${(ratio * 100).toFixed(1)}%`;
  meter.setAttribute('aria-valuemax', String(max));
  meter.setAttribute('aria-valuenow', String(Math.min(value, max)));
  if (label) meter.setAttribute('aria-label', label);
}

function setState(node, kind, icon, text) {
  node.className = `state ${kind}`;
  node.replaceChildren(el('span', 'icon', icon), document.createTextNode(text));
}

// ---------------------------------------------------------------- 지금 상태

function renderStatus(s) {
  if (s.enabled) setState($('st-enabled'), 'good', '✓', '켜짐 — 보급품을 두고 쓸 수 있어요');
  else setState($('st-enabled'), 'bad', '✕', '꺼짐 — 킬 스위치가 내려가 있어요');

  $('st-live').textContent = fmt(s.live.total);
  $('st-live-max').textContent = `/ ${fmt(s.maxActiveTotal)}개`;
  setMeter($('st-live-meter'), s.live.total, s.maxActiveTotal, '살아 있는 보급품 / 전체 상한');
  $('st-kinds').textContent = Object.entries(KIND).map(([k, name]) => `${name} ${fmt(s.live[k] ?? 0)}`).join(' · ');

  const cron = cronView(s);
  setState($('st-cron'), cron.kind, cron.icon, cron.text);
  $('st-cron-note').textContent = cron.note;
}

// ---------------------------------------------------------------- 14일 판단

function renderDecision(d, now) {
  const v = decisionView(d, now);
  $('dc-when').textContent = v.when;
  setMeter($('dc-days'), v.meter.value, v.meter.max);
  $('dc-verdict').replaceChildren(document.createTextNode(v.headline), el('span', 'muted small', v.note));
  $('dc-criteria').replaceChildren(...v.criteria.map(({ label, value, target, shown, met }) => {
    const li = el('li');
    const head = el('div', 'row');
    head.append(el('span', 'name', label), el('span', 'value', shown));
    const meter = el('div', 'meter');
    meter.setAttribute('role', 'meter');
    meter.setAttribute('aria-valuemin', '0');
    meter.append(el('span'));
    setMeter(meter, value, target, label);
    li.append(head, meter, el('span', `mark ${met ? 'met' : 'unmet'}`, met ? '✓ 넘음' : '✕ 아직'));
    return li;
  }));
}

// ---------------------------------------------------------------- 남용

function renderAbuse(a) {
  const owners = $('ab-owners');
  if (a.topOwners.length === 0) {
    const tr = el('tr');
    const td = el('td', 'empty', '없음');
    td.colSpan = 2;
    tr.append(td);
    owners.replaceChildren(tr);
  } else {
    owners.replaceChildren(...a.topOwners.map((o) => {
      const tr = el('tr');
      tr.append(el('td', 'hash', o.owner), el('td', 'num', fmt(o.n)));
      return tr;
    }));
  }

  const rate = $('ab-rate');
  if (a.rate.length === 0) {
    const tr = el('tr');
    const td = el('td', 'empty', '없음');
    td.colSpan = 3;
    tr.append(td);
    rate.replaceChildren(tr);
  } else {
    rate.replaceChildren(...a.rate.map((r) => {
      const tr = el('tr');
      const cell = el('td', 'num');
      const over = r.limit !== null && r.count >= r.limit;
      cell.append(over ? el('span', 'over', `⚠ ${fmt(r.count)}`) : document.createTextNode(fmt(r.count)), document.createTextNode(` / ${fmt(r.limit)}`));
      tr.append(el('td', '', ACTION[r.action] ?? r.action), el('td', 'hash', r.key), cell);
      return tr;
    }));
  }
}

// ---------------------------------------------------------------- 기간 지표

function renderKpis(m, partial) {
  $('period-partial').hidden = !partial;
  const tiles = [
    ['접속 플레이어', fmt(m.players), '온라인을 켠 채 게임을 연 ID(근사값)'],
    ['둔 플레이어', fmt(m.placers), `보급품 ${fmt(m.places)}개`],
    ['남의 것을 쓴 플레이어', fmt(m.takers), `사용 ${fmt(m.uses)}번`],
    ['쓰인 보급품 비율', pct(m.usedPct), `${fmt(m.usedCaches)} / ${fmt(m.places)}개가 남에게 쓰임`],
    ['고마워요 비율', pct(m.thanksPct), `고마워요 ${fmt(m.thanks)}번 / 사용 ${fmt(m.uses)}번`],
    ['다시 둔 플레이어', fmt(m.returningPlacers), '서로 다른 날에 2번 이상 둠'],
  ];
  $('kpis').replaceChildren(...tiles.map(([label, value, note]) => {
    const tile = el('div', 'kpi');
    tile.append(el('div', 'label', label), el('div', 'value', value), el('div', 'note', note));
    return tile;
  }));
}

// 위가 둥근(4px) 막대, 바닥은 기준선에 붙은 직각.
function barPath(x, y, w, h) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function niceMax(v) {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const step of [1, 2, 2.5, 5, 10]) if (step * pow >= v) return step * pow;
  return 10 * pow;
}

function showTip(target, day, value, unit) {
  const tip = $('tooltip');
  const strong = el('strong', '', `${fmt(value)}${unit}`);
  tip.replaceChildren(el('span', 'key'), strong, document.createTextNode(`  ${day}`));
  tip.hidden = false;
  const box = target.getBoundingClientRect();
  const w = tip.offsetWidth;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, box.left + box.width / 2 - w / 2));
  tip.style.left = `${left}px`;
  tip.style.top = `${Math.max(8, box.top - tip.offsetHeight - 8)}px`;
}

function hideTip() {
  $('tooltip').hidden = true;
}

function columnChart(title, unit, points, measured) {
  const fig = el('figure', 'chart');
  const total = points.reduce((s, p) => s + p.value, 0);
  const cap = el('figcaption');
  cap.append(el('span', '', title), el('span', 'total', `합계 ${fmt(total)}${unit}`));
  fig.append(cap);

  const width = Math.max(200, measured || 280);
  const plotH = 96;
  const axisH = 20;
  const left = 28;
  const plotW = width - left;
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${plotH + axisH}`);
  svg.setAttribute('height', String(plotH + axisH));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${title}: 합계 ${fmt(total)}${unit}, 하루 최대 ${fmt(Math.max(0, ...points.map((p) => p.value)))}${unit}. 날짜별 값은 아래 '표로 보기'에 있습니다.`);

  const line = (cls, y, label) => {
    const l = document.createElementNS(SVG, 'line');
    l.setAttribute('class', cls);
    l.setAttribute('x1', String(left));
    l.setAttribute('x2', String(width));
    l.setAttribute('y1', String(y + 0.5));
    l.setAttribute('y2', String(y + 0.5));
    svg.append(l);
    const t = document.createElementNS(SVG, 'text');
    t.setAttribute('class', 'tick');
    t.setAttribute('x', String(left - 6));
    t.setAttribute('y', String(y + 4));
    t.setAttribute('text-anchor', 'end');
    t.textContent = label;
    svg.append(t);
  };
  line('gridline', 0, fmt(max));
  line('baseline', plotH, '0');

  const slot = plotW / Math.max(1, points.length);
  const barW = Math.max(2, Math.min(24, slot - 2));
  points.forEach((p, i) => {
    const g = document.createElementNS(SVG, 'g');
    const x = left + i * slot + (slot - barW) / 2;
    const hit = document.createElementNS(SVG, 'rect');
    hit.setAttribute('class', 'hit');
    hit.setAttribute('x', String(left + i * slot));
    hit.setAttribute('y', '0');
    hit.setAttribute('width', String(slot));
    hit.setAttribute('height', String(plotH));
    g.append(hit);
    if (p.value > 0) {
      const h = Math.max(2, (p.value / max) * plotH);
      const bar = document.createElementNS(SVG, 'path');
      bar.setAttribute('class', 'bar');
      bar.setAttribute('d', barPath(x, plotH - h, barW, h));
      g.append(bar);
    }
    g.addEventListener('pointerenter', () => {
      g.classList.add('on');
      showTip(hit, p.day, p.value, unit);
    });
    g.addEventListener('pointerleave', () => {
      g.classList.remove('on');
      hideTip();
    });
    svg.append(g);
  });

  const dayLabel = (i, anchor) => {
    const t = document.createElementNS(SVG, 'text');
    t.setAttribute('class', 'tick');
    t.setAttribute('x', String(anchor === 'start' ? left : width));
    t.setAttribute('y', String(plotH + 15));
    t.setAttribute('text-anchor', anchor);
    t.textContent = points[i].day.slice(5);
    svg.append(t);
  };
  if (points.length > 0) dayLabel(0, 'start');
  if (points.length > 1) dayLabel(points.length - 1, 'end');

  fig.append(svg);
  return fig;
}

function renderDaily(days) {
  const charts = $('charts');
  const series = [
    ['접속 플레이어', '명', 'players'],
    ['둔 보급품', '개', 'places'],
    ['사용', '번', 'uses'],
    ['고마워요', '번', 'thanks'],
  ];
  // 너비를 재려면 먼저 자리에 붙여야 한다: 빈 figure로 자리를 잡고, 잰 너비로 다시 그린다.
  charts.replaceChildren(...series.map(() => el('figure', 'chart')));
  const widths = [...charts.children].map((f) => f.clientWidth - 28);
  charts.replaceChildren(...series.map(([title, unit, key], i) => columnChart(title, unit, days.map((d) => ({ day: d.day, value: d[key] })), widths[i])));

  $('daily-table').replaceChildren(...days.slice().reverse().map((d) => {
    const tr = el('tr');
    tr.append(el('td', '', d.day), ...['players', 'places', 'uses', 'thanks'].map((k) => el('td', 'num', fmt(d[k]))));
    return tr;
  }));
}

// ---------------------------------------------------------------- 이야기 진행

function emptyRow(cols, text) {
  const tr = el('tr');
  const td = el('td', 'empty', text);
  td.colSpan = cols;
  tr.append(td);
  return tr;
}

function renderStory(story) {
  const v = storyView(story);
  if (!v) {
    $('story-note').textContent = '이야기 집계 표가 아직 없어요(마이그레이션 0001을 적용하세요).';
    $('story-chapters').replaceChildren(emptyRow(3, '없음'));
    $('story-scenes').replaceChildren(emptyRow(4, '없음'));
    return;
  }
  const note = $('story-note');
  note.className = v.full ? 'error small' : 'muted small';
  note.textContent = `${v.from}(UTC)부터 센 값. ${v.today}`;
  $('story-chapters').replaceChildren(...(v.chapters.length === 0 ? [emptyRow(3, '없음')] : v.chapters.map((c) => {
    const tr = el('tr');
    tr.append(el('td', '', `${c.id}장`), el('td', 'num', fmt(c.entered)), el('td', 'num', fmt(c.cleared)));
    return tr;
  })));
  $('story-scenes').replaceChildren(...(v.scenes.length === 0 ? [emptyRow(4, '없음')] : v.scenes.map((s) => {
    const tr = el('tr');
    tr.append(el('td', 'hash', s.id), el('td', 'num', fmt(s.n)), el('td', 'num', fmt(s.skipped)), el('td', 'num', pct(s.skippedPct)));
    return tr;
  })));
}

// ---------------------------------------------------------------- 전체

function render(d) {
  $('fetched').textContent = `조회 ${clock.format(d.now)}`;
  renderStatus(d.status);
  renderDecision(d.decision, d.now);
  renderAbuse(d.abuse);
  renderKpis(d.period.metrics, d.period.partial);
  renderDaily(d.daily);
  renderStory(d.story);
  for (const b of document.querySelectorAll('.filters button')) b.setAttribute('aria-pressed', String(b.dataset.range === d.period.range));
  $('cost').textContent = d.cost.rowsRead === null
    ? '이번 조회가 읽은 D1 행 수: 알 수 없음'
    : `이번 조회가 읽은 D1 행 수: ${fmt(d.cost.rowsRead)} (무료 한도 하루 5,000,000행)`;
}

$('login-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const value = $('token').value.trim();
  if (value.length < MIN_TOKEN_LENGTH) {
    $('login-error').textContent = `토큰은 ${MIN_TOKEN_LENGTH}자 이상이에요.`;
    return;
  }
  token = value;
  keepToken(value, $('remember').checked);
  $('login-error').textContent = '';
  load();
});

$('logout').addEventListener('click', () => {
  dropToken();
  last = null;
  showLogin();
});

$('refresh').addEventListener('click', () => load());

for (const b of document.querySelectorAll('.filters button')) {
  b.addEventListener('click', () => {
    if (b.dataset.range !== range) load(b.dataset.range);
  });
}

let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => last && renderDaily(last.daily), 150);
});

token = storedToken();
if (token) load();
else showLogin();
