// 트럭(#6): 실제 게임 흐름(E 길게 누르기 → interact, 운전 입력 → drive)으로 연료통 붓기, 내리기(트인 곳·막힌 곳),
// 좁은 골목에서 핸들을 꺾은 채 가속, 울타리 들이받기를 60fps·20fps 간격으로 본다.
//   node tests/e2e/truck.mjs [url]
// 차 물리 자체(관통·골목 멈춤·내릴 자리·붓기 규칙)는 tests/node/vehicle.test.mjs가 더 많은 경우로 본다.
import { launch } from './cdp.mjs';

const [,, url = 'http://127.0.0.1:8000/?debug'] = process.argv;
const B = await launch(url, 960, 540);
for (let i = 0; i < 60; i++) {
  if (await B.ev('return !!(window.lumen && lumen.game.ready)')) break;
  await B.sleep(500);
}
const ok = [];
const check = (n, c, i) => { ok.push(!!c); console.log(`${c ? 'OK ' : 'NG '} ${n}${i !== undefined ? ` — ${JSON.stringify(i)}` : ''}`); };
const CH1 = ['arrival', 'dusk', 'dawn', 'light1', 'shadows', 'return', 'founders', 'lookout', 'promise', 'line', 'last', 'finale'];

const HELP = `
  const L = lumen, car = L.car, world = L.world, game = L.game;
  const toasts = () => [...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent);
  const prompt = () => document.getElementById('prompt-text').textContent;
  // 낮 12시, 체력 가득으로 되돌린다(시험 사이에 밤이 와서 그늘이에게 쓰러지지 않게).
  const noon = () => { L.env.setHour(12); L.player.hp = 100; L.shades.clear(); L.hud.clearToasts(); };
  const holdE = (sec, dt = 1 / 60) => { L.input.keys.add('KeyE'); L.step(sec, dt); L.input.keys.delete('KeyE'); L.step(0.1, dt); };
  // 트럭 운전석 문 앞에 플레이어를 세운다.
  const toDoor = () => { const s = Math.sin(car.a), c = Math.cos(car.a); const x = car.pos.x + 1.6 * c, z = car.pos.z - 1.6 * s; L.player.pos.set(x, world.heightAt(x, z), z); L.step(0.1, 1 / 60); };
  window.ctl = window.ctl ?? { thr: 0, steer: 0, on: false };
  if (!L.input._driveKeys) { L.input._driveKeys = L.input.driveKeys.bind(L.input); L.input.driveKeys = () => (ctl.on ? { thr: ctl.thr, steer: ctl.steer, any: true } : L.input._driveKeys()); }
  const addWalls = (boxes) => boxes.map(([x0, x1, z0, z1]) => { const b = { t: 0, x0, x1, z0, z1 }; world.colliders.push(b); return b; });
  const dropWalls = (bs) => { for (const b of bs) world.colliders.splice(world.colliders.indexOf(b), 1); };
`;

await B.ev(`for (const id of ${JSON.stringify(CH1)}) lumen.story.markSeen(id); lumen.startGame(); lumen.step(0.3); return true;`);

// 1. 연료통 붓기: 연료 50%·통 3개 → 한 통만(90%), 연료 70%·통 2개 → 붓지 않고 알림
let r = await B.ev(`${HELP}
  noon();
  car.fuel = 50; L.player.cans = 3; toDoor();
  const p1 = prompt();
  holdE(0.8);
  const a = { driving: game.driving, fuel: Math.round(car.fuel), cans: L.player.cans, toast: toasts().find((t) => t.includes('연료통')) ?? null, prompt: p1 };
  holdE(0.6); // 내리기
  car.fuel = 70; L.player.cans = 2; toDoor();
  const p2 = prompt();
  holdE(0.8);
  const b = { driving: game.driving, fuel: Math.round(car.fuel), cans: L.player.cans, prompt: p2 };
  holdE(0.6);
  return { a, b };`);
check('연료 50%·통 3개: 한 통만 부어 90%, 남은 통 2개(넘쳐 버리지 않음)', r.a.driving && r.a.fuel === 90 && r.a.cans === 2 && r.a.prompt.includes('연료통 1개 붓기') && r.a.toast?.includes('1개'), r.a);
check('연료 70%·통 2개: 붓지 않고 프롬프트로 알림', r.b.driving && r.b.fuel === 70 && r.b.cans === 2 && r.b.prompt.includes('아껴 둔다'), r.b);

// 2. 내리기: 트인 곳은 운전석 문 앞, 사방이 막힌 곳은 거절하고 그대로 운전석
r = await B.ev(`${HELP}
  noon();
  const X0 = 48, Z = -24;
  car.reset(X0, Z, 0, 60); L.player.cans = 0; toDoor(); holdE(0.8);
  const seated = game.driving;
  holdE(0.6);
  const open = { driving: game.driving, dist: +car.distanceTo(L.player.pos.x, L.player.pos.z).toFixed(2), x: +(L.player.pos.x - X0).toFixed(2) };
  toDoor(); holdE(0.8);
  const walls = addWalls([[X0 - 1.65, X0 - 1.15, Z - 3, Z + 3], [X0 + 1.15, X0 + 1.65, Z - 3, Z + 3], [X0 - 2, X0 + 2, Z + 2.35, Z + 2.85], [X0 - 2, X0 + 2, Z - 2.85, Z - 2.35]]);
  L.hud.clearToasts();
  holdE(0.6);
  const boxed = { driving: game.driving, toast: toasts().find((t) => t.includes('막혀')) ?? null };
  dropWalls(walls);
  holdE(0.6);
  return { seated, open, boxed, after: game.driving };`);
