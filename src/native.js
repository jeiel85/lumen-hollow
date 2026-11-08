import { tr } from './i18n.js';
// 안드로이드 앱(Capacitor) 안에서만 하는 일. 웹판에서는 아무것도 하지 않는다(#49).
// 앱 빌드(scripts/build-app.mjs)가 index.html에 Capacitor 코어(capacitorExports)와 App 플러그인(capacitorApp)
// 스크립트를 넣는다. 웹판에는 그 스크립트가 없어서 아래 전역이 비어 있다.

// Capacitor 네이티브 브리지가 있으면 앱 안이다. 웹판(브라우저·설치한 PWA)은 false.
export function isNativeApp() {
  return !!globalThis.Capacitor?.isNativePlatform?.();
}

// 안드로이드 뒤로 가기. onBack()이 처리하면 true, 더 닫을 것이 없으면(처음 화면) false를 돌려주고 그때 앱을 닫는다.
// 리스너를 달면 Capacitor의 기본 동작(웹뷰 뒤로 가기 → 앱 종료)이 꺼져서, 판 도중 뒤로 가기에 앱이 닫히지 않는다.
export function initNative({ onBack }) {
  if (!isNativeApp()) return false;
  const App = globalThis.capacitorApp?.App;
  if (!App) {
    console.warn('[native] App 플러그인이 없어 뒤로 가기를 받지 못합니다(앱 빌드에 스크립트가 빠졌는지 확인).');
    return true;
  }
  App.addListener('backButton', () => {
    let handled = true;
    try {
      handled = onBack();
    } catch (err) {
      console.warn('[native] 뒤로 가기 처리 중 오류', err);
    }
    if (!handled) App.exitApp();
  });
  return true;
}

// 기록 파일 저장(설정 → 기록 → 내보내기). 안드로이드 WebView는 blob 다운로드·Web Share(파일)가 없어서,
// 앱 안의 FileSave 플러그인(android/.../FileSavePlugin.java)이 시스템 '저장' 창으로 쓴다.
// 앱이 아니면 null(부른 쪽이 웹 방식으로 내보낸다). 앱이면 저장했으면 true, 취소했으면 false. 실패는 예외.
let fileSave = null;
export async function saveTextFile(name, text, mime = 'application/json') {
  if (!isNativeApp()) return null;
  fileSave ??= globalThis.capacitorExports?.registerPlugin?.('FileSave') ?? null;
  if (!fileSave) throw new Error(tr('파일 저장 기능을 찾지 못했어요'));
  const res = await fileSave.save({ name, text, mime });
  return !!res?.saved;
}
