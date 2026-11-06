// localStorage는 쿠키 차단·일부 사생활 보호 모드에서 접근만 해도 예외를 던진다.
// 기록 저장은 부가 기능이므로 실패해도 게임은 계속되게 하고, 경고는 한 번만 남긴다.
let warned = false;

function warn(err) {
  if (warned) return;
  warned = true;
  console.warn('[storage] 브라우저 저장소를 쓸 수 없어 기록·설정이 저장되지 않습니다.', err);
}

export function load(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (err) {
    warn(err);
    return null;
  }
}

export function save(key, value) {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (err) {
    warn(err);
    return false;
  }
}

export function remove(key) {
  try {
    window.localStorage.removeItem(key);
  } catch (err) {
    warn(err);
  }
}

// 실제로 쓰고 지워 봐야 안다(사파리 사생활 보호 모드는 읽기는 되고 쓰기에서 예외를 던졌다).
export function storageAvailable() {
  const probe = 'lumen.probe';
  if (!save(probe, '1')) return false;
  remove(probe);
  return true;
}
