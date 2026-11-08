// 온라인 클라이언트(#17·#20·#32): 목록 응답의 rules를 안내 문구에 쓰고, 이야기 진행 집계를 온라인을 켠 동안에만 모아
// POST /v1/story(플레이어 헤더 없이)와 탭이 가려질 때 sendBeacon(text/plain)으로 보낸다. 서버 응답은 흉내 낸다.
//   node tests/e2e/online.mjs [url]
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
  const O = lumen.online;
  window.SENT = []; window.BEACONS = [];
  O._call = async (method, path, opts = {}) => {
    SENT.push({ method, path, body: opts.body ?? null, player: opts.player !== false });
    if (path.startsWith('/v1/caches?')) return { ok: true, status: 200, data: { enabled: true, caches: [], rules: { charges: 5, maxActivePerPlayer: 2 } } };
    return { ok: true, status: 200, data: { accepted: opts.body?.events?.length ?? 0 } };
  };
  navigator.sendBeacon = (u, blob) => { BEACONS.push({ u, type: blob.type }); return true; };
  window.ON = (v) => Object.defineProperty(O, 'enabled', { get: () => v, configurable: true });
  return 1;`);

let r = await B.ev(`ON(false); lumen.online.noteStory('scene', 'arrival'); return { queued: lumen.online.storyQueue.length }`);
check('온라인을 끈 동안에는 이야기 진행을 모으지 않는다', r.queued === 0, r);

r = await B.ev(`ON(true); await lumen.online.list(); return { ...lumen.online.rules }`);
check('목록 응답의 rules를 받는다(이상한 값은 버림)', r.charges === 5 && r.maxActivePerPlayer === 2, r);
r = await B.ev(`const O = lumen.online; O._takeRules({ charges: -1, maxActivePerPlayer: 'x' }); return { ...O.rules }`);
check('이상한 rules 값은 무시한다', r.charges === 5 && r.maxActivePerPlayer === 2, r);

r = await B.ev(`SENT.length = 0; lumen.online.storyQueue.length = 0;
  lumen.startGame(); lumen.step(0.3);
  if (lumen.dialogue.scene) lumen.dialogue.skip(); lumen.step(0.5);
  return { queue: lumen.online.storyQueue.map((e) => e.kind + ':' + e.id + (e.skipped ? '!' : '')) }`);
check('장면을 건너뛰면 skipped로 모인다', r.queue.includes('scene:arrival!'), r);

r = await B.ev(`const CH1 = ['arrival','dusk','dawn','light1','shadows','return','founders','lookout','promise','line','last','finale'];
  for (const id of CH1) lumen.story.markSeen(id);
  lumen.backToTitle(); lumen.step(0.2); SENT.length = 0;
  lumen.startChapter(); lumen.step(0.3);
  const posts = SENT.filter((s) => s.path === '/v1/story');
  return { posts: posts.length, player: posts.some((p) => p.player), events: posts.flatMap((p) => p.body.events.map((e) => e.kind + ':' + e.id)) }`);
check('장에 들어가면 chapter:2를 보내고, 플레이어 헤더를 붙이지 않는다', r.posts >= 1 && !r.player && r.events.includes('chapter:2'), r);

r = await B.ev(`lumen.online.noteStory('scene', 'ferry', true);
  Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  return { beacons: BEACONS.map((b) => b.u.replace(/^https?:\\/\\/[^/]+/, '') + ' ' + b.type), left: lumen.online.storyQueue.length }`);
check('탭이 가려지면 sendBeacon(text/plain)으로 보낸다', r.beacons.some((b) => b === '/v1/story text/plain') && r.left === 0, r);

const errs = B.logs.filter((l) => /error|exception/i.test(l) && !/caches|online|fetch|CORS|ERR_/i.test(l));
check('콘솔 오류 없음', errs.length === 0, errs);
console.log(`\n${ok.filter(Boolean).length}/${ok.length} 통과`);
B.close();
process.exit(ok.every(Boolean) ? 0 : 1);
