// 헤드리스 Chrome을 CDP로 조종하는 작은 도구. launch(url, w, h) → { ev, shot, sleep, close, logs, send, on }
// Chrome 위치는 환경 변수 CHROME, 없으면 운영체제별 기본 위치. Windows는 GPU(d3d11), 그 밖은 소프트웨어 GL.
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, mkdirSync, existsSync, readdirSync, statSync, rmSync, renameSync } from 'node:fs';
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

// Chrome 프로필은 실행마다 하나(약 60MB)라 지우지 않으면 임시 폴더에 쌓인다(800개, 46GB까지 쌓였던 적이 있다).
// 한 폴더(tmp/lumen-cdp) 밑에 만들고 세 번 지운다: close() 때, 프로세스가 끝날 때(시험들이 close()를 기다리지 않고
// 곧바로 process.exit()하므로 동기로), 강제 종료로 남은 것은 다음 launch() 때 하루 지난 것만.
const PROFILE_ROOT = join(tmpdir(), 'lumen-cdp');
const STALE_MS = 24 * 60 * 60 * 1000;
const live = new Map(); // 프로필 경로 → Chrome 프로세스
const waitSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const removeProfile = (dir) => {
  // Chrome을 끈 직후 Windows는 파일 핸들이 1초 남짓 남아 EPERM이 난다. Node 24의 rmSync는 maxRetries를 받아도
  // 곧바로 실패하므로(실측 4ms) 직접 다시 시도한다. 그래도 남으면 다음 launch()가 치운다.
  for (let i = 0; i < 50; i++) {
    try { rmSync(dir, { recursive: true, force: true }); return true; } catch { waitSync(100); }
  }
  return false;
};
// proc.kill()은 Chrome 본체만 끄고, GPU·렌더러 하위 프로세스가 잠깐 더 살아 프로필 파일을 잡는다.
// Windows는 taskkill /T로 프로세스 트리를 끝날 때까지 기다려 끈다(동기라 exit 처리기에서도 쓸 수 있다).
const killTree = (proc) => {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
  else proc.kill('SIGKILL');
};
const release = (dir) => {
  const proc = live.get(dir);
  if (!proc) return;
  live.delete(dir);
  killTree(proc);
  removeProfile(dir);
};
process.on('exit', () => { for (const dir of [...live.keys()]) release(dir); });
const sweepStale = () => {
  let names = [];
  try { names = readdirSync(PROFILE_ROOT); } catch { return; }
  const now = Date.now();
  for (const name of names) {
    const dir = join(PROFILE_ROOT, name);
    // 다른 시험이 아직 쓰는 프로필은 Windows에서 이름 바꾸기가 실패하므로, 바뀐 것만 지운다(쓰는 중인 것을 반쯤 지우지 않게).
    try {
      if (now - statSync(dir).mtimeMs <= STALE_MS) continue;
      const doomed = `${dir}.del`;
      renameSync(dir, doomed);
      removeProfile(doomed);
    } catch { /* 쓰는 중이거나 이미 없음 */ }
  }
};

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
  if (!CHROME) throw new Error('Chrome을 찾지 못했다. 환경 변수 CHROME에 실행 파일 경로를 준다.');
  sweepStale();
  mkdirSync(PROFILE_ROOT, { recursive: true });
  const profile = mkdtempSync(join(PROFILE_ROOT, 'p-'));
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    `--window-size=${w},${h}`, ...GPU,
    // 게임 글의 언어는 기기 언어를 따른다(#60). 시험은 한국어로 돌리고, 영어는 주소에 ?lang=en을 붙여 본다.
    ...(EN ? ['--lang=en-US', '--accept-lang=en-US,en'] : ['--lang=ko-KR', '--accept-lang=ko-KR,ko']),
    '--autoplay-policy=no-user-gesture-required', '--hide-scrollbars', 'about:blank',
  ], { stdio: 'ignore' });
  live.set(profile, proc);
  let target;
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch { /* 아직 */ }
    await sleep(200);
  }
  if (!target) { release(profile); throw new Error('chrome did not start'); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  const logs = [];
  const handlers = new Map(); // CDP 이벤트 이름 → 받는 함수들(on으로 단다, 예: Fetch.requestPaused)
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    if (msg.method) for (const fn of handlers.get(msg.method) ?? []) fn(msg.params);
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
    release(profile);
  };
  const on = (method, fn) => { if (!handlers.has(method)) handlers.set(method, []); handlers.get(method).push(fn); };
  return { ev, shot, sleep, close, logs, send, hangul, on };
}
