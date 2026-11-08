// 2~4장 한 번 결제(#51)를 흉내 가게로: 맛보기(2장 할머니와의 첫 대면 장면까지)는 열려 있고, 그 장면을 본 뒤 사지 않았으면
// 처음 화면으로 나와 결제 화면이 열린다. 나중에·Esc로 닫고, 장 단추가 다시 결제 화면을 열고, 사면 그 장으로 들어간다.
// 결제 대기·취소·오류의 안내. 실제 Play 결제는 앱에서 라이선스 테스터로 확인한다(DECISIONS.md "2~4장 한 번 결제").
//   node tests/e2e/paywall.mjs [url] [폭 높이]
import { launch, fullGame } from './cdp.mjs';

const [,, url = 'http://127.0.0.1:8000/?debug', w = '960', h = '540'] = process.argv;
const at = (outcome) => {
  const u = new URL(fullGame(url));
  u.searchParams.set('paywall', outcome);
  return u.href;
};
const B = await launch(at('1'), +w, +h);
const ok = [];
const check = (n, c, i) => { ok.push(!!c); console.log(`${c ? 'OK ' : 'NG '} ${n}${i !== undefined ? ` — ${JSON.stringify(i)}` : ''}`); };
const ready = async () => {
  await B.sleep(800);
  for (let i = 0; i < 90; i++) { if (await B.ev('return !!(window.lumen && lumen.game.ready)')) return; await B.sleep(500); }
};
await ready();
const CH1 = ['arrival', 'dusk', 'dawn', 'light1', 'shadows', 'return', 'founders', 'lookout', 'promise', 'line', 'last', 'finale'];
const SETUP = `
  const L = lumen, $ = (id) => document.getElementById(id);
  const shown = () => !$('paywall').classList.contains('hidden');
  const skip = () => { for (let i = 0; i < 40 && (L.dialogue.scene || L.game.state === 'story'); i++) { if (L.dialogue.scene) L.dialogue.skip(); L.step(0.3); } };
`;

// 맛보기: 1장을 마치면 2장에 들어갈 수 있다(결제 화면 없이)
let r = await B.ev(`${SETUP}
  L.story.wipe(); L.chapters.wipe();
  for (const id of ${JSON.stringify(CH1)}) L.story.markSeen(id);
  L.backToTitle();
  const btn = $('chapter-btn').textContent;
  L.startChapter(); L.step(1.5); skip();
  return { btn, chapter: L.game.chapter, step: L.chapters.step, paywall: shown(), owned: L.store.owned };`);
check('맛보기: 사지 않아도 2장에 들어간다', r.chapter === 2 && r.step === 'ferry' && !r.paywall && !r.owned && !/열기/.test(r.btn), r);

// 할머니와의 첫 대면 장면을 본 뒤: 처음 화면으로 나와 결제 화면
r = await B.ev(`${SETUP}
  L.story.markSeen('ferry'); L.story.markSeen('landing');
  L.step(0.2);
  await new Promise((ok) => setTimeout(ok, 300));
  return { state: L.game.state, chapter: L.game.chapter, paywall: shown(), lead: $('paywall-lead').textContent, buy: $('paywall-buy').textContent, focus: document.activeElement?.id,
    msg: $('paywall-msg').textContent, card: !$('chapter-card').classList.contains('hidden') };`);
check('첫 대면을 본 뒤 사지 않았으면 처음 화면으로 나와 결제 화면(가격은 Play가 정한 값, 빈 안내, 장 제목 카드 걷힘)', r.state === 'title' && r.chapter === 0 && r.paywall && /할머니를 만났다/.test(r.lead) && r.buy === '2~4장 열기 · ₩3,300' && r.focus === 'paywall-buy' && r.msg === '' && !r.card, r);
await B.shot(`paywall-${w}x${h}`);

// 나중에 → 처음 화면, 장 단추에 '2~4장 열기', 누르면 다시 결제 화면. Esc·뒤로 가기로도 닫힌다.
r = await B.ev(`${SETUP}
  $('paywall-close').click();
  const closed = !shown() && !$('title').classList.contains('hidden');
  const btn = $('chapter-btn').textContent;
  $('chapter-btn').click();
  const again = shown();
  L.input.pressed.add('Escape'); L.step(0.05);
  const esc = !shown();
  $('chapter-btn').click();
  return { closed, btn, again, esc, lead: $('paywall-lead').textContent };`);
check("'나중에'로 닫고, 장 단추가 '2~4장 열기'를 달고 결제 화면을 다시 연다, Esc로 닫힌다", r.closed && /2~4장 열기/.test(r.btn) && r.again && r.esc && /맛보기는 2장 첫 대면까지/.test(r.lead), r);

// 사면 결제 화면이 닫히고 그 차례(2장 찾기)로 들어간다. 장 단추에서 '열기'가 사라진다.
r = await B.ev(`${SETUP}
  $('paywall-buy').click();
  await new Promise((ok) => setTimeout(ok, 600));
  L.step(1.5); skip();
  return { owned: L.store.owned, paywall: shown(), chapter: L.game.chapter, step: L.chapters.step };`);
check('사면 바로 2장의 다음 차례로 들어간다', r.owned && !r.paywall && r.chapter === 2 && r.step === 'search', r);

// 결과마다 안내: 대기·취소·오류(새로 열어 흉내 가게의 결과를 바꾼다)
const outcome = async (kind) => {
  await B.send('Page.navigate', { url: at(kind) });
  await ready();
  return B.ev(`${SETUP}
    for (const id of ${JSON.stringify(CH1)}) L.story.markSeen(id);
    L.story.markSeen('ferry'); L.story.markSeen('landing');
    L.backToTitle(); $('chapter-btn').click();
    $('paywall-buy').click();
    await new Promise((ok) => setTimeout(ok, 500));
    return { open: shown(), owned: L.store.owned, pending: L.store.pending, msg: $('paywall-msg').textContent, buyEnabled: !$('paywall-buy').disabled };`);
};
r = await outcome('pending');
check('결제 대기: 결제 화면에 남아 기다린다고 알린다', r.open && !r.owned && r.pending && /기다리고/.test(r.msg), r);
r = await outcome('cancel');
check('취소: 아무 말 없이 결제 화면에 남고 다시 살 수 있다', r.open && !r.owned && r.msg === '' && r.buyEnabled, r);
r = await outcome('error');
check('오류: 다시 해 달라고 알린다', r.open && !r.owned && /다시 해 주세요/.test(r.msg) && r.buyEnabled, r);

// 열린 결제 화면은 Esc로 닫힌다(앱의 뒤로 가기도 onBack에서 같은 일을 한다)
r = await B.ev(`${SETUP}
  L.input.pressed.add('Escape'); L.step(0.05);
  return { open: shown(), state: L.game.state };`);
check('Esc로 닫으면 처음 화면', !r.open && r.state === 'title', r);

const errs = B.logs.filter((l) => /error|exception/i.test(l) && !/caches|online|fetch|CORS|ERR_/i.test(l));
check('콘솔 오류 없음', errs.length === 0, errs);
console.log(`\n${ok.filter(Boolean).length}/${ok.length} 통과`);
B.close();
process.exit(ok.every(Boolean) ? 0 : 1);
