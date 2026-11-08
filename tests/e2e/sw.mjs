// 서비스 워커(#10): 첫 설치 → 오프라인 실행 준비됨, 새 빌드 활성화 → 처음 화면 '새 버전이 준비됐어요 · 다시 열기',
// 파일이 빠진 새 빌드·덜 퍼진 배포 → '지난 버전으로 준비됨(이유)', 열어 둔 탭의 한 시간 간격 새 버전 확인,
// 첫 설치부터 실패 → '아직 안 됐어요(이유)'.
// 저장소를 빌드 번호를 찍어 임시 폴더에 복사하고 그 폴더를 직접 띄운다(배포 워크플로의 __BUILD__ 치환과 같다). python이 필요하다.
//   node tests/e2e/sw.mjs [포트]
import { cpSync, rmSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, readdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch } from './cdp.mjs';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const SITE = mkdtempSync(join(tmpdir(), 'lumen-sw-'));
const PORT = Number(process.argv[2] ?? 8790);

function stamp(build, { drop = null, pageBuild = build } = {}) {
  mkdirSync(SITE, { recursive: true });
  for (const e of readdirSync(SITE)) rmSync(join(SITE, e), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); // Windows: 서버가 막 내준 파일이 잠깐 잠겨 있을 수 있다
  for (const f of ['index.html', 'style.css', 'favicon.svg', 'manifest.webmanifest', 'sw.js', 'icons', 'art', 'src', 'vendor', 'docs']) cpSync(join(REPO, f), join(SITE, f), { recursive: true });
  writeFileSync(join(SITE, 'index.html'), readFileSync(join(SITE, 'index.html'), 'utf8').replaceAll('__BUILD__', pageBuild));
  writeFileSync(join(SITE, 'sw.js'), readFileSync(join(SITE, 'sw.js'), 'utf8').replaceAll('__BUILD__', build));
  if (drop) unlinkSync(join(SITE, drop));
}

