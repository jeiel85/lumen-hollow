// 2~4장 분량 측정 도구(통과/실패 시험이 아니다): 1장을 마친 것으로 치고 봇이 2장부터 이야기 끝 화면까지 한다.
// 순간이동·시간 건너뛰기 없이 화면의 푸른 화살표(chapters.target)를 따라 걷고, 손이 닿는 지금 차례의 할 일만 E를 길게 누르며,
// 밤은 그대로 버틴다(겨눌 그늘이가 있을 때만 손전등, 갈 곳이 없는 밤에는 가까운 불빛 아래). 정답을 아는 사람처럼 두 곳만 따로 한다:
// 3장 봉투는 짝이 맞는 침상에 놓고, 4장 세 번째 그림자는 본관 침상 가까이 올 때까지 기다렸다가 비춘다(일찍 흩으면 다시 모인다).
// 선택 기록(4장 이름표 등)은 줍지 않고 끝에 읽기 시간만 따로 센다. 실수·헤매기가 없으니 장별 시간은 사람 플레이의 하한이다.
// 시간: 플레이는 게임이 흐른 시간(장면 동안은 멈춘다), 장면·기록은 tests/node/playtime.mjs와 같은 읽기 모형
// (장면 한 줄 = 글자 수/42 + 1.2초, 기록 = 글자 수/12 + 2초)으로 더한다. 1장 플레이 시간은 autoplay.mjs로 잰다.
// 판마다 새 브라우저 프로필로 연다(이야기 진행이 이 브라우저에 남아서). 그리기만 끄고 화면 루프를 멈춰 한 판이 몇 초에 끝난다.
//   node tests/e2e/chapterplay.mjs [url] [난이도(쉼표) 기본 normal] [판 수 기본 2] [결과 JSON 경로(선택)]
import { writeFileSync } from 'node:fs';
import { launch, fullGame } from './cdp.mjs';
import { navKit } from './botnav.mjs';

const [,, rawUrl = 'http://127.0.0.1:8000/?debug', levelsArg = 'normal', repsArg = '2', outPath = null] = process.argv;
const url = fullGame(rawUrl); // 2~4장은 앱에서만 열린다(#50)
const MAX_MIN = 60; // 게임 시간 상한(분). 넘으면 막힌 것으로 본다

