// 낮은 가로 화면(#10 "가로 + 브라우저 주소창의 낮은 화면"): HUD 묶음(위 줄·상태 창·미니맵·터치 버튼·보급품 단추·장 목표·
// 남기기 창·데스크톱 조작 안내)이 서로 겹치지 않는다. 1장(연료·부하 막대까지 펼침), 왼손 모드, 남기기 창, 2장 목표를 본다.
//   node tests/e2e/layout.mjs [url] [폭 높이]   예) 640 300, 568 280 (폭 700 미만이면 휴대폰으로 흉내 낸다)
//   데스크톱(마우스) 좁은·낮은 창: 760 420, 1024 700, 900 480
import { launch, fullGame } from './cdp.mjs';

const [,, rawUrl = 'http://127.0.0.1:8000/?debug', w = '640', h = '300'] = process.argv;
const url = fullGame(rawUrl); // 2~4장도 시험하므로 앱처럼 연다(#50)
const B = await launch(url, +w, +h);
const tag = `${w}x${h}`;
const mobile = +w < 700; // cdp.mjs가 이 폭 아래를 휴대폰(터치)으로 흉내 낸다
const ok = [];
const check = (n, c, i) => { ok.push(!!c); console.log(`${c ? 'OK ' : 'NG '} ${n}${i !== undefined ? ` — ${JSON.stringify(i)}` : ''}`); };
for (let i = 0; i < 60; i++) {
  if (await B.ev('return !!(window.lumen && lumen.game.ready)')) break;
  await B.sleep(500);
}
// 보이는 HUD 묶음의 사각형과 서로 겹치는 쌍(알림 토스트·화살표처럼 잠깐 떠서 비켜 가는 것은 뺀다).
// 보급품 단추는 터치 화면에서만 따로 떠 있고, 데스크톱에서는 위 줄(.hud-top) 안에 있어 뺀다. 조작 안내(#key-hints)는 데스크톱에만 있다.
const rects = `
  const q = (sel) => { const e = document.querySelector(sel); if (!e) return null; const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden' || e.closest('.hidden')) return null;
    const r = e.getBoundingClientRect(); if (!r.width || !r.height) return null;
    return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]; };
  const o = { top: q('.hud-top'), stats: q('.stats'), touch: q('.touch-btns'), minimap: q('#minimap'), drop: getComputedStyle(document.getElementById('drop-btn')).position === 'fixed' ? q('#drop-btn') : null, objective: q('#objective'), place: q('#place'), prompt: q('#prompt'), keys: q('#key-hints') };
  for (const k in o) if (!o[k]) delete o[k];
  const ks = Object.keys(o); const hit = []; const out = [];
  for (let i = 0; i < ks.length; i++) {
    const a = o[ks[i]];
    if (a[0] < 0 || a[1] < 0 || a[2] > innerWidth || a[3] > innerHeight) out.push(ks[i]);
    for (let j = i + 1; j < ks.length; j++) { const b = o[ks[j]]; if (a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]) hit.push(ks[i] + '×' + ks[j]); }
  }
  return { ...o, hit, out };`;
const skip = `for (let i = 0; i < 40 && (lumen.dialogue.scene || lumen.game.state === 'story'); i++) { if (lumen.dialogue.scene) lumen.dialogue.skip(); lumen.step(0.3); }`;
const bars = `for (const id of ['fuel-wrap', 'load-wrap']) document.getElementById(id).classList.remove('hidden'); lumen.hud.prompt('트럭에 타기', 0.4);`;

let r = await B.ev(`lumen.startGame(); lumen.step(0.5); ${skip}; lumen.hud.setOnline(true); lumen.step(0.3); ${bars} ${rects}`);
check(`1장(상태 창 막대 넷·상호작용 안내·${mobile ? '보급품 단추' : '조작 안내'}): 겹치지 않고 화면 안`, !r.hit.length && !r.out.length && r.stats && (mobile ? r.touch && r.drop : r.keys), r);
await B.shot(`layout-${tag}-ch1`);
r = await B.ev(`document.getElementById('touch').classList.add('lefty'); ${bars} ${rects}`);
check('왼손 모드: 겹치지 않고 화면 안', !r.hit.length && !r.out.length, r);
await B.shot(`layout-${tag}-lefty`);
r = await B.ev(`document.getElementById('touch').classList.remove('lefty'); lumen.hud.prompt(null); document.getElementById('place').classList.remove('hidden'); ${rects}`);
check('보급품 남기기 창: 겹치지 않고 화면 안', !r.hit.length && !r.out.length && r.place, r);
await B.shot(`layout-${tag}-place`);
r = await B.ev(`document.getElementById('place').classList.add('hidden');
  for (const id of ['arrival','dusk','dawn','light1','shadows','return','founders','lookout','promise','line','last','finale']) lumen.story.markSeen(id);
  lumen.backToTitle(); lumen.step(0.3); lumen.startChapter(); lumen.step(0.5); ${skip}; lumen.step(0.5); ${rects}`);
check('2장(목표 문구): 겹치지 않고 화면 안', !r.hit.length && !r.out.length && r.objective, r);
await B.shot(`layout-${tag}-ch2`);

const errs = B.logs.filter((l) => /error|exception/i.test(l) && !/caches|online|fetch|CORS|ERR_/i.test(l));
check('콘솔 오류 없음', errs.length === 0, errs);
console.log(`\n${ok.filter(Boolean).length}/${ok.length} 통과`);
B.close();
process.exit(ok.every(Boolean) ? 0 : 1);
