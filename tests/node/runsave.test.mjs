// 판 저장 lumen.run v1의 선택 항목 run.pendingTake(#14 '보급품 요청 도중 탭이 죽으면'): 저장·복원, 틀린 값은 그 항목만 버림.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, load, localStorage } from './env.mjs';

const { world } = await makeGame();
const { captureRun, writeRun, readRun, RUN_KEY } = await load('src/runsave.js');

world.reset(7);
const player = { pos: { x: 3, z: 4 }, facing: 0, hp: 80, battery: 50, fuses: 1, bandages: 2, cans: 0, flashOn: false };
const car = { pos: { x: 4, z: 13 }, a: 0, fuel: 40, lamp: false };
const env = { day: 2, hour: 12, rainyNight: true, rainLevel: 0 };
const shades = { banished: 3 };
const game = { driving: false, nights: 1, returned: 3, cacheTaken: 0 };
const ID = `c_${'a'.repeat(26)}`;

test('꺼내기가 오가는 중이면 그 상자를 저장하고, 그대로 읽어 온다', () => {
  writeRun(captureRun({ world, player, car, env, game: { ...game, pendingTake: { id: ID, kind: 'bandage' } }, shades }));
  const r = readRun(world);
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.run.run.pendingTake, { id: ID, kind: 'bandage' });
});

test('없으면 null, 형식이 틀리면 그 항목만 버리고 판은 이어 간다', () => {
  writeRun(captureRun({ world, player, car, env, game, shades }));
  assert.equal(readRun(world).run.run.pendingTake, null);
  const raw = JSON.parse(localStorage.getItem(RUN_KEY));
  for (const bad of [{ id: 'nope', kind: 'bandage' }, { id: ID, kind: 'fuse' }, 'x', 7]) {
    raw.run.pendingTake = bad;
    localStorage.setItem(RUN_KEY, JSON.stringify(raw));
    const r = readRun(world);
    assert.equal(r.status, 'ok', JSON.stringify(bad));
    assert.equal(r.run.run.pendingTake, null, JSON.stringify(bad));
  }
  localStorage.removeItem(RUN_KEY);
});

// 난이도 단계(#56): 보통이 아니면 run.diff에 남고, 없거나 모르는 이름이면 보통으로 읽는다(판은 이어 간다).
test('난이도: 쉬움·어려움은 저장되고, 보통은 빠지며, 틀린 이름은 보통으로 읽는다', () => {
  for (const level of ['easy', 'hard']) {
    writeRun(captureRun({ world, player, car, env, game: { ...game, difficulty: level }, shades }));
    assert.equal(JSON.parse(localStorage.getItem(RUN_KEY)).run.diff, level);
    assert.equal(readRun(world).run.run.diff, level);
  }
  writeRun(captureRun({ world, player, car, env, game: { ...game, difficulty: 'normal' }, shades }));
  const raw = JSON.parse(localStorage.getItem(RUN_KEY));
  assert.equal('diff' in raw.run, false);
  assert.equal(readRun(world).run.run.diff, 'normal');
  for (const bad of ['nightmare', 3, null, {}]) {
    raw.run.diff = bad;
    localStorage.setItem(RUN_KEY, JSON.stringify(raw));
    const r = readRun(world);
    assert.equal(r.status, 'ok', JSON.stringify(bad));
    assert.equal(r.run.run.diff, 'normal', JSON.stringify(bad));
  }
  localStorage.removeItem(RUN_KEY);
});

// 밤 사건(#57): 오늘 밤 사건과 어젯밤 사건이 따로 남는다(낮에 저장·이어해도 같은 사건이 이틀 연달아 오지 않게, #68 리뷰).
test('밤 사건: 오늘 밤·어젯밤 사건을 따로 저장하고, 모르는 값은 버린다', () => {
  writeRun(captureRun({ world, player, car, env, game: { ...game, nightEvent: null, prevEvent: 'fog' }, shades }));
  let r = readRun(world).run.run;
  assert.equal(r.event, null);
  assert.equal(r.prev, 'fog');
  writeRun(captureRun({ world, player, car, env, game: { ...game, nightEvent: 'surge', prevEvent: 'surge' }, shades }));
  r = readRun(world).run.run;
  assert.deepEqual([r.event, r.prev], ['surge', 'surge']);
  const raw = JSON.parse(localStorage.getItem(RUN_KEY));
  raw.run.event = 'quake';
  raw.run.prev = 3;
  localStorage.setItem(RUN_KEY, JSON.stringify(raw));
  r = readRun(world);
  assert.equal(r.status, 'ok');
  assert.deepEqual([r.run.run.event, r.run.run.prev], [null, null]);
  localStorage.removeItem(RUN_KEY);
});
