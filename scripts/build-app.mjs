// 안드로이드 앱(Capacitor)에 담을 파일을 dist-app/에 모은다(#49).
// 웹판은 빌드 없이 저장소 그대로 배포하므로(.github/workflows/pages.yml), 여기서는 앱에 필요한 것만 복사하고
// 1) __BUILD__를 빌드 id로 바꾸고 2) index.html에 Capacitor 코어·App 플러그인 스크립트를 넣는다(src/native.js가 쓴다).
// 서비스 워커(sw.js)·docs/는 앱에 필요 없어 담지 않는다(src/pwa.js가 앱 안에서는 서비스 워커를 등록하지 않는다).
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist-app');
const COPY = ['index.html', 'style.css', 'favicon.svg', 'manifest.webmanifest', 'icons', 'art', 'src', 'vendor'];
const CAPACITOR = [
  // [원본, dist-app 안 경로]
  ['node_modules/@capacitor/core/dist/capacitor.js', 'vendor/capacitor/capacitor.js'],
  ['node_modules/@capacitor/core/LICENSE', 'vendor/capacitor/LICENSE-capacitor-core'],
  ['node_modules/@capacitor/app/dist/plugin.js', 'vendor/capacitor/app.js'],
  ['node_modules/@capacitor/app/LICENSE', 'vendor/capacitor/LICENSE-capacitor-app'],
];

function fail(msg) {
  console.error(`[build-app] ${msg}`);
  process.exit(1);
}

let build;
try {
  build = execSync('git rev-parse --short=8 HEAD', { cwd: root }).toString().trim();
} catch {
  fail('git 커밋을 읽지 못했습니다. 저장소 안에서 실행하세요.');
}
const dirty = execSync('git status --porcelain -- src index.html style.css art vendor', { cwd: root }).toString().trim();
const id = `app-${build}${dirty ? '-dirty' : ''}`;

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const p of COPY) {
  if (!existsSync(join(root, p))) fail(`${p} 가 없습니다.`);
  cpSync(join(root, p), join(out, p), { recursive: true });
}
for (const [from, to] of CAPACITOR) {
  if (!existsSync(join(root, from))) fail(`${from} 가 없습니다. 저장소 루트에서 npm ci를 먼저 하세요.`);
  mkdirSync(dirname(join(out, to)), { recursive: true });
  cpSync(join(root, from), join(out, to));
}

const indexPath = join(out, 'index.html');
let html = readFileSync(indexPath, 'utf8');
if (!html.includes('__BUILD__')) fail('index.html에 __BUILD__ 표식이 없습니다.');
html = html.replaceAll('__BUILD__', id);
// 2~4장 결제 잠금(#51). 기본은 켜짐. Play Console에 상품(story_ch2_4)과 라이선스 테스터를 갖추기 전에 테스터에게 줄 빌드는
// LUMEN_PAYWALL=off로 만들면 2~4장이 그냥 열린다(src/main.js가 이 메타를 읽는다). 프로덕션 빌드는 반드시 켠다.
const paywall = (process.env.LUMEN_PAYWALL ?? 'on').toLowerCase();
if (!['on', 'off'].includes(paywall)) fail(`LUMEN_PAYWALL은 on 또는 off여야 합니다: ${paywall}`);
const meta = '<meta name="lumen-paywall" content="on">';
if (!html.includes(meta)) fail('index.html에 결제 잠금 메타가 없습니다.');
html = html.replace(meta, `<meta name="lumen-paywall" content="${paywall}">`);
// 스타일보다 먼저(모듈보다 확실히 앞에) 넣는다. capacitor.js가 capacitorExports를, app.js가 capacitorApp을 만든다.
const anchor = '<link rel="stylesheet" href="style.css';
if (!html.includes(anchor)) fail('index.html에서 스타일 링크를 찾지 못했습니다.');
html = html.replace(anchor, '<script src="vendor/capacitor/capacitor.js"></script>\n  <script src="vendor/capacitor/app.js"></script>\n  ' + anchor);
if (html.includes('__BUILD__')) fail('__BUILD__ 치환 실패');
writeFileSync(indexPath, html);

console.log(`[build-app] ${out} (build ${id}, 2~4장 결제 잠금 ${paywall})`);
