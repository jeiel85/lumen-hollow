// 1장 자동 플레이 측정 도구(통과/실패 시험이 아니다): 봇이 새 판을 시작해 엔딩(또는 쓰러짐·날 수 상한)까지 한다.
// 치트 없음: 순간이동·퓨즈 지급·뒤질 곳 내용 엿보기 없이 가상 스틱(input.moveScreen)·E 길게·F·Q·마우스 조준 입력만 쓰고,
// 사람이 화면에서 아는 것(반짝이는 뒤질 곳, 촛불 단서, 꺼진 배전함, 켜진 가로등, 시계)만으로 판단한다.
//   낮: 가장 가까운 뒤질 곳을 뒤지고(촛불 단서는 먼저), 퓨즈가 있으면 가장 가까운 꺼진 배전함에 끼운다. 해 지기 전에
//       켜진 가로등으로 돌아올 시간이 남는 일만 고르고, 남지 않으면 배전반에서 가까운 구역을 켜고 가로등 아래로 간다.
//   밤: 가로등 아래에 서서 손전등으로 그늘이(가장자리에 붙은 것·빛먹이 먼저)를 비춘다. 불이 꺼지면 가까운 켜진 가로등이나
//       내려간 차단기로 간다. 체력 55 이하면 붕대.
// 길찾기는 정적 충돌체를 부풀린 0.4m 격자(src/wardrobe.js ReachMap) 위의 다익스트라라 지도를 다 아는 셈이고, 이야기 장면·기록은
// 건너뛴다(장면 동안은 시간이 멈춰 결과에 영향이 없다). 트럭은 타지 않는다. 그래서 엔딩 날은 사람 플레이의 하한이다.
// 조준 방식: mouse = 목표를 완벽하게 겨눔, touch = 게임의 터치 조준 보조(8m 안 가장 가까운 그늘이), none = 손전등을 쓰지 않음.
// 그리기(post.render)만 끄고(판정·카메라는 그대로) 실제 화면 루프를 멈춰 lumen.step으로만 진행하니 판 하나가 실제 몇 초에 끝난다.
// 시드: 게임 진행(startGame·step) 동안만 Math.random을 시드 난수로 바꿔 마을 배치(뒤질 곳 내용)와 대부분의 진행을 고정한다.
// 지난 판이 남긴 상태가 난수 순서를 바꾸지 않게 판마다 페이지를 새로 열고, 빗방울·소리·음악은 보통 난수를 쓰게 둔다.
// 그래도 실시간 요소가 남아 같은 시드의 밤 결과(피격·차단 수)는 조금씩 다르다 — 한 판이 아니라 여러 판의 분포로 본다.
//   node tests/e2e/autoplay.mjs [url] [난이도(쉼표) 기본 easy,normal,hard] [시드(쉼표, 또는 1-10) 기본 1-5] [조준(쉼표) 기본 mouse,touch,none] [결과 JSON 경로(선택)]
import { writeFileSync } from 'node:fs';
import { launch } from './cdp.mjs';
import { navKit } from './botnav.mjs';

