// server/src/slots.js를 src/slots.js와 마을 생성 결과로 다시 만든다.
import { writeFileSync } from 'node:fs';
import { computeSlots, generatedPath, render } from './world-node.mjs';

const slots = await computeSlots();
writeFileSync(generatedPath, render(slots));
console.log(`layout ${slots.layout}: 막힌 칸 ${slots.blocked.length} / ${slots.count} → ${generatedPath}`);
