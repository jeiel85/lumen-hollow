// 밤의 변화(#57): 밤 사건 고르기, 빛먹이(가로등을 찾아가 과부하·손전등 방해), 떼 그늘이(한 자리에 여럿), 전압 출렁임,
// 새 그늘이는 1장 판(cap 없음)에만, 난이도 단계가 정한 밤부터.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, load, localStorage } from './env.mjs';

const { scene, world } = await makeGame();
const { Shades } = await load('src/shades.js');
const { LAMP_RADIUS, DIP_WARN, DIP_DARK } = await load('src/world.js');
const { pickEvent, NightLog, NOTES, KINDS } = await load('src/nights.js');
const { DIFFICULTY } = await load('src/difficulty.js');

function fakePlayer(x, z, { flash = false } = {}) {
  return {
    pos: { x, y: 0, z }, facing: 0, alive: true, hits: [], flashActive: flash,
    hurt(n) { this.hits.push(n); return true; },
    beamStrength() { return 0; },
  };
}
const ctx = (player, extra = {}) => ({ player, world, night: 1, nights: 3, spawning: false, car: null, driving: false, ...extra });
const put = (s, x, z, kind) => {
  Object.assign(s, { active: true, state: 'stalk', x, z, vx: 0, vz: 0, fade: 1, burn: 0, cool: 0, tag: null, tough: 1, path: null });
  s.g.visible = true;
  return s;
};

test('밤 사건: 첫 밤은 없고, 같은 사건이 이틀 연달아 오지 않으며, 셋 모두 나온다', () => {
  assert.equal(pickEvent(0, null, () => 0.6), null);
  const seq = [];
  let prev = null;
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let n = 1; n < 400; n++) {
    const e = pickEvent(n, prev, rand);
    if (e) assert.notEqual(e, prev, `${n}번째 밤에 ${e}가 연달아`);
    seq.push(e);
    prev = e;
  }
  const count = (id) => seq.filter((e) => e === id).length;
  assert.ok(count(null) > 80 && count('fog') > 80 && count('surge') > 80, JSON.stringify({ none: count(null), fog: count('fog'), surge: count('surge') }));
});

test('처음 만난 것은 한 번만 알리고 이 기기에 남는다(모르는 이름은 무시)', () => {
  localStorage.removeItem('lumen.nights');
  const log = new NightLog();
  assert.equal(log.mark('eater'), true);
  assert.equal(log.mark('eater'), false);
  assert.equal(log.mark('ghost'), false);
  const again = new NightLog();
  assert.equal(again.has('eater'), true);
  assert.equal(again.has('ghost'), false);
  assert.deepEqual(NOTES.map((n) => n.id), ['shade', 'eater', 'swarm', 'fog', 'surge']);
  localStorage.setItem('lumen.nights', '{broken');
  assert.equal(new NightLog().has('eater'), false);
  localStorage.removeItem('lumen.nights');
});

// 켜진 구역 하나와 그 가로등
world.reset(3);
const lampZone = Object.values(world.zones).find((z) => z.id !== 'H');
lampZone.powered = true;
lampZone.on = true;
lampZone.level = 1;
world.update(0.01, 0, 1, { x: 0, z: 0 }, 30);
const lamp = world.lamps.find((L) => L.zone === lampZone.id);

test('빛먹이는 사람이 멀면 가까운 켜진 가로등으로 가서 붙고, 보통 그늘이보다 다섯 배 빨리 과부하를 건다', () => {
  const shades = new Shades(scene);
  const e = put(shades.list[0], lamp.x + 12, lamp.z);
  shades._become(e, 'eater', 1);
  const far = fakePlayer(lamp.x - 18, lamp.z); // 그늘이와 30m: 사라질 만큼 멀지 않고, 덮칠 만큼 가깝지 않다
  lampZone.load = 0;
  let pressedAt = null;
  for (let i = 0; i < 900 && pressedAt === null; i++) {
    shades.update(1 / 30, i / 30, ctx(far));
    if (lampZone.load > 0) pressedAt = i;
  }
  assert.ok(pressedAt !== null, `가로등에 닿지 못함 (${e.x.toFixed(1)}, ${e.z.toFixed(1)})`);
  const target = e.seek;
  assert.ok(target && world.lamps.includes(target), '켜진 가로등을 노리지 않음');
  const d = Math.hypot(e.x - target.x, e.z - target.z);
  assert.ok(d < LAMP_RADIUS + 0.6, `가로등 가장자리가 아님 ${d.toFixed(2)}`);
  // 같은 자리에서 1초 동안 오른 부하: 빛먹이 vs 보통 그늘이
  const rise = (kind) => {
    const sh = new Shades(scene);
    const s = put(sh.list[0], e.x, e.z);
    sh._become(s, kind, 99);
    lampZone.load = 0;
    for (let i = 0; i < 30; i++) sh.update(1 / 30, i / 30, ctx(far, { diff: DIFFICULTY.normal }));
    return lampZone.load;
  };
  const eater = rise('eater');
  const shade = rise('shade');
  assert.ok(eater > shade * 4, JSON.stringify({ eater, shade }));
  lampZone.load = 0;
});

