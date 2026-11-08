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

// ---------------------------------------------------------------- 오프라인 실행 준비 상태
// 서비스 워커 설치가 실패해도 게임은 그대로 되므로 경고하지 않고, 설정 화면 '앱 설치'에 조용히 적는다.
// 서버로는 보내지 않는다(sw.js가 열린 페이지에만 알린다).
// state: 'checking' | 'unsupported' | 'dev' | 'installing' | 'ready' | 'failed' | 'blocked'(등록 거절)
const sw = { state: 'checking', reason: '', updateFailed: '', update: false, reg: null };
const listeners = new Set();
const changed = () => { for (const fn of listeners) fn(); };

// sw.js의 InstallError 코드 → 사람이 읽을 이유
function reasonText(code, detail) {
  switch (code) {
    case 'mismatch': return '새 버전이 아직 서버에 다 퍼지지 않았어요';
    case 'page': return `페이지를 받지 못했어요(응답 ${detail})`;
    case 'missing': return `게임 파일 하나를 받지 못했어요(${detail})`;
    case 'network': return '받는 도중 연결이 끊겼어요';
    case 'quota': return '기기 저장 공간이 부족해요';
    default: return detail ? `알 수 없는 문제예요(${detail})` : '설치가 중간에 멈췄어요';
  }
}

export function offlineStatus() {
  switch (sw.state) {
    case 'ready':
      return sw.updateFailed
        ? `오프라인 실행: 준비됐어요(지난 버전으로). 새 버전은 한 시간쯤 뒤나 다음에 열 때 다시 받아요 — ${sw.updateFailed}.`
        : '오프라인 실행: 준비됐어요. 한 번 받아 둔 게임이라 인터넷 없이도 열려요.';
    case 'installing': return '오프라인 실행: 게임 파일을 받아 두는 중이에요.';
    case 'failed': return `오프라인 실행: 아직 안 됐어요 — ${sw.reason}. 다음에 열 때 다시 시도해요.`;
    case 'blocked': return `오프라인 실행: 이 브라우저가 허락하지 않았어요(${sw.reason}). 사생활 보호 모드에서는 쓸 수 없을 수 있어요.`;
    case 'unsupported': return '오프라인 실행: 이 브라우저에서는 쓸 수 없어요. 인터넷이 있을 때만 열려요.';
    case 'dev': return '오프라인 실행: 개발 모드라 꺼 두었어요(?sw를 붙이면 켜져요).';
    default: return '오프라인 실행: 확인하는 중이에요.';
  }
}

// 새 빌드가 활성화됐는데 이 페이지는 옛 빌드로 열려 있다
export const updateReady = () => sw.update;

function setState(state, reason = '') {
  sw.state = state;
  sw.reason = reason;
  changed();
}

// 설치 중인 워커의 끝: installed/activated면 성공, 그 전에 redundant가 되면 실패(이유는 sw.js의 메시지로 온다).
const DONE = new Set(['installed', 'activating', 'activated']);
function track(reg, worker) {
  if (!worker) return;
  let installed = DONE.has(worker.state);
  if (installed) {
    setState('ready');
    return;
  }
  if (!reg.active || reg.active === worker) setState('installing');
  worker.addEventListener('statechange', () => {
    if (DONE.has(worker.state)) {
      if (installed) return;
      installed = true;
      sw.updateFailed = '';
      setState('ready');
    } else if (worker.state === 'redundant' && !installed) {
      // 이유는 sw.js가 먼저 보낸 'failed' 메시지가 채운다. 메시지가 없었다면 일반 문구로 둔다.
      if (reg.active) {
        sw.updateFailed ||= reasonText();
        setState('ready');
      } else {
        setState('failed', sw.reason || reasonText());
      }
    }
  });
}

