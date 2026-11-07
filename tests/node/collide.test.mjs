// 충돌체 격자(#6 '차 충돌 검사의 전체 순회'): 격자로 고른 후보만 훑어도 결과가 전체 순회와 같은지.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, load } from './env.mjs';

const { world, chapters } = await makeGame({ chapters: true });
const { pushOut, queryColliders } = await load('src/world.js');

// 격자 전의 pushOut 그대로(목록 전체를 차례로 밀어낸다)
function pushOutLinear(colliders, p, r) {
  for (const c of colliders) {
    if (c.t === 0) {
      if (p.x < c.x0 - r || p.x > c.x1 + r || p.z < c.z0 - r || p.z > c.z1 + r) continue;
      const nx = Math.min(Math.max(p.x, c.x0), c.x1);
      const nz = Math.min(Math.max(p.z, c.z0), c.z1);
      const dx = p.x - nx;
      const dz = p.z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        p.x = nx + (dx / d) * r;
        p.z = nz + (dz / d) * r;
      } else {
        const l = p.x - c.x0, rr = c.x1 - p.x, u = p.z - c.z0, dd = c.z1 - p.z;
        const m = Math.min(l, rr, u, dd);
        if (m === l) p.x = c.x0 - r;
        else if (m === rr) p.x = c.x1 + r;
        else if (m === u) p.z = c.z0 - r;
        else p.z = c.z1 + r;
      }
    } else {
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const rr = c.r + r;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr || d2 < 1e-8) continue;
      const d = Math.sqrt(d2);
      p.x = c.x + (dx / d) * rr;
      p.z = c.z + (dz / d) * rr;
    }
  }
}

let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

// 무작위 점 + 충돌체 가장자리·한가운데(깊이 박혀 멀리 밀려나는 경우) + 두 충돌체가 맞닿은 틈
function samples(colliders, span, n) {
  const pts = [];
  for (let i = 0; i < n; i++) pts.push({ x: (rnd() * 2 - 1) * span, z: (rnd() * 2 - 1) * span });
  for (const c of colliders) {
    if (c.t === 0) {
      pts.push({ x: (c.x0 + c.x1) / 2, z: (c.z0 + c.z1) / 2 });
      pts.push({ x: c.x0 - 0.1, z: c.z0 + rnd() * (c.z1 - c.z0) });
      pts.push({ x: c.x0 + rnd() * (c.x1 - c.x0), z: c.z1 + 0.05 });
    } else {
      pts.push({ x: c.x + c.r * 0.5, z: c.z - c.r * 0.3 });
    }
  }
  return pts;
}

test('마을: 격자 pushOut이 전체 순회와 같은 자리로 밀어낸다(반지름 0.36·0.55·1.2)', () => {
  const cols = world.colliders;
  assert.ok(cols.length > 800, `충돌체 ${cols.length}개`);
  const pts = samples(cols, 95, 6000);
  let moved = 0;
  for (const r of [0.36, 0.55, 1.2]) {
    for (const p0 of pts) {
      const a = { ...p0 };
      const b = { ...p0 };
      pushOut(cols, a, r);
      pushOutLinear(cols, b, r);
      assert.ok(a.x === b.x && a.z === b.z, `r=${r} ${JSON.stringify(p0)}: 격자 ${JSON.stringify(a)} ≠ 전체 ${JSON.stringify(b)}`);
      if (a.x !== p0.x || a.z !== p0.z) moved++;
    }
  }
  assert.ok(moved > 3000, `밀려난 점이 충분해야 의미가 있다(${moved})`);
});

test('충돌체가 더해지면(이야기 소품처럼) 격자를 다시 만든다', () => {
  const cols = world.colliders;
  const p = { x: 70.5, z: -70.5 };
  pushOut(cols, { ...p }, 0.36); // 지금 목록으로 격자를 만들어 둔다
  const extra = { t: 1, x: p.x, z: p.z + 0.1, r: 0.3 };
  cols.push(extra);
  try {
    const a = { ...p };
    const b = { ...p };
    pushOut(cols, a, 0.36);
    pushOutLinear(cols, b, 0.36);
    assert.deepEqual(a, b);
    assert.ok(Math.hypot(a.x - extra.x, a.z - extra.z) >= extra.r + 0.36 - 1e-9, '새 충돌체에서 밀려나야 한다');
  } finally {
    cols.splice(cols.indexOf(extra), 1);
  }
});

test('2~4장 무대도 같은 결과', () => {
  const stages = [chapters.lake, chapters.river].filter((st) => st?.colliders?.length);
  assert.ok(stages.length === 2, '섬·강 무대');
  for (const st of stages) {
    for (const p0 of samples(st.colliders, 400, 2000)) {
      const a = { ...p0 };
      const b = { ...p0 };
      pushOut(st.colliders, a, 0.4);
      pushOutLinear(st.colliders, b, 0.4);
      assert.deepEqual(a, b);
    }
  }
});

test('queryColliders: 경계 상자가 질의 사각형에 닿는 충돌체는 빠짐없이, 목록 순서대로', () => {
  const cols = world.colliders;
  const out = [];
  for (let i = 0; i < 3000; i++) {
    const x = (rnd() * 2 - 1) * 100;
    const z = (rnd() * 2 - 1) * 100;
    const w = rnd() * 9;
    const h = rnd() * 9;
    queryColliders(cols, x, z, x + w, z + h, out);
    for (let k = 1; k < out.length; k++) assert.ok(out[k - 1] < out[k], '오름차순·중복 없음');
    const got = new Set(out);
    cols.forEach((c, j) => {
      const [bx0, bz0, bx1, bz1] = c.t === 0 ? [c.x0, c.z0, c.x1, c.z1] : [c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r];
      if (bx1 >= x && bx0 <= x + w && bz1 >= z && bz0 <= z + h) assert.ok(got.has(j), `질의 (${x}, ${z}, ${w}×${h})에 충돌체 ${j}가 빠졌다`);
    });
  }
});
