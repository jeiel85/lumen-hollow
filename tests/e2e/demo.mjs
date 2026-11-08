// 웹판 1장 데모(#50): 1장 엔딩을 본 뒤 처음 화면에 장 단추 대신 '2~4장은 앱에서' 안내가 뜨고, startChapter가 막히고,
// 1장 승리 화면에도 '다음 장' 대신 안내가 뜬다. ?app(로컬 개발에서만)을 붙이면 앱처럼 장 단추가 나온다.
//   node tests/e2e/demo.mjs [url]
import { launch, fullGame } from './cdp.mjs';

const [,, url = 'http://127.0.0.1:8000/?debug', w = '1280', h = '720'] = process.argv;
const CH1 = ['arrival', 'dusk', 'dawn', 'light1', 'shadows', 'return', 'founders', 'lookout', 'promise', 'line', 'last', 'finale'];
const ok = [];
const check = (n, c, i) => { ok.push(!!c); console.log(`${c ? 'OK ' : 'NG '} ${n}${i !== undefined ? ` — ${JSON.stringify(i)}` : ''}`); };

async function open(u) {
  const B = await launch(u, +w, +h);
  for (let i = 0; i < 60; i++) {
    if (await B.ev('return !!(window.lumen && lumen.game.ready)')) break;
    await B.sleep(500);
  }
  await B.ev(`
    const L = lumen;
    window.T = {
      skip() { for (let i = 0; i < 40 && (L.dialogue.scene || L.game.state === 'story' || L.storyQueue.length); i++) { if (L.dialogue.docOpen) L.dialogue.closeDoc(); if (L.dialogue.scene) L.dialogue.skip(); L.step(0.3); } },
      title() {
        const btn = document.getElementById('chapter-btn'), note = document.getElementById('app-only');
        return { btn: !btn.classList.contains('hidden'), note: !note.classList.contains('hidden'), text: note.textContent, next: !!L.chapters.nextInfo() };
      },
    };
    for (const id of ${JSON.stringify(CH1)}) L.story.markSeen(id);
    L.backToTitle(); L.step(0.2);
    return 1;`);
  return B;
}

// 웹판(?app 없음)
let B = await open(url);
let r = await B.ev('return T.title()');
check('웹판: 1장 엔딩 뒤 처음 화면에 장 단추 대신 앱 안내', r.next && !r.btn && r.note && r.text.includes('안드로이드 앱') && r.text.includes('인계'), r);
r = await B.ev(`lumen.startChapter(); lumen.step(0.3); return { ch: lumen.game.chapter, state: lumen.game.state }`);
check('웹판: startChapter가 2장을 열지 않는다', r.ch === 0 && r.state === 'title', r);
r = await B.ev(`lumen.startGame(); lumen.step(0.3); T.skip(); lumen.endGame(true); lumen.step(0.2);
  const next = document.getElementById('next-chapter-btn'), note = document.getElementById('end-app-only');
  return { state: lumen.game.state, next: !next.classList.contains('hidden'), note: !note.classList.contains('hidden') }`);
check('웹판: 1장 승리 화면에 다음 장 대신 앱 안내', r.state === 'end' && !r.next && r.note, r);
r = await B.ev(`lumen.endGame(false); lumen.step(0.2); return { note: !document.getElementById('end-app-only').classList.contains('hidden') }`);
check('웹판: 패배 화면에는 앱 안내가 없다', !r.note, r);
const errs = B.logs.filter((l) => /error|exception/i.test(l) && !/caches|online|fetch|CORS|ERR_/i.test(l));
check('콘솔 오류 없음(웹판)', errs.length === 0, errs);
B.close();

// 로컬 개발 + ?app: 앱처럼 2~4장 단추
B = await open(fullGame(url));
r = await B.ev('return T.title()');
check('?app: 장 단추가 나오고 앱 안내는 숨는다', r.next && r.btn && !r.note, r);
r = await B.ev(`lumen.startChapter(); lumen.step(0.3); return { ch: lumen.game.chapter }`);
check('?app: startChapter가 2장을 연다', r.ch === 2, r);
B.close();

console.log(`\n${ok.filter(Boolean).length}/${ok.length} 통과`);
process.exit(ok.every(Boolean) ? 0 : 1);