function onMessage(e) {
  const m = e.data;
  if (!m || m.type !== 'lumen-sw') return;
  if (m.state === 'failed') {
    const why = reasonText(m.code, m.detail);
    if (sw.reg?.active || navigator.serviceWorker.controller) {
      sw.updateFailed = why;
      setState('ready');
    } else {
      setState('failed', why);
    }
  } else if (m.state === 'activated') {
    sw.updateFailed = '';
    // 이 페이지와 다른 빌드가 활성화됐다 = 이 탭은 옛 빌드다. 빌드가 안 찍힌 로컬 개발은 둘 다 __BUILD__라 같다.
    if (stamped && m.build && m.build !== build) sw.update = true;
    setState('ready');
  }
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    setState('unsupported');
    return;
  }
  // 로컬 개발에서는 모듈 URL(?v=__BUILD__)이 바뀌지 않아, 캐시가 수정한 코드를 가린다.
  // ?sw를 붙였을 때만 등록하고, 아니면 예전에 등록해 둔 것을 걷어 낸다.
  if (!stamped && !new URLSearchParams(location.search).has('sw')) {
    setState('dev');
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
  navigator.serviceWorker.addEventListener('message', onMessage);
  navigator.serviceWorker.startMessages?.();
  let reg;
  try {
    reg = await navigator.serviceWorker.register('sw.js', { scope: './' });
  } catch (err) {
    setState('blocked', err?.name || '등록 실패');
    throw err;
  }
  sw.reg = reg;
  if (reg.active) setState('ready');
  track(reg, reg.installing || reg.waiting);
  reg.addEventListener('updatefound', () => track(reg, reg.installing));
  watchForUpdates(reg);
}

// 브라우저는 페이지를 새로 열 때만 서비스 워커(새 배포)를 확인한다. 며칠씩 켜 두는 설치 앱·탭은 그동안 새 버전을 모른다.
// 화면이 보이는 동안 UPDATE_EVERY마다, 그리고 가려졌다가 돌아왔을 때 마지막 확인에서 그만큼 지났으면 다시 확인한다.
// 새 빌드가 받아지면 sw.js가 바로 활성화하고 알려 처음 화면에 '새 버전이 준비됐어요'가 뜬다(진행 중인 판은 그대로 돈다:
// 모든 모듈을 시작할 때 받아 두는 전제는 sw.js 머리 주석). 확인 한 번은 sw.js 한 파일(약 8KB)을 받는 것이고,
// 빌드가 바뀌었을 때만 게임 파일을 새로 받는다. 오프라인이면 건너뛰고 다음 점검(UPDATE_POLL) 때 다시 본다.
const UPDATE_EVERY = 60 * 60 * 1000;
const UPDATE_POLL = 5 * 60 * 1000;
function watchForUpdates(reg) {
  let last = Date.now();
  const check = () => {
    if (document.hidden || navigator.onLine === false || Date.now() - last < UPDATE_EVERY) return;
    last = Date.now();
    reg.update().catch((err) => console.info('[pwa] 새 버전 확인에 실패했습니다. 한 시간 뒤 다시 확인합니다.', err?.name ?? err));
  };
  setInterval(check, UPDATE_POLL);
  document.addEventListener('visibilitychange', check);
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
  // 배포 직후 캐시된 옛 index.html과 섞이면 아래 두 요소가 없을 수 있다.
  const offlineEl = $('offline-status');
  const updateEl = $('update-note');

  function render() {
    const app = isStandalone();
    const offline = !!navigator.serviceWorker?.controller;
    titleBtn?.classList.toggle('hidden', app || !(deferred || isIOS));
    installBtn?.classList.toggle('hidden', app || !deferred);
    if (offlineEl) offlineEl.textContent = updateReady() ? '새 버전이 준비됐어요. 처음 화면의 "다시 열기"를 누르거나 다음에 열 때 바뀌어요.' : offlineStatus();
    updateEl?.classList.toggle('hidden', !updateReady());
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
      // Chrome·Edge도 이미 설치된 앱이면 설치 제안을 주지 않는다. "지원하지 않는다"고 단정하지 않는다.
      status.textContent = '브라우저가 지금은 설치를 제안하지 않았어요. 이미 설치했다면 바탕화면·앱 목록의 Lumen Hollow로 여세요. 아니라면 브라우저 메뉴에서 "앱 설치"나 "홈 화면에 추가"를 찾아보세요(Chrome·Edge·삼성 인터넷 지원).';
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
  listeners.add(render);
  // 새 버전 안내의 '다시 열기'. 처음 화면에만 보이므로 진행 중인 판은 없다(판은 처음 화면으로 나올 때 저장된다).
  $('update-reload')?.addEventListener('click', () => location.reload());
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
