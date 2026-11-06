import { load, save, remove, storageAvailable } from './storage.js';

// 최고 기록: 이 브라우저의 localStorage에 두고, 파일로 내보내고 가져와 기기·브라우저 사이를 옮긴다.
// 선택한 보관 방식과 그 한계는 DECISIONS.md의 "기록 보관" 항목에 있다.
const KEY = 'lumen.best';
const FORMAT = 'lumen-hollow-records';
const VERSION = 1;
const MAX_FILE = 64 * 1024;
const EMPTY = { nights: 0, zones: 1, winDay: 0 };

const int = (v, lo, hi) => (Number.isFinite(v) && v >= lo && v <= hi ? Math.floor(v) : null);

// 저장소·파일에서 읽은 값은 믿지 않는다. 범위 밖이거나 숫자가 아닌 항목은 버린다.
function sanitize(raw, totalZones) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    nights: int(raw.nights, 0, 9999) ?? EMPTY.nights,
    zones: int(raw.zones, 1, totalZones) ?? EMPTY.zones,
    winDay: int(raw.winDay, 0, 9999) ?? EMPTY.winDay,
  };
}

function merge(a, b) {
  return {
    nights: Math.max(a.nights, b.nights),
    zones: Math.max(a.zones, b.zones),
    winDay: a.winDay && b.winDay ? Math.min(a.winDay, b.winDay) : a.winDay || b.winDay,
  };
}

export function loadBest(totalZones) {
  let raw = null;
  try {
    raw = JSON.parse(load(KEY));
  } catch {
    raw = null; // 손상된 기록은 무시하고 새로 시작
  }
  return sanitize(raw, totalZones) ?? { ...EMPTY };
}

export function hasRecords(b) {
  return b.nights > 0 || b.zones > 1 || b.winDay > 0;
}

export function describeBest(b, totalZones) {
  const parts = [];
  if (b.winDay) parts.push(`${b.winDay}일 만에 마을 복구`);
  parts.push(`최장 ${b.nights}번의 밤`, `최대 ${b.zones}/${totalZones} 구역`);
  return parts.join(' · ');
}

// 브라우저가 저장 공간이 부족할 때 이 사이트 데이터를 지우지 않도록 요청한다.
// Chrome은 설치한 앱·자주 찾는 사이트면 조용히 허락하고, Firefox는 사용자에게 묻는다.
async function requestPersist() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch (err) {
    console.warn('[records] 영구 저장 요청 실패', err);
  }
}

// 한 판이 끝날 때 부른다. 갱신된 최고 기록을 돌려준다.
export function recordRun({ nights, zones, won, day }, totalZones) {
  const best = merge(loadBest(totalZones), { nights, zones, winDay: won ? day : 0 });
  if (save(KEY, JSON.stringify(best))) requestPersist();
  return best;
}

function exportFile(best) {
  const data = { format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), best };
  const d = new Date();
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return new File([JSON.stringify(data, null, 2)], `lumen-hollow-records-${ymd}.json`, { type: 'application/json' });
}

function parseImport(text, totalZones) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('파일을 읽을 수 없어요. 이 게임에서 내보낸 .json 파일인지 확인해 주세요.');
  }
  if (!data || data.format !== FORMAT) throw new Error('Lumen Hollow 기록 파일이 아니에요.');
  if (!Number.isInteger(data.version) || data.version < 1) throw new Error('기록 파일 형식이 올바르지 않아요.');
  if (data.version > VERSION) throw new Error('더 새 버전의 게임에서 내보낸 기록이에요. 새로고침해 최신 버전으로 연 뒤 다시 가져와 주세요.');
  const best = sanitize(data.best, totalZones);
  if (!best) throw new Error('기록 파일에 최고 기록이 없어요.');
  return best;
}

