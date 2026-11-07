// 밤 규칙(#14·#21·#28): 그늘이는 벽을 지나지 않고, 손전등은 건물 너머를 태우지 않으며, 건물 안에서 깨어나지 않는다.
// 새로 켜진 빛 안의 그늘이는 밀려나거나 탄다. 촛불 단서는 구역에 고르게 퍼진다. 깊은 밤에는 등 뒤에서도 깨어난다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, load } from './env.mjs';

const { scene, world } = await makeGame();
const { Shades } = await load('src/shades.js');
const { LAMP_RADIUS } = await load('src/world.js');

// 손전등을 든 플레이어 대역: facing 쪽 ±25° 30m 안을 세기 1로 비춘다(건물 너머까지 닿는 거리).
function fakePlayer(x, z, facing = 0, flash = false) {
  return {
    pos: { x, y: 0, z }, facing, alive: true, hits: 0,
    hurt() { this.hits++; return true; },
    beamStrength(sx, sz) {
      if (!flash) return 0;
      const dx = sx - this.pos.x;
      const dz = sz - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 30 || d < 0.01) return 0;
      return (dx * Math.sin(this.facing) + dz * Math.cos(this.facing)) / d > Math.cos(0.45) ? 1 : 0;
    },
  };
}
const ctx = (player, extra = {}) => ({ player, world, night: 1, nights: 0, spawning: false, car: null, driving: false, ...extra });
const inside = (c, x, z, m = 0) => x > c.x0 + m && x < c.x1 - m && z > c.z0 + m && z < c.z1 - m;
// 넓은 건물 하나: 그 남쪽 2m에 그늘이, 북쪽 2m에 플레이어
const house = world.colliders.find((c) => c.t === 0 && c.x1 - c.x0 > 6 && c.z1 - c.z0 > 6);

test('그늘이는 건물을 지나오지 못한다', () => {
  const shades = new Shades(scene);
  const cx = (house.x0 + house.x1) / 2;
  const s = shades.list[0];
  Object.assign(s, { active: true, state: 'stalk', x: cx, z: house.z0 - 2, vx: 0, vz: 0, fade: 1, burn: 0, cool: 0, tag: null, tough: 1, path: null });
  const p = fakePlayer(cx, house.z1 + 2);
  for (let i = 0; i < 600; i++) {
    shades.update(1 / 60, i / 60, ctx(p));
    assert.ok(!inside(house, s.x, s.z, 0.05), `프레임 ${i}: 건물 안 (${s.x.toFixed(2)}, ${s.z.toFixed(2)})`);
  }
});

test('손전등은 건물 너머의 그늘이를 태우지 않는다(트인 곳에서는 태운다)', () => {
  const cx = (house.x0 + house.x1) / 2;
  assert.equal(world.blocksSight(cx, house.z1 + 2, cx, house.z0 - 2), true);
  assert.equal(world.blocksSight(house.x1 + 3, house.z0 - 2, house.x1 + 3, house.z1 + 2), false);
  const shades = new Shades(scene);
  const s = shades.list[0];
  const put = (x, z) => Object.assign(s, { active: true, state: 'stalk', x, z, vx: 0, vz: 0, fade: 1, burn: 0, cool: 0, tag: null, tough: 1, path: null });
  put(cx, house.z0 - 2);
  const behind = fakePlayer(cx, house.z1 + 2, Math.PI, true); // 남쪽(-z)을 비춘다
  shades.update(0.1, 0, ctx(behind));
  assert.equal(s.burn, 0, '벽 너머가 탔다');
  put(house.x1 + 3, house.z0 - 2);
  const open = fakePlayer(house.x1 + 3, house.z0 + 1, Math.PI, true);
  shades.update(0.1, 0, ctx(open));
  assert.ok(s.burn > 0, '트인 곳에서 타지 않았다');
});

test('그늘이는 건물·벽 안에서 깨어나지 않는다', () => {
  const shades = new Shades(scene);
  let n = 0;
  for (let i = 0; i < 400; i++) {
    for (const s of shades.list) s.active = false;
    if (!shades._spawn(0, 0, world)) continue;
    const s = shades.list.find((e) => e.active);
    const probe = { x: s.x, z: s.z };
    world.collide(probe, 0.3);
    assert.ok(Math.abs(probe.x - s.x) + Math.abs(probe.z - s.z) < 0.011, `충돌체 안 (${s.x}, ${s.z})`);
    n++;
  }
  assert.ok(n > 300, `깨어난 횟수 ${n}`);
});

test('새로 켜진 가로등 안에 있던 그늘이는 불빛 밖으로 밀려나거나 탄다', () => {
  world.reset(1);
  const L = world.lamps.find((l) => l.zone !== 'H');
  const zone = world.zones[L.zone];
  const shades = new Shades(scene);
  const s = shades.list[0];
  Object.assign(s, { active: true, state: 'stalk', x: L.x + 1, z: L.z, vx: 0, vz: 0, fade: 1, burn: 0, cool: 0, tag: null, tough: 1, path: null });
  world.night = 1;
  zone.powered = true;
  zone.on = true;
  zone.level = 1; // 켜진 순간
  const p = fakePlayer(L.x + 30, L.z);
  shades.update(1 / 60, 0, ctx(p));
  const d = Math.hypot(s.x - L.x, s.z - L.z);
  assert.ok(d >= LAMP_RADIUS - 0.01 || s.state === 'die' || s.burn > 0, `불빛 안 ${d.toFixed(2)}m, burn ${s.burn}`);
  world.reset(1);
  world.night = 0;
});

test('촛불 단서는 한자리에서 계속 받아도 구역에 고르게 퍼진다', () => {
  world.reset(3);
  const home = world.homes[0];
  const zones = [];
  for (let i = 0; i < 6; i++) {
    const l = world.hiddenFuseSpread(home.x, home.z);
    if (!l) break;
    world.hintLoot(l);
    zones.push(world.zoneAt(l.x, l.z));
  }
  const counts = Object.values(zones.reduce((m, z) => ((m[z] = (m[z] ?? 0) + 1), m), {}));
  assert.ok(new Set(zones).size >= Math.min(zones.length, 4), `구역 ${zones.join(',')}`);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `몰림 ${zones.join(',')}`);
  world.reset(1);
});

test('첫 밤에는 아무 방향, 다섯 번째 밤부터는 등 뒤에서 깨어나는 비율이 늘어난다', () => {
  const behindShare = (nights) => {
    const shades = new Shades(scene);
    const p = fakePlayer(0, 0, 0); // +z를 본다 → 등 뒤는 -z
    let back = 0;
    let all = 0;
    for (let i = 0; i < 300; i++) {
      for (const s of shades.list) s.active = false;
      shades.spawnTimer = 0;
      shades.update(0.001, 0, ctx(p, { spawning: true, nights, night: 1 }));
      for (const s of shades.list) {
        if (!s.active) continue;
        all++;
        if (s.z < -Math.abs(s.x) * 0.5) back++;
      }
    }
    return back / all;
  };
  const first = behindShare(0);
  const deep = behindShare(6);
  assert.ok(deep > first + 0.08, `등 뒤 비율 첫 밤 ${first.toFixed(2)} → 깊은 밤 ${deep.toFixed(2)}`);
});
