// 난이도 단계(#56): 새 판 화면에서 고르기, 판 저장·이어하기에 남기, 단계별 최고 기록, 설정의 난이도, 단계 값이 그늘이·배터리에 걸리는지,
// 2~4장은 설정을 바로 따르는지. 휴대폰 세로에서 새 판 화면이 들어가는지도 찍는다.
//   node tests/e2e/difficulty.mjs [url] [폭 높이]
import { launch, fullGame } from './cdp.mjs';

const [,, url = 'http://127.0.0.1:8000/?debug', w = '960', h = '540'] = process.argv;
const B = await launch(fullGame(url), +w, +h);
const ok = [];
const check = (n, c, i) => { ok.push(!!c); console.log(`${c ? 'OK ' : 'NG '} ${n}${i !== undefined ? ` — ${JSON.stringify(i)}` : ''}`); };
const ready = async () => {
  for (let i = 0; i < 60; i++) { if (await B.ev('return !!(window.lumen && lumen.game.ready)')) return; await B.sleep(500); }
};
await ready();
const CH1 = ['arrival', 'dusk', 'dawn', 'light1', 'shadows', 'return', 'founders', 'lookout', 'promise', 'line', 'last', 'finale'];

// 새 판 화면: 처음에는 보통, 쉬움을 고르면 설정에 남고 설명이 바뀌며, 시작하면 그 단계의 판
let r = await B.ev(`
  const $ = (id) => document.getElementById(id);
  localStorage.removeItem('lumen.run');
  for (const id of ${JSON.stringify(CH1)}) lumen.story.markSeen(id);
  $('start-btn').click();
  const shown = !$('new-confirm').classList.contains('hidden') && $('title-actions').classList.contains('hidden');
  const checked = () => document.querySelector('input[name="new-difficulty"]:checked')?.value;
  const first = { shown, checked: checked(), note: $('new-diff-note').textContent, yes: $('new-yes').textContent, focus: document.activeElement?.id };
  const easy = document.querySelector('input[name="new-difficulty"][value="easy"]');
  easy.checked = true; easy.dispatchEvent(new Event('change'));
  const picked = { setting: lumen.settings.difficulty, saved: JSON.parse(localStorage.getItem('lumen.settings')).difficulty, note: $('new-diff-note').textContent };
  $('new-yes').click(); lumen.step(0.3);
  return { first, picked, state: lumen.game.state, diff: lumen.game.difficulty };`);
check('새로 시작을 누르면 난이도 화면(처음엔 보통, 지울 판이 없으면 시작에 초점)', r.first.shown && r.first.checked === 'normal' && r.first.yes === '시작' && r.first.focus === 'new-yes' && r.first.note.length > 5, r.first);
check('쉬움을 고르면 설정에 남고 설명이 바뀐다', r.picked.setting === 'easy' && r.picked.saved === 'easy' && r.picked.note !== r.first.note, r.picked);
check('시작하면 쉬움 판', r.state === 'play' && r.diff === 'easy', r);

// 쉬움 판의 값: 손전등 배터리가 덜 닳고, 그늘이가 덜 아프게 친다. 판 저장에 쉬움이 남고 이어하면 그대로.
r = await B.ev(`
  const L = lumen, P = L.player;
  L.story.scenesFor = () => [];
  for (let i = 0; i < 30 && (L.dialogue.scene || L.game.state === 'story'); i++) { if (L.dialogue.scene) L.dialogue.skip(); L.step(0.3); }
  L.env.setHour(12); P.pos.set(-48, 0, 48); P.battery = 100; P.flashOn = true; L.step(10, 0.05);
  const drained = +(100 - P.battery).toFixed(2);
  // 그늘이 하나를 바로 옆에 깨워 한 번 맞는다
  // 밤이 깊어질 때까지(env.night가 따라 오를 때까지) 기다린 뒤, 사라지지 않는 목표 그림자 하나를 붙인다
  L.game.peaceful = true; L.env.setHour(23); P.flashOn = false; L.step(1.5, 0.05); P.hp = 100; P.invuln = 0;
  L.shades.clear(); L.shades.spawnTarget(P.pos.x + 0.5, P.pos.z, 'test', { tough: 99 });
  const s = L.shades.list.find((x) => x.active); s.state = 'stalk'; s.fade = 1;
  for (let i = 0; i < 40 && P.hp === 100; i++) L.step(0.05, 0.05);
  const hit = 100 - P.hp;
  L.shades.clear(); L.game.peaceful = false; L.env.setHour(12);
  L.saveRun();
  const saved = JSON.parse(localStorage.getItem('lumen.run')).run.diff;
  L.backToTitle();
  const info = document.getElementById('run-info').textContent;
  L.settings.difficulty = 'hard';
  L.resumeGame(); L.step(0.2);
  return { drained, hit, saved, info, resumed: L.game.difficulty };`);
check('쉬움: 손전등 10초에 약 6.3%(보통 11.5%의 0.55배)', Math.abs(r.drained - 6.3) < 0.5, r.drained);
check('쉬움: 한 번 닿으면 체력 8', r.hit === 8, r.hit);
check('판 저장에 쉬움이 남고, 처음 화면 요약에 보이며, 이어하면 설정과 상관없이 쉬움', r.saved === 'easy' && /쉬움/.test(r.info) && r.resumed === 'easy', r);

