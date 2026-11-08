// 헤드리스 Chrome을 CDP로 조종하는 작은 도구. launch(url, w, h) → { ev, shot, sleep, close, logs, send }
// Chrome 위치는 환경 변수 CHROME, 없으면 운영체제별 기본 위치. Windows는 GPU(d3d11), 그 밖은 소프트웨어 GL.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHROME = process.env.CHROME ?? [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => existsSync(p));
const GPU = process.platform === 'win32'
  ? ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11']
  : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'];
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 2~4장에 들어가는 시험은 앱처럼 연다. 웹판은 1장 데모라(#50) 로컬 개발에서 ?app을 붙여야 2~4장이 열린다(src/main.js FULL_GAME).
export function fullGame(url) {
  const u = new URL(url);
  u.searchParams.set('app', '1');
  return u.href;
}

// 영어 기기 흉내(#60): E2E_LANG=en이면 기기 언어를 영어로 두고 주소에 ?lang=en을 붙이며, 페이지가 열리는 순간부터
// 화면(글자·aria-label·title·alt·placeholder)에 나타나는 한글을 모두 모아 close() 때 'HANGUL' 줄로 알린다.
// 한국어 문구를 확인하는 항목은 영어에서 당연히 NG가 나니, 이 모드에서는 HANGUL 줄만 본다.
const EN = process.env.E2E_LANG === 'en';
const HANGUL_WATCH = `
  (() => {
    const seen = new Map();
    const H = /[가-힣]/;
    const note = (s, where) => { s = String(s).trim(); if (s && H.test(s) && !seen.has(s)) seen.set(s, where); };
    const scan = (node) => {
      if (!node) return;
      if (node.nodeType === 3) { if (!node.parentElement?.closest('[data-no-t], script, style, noscript')) note(node.nodeValue, node.parentElement?.id || node.parentElement?.className || '?'); return; }
      if (node.nodeType !== 1 || node.closest('[data-no-t]') || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(node.tagName)) return;
      for (const a of ['aria-label', 'title', 'alt', 'placeholder']) if (node.hasAttribute(a)) note(node.getAttribute(a), '@' + a);
      for (const c of node.childNodes) scan(c);
    };
    window.__hangul = seen;
    // HTML을 읽는 동안의 원문(번역 전)은 보지 않는다. 게임 모듈은 DOMContentLoaded 전에 돌며 고정 글을 바꾸므로(translateDom)
    // 그 뒤의 화면 전체를 한 번 훑고, 이후 바뀌거나 더해지는 것을 본다.
    addEventListener('DOMContentLoaded', () => {
      scan(document.body);
      if (H.test(document.title)) note(document.title, '<title>');
      new MutationObserver((list) => {
        for (const m of list) {
          if (m.type === 'characterData') scan(m.target);
          else if (m.type === 'attributes') scan(m.target);
          else for (const n of m.addedNodes) scan(n);
        }
      }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'title', 'alt', 'placeholder'] });
    });
  })();`;

export async function launch(url, w = 1280, h = 720, { outDir } = {}) {
  if (EN) {
    const u = new URL(url);
    u.searchParams.set('lang', 'en');
    url = u.href;
  }
  const port = 9500 + Math.floor(Math.random() * 400);
  const profile = mkdtempSync(join(tmpdir(), 'cdp-'));
  if (!CHROME) throw new Error('Chrome을 찾지 못했다. 환경 변수 CHROME에 실행 파일 경로를 준다.');
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    `--window-size=${w},${h}`, ...GPU,
    // 게임 글의 언어는 기기 언어를 따른다(#60). 시험은 한국어로 돌리고, 영어는 주소에 ?lang=en을 붙여 본다.
    ...(EN ? ['--lang=en-US', '--accept-lang=en-US,en'] : ['--lang=ko-KR', '--accept-lang=ko-KR,ko']),
    '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars', 'about:blank',
  ], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch { /* 아직 */ }
    await sleep(200);
  }
  if (!target) { proc.kill(); throw new Error('chrome did not start'); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method === 'Runtime.consoleAPICalled') logs.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    if (msg.method === 'Runtime.exceptionThrown') logs.push(`exception: ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text };
    return r.result?.result?.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  const mobile = w < 700;
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
  if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  if (EN) await send('Page.addScriptToEvaluateOnNewDocument', { source: HANGUL_WATCH });
  await send('Page.navigate', { url });
  const dir = outDir ?? fileURLToPath(new URL('./shots/', import.meta.url));
  mkdirSync(dir, { recursive: true });
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 82 });
    const file = join(dir, `${name}.jpg`);
    writeFileSync(file, Buffer.from(r.result.data, 'base64'));
    return file;
  };
  const hangul = async () => (await ev('return window.__hangul ? [...window.__hangul].map(([s, w]) => `${w}: ${s.slice(0, 80)}`) : []')) ?? [];
  const close = async () => {
    if (EN) {
      const left = await hangul().catch(() => ['(읽지 못함)']);
      console.log(`HANGUL ${left.length}${left.length ? '\n  ' + left.slice(0, 40).join('\n  ') : ''}`);
    }
    try { ws.close(); } catch { /* */ }
    proc.kill();
  };
  return { ev, shot, sleep, close, logs, send, hangul };
}
