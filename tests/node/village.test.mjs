// 마을 번호(#59): 기본 마을(0)은 그대로이고, 다른 번호는 블록 배치·이름·세부가 달라지되 판을 할 수 있는 마을이어야 한다
// (은신처 가운데, 시작 자리·트럭 자리가 비어 있고, 배전함·뒤질 곳에 걸어서 닿는다). 1장 기록은 기본 마을에만, 판 저장은 마을을 따라간다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, localStorage } from './env.mjs';

const THREE = await import('three');
const W = await load('src/world.js');
const { Story } = await load('src/story.js');
const { ReachMap } = await load('src/wardrobe.js');
const { PLAYER_R } = await load('src/player.js');
const { captureRun, writeRun, readRun, savedVillage, layoutPrint, RUN_KEY } = await load('src/runsave.js');

const START = { x: 0, z: 3.2 };
const build = (village) => new W.World(new THREE.Scene(), { village });
const base = build(0);
const sortedTypes = (w) => w.types.flat().sort().join();
const VILLAGES = [1, 2, 3, 4, 5, 6, 7, 8, 13, 482913, 999999];

test('기본 마을(0)은 바뀌지 않는다: 구역 이름·블록 배치가 예전 그대로', () => {
  assert.equal(W.villageTurn(0), 0);
  assert.deepEqual(Object.fromEntries(Object.values(base.zones).map((z) => [z.id, z.name])), W.ZONE_NAMES);
  assert.equal(base.types[0].join(), 'farm,houses,tower,houses,farm');
  assert.equal(base.types[2][2], 'home');
});

test('다른 번호는 일곱 가지 대칭에 고루 퍼지고, 같은 번호는 같은 마을', () => {
  const turns = new Set();
  for (let v = 1; v <= 200; v++) turns.add(W.villageTurn(v));
  assert.deepEqual([...turns].sort(), [1, 2, 3, 4, 5, 6, 7]);
  const a = build(482913);
  const b = build(482913);
  assert.equal(layoutPrint(a), layoutPrint(b));
  assert.notEqual(layoutPrint(a), layoutPrint(base));
});

for (const v of VILLAGES) {
  test(`마을 ${v}: 같은 동네들, 은신처 가운데, 구역 이름이 자리 방위와 맞고 겹치지 않음`, () => {
    const w = build(v);
    assert.equal(sortedTypes(w), sortedTypes(base));
    assert.equal(w.types[2][2], 'home');
    const names = Object.values(w.zones).map((z) => z.name);
    assert.equal(new Set(names).size, 9, names.join());
    const bearing = { A: '서북', B: '북쪽', C: '동북', D: '서쪽', E: '동쪽', F: '서남', G: '남쪽', I: '동남' };
    for (const z of Object.values(w.zones)) {
      if (/^(서북|북쪽|동북|서쪽|동쪽|서남|남쪽|동남) /.test(z.name)) assert.ok(z.name.startsWith(bearing[z.id]), `${z.id} ${z.name}`);
    }
  });

  test(`마을 ${v}: 시작 자리·트럭 자리가 비어 있고 배전함 여덟·뒤질 곳에 걸어서 닿는다`, () => {
    const w = build(v);
    const p = { x: START.x, z: START.z };
    w.collide(p, PLAYER_R);
    assert.ok(Math.hypot(p.x - START.x, p.z - START.z) < 0.01, '시작 자리가 충돌체 안');
    const car = { x: W.CAR_SPAWN.x, z: W.CAR_SPAWN.z };
    w.collide(car, 1.0);
    assert.ok(Math.hypot(car.x - W.CAR_SPAWN.x, car.z - W.CAR_SPAWN.z) < 0.01, '트럭 자리가 막힘');
    assert.equal(w.fuseBoxes.length, 8);
    assert.deepEqual(w.fuseBoxes.map((f) => f.zone).sort().join(''), 'ABCDEFGI');
    const reach = new ReachMap(w.colliders, START, PLAYER_R);
    for (const f of w.fuseBoxes) assert.ok(reach.near(f.ix, f.iz), `${f.zone} 배전함에 닿지 못함`);
    const far = w.loot.filter((l) => !reach.near(l.x, l.z, 1.4));
    assert.ok(w.loot.length >= 55 && w.loot.length <= 80, `뒤질 곳 ${w.loot.length}`);
    assert.equal(far.length, 0, `닿지 못하는 뒤질 곳 ${far.length}`);
  });
}

test('1장 기록 소품은 기본 마을에만 놓인다', () => {
  assert.ok(new Story(new THREE.Scene(), build(0)).spots.length > 0);
  assert.equal(new Story(new THREE.Scene(), build(482913)).spots.length, 0);
});

test('판 저장은 마을 번호를 따라간다: 다른 마을이면 그 번호를 남기고, 다른 마을로 지은 판은 지우지 않고 막는다', () => {
  const w = build(482913);
  w.reset(5);
  const player = { pos: START, facing: 0, hp: 80, battery: 50, fuses: 1, bandages: 0, cans: 0, flashOn: false };
  const car = { pos: { x: W.CAR_SPAWN.x, z: W.CAR_SPAWN.z }, a: 0, fuel: 40, lamp: false };
  const env = { day: 1, hour: 9, rainyNight: true, rainLevel: 0 };
  const game = { driving: false, nights: 0, returned: 0, cacheTaken: 0 };
  writeRun(captureRun({ world: w, player, car, env, game, shades: { banished: 0 } }));
  assert.equal(JSON.parse(localStorage.getItem(RUN_KEY)).village, 482913);
  assert.equal(savedVillage(), 482913);
  assert.equal(readRun(w).status, 'ok');
  assert.equal(readRun(w).run.village, 482913);
  const other = readRun(base);
  assert.deepEqual(other, { status: 'village', village: 482913 });
  assert.ok(localStorage.getItem(RUN_KEY), '다른 마을의 판을 지웠다');
  // 기본 마을의 판에는 번호가 없다
  base.reset(5);
  writeRun(captureRun({ world: base, player, car, env, game, shades: { banished: 0 } }));
  assert.equal('village' in JSON.parse(localStorage.getItem(RUN_KEY)), false);
  assert.equal(savedVillage(), 0);
  // 틀린 번호는 기본 마을로 읽는다
  const raw = JSON.parse(localStorage.getItem(RUN_KEY));
  for (const bad of [-1, 1.5, 'x', 1e7]) {
    raw.village = bad;
    localStorage.setItem(RUN_KEY, JSON.stringify(raw));
    assert.equal(savedVillage(), 0, String(bad));
  }
  localStorage.removeItem(RUN_KEY);
  assert.throws(() => build(-3), /마을 번호/);
});
