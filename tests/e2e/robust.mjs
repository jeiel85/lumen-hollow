// 견고성 화면 확인(#14·#20·#1·#33): 2장 배 타기 전 시간, 게임 시간으로 사라지는 안내와 최근 안내, 끝 화면 기록 비교,
// 오류 화면 동안 판 멈춤, 장면 정리·포커스 가두기, 두 탭, 걸려 있던 꺼내기 맞추기, 저사양 화질 자동 낮춤.
//   node tests/e2e/robust.mjs [url]
import { launch } from './cdp.mjs';

const [,, url = 'http://127.0.0.1:8000/?debug', w = '1280', h = '720'] = process.argv;
const B = await launch(url, +w, +h);
const ok = [];
const check = (n, c, i) => { ok.push(!!c); console.log(`${c ? 'OK ' : 'NG '} ${n}${i !== undefined ? ` — ${JSON.stringify(i)}` : ''}`); };
for (let i = 0; i < 60; i++) {
  if (await B.ev('return !!(window.lumen && lumen.game.ready)')) break;
  await B.sleep(500);
}
await B.ev(`
  const L = lumen;
  window.T = {
    skip() { for (let i = 0; i < 40 && (L.dialogue.scene || L.game.state === 'story' || L.storyQueue.length); i++) { if (L.dialogue.docOpen) L.dialogue.closeDoc(); if (L.dialogue.scene) L.dialogue.skip(); L.step(0.3); } },
    start() { L.startGame(); L.step(0.3); T.skip(); },
  };
  return 1;`);
const CH1 = ['arrival', 'dusk', 'dawn', 'light1', 'shadows', 'return', 'founders', 'lookout', 'promise', 'line', 'last', 'finale'];

// #33: 2장 마을 선착장에서는 시간이 멈춘다
let r = await B.ev(`for (const id of ${JSON.stringify(CH1)}) lumen.story.markSeen(id); lumen.startChapter(); lumen.step(0.5); T.skip();
  const h0 = lumen.env.hour; lumen.step(30, 1 / 20); return { step: lumen.chapters.step, h0: +h0.toFixed(2), h1: +lumen.env.hour.toFixed(2) };`);
check('2장 나룻배에 오르기 전에는 해가 지지 않는다(#33)', r.step === 'ferry' && r.h0 === r.h1, r);
await B.ev(`lumen.backToTitle(); lumen.step(0.2); lumen.story.wipe(); lumen.chapters.wipe(); return 1`);

// #14: 안내는 게임 시간으로 사라지고 일시정지 화면에서 다시 볼 수 있다
r = await B.ev(`T.start(); lumen.hud.clearToasts(); lumen.hud.toast('시험 안내 하나'); lumen.pauseGame(true); return 1`);
await B.sleep(4500);
r = await B.ev(`const still = [...document.querySelectorAll('#toasts .toast')].some((t) => t.textContent === '시험 안내 하나' && !t.classList.contains('out'));
  const log = [...document.querySelectorAll('#pause-log li')].map((li) => li.textContent);
  lumen.pauseGame(false); return { still, log };`);
check('일시정지 동안 안내가 사라지지 않고, 일시정지 화면 최근 안내에 남는다', r.still && r.log.includes('시험 안내 하나'), r);
await B.sleep(4500);
r = await B.ev(`return { gone: ![...document.querySelectorAll('#toasts .toast')].some((t) => t.textContent === '시험 안내 하나') }`);
check('게임이 흐르면 안내가 사라진다', r.gone, r);

// #14: 끝 화면 기록 비교
r = await B.ev(`localStorage.setItem('lumen.best', JSON.stringify({ nights: 0, zones: 1, winDay: 0 }));
  lumen.game.nights = 3; lumen.player.hp = 0; lumen.player.alive = false; lumen.step(0.2);
  return { state: lumen.game.state, best: document.getElementById('end-best').textContent }`);
check('끝 화면이 지난 최고 기록과 비교한다(신기록)', r.state === 'end' && r.best.includes('신기록') && r.best.includes('밤'), r);

// #20: 새 판·처음 화면으로 갈 때 열린 장면 정리
r = await B.ev(`lumen.backToTitle(); lumen.step(0.2); lumen.playScene('dusk'); const playing = !!lumen.dialogue.scene;
  lumen.backToTitle(); lumen.step(0.2);
  return { playing, after: !!lumen.dialogue.scene, hidden: document.getElementById('story').classList.contains('hidden'), state: lumen.game.state }`);
check('장면 도중 처음 화면으로 가면 장면이 콜백 없이 닫힌다', r.playing && !r.after && r.hidden && r.state === 'title', r);

// #20: 읽기 화면 포커스 가두기
r = await B.ev(`T.start(); const clue = lumen.story.spots[0].clue; lumen.openDoc(clue); lumen.step(0.1); return { open: !!lumen.dialogue.docOpen }`);
for (let i = 0; i < 4; i++) {
  await B.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  await B.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
}
r = await B.ev(`const inDoc = document.getElementById('doc').contains(document.activeElement); lumen.dialogue.closeDoc(); lumen.step(0.2); return { inDoc, el: document.activeElement?.id }`);
check('읽기 화면이 열린 동안 Tab은 그 안에서만 돈다', r.inDoc, r);