const [,, url = 'http://127.0.0.1:8000/?debug', levelsArg = 'easy,normal,hard', seedsArg = '1-5', aimsArg = 'mouse,touch,none', outPath = null] = process.argv;
const seeds = /^\d+-\d+$/.test(seedsArg)
  ? (([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i))(seedsArg.split('-').map(Number))
  : seedsArg.split(',').map(Number);
const MAX_DAYS = 30;

// ---------------------------------------------------------------- 페이지 안에서 도는 봇(문자열로 넣으므로 바깥 이름을 쓰지 않는다)
function installBot(navKit) {
  const L = window.lumen;
  const { world, player, env, shades, input, game, camera, THREE, car } = L;
  const BOUND = 87, CELL = 0.4, HOUR = 7.5, R = 0.36, VWALK = 4.4, FLASH = 13;
  const n = Math.floor((BOUND * 2) / CELL) + 1;
  let blocked = null;

  // 걸을 수 있는 칸: 정적 충돌체를 플레이어 반지름 + 0.12m로 부풀리고, 세워 둔 트럭 둘레 1.6m도 막는다
  // (트럭 1.3m 안에서 E를 누르면 타 버린다).
  function buildGrid(ReachMap) {
    blocked = new ReachMap(world.colliders, { x: 0, z: 3.2 }, R + 0.12).blocked.slice();
    for (let i = 0; i < n; i++) {
      const x = i * CELL - BOUND;
      if (Math.abs(x - car.pos.x) > 7) continue;
      for (let j = 0; j < n; j++) {
        const z = j * CELL - BOUND;
        if (Math.abs(z - car.pos.z) <= 7 && car.distanceTo(x, z) < 1.6) blocked[i * n + j] = 1;
      }
    }
    ({ idxOf, kx, kz, freeNear, dijkstra, pathTo } = navKit({ x0: -BOUND, z0: -BOUND, nx: n, nz: n, cell: CELL, blocked }));
  }
  // 격자 계산·길찾기는 botnav.mjs navKit(격자를 만든 뒤 채운다)
  let idxOf, kx, kz, freeNear, dijkstra, pathTo;

  // ------------------------------------------------------------ 상태·기록
  let M = null;
  const log = (type, extra = {}) => M.events.push({ t: +(game.time - M.t0).toFixed(1), day: env.day, h: +env.hour.toFixed(2), type, ...extra });
  let task = null; // { type: loot|fuse|breaker|shelter, ref, spot, dur, goal, route, phase: go|hold|stay, mode: day|night }
  let fieldP = null, fieldPAt = null;
  let shelterCache = { key: '' };
  let spawnHour = 18.8;
  const failed = new Set();
  let lastHp = 100;
  const tripState = {};
  let AIM = 'mouse';
  // 실제 화면 루프(main.js loop)를 멈춘다: 봇이 잠깐 양보하는 사이 실시간 프레임이 끼어들어 판이 갈리지 않게.
  window.requestAnimationFrame = () => 0;
  // 옷가지 꾸러미(외형만)는 놓지 않는다: 주운 옷이 이 브라우저에 남아 다음 판의 꾸러미 고르기(난수 순서)를 바꾼다.
  L.drops.spawn = () => false;

  const zoneLit = (id) => { const z = world.zones[id]; return z.powered && z.on && !z.tripped; };
  const lampsOf = (pred) => world.lamps.filter((l) => pred(l.zone));
  const standOf = (l) => (l._botStand ??= freeNear(l.x, l.z, 1.6));
  // 켜진 가로등들에서 퍼진 장(해 지기 전에 돌아올 수 있는지 재는 데 쓴다)
  function shelterField() {
    const ls = lampsOf(zoneLit);
    const key = ls.map((l) => world.lamps.indexOf(l)).join(',');
    if (shelterCache.key !== key) shelterCache = { key, field: dijkstra(ls.map(standOf).filter((k) => k >= 0)), lamps: ls };
    return shelterCache;
  }
  function playerField(force = false) {
    const k = idxOf(player.pos.x, player.pos.z);
    const s = k >= 0 && !blocked[k] ? k : freeNear(player.pos.x, player.pos.z, 2);
    if (force || !fieldP || fieldPAt !== s) { fieldP = dijkstra([s]); fieldPAt = s; }
    return fieldP;
  }

  // ------------------------------------------------------------ 입력
  let move = { x: 0, y: 0 };
  input.moveScreen = () => move;
  const tmpV = new THREE.Vector3();
  function aimAt(x, z) {
    if (AIM !== 'mouse') { input.usingTouch = AIM === 'touch'; input.mouse.active = false; return; }
    // 조준 평면(플레이어 키 0.9m) 위의 목표를 화면에 투영해 마우스 자리로 둔다 → 게임의 광선 조준이 정확히 그 점을 맞힌다
    tmpV.set(x, player.pos.y + 0.9, z).project(camera);
    input.usingTouch = false;
    input.mouse.active = true;
    input.mouse.x = tmpV.x;
    input.mouse.y = tmpV.y;
  }
  function setFlash(on) {
    if (on && (player.battery <= 1 || AIM === 'none')) on = false;
    if (player.flashOn !== on) input.pressed.add('KeyF');
  }
  // 화면 축 R=(1,0,−1)/√2, D=(1,0,1)/√2(main.js SCREEN_RIGHT·SCREEN_DOWN)로 세상 방향을 스틱 값으로 바꾼다
  function steerTo(x, z, slow = 0) {
    let dx = x - player.pos.x, dz = z - player.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) { move = { x: 0, y: 0 }; return; }
    dx /= d; dz /= d;
    const m = slow ? Math.min(1, Math.max(0.35, d / slow)) : 1;
    move = { x: ((dx - dz) / Math.SQRT2) * m, y: ((dx + dz) / Math.SQRT2) * m };
  }
  // 길을 따라 걷는다. 'arrived' | 'fail'(4번 막힘) | null
  function follow(t, dt) {
    const r = t.route;
    while (r.length && Math.hypot(r[0].x - player.pos.x, r[0].z - player.pos.z) < 0.5) r.shift();
    const tgt = r[0] ?? t.spot;
    steerTo(tgt.x, tgt.z, r.length <= 1 ? 1.2 : 0);
    t.stuckT += dt;
    if (t.stuckT > 2) {
      const moved = Math.hypot(player.pos.x - t.lastPos.x, player.pos.z - t.lastPos.z);
      t.stuckT = 0;
      t.lastPos = { x: player.pos.x, z: player.pos.z };
      if (moved < 0.6) {
        t.stucks = (t.stucks ?? 0) + 1;
        M.stuck++;
        if (t.stucks >= 4) return 'fail';
        const f = playerField(true);
        if (Number.isFinite(f.dist[t.goal])) t.route = pathTo(f, t.goal);
      }
    }
    return !r.length && Math.hypot(t.spot.x - player.pos.x, t.spot.z - player.pos.z) < 0.45 ? 'arrived' : null;
  }
  const newTask = (type, ref, spot, dur, goal, field) =>
    ({ type, ref, spot, dur, goal, route: pathTo(field, goal), phase: 'go', stuckT: 0, lastPos: { x: player.pos.x, z: player.pos.z } });

  // 겨눌 그늘이: 손전등이 닿고 건물에 가리지 않은 것 가운데 빛먹이, 가로등 가장자리에 붙은 것, 가까운 것 순
  function pickTarget(lamp) {
    let best = null, bs = Infinity;
    for (const s of shades.list) {
      if (!s.active || s.state !== 'stalk') continue;
      const d = Math.hypot(s.x - player.pos.x, s.z - player.pos.z);
      if (d > FLASH - 0.5 || world.blocksSight(player.pos.x, player.pos.z, s.x, s.z)) continue;
      const pressing = lamp && Math.hypot(s.x - lamp.x, s.z - lamp.z) < 6.3;
      const score = d - (pressing ? 6 : 0) - (s.kind === 'eater' ? 8 : 0);
      if (score < bs) { bs = score; best = s; }
    }
    return best;
  }

  // ------------------------------------------------------------ 결정
  // 그늘이가 깨어날 무렵(밤 0.75)부터 새벽에 다 사라질 때까지는 밤으로 친다
  const isNight = () => shades.list.some((s) => s.active && s.state !== 'die') || env.hour >= spawnHour - 0.05 || env.hour < 5.5;

  function chooseDay() {
    const fP = playerField(true);
    const sh = shelterField();
    const cands = [];
    if (player.fuses > 0) {
      for (const b of world.fuseBoxes) if (!world.zones[b.zone].powered) cands.push({ type: 'fuse', ref: b, spot: { x: b.ix, z: b.iz }, dur: 1.6, w: 0.3 });
    }
    for (const l of world.loot) {
      if (!l.searched && !failed.has(l)) cands.push({ type: 'loot', ref: l, spot: { x: l.x, z: l.z }, dur: 1.0, w: l.hinted ? 0.35 : 1 });
    }
    let best = null, bs = Infinity;
    for (const c of cands) {
      const g = freeNear(c.spot.x, c.spot.z, c.type === 'fuse' ? 1.2 : 1.3, (k) => Number.isFinite(fP.dist[k]));
      if (g < 0) { if (c.type === 'loot') { failed.add(c.ref); M.unreachable++; } continue; }
      const go = fP.dist[g], back = sh.field.dist[g];
      // 가서 하고, 가장 가까운 켜진 가로등까지 돌아올 시간(여유 5초)이 그늘이가 깨어나기 전에 남는 일만
      const need = (go + (Number.isFinite(back) ? back : 999)) / VWALK + c.dur + 5;
      if (env.hour + need / HOUR > spawnHour - 0.12) continue;
      if (go * c.w < bs) { bs = go * c.w; best = { ...c, goal: g }; }
    }
    return best ? newTask(best.type, best.ref, best.spot, best.dur, best.goal, fP) : chooseShelter(true);
  }

  // 가장 가까운 피난 가로등. 낮이면 배전반에서 가장 가까운 고친 구역이 꺼져 있을 때 가장 먼 켜진 구역과 바꿔 켠다
  // (낮에는 배전반을 여는 동안 시간이 멈추므로 화면을 거치지 않고 같은 world.setSwitch를 부른다).
  function chooseShelter(day) {
    const fP = playerField();
    if (day) {
      let near = null, nd = Infinity;
      for (const l of lampsOf((id) => world.zones[id].powered)) {
        const k = standOf(l);
        if (k >= 0 && fP.dist[k] < nd) { nd = fP.dist[k]; near = l; }
      }
      if (near && near.zone !== 'H' && !world.zones[near.zone].on) {
        let far = null, fd = -1;
        for (const z of Object.values(world.zones)) {
          if (z.id === 'H' || !z.powered || !z.on) continue;
          let d = Infinity;
          for (const l of lampsOf((id) => id === z.id)) { const k = standOf(l); if (k >= 0) d = Math.min(d, fP.dist[k]); }
          if (d > fd) { fd = d; far = z; }
        }
        if (world.onCount >= world.capacity && far) world.setSwitch(far.id, false);
        if (world.setSwitch(near.zone, true)) { M.switches++; log('switch', { on: near.zone, off: far?.id ?? null }); }
      }
    }
    let best = null, bd = Infinity;
    for (const l of shelterField().lamps) {
      const k = standOf(l);
      if (k >= 0 && fP.dist[k] < bd) { bd = fP.dist[k]; best = l; }
    }
    return best ? newTask('shelter', best, { x: kx(standOf(best)), z: kz(standOf(best)) }, 0, standOf(best), fP) : null;
  }

  // 밤: 가까운 켜진 가로등, 아니면(8m 덜 가까우면) 내려간 차단기
  function chooseNight() {
    const fP = playerField(true);
    let best = null, bs = Infinity;
    for (const l of lampsOf(zoneLit)) {
      const k = standOf(l);
      if (k >= 0 && fP.dist[k] < bs) { bs = fP.dist[k]; best = { type: 'shelter', ref: l, goal: k, spot: { x: kx(k), z: kz(k) }, dur: 0 }; }
    }
    for (const z of Object.values(world.zones)) {
      if (!z.powered || !z.on || !z.tripped) continue;
      const b = world.breakerOf(z.id);
      const g = b ? freeNear(b.ix, b.iz, 1.2, (k) => Number.isFinite(fP.dist[k])) : -1;
      if (g >= 0 && fP.dist[g] + 8 < bs) { bs = fP.dist[g] + 8; best = { type: 'breaker', ref: b, goal: g, spot: { x: b.ix, z: b.iz }, dur: 1.2 }; }
    }
    return best ? newTask(best.type, best.ref, best.spot, best.dur, best.goal, fP) : null;
  }

  const done = (t) => (t.type === 'loot' ? t.ref.searched : t.type === 'fuse' ? world.zones[t.ref.zone].powered : t.type === 'breaker' ? !world.zones[t.ref.zone].tripped : false);

  // ------------------------------------------------------------ 0.1초마다 한 번 판단
  function tick(dt) {
    const night = isNight();
    if (task && task.mode !== (night ? 'night' : 'day')) { input.keys.delete('KeyE'); task = null; }
    if (task && task.type === 'shelter' && night && !zoneLit(task.ref.zone)) task = null;
    if (task && task.type !== 'shelter' && done(task)) { input.keys.delete('KeyE'); task = null; }
    if (!task) {
      task = night ? chooseNight() : chooseDay();
      if (task) task.mode = night ? 'night' : 'day';
    }
    if (player.hp <= 55 && player.bandages > 0) { input.pressed.add('KeyQ'); M.bandagesUsed++; log('bandage', { hp: Math.round(player.hp) }); }
    if (!task) { move = { x: 0, y: 0 }; return; }
    const tgt = night ? pickTarget(task.type === 'shelter' ? task.ref : null) : null;

    if (task.phase === 'go') {
      const r = follow(task, dt);
      if (r === 'fail') {
        if (task.type === 'loot') { failed.add(task.ref); M.unreachable++; }
        log('fail', { what: task.type });
        task = null;
        move = { x: 0, y: 0 };
        return;
      }
      if (task.type !== 'shelter') {
        // 손이 닿는 상호작용 대상이 이 일이면 바로 누른다
        const ni = world.nearestInteractable(player.pos.x, player.pos.z, 1.8);
        const left = Math.hypot(task.spot.x - player.pos.x, task.spot.z - player.pos.z);
        if ((ni && ni.ref === task.ref && (left < 1.1 || !task.route.length)) || r === 'arrived') { task.phase = 'hold'; task.holdT = 0; }
      } else if (r === 'arrived') task.phase = 'stay';
      if (night) {
        setFlash(true);
        const p = tgt ?? task.route[0] ?? task.spot;
        aimAt(p.x, p.z);
      } else setFlash(false);
      return;
    }
    if (task.phase === 'hold') {
      move = { x: 0, y: 0 };
      input.keys.add('KeyE');
      task.holdT += dt;
      if (night) { setFlash(!!tgt); if (tgt) aimAt(tgt.x, tgt.z); }
      if (task.holdT > task.dur + 1.6) {
        input.keys.delete('KeyE');
        if (!done(task)) {
          if (task.type === 'loot') { failed.add(task.ref); M.unreachable++; }
          log('holdfail', { what: task.type });
        }
        task = null;
      }
      return;
    }
    // stay: 가로등 아래에 선다(밀려났으면 돌아간다)
    if (Math.hypot(task.spot.x - player.pos.x, task.spot.z - player.pos.z) > 0.8) steerTo(task.spot.x, task.spot.z, 1);
    else move = { x: 0, y: 0 };
    if (!night) {
      setFlash(false);
      // 해질녘을 기다리는 중이면 3초마다 다시 일거리를 찾는다
      task.stayT = (task.stayT ?? 0) + dt;
      if (task.stayT > 3 && env.hour < spawnHour - 0.6 && env.hour > 5.5) task = null;
      return;
    }
    setFlash(!!tgt);
    if (tgt) aimAt(tgt.x, tgt.z);
  }

  function record(dt) {
    const hp = player.hp;
    const nr = M.nightRec;
    if (hp < lastHp - 0.01) {
      M.hits++;
      M.dmg += lastHp - hp;
      if (nr) { nr.hits++; nr.dmg += lastHp - hp; }
      log('hit', { hp: Math.round(hp), lit: !!world.lightAt(player.pos.x, player.pos.z), task: task?.type ?? null, phase: task?.phase ?? null });
    }
    M.minHp = Math.min(M.minHp, hp);
    if (nr) nr.minHp = Math.min(nr.minHp, hp);
    lastHp = hp;
    for (const z of Object.values(world.zones)) {
      if (z.tripped && !tripState[z.id]) { M.trips++; nr?.trips.push(z.id); log('trip', { zone: z.id }); }
      tripState[z.id] = z.tripped;
    }
    const nightNow = env.night > 0.75 || shades.list.some((s) => s.active && s.state !== 'die');
    if (nightNow && !M.nightRec) {
      M.nightRec = { n: game.nights + 1, day: env.day, event: game.nightEvent, hits: 0, dmg: 0, minHp: hp, trips: [], darkSec: 0, banished: shades.banished, bandages: M.bandagesUsed };
    }
    if (M.nightRec) {
      const r = M.nightRec;
      if (env.night > 0.75 && !world.lightAt(player.pos.x, player.pos.z)) r.darkSec += dt;
      if (!nightNow) M.nights.push(closeNight(r));
    }
  }
  function closeNight(r) {
    M.nightRec = null;
    return { ...r, banished: shades.banished - r.banished, bandages: M.bandagesUsed - r.bandages, darkSec: +r.darkSec.toFixed(1), dmg: Math.round(r.dmg), minHp: Math.round(r.minHp) };
  }

  // ------------------------------------------------------------ 판 하나
  async function run({ level = 'normal', aim = 'mouse', seed = 1, maxDays = 30, tick: TICK = 0.1, dt: DT = 1 / 30 } = {}) {
    AIM = aim;
    // 게임 진행 동안만 시드 난수(mulberry32)
    const nativeRandom = Math.random;
    let rs = seed >>> 0;
    let inGame = false;
    Math.random = () => {
      if (!inGame) return nativeRandom();
      rs = (rs + 0x6D2B79F5) >>> 0;
      let t = rs;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const game1 = (fn) => { inGame = true; try { fn(); } finally { inGame = false; } };
    // 빗방울(env.update)·소리·음악은 진행 중에도 보통 난수를 쓴다: 빗방울은 처음 화면에서 실시간으로 흐른 상태를, 소리는
    // AudioContext 상태(비동기)를 따라 난수를 쓰는 횟수가 달라 판정용 난수 순서를 흐트러뜨린다.
    const outside = (obj) => {
      for (let p = obj; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
        for (const name of Object.getOwnPropertyNames(p)) {
          const f = Object.getOwnPropertyDescriptor(p, name)?.value;
          if (name === 'constructor' || typeof f !== 'function' || Object.hasOwn(obj, name)) continue;
          obj[name] = function (...args) { const was = inGame; inGame = false; try { return f.apply(this, args); } finally { inGame = was; } };
        }
      }
    };
    outside(L.sound);
    outside(L.sound.music);
    const envUpdate = env.update;
    env.update = function (...args) { const was = inGame; inGame = false; try { return envUpdate.apply(this, args); } finally { inGame = was; } };
    const step = (sec) => game1(() => L.step(sec, DT));
    input.usingTouch = aim === 'touch';
    input.mouse.active = false;
    const { ReachMap } = await import('./src/wardrobe.js');
    L.story.scenesFor = () => [];
    L.story.nearest = () => null;
    L.settings.difficulty = level;
    game1(() => L.startGame());
    step(0.2);
    if (!blocked) buildGrid(ReachMap);
    for (let h = 17.8; h < 20; h += 0.01) { // env.js nightAmount가 0.75를 넘는 시각(shades: spawning)
      const t = Math.min(1, (h - 17.8) / 1.5);
      if (t * t * (3 - 2 * t) > 0.75) { spawnHour = h; break; }
    }
    M = { t0: game.time, events: [], nights: [], hits: 0, dmg: 0, minHp: 100, bandagesUsed: 0, trips: 0, stuck: 0, unreachable: 0, switches: 0, found: {}, nightRec: null };
    const searched0 = world.markSearched;
    const power0 = world.powerZone;
    world.markSearched = (l) => { M.found[l.item] = (M.found[l.item] ?? 0) + 1; log('loot', { item: l.item, hinted: !!l.hinted }); return searched0.call(world, l); };
    world.powerZone = (id) => { const r = power0.call(world, id); log('repair', { zone: id, on: !!r?.on }); return r; };
    task = null;
    failed.clear();
    lastHp = player.hp;
    fieldP = null;
    shelterCache = { key: '' };
    const wall0 = performance.now();
    try {
      for (let ticks = 1; game.state !== 'end' && env.day <= maxDays; ticks++) {
        if (game.state !== 'play') {
          if (L.dialogue.docOpen) L.dialogue.closeDoc();
          if (L.dialogue.scene) L.dialogue.skip();
          if (game.state === 'pause') L.pauseGame(false);
          if (game.state === 'grid') L.closeGrid();
          step(0.1);
          continue;
        }
        tick(TICK);
        step(TICK);
        record(TICK);
        if (ticks % 150 === 0) await new Promise((r) => setTimeout(r, 0));
      }
    } finally {
      Math.random = nativeRandom;
      input.keys.delete('KeyE');
      delete world.markSearched;
      delete world.powerZone;
    }
    if (M.nightRec) M.nights.push({ ...closeNight(M.nightRec), unfinished: true });
    return {
      level, aim, won: !!game.won, timeout: game.state !== 'end',
      day: env.day, hour: +env.hour.toFixed(2), nightsSurvived: game.nights, zones: world.poweredZones,
      fusesHeld: player.fuses, hits: M.hits, dmg: Math.round(M.dmg), minHp: Math.round(M.minHp),
      bandagesUsed: M.bandagesUsed, bandagesLeft: player.bandages, banished: shades.banished, trips: M.trips, switches: M.switches,
      searched: world.loot.filter((l) => l.searched).length, lootTotal: world.loot.length, found: M.found,
      unreachable: M.unreachable, stuck: M.stuck, gameSec: Math.round(game.time - M.t0), wallSec: +((performance.now() - wall0) / 1000).toFixed(1),
      endTitle: document.getElementById('end-title')?.textContent ?? null, nights: M.nights, events: M.events,
    };
  }

  window.__bot = { run };
}

// ---------------------------------------------------------------- 판 돌리기(브라우저 하나로, 판마다 페이지를 새로 연다)
const B = await launch(url, 800, 450);
async function open(reload) {
  if (reload) await B.send('Page.reload');
  await B.sleep(300);
  for (let i = 0; i < 60; i++) {
    // 새로 연 페이지에는 아직 봇이 없다(옛 페이지에 넣지 않게)
    if (await B.ev('return !!(window.lumen && lumen.game.ready && !window.__bot)')) break;
    await B.sleep(500);
  }
  const ok = await B.ev(`lumen.post.render = () => {}; (${installBot})(${navKit}); return !!window.__bot;`);
  if (ok !== true) throw new Error(`봇을 넣지 못했다: ${JSON.stringify(ok)}`);
}
const results = [];
let errors = 0;
let first = true;
for (const aim of aimsArg.split(',')) {
  for (const level of levelsArg.split(',')) {
    for (const seed of seeds) {
      await open(!first);
      first = false;
      await B.ev(`
        window.__res = null; window.__err = null;
        window.__bot.run({ level: '${level}', aim: '${aim}', seed: ${seed >>> 0}, maxDays: ${MAX_DAYS} }).then((r) => { window.__res = r; }, (e) => { window.__err = String(e?.stack ?? e); });
        return true;`);
      let res = null;
      for (;;) {
        await B.sleep(500);
        const st = await B.ev('return { res: window.__res, err: window.__err }');
        if (st?.err || st?.error) { console.log(`ERR ${aim} ${level} #${seed}: ${st.err ?? st.error}`); errors++; break; }
        if (st?.res) { res = st.res; break; }
      }
      if (!res) continue;
      res.seed = seed;
      results.push(res);
      const tag = res.won ? 'WIN ' : res.timeout ? 'TIME' : 'DEAD';
      console.log(`${aim.padEnd(5)} ${level.padEnd(6)} #${String(seed).padStart(2)} ${tag} ${res.day}일 ${Math.floor(res.hour)}시 · 밤 ${res.nightsSurvived} · 구역 ${res.zones}/9 · 피격 ${res.hits} · 최저 체력 ${res.minHp} · 붕대 ${res.bandagesUsed} · 차단 ${res.trips} · 뒤짐 ${res.searched}/${res.lootTotal}${res.stuck ? ` · 막힘 ${res.stuck}` : ''}${res.unreachable ? ` · 못 닿음 ${res.unreachable}` : ''} (${res.wallSec}초)`);
    }
  }
}
const consoleErrs = B.logs.filter((l) => /error|exception/i.test(l) && !/caches|online|fetch|CORS|ERR_/i.test(l));
await B.close();

// ---------------------------------------------------------------- 요약
const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const med = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[(b.length - 1) >> 1] : NaN; };
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '-');
const when = (v) => (Number.isFinite(v) ? `${Math.floor(v)}일 ${String(Math.floor((v % 1) * 24)).padStart(2)}시` : '-');
const groups = new Map();
for (const r of results) {
  const k = `${r.aim}/${r.level}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}
console.log('\n조준/난이도      판  엔딩 쓰러짐  엔딩(중앙값)  (가장 빠름~늦음)        버틴 밤  게임 분  피격  최저 체력  붕대  차단  밤 어둠(초)  돌려보냄  촛불 퓨즈/찾은 퓨즈  뒤짐');
for (const [k, g] of groups) {
  const wins = g.filter((r) => r.won);
  const wd = wins.map((r) => r.day + r.hour / 24);
  const fuseFinds = (r, hinted) => r.events.filter((e) => e.type === 'loot' && e.item === 'fuse' && (!hinted || e.hinted)).length;
  console.log([
    k.padEnd(15), String(g.length).padStart(3), String(wins.length).padStart(5), String(g.filter((r) => !r.won && !r.timeout).length).padStart(6),
    `  ${when(med(wd))}  (${when(Math.min(...wd))} ~ ${when(Math.max(...wd))})`.padEnd(33),
    f1(avg(g.map((r) => r.nightsSurvived))).padStart(7), f1(avg(g.map((r) => r.gameSec / 60))).padStart(8),
    f1(avg(g.map((r) => r.hits))).padStart(5), f1(avg(g.map((r) => r.minHp))).padStart(10), f1(avg(g.map((r) => r.bandagesUsed))).padStart(5),
    f1(avg(g.map((r) => r.trips))).padStart(5), f1(avg(g.flatMap((r) => r.nights.map((x) => x.darkSec)))).padStart(12),
    f1(avg(g.map((r) => r.banished))).padStart(9), `${f1(avg(g.map((r) => fuseFinds(r, true))))}/${f1(avg(g.map((r) => fuseFinds(r, false))))}`.padStart(19),
    f1(avg(g.map((r) => r.searched))).padStart(6),
  ].join(''));
}
console.log('\n밤 번호별 평균 피격(그 밤까지 간 판 수):');
for (const [k, g] of groups) {
  const by = {};
  for (const r of g) for (const x of r.nights) (by[x.n] ??= []).push(x.hits);
  console.log(`  ${k.padEnd(14)} ${Object.entries(by).map(([i, a]) => `${i}밤 ${f1(avg(a))}(${a.length})`).join('  ')}`);
}
console.log('\n날마다 고친 배전함(누적 평균):');
for (const [k, g] of groups) {
  const per = {};
  for (const r of g) {
    const by = {};
    let c = 0;
    for (const e of r.events) if (e.type === 'repair') by[e.day] = ++c;
    let last = 0;
    for (let d = 1; d <= 5; d++) (per[d] ??= []).push((last = by[d] ?? last));
  }
  console.log(`  ${k.padEnd(14)} ${Object.entries(per).map(([d, a]) => `${d}일 ${f1(avg(a))}`).join('  ')}`);
}
for (const r of results.filter((x) => !x.won)) {
  console.log(`\n${r.timeout ? '날 수 상한' : '쓰러짐'} ${r.aim}/${r.level} #${r.seed}: ${r.day}일 ${Math.floor(r.hour)}시, 구역 ${r.zones}/9, 붕대 ${r.bandagesUsed}(남음 ${r.bandagesLeft}), 차단 ${r.trips}`);
  console.log(`  밤: ${r.nights.map((x) => `${x.n}밤(${x.event ?? '-'}) 피격 ${x.hits} 최저 ${x.minHp} 차단 [${x.trips}] 어둠 ${x.darkSec}초`).join(' | ')}`);
  const hits = r.events.filter((e) => e.type === 'hit').slice(-4);
  console.log(`  마지막 피격: ${hits.map((e) => `${e.day}일 ${e.h}시 체력 ${e.hp} ${e.lit ? '빛 안' : '어둠'} ${e.task ?? '-'}/${e.phase ?? '-'}`).join(' · ')}`);
}
if (outPath) {
  writeFileSync(outPath, JSON.stringify(results));
  console.log(`\n결과 JSON: ${outPath}`);
}
if (consoleErrs.length) console.log('\n콘솔 오류:', consoleErrs.slice(0, 5));
process.exit(errors || consoleErrs.length ? 1 : 0);