// ---------------------------------------------------------------- 페이지 안에서 도는 봇(문자열로 넣으므로 바깥 이름을 쓰지 않는다)
function installChapterBot(navKit) {
  const L = window.lumen;
  const { player, env, shades, input, game, camera, THREE, chapters: C } = L;
  const R = 0.36, CELL = 0.25, FLASH = 13, BED_WAIT = 8.5;
  let G = null; // 지금 무대의 격자 { stage, nav }
  window.requestAnimationFrame = () => 0; // 실제 화면 루프를 멈춘다(lumen.step으로만 진행)

  // 무대의 걸을 수 있는 영역(areas)을 감싸는 상자를 0.25m 칸으로 나눠, 영역 밖이거나 몸(반지름 + 0.08m)이 충돌체·영역 가장자리에
  // 밀려나는 칸을 막는다. 판정은 게임의 stage.walkable·stage.collide 그대로다.
  function buildGrid(stage) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const a of stage.areas) {
      const pts = a.c ? [[a.x - a.r, a.z - a.r], [a.x + a.r, a.z + a.r]]
        : [[a.x0, a.z0], [a.x1, a.z0], [a.x0, a.z1], [a.x1, a.z1]].map(([lx, lz]) => [a.f.px(lx, lz), a.f.pz(lx, lz)]);
      for (const [x, z] of pts) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
      }
    }
    x0 -= 1; z0 -= 1;
    const nx = Math.ceil((x1 + 1 - x0) / CELL) + 1, nz = Math.ceil((z1 + 1 - z0) / CELL) + 1;
    const blocked = new Uint8Array(nx * nz);
    const p = { x: 0, z: 0 };
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const x = x0 + i * CELL, z = z0 + j * CELL;
        if (!stage.walkable(x, z)) { blocked[i * nz + j] = 1; continue; }
        p.x = x; p.z = z;
        stage.collide(p, R + 0.08);
        if (Math.abs(p.x - x) + Math.abs(p.z - z) > 0.02) blocked[i * nz + j] = 1;
      }
    }
    G = { stage, blocked, nav: navKit({ x0, z0, nx, nz, cell: CELL, blocked }) };
  }
  const playerCell = () => {
    const k = G.nav.idxOf(player.pos.x, player.pos.z);
    return k >= 0 && !G.blocked[k] ? k : G.nav.freeNear(player.pos.x, player.pos.z, 1.5);
  };

  // ------------------------------------------------------------ 입력(autoplay.mjs와 같은 방식)
  let move = { x: 0, y: 0 };
  input.moveScreen = () => move;
  const tmpV = new THREE.Vector3();
  function aimAt(x, z) {
    tmpV.set(x, player.pos.y + 0.9, z).project(camera);
    input.usingTouch = false;
    input.mouse.active = true;
    input.mouse.x = tmpV.x;
    input.mouse.y = tmpV.y;
  }
  function setFlash(on) {
    if (on && player.battery <= 1) on = false;
    if (player.flashOn !== on) input.pressed.add('KeyF');
  }
  function steerTo(x, z, slow = 0) {
    let dx = x - player.pos.x, dz = z - player.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) { move = { x: 0, y: 0 }; return; }
    dx /= d; dz /= d;
    const m = slow ? Math.min(1, Math.max(0.35, d / slow)) : 1;
    move = { x: ((dx - dz) / Math.SQRT2) * m, y: ((dx + dz) / Math.SQRT2) * m };
  }
  // 겨눌 그늘이: 목표 그림자(tag) 먼저, 빛먹이, 가까운 것. 4장 세 번째 그림자는 본관 침상 가까이 올 때까지 두고 본다.
  function pickShade() {
    let best = null, bs = Infinity;
    for (const s of shades.list) {
      if (!s.active || s.state !== 'stalk') continue;
      const d = Math.hypot(s.x - player.pos.x, s.z - player.pos.z);
      if (d > FLASH - 0.5 || L.ground.blocksSight?.(player.pos.x, player.pos.z, s.x, s.z)) continue;
      if (s.tag === 't3' && d > 3 && Math.hypot(s.x - C.river.bedsMark.x, s.z - C.river.bedsMark.z) > BED_WAIT) continue;
      const score = d - (s.tag ? 10 : 0) - (s.kind === 'eater' ? 6 : 0);
      if (score < bs) { bs = score; best = s; }
    }
    return best;
  }
  const nightNow = () => env.night > 0.6 || shades.list.some((s) => s.active && s.state !== 'die');

  // ------------------------------------------------------------ 기록
  let M = null;
  const cur = () => (M.ch[game.chapter] ??= { play: 0, walk: 0, hold: 0, idle: 0, night: 0, sceneSec: 0, docSec: 0, scenes: [], docs: 0, fails: 0, hits: 0, minHp: 100 });
  const seenScene = new Set();
  function readScene(sc) {
    if (seenScene.has(sc.id)) return;
    seenScene.add(sc.id);
    const c = cur();
    c.sceneSec += sc.lines.reduce((t, l) => t + l.text.length / 42 + 1.2, 0);
    c.scenes.push(sc.id);
  }
  function readDoc() {
    const n = (L.dialogue.el.doc.textContent ?? '').replace(/\s+/g, '').length;
    const c = cur();
    c.docSec += n / 12 + 2;
    c.docs++;
  }
  const log = (type, extra = {}) => M.events.push({ type, ch: game.chapter, step: C.step, t: Math.round(game.time - M.t0), h: +env.hour.toFixed(2), ...extra });

  // ------------------------------------------------------------ 한 번의 판단(0.1초마다)
  let route = null;
  let lastPress = null;
  // 지금 차례의 할 일인가: 화살표가 가리키는 자리(3장 침상 차례는 들고 있는 봉투의 짝 침상, 없으면 바구니)
  function wanted(t) {
    if (!t || t.blocked) return false;
    if (C.step === 'beds') return t.key.id === (C.carry ?? 'basket');
    return C.targetList().some((s) => s && Math.hypot(s.x - t.key.x, s.z - t.key.z) < 0.3);
  }
  function routeTo(tgt) {
    const field = G.nav.dijkstra([playerCell()]);
    const g = G.nav.freeNear(tgt.x, tgt.z, 2.0, (k) => Number.isFinite(field.dist[k]));
    if (g < 0) return null;
    return { key: `${tgt.x.toFixed(2)},${tgt.z.toFixed(2)}`, pts: G.nav.pathTo(field, g), stuckT: 0, last: { x: player.pos.x, z: player.pos.z } };
  }
  function nearestLight() {
    const field = G.nav.dijkstra([playerCell()]);
    let best = null, bd = Infinity;
    for (const lp of L.ground.lamps) {
      if (lp.on === false || lp.level < 0.5) continue;
      const k = G.nav.freeNear(lp.x, lp.z, Math.min(2, lp.r * 0.6), (q) => Number.isFinite(field.dist[q]));
      if (k >= 0 && field.dist[k] < bd) { bd = field.dist[k]; best = { x: G.nav.kx(k), z: G.nav.kz(k) }; }
    }
    return best;
  }

  function tick(dt) {
    if (G?.stage !== L.ground) { buildGrid(L.ground); route = null; }
    const c = cur();
    const night = nightNow();
    if (night) c.night += dt;
    const shade = night ? pickShade() : null;
    setFlash(!!shade);
    if (shade) aimAt(shade.x, shade.z);
    if (game.holdLock) input.keys.delete('KeyE'); // 한 번 해낸 뒤에는 손을 뗐다 다시 누른다
    if (C.rowing) { move = { x: 0, y: 0 }; input.keys.delete('KeyE'); c.idle += dt; return; }

    const t = C.nearest(player.pos.x, player.pos.z);
    if (wanted(t) && !game.holdLock) {
      if (lastPress !== t.key) { lastPress = t.key; log('press', { label: t.label }); }
      move = { x: 0, y: 0 };
      input.keys.add('KeyE');
      c.hold += dt;
      return;
    }
    input.keys.delete('KeyE');

    let tgt = C.step === 'beds' ? C.spot(C.carry ?? 'basket') : C.target(player.pos.x, player.pos.z);
    let waiting = false;
    if (!tgt) {
      waiting = true;
      if (night && !L.ground.lightAt(player.pos.x, player.pos.z)) tgt = nearestLight();
    }
    if (!tgt) { move = { x: 0, y: 0 }; c.idle += dt; return; }
    const key = `${tgt.x.toFixed(2)},${tgt.z.toFixed(2)}`;
    if (!route || route.key !== key) route = routeTo(tgt);
    if (!route) { move = { x: 0, y: 0 }; c.idle += dt; return; }
    const pts = route.pts;
    while (pts.length && Math.hypot(pts[0].x - player.pos.x, pts[0].z - player.pos.z) < 0.4) pts.shift();
    const left = Math.hypot(tgt.x - player.pos.x, tgt.z - player.pos.z);
    if (!pts.length && left < 0.35) { move = { x: 0, y: 0 }; c.idle += dt; return; }
    const to = pts[0] ?? tgt;
    steerTo(to.x, to.z, pts.length <= 1 ? 1.0 : 0);
    if (waiting) c.idle += dt;
    else c.walk += dt;
    // 2초 동안 0.4m도 못 갔으면 길을 다시 찾는다
    route.stuckT += dt;
    if (route.stuckT > 2) {
      const moved = Math.hypot(player.pos.x - route.last.x, player.pos.z - route.last.z);
      route.stuckT = 0;
      route.last = { x: player.pos.x, z: player.pos.z };
      if (moved < 0.4) { M.stuck++; route = routeTo(tgt); }
    }
  }

  async function run({ level = 'normal', maxMin = 60, TICK = 0.1, DT = 1 / 30 } = {}) {
    L.settings.difficulty = level;
    L.post.render = () => {};
    // 1장을 마친 것으로 친다(엔딩까지 본 기록) → 처음 화면의 장 단추로 2장
    for (const id of ['arrival', 'dusk', 'dawn', 'light1', 'shadows', 'return', 'founders', 'lookout', 'promise', 'line', 'last', 'finale']) L.story.markSeen(id);
    L.backToTitle();
    L.step(0.2, DT);
    M = { ch: {}, events: [], t0: game.time, stuck: 0 };
    let lastHp = player.hp, lastStep = null, done = null;
    for (let ticks = 1; !done; ticks++) {
      if (ticks % 200 === 0) await new Promise((r) => setTimeout(r, 0));
      if ((game.time - M.t0) / 60 > maxMin) { done = 'timeout'; break; }
      if (C.step !== lastStep) { if (game.chapter) log('step', { from: lastStep }); lastStep = C.step; }
      if (L.dialogue.scene) { readScene(L.dialogue.scene); L.dialogue.skip(); L.step(0.1, DT); continue; }
      if (L.dialogue.docOpen) {
        readDoc();
        if (L.dialogue.docFlip) L.dialogue.docFlip(); // 3장 명부·짐표 맞춰 보기의 뒤집기
        L.dialogue.closeDoc();
        L.step(0.1, DT);
        continue;
      }
      if (game.state === 'end') {
        const title = document.getElementById('end-title').textContent;
        const next = document.getElementById('next-chapter-btn');
        if (!game.won && !document.getElementById('restart-btn').classList.contains('hidden') && C.ch && !player.alive) {
          cur().fails++;
          log('fail');
          input.keys.delete('KeyE');
          document.getElementById('restart-btn').click();
        } else if (next && !next.classList.contains('hidden')) next.click();
        else { done = `end:${title}`; break; }
        L.step(0.3, DT);
        continue;
      }
      if (game.state === 'title') { document.getElementById('chapter-btn').click(); L.step(0.3, DT); continue; }
      if (game.state !== 'play') { L.step(0.1, DT); continue; }
      const c = cur();
      const t0 = game.time;
      tick(TICK);
      L.step(TICK, DT);
      c.play += game.time - t0;
      if (player.hp < lastHp - 0.01) c.hits++;
      c.minHp = Math.min(c.minHp, Math.round(player.hp));
      lastHp = player.hp;
    }
    input.keys.delete('KeyE');
    // 줍지 않은 기록(선택)과 1장 읽기(같은 모형)
    const { SCENES, CLUES } = await import('./src/script.js');
    const optional = {};
    for (const cl of CLUES) {
      const ch = cl.ch ?? 1;
      if (ch < 2 || L.story.isFound(cl.id)) continue;
      const n = [...(cl.body ?? []), cl.note ?? '', cl.hand ?? ''].join('').length;
      (optional[ch] ??= { n: 0, sec: 0, ids: [] }).n++;
      optional[ch].sec += n / 12 + 2;
      optional[ch].ids.push(cl.id);
    }
    const ch1 = {
      sceneSec: SCENES.filter((s) => !s.ch || s.ch === 1).reduce((t, s) => t + s.lines.reduce((u, l) => u + l.text.length / 42 + 1.2, 0), 0),
      docSec: CLUES.filter((c) => !c.ch || c.ch === 1).reduce((t, c) => t + [...(c.body ?? []), c.note ?? '', c.hand ?? ''].join('').length / 12 + 2, 0),
    };
    return { level, done, ch: M.ch, optional, ch1, stuck: M.stuck, events: M.events, gameMin: +((game.time - M.t0) / 60).toFixed(1) };
  }
  window.__chbot = { run };
}