const ok = [];
const check = (n, c, i) => { ok.push(!!c); console.log(`${c ? 'OK ' : 'NG '} ${n}${i !== undefined ? ` — ${JSON.stringify(i)}` : ''}`); };
const server = spawn(process.platform === 'win32' ? 'python' : 'python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: SITE, stdio: 'ignore' });
const url = `http://127.0.0.1:${PORT}/?debug`;
const state = `return { offline: document.getElementById('offline-status').textContent, update: !document.getElementById('update-note').classList.contains('hidden'),
  ctrl: !!navigator.serviceWorker.controller, build: [...document.scripts].find(s => s.src.includes('main.js'))?.src.split('v=')[1] }`;
const waitReady = async (B) => { for (let i = 0; i < 60; i++) { if (await B.ev('return !!(window.lumen && lumen.game.ready)')) return; await B.sleep(500); } };
const until = async (B, expr, ms = 15000) => { for (let t = 0; t < ms; t += 300) { const v = await B.ev(expr); if (v) return v; await B.sleep(300); } return null; };

try {
  // 1) 첫 설치(정상)
  stamp('aaaa1111');
  await new Promise((r) => setTimeout(r, 800));
  let B = await launch(url, 1280, 720);
  await waitReady(B);
  await until(B, `return document.getElementById('offline-status').textContent.includes('준비됐어요')`);
  let r = await B.ev(state);
  check('첫 설치 뒤 오프라인 실행 준비됨, 새 버전 안내 없음', r.offline.startsWith('오프라인 실행: 준비됐어요') && !r.update, r);

  // 2) 새 빌드 배포 → 열린 옛 탭에 '다시 열기'
  stamp('bbbb2222');
  await B.ev(`const reg = await navigator.serviceWorker.getRegistration(); await reg.update(); return true`);
  await until(B, `return !document.getElementById('update-note').classList.contains('hidden')`);
  r = await B.ev(state);
  check('새 빌드가 활성화되면 처음 화면에 새 버전 안내', r.update && r.build === 'aaaa1111', r);
  await B.shot('sw-update-note');
  await B.ev(`document.getElementById('settings-btn').click(); return true`);
  await B.sleep(300);
  r = await B.ev(state);
  check('설정 화면 오프라인 줄도 새 버전을 알린다', r.offline.includes('새 버전이 준비됐어요'), r.offline);
  await B.ev(`document.getElementById('settings-close').click(); return true`);
  await B.ev(`document.getElementById('update-reload').click(); return true`);
  await B.sleep(1500);
  await waitReady(B);
  r = await B.ev(state);
  check("'다시 열기' 뒤에는 새 빌드로 열리고 안내가 없다", r.build === 'bbbb2222' && !r.update && r.ctrl, r);

  // 3) 파일이 빠진 빌드 → 설치 실패, 지난 버전으로 준비됨 + 이유
  stamp('cccc3333', { drop: 'icons/icon-192.png' });
  await B.ev(`const reg = await navigator.serviceWorker.getRegistration(); try { await reg.update(); } catch {} return true`);
  await until(B, `return document.getElementById('offline-status').textContent.includes('지난 버전')`);
  r = await B.ev(state);
  check('파일이 빠진 새 빌드: 지난 버전으로 준비됨 + 빠진 파일 이름', r.offline.includes('지난 버전') && r.offline.includes('icons/icon-192.png 404') && !r.update, r.offline);

  // 4) 배포가 덜 퍼짐(페이지 빌드가 다름)
  stamp('dddd4444', { pageBuild: 'bbbb2222' });
  await B.ev(`const reg = await navigator.serviceWorker.getRegistration(); try { await reg.update(); } catch {} return true`);
  await until(B, `return document.getElementById('offline-status').textContent.includes('퍼지지')`);
  r = await B.ev(state);
  check('페이지 빌드가 다르면: 새 버전이 아직 다 퍼지지 않았어요', r.offline.includes('아직 서버에 다 퍼지지 않았어요'), r.offline);

  // 4-1) 열어 둔 탭이 스스로 새 버전을 확인한다(pwa.js watchForUpdates). 테스트가 reg.update()를 부르지 않는다.
  // 마지막 확인에서 한 시간이 안 지났으면 화면 복귀(visibilitychange)에도 확인하지 않고, 지났으면 확인한다.
  stamp('ffff6666');
  await B.ev(`document.dispatchEvent(new Event('visibilitychange')); return true`);
  await B.sleep(4000);
  r = await B.ev(state);
  check('한 시간이 안 지났으면 화면 복귀에도 새 버전을 확인하지 않는다', !r.update, r);
  await B.ev(`const real = Date.now; Date.now = () => real() + 2 * 3600e3; document.dispatchEvent(new Event('visibilitychange')); return true`);
  await until(B, `return !document.getElementById('update-note').classList.contains('hidden')`);
  r = await B.ev(state);
  check('한 시간이 지난 뒤 화면으로 돌아오면 스스로 확인해 새 버전 안내를 띄운다', r.update && r.build === 'bbbb2222', r);
  const errs = B.logs.filter((l) => /error|exception/i.test(l) && !/caches|online|fetch|CORS|ERR_|sw\.js|ServiceWorker|service worker/i.test(l));
  check('콘솔 오류 없음(서비스 워커 설치 실패 로그 제외)', errs.length === 0, errs);
  B.close();

  // 5) 처음부터 설치 실패(새 프로필)
  stamp('eeee5555', { drop: 'icons/maskable-512.png' });
  B = await launch(url, 1280, 720);
  await waitReady(B);
  await until(B, `return document.getElementById('offline-status').textContent.includes('아직 안 됐어요')`);
  r = await B.ev(state);
  check('첫 설치가 실패하면 아직 안 됐어요 + 이유, 게임은 그대로 열린다', r.offline.includes('아직 안 됐어요') && r.offline.includes('maskable-512.png') && !r.ctrl, r.offline);
  await B.ev(`document.getElementById('settings-btn').click(); return true`);
  await B.sleep(400);
  await B.shot('sw-failed-settings');
  B.close();
} finally {
  server.kill();
  setTimeout(() => { try { rmSync(SITE, { recursive: true, force: true }); } catch { /* 윈도에서 서버가 늦게 놓으면 임시 폴더가 남는다 */ } }, 300);
}
console.log(`
${ok.filter(Boolean).length}/${ok.length} 통과`);
setTimeout(() => process.exit(ok.every(Boolean) ? 0 : 1), 500);
