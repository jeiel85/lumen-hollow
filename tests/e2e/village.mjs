// 마을 번호(#59): 1장을 마치기 전에는 고를 수 없고, 마친 뒤 새 판 화면에서 다른 마을(번호)을 고르면 다시 열어 그 마을에서 판이 시작된다.
// 다른 마을에는 1장 기록·공유 보급품이 없고, 판 저장·이어하기·일시정지에 번호가 남으며, 2~4장은 기본 마을로 다시 열어 시작한다.
//   node tests/e2e/village.mjs [url] [폭 높이]
import { launch, fullGame } from './cdp.mjs';

const [,, url = 'http://127.0.0.1:8000/?debug', w = '960', h = '540'] = process.argv;
const B = await launch(fullGame(url), +w, +h);
const ok = [];
const check = (n, c, i) => { ok.push(!!c); console.log(`${c ? 'OK ' : 'NG '} ${n}${i !== undefined ? ` — ${JSON.stringify(i)}` : ''}`); };
const ready = async () => {
  await B.sleep(800);
  for (let i = 0; i < 80; i++) { if (await B.ev('return !!(window.lumen && lumen.game.ready)')) return true; await B.sleep(500); }
  return false;
};
await ready();
const CH1 = ['arrival', 'dusk', 'dawn', 'light1', 'shadows', 'return', 'founders', 'lookout', 'promise', 'line', 'last'];

// 1장을 마치기 전: 새 판 화면에 마을 고르기가 없다
let r = await B.ev(`
  const $ = (id) => document.getElementById(id);
  localStorage.removeItem('lumen.run');
  for (const id of ${JSON.stringify(CH1)}) lumen.story.markSeen(id);
  $('start-btn').click();
  const hidden = $('new-village-row').classList.contains('hidden') && $('new-village-pick').classList.contains('hidden');
  $('new-no').click();
  return { hidden, village: lumen.world.village };`);
check('1장을 마치기 전에는 마을 고르기가 없다(기본 마을)', r.hidden && r.village === 0, r);

// 1장을 마친 뒤: 기본 마을이 골라져 있고, 다른 마을을 고르면 번호 칸(6자리)과 안내. 숫자 말고는 지워지고, 0은 거절.
r = await B.ev(`
  const $ = (id) => document.getElementById(id);
  lumen.story.markSeen('finale');
  $('start-btn').click();
  const row = !$('new-village-row').classList.contains('hidden');
  const first = document.querySelector('input[name="new-village"]:checked')?.value;
  const other = document.querySelector('input[name="new-village"][value="other"]');
  other.checked = true; other.dispatchEvent(new Event('change'));
  const pick = !$('new-village-pick').classList.contains('hidden');
  const rolled = $('new-village-num').value;
  const num = $('new-village-num');
  num.value = '12ab3'; num.dispatchEvent(new Event('input'));
  const filtered = num.value;
  num.value = '0'; num.dispatchEvent(new Event('input'));
  $('new-yes').click();
  const refused = { state: lumen.game.state, note: $('new-village-note').textContent };
  num.value = '482913'; num.dispatchEvent(new Event('input'));
  const easy = document.querySelector('input[name="new-difficulty"][value="easy"]');
  easy.checked = true; easy.dispatchEvent(new Event('change'));
  setTimeout(() => $('new-yes').click(), 50); // 다시 연다: 평가가 끝난 뒤에 누른다
  return { row, first, pick, rolled, filtered, refused };`);
check('1장을 마치면 마을 고르기(처음엔 기본 마을), 다른 마을이면 번호 칸', r.row && r.first === 'home' && r.pick && /^[0-9]{1,6}$/.test(r.rolled) && Number(r.rolled) >= 1, r);
check('번호 칸은 숫자만, 0은 거절하고 판을 시작하지 않는다', r.filtered === '123' && r.refused.state === 'title' && /1부터/.test(r.refused.note), r);

const reopened = await ready();
r = await B.ev(`
  const L = lumen;
  return { reopened: true, village: L.world.village, state: L.game.state, diff: L.game.difficulty, spots: L.story.spots.length,
    names: Object.values(L.world.zones).map((z) => z.name), boot: localStorage.getItem('lumen.boot'), live: L.game.onlineLive };`);
