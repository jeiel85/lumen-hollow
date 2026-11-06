// 서버의 막힌 칸 목록(server/src/slots.js)이 지금 마을 생성 결과와 같은지 확인한다.
// 어긋나면 world.js나 src/slots.js가 바뀐 것이다: SLOT_LAYOUT을 올릴지 정하고 `npm run gen-slots`로 다시 만든다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeSlots, generatedPath, render } from '../scripts/world-node.mjs';

test('server/src/slots.js가 마을 생성 결과와 같다', async () => {
  const slots = await computeSlots();
  assert.equal(readFileSync(generatedPath, 'utf8').replace(/\r\n/g, '\n'), render(slots));
  assert.equal(slots.count - slots.blocked.length, 516);
});
