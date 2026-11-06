// PWA: 서비스 워커 등록(오프라인 실행), 앱 설치 안내, 전체 화면 전환.
const $ = (id) => document.getElementById(id);

// 배포 워크플로가 import map의 ?v=__BUILD__를 커밋 SHA로 바꾼다. 바뀌지 않았다면 로컬 개발 중이다.
const build = new URL(import.meta.url).searchParams.get('v');
const stamped = !!build && build !== '__BUILD__';

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function isStandalone() {
  return matchMedia('(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)').matches
    || navigator.standalone === true;
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // 로컬 개발에서는 모듈 URL(?v=__BUILD__)이 바뀌지 않아, 캐시가 수정한 코드를 가린다.
  // ?sw를 붙였을 때만 등록하고, 아니면 예전에 등록해 둔 것을 걷어 낸다.
  if (!stamped && !new URLSearchParams(location.search).has('sw')) {
    const reg = await navigator.serviceWorker.getRegistration('./');
    const ours = new URL('sw.js', location.href).href;
    const script = (reg?.active || reg?.waiting || reg?.installing)?.scriptURL;
    if (reg && script === ours) {
      await reg.unregister();
      for (const k of await caches.keys()) if (k.startsWith('lumen-')) await caches.delete(k);
      console.info('[pwa] 개발 모드라 서비스 워커를 해제했습니다(?sw로 켤 수 있음).');
    }
    return;
  }
  await navigator.serviceWorker.register('sw.js', { scope: './' });
}

// 설정 화면의 "앱 설치" 묶음, 타이틀의 설치 버튼, 전체 화면 버튼을 잇는다.
// onAskInstall: 설치 버튼이 직접 설치 창을 띄울 수 없을 때(iOS 등) 안내가 있는 설정 화면을 연다.
export function initPwa({ onAskInstall, onInstalled }) {
  registerServiceWorker().catch((err) => console.warn('[pwa] 서비스 워커 등록 실패. 오프라인 실행만 안 됩니다.', err));

  // 설치 제안 이벤트는 모듈이 다 받아지기 전에 올 수 있어 index.html이 먼저 붙잡아 둔다.
  let deferred = window.__lumenInstall ?? null;
  const titleBtn = $('install-btn');
  const status = $('app-status');
  const installBtn = $('app-install');

  function render() {
    const app = isStandalone();
    const offline = !!navigator.serviceWorker?.controller;
    titleBtn?.classList.toggle('hidden', app || !(deferred || isIOS));
    installBtn?.classList.toggle('hidden', app || !deferred);
    if (!status) return;
    if (app) {
      status.textContent = offline
        ? '앱으로 실행 중이에요. 한 번 받아 둔 뒤라 인터넷 없이도 열려요.'
        : '앱으로 실행 중이에요.';
    } else if (deferred) {
      status.textContent = '설치하면 홈 화면·바탕화면에서 주소창 없이 전체 화면으로 열리고, 한 번 받은 뒤에는 인터넷 없이도 할 수 있어요.';
    } else if (isIOS) {
      status.textContent = '공유 버튼(네모에 위쪽 화살표)을 누르고 "홈 화면에 추가"를 고르세요. 홈 화면 앱은 Safari와 기록을 따로 보관하니, 옮길 때는 아래 기록 내보내기·가져오기를 쓰세요.';
    } else {
      status.textContent = '이 브라우저는 설치 버튼을 주지 않아요. 브라우저 메뉴의 "앱 설치"나 "홈 화면에 추가"를 찾아보세요(Chrome·Edge·삼성 인터넷 지원).';
    }
  }

  async function install() {
    if (!deferred) {
      onAskInstall();
      return;
    }
    const ev = deferred;
    deferred = null; // 설치 제안은 한 번만 띄울 수 있다.
    window.__lumenInstall = null;
    try {
      await ev.prompt();
      await ev.userChoice;
    } catch (err) {
      console.warn('[pwa] 설치 창을 띄우지 못했습니다.', err);
    }
    render();
  }

  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    render();
  });
  addEventListener('appinstalled', () => {
    deferred = null;
    window.__lumenInstall = null;
    render();
    onInstalled?.();
  });
  navigator.serviceWorker?.addEventListener('controllerchange', render);
  titleBtn?.addEventListener('click', install);
  installBtn?.addEventListener('click', install);

  // 전체 화면: 아이폰 Safari처럼 지원하지 않거나, 이미 전체 화면 앱으로 실행 중이면 버튼을 숨긴다.
  const fsBtn = $('fullscreen-btn');
  const doc = document;
  const fsEnabled = doc.fullscreenEnabled || doc.webkitFullscreenEnabled;
  const fsElement = () => doc.fullscreenElement || doc.webkitFullscreenElement;
  const renderFs = () => {
    if (!fsBtn) return;
    const hide = !fsEnabled || matchMedia('(display-mode: fullscreen)').matches;
    $('fullscreen-row')?.classList.toggle('hidden', hide);
    fsBtn.textContent = fsElement() ? '끄기' : '켜기';
    fsBtn.setAttribute('aria-pressed', fsElement() ? 'true' : 'false');
  };
  fsBtn?.addEventListener('click', async () => {
    try {
      if (fsElement()) await (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc);
      else {
        const el = doc.documentElement;
        await (el.requestFullscreen || el.webkitRequestFullscreen).call(el, { navigationUI: 'hide' });
      }
    } catch (err) {
      console.warn('[pwa] 전체 화면 전환 실패', err);
    }
    renderFs();
  });
  doc.addEventListener('fullscreenchange', renderFs);
  doc.addEventListener('webkitfullscreenchange', renderFs);

  render();
  renderFs();
  return { render };
}
