// 걸어서 가기(#32): 순간이동 없이 실제 입력 경로(input.moveScreen)로 조향해 60fps 간격(step의 dt=1/60)으로 걷는다.
// 2장 시작 빈터 → 선착장 판자 → 나룻배 옆에서 '나룻배에 오르기'가 뜨는지, 3장 둑 → 나루 판자 끝까지 가는지.
//   node tests/e2e/walk.mjs [url]
// 걸을 수 있는 영역 이음매 자체는 tests/node/chapters.test.mjs가 여러 프레임 간격으로 본다.
import { launch, fullGame } from './cdp.mjs';

const [,, rawUrl = 'http://127.0.0.1:8000/?debug'] = process.argv;
const url = fullGame(rawUrl); // 2~4장도 시험하므로 앱처럼 연다(#50)
const B = await launch(url, 960, 540);
const ok = [];
const check = (n, c, i) => { ok.push(!!c); console.log(`${c ? 'OK ' : 'NG '} ${n}${i !== undefined ? ` — ${JSON.stringify(i)}` : ''}`); };
for (let i = 0; i < 60; i++) {
  if (await B.ev('return !!(window.lumen && lumen.game.ready)')) break;
  await B.sleep(500);
}
const CH1 = ['arrival', 'dusk', 'dawn', 'light1', 'shadows', 'return', 'founders', 'lookout', 'promise', 'line', 'last', 'finale'];

// 경유점을 차례로 지나도록 화면 기준 입력을 돌린다(아이소 카메라 화면 축: 오른쪽 (1,0,-1)/√2, 아래 (1,0,1)/√2).
const STEER = `
  window.W = { route: [] };
  lumen.input.moveScreen = () => {
    const P = lumen.player.pos; const t = W.route[0];
    if (!t) return { x: 0, y: 0 };
    const dx = t.x - P.x, dz = t.z - P.z, d = Math.hypot(dx, dz);
    if (d < 0.5) { W.route.shift(); return { x: 0, y: 0 }; }
    return { x: (dx - dz) * Math.SQRT1_2 / d, y: (dx + dz) * Math.SQRT1_2 / d };
  };
  const skip = () => { for (let i = 0; i < 40 && (lumen.dialogue.scene || lumen.game.state === 'story' || lumen.storyQueue.length); i++) { if (lumen.dialogue.scene) lumen.dialogue.skip(); lumen.step(0.5); } };
`;

let r = await B.ev(`
  ${STEER}
  for (const id of ${JSON.stringify(CH1)}) lumen.story.markSeen(id);
  lumen.startChapter(); lumen.step(2.0); skip(); // 장 시작 장면(배웅·둑길 위의 자국)은 제목 카드 뒤 1.6초에 나온다
  const df = lumen.chapters.story.dockPier; const s = lumen.chapters.spot('boatVillage');
  W.route = [[0, -2.6], [0, 3.6]].map(([x, z]) => ({ x: df.px(x, z), z: df.pz(x, z) })).concat([s]);
  lumen.step(8, 1 / 60);
  const P = lumen.player.pos; const lz = (P.x - df.x) * df.s + (P.z - df.z) * df.c;
  return { step: lumen.chapters.step, left: W.route.length, pierLocalZ: +lz.toFixed(2), near: lumen.chapters.nearest(P.x, P.z)?.label ?? null };`);
// 마지막 경유점은 판자 옆에 묶인 배라 닿지 못한다(판자 끝에서 손이 닿으면 된다).
check('2장: 시작 빈터 → 선착장 판자 → 나룻배 옆까지 걸어가 "나룻배에 오르기"', r.step === 'ferry' && r.left <= 1 && r.pierLocalZ > 0 && r.near === '나룻배에 오르기', r);

r = await B.ev(`
  ${STEER}
  for (const id of ['ferry', 'landing', 'relief', 'bowls']) lumen.story.markSeen(id);
  lumen.story.markFound('islandbook'); lumen.story.markFound('spare');
  lumen.backToTitle(); lumen.step(0.3); lumen.startChapter(); lumen.step(2.0); skip(); // 장 시작 장면(배웅·둑길 위의 자국)은 제목 카드 뒤 1.6초에 나온다
  const RV = { x: 300, z: 0 };
  const from = { x: RV.x - 78, z: -26 };
  lumen.player.pos.set(from.x, lumen.ground.heightAt(from.x, from.z), from.z);
  W.route = [{ x: RV.x - 78, z: -35 }];
  lumen.step(4, 1 / 60);
  const end = +(lumen.player.pos.z - RV.z).toFixed(2);
  W.route = [{ x: RV.x - 78, z: -26 }];
  lumen.step(4, 1 / 60);
  return { ch: lumen.game.chapter, end, back: +(lumen.player.pos.z - RV.z).toFixed(2) };`);
check('3장: 강 둑 → 나루 판자 끝 → 다시 둑', r.ch === 3 && r.end < -34 && r.back > -26.6, r);

const errs = B.logs.filter((l) => /error|exception/i.test(l) && !/caches|online|fetch|CORS|ERR_/i.test(l));
check('콘솔 오류 없음', errs.length === 0, errs);
console.log(`\n${ok.filter(Boolean).length}/${ok.length} 통과`);
B.close();
process.exit(ok.every(Boolean) ? 0 : 1);
