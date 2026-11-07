// 트럭(#6): 빠르게 들이받아도 울타리·전봇대·벽을 뚫거나 파고들지 않는지, 차폭보다 조금 넓은 골목에서 핸들을 꺾은 채
// 가속해도 멈춰 버리지 않는지, 막힌 자리의 내릴 곳, 연료통을 넘치게 붓지 않는지.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, load } from './env.mjs';

const { scene, world } = await makeGame();
const { Vehicle, CAN_FUEL } = await load('src/vehicle.js');
const { PLAYER_R } = await load('src/player.js');
const car = new Vehicle(scene);
const HW = 0.95;
const HL = 2.15;

// 차체와 정적 충돌체의 가장 깊은 겹침(m). 0 이하면 겹치지 않는다(0은 맞닿음).
function penetration() {
  const s = Math.sin(car.a), c = Math.cos(car.a), as = Math.abs(s), ac = Math.abs(c);
  let worst = -Infinity;
  for (const col of world.colliders) {
    let o;
    if (col.t === 0) {
      const ex = (col.x1 - col.x0) / 2, ez = (col.z1 - col.z0) / 2;
      const dx = car.pos.x - (col.x0 + ex), dz = car.pos.z - (col.z0 + ez);
      const df = dx * s + dz * c, dr = -dx * c + dz * s;
      o = Math.min(ex + HW * ac + HL * as - Math.abs(dx), ez + HW * as + HL * ac - Math.abs(dz), HL + ex * as + ez * ac - Math.abs(df), HW + ex * ac + ez * as - Math.abs(dr));
    } else {
      const dx = col.x - car.pos.x, dz = col.z - car.pos.z;
      const lx = -dx * c + dz * s, lz = dx * s + dz * c;
      const d = Math.hypot(lx - Math.max(-HW, Math.min(HW, lx)), lz - Math.max(-HL, Math.min(HL, lz)));
      o = d > 0 ? col.r - d : col.r + Math.min(HW - Math.abs(lx), HL - Math.abs(lz));
    }
    worst = Math.max(worst, o);
  }
  return worst;
}

function seat(x, z, a, fuel = 100) {
  car.reset(x, z, a, fuel);
  car.occupied = true;
}

// 시험용 벽을 잠깐 세운다(충돌체 격자는 목록 길이가 바뀌면 다시 만든다).
function withWalls(boxes, fn) {
  const added = boxes.map(([x0, x1, z0, z1]) => ({ t: 0, x0, x1, z0, z1 }));
  world.colliders.push(...added);
  try {
    return fn();
  } finally {
    for (const b of added) world.colliders.splice(world.colliders.indexOf(b), 1);
  }
}

const pick = (arr, n) => arr.filter((_, i) => i % Math.max(1, Math.floor(arr.length / n)) === 0).slice(0, n);

test('울타리(0.16m)·전봇대·건물 벽을 15·30·60m/s로 들이받아도(프레임 1/60·1/20초) 뚫거나 파고들지 않는다', () => {
  const fences = world.colliders.filter((c) => c.t === 0 && Math.min(c.x1 - c.x0, c.z1 - c.z0) < 0.2 && Math.max(c.x1 - c.x0, c.z1 - c.z0) > 4);
  const walls = world.colliders.filter((c) => c.t === 0 && Math.min(c.x1 - c.x0, c.z1 - c.z0) > 3);
  const poles = world.colliders.filter((c) => c.t === 1 && c.r < 0.25);
  assert.ok(fences.length >= 8 && poles.length >= 8 && walls.length >= 6);
  let hits = 0;
  for (const [kind, list] of [['울타리', pick(fences, 8)], ['전봇대', pick(poles, 8)], ['벽', pick(walls, 6)]]) {
    for (const col of list) {
      // 얇은 쪽(원은 x축)으로 정면에서 다가간다. 출발 자리가 비어 있는 쪽을 쓴다.
      const thinX = col.t === 1 || col.x1 - col.x0 < col.z1 - col.z0;
      const cx = col.t === 0 ? (col.x0 + col.x1) / 2 : col.x;
      const cz = col.t === 0 ? (col.z0 + col.z1) / 2 : col.z;
      const half = col.t === 0 ? (thinX ? col.x1 - col.x0 : col.z1 - col.z0) / 2 : col.r;
      for (const side of [1, -1]) {
        const nx = thinX ? side : 0;
        const nz = thinX ? 0 : side;
        const sx = cx + nx * (half + 3.2);
        const sz = cz + nz * (half + 3.2);
        const a = Math.atan2(-nx, -nz);
        seat(sx, sz, a);
        if (Math.abs(sx) > 85 || Math.abs(sz) > 85 || penetration() > -0.05) continue;
        for (const speed of [15, 30, 60]) {
          for (const dt of [1 / 60, 1 / 20]) {
            seat(sx, sz, a);
            car.vel.set(Math.sin(a) * speed, 0, Math.cos(a) * speed);
            for (let t = 0; t < 0.8; t += dt) {
              car.update(dt, { thr: 1, steer: 0 }, world, 0);
              const p = penetration();
              assert.ok(p < 1e-3, `${kind} ${speed}m/s dt=${dt.toFixed(3)}: ${p.toFixed(3)}m 파고듦`);
            }
            const after = (car.pos.x - cx) * nx + (car.pos.z - cz) * nz;
            assert.ok(after > 0, `${kind} ${speed}m/s dt=${dt.toFixed(3)}: 반대편으로 뚫고 나감`);
            hits++;
          }
        }
        break;
      }
    }
  }
  assert.ok(hits >= 100, `시험한 충돌 ${hits}번`);
});

