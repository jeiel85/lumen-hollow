// 2~4장(#32): 무대의 걸을 수 있는 영역 이음매를 실제 이동 식으로 넘는지, 진행 계산, 저장 형식.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, load, localStorage } from './env.mjs';

const { story, chapters: C } = await makeGame({ chapters: true });
const { SPEED, PLAYER_R } = await load('src/player.js');
const { RIVER } = await load('src/chapters.js');

// src/player.js update()와 같은 이동 식으로 from → to를 걷는다. 남은 거리를 돌려준다.
function walk(stage, from, to, dt, secs = 12) {
  const p = { x: from.x, z: from.z };
  const v = { x: 0, z: 0 };
  const k = 1 - Math.exp(-dt * 12);
  for (let t = 0; t < secs; t += dt) {
    const dx = to.x - p.x;
    const dz = to.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.3) break;
    v.x += ((dx / d) * SPEED - v.x) * k;
    v.z += ((dz / d) * SPEED - v.z) * k;
    p.x += v.x * dt;
    p.z += v.z * dt;
    stage.collide(p, PLAYER_R);
  }
  return Math.hypot(to.x - p.x, to.z - p.z);
}
const at = (f, x, z) => ({ x: f.px(x, z), z: f.pz(x, z) });
const local = (f, p) => {
  const dx = p.x - f.x;
  const dz = p.z - f.z;
  return { x: dx * f.c - dz * f.s, z: dx * f.s + dz * f.c };
};

test('이음매(선착장·섬 부두·강 나루)를 144/60/30/20fps 양방향으로 걸어 넘는다', () => {
  const df = C.story.dockPier;
  const pf = C.story.islandPier;
  const routes = {
    '선착장 빈터 ↔ 부두 끝': [C.lake, at(df, 0, -4), at(df, 0, 6.5)],
    '섬 ↔ 섬 부두 끝': [C.lake, at(pf, 0, 6), at(pf, 0, 13)],
    '강 둑 ↔ 나루 판자 끝': [C.river, { x: RIVER.x - 78, z: -26 }, { x: RIVER.x - 78, z: -35 }],
  };
  for (const [name, [st, a, b]] of Object.entries(routes)) {
    for (const fps of [144, 60, 30, 20]) {
      assert.ok(walk(st, a, b, 1 / fps) < 0.5, `${name} → (${fps}fps)`);
      assert.ok(walk(st, b, a, 1 / fps) < 0.5, `${name} ← (${fps}fps)`);
    }
  }
});

test('바깥 경계는 막혀 있다(물·판자 옆으로 못 나간다)', () => {
  const df = C.story.dockPier;
  const push = (stage, from, dir) => {
    const p = { ...from };
    for (let i = 0; i < 240; i++) {
      p.x += dir.x * SPEED / 60;
      p.z += dir.z * SPEED / 60;
      stage.collide(p, PLAYER_R);
    }
    return p;
  };
  const back = local(df, push(C.lake, at(df, 0, -4), { x: -df.s, z: -df.c }));
  assert.ok(back.z >= -7.5 + PLAYER_R - 0.05, `빈터 뒤 ${back.z}`);
  const side = local(df, push(C.lake, at(df, 0, 3), { x: df.c, z: -df.s }));
  assert.ok(side.x <= 0.75 - PLAYER_R + 0.05, `판자 옆 ${side.x}`);
});

test('진행 계산: 순서가 자유로운 곳은 어느 쪽을 먼저 해도 같은 다음 차례', () => {
  const seen = (ids) => { story.seen = new Set(ids); story.found = new Set(); };
  const CH1 = ['arrival', 'dusk', 'dawn', 'light1', 'shadows', 'return', 'founders', 'lookout', 'promise', 'line', 'last', 'finale'];
  seen(CH1);
  C.flags = new Set();
  assert.deepEqual(C._derive(true), { ch: 2, step: 'ferry' });
  seen([...CH1, 'ferry', 'landing']);
  for (const order of [['islandbook', 'spare'], ['spare', 'islandbook']]) {
    story.found = new Set([order[0]]);
    assert.equal(C._derive(true).step, 'search');
    story.found.add(order[1]);
    assert.equal(C._derive(true).step, 'call');
  }
  seen([...CH1, 'ferry', 'landing', 'relief', 'bowls', 'count']);
  for (const order of [['manifest', 'tag'], ['tag', 'manifest']]) {
    story.found = new Set([order[0]]);
    assert.equal(C._derive(true).step, 'store');
    story.found.add(order[1]);
    assert.equal(C._derive(true).step, 'compare');
  }
  seen([...CH1, 'ferry', 'landing', 'relief', 'bowls', 'count', 'key', 'knock', 'chair', 'roll']);
  story.found = new Set(['transfer']);
  for (const order of [['lampDoor', 'lampYard'], ['lampYard', 'lampDoor']]) {
    C.flags = new Set([order[0]]);
    assert.equal(C._derive(true).step, 'lamps');
    C.flags.add(order[1]);
    assert.equal(C._derive(true).step, 'wait');
  }
  // 첫 귀환 직후 닫혔다가 다시 열면: 첫 귀환 장면부터
  C.flags = new Set(['lampDoor', 'lampYard', 'home1']);
  assert.equal(C._derive(true).step, 'firsthome');
  story.seen = new Set();
  story.found = new Set();
  C.flags = new Set();
});

test('lumen.chapters: 깨진 저장은 버리고, 더 새 버전 저장은 읽지도 덮어쓰지도 않는다', async () => {
  const { loadChapterFlags } = await load('src/chapters.js');
  localStorage.setItem('lumen.chapters', '{broken');
  assert.deepEqual([...loadChapterFlags().flags], []);
  localStorage.setItem('lumen.chapters', JSON.stringify({ v: 1, flags: ['home1', 'nope', 'flip'] }));
  assert.deepEqual([...loadChapterFlags().flags].sort(), ['flip', 'home1']);
  const newer = JSON.stringify({ v: 2, flags: ['home1'], extra: 1 });
  localStorage.setItem('lumen.chapters', newer);
  const r = loadChapterFlags();
  assert.equal(r.newer, true);
  C.flags = r.flags;
  C.locked = r.newer;
  C._setFlag('lampDoor');
  assert.equal(localStorage.getItem('lumen.chapters'), newer, '더 새 버전 저장을 v1으로 덮어쓰면 안 된다');
  C.locked = false;
  C.flags = new Set();
  localStorage.removeItem('lumen.chapters');
});
