// 마을 생성·물건 배치·충돌·빛 판정의 회귀 시험(#1 '자동 회귀 테스트').
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, load } from './env.mjs';

const { world } = await makeGame();
const { BOUND, LAMP_RADIUS, ZONE_GRID } = await load('src/world.js');

test('구역 아홉, 배전함 여덟(은신처 H 제외), 뒤질 곳 68', () => {
  assert.equal(Object.keys(world.zones).length, ZONE_GRID.join('').length);
  assert.equal(world.fuseBoxes.length, 8);
  assert.ok(!world.fuseBoxes.some((b) => b.zone === 'H'));
  assert.equal(world.loot.length, 68);
});

test('판마다 물건 수가 같고, 같은 시드는 같은 배치', () => {
  const count = () => world.loot.reduce((m, l) => ((m[l.item] = (m[l.item] ?? 0) + 1), m), {});
  for (const seed of [1, 2, 3, 77, 1031]) {
    world.reset(seed);
    assert.deepEqual(count(), { fuse: 11, battery: 13, bandage: 8, fuel: 7, empty: 29 }, `seed ${seed}`);
    // 은신처 옆 블록에는 퓨즈가 하나는 있다
    assert.ok(world.loot.some((l) => l.near && l.item === 'fuse'), `seed ${seed}: 은신처 옆 퓨즈`);
  }
  world.reset(5);
  const a = world.loot.map((l) => l.item).join();
  world.reset(6);
  world.reset(5);
  assert.equal(world.loot.map((l) => l.item).join(), a);
});

test('충돌: 건물 안의 점은 밖으로 밀려나고, 마을 밖은 경계에 걸린다', () => {
  const R = 0.36;
  const boxes = world.colliders.filter((c) => c.t === 0 && c.x1 - c.x0 > 2 && c.z1 - c.z0 > 2);
  assert.ok(boxes.length > 20);
  for (const c of boxes.slice(0, 40)) {
    const p = { x: (c.x0 + c.x1) / 2, z: (c.z0 + c.z1) / 2 };
    world.collide(p, R);
    const inside = p.x > c.x0 - R + 1e-6 && p.x < c.x1 + R - 1e-6 && p.z > c.z0 - R + 1e-6 && p.z < c.z1 + R - 1e-6;
    assert.ok(!inside, `상자 ${JSON.stringify(c)} 안에 남음: ${JSON.stringify(p)}`);
  }
  const far = { x: 500, z: -500 };
  world.collide(far, R);
  assert.ok(Math.abs(far.x) <= BOUND && Math.abs(far.z) <= BOUND);
});

test('빛 판정: 낮에는 없고, 밤에는 켜진 구역 가로등 반경 안만 안전', () => {
  world.reset(1);
  const lamp = world.lamps.find((L) => L.zone === 'H');
  assert.ok(lamp, '은신처 구역 가로등');
  world.night = 0;
  assert.equal(world.lightAt(lamp.x, lamp.z), null);
  world.night = 1;
  assert.ok(world.lightAt(lamp.x + LAMP_RADIUS * 0.5, lamp.z));
  assert.equal(world.lightAt(lamp.x + LAMP_RADIUS + 0.5, lamp.z + LAMP_RADIUS + 0.5)?.L === lamp ? 1 : null, null);
  const dark = world.lamps.find((L) => L.zone !== 'H');
  assert.equal(world.zones[dark.zone].level, 0);
  assert.equal(world.lightAt(dark.x, dark.z)?.L === dark ? 1 : null, null, '꺼진 구역의 가로등은 안전하지 않다');
  world.night = 0;
});
