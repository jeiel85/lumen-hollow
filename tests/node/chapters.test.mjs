// 2~4장(#32): 무대의 걸을 수 있는 영역 이음매를 실제 이동 식으로 넘는지, 진행 계산, 저장 형식.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, load, localStorage } from './env.mjs';

const { story, chapters: C } = await makeGame({ chapters: true });
const { SPEED, PLAYER_R, FLASH_RANGE } = await load('src/player.js');
const { RIVER, BED_REACH } = await load('src/chapters.js');

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
  // 2장(#58): 첫 대면 뒤 등잔 넷(어느 순서든) → 당직 수칙 → 첫 밤 당직 → 인계부·보관함
  seen([...CH1, 'ferry', 'landing']);
  const LANTERNS = ['lampTower', 'lampSteps', 'lampHut', 'lampDock'];
  for (const order of [LANTERNS, [...LANTERNS].reverse()]) {
    C.flags = new Set();
    for (const f of order) {
      assert.equal(C._derive(true).step, 'oil');
      C.flags.add(f);
    }
    assert.equal(C._derive(true).step, 'rules');
  }
  seen([...CH1, 'ferry', 'landing', 'rules']);
  assert.equal(C._derive(true).step, 'vigil');
  C.flags.add('vigil');
  for (const order of [['islandbook', 'spare'], ['spare', 'islandbook']]) {
    story.found = new Set([order[0]]);
    assert.equal(C._derive(true).step, 'search');
    story.found.add(order[1]);
    assert.equal(C._derive(true).step, 'call');
  }
  // 0.23.0까지의 저장: 이미 대타를 불렀으면 등잔·첫 밤을 건너뛴다.
  // 대타 뒤에는 등대 문 앞(「둘이 정할 것」)을 거쳐 두 그릇(장마다 12장면 보강, 두 그릇 전이라 이 저장도 거친다)
  C.flags = new Set();
  seen([...CH1, 'ferry', 'landing', 'relief']);
  assert.equal(C._derive(true).step, 'tour');
  seen([...CH1, 'ferry', 'landing', 'relief', 'switch']);
  assert.equal(C._derive(true).step, 'bowls');
  // 3장(#58): 열두 번째 칸 → 침상 다섯(봉투 순서 자유) → 다섯 자리 → 창고
  seen([...CH1, 'ferry', 'landing', 'relief', 'bowls', 'count']);
  story.found = new Set();
  const BEDS = ['bed3', 'bed8', 'bed11', 'bed14', 'bed20'];
  for (const order of [BEDS, [...BEDS].reverse()]) {
    story.found = new Set();
    for (const id of order) {
      assert.equal(C._derive(true).step, 'beds');
      story.found.add(id);
    }
    assert.equal(C._derive(true).step, 'fivebeds');
  }
  seen([...CH1, 'ferry', 'landing', 'relief', 'bowls', 'count', 'fivebeds']);
  for (const order of [['manifest', 'tag'], ['tag', 'manifest']]) {
    story.found = new Set([order[0]]);
    assert.equal(C._derive(true).step, 'store');
    story.found.add(order[1]);
    assert.equal(C._derive(true).step, 'compare');
  }
  // 사진을 이미 뒤집은 저장(0.23.0)은 침상을 건너뛴다. 문 밖의 아이 뒤에는 둑길 밤길 → 반납 → 별관
  C.flags = new Set(['flip']);
  seen([...CH1, 'ferry', 'landing', 'relief', 'bowls', 'count']);
  story.found = new Set();
  assert.equal(C._derive(true).step, 'key');
  seen([...CH1, 'ferry', 'landing', 'relief', 'bowls', 'count', 'key', 'knock']);
  assert.equal(C._derive(true).step, 'levee');
  seen([...CH1, 'ferry', 'landing', 'relief', 'bowls', 'count', 'key', 'knock', 'stretchers']);
  assert.equal(C._derive(true).step, 'back');
  story.found = new Set(['transfer']);
  assert.equal(C._derive(true).step, 'annex');
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
  // 4장 끝(#58): 세 사람 → (섬에서 온 무전) → 남은 창 → 길 내기 → (아침 점호) → 아침 방송 → 첫 제보 다음 → 끝
  // 괄호는 장마다 12장면 보강에서 끼운 차례. 남은 창을 이미 본 저장은 무전을 건너뛴다.
  const CH4 = [...CH1, 'ferry', 'landing', 'relief', 'bowls', 'count', 'key', 'knock', 'chair', 'roll', 'firsthome', 'secondhome', 'truth'];
  C.flags = new Set(['lampDoor', 'lampYard', 'home1', 'home2']);
  seen(CH4);
  assert.equal(C._derive(true).step, 'island');
  seen([...CH4, 'island']);
  assert.equal(C._derive(true).step, 'third');
  seen([...CH4, 'third']);
  assert.equal(C._derive(true).step, 'route');
  C.flags.add('home3');
  assert.equal(C._derive(true).step, 'rollcall');
  seen([...CH4, 'third', 'rollcall']);
  assert.equal(C._derive(true).step, 'broadcast');
  // 0.23.0에서 방송까지 마친 저장은 세 번째 그림자 없이 「첫 제보 다음」만 본다
  C.flags.delete('home3');
  seen([...CH4, 'broadcast']);
  assert.equal(C._derive(true).step, 'reports');
  assert.equal(C.done, false);
  seen([...CH4, 'broadcast', 'reports']);
  assert.deepEqual(C._derive(true), { ch: 5 });
  assert.equal(C.done, true);
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

