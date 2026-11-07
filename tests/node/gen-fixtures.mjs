// 시험 기준값을 지금 코드에서 다시 뽑는다. 기록 자리나 옷가지를 일부러 바꿨을 때만 돌린다:
//   node tests/node/gen-fixtures.mjs
// 옷가지 id는 한 번 배포하면 바꾸거나 빼지 않는다(DECISIONS.md) — 목록에 더해지기만 해야 한다.
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { makeGame, load, repo } from './env.mjs';

const dir = path.join(repo, 'tests/node/fixtures');
const { story } = await makeGame();
const spots = story.spots.map((s) => ({ id: s.clue.id, x: +s.x.toFixed(2), z: +s.z.toFixed(2) }));
writeFileSync(path.join(dir, 'story-spots.json'), `${JSON.stringify(spots, null, 2)}\n`);

const { ITEMS } = await load('src/wardrobe.js');
const file = path.join(dir, 'wardrobe-ids.json');
const old = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
const ids = [...new Set([...old, ...ITEMS.map((it) => it.id)])];
writeFileSync(file, `${JSON.stringify(ids, null, 2)}\n`);
console.log(`story spots ${spots.length}, wardrobe ids ${ids.length}`);
