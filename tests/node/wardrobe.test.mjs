// 옷장(#15): 옷가지 꾸러미는 시작 지점에서 걸어서 닿는 곳에만 놓이고, 옷장 미리보기의 시선이 가리지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, load } from './env.mjs';

const { THREE, scene, world } = await makeGame({ chapters: true });
const { CAR_SPAWN, pushOut, BOUND } = await load('src/world.js');
const { PLAYER_R, Player } = await load('src/player.js');
const { Vehicle } = await load('src/vehicle.js');
const W = await load('src/wardrobe.js');
const START = { x: 0, z: 3.2 };
const locked = { lockedItems: W.ITEMS.filter((it) => !it.free) };

test('걸어서 닿는 곳 지도: 시작 지점은 닿고, 건물 안은 닿지 않는다', () => {
  const reach = new W.ReachMap(world.colliders, START, PLAYER_R);
  assert.ok(reach.near(START.x, START.z), '시작 지점');
  // 가장 큰 상자 충돌체(건물)의 한가운데
  const big = world.colliders.filter((c) => c.t === 0).sort((a, b) => (b.x1 - b.x0) * (b.z1 - b.z0) - (a.x1 - a.x0) * (a.z1 - a.z0))[0];
  assert.ok(big.x1 - big.x0 > 4 && big.z1 - big.z0 > 4);
  assert.equal(reach.near((big.x0 + big.x1) / 2, (big.z0 + big.z1) / 2, 0.8), false, '건물 안');
  // 수색 지점 대부분은 닿는다(막힌 지도가 아님을 확인)
  const ok = world.loot.filter((l) => reach.near(l.x, l.z, 1.6)).length;
  assert.ok(ok / world.loot.length > 0.9, `수색 지점 ${ok}/${world.loot.length}`);
});

test('마을에 놓인 꾸러미는 모두 걸어서 닿고 세워 둔 트럭에서 떨어져 있다(200번)', () => {
  const drops = new W.OutfitDrops(new THREE.Scene());
  const reach = new W.ReachMap(world.colliders, START, PLAYER_R);
  const truck = { x: CAR_SPAWN.x, z: CAR_SPAWN.z };
  for (let n = 0; n < 200; n++) {
    assert.equal(drops.spawn(world, locked, START, { truck, radius: PLAYER_R }), 3);
    for (const d of drops.list) {
      assert.ok(reach.near(d.x, d.z), `닿지 않는 꾸러미 ${d.x.toFixed(1)}, ${d.z.toFixed(1)}`);
      assert.ok(Math.hypot(d.x - truck.x, d.z - truck.z) >= 3.5, '트럭 옆');
    }
  }
  drops.clear();
});

test('울타리로 둘러싸인 수색 지점 옆에는 놓지 않는다(합성 마을)', () => {
  const ring = (cx, cz, r) => [
    { t: 0, x0: cx - r, x1: cx + r, z0: cz - r - 0.1, z1: cz - r + 0.1 },
    { t: 0, x0: cx - r, x1: cx + r, z0: cz + r - 0.1, z1: cz + r + 0.1 },
    { t: 0, x0: cx - r - 0.1, x1: cx - r + 0.1, z0: cz - r, z1: cz + r },
    { t: 0, x0: cx + r - 0.1, x1: cx + r + 0.1, z0: cz - r, z1: cz + r },
  ];
  const fake = {
    colliders: ring(30, 30, 4),
    // 울타리 안 수색 지점 셋과 바깥 하나. 바깥 지점만 쓸 수 있다.
    loot: [{ x: 30, z: 30 }, { x: 29, z: 31 }, { x: 31, z: 29 }, { x: -30, z: -30 }],
    collide(p, r) {
      pushOut(this.colliders, p, r);
      p.x = Math.min(Math.max(p.x, -BOUND), BOUND);
      p.z = Math.min(Math.max(p.z, -BOUND), BOUND);
    },
    heightAt: () => 0,
  };
  const drops = new W.OutfitDrops(new THREE.Scene());
  for (let n = 0; n < 30; n++) {
    const got = drops.spawn(fake, locked, START, { radius: PLAYER_R });
    assert.equal(got, 1, '울타리 밖 한 곳만');
    assert.ok(Math.hypot(drops.list[0].x + 30, drops.list[0].z + 30) < 2, '바깥 수색 지점 근처');
  }
  drops.clear();
});

test('옷장 미리보기: 은신처 앞 기본 방위는 마을·소품에 가리지 않고, 트럭이 가리면 다른 방위를 고른다', () => {
  const player = new Player(scene, {});
  const car = new Vehicle(scene);
  player.reset(START.x, START.z);
  player.pos.y = world.heightAt(START.x, START.z);
  car.reset(CAR_SPAWN.x, CAR_SPAWN.z, CAR_SPAWN.a);
  scene.updateMatrixWorld(true);
  const base = Math.PI / 4;
  let blockers = W.viewBlockers(scene, player.root);
  assert.ok(blockers.length > 1, '가림 후보(정적 마을·트럭)');
  assert.equal(W.viewClear(blockers, player.pos, base), true, '기본 방위가 트여 있다');
  assert.equal(W.chooseView(blockers, player.pos), base);

  // 지난 판에 트럭을 은신처 바로 앞(카메라 쪽)에 세워 두었다
  car.reset(START.x + 2.6, START.z + 2.6, Math.PI / 4);
  scene.updateMatrixWorld(true);
  blockers = W.viewBlockers(scene, player.root);
  assert.equal(W.viewClear(blockers, player.pos, base), false, '트럭이 가린다');
  const az = W.chooseView(blockers, player.pos);
  assert.notEqual(az, base);
  assert.equal(W.viewClear(blockers, player.pos, az), true, '고른 방위는 트여 있다');
});
