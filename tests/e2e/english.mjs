// 영어판(#60): 영어 기기에서 처음 화면·새 판·설정·수첩·판 도중 안내·밤·일시정지·결제 화면·끝 화면을 열어 한글이 하나도
// 나오지 않는지(간판·로고 포함), 언어 설정을 바꾸면 다시 열려 그 언어가 되는지. 화면을 찍어 넘침을 눈으로 본다.
// 1장·2~4장 끝까지의 한글 검사는 E2E_LANG=en으로 chapter1.mjs·chapters.mjs를 돌린다(tests/README.md).
//   node tests/e2e/english.mjs [url] [폭 높이]
process.env.E2E_LANG = 'en';
const { launch, fullGame } = await import('./cdp.mjs');

const [,, url = 'http://127.0.0.1:8000/?debug', w = '960', h = '540'] = process.argv;
const u = new URL(fullGame(url));
u.searchParams.set('paywall', '1');
const B = await launch(u.href, +w, +h);
const ok = [];
const check = (n, c, i) => { ok.push(!!c); console.log(`${c ? 'OK ' : 'NG '} ${n}${i !== undefined ? ` — ${JSON.stringify(i)}` : ''}`); };
const ready = async () => {
  await B.sleep(800);
  for (let i = 0; i < 90; i++) { if (await B.ev('return !!(window.lumen && lumen.game.ready)')) return; await B.sleep(500); }
};
await ready();
const tag = `${w}x${h}`;
const SETUP = `
  const L = lumen, $ = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
  const skip = () => { for (let i = 0; i < 40 && (L.dialogue.scene || L.game.state === 'story'); i++) { if (L.dialogue.scene) L.dialogue.skip(); L.step(0.3); } };
`;

let r = await B.ev(`${SETUP}
  return { lang: document.documentElement.lang, logo: document.querySelector('.title-logo img').getAttribute('src'), start: $('start-btn').textContent,
    title: document.title, tagline: document.querySelector('.tagline').textContent.slice(0, 40) };`);
check('처음 화면이 영어(문서 언어·영어 로고·단추)', r.lang === 'en' && r.logo === 'art/logo-wide-en.webp' && /^[A-Za-z ]+$/.test(r.start) && /^Lumen Hollow/.test(r.title), r);
await B.sleep(600);
await B.shot(`english-title-${tag}`);

// 새 판 화면, 설정(언어 자리: 기기 설정이 골라져 있고 '한국어'만 한국어로 보인다), 수첩
r = await B.ev(`${SETUP}
  $('start-btn').click();
  const diff = $('new-diff-note').textContent;
  $('new-no').click();
  $('settings-btn').click();
  const langPick = document.querySelector('input[name="lang"]:checked')?.value;
  const koLabel = document.querySelector('input[name="lang"][value="ko"] + span').textContent;
  await wait(300);
  return { diff, langPick, koLabel };`);
check("새 판·설정이 영어, 언어는 '기기 설정'이고 '한국어'만 그 말로", /[A-Za-z]/.test(r.diff) && r.langPick === 'auto' && r.koLabel === '한국어', r);
await B.shot(`english-settings-${tag}`);
await B.ev(`document.getElementById('settings-close').click(); document.getElementById('journal-btn').click();`);
await B.sleep(300);
await B.shot(`english-journal-${tag}`);
await B.ev(`document.getElementById('journal-close').click();`);

// 판: 도착 무전(대사·이름표), 안내, 밤(사건·빛먹이), 배전반, 일시정지, 쓰러짐
r = await B.ev(`${SETUP}
  localStorage.removeItem('lumen.story'); L.story.wipe();
  L.startGame(); L.step(0.5);
  await wait(400);
  const line = $('story-text')?.textContent ?? '';
  const who = $('story-name')?.textContent ?? '';
  skip(); L.step(8);
  L.game.nights = 2; L.env.setHour(17.79); L.step(0.5); skip(); L.step(4); skip();
  L.env.setHour(22); L.step(2); skip();
  L.shades.clear(); L.shades._spawn(L.player.pos.x, L.player.pos.z, L.world); L.shades._become(L.shades._last, 'eater', 9); L.shades._last.x = L.player.pos.x + 5; L.shades._last.state = 'stalk'; L.shades._last.fade = 1;
  L.step(0.5);
  L.openGrid?.(); L.step(0.2); L.closeGrid?.();
  L.pauseGame(true);
  const pause = $('pause-diff').textContent;
  return { line, who, pause, phase: $('phase-label').textContent };`);
check('무전 장면·안내·일시정지가 영어', /[A-Za-z]/.test(r.line) && /^[A-Za-z ]*$/.test(r.who) && /Difficulty|Normal/i.test(r.pause) && /^[A-Za-z ·]+$/.test(r.phase), r);
await B.shot(`english-pause-${tag}`);
await B.ev(`lumen.pauseGame(false); lumen.env.setHour(13); lumen.step(1);`);
await B.sleep(500);
await B.shot(`english-town-${tag}`);

// 결제 화면(흉내 가게)과 끝 화면
r = await B.ev(`${SETUP}
  for (const id of ['arrival','dusk','dawn','light1','shadows','return','founders','lookout','promise','line','last','finale','ferry','landing']) L.story.markSeen(id);
  L.backToTitle(); L.openPaywall();
  const pay = $('paywall-buy').textContent + ' | ' + $('paywall-lead').textContent;
  L.closePaywall();
  L.startGame(); L.step(0.3); skip(); L.endGame(false);
  return { pay, end: $('end-title').textContent + ' | ' + $('end-text').textContent };`);
check('결제 화면·끝 화면이 영어', /Unlock/i.test(r.pay) && /[A-Za-z]/.test(r.end), r);

// 화면 전체에서 한글: 0이어야 한다
const left = await B.hangul();
check('영어 화면에 한글이 하나도 나오지 않았다(간판 그림 제외 검사)', left.length === 0, left.slice(0, 12));

// 언어를 한국어로 바꾸면 다시 열려 한국어가 된다(주소의 ?lang=en 없이)
await B.send('Page.navigate', { url: fullGame(url) });
await ready();
r = await B.ev(`${SETUP}
  $('settings-btn').click();
  const ko = document.querySelector('input[name="lang"][value="ko"]');
  ko.checked = true; ko.dispatchEvent(new Event('change'));
  return true;`);
await ready();
r = await B.ev(`return { lang: document.documentElement.lang, start: document.getElementById('start-btn').textContent, saved: JSON.parse(localStorage.getItem('lumen.settings')).lang };`);
check('설정에서 한국어를 고르면 다시 열려 한국어', r.lang === 'ko' && /[가-힣]/.test(r.start) && r.saved === 'ko', r);

// 마지막 한국어 확인 뒤의 한국어 화면은 감시 보고에서 뺀다(위에서 이미 영어 화면의 한글을 봤다).
await B.ev('window.__hangul?.clear(); return true');
const errs = B.logs.filter((l) => /error|exception|\[i18n\]/i.test(l) && !/caches|online|fetch|CORS|ERR_/i.test(l));
check('콘솔 오류·빠진 번역 경고 없음', errs.length === 0, errs.slice(0, 6));
console.log(`\n${ok.filter(Boolean).length}/${ok.length} 통과`);
await B.close();
process.exit(ok.every(Boolean) ? 0 : 1);