// 설정 화면의 "기록" 묶음. 기록이 바뀌면 onChange()로 타이틀 표시를 갱신하게 한다.
// 배포 직후 캐시된 옛 index.html과 섞여 요소가 없으면 아무것도 하지 않는다.
export function initRecordsPanel({ totalZones, onChange, mobile }) {
  const $ = (id) => document.getElementById(id);
  const root = $('records-panel');
  if (!root) return { refresh() {} };
  const el = {
    best: $('records-best'), store: $('records-store'), msg: $('records-msg'), file: $('records-file'),
    exportBtn: $('records-export'), importBtn: $('records-import'), clearBtn: $('records-clear'),
  };
  let clearArmed = 0;

  const say = (text, kind = '') => {
    el.msg.textContent = text;
    el.msg.className = `hint ${kind}`;
  };

  async function refresh() {
    const best = loadBest(totalZones);
    el.best.textContent = hasRecords(best) ? describeBest(best, totalZones) : '아직 남긴 기록이 없어요.';
    el.exportBtn.disabled = !hasRecords(best);
    el.clearBtn.disabled = !hasRecords(best);
    if (!storageAvailable()) {
      el.store.textContent = '이 브라우저는 저장소를 막아 두어 기록이 남지 않아요(사생활 보호 모드 등).';
      return;
    }
    let persisted = false;
    try {
      persisted = !!(await navigator.storage?.persisted?.());
    } catch {
      persisted = false;
    }
    el.store.textContent = persisted
      ? '이 브라우저에 저장되고, 브라우저가 자동으로 지우지 않도록 보호돼요. 사이트 데이터를 직접 지우면 사라져요.'
      : '이 브라우저에만 저장돼요. 사이트 데이터를 지우거나 브라우저가 공간을 비우면 사라질 수 있으니 가끔 내보내 두세요.';
  }

  el.exportBtn.addEventListener('click', async () => {
    const file = exportFile(loadBest(totalZones));
    // 휴대폰은 공유 시트로 넘기면 '파일에 저장'·메신저 전송을 고를 수 있다(iOS 홈 화면 앱은 다운로드가 막혀 있다).
    if (mobile && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Lumen Hollow 기록' });
        say('기록 파일을 넘겼어요. 다른 기기에서 "가져오기"로 불러오면 돼요.', 'good');
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.warn('[records] 공유 실패, 다운로드로 대신합니다.', err);
      }
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    say(`${file.name} 파일로 내보냈어요.`, 'good');
  });

  el.importBtn.addEventListener('click', () => el.file.click());
  el.file.addEventListener('change', async () => {
    const file = el.file.files?.[0];
    el.file.value = '';
    if (!file) return;
    try {
      if (file.size > MAX_FILE) throw new Error('기록 파일치고 너무 커요. 내보낸 .json 파일을 골라 주세요.');
      const incoming = parseImport(await file.text(), totalZones);
      // 가져온 기록과 지금 기록 중 더 좋은 쪽을 남긴다(가져오기로 기록이 나빠지지 않게).
      const merged = merge(loadBest(totalZones), incoming);
      if (!save(KEY, JSON.stringify(merged))) throw new Error('이 브라우저가 저장소를 막아 두어 가져온 기록을 저장하지 못했어요.');
      requestPersist();
      say(`기록을 가져왔어요. ${describeBest(merged, totalZones)}`, 'good');
      onChange();
    } catch (err) {
      say(err.message, 'warn');
    }
    refresh();
  });

  // 실수로 지우지 않게 두 번 눌러야 지운다(전체 화면에서 확인 창을 띄우면 전체 화면이 풀리는 브라우저가 있다).
  el.clearBtn.addEventListener('click', () => {
    if (performance.now() - clearArmed > 4000) {
      clearArmed = performance.now();
      el.clearBtn.textContent = '한 번 더 누르면 지워요';
      setTimeout(() => {
        if (performance.now() - clearArmed >= 4000) el.clearBtn.textContent = '지우기';
      }, 4100);
      return;
    }
    clearArmed = 0;
    el.clearBtn.textContent = '지우기';
    remove(KEY);
    say('최고 기록을 지웠어요.');
    onChange();
    refresh();
  });

  return {
    refresh() {
      say('');
      clearArmed = 0;
      el.clearBtn.textContent = '지우기';
      return refresh();
    },
  };
}
