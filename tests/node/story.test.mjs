// 이야기 소품과 공유 보급품 슬롯의 약속(#20), 1장 기록 자리(#25), 옷가지 id 규칙(#15).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { makeGame, load, repo } from './env.mjs';

const fixture = (name) => JSON.parse(readFileSync(path.join(repo, 'tests/node/fixtures', name), 'utf8'));
const warns = [];
const warn = console.warn;
console.warn = (...a) => warns.push(a.join(' '));
const { world, story } = await makeGame({ chapters: true });
console.warn = warn;
const { SLOT_COUNT, blockedSlots, slotPos } = await load('src/slots.js');
const server = await load('server/src/slots.js');

test('소품·2~4장 무대를 다 놓아도 막힌 슬롯 목록이 서버(server/src/slots.js)와 같다', () => {
  assert.deepEqual(blockedSlots(world), [...server.BLOCKED_SLOTS]);
});

test('1장 기록은 모두 빈 슬롯에서 2.1m 이상 떨어진 자리에 놓였다(첫 후보로 물러나지 않았다)', () => {
  assert.deepEqual(warns.filter((w) => w.includes('[story]')), []);
  const free = [];
  const blocked = new Set(server.BLOCKED_SLOTS);
  for (let id = 0; id < SLOT_COUNT; id++) if (!blocked.has(id)) free.push(slotPos(id));
  for (const s of story.spots) {
    const near = free.find((p) => Math.hypot(p.x - s.x, p.z - s.z) < 2.1);
    assert.equal(near, undefined, `${s.clue.id}가 빈 슬롯 ${JSON.stringify(near)} 근처`);
  }
});

test('1장 기록 자리가 기준값과 같다(마을 생성을 바꿨다면 tests/node/gen-fixtures.mjs로 일부러 갱신)', () => {
  const now = story.spots.map((s) => ({ id: s.clue.id, x: +s.x.toFixed(2), z: +s.z.toFixed(2) }));
  assert.deepEqual(now, fixture('story-spots.json'));
});

test('한 번 배포한 옷가지 id는 그대로 있다(바꾸거나 빼면 옛 저장이 기본값으로 돌아간다)', async () => {
  const { ITEMS } = await load('src/wardrobe.js');
  const now = new Set(ITEMS.map((it) => it.id));
  const missing = fixture('wardrobe-ids.json').filter((id) => !now.has(id));
  assert.deepEqual(missing, [], 'DECISIONS.md "옷장": 배포한 id는 바꾸지 않는다');
});

test('컷신 그림마다 화면 낭독기용 설명이 있다(#45)', async () => {
  const { SCENES } = await load('src/script.js');
  const { ART_ALT } = await load('src/dialogue.js');
  const used = new Set(SCENES.flatMap((s) => s.lines.filter((l) => l.art).map((l) => l.art)));
  assert.deepEqual([...used].filter((n) => !ART_ALT[n]), [], '대본 줄의 art에 맞는 설명이 src/dialogue.js ART_ALT에 없다');
  assert.deepEqual(Object.keys(ART_ALT).filter((n) => !used.has(n)), [], '대본이 쓰지 않는 그림의 설명');
});
