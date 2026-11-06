// 서비스 워커: 한 번 받은 게임을 인터넷 없이도 열 수 있게 한다.
// - 배포 워크플로가 __BUILD__를 커밋 SHA로 바꾼다. 빌드마다 캐시를 따로 두고 이전 캐시는 지운다.
// - 페이지(index.html)는 네트워크 우선(새 배포를 바로 받음), 실패하면 캐시.
// - ?v=빌드 가 붙은 파일은 내용이 바뀌지 않으므로 캐시 우선.
// src/에 모듈을 추가하면 아래 MODULES에도 넣어야 한다(배포 워크플로가 검사한다).
const BUILD = '__BUILD__';
const CACHE = `lumen-${BUILD}`;
const MODULES = [
  'src/main.js', 'src/audio.js', 'src/caches.js', 'src/dialogue.js', 'src/env.js', 'src/geometry.js', 'src/grid.js', 'src/hud.js',
  'src/input.js', 'src/online.js', 'src/player.js', 'src/post.js', 'src/pwa.js', 'src/records.js', 'src/rng.js',
  'src/script.js', 'src/settings.js', 'src/shades.js', 'src/slots.js', 'src/storage.js', 'src/story.js',
  'src/vehicle.js', 'src/wardrobe.js', 'src/wisps.js', 'src/world.js',
];
const VERSIONED = ['style.css', ...MODULES].map((p) => `${p}?v=${BUILD}`);
const VENDOR = ['vendor/three/three.module.js?v=r187', 'vendor/three/three.core.js?v=r187'];
// 버전 쿼리가 없는 파일. 내용이 바뀌어도 주소가 같아서, 그냥 받으면 HTTP 캐시(Pages 10분)에 남은 옛 파일이
// 새 빌드 캐시에 들어가 다음 배포 때까지 남는다(manifest id를 고쳐도 Chrome이 옛 id를 보던 문제). 그래서 새로 받는다.
const UNVERSIONED = [
  'favicon.svg', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
];
const NAV_TIMEOUT = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    // 페이지는 이 서비스 워커와 같은 빌드여야 오프라인에서 짝이 맞는 모듈을 찾는다.
    // 배포가 아직 덜 퍼져 옛 페이지가 오면 설치를 실패시키고(지금 쓰던 서비스 워커가 그대로 남는다), 다음 방문 때 다시 시도한다.
    const page = await fetch(new Request('./', { cache: 'reload' }));
    if (!page.ok) throw new Error(`페이지를 받지 못했습니다: ${page.status}`);
    if (!(await page.clone().text()).includes(`?v=${BUILD}`)) throw new Error('페이지와 서비스 워커의 빌드가 다릅니다.');
    const cache = await caches.open(CACHE);
    await cache.put('./', page);
    await cache.addAll([...VERSIONED, ...VENDOR, ...UNVERSIONED.map((p) => new Request(p, { cache: 'reload' }))]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('lumen-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

async function cachedPage() {
  const cache = await caches.open(CACHE);
  return cache.match('./');
}

// 네트워크가 느리면(지하철 등) 무한정 기다리지 않고, 서버가 오류(503 등)를 내면 그 오류 대신 받아 둔 페이지를 연다.
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
