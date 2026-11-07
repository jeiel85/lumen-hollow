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
