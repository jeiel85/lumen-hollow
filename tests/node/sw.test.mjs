// 서비스 워커 사전 캐시 목록(#10 "사전 캐시 목록 이중 관리"): sw.js의 MODULES·VENDOR·UNVERSIONED가 가리키는 파일이
// 저장소에 다 있고, import map·manifest와 짝이 맞는다. 하나라도 없으면 설치가 실패해 오프라인 실행이 조용히 사라진다.
// 배포 워크플로(.github/workflows/pages.yml)가 배포 전에 이 시험만 따로 돌린다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(repo, rel), 'utf8');
const strip = (p) => p.split('?')[0];

// sw.js를 실제로 실행해 목록을 꺼낸다(정규식으로 긁지 않아, 목록을 어떻게 적든 같은 값을 본다).
const sandbox = { self: { addEventListener() {}, location: { origin: 'https://example.test' } } };
const sw = vm.runInNewContext(`${read('sw.js')}\n;({ BUILD, MODULES, VERSIONED, VENDOR, UNVERSIONED })`, sandbox);

test('사전 캐시 목록의 파일이 저장소에 모두 있다', () => {
  const all = [...sw.VERSIONED, ...sw.VENDOR, ...sw.UNVERSIONED].map(strip);
  const missing = all.filter((p) => !existsSync(path.join(repo, p)));
  assert.deepEqual(missing, [], 'sw.js가 가리키는 파일이 없다. 설치(addAll)가 실패해 오프라인 실행이 꺼진다');
});

test('MODULES가 src/*.js와 정확히 같다', () => {
  const src = readdirSync(path.join(repo, 'src')).filter((f) => f.endsWith('.js')).map((f) => `src/${f}`).sort();
  assert.deepEqual([...sw.MODULES].sort(), src);
});

test('import map의 주소가 사전 캐시에 같은 버전으로 들어 있다', () => {
  const html = read('index.html');
  const map = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
  const cached = new Set([...sw.VENDOR, ...sw.VERSIONED].map((p) => p.replace(`?v=${sw.BUILD}`, '?v=__BUILD__')));
  const urls = Object.values(map).map((u) => u.replace(/^\.\//, ''));
  const missing = urls.filter((u) => !cached.has(u));
  assert.deepEqual(missing, [], 'import map이 가리키는 주소를 서비스 워커가 받아 두지 않는다(오프라인에서 모듈을 못 찾는다)');
  assert.ok(html.includes('src="src/main.js?v=__BUILD__"'));
  assert.ok(html.includes('href="style.css?v=__BUILD__"'));
});

test('manifest의 아이콘·스크린샷과 apple-touch-icon이 있고, 아이콘은 사전 캐시에 들어 있다', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  const files = [...manifest.icons, ...(manifest.screenshots ?? [])].map((i) => i.src);
  const missing = files.filter((p) => !existsSync(path.join(repo, p)));
  assert.deepEqual(missing, []);
  const unversioned = new Set(sw.UNVERSIONED);
  assert.deepEqual(manifest.icons.map((i) => i.src).filter((p) => !unversioned.has(p)), []);
  const apple = read('index.html').match(/rel="apple-touch-icon" href="([^"]+)"/)[1];
  assert.ok(unversioned.has(apple), apple);
});

test('그림(art/)이 쓰는 곳·사전 캐시·폴더와 짝이 맞는다', async () => {
  // 처음 화면·메뉴 그림은 index.html·style.css가, 컷신 그림은 대본 줄의 art(src/script.js)가 가리킨다.
  // 사전 캐시에 없으면 오프라인에서 그림이 비고, 배포 단계가 art/를 빼먹으면 404가 난다.
  const { SCENES } = await import(pathToFileURL(path.join(repo, 'src/script.js')).href);
  const story = SCENES.flatMap((s) => s.lines.filter((l) => l.art).map((l) => `art/story/${l.art}.webp`));
  const used = new Set([...[read('index.html'), read('style.css')].flatMap((s) => [...s.matchAll(/art\/[\w.-]+\.webp/g)].map((m) => m[0])), ...story]);
  const cached = new Set(sw.UNVERSIONED.filter((p) => p.startsWith('art/')));
  const files = new Set(readdirSync(path.join(repo, 'art'), { recursive: true }).filter((f) => f.endsWith('.webp')).map((f) => `art/${f.split(path.sep).join('/')}`));
  assert.deepEqual([...used].filter((p) => !cached.has(p)), [], '화면이 쓰는 그림이 사전 캐시에 없다');
  assert.deepEqual([...cached].filter((p) => !used.has(p)), [], '사전 캐시에 있지만 화면이 쓰지 않는 그림');
  assert.deepEqual([...files].filter((p) => !used.has(p)), [], 'art/에 있지만 쓰지 않는 그림(배포 크기만 늘린다)');
  assert.match(read('.github/workflows/pages.yml'), /cp -r [^\n]*\bart\b[^\n]*_site\//, '배포 단계가 art/를 _site로 옮기지 않는다');
});
