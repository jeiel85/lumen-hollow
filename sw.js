// 서비스 워커: 한 번 받은 게임을 인터넷 없이도 열 수 있게 한다.
// - 배포 워크플로가 __BUILD__를 커밋 SHA로 바꾼다. 빌드마다 캐시를 따로 두고 이전 캐시는 지운다.
// - 페이지(index.html)는 네트워크 우선(새 배포를 바로 받음), 실패하면 캐시.
// - ?v=빌드 가 붙은 파일은 내용이 바뀌지 않으므로 캐시 우선.
// - 설치 실패·새 빌드 활성화를 열린 페이지에 알린다(src/pwa.js가 설정 화면·처음 화면에 보인다). 서버로는 아무것도 보내지 않는다.
// src/에 모듈을 추가하면 아래 MODULES에도 넣어야 한다. 사전 캐시 목록(MODULES·VENDOR·UNVERSIONED)의 파일이
// 저장소에 다 있는지는 배포 워크플로가 tests/node/sw.test.mjs로 검사한다.
//
// skipWaiting 즉시 교체의 전제(DECISIONS.md "서비스 워커 캐시 전략"): 새 빌드는 설치가 끝나자마자 옛 빌드를 밀어내고,
// 활성화 때 옛 캐시를 지운다. 열어 둔 탭도 한 시간마다 새 버전을 확인하므로(src/pwa.js) 판 도중 교체가 흔하다.
// 지금은 페이지가 시작할 때 모든 모듈·자산을 한 번에 받아 두므로, 열려 있던 옛 탭이
// 나중에 찾을 파일이 없다. 필요할 때 받는 자산(지연 로드 모듈·글꼴·소리 파일 등)을 더하면 옛 탭은 지워진 옛 캐시에서
// 그 파일을 찾지 못하고(새 빌드 파일은 ?v=가 달라 쓸 수 없다) 오프라인에서 깨진다. 그때는 skipWaiting을 빼고
// 새 버전 안내의 '다시 열기'로 교체하거나, 옛 캐시를 옛 탭이 닫힐 때까지 남겨야 한다.
const BUILD = '__BUILD__';
const CACHE = `lumen-${BUILD}`;
const MODULES = [
  'src/main.js', 'src/audio.js', 'src/caches.js', 'src/chapters.js', 'src/dialogue.js', 'src/difficulty.js', 'src/env.js', 'src/geometry.js', 'src/grid.js', 'src/hud.js', 'src/i18n.js', 'src/i18n.en.js',
  'src/input.js', 'src/minimap.js', 'src/music.js', 'src/native.js', 'src/nights.js', 'src/online.js', 'src/player.js', 'src/post.js', 'src/pwa.js', 'src/records.js', 'src/rng.js',
  'src/runsave.js', 'src/script.js', 'src/script.en.js', 'src/settings.js', 'src/shades.js', 'src/slots.js', 'src/storage.js', 'src/store.js', 'src/story.js',
  'src/vehicle.js', 'src/wardrobe.js', 'src/wisps.js', 'src/world.js',
];
const VERSIONED = ['style.css', ...MODULES].map((p) => `${p}?v=${BUILD}`);
const VENDOR = ['vendor/three/three.module.js?v=r187', 'vendor/three/three.core.js?v=r187'];
// 버전 쿼리가 없는 파일. 내용이 바뀌어도 주소가 같아서, 그냥 받으면 HTTP 캐시(Pages 10분)에 남은 옛 파일이
// 새 빌드 캐시에 들어가 다음 배포 때까지 남는다(manifest id를 고쳐도 Chrome이 옛 id를 보던 문제). 그래서 새로 받는다.
const UNVERSIONED = [
  'favicon.svg', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
  // 처음 화면·메뉴 그림(index.html·style.css가 가리킨다). 버전 쿼리 없이 같은 주소라 옛 탭도 새 캐시에서 찾는다.
  // 그래서 그림 내용을 바꿀 때는 파일 이름을 바꾼다(같은 이름이면 HTTP 캐시 10분·이 캐시에 옛 그림이 남는다, tools/art/README.md).
  'art/title-wide.webp', 'art/title-tall.webp', 'art/logo-wide.webp', 'art/logo-stack.webp', 'art/logo-wide-en.webp', 'art/logo-stack-en.webp', 'art/panel.webp',
  'art/btn-lit.webp', 'art/btn-dark.webp', 'art/icon-closet.webp', 'art/icon-journal.webp', 'art/icon-settings.webp',
  'art/icon-install.webp', 'art/icon-grid.webp',
  // 1장 이야기 장면의 컷신 그림(src/script.js 줄의 art). 오프라인에서도 장면이 그림과 함께 나오게 미리 받는다.
  // 웹판은 1장 데모라(#50) 2~4장 그림(약 0.9MB)은 받지 않는다 — 앱은 그림을 앱 안에 담고 서비스 워커를 쓰지 않는다(#45).
  ...['prologue-hand', 'prologue-road', 'confession-switch', 'finale-firstlight'].map((n) => `art/story/${n}.webp`),
];
const NAV_TIMEOUT = 4000;

