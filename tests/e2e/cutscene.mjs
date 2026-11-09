// 컷신 그림과 처음 화면 그림(#45): 그림이 깔리고·바뀌고·걷히고, 건너뛰면 걷힌다. 화면 낭독기에는 그림이 깔린 줄에서
// 그림 설명을 대사 앞에 읽는다. 그림이 늦게 오면 암전을 잡아 두고 기다리고(오래 늦으면 2.5초 뒤 넘어감), 받지 못하면
// 그림을 깔지 않아 3D 장면이 보인다. 옛 index.html(그림 요소 없음)과 섞여도 장면이 돈다.
// 처음 화면: 그림이 오기 전엔 흐린 미리보기, 그림이 덮는 동안 3D를 그리지 않음, 그림을 받지 못하면 3D 장면 + 글자 로고.
// 그림 요청은 CDP Fetch로 늦추거나 404로 돌려준다. 실제 시간으로 돈다(약 40초).
//   node tests/e2e/cutscene.mjs [url]
import { launch } from './cdp.mjs';

const [,, url = 'http://127.0.0.1:8000/?debug', w = '1280', h = '720'] = process.argv;
const ok = [];
const check = (n, c, i) => { ok.push(!!c); console.log(`${c ? 'OK ' : 'NG '} ${n}${i !== undefined ? ` — ${JSON.stringify(i)}` : ''}`); };
const FADE = 0.42; // src/dialogue.js
const ART_WAIT = 2.5;

const B = await launch(url, +w, +h);
const waitReady = async () => { for (let i = 0; i < 60; i++) { if (await B.ev('return !!(window.lumen && lumen.game.ready)')) return; await B.sleep(500); } };
const until = async (expr, ms = 8000) => { for (let t = 0; t < ms; t += 100) { const v = await B.ev(expr); if (v) return v; await B.sleep(100); } return null; };

// 그림 요청 가로채기: 이름(파일 이름 일부) → { delay } 또는 { status: 404 }
const rules = new Map();
B.on('Fetch.requestPaused', ({ requestId, request }) => {
  const rule = [...rules].find(([k]) => request.url.includes(k))?.[1];
  if (rule?.status) B.send('Fetch.fulfillRequest', { requestId, responseCode: rule.status, responseHeaders: [{ name: 'Content-Type', value: 'text/plain' }], body: '' });
  else setTimeout(() => B.send('Fetch.continueRequest', { requestId }), rule?.delay ?? 0);
});
const intercept = async (map) => {
  rules.clear();
  for (const [k, v] of Object.entries(map)) rules.set(k, v);
  await B.send('Fetch.enable', { patterns: [{ urlPattern: '*/art/*' }] });
};

const DEBUG = `
  window.T = {
    st() {
      const d = lumen.dialogue, a = document.getElementById('story-art');
      return { id: d.scene?.id ?? null, i: d.i, phase: d.phase, on: a.classList.contains('on'), src: a.querySelector('img').getAttribute('src'),
        fade: document.getElementById('story-fade').classList.contains('on'), live: document.getElementById('story-live').textContent,
        hidden: document.getElementById('story').classList.contains('hidden'), state: lumen.game.state };
    },
    // 줄 to까지 넘긴다(찍히는 중이면 다 보이고 넘김). 암전·기다림은 실제 시간으로 지나가게 둔다.
    async to(to) {
      const d = lumen.dialogue;
      for (let n = 0; n < 400 && d.scene && !(d.i === to && (d.phase === 'typing' || d.phase === 'wait')); n++) {
        if (d.i < to && (d.phase === 'typing' || d.phase === 'wait')) { d.advance(); if (d.phase === 'wait') d.advance(); }
        await new Promise((r) => setTimeout(r, 50));
      }
      return T.st();
    },
    frames() { return lumen.renderer.info.render.frame; },
  };
  return 1;`;