test('빛먹이가 7m 안에 오면 켜진 손전등을 방해한다(가까울수록 세게), 꺼져 있으면 아무 일 없음', () => {
  const shades = new Shades(scene);
  const e = put(shades.list[0], 4, 0);
  shades._become(e, 'eater', 99);
  e.state = 'rise';
  const on = shades.update(1 / 60, 0, ctx(fakePlayer(0, 0, { flash: true })));
  e.state = 'stalk';
  const near = shades.update(1 / 60, 0, ctx(fakePlayer(e.x - 2, e.z, { flash: true })));
  const off = shades.update(1 / 60, 0, ctx(fakePlayer(e.x - 2, e.z)));
  assert.equal(on.jam, 0, '깨어나는 중에는 방해하지 않는다');
  assert.ok(near.jam > 0.6, JSON.stringify(near.jam));
  assert.equal(off.jam, 0);
  assert.ok(near.seen.has('eater'));
});

test('종류마다 크기·피해가 다르다(떼 그늘이는 작고 덜 아프다)', () => {
  const shades = new Shades(scene);
  const s = put(shades.list[0], 0.4, 0);
  shades._become(s, 'swarm', 1);
  const p = fakePlayer(0, 0);
  shades.update(1 / 60, 0, ctx(p, { diff: DIFFICULTY.normal }));
  assert.deepEqual(p.hits, [Math.round(15 * KINDS.swarm.stat.damage)]);
  assert.ok(s.g.scale.y < 0.8, `크기 ${s.g.scale.y}`);
  shades._kind(s, 'shade');
  assert.equal(s.size, 1, '돌려 쓸 때 원래 크기로');
});

test('새 그늘이는 1장 판(cap 없음)에서만, 난이도가 정한 밤부터 나온다', () => {
  const spawnKinds = (extra, n = 400) => {
    const shades = new Shades(scene);
    const kinds = new Set();
    const p = fakePlayer(-48, 48);
    for (let i = 0; i < n; i++) {
      shades.spawnTimer = 0;
      shades.update(1 / 30, i / 30, ctx(p, { spawning: true, ...extra }));
      for (const s of shades.list) if (s.active) kinds.add(s.kind);
      if (i % 40 === 39) shades.clear();
    }
    return kinds;
  };
  const early = spawnKinds({ nights: 0, diff: DIFFICULTY.normal });
  assert.deepEqual([...early], ['shade'], '보통의 첫 밤에는 기본 그늘이만');
  const later = spawnKinds({ nights: 3, diff: DIFFICULTY.normal });
  assert.ok(later.has('eater') && later.has('swarm'), `넷째 밤: ${[...later]}`);
  const hardFirst = spawnKinds({ nights: 0, diff: DIFFICULTY.hard });
  assert.ok(hardFirst.has('eater'), `어려움 첫 밤: ${[...hardFirst]}`);
  const chapter = spawnKinds({ nights: 3, cap: 3, diff: DIFFICULTY.normal });
  assert.deepEqual([...chapter], ['shade'], '장 무대(cap)에는 기본 그늘이만');
});

test('떼 그늘이는 한 자리(1.6m 안)에 정한 수만큼 깨어난다', () => {
  const shades = new Shades(scene);
  const made = shades._pack(-48, 48, world, 3, null, 1);
  const pack = shades.list.filter((s) => s.active);
  assert.equal(made, pack.length);
  assert.ok(made >= 2, `떼가 ${made}마리`);
  const lead = pack[0];
  for (const s of pack) {
    assert.equal(s.kind, 'swarm');
    assert.ok(Math.hypot(s.x - lead.x, s.z - lead.z) <= 1.61);
    assert.equal(world.lightAt(s.x, s.z), null);
  }
});

test('전압 출렁임: 깜박인 뒤 꺼졌다가 다시 켜지고, 은신처·꺼진 구역에는 걸리지 않는다', () => {
  world.reset(3);
  const z = Object.values(world.zones).find((q) => q.id !== 'H');
  Object.assign(z, { powered: true, on: true, level: 1 });
  const L = world.lamps.find((q) => q.zone === z.id);
  world.update(0.01, 0, 1, { x: 0, z: 0 }, 30);
  assert.ok(world.lightAt(L.x, L.z));
  assert.equal(world.dip(z.id), true);
  assert.equal(world.dip(z.id), false, '이미 출렁이는 중');
  let t = 0;
  const run = (sec) => { for (let i = 0; i < sec * 30; i++) world.update(1 / 30, (t += 1 / 30), 1, { x: 0, z: 0 }, 30); };
  run(DIP_WARN * 0.8);
  assert.ok(world.lightAt(L.x, L.z), '깜박이는 동안은 아직 켜져 있다');
  run(DIP_WARN * 0.2 + 1.0);
  assert.equal(world.lightAt(L.x, L.z), null, '꺼진 동안은 빛이 그늘이를 막지 못한다');
  run(DIP_DARK - 1.0 + 1.2);
  assert.ok(world.lightAt(L.x, L.z), '다시 켜졌다');
  const off = Object.values(world.zones).find((q) => q.id !== 'H' && q !== z);
  off.powered = false;
  assert.equal(world.dip(off.id), false);
  assert.equal(world.dip('nope'), false);
});
