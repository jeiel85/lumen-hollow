import { load, save, storageAvailable } from './storage.js';
import { DEFAULT_LEVEL, isLevel } from './difficulty.js';

// 플레이어 설정: 저장·검증과 설정 화면의 입력 요소 연결.
const KEY = 'lumen.settings';

// 화질 단계. '보통'·'높음'은 이전의 모바일·데스크톱 고정값과 같다.
export const QUALITY = {
  low: { dpr: 1, samples: 0, shadows: false },
  mid: { dpr: 1.5, samples: 2, shadows: true },
  high: { dpr: 2, samples: 4, shadows: true },
};

// 카메라 거리(직교 카메라의 세로 반경). 휠 줌과 같은 범위를 쓴다.
export const ZOOM = { min: 8, max: 22, base: 12.5 };

function defaults({ mobile }) {
  return {
    volume: 1,
    music: 0.6,
    ambience: 1,
    quality: mobile ? 'mid' : 'high',
    tilt: true,
    // 움직임 줄이기를 켠 사용자에게는 처음부터 흔들림·점멸을 끈다.
    shake: !matchMedia('(prefers-reduced-motion: reduce)').matches,
    fps: false,
    zoom: ZOOM.base,
    lefty: false,
    // 난이도 단계(#56): 다음에 새로 시작하는 1장 판과 2~4장에 쓴다. 새 판 화면에서 고른 값이 여기 남는다.
    difficulty: DEFAULT_LEVEL,
  };
}

// 저장된 값은 손상됐거나 예전 형식일 수 있어 항목별로 검사하고, 틀린 항목만 기본값으로 둔다.
export function loadSettings(opts) {
  const s = defaults(opts);
  let raw = null;
  try {
    raw = JSON.parse(load(KEY));
  } catch {
    raw = null;
  }
  if (!raw || typeof raw !== 'object') return s;
  const num = (k, lo, hi) => {
    if (Number.isFinite(raw[k])) s[k] = Math.min(hi, Math.max(lo, raw[k]));
  };
  const bool = (k) => {
    if (typeof raw[k] === 'boolean') s[k] = raw[k];
  };
  num('volume', 0, 1);
  num('music', 0, 1);
  num('ambience', 0, 1);
  num('zoom', ZOOM.min, ZOOM.max);
  if (typeof raw.quality === 'string' && Object.prototype.hasOwnProperty.call(QUALITY, raw.quality)) s.quality = raw.quality;
  for (const k of ['tilt', 'shake', 'fps', 'lefty']) bool(k);
  if (isLevel(raw.difficulty)) s.difficulty = raw.difficulty;
  return s;
}

// 저장했으면 true. 저장소가 막힌 브라우저(사생활 보호 모드 등)에서는 false이고, 설정은 이 페이지 동안만 적용된다.
export function saveSettings(s) {
  return save(KEY, JSON.stringify(s));
}

// 기록 묶음의 안내(records.js)와 같은 말투로, 설정이 남지 않는다는 것을 설정 화면 위에 보인다.
const BLOCKED = '이 브라우저는 저장소를 막아 두어 설정이 이번 세션에만 적용돼요(사생활 보호 모드 등).';

const pct = (v) => `${Math.round(v * 100)}%`;
const FORMAT = {
  volume: pct,
  music: pct,
  ambience: pct,
  zoom: (v) => `${(v / ZOOM.base).toFixed(1)}×`,
};

// 설정 화면의 [data-setting] 입력을 설정 객체와 잇는다. 값이 바뀌면 저장하고 onChange(key)를 부른다.
// 범위 입력의 data-scale은 화면 값과 저장 값의 배율이다(음량 0~100 ↔ 0~1).
export function bindSettings(root, settings, onChange) {
  const inputs = [...root.querySelectorAll('[data-setting]')];
  const outputs = new Map([...root.querySelectorAll('[data-out]')].map((o) => [o.dataset.out, o]));
  const notice = root.querySelector('#settings-store'); // 배포 직후 옛 index.html과 섞이면 없을 수 있다
  const warnBlocked = (blocked) => {
    if (notice) notice.textContent = blocked ? BLOCKED : '';
  };
  const show = (key) => {
    const out = outputs.get(key);
    if (out && FORMAT[key]) out.textContent = FORMAT[key](settings[key]);
  };

  // 설정 화면을 열 때마다 부른다. 저장소는 열려 있는 동안에도 막힐 수 있어(쿠키 차단 변경) 그때마다 확인한다.
  const sync = () => {
    warnBlocked(!storageAvailable());
    for (const el of inputs) {
      const key = el.dataset.setting;
      if (el.type === 'checkbox') el.checked = settings[key];
      else if (el.type === 'radio') el.checked = el.value === settings[key];
      else el.value = String(settings[key] * Number(el.dataset.scale || 1));
      show(key);
    }
  };

  for (const el of inputs) {
    const key = el.dataset.setting;
    const handler = () => {
      if (el.type === 'checkbox') settings[key] = el.checked;
      else if (el.type === 'radio') {
        if (!el.checked) return;
        settings[key] = el.value;
      } else {
        const v = Number(el.value) / Number(el.dataset.scale || 1);
        if (!Number.isFinite(v)) return;
        settings[key] = v;
      }
      show(key);
      if (!saveSettings(settings)) warnBlocked(true);
      onChange(key);
    };
    el.addEventListener(el.type === 'range' ? 'input' : 'change', handler);
  }
  sync();
  return { sync };
}