// 최고 기록은 단계마다: 쉬움 판이 끝나면 lumen.best.easy만 바뀐다. 처음 화면은 다음 판 단계의 기록을 보인다.
r = await B.ev(`
  const L = lumen;
  localStorage.setItem('lumen.best', JSON.stringify({ nights: 1, zones: 2, winDay: 0 }));
  localStorage.removeItem('lumen.best.easy'); localStorage.removeItem('lumen.best.hard');
  L.game.nights = 4; L.endGame(false);
  const easy = JSON.parse(localStorage.getItem('lumen.best.easy'));
  const normal = JSON.parse(localStorage.getItem('lumen.best'));
  const endBest = document.getElementById('end-best').textContent;
  L.backToTitle();
  const pick = (level) => {
    document.getElementById('start-btn').click();
    const el = document.querySelector('input[name="new-difficulty"][value="' + level + '"]');
    el.checked = true; el.dispatchEvent(new Event('change'));
    document.getElementById('new-no').click();
  };
  pick('easy');
  const titleEasy = document.getElementById('best').textContent;
  pick('hard');
  const titleHard = document.getElementById('best').textContent;
  document.getElementById('settings-btn').click();
  const panel = document.getElementById('records-best').textContent;
  const setRadio = document.querySelector('input[name="difficulty"]:checked')?.value;
  document.getElementById('settings-close').click();
  return { easy, normal, endBest, titleEasy, titleHard, panel, setRadio };`);
check('쉬움 판의 기록은 쉬움 키에만', r.easy?.nights === 4 && r.normal.nights === 1, r);
check('끝 화면은 쉬움 신기록', /신기록\(쉬움\)/.test(r.endBest), r.endBest);
check('처음 화면은 고른 단계의 최고 기록', /최고 기록\(쉬움\)/.test(r.titleEasy) && r.titleHard === '', { e: r.titleEasy, h: r.titleHard });
check('설정의 기록은 단계마다 한 줄, 설정의 난이도는 새 판 화면과 같은 값', /쉬움 — /.test(r.panel) && /보통 — /.test(r.panel) && r.setRadio === 'hard', r);

// 지울 판이 있으면 '지우고 시작'과 취소에 초점
r = await B.ev(`
  const $ = (id) => document.getElementById(id);
  lumen.startGame(); lumen.step(0.3); lumen.saveRun(); lumen.backToTitle();
  $('start-btn').click();
  const out = { yes: $('new-yes').textContent, focus: document.activeElement?.id, info: $('run-info').textContent };
  $('new-no').click();
  out.back = !$('title-actions').classList.contains('hidden') && $('new-confirm').classList.contains('hidden');
  return out;`);
check("지울 판이 있으면 '지우고 시작', 초점은 취소, 취소하면 처음 화면", r.yes === '지우고 시작' && r.focus === 'new-no' && /지워져요/.test(r.info) && r.back, r);

// 어려움: 첫 밤부터 상한이 올라가고(보통 5 → 7), 깊은 밤 압박이 첫 밤부터
r = await B.ev(`
  const L = lumen;
  const peak = async (level) => {
    L.settings.difficulty = level; L.startGame(); L.step(0.3);
    for (let i = 0; i < 30 && (L.dialogue.scene || L.game.state === 'story'); i++) { if (L.dialogue.scene) L.dialogue.skip(); L.step(0.3); }
    L.game.nights = 0; L.env.setHour(21.2); L.player.pos.set(-48, 0, 48);
    let p = 0;
    for (let t = 0; t < 40; t += 0.5) { L.player.hp = 100; L.step(0.5, 1 / 30); p = Math.max(p, L.shades.activeCount); }
    return p;
  };
  return { easy: await peak('easy'), normal: await peak('normal'), hard: await peak('hard') };`);
check('첫 밤 그늘이 수의 상한: 쉬움 3 < 보통 5 < 어려움 7', r.easy <= 3 && r.normal <= 5 && r.normal > r.easy && r.hard > r.normal && r.hard <= 7, r);

// 2~4장: 설정의 단계를 바로 따르고, 일시정지 화면에 바꿀 수 있다고 알린다
r = await B.ev(`
  const L = lumen, $ = (id) => document.getElementById(id);
  L.backToTitle(); L.settings.difficulty = 'normal';
  L.startChapter(); L.step(2);
  for (let i = 0; i < 40 && (L.dialogue.scene || L.game.state === 'story'); i++) { if (L.dialogue.scene) L.dialogue.skip(); L.step(0.3); }
  L.pauseGame(true);
  const pause = $('pause-diff').textContent;
  $('pause-settings-btn').click();
  const hard = document.querySelector('input[name="difficulty"][value="hard"]');
  hard.checked = true; hard.dispatchEvent(new Event('change'));
  $('settings-close').click();
  const after = $('pause-diff').textContent;
  L.pauseGame(false); L.step(0.2);
  return { ch: L.game.chapter, pause, after, drain: L.player.drain };`);
check('2~4장은 설정을 바로 따르고 일시정지에 알린다', r.ch >= 2 && /보통 · 설정에서/.test(r.pause) && /어려움/.test(r.after) && r.drain === 1.25, r);

await B.ev(`lumen.backToTitle(); lumen.settings.difficulty = 'normal'; document.getElementById('start-btn').click();`);
await B.sleep(600);
console.log(await B.shot(`difficulty-${w}x${h}`));
await B.ev(`document.getElementById('new-no').click();`);

const errs = B.logs.filter((l) => /error|exception/i.test(l) && !/caches|online|fetch|CORS|ERR_/i.test(l));
check('콘솔 오류 없음', errs.length === 0, errs);
console.log(`\n${ok.filter(Boolean).length}/${ok.length} 통과`);
B.close();
process.exit(ok.every(Boolean) ? 0 : 1);