test('차폭(1.9m)보다 조금 넓은 골목(2.2m)에서 핸들을 어느 쪽으로 꺾은 채 가속해도 멈추지 않고 빠져나간다', () => {
  // 마을 빈 도로(x 48, z -30~-18)에 골목을 세운다.
  const X0 = 48, G = 1.1;
  withWalls([[X0 - G - 0.5, X0 - G, -30, -18], [X0 + G, X0 + G + 0.5, -30, -18]], () => {
    for (const dt of [1 / 60, 1 / 20]) {
      for (const [x, a, steer, thr] of [[48, 0, 1, 1], [48, 0, -1, 1], [48, 0, 0.5, 0.6], [48, 0, 1, 0.3], [48.05, 0.03, 1, 1], [47.95, -0.03, -1, 1]]) {
        seat(x, -27, a);
        let still = 0;
        let t = 0;
        for (; t < 6 && car.pos.z < -18 + HL; t += dt) {
          const px = car.pos.x, pz = car.pos.z;
          car.update(dt, { thr, steer }, world, 0);
          if (Math.hypot(car.pos.x - px, car.pos.z - pz) < 1e-3) still++;
          assert.ok(penetration() < 1e-3, `dt=${dt.toFixed(3)} 핸들 ${steer}: 벽을 파고듦`);
        }
        const label = `dt=${dt.toFixed(3)} 출발 (${x}, ${a}) 핸들 ${steer} 가속 ${thr}`;
        assert.ok(car.pos.z >= -18 + HL, `${label}: 6초 동안 골목을 빠져나가지 못함(z ${car.pos.z.toFixed(2)})`);
        assert.ok(still * dt < 0.2, `${label}: ${(still * dt).toFixed(2)}초 멈춤`);
      }
    }
  });
});

test('내릴 자리: 옆이 막히면 뒤로, 사방이 막히면 연료가 있을 땐 거절하고(옮겨 세울 수 있다) 없을 땐 비어 있는 곳으로', () => {
  const X0 = 48, Z = -24;
  const free = (s) => {
    const q = { x: s.x, z: s.z };
    world.collide(q, PLAYER_R);
    return Math.hypot(q.x - s.x, q.z - s.z) < 1e-6 && car.distanceTo(s.x, s.z) >= PLAYER_R;
  };
  const sides = [[X0 - 1.65, X0 - 1.15, Z - 3, Z + 3], [X0 + 1.15, X0 + 1.65, Z - 3, Z + 3]];
  withWalls(sides, () => {
    seat(X0, Z, 0, 50);
    const s = car.exitSpot(world);
    assert.ok(s && free(s), '옆이 막히면 앞뒤로 내린다');
    assert.ok(Math.abs(s.x - X0) < 0.2 && s.z < Z - HL, `뒤로 내린다: ${JSON.stringify(s)}`);
  });
  withWalls([...sides, [X0 - 2, X0 + 2, Z + 2.35, Z + 2.85], [X0 - 2, X0 + 2, Z - 2.85, Z - 2.35]], () => {
    seat(X0, Z, 0, 50);
    assert.equal(car.exitSpot(world), null, '사방이 막히고 연료가 있으면 내리지 않는다');
    for (const opts of [{ force: true }, {}]) {
      seat(X0, Z, 0, opts.force ? 50 : 0);
      const s = car.exitSpot(world, opts);
      assert.ok(s && free(s), `${opts.force ? 'force' : '연료 0'}: 충돌체·차체와 겹치지 않는 자리 ${JSON.stringify(s)}`);
    }
  });
  // 트인 곳에서는 예전처럼 운전석 문 앞
  seat(X0, Z, 0, 50);
  const s = car.exitSpot(world);
  const local = { lx: -(s.x - X0), lz: s.z - Z };
  assert.ok(Math.abs(local.lx + HW + 0.75) < 0.05 && Math.abs(local.lz - 0.3) < 0.05, `운전석 문 앞: ${JSON.stringify(local)}`);
});

test('연료통: 넘쳐 버리는 일 없이 60% 이하일 때만 한 통(40%)씩 붓는다', () => {
  assert.equal(CAN_FUEL, 40);
  for (const [fuel, cans, poured, after] of [[0, 3, 2, 80], [10, 3, 2, 90], [50, 3, 1, 90], [60, 1, 1, 100], [60.5, 2, 0, 60.5], [80, 2, 0, 80], [100, 1, 0, 100], [20, 0, 0, 20]]) {
    car.reset(0, 0, 0, fuel);
    assert.equal(car.cansToPour(cans), poured, `연료 ${fuel}% · 통 ${cans}개`);
    assert.equal(car.pour(cans), poured);
    assert.equal(car.fuel, after);
    assert.ok(car.fuel <= 100);
  }
});