check('다시 열려 마을 482913에서 판이 바로 시작된다(고른 난이도 그대로)', reopened && r.village === 482913 && r.state !== 'title' && r.diff === 'easy' && r.boot === null, r);
check('다른 마을에는 1장 기록이 없고 보급품에 이어지지 않는다, 구역 이름은 그 마을 배치대로', r.spots === 0 && !r.live && r.names.join() !== '서북 농장,약국 거리,동북 주택가,서쪽 공원,골목식당 거리,헛간 들판,남쪽 광장,은신처,동남 주택가', r);
await B.ev(`
  const L = lumen; L.story.scenesFor = () => [];
  for (let i = 0; i < 30 && (L.dialogue.scene || L.game.state === 'story'); i++) { if (L.dialogue.scene) L.dialogue.skip(); L.step(0.3); }
  L.env.setHour(13); L.step(0.5);`);
await B.sleep(500);
await B.shot(`village-482913-${w}x${h}`);

// 판 저장·일시정지·이어하기: 번호가 남고, 처음 화면으로 나가 다시 열어도 그 마을로 지어 이어 간다
r = await B.ev(`
  const L = lumen, $ = (id) => document.getElementById(id);
  L.pauseGame(true);
  const pause = $('pause-diff').textContent;
  L.pauseGame(false);
  L.saveRun();
  const saved = JSON.parse(localStorage.getItem('lumen.run')).village;
  L.backToTitle();
  const info = $('run-info').textContent;
  setTimeout(() => location.reload(), 50);
  return { pause, saved, info };`);
check('일시정지·판 저장·처음 화면 요약에 마을 번호', /마을 482913/.test(r.pause) && r.saved === 482913 && /마을 482913/.test(r.info), r);
await ready();
r = await B.ev(`
  const L = lumen;
  const village = L.world.village;
  const status = L.readRun().status;
  L.resumeGame(); L.step(0.2);
  return { village, status, state: L.game.state };`);
check('다시 열면 저장된 판의 마을로 지어 이어 간다', r.village === 482913 && r.status === 'ok' && r.state !== 'title', r);

// 2~4장은 기본 마을에서: 다른 마을에서 '다음 장'을 누르면 기본 마을로 다시 열어 2장이 시작된다
r = await B.ev(`
  lumen.backToTitle();
  setTimeout(() => lumen.startChapter(), 50);
  return true;`);
await ready();
await B.sleep(1500);
r = await B.ev(`return { village: lumen.world.village, chapter: lumen.game.chapter, run: localStorage.getItem('lumen.run') && JSON.parse(localStorage.getItem('lumen.run')).village };`);
check('2~4장은 기본 마을로 다시 열어 시작한다(다른 마을의 판 저장은 남는다)', r.village === 0 && r.chapter === 2 && r.run === 482913, r);

// 기본 마을에서 다른 마을의 판: 새로 시작하면 지워진다고 경고하고, 이어하기는 그 마을로 다시 열어 이어 간다
r = await B.ev(`
  const $ = (id) => document.getElementById(id);
  lumen.backToTitle();
  const info = $('run-info').textContent;
  const resume = $('resume-run-btn').classList.contains('hidden') ? null : $('resume-run-btn').textContent;
  $('start-btn').click();
  const warn = $('run-info').textContent;
  $('new-no').click();
  setTimeout(() => $('resume-run-btn').click(), 50);
  return { info, resume, warn };`);
check('기본 마을에서 다른 마을의 판: 이어하기에 번호, 새로 시작하면 지워진다고 경고', /마을 482913에서 하던 판/.test(r.info) && r.resume === '이어하기 · 마을 482913' && /마을 482913에서 하던 판이 지워져요/.test(r.warn), r);
await ready();
await B.sleep(500);
r = await B.ev(`return { village: lumen.world.village, state: lumen.game.state, chapter: lumen.game.chapter };`);
check('이어하기를 누르면 그 마을로 다시 열어 판을 이어 간다', r.village === 482913 && r.state !== 'title' && r.chapter === 0, r);

const errs = B.logs.filter((l) => /error|exception/i.test(l) && !/caches|online|fetch|CORS|ERR_/i.test(l));
check('콘솔 오류 없음', errs.length === 0, errs);
console.log(`\n${ok.filter(Boolean).length}/${ok.length} 통과`);
B.close();
process.exit(ok.every(Boolean) ? 0 : 1);