try {
  // ---------------------------------------------------------------- 1) 그림을 다 받는 보통 경우
  await waitReady();
  await B.ev(DEBUG);
  let r = await B.ev(`const s = getComputedStyle(document.getElementById('title-art'), '::before');
    return { bg: s.backgroundImage.slice(0, 30), failed: document.getElementById('title-art').classList.contains('failed'), text: !!document.querySelector('.title-logo.text-logo') }`);
  check('처음 화면: 그림 밑에 흐린 미리보기(data URI)가 깔려 있고 그림·로고는 정상', r.bg.startsWith('url("data:image/webp') && !r.failed && !r.text, r);
  r = await B.ev(`const a = T.frames(); await new Promise((r) => setTimeout(r, 800)); return T.frames() - a`);
  check('처음 화면: 그림이 덮는 동안 3D 장면을 그리지 않는다', r === 0, r);
  check('처음 화면에서 프롤로그 그림을 미리 받는다', await until(`return lumen.dialogue.artState.get('prologue-hand') === 'ok'`), await B.ev(`return [...lumen.dialogue.artState]`));

  await B.ev(`lumen.startGame(); return 1`);
  r = await until(`const s = T.st(); return s.id === 'arrival' && s.i === 0 && s.phase !== 'out' && s.phase !== 'in' ? s : null`);
  check('첫 줄의 그림이 깔린다(prologue-hand)', r?.on && r.src.endsWith('prologue-hand.webp'), r);
  check('화면 낭독기: 그림이 깔린 줄은 그림 설명 다음에 대사', r?.live.startsWith('그림: 어두운 방') && r.live.includes('그날 밤 엄마는'), r?.live);
  r = await B.ev(`return await T.to(1)`);
  check('그림이 그대로인 줄은 설명 없이 대사만', r.on && !r.live.startsWith('그림:'), r.live);
  r = await B.ev(`return await T.to(7)`);
  check('그림이 바뀐다(prologue-road), 설명도 다시', r.on && r.src.endsWith('prologue-road.webp') && r.live.startsWith('그림: 비 오는 밤'), r);
  r = await B.ev(`return await T.to(9)`);
  check('art: null 줄에서 그림이 걷힌다', !r.on && r.phase !== 'out', r);
  await B.ev(`lumen.dialogue.skip(); return 1`);
  r = await until(`const s = T.st(); return s.state === 'play' && s.hidden ? s : null`, 3000);
  check('끝까지 넘기지 않고 건너뛰어도 장면이 닫히고 그림이 걷힌다', r && !r.on && r.id === null, r ?? await B.ev('return T.st()'));

  // 그림이 깔린 채 건너뛰기
  await B.ev(`lumen.playScene('arrival'); return 1`);
  await until(`const s = T.st(); return s.i === 0 && s.on`);
  await B.ev(`lumen.dialogue.skip(); return 1`);
  r = await until(`const s = T.st(); return s.state === 'play' && s.hidden ? s : null`, 3000);
  check('그림이 깔린 채 건너뛰면 암전 뒤 그림이 걷힌다', r && !r.on, r ?? await B.ev('return T.st()'));

  // ---------------------------------------------------------------- 2) 그림이 늦게 오면 암전을 잡아 둔다
  // 그림 요청은 장면을 틀 때(play) 나간다. 헤드리스는 움직임 줄이기라 첫 줄이 바로 다 보여 곧바로 넘긴다.
  await intercept({ 'confession-switch': { delay: 1800 }, 'finale-firstlight': { delay: 7000 } });
  await B.ev(`lumen.playScene('promise'); return 1`);
  await until(`const s = T.st(); return s.id === 'promise' && s.i === 0 && s.phase === 'wait'`);
  const t0 = Date.now();
  await B.ev(`lumen.dialogue.advance(); return 1`);
  await B.sleep((FADE + 0.6) * 1000);
  r = await B.ev(`return T.st()`);
  check('늦는 그림: 암전 시간이 지나도 그림이 올 때까지 어두운 채 기다린다', r.i === 1 && r.phase === 'out' && r.fade && !r.on, r);
  r = await until(`const s = T.st(); return s.phase === 'typing' || s.phase === 'wait' ? s : null`, 5000);
  const held = (Date.now() - t0) / 1000;
  check('늦는 그림: 그림이 오면(기다림 상한 전에) 밝아지며 그림과 함께 대사가 나온다', r?.on && r.src.endsWith('confession-switch.webp') && held > 1.5 && held < FADE + ART_WAIT, { held, ...r });
  await B.ev(`lumen.dialogue.skip(); return 1`);
  await until(`return T.st().state === 'play'`, 3000);

  await B.ev(`lumen.playScene('finale'); return 1`);
  await until(`return T.st().id === 'finale'`);
  r = await B.ev(`return await T.to(8)`);
  const t1 = Date.now();
  await B.ev(`lumen.dialogue.advance(); if (lumen.dialogue.phase === 'wait') lumen.dialogue.advance(); return 1`);
  r = await until(`const s = T.st(); return s.i === 9 && (s.phase === 'typing' || s.phase === 'wait') ? s : null`, 7000);
  const waited = (Date.now() - t1) / 1000;
  check('아주 늦는 그림: 2.5초 더 기다린 뒤에는 그림 자리를 깔고 넘어간다', r?.on && waited > FADE + ART_WAIT - 0.3 && waited < FADE + ART_WAIT + 1.2, { waited, ...r });
  await B.ev(`lumen.dialogue.skip(); return 1`);
  await until(`return T.st().state === 'play'`, 3000);

  // ---------------------------------------------------------------- 3) 그림을 받지 못하면(404): 처음 화면은 3D·글자 로고, 컷신은 3D
  await intercept({ 'title-wide': { status: 404 }, 'title-tall': { status: 404 }, 'logo-': { status: 404 }, 'prologue-hand': { status: 404 } });
  await B.ev(`localStorage.clear(); return 1`);
  await B.send('Page.reload', { ignoreCache: true });
  await B.sleep(1000);
  await waitReady();
  await B.ev(DEBUG);
  r = await B.ev(`const h1 = document.querySelector('.title-logo');
    return { failed: document.getElementById('title-art').classList.contains('failed'), text: h1.classList.contains('text-logo'), label: h1.textContent.trim(),
      picture: !!h1.querySelector('picture'), shade: getComputedStyle(document.getElementById('title-art'), '::after').backgroundImage.startsWith('linear-gradient') }`);
  check('처음 화면 그림을 못 받으면 그림 자리를 비우고 어두운 겹은 남긴다', r.failed && r.shade, r);
  check('로고 그림을 못 받으면 깨진 그림 대신 글자 로고', r.text && !r.picture && r.label.includes('LUMEN HOLLOW') && r.label.includes('빛으로 버티는 밤'), r);
  r = await B.ev(`const a = T.frames(); await new Promise((r) => setTimeout(r, 800)); return T.frames() - a`);
  check('처음 화면 그림을 못 받으면 뒤에 3D 장면을 그린다', r > 5, r);
  await B.shot('cutscene-title-fallback');
  await until(`return lumen.dialogue.artState.get('prologue-hand') === 'fail'`);
  await B.ev(`lumen.startGame(); return 1`);
  r = await until(`const s = T.st(); return s.id === 'arrival' && s.i === 0 && (s.phase === 'typing' || s.phase === 'wait') ? s : null`);
  check('받지 못한 컷신 그림은 깔지 않는다(검은 바탕 대신 3D), 설명도 읽지 않는다', r && !r.on && !r.live.startsWith('그림:') && r.live.includes('그날 밤'), r);
  r = await B.ev(`return await T.to(7)`);
  check('다음 그림(받은 그림)은 그대로 깔린다', r.on && r.src.endsWith('prologue-road.webp'), r);
  await B.ev(`lumen.dialogue.skip(); return 1`);
  await until(`return T.st().state === 'play'`, 3000);
  await B.send('Fetch.disable');

  // ---------------------------------------------------------------- 4) 옛 index.html(그림 요소 없음)과 섞인 경우
  r = await B.ev(`
    document.getElementById('story-art').remove();
    const { SCENES } = await import('./src/script.js');
    const d = new lumen.dialogue.constructor({ sound: lumen.dialogue.sound });
    let ended = false, err = null;
    try {
      d.play(SCENES.find((s) => s.id === 'arrival'), { onCam() {}, onEnd() { ended = true; } });
      for (let k = 0; k < 30 && d.scene; k++) { d.update(0.5); d.advance(); }
      const i = d.i;
      d.skip();
      for (let k = 0; k < 6; k++) d.update(0.5);
      return { ok: d.ok, art: d.artImg, i, ended };
    } catch (e) { return { err: String(e) }; }`);
  check('그림 요소가 없는 옛 HTML: 장면이 그림 없이 돌고 끝난다', r.ok && r.art === null && r.i > 3 && r.ended && !r.err, r);

  const errs = B.logs.filter((l) => /error|exception/i.test(l) && !/caches|online|fetch|CORS|ERR_/i.test(l));
  check('콘솔 오류 없음', errs.length === 0, errs);
} catch (e) {
  check('시험 도중 예외', false, String(e?.stack ?? e));
} finally {
  await B.close();
}

console.log(`\n${ok.filter(Boolean).length}/${ok.length} 통과`);
process.exit(ok.every(Boolean) ? 0 : 1);
