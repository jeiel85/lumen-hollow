// 2~4장 이어하기·실패·낮의 목표 그림자·수첩 범위 점검.
//   node tests/e2e/resume.mjs [url] [w h] [prefix]
import { launch, fullGame } from './cdp.mjs';

const [,, rawUrl = 'http://127.0.0.1:8000/?debug', w = '1280', h = '720', prefix = 'resume'] = process.argv;
const url = fullGame(rawUrl); // 2~4장도 시험하므로 앱처럼 연다(#50)
const B = await launch(url, +w, +h);
const res = [];
const check = (name, ok, info) => {
  res.push(ok);
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${info !== undefined ? ` — ${JSON.stringify(info)}` : ''}`);
};
const real = (ms) => B.sleep(ms);
for (let i = 0; i < 60; i++) {
  if (await B.ev('return !!(window.lumen && lumen.game.ready)')) break;
  await real(500);
}
await B.ev(`
  const L = lumen;
  window.T = {
    settle(max = 60) { for (let i = 0; i < max; i++) { if (L.dialogue.docOpen) { if (L.dialogue.docFlip) L.dialogue.docFlip(); L.dialogue.closeDoc(); } if (L.dialogue.scene) L.dialogue.skip(); L.step(0.5); if (L.game.state !== 'story' && !L.dialogue.busy && !L.storyQueue.length) return i; } return -1; },
    goto(x, z) { L.player.pos.set(x, L.ground.heightAt(x, z), z); L.step(0.1); },
    use(id) { const s = L.chapters.spot(id); T.goto(s.x, s.z); const n = L.chapters.nearest(L.player.pos.x, L.player.pos.z); if (!n || n.blocked) return n?.label ?? null; L.input.keys.add('KeyE'); L.step(n.dur + 0.4); L.input.keys.delete('KeyE'); L.step(0.1); return n.label; },
    seen(ids) { for (const id of ids) L.story.markSeen(id); },
    st() { return { state: L.game.state, ch: L.game.chapter, step: L.chapters.step, hour: +L.env.hour.toFixed(1), flags: [...L.chapters.flags], q: [...L.storyQueue], scene: L.dialogue.scene?.id ?? null }; },
  };
  return 1;`);
const CH1 = ['arrival', 'dusk', 'dawn', 'light1', 'shadows', 'return', 'founders', 'lookout', 'promise', 'line', 'last', 'finale'];

// ---------------------------------------------------------------- 화면: 2장 낮의 섬과 노 젓기
await B.ev(`T.seen(${JSON.stringify(CH1)}); lumen.startChapter(); lumen.step(0.5); return 1`);
await real(2800);
await B.ev(`lumen.step(0.5); return 1`);
await B.shot(`${prefix}-01-village`);
await B.ev(`T.use('boatVillage'); lumen.step(0.2); return 1`);
await real(900);
await B.ev(`lumen.step(0.6); lumen.dialogue.advance(); lumen.step(2.5); return 1`);
await real(600);
await B.shot(`${prefix}-02-rowing`);
await B.ev(`T.settle(); return 1`);
await real(800);
await B.ev(`lumen.step(0.3); return 1`);
await B.shot(`${prefix}-03-island-day`);
let r = await B.ev(`return T.st()`);
check('섬에서 탐색 차례', r.step === 'search', r);

// ---------------------------------------------------------------- QA ④: 첫 귀환 직후 종료 → 재개
r = await B.ev(`
  T.seen(['ferry','landing','relief','bowls','count','key','knock','chair','roll']);
  for (const c of ['islandbook','spare','manifest','tag','transfer']) lumen.story.markFound(c);
  for (const f of ['flip','lampDoor','lampYard']) lumen.chapters._setFlag(f);
  lumen.backToTitle(); lumen.step(0.2);
  document.getElementById('chapter-btn').click(); lumen.step(2.0);
  return T.st();`);
check('4장 예비등을 켠 뒤 재개하면 밤을 기다리는 차례', r.ch === 4 && r.step === 'wait' && r.hour < 17, r);
r = await B.ev(`
  T.use('wait'); lumen.step(3);
  const P = lumen.player; P.flashOn = true;
  for (let t = 0; t < 90 && !lumen.chapters.flag('home1'); t += 0.25) {
    const s = lumen.shades.list.find(e => e.active && e.tag === 't1');
    if (s) { P.facing = Math.atan2(s.x - P.pos.x, s.z - P.pos.z); P.battery = 100; }
    lumen.step(0.25);
  }
  const home1 = lumen.chapters.flag('home1');
  // 귀환 빛이 닿기 전에 처음 화면으로 나간다(탭 종료와 같은 경우).
  lumen.backToTitle(); lumen.step(0.2);
  return { home1, st: T.st(), btn: document.getElementById('chapter-btn').textContent };`);
check('첫 귀환 직후 나가도 귀환이 남는다', r.home1 && r.btn.includes('4장'), r);
r = await B.ev(`document.getElementById('chapter-btn').click(); lumen.step(2.2); return { st: T.st(), sit: lumen.chapters.npcs.patientSit.mesh.visible, lie: lumen.chapters.npcs.patientLie.mesh.visible, mom: lumen.chapters.npcs.momLie.mesh.visible }`);
check('재개하면 문가 장면부터, 문가 환자는 깨어 있고 엄마는 잠든 채', (r.st.scene === 'firsthome' || r.st.q.includes('firsthome')) && r.sit && !r.lie && r.mom, r);
r = await B.ev(`T.settle(); return T.st()`);
check('문가 장면 뒤 쉬는 차례(밤)', r.step === 'rest' && r.hour > 20, r);

// ---------------------------------------------------------------- QA ⑤: 둘째 밤에 쓰러짐 → 다시 하기
r = await B.ev(`
  T.use('water'); lumen.step(3);
  T.goto(lumen.chapters.river.stepsOut.x + 14, lumen.chapters.river.stepsOut.z + 4); // 불빛 밖 운동장으로
  lumen.player.flashOn = false;
  for (let t = 0; t < 80 && lumen.game.state === 'play'; t += 0.5) { lumen.player.hp = Math.min(lumen.player.hp, 20); lumen.step(0.5); }
  return { st: T.st(), title: document.getElementById('end-title').textContent, text: document.getElementById('end-text').textContent, retry: !document.getElementById('restart-btn').classList.contains('hidden') };`);
check('4장 밤에 쓰러지면 실패 화면', r.st.state === 'end' && r.title === '어둠에 삼켜졌다' && r.retry, r);
await real(400);
await B.shot(`${prefix}-04-fail`);
r = await B.ev(`document.getElementById('restart-btn').click(); lumen.step(2.0); return { st: T.st(), lamps: [lumen.chapters.river.lampDoor.on, lumen.chapters.river.lampYard.on] }`);
check('다시 하기: 켠 등과 첫 귀환은 남고 쉬는 차례부터', r.st.step === 'rest' && r.st.flags.includes('home1') && r.lamps.every(Boolean), r);
await real(2600);
await B.ev(`lumen.step(0.3); return 1`);
await B.shot(`${prefix}-05-rest-night`);

// ---------------------------------------------------------------- QA ⑦: 낮에는 목표 그림자가 없다
r = await B.ev(`
  lumen.chapters.night = false; lumen.chapters.restDone = false;
  lumen.env.setHour(12); lumen.chapters._refresh(); lumen.step(8);
  return { st: T.st(), targets: lumen.shades.list.filter(s => s.active && s.tag).length };`);
check('낮에는 목표 그림자가 나오지 않는다', r.targets === 0, r);

// ---------------------------------------------------------------- 수첩: 뒤 장의 기록이 미리 보이지 않는다
r = await B.ev(`
  lumen.backToTitle(); lumen.step(0.2);
  lumen.story.wipe(); lumen.chapters.wipe();
  T.seen(${JSON.stringify(CH1)});
  document.getElementById('journal-btn').click(); lumen.step(0.1);
  const heads = [...document.querySelectorAll('#journal-clues .jhead')].map(e => e.textContent);
  const titles = [...document.querySelectorAll('#journal-clues .jt')].map(e => e.textContent);
  document.getElementById('journal-close').click();
  return { heads, n: titles.length };`);
// 1장 문서 기록 8(급수탑은 장면이라 문서가 아니다) + 2장 2(인계부·예비 송수신기)
check('1장만 마쳤으면 수첩에는 2장까지만', r.heads.length === 2 && r.n === 10, r);

console.log(`\n${res.filter(Boolean).length}/${res.length} 통과`);
const errs = B.logs.filter((l) => /error|exception/i.test(l) && !/caches|online|fetch|CORS|ERR_/i.test(l));
res.push(errs.length === 0);
console.log(errs.length ? `NG 콘솔 오류 — ${JSON.stringify(errs)}` : 'OK  콘솔 오류 없음');
B.close();
process.exit(res.every(Boolean) ? 0 : 1);