check('트인 곳: 운전석(왼쪽) 문 앞에 내리고 차체와 겹치지 않음', r.seated && !r.open.driving && r.open.dist >= 0.36 && r.open.x > 1.5, r.open);
check('사방이 막힌 곳: 내리지 않고 "문 앞이 막혀" 알림, 벽을 치우면 내림', r.boxed.driving && r.boxed.toast && !r.after, r);

// 3. 좁은 골목(폭 2.2m)에서 핸들을 끝까지 꺾은 채 가속: 60fps·20fps 모두 멈추지 않고 빠져나감
r = await B.ev(`${HELP}
  const X0 = 48, G = 1.1;
  const walls = addWalls([[X0 - G - 0.5, X0 - G, -30, -18], [X0 + G, X0 + G + 0.5, -30, -18]]);
  const out = [];
  for (const dt of [1 / 60, 1 / 20]) {
    for (const steer of [1, -1]) {
      noon();
      car.reset(X0, -27, 0, 100); L.player.pos.copy(car.pos); toDoor(); holdE(0.8);
      ctl.on = true; ctl.thr = 1; ctl.steer = steer;
      let still = 0;
      for (let i = 0; i < Math.round(4 / dt) && car.pos.z < -15.85; i++) {
        const px = car.pos.x, pz = car.pos.z;
        L.step(dt, dt);
        if (Math.hypot(car.pos.x - px, car.pos.z - pz) < 1e-3) still++;
      }
      ctl.on = false;
      out.push({ dt: dt < 0.03 ? 60 : 20, steer, z: +car.pos.z.toFixed(2), stillSec: +(still * dt).toFixed(2), state: game.state });
      car.vel.set(0, 0, 0); L.step(0.1, 1 / 60); holdE(0.6);
    }
  }
  dropWalls(walls);
  return out;`);
check('좁은 골목: 핸들을 꺾은 채 가속해도 멈추지 않고 빠져나감(60·20fps)', r.every((o) => o.z >= -15.85 && o.stillSec < 0.2 && o.state === 'play'), r);

// 4. 울타리 정면 들이받기(30m/s): 뚫지 않고 이쪽에 남음
r = await B.ev(`${HELP}
  const fences = world.colliders.filter((c) => c.t === 0 && Math.min(c.x1 - c.x0, c.z1 - c.z0) < 0.2 && Math.max(c.x1 - c.x0, c.z1 - c.z0) > 4 && Math.abs(c.x0) < 80 && Math.abs(c.z0) < 80);
  const out = [];
  for (const f of fences.slice(0, 4)) {
    for (const dt of [1 / 60, 1 / 20]) {
      noon();
      const thinX = f.x1 - f.x0 < f.z1 - f.z0;
      const cx = (f.x0 + f.x1) / 2, cz = (f.z0 + f.z1) / 2;
      for (const side of [1, -1]) {
        const nx = thinX ? side : 0, nz = thinX ? 0 : side;
        const a = Math.atan2(-nx, -nz);
        car.reset(cx + nx * 3.4, cz + nz * 3.4, a, 100);
        // 출발 자리가 다른 충돌체에 걸리면 반대쪽에서
        const r0 = car._resolve(world);
        if (!r0.ok || Math.hypot(r0.x, r0.z) > 1e-9 || Math.abs(car.pos.x) > 84 || Math.abs(car.pos.z) > 84) continue;
        L.player.pos.copy(car.pos); toDoor(); holdE(0.8);
        if (!game.driving) continue;
        car.reset(cx + nx * 3.4, cz + nz * 3.4, a, 100); car.occupied = true;
        car.vel.set(Math.sin(a) * 30, 0, Math.cos(a) * 30);
        ctl.on = true; ctl.thr = 1; ctl.steer = 0;
        L.step(0.8, dt);
        ctl.on = false;
        out.push({ dt: dt < 0.03 ? 60 : 20, side: +(((car.pos.x - cx) * nx + (car.pos.z - cz) * nz)).toFixed(2) });
        car.vel.set(0, 0, 0); L.step(0.1, 1 / 60); holdE(0.6);
        break;
      }
    }
  }
  return out;`);
check('울타리(0.16m) 정면 30m/s 들이받기: 뚫지 않음(60·20fps)', r.length >= 4 && r.every((o) => o.side > 0), r);

const errs = B.logs.filter((l) => /error|exception/i.test(l) && !/caches|online|fetch|CORS|ERR_/i.test(l));
check('콘솔 오류 없음', errs.length === 0, errs);
console.log(`\n${ok.filter(Boolean).length}/${ok.length} 통과`);
B.close();
process.exit(ok.every(Boolean) ? 0 : 1);
