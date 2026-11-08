// 미니맵: 구석 지도가 보이고, 누르기·V로 전체 지도를 펼치고 Esc·V로 닫는다. 1장 마을과 2·3장 무대를 그린다.
//   node tests/e2e/minimap.mjs [url] [폭 높이]   (폭 700 미만이면 휴대폰으로 흉내 낸다)
import { launch, fullGame } from './cdp.mjs';

const [,, rawUrl = 'http://127.0.0.1:8000/?debug', w = '1280', h = '720'] = process.argv;
const url = fullGame(rawUrl); // 2~4장도 시험하므로 앱처럼 연다(#50)
const B = await launch(url, +w, +h);
const tag = +w < 700 ? (+w < +h ? 'phone' : 'land') : 'desk';
const ok = [];
const check = (n, c, i) => { ok.push(!!c); console.log(`${c ? 'OK ' : 'NG '} ${n}${i !== undefined ? ` — ${JSON.stringify(i)}` : ''}`); };
for (let i = 0; i < 60; i++) {
  if (await B.ev('return !!(window.lumen && lumen.game.ready)')) break;
  await B.sleep(500);
}
const skip = `for (let i = 0; i < 40 && (lumen.dialogue.scene || lumen.game.state === 'story'); i++) { if (lumen.dialogue.scene) lumen.dialogue.skip(); lumen.step(0.3); }`;
const inView = `(() => { const r = document.getElementById('map').getBoundingClientRect(); return r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1; })()`;

let r = await B.ev(`lumen.startGame(); lumen.step(0.5); ${skip}; lumen.player.pos.set(20, 0, 30); lumen.world.powerZone('G'); lumen.env.setHour(21); lumen.step(1);
  const m = document.getElementById('minimap'); const b = m.getBoundingClientRect();
  return { state: lumen.game.state, w: Math.round(b.width), drawn: m.width > 0 && m.getContext('2d').getImageData(m.width / 2, m.height / 2, 1, 1).data[3] > 0 }`);
check('1장: 구석 미니맵이 그려진다', r.state === 'play' && r.w > 60 && r.drawn, r);
await B.sleep(800);
await B.shot(`minimap-${tag}-town`);
r = await B.ev(`document.getElementById('minimap').click(); lumen.step(0.3); return { open: lumen.minimap.isOpen, legend: document.querySelectorAll('#map-legend li').length, inView: ${inView}, state: lumen.game.state }`);
check('미니맵을 누르면 전체 지도(범례 7개, 화면 안), 시간은 흐른다', r.open && r.legend === 7 && r.inView && r.state === 'play', r);
await B.sleep(500);
await B.shot(`minimap-${tag}-full`);
r = await B.ev(`lumen.input.pressed.add('Escape'); lumen.step(0.2); const a = lumen.minimap.isOpen; const st = lumen.game.state;
  lumen.input.pressed.add('KeyV'); lumen.step(0.2); const b = lumen.minimap.isOpen; lumen.input.pressed.add('KeyV'); lumen.step(0.2);
  return { afterEsc: a, stateAfterEsc: st, afterV: b, afterV2: lumen.minimap.isOpen }`);
check('Esc는 지도만 닫고(일시정지 아님), V로 열고 닫는다', !r.afterEsc && r.stateAfterEsc === 'play' && r.afterV && !r.afterV2, r);

r = await B.ev(`for (const id of ['arrival','dusk','dawn','light1','shadows','return','founders','lookout','promise','line','last','finale']) lumen.story.markSeen(id);
  lumen.backToTitle(); lumen.step(0.3); lumen.startChapter(); lumen.step(0.5); ${skip}; lumen.step(0.5);
  document.getElementById('minimap').click(); lumen.step(0.3);
  return { ch: lumen.game.chapter, open: lumen.minimap.isOpen, title: document.getElementById('map-title').textContent, legend: document.querySelectorAll('#map-legend li').length }`);
check('2장: 무대 지도와 장 제목·범례', r.ch === 2 && r.open && r.title.includes('2장') && r.legend === 3, r);
await B.sleep(800);
await B.shot(`minimap-${tag}-ch2`);
r = await B.ev(`lumen.minimap.close(); for (const id of ['ferry','landing','relief','bowls']) lumen.story.markSeen(id); lumen.story.markFound('islandbook'); lumen.story.markFound('spare');
  lumen.backToTitle(); lumen.step(0.3); const closedOnTitle = !lumen.minimap.isOpen; lumen.startChapter(); lumen.step(0.5); ${skip}; lumen.step(0.5);
  document.getElementById('minimap').click(); lumen.step(0.3);
  return { ch: lumen.game.chapter, open: lumen.minimap.isOpen, title: document.getElementById('map-title').textContent, closedOnTitle }`);
check('3장: 강 건너 무대 지도', r.ch === 3 && r.open && r.title.includes('3장'), r);
await B.sleep(800);
await B.shot(`minimap-${tag}-ch3`);
r = await B.ev(`lumen.backToTitle(); lumen.step(0.3); return { open: lumen.minimap.isOpen, hidden: document.getElementById('map').classList.contains('hidden') }`);
check('처음 화면으로 나가면 지도가 닫힌다', !r.open && r.hidden, r);

const errs = B.logs.filter((l) => /error|exception/i.test(l) && !/caches|online|fetch|CORS|ERR_/i.test(l));
check('콘솔 오류 없음', errs.length === 0, errs);
console.log(`\n${ok.filter(Boolean).length}/${ok.length} 통과`);
B.close();
process.exit(ok.every(Boolean) ? 0 : 1);