// 열린 페이지(아직 이 워커가 맡지 않은 페이지 포함)에 상태를 알린다. 받는 쪽은 src/pwa.js.
async function notify(msg) {
  const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const c of list) c.postMessage({ type: 'lumen-sw', build: BUILD, ...msg });
}

class InstallError extends Error {
  constructor(code, detail = '') {
    super(`${code} ${detail}`.trim());
    this.code = code;
    this.detail = detail;
  }
}

const pathOf = (req) => new URL(req.url).pathname.split('/').slice(-2).join('/');

// addAll은 하나라도 실패하면 전부 넣지 않지만 어느 파일인지 알려 주지 않는다. 실패했을 때만 다시 물어 원인을 찾는다.
// addAll이 실패하며 동시에 받던 요청들을 끊은 직후라, 물음이 끊긴 연결에 걸려 실패할 수 있다. 곧바로 한 번 더 물어도
// 같은 연결에 걸려 빠진 파일을 '연결이 끊겼어요'로 잘못 알렸다(시험 서버에서 8번 중 2번). 잠깐씩 쉬며 세 번까지 묻는다.
// 정말 오프라인이면 세 번 다 실패해 'network'가 된다(그때 더 기다리는 것은 0.75초).
async function head(req) {
  for (let i = 0; ; i++) {
    try {
      return await fetch(req.clone(), { method: 'HEAD', cache: 'no-store' });
    } catch (err) {
      if (i >= 2) throw err;
      await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
}

async function diagnose(reqs) {
  for (const req of reqs) {
    let res;
    try {
      res = await head(req);
    } catch {
      return new InstallError('network');
    }
    if (!res.ok) return new InstallError('missing', `${pathOf(req)} ${res.status}`);
  }
  return null;
}

async function precache(state) {
  // 페이지는 이 서비스 워커와 같은 빌드여야 오프라인에서 짝이 맞는 모듈을 찾는다.
  // 배포가 아직 덜 퍼져 옛 페이지가 오면 설치를 실패시키고(지금 쓰던 서비스 워커가 그대로 남는다), 다음 방문 때 다시 시도한다.
  let page;
  try {
    page = await fetch(new Request('./', { cache: 'reload' }));
  } catch {
    throw new InstallError('network');
  }
  if (!page.ok) throw new InstallError('page', String(page.status));
  if (!(await page.clone().text()).includes(`?v=${BUILD}`)) throw new InstallError('mismatch');
  state.created = !(await caches.has(CACHE));
  const cache = await caches.open(CACHE);
  const reqs = [...VERSIONED, ...VENDOR].map((p) => new Request(p)).concat(UNVERSIONED.map((p) => new Request(p, { cache: 'reload' })));
  try {
    await cache.addAll(reqs);
  } catch (err) {
    if (err?.name === 'QuotaExceededError') throw new InstallError('quota');
    throw (await diagnose(reqs)) ?? new InstallError('other', err?.message ?? String(err));
  }
  await cache.put('./', page);
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const state = { created: false };
    try {
      await precache(state);
    } catch (err) {
      // 이번 설치가 만든 빈 캐시는 남기지 않는다. 같은 이름의 캐시가 이미 있었다면(빌드가 안 찍힌 로컬 개발에서
      // sw.js만 고친 경우) 지금 쓰는 서비스 워커의 캐시이니 건드리지 않는다.
      if (state.created) await caches.delete(CACHE).catch(() => {});
      const code = err instanceof InstallError ? err.code : err?.name === 'QuotaExceededError' ? 'quota' : 'other';
      await notify({ state: 'failed', code, detail: err?.detail ?? err?.message ?? '' }).catch(() => {});
      throw err; // 설치를 실패시켜 지금 쓰던 서비스 워커(있다면)를 그대로 둔다.
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('lumen-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
    // 옛 빌드로 열려 있던 페이지는 이 소식을 받고 '새 버전이 준비됐어요'를 띄운다.
    await notify({ state: 'activated' });
  })());
});

async function cachedPage() {
  const cache = await caches.open(CACHE);
  return cache.match('./');
}

// 네트워크가 느리면(지하철 등) 무한정 기다리지 않고, 서버가 오류(503 등)를 내면 그 오류 대신 받아 둔 페이지를 연다.
// 느린 회선에서 받아 둔 옛 빌드가 열리면, 그동안 새 서비스 워커가 설치되고 페이지가 '다시 열기' 안내를 보인다.
async function navigate(request) {
  const network = fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' })
    .then((res) => (res.redirected ? Response.redirect(res.url, 302) : res));
  const timeout = new Promise((resolve) => setTimeout(resolve, NAV_TIMEOUT, null));
  let res = null;
  try {
    res = await Promise.race([network, timeout]);
  } catch {
    res = null; // 오프라인 등 네트워크 실패
  }
  if (res && res.status < 400) return res; // 정상 응답(리디렉트 포함)
  const page = await cachedPage();
  if (page) return page;
  // 받아 둔 페이지가 없으면 서버의 오류 응답을 그대로 보여 주고, 시간 초과였다면 네트워크를 끝까지 기다린다.
  return res ?? network;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(navigate(request));
    return;
  }
  event.respondWith(caches.match(request).then((hit) => hit ?? fetch(request)));
});