// ---------------------------------------------------------------- 판 돌리기(판마다 새 브라우저)
const results = [];
let errors = 0;
for (const level of levelsArg.split(',')) {
  for (let rep = 1; rep <= Number(repsArg); rep++) {
    const B = await launch(url, 800, 450);
    for (let i = 0; i < 60; i++) {
      if (await B.ev('return !!(window.lumen && lumen.game.ready)')) break;
      await B.sleep(500);
    }
    const ok = await B.ev(`(${installChapterBot})(${navKit}); return !!window.__chbot;`);
    if (ok !== true) { console.log(`ERR 봇을 넣지 못했다: ${JSON.stringify(ok)}`); errors++; await B.close(); continue; }
    await B.ev(`window.__res = null; window.__err = null;
      __chbot.run({ level: '${level}', maxMin: ${MAX_MIN} }).then((r) => { window.__res = r; }, (e) => { window.__err = String(e?.stack ?? e); });
      return true;`);
    let res = null;
    for (;;) {
      await B.sleep(500);
      const st = await B.ev('return { res: window.__res, err: window.__err }');
      if (st?.err || st?.error) { console.log(`ERR ${level} #${rep}: ${st.err ?? st.error}`); errors++; break; }
      if (st?.res) { res = st.res; break; }
    }
    const consoleErrs = B.logs.filter((l) => /error|exception/i.test(l) && !/caches|online|fetch|CORS|ERR_/i.test(l));
    if (consoleErrs.length) { console.log('콘솔 오류:', consoleErrs.slice(0, 5)); errors++; }
    await B.close();
    if (!res) continue;
    res.rep = rep;
    results.push(res);
    console.log(`${level.padEnd(6)} #${rep} ${res.done} · 게임 ${res.gameMin}분${res.stuck ? ` · 길 다시 찾기 ${res.stuck}` : ''}`);
  }
}