// #58: 새 할 일 자리(등잔·기름·무전·침상·바구니·수첩·이름표·배전반)마다 손이 닿는 거리 안에 설 수 있는 빈 땅이 있다.
test('새 할 일 자리마다 손 닿는 거리 안에 설 자리가 있고, 가까운 자리끼리 겹치지 않는다', () => {
  const ids = ['lampTower', 'lampSteps', 'lampHut', 'lampDock', 'oilCan', 'oilBottle', 'radio', 'basket', 'carrybook',
    'bed3', 'bed8', 'bed11', 'bed14', 'bed20', 'tag1958', 'tag1960', 'tag1963', 'tag1986', 'tag1991', 'board'];
  for (const id of ids) {
    const s = C.spot(id);
    assert.ok(s, `${id} 자리가 없다`);
    const st = s.stage;
    const reach = s.reach ?? 1.8;
    let free = null;
    for (let r = 0.3; r < reach && !free; r += 0.2) {
      for (let k = 0; k < 16 && !free; k++) {
        const p = { x: s.x + Math.cos((k / 16) * Math.PI * 2) * r, z: s.z + Math.sin((k / 16) * Math.PI * 2) * r };
        const q = { ...p };
        st.collide(q, PLAYER_R);
        if (Math.hypot(q.x - p.x, q.z - p.z) < 1e-6) free = p;
      }
    }
    assert.ok(free, `${id}: 손 닿는 거리 안에 설 자리가 없다`);
    // 그 자리에서 가장 가까운 자리가 자기 자신이어야 한다(옆 자리와 안내가 뒤섞이지 않게)
    const near = C.spots.filter((o) => o.stage === st && o !== s && Math.hypot(o.x - free.x, o.z - free.z) < Math.hypot(s.x - free.x, s.z - free.z));
    assert.deepEqual(near.map((o) => o.id).filter((o) => ids.includes(o) && !id.startsWith('bed')), [], `${id} 옆에 더 가까운 자리`);
  }
});

// 4장 세 번째 그림자(배전반 길 내기): 화살표가 세우는 본관 침상 자리에서 손전등이 닿는 곳은 모두 인정 거리 안이라, 보이자마자
// 비춰도 그림자 빠르기(난이도)와 상관없이 통과한다. 틀린 길(가운데·동쪽)로 온 그림자는 길 끝 둘레(약 1.3m)를 맴돌아도 걸러진다.
test('4장 세 번째 그림자: 침상 자리에서 비추면 언제 흩어도 인정되고, 틀린 길은 걸러진다', () => {
  const b = C.river.bedsMark;
  const dist = (p) => Math.hypot(p.x - b.x, p.z - b.z);
  // 길(출발점 → 길목들)에서 침상에 가장 가까운 거리
  const closest = (pts) => {
    let d = Infinity;
    for (let i = 1; i < pts.length; i++) {
      for (let t = 0; t <= 40; t++) {
        d = Math.min(d, dist({ x: pts[i - 1].x + ((pts[i].x - pts[i - 1].x) * t) / 40, z: pts[i - 1].z + ((pts[i].z - pts[i - 1].z) * t) / 40 }));
      }
    }
    return d;
  };
  assert.ok(BED_REACH >= FLASH_RANGE, `인정 거리 ${BED_REACH}m가 손전등 ${FLASH_RANGE}m보다 짧다`);
  for (const p of C.river.lanes.west.slice(-2)) assert.ok(dist(p) <= BED_REACH, `서쪽 길 마지막 구간이 인정 거리 밖: ${dist(p).toFixed(1)}m`);
  for (const lane of ['mid', 'east']) {
    const d = closest([C.river.target3, ...C.river.lanes[lane]]);
    assert.ok(d > BED_REACH + 2, `${lane} 길이 침상에 ${d.toFixed(1)}m까지 온다(인정 ${BED_REACH}m + 2m 안)`);
  }
});