// #14: 두 탭 — 다른 탭이 판 저장을 바꾸면 이 탭은 저장을 멈춘다
r = await B.ev(`T.start(); lumen.saveRun(); const before = localStorage.getItem('lumen.run');
  window.dispatchEvent(new StorageEvent('storage', { key: 'lumen.run', storageArea: localStorage, newValue: before }));
  localStorage.setItem('lumen.run', 'other-tab'); lumen.step(0.1); lumen.saveRun();
  const kept = localStorage.getItem('lumen.run') === 'other-tab';
  const toast = [...document.querySelectorAll('#toasts .toast')].some((t) => t.textContent.includes('다른 탭'));
  return { other: lumen.game.otherTab, kept, toast }`);
check('다른 탭이 판 저장을 바꾸면 알리고 이 탭은 덮어쓰지 않는다', r.other && r.kept && r.toast, r);

// #14: 꺼내기 요청 도중 닫혔던 판 — 이어하면 서버에 다시 물어 맞춘다(서버 응답은 흉내)
r = await B.ev(`localStorage.removeItem('lumen.run'); T.start(); const P = lumen.player; P.bandages = 1;
  // 요청이 오가는 중에 탭이 닫힌 것처럼: 걸려 있는 채로 저장되고(일시정지·처음 화면으로도 저장한다) 판을 나간다
  lumen.game.pendingTake = { id: 'c_' + 'a'.repeat(26), kind: 'bandage' }; lumen.saveRun();
  lumen.pauseGame(true); lumen.backToTitle(); lumen.step(0.2); lumen.game.pendingTake = null;
  const saved = JSON.parse(localStorage.getItem('lumen.run')).run.pendingTake?.kind ?? null;
  Object.defineProperty(lumen.online, 'enabled', { get: () => true, configurable: true });
  lumen.online.use = async () => ({ ok: false, error: 'used_today' });
  lumen.resumeGame(); await new Promise((res) => setTimeout(res, 50)); lumen.step(0.1);
  return { saved, state: lumen.game.state, bandages: P.bandages }`);
check('걸려 있던 꺼내기가 서버에서 이뤄졌으면(used_today) 이어할 때 그 물건을 준다', r.saved === 'bandage' && r.state === 'play' && r.bandages === 2, r);

// #14: 오류 화면 동안 판이 멈추고, 계속하기를 누르면 일시정지로 돌아온다
r = await B.ev(`T.skip(); const t0 = lumen.game.time;
  setTimeout(() => { throw new Error('시험 오류'); }, 0); await new Promise((res) => setTimeout(res, 30));
  await new Promise((res) => setTimeout(res, 400));
  return { t0, t1: lumen.game.time, shown: !document.getElementById('error').classList.contains('hidden'), cont: !document.getElementById('error-continue').classList.contains('hidden') }`);
check('실행 중 오류 화면이 뜨면 판이 멈추고 계속하기가 보인다', r.shown && r.cont && r.t1 === r.t0, r);
r = await B.ev(`document.getElementById('error-continue').click(); await new Promise((res) => setTimeout(res, 100)); return { state: lumen.game.state, hidden: document.getElementById('error').classList.contains('hidden') }`);
check('계속하기를 누르면 오류 화면이 닫히고 일시정지로 돌아온다', r.hidden && r.state === 'pause', r);

// #1·#10: 저사양 화질 자동 낮춤(CPU를 늦춰 실제 화면 갱신이 40fps 아래로 떨어지게)
r = await B.ev(`lumen.pauseGame(false); lumen.autoQ.off = false; lumen.autoQ.since = performance.now(); lumen.autoQ.frames = 0; return localStorage.getItem('lumen.settings')`);
const q0 = await B.ev(`return JSON.parse(localStorage.getItem('lumen.settings') ?? '{}').quality ?? null`);
await B.send('Emulation.setCPUThrottlingRate', { rate: 25 });
await B.sleep(16000);
await B.send('Emulation.setCPUThrottlingRate', { rate: 1 });
r = await B.ev(`return { q: JSON.parse(localStorage.getItem('lumen.settings') ?? '{}').quality ?? null, toast: [...document.querySelectorAll('#toasts .toast')].some((t) => t.textContent.includes('화질')) }`);
check('플레이 중 느리면 화질을 한 단계 낮추고 알린다', r.q && r.q !== q0 && r.q !== 'high', { q0, ...r });

const errs = B.logs.filter((l) => /error|exception/i.test(l) && !/caches|online|fetch|CORS|ERR_|시험 오류/i.test(l));
check('콘솔 오류 없음(일부러 낸 시험 오류 빼고)', errs.length === 0, errs);
console.log(`\n${ok.filter(Boolean).length}/${ok.length} 통과`);
B.close();
process.exit(ok.every(Boolean) ? 0 : 1);