// ---------------------------------------------------------------- 요약
const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const mmss = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '-');
for (const level of levelsArg.split(',')) {
  const rs = results.filter((r) => r.level === level);
  if (!rs.length) continue;
  console.log(`\n[${level}] ${rs.length}판 · 끝까지 ${rs.filter((r) => r.done.startsWith('end:')).length}판 (분:초, 판 평균)`);
  console.log('장   플레이(걷기·누름·기다림)        장면 읽기  기록 읽기  합(하한)  선택 기록   밤   쓰러짐  피격');
  for (const ch of [2, 3, 4]) {
    const cs = rs.map((r) => r.ch[ch]).filter(Boolean);
    if (!cs.length) continue;
    const a = (k) => avg(cs.map((c) => c[k]));
    const opt = avg(rs.map((r) => r.optional[ch]?.sec ?? 0));
    console.log(`${ch}장  ${mmss(a('play')).padStart(5)} (${mmss(a('walk'))}·${mmss(a('hold'))}·${mmss(a('idle'))})`.padEnd(32)
      + `${mmss(a('sceneSec')).padStart(9)}  ${mmss(a('docSec')).padStart(9)}  ${mmss(a('play') + a('sceneSec') + a('docSec')).padStart(8)}  ${('+' + mmss(opt)).padStart(9)}  ${mmss(a('night')).padStart(5)}  ${a('fails').toFixed(1).padStart(5)}  ${a('hits').toFixed(1).padStart(4)}`);
  }
  const c1 = rs[0].ch1;
  console.log(`1장 읽기(같은 모형): 장면 ${mmss(c1.sceneSec)} · 기록 ${mmss(c1.docSec)} — 1장 플레이 시간은 autoplay.mjs`);
}
for (const r of results.filter((x) => !x.done.startsWith('end:'))) {
  const last = r.events.slice(-6).map((e) => `${e.ch}장 ${e.step} ${e.type}${e.label ? ` ${e.label}` : ''} (${e.t}초)`);
  console.log(`\n막힘 ${r.level} #${r.rep}: ${last.join(' → ')}`);
}
if (outPath) {
  writeFileSync(outPath, JSON.stringify(results));
  console.log(`\n결과 JSON: ${outPath}`);
}
process.exit(errors ? 1 : 0);
