// 1장 회귀: 배전함 여덟 곳을 고쳐 엔딩까지, 승리 화면의 '다음 장'으로 2장 진입.
//   node tests/e2e/chapter1.mjs [url]
import { launch } from './cdp.mjs';

const [,, url = 'http://127.0.0.1:8000/?debug'] = process.argv;
const B = await launch(url, 1280, 720);
for (let i = 0; i < 60; i++) {
  if (await B.ev('return !!(window.lumen && lumen.game.ready)')) break;
  await B.sleep(500);
}
const ok = [];
const check = (n, c, i) => { ok.push(!!c); console.log(`${c ? 'OK ' : 'NG '} ${n}${i !== undefined ? ` — ${JSON.stringify(i)}` : ''}`); };
let r = await B.ev(`
  const L = lumen;
  const settle = () => { for (let i = 0; i < 60; i++) { if (L.dialogue.docOpen) L.dialogue.closeDoc(); if (L.dialogue.scene) L.dialogue.skip(); L.step(0.5); if (L.game.state !== 'story' && !L.dialogue.busy && !L.storyQueue.length) return; } };
  L.startGame(); L.step(0.3); settle();
  const scenes = [];
  const boxes = L.world.fuseBoxes.slice();
  for (const b of boxes) {
    L.player.fuses = Math.max(1, L.player.fuses);
    L.player.pos.set(b.ix, L.world.heightAt(b.ix, b.iz), b.iz);
    L.step(0.1);
    L.input.keys.add('KeyE'); L.step(2.0); L.input.keys.delete('KeyE');
    for (let i = 0; i < 12 && L.game.state !== 'end'; i++) { L.step(0.5); if (L.dialogue.scene) { scenes.push(L.dialogue.scene.id); settle(); } }
    if (L.game.state === 'end') break;
  }
  return { zones: L.world.poweredZones, state: L.game.state, scenes, title: document.getElementById('end-title').textContent, text: document.getElementById('end-text').textContent,
    next: document.getElementById('next-chapter-btn').classList.contains('hidden') ? null : document.getElementById('next-chapter-btn').textContent,
    walk: !document.getElementById('continue-btn').classList.contains('hidden') };`);
check('1장 아홉 구역을 고치면 엔딩과 승리 화면', r.state === 'end' && r.title === '첫 불이 돌아왔다' && r.scenes.includes('finale'), r);
check('승리 화면에 산책과 다음 장 단추', r.walk && r.next && r.next.includes('2장'), r.next);
await B.sleep(500);
await B.shot('ch1-win');
r = await B.ev(`document.getElementById('next-chapter-btn').click(); lumen.step(0.4); return { ch: lumen.game.chapter, step: lumen.chapters.step, state: lumen.game.state }`);
check('다음 장 단추로 2장 시작', r.ch === 2 && r.step === 'ferry', r);
const errs = B.logs.filter((l) => /error|exception/i.test(l) && !/caches|online|fetch|CORS|ERR_/i.test(l));
check('콘솔 오류 없음', errs.length === 0, errs);
console.log(`${ok.filter(Boolean).length}/${ok.length}`);
B.close();
process.exit(ok.every(Boolean) ? 0 : 1);
