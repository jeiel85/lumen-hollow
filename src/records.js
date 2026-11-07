import { load, save, remove, storageAvailable } from './storage.js';
import { SLOTS, itemById } from './wardrobe.js';
import { SCENES, CLUES } from './script.js';

// 최고 기록: 이 브라우저의 localStorage에 두고, 파일로 내보내고 가져와 기기·브라우저 사이를 옮긴다.
// 선택한 보관 방식과 그 한계는 DECISIONS.md의 "기록 보관" 항목에 있다.
// 기록 파일 v2는 판을 넘어 남는 진행(옷장 lumen.wardrobe, 이야기 lumen.story, 2~4장 lumen.chapters)도 함께 옮긴다.
// 형식과 합치는 규칙은 DECISIONS.md "기록 파일 v2".
const KEY = 'lumen.best';
const FORMAT = 'lumen-hollow-records';
const VERSION = 2;
const MAX_FILE = 64 * 1024;
const MAX_LIST = 500; // 한 목록에서 읽는 최대 항목 수(정상 파일은 수십 개)
const EMPTY = { nights: 0, zones: 1, winDay: 0 };

// 파일의 각 부분은 그 저장 키의 형식을 그대로 담고, 그 키의 형식 버전(v)을 따른다.
const PART_V = { wardrobe: 1, story: 1, chapters: 1 };
const PART_NAME = { wardrobe: '옷장', story: '이야기 진행', chapters: '2~4장 진행' };
// 2~4장 진행 표시. src/chapters.js의 FLAGS와 같아야 한다(tests/node/records.test.mjs가 검사한다).
export const CHAPTER_FLAGS = ['lampDoor', 'lampYard', 'home1', 'home2', 'flip'];

const SCENE_IDS = new Set(SCENES.map((s) => s.id));
const CLUE_IDS = new Set(CLUES.map((c) => c.id));
const FLAG_IDS = new Set(CHAPTER_FLAGS);

const int = (v, lo, hi) => (Number.isFinite(v) && v >= lo && v <= hi ? Math.floor(v) : null);

// 저장소·파일에서 읽은 값은 믿지 않는다. 범위 밖이거나 숫자가 아닌 항목은 버린다(skip이 있으면 버린 수를 센다).
function sanitize(raw, totalZones, skip = null) {
  if (!raw || typeof raw !== 'object') return null;
  const pick = (k, lo, hi) => {
    const v = int(raw[k], lo, hi);
    if (v === null && raw[k] !== undefined && skip) skip.n++;
    return v ?? EMPTY[k];
  };
  return { nights: pick('nights', 0, 9999), zones: pick('zones', 1, totalZones), winDay: pick('winDay', 0, 9999) };
}

export function mergeBest(a, b) {
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
  const best = mergeBest(loadBest(totalZones), { nights, zones, winDay: won ? day : 0 });
  if (save(KEY, JSON.stringify(best))) requestPersist();
  return best;
}

// ---------------------------------------------------------------- 기록 파일

// state: { best, wardrobe: { owned, wear } | null, story: { seen, found } | null, chapters: { flags } | null }
export function recordsFile(state, now = new Date()) {
  const data = { format: FORMAT, version: VERSION, exportedAt: now.toISOString(), best: state.best };
  if (state.wardrobe) data.wardrobe = { v: PART_V.wardrobe, owned: [...state.wardrobe.owned], wear: { ...state.wardrobe.wear } };
  if (state.story) data.story = { v: PART_V.story, seen: [...state.story.seen], found: [...state.story.found] };
  if (state.chapters) data.chapters = { v: PART_V.chapters, flags: [...state.chapters.flags] };
  return data;
}

function exportFile(state) {
  const d = new Date();
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return new File([JSON.stringify(recordsFile(state, d), null, 2)], `lumen-hollow-records-${ymd}.json`, { type: 'application/json' });
}

// 목록에서 이 버전이 아는 id만 남긴다. 문자열이 아니거나 모르는 id는 건너뛰고 센다(중복은 조용히 합친다).
function ids(list, known, skip) {
  const out = new Set();
  if (list === undefined) return out;
  if (!Array.isArray(list)) {
    skip.n++;
    return out;
  }
  for (const id of list.slice(0, MAX_LIST)) {
    if (typeof id === 'string' && known(id)) out.add(id);
    else skip.n++;
  }
  skip.n += Math.max(0, list.length - MAX_LIST);
  return out;
}

// 부분(옷장·이야기·2~4장)의 형식 버전이 다르면 그 부분만 통째로 건너뛴다.
function part(data, name, skip) {
  const raw = data[name];
  if (raw === undefined) return null;
  if (!raw || typeof raw !== 'object' || raw.v !== PART_V[name]) {
    skip.parts.push(name);
    return null;
  }
  return raw;
}

function parseWardrobe(raw, skip) {
  // 처음부터 갖는 옷(free)은 저장하지 않는 값이라 파일에 있어도 조용히 넘긴다.
  const owned = [...ids(raw.owned, (id) => !!itemById(id), skip)].filter((id) => !itemById(id).free);
  const wear = {};
  if (raw.wear !== undefined) {
    if (!raw.wear || typeof raw.wear !== 'object' || Array.isArray(raw.wear)) {
      skip.n++;
    } else {
      for (const [slot, id] of Object.entries(raw.wear)) {
        const it = itemById(id);
        if (SLOTS.some((s) => s.id === slot) && it && it.slot === slot) wear[slot] = id;
        else skip.n++;
      }
    }
  }
  return { owned, wear };
}

// 기록 파일을 읽어 검증한다. 형식이 틀리면 Error(플레이어에게 보일 문장)를 던지고,
// 읽을 수 있으면 { version, best, wardrobe, story, chapters, skipped, partsSkipped }를 돌려준다(없는 부분은 null).
export function parseRecords(text, totalZones) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('파일을 읽을 수 없어요. 이 게임에서 내보낸 .json 파일인지 확인해 주세요.');
  }
  if (!data || typeof data !== 'object' || data.format !== FORMAT) throw new Error('Lumen Hollow 기록 파일이 아니에요.');
  if (!Number.isInteger(data.version) || data.version < 1) throw new Error('기록 파일 형식이 올바르지 않아요.');
  if (data.version > VERSION) throw new Error('더 새 버전의 게임에서 내보낸 기록이에요. 새로고침해 최신 버전으로 연 뒤 다시 가져와 주세요.');
  const skip = { n: 0, parts: [] };
  const best = data.best === undefined ? null : sanitize(data.best, totalZones, skip);
  if (data.best !== undefined && !best) skip.n++;
  const out = { version: data.version, best, wardrobe: null, story: null, chapters: null };
  if (data.version === 1) {
    // v1은 최고 기록만 담았다.
    if (!best) throw new Error('기록 파일에 최고 기록이 없어요.');
  } else {
    const w = part(data, 'wardrobe', skip);
    if (w) out.wardrobe = parseWardrobe(w, skip);
    const s = part(data, 'story', skip);
    if (s) out.story = { seen: [...ids(s.seen, (id) => SCENE_IDS.has(id), skip)], found: [...ids(s.found, (id) => CLUE_IDS.has(id), skip)] };
    const c = part(data, 'chapters', skip);
    if (c) out.chapters = { flags: [...ids(c.flags, (id) => FLAG_IDS.has(id), skip)] };
    if (!best && !out.wardrobe && !out.story && !out.chapters && !skip.parts.length) throw new Error('기록 파일에 가져올 내용이 없어요.');
  }
  out.skipped = skip.n;
  out.partsSkipped = skip.parts;
  return out;
}

// 가져오기는 이 기기의 진행을 줄이지 않는다. 최고 기록은 더 좋은 쪽, 옷가지·장면·기록·2~4장 표시는 합집합이다.
// 옷차림은 파일 쪽을 따른다(합친 뒤 갖고 있는 옷이면). local.story·local.chapters가 null이면 이 기기의 그 진행은
// 더 새 버전이 쓴 것이라 건드리지 않고 locked에 이름을 남긴다.
// 돌려주는 add는 이 기기에 새로 더할 것만 담는다.
export function mergeRecords(local, incoming) {
  const add = { owned: [], wear: {}, seen: [], found: [], flags: [] };
  const best = incoming.best ? mergeBest(local.best, incoming.best) : { ...local.best };
  const lw = local.wardrobe;
  if (incoming.wardrobe && lw) {
    const owned = new Set(lw.owned);
    for (const id of incoming.wardrobe.owned) {
      if (owned.has(id)) continue;
      owned.add(id);
      add.owned.push(id);
    }
    for (const [slot, id] of Object.entries(incoming.wardrobe.wear)) {
      if (lw.wear[slot] !== id && (itemById(id).free || owned.has(id))) add.wear[slot] = id;
    }
  }
  const locked = [];
  if (incoming.story && local.story) {
    const seen = new Set(local.story.seen);
    const found = new Set(local.story.found);
    add.seen = incoming.story.seen.filter((id) => !seen.has(id));
    add.found = incoming.story.found.filter((id) => !found.has(id));
  } else if (incoming.story) {
    locked.push('story');
  }
  if (incoming.chapters && local.chapters) {
    const flags = new Set(local.chapters.flags);
    add.flags = incoming.chapters.flags.filter((f) => !flags.has(f));
  } else if (incoming.chapters) {
    locked.push('chapters');
  }
  return { best, add, locked };
}

// 가져오기 결과 문장(설정 화면). 새로 더한 것, 건너뛴 것을 함께 알린다.
export function describeImport(parsed, merged, totalZones) {
  const out = [`기록을 가져왔어요. ${describeBest(merged.best, totalZones)}`];
  if (parsed.version >= 2) {
    const a = merged.add;
    const got = [];
    if (a.owned.length) got.push(`옷가지 ${a.owned.length}개`);
    if (a.seen.length) got.push(`들은 이야기 ${a.seen.length}개`);
    if (a.found.length) got.push(`주운 기록 ${a.found.length}개`);
    if (a.flags.length) got.push(`2~4장 진행 ${a.flags.length}개`);
    out.push(got.length ? `새로 더한 것: ${got.join(' · ')}.` : '새로 더할 옷장·이야기 진행은 없었어요.');
    if (Object.keys(a.wear).length) out.push('옷차림은 파일대로 갈아입었어요.');
  }
  for (const p of parsed.partsSkipped) out.push(`${PART_NAME[p]}은 이 버전이 읽지 못하는 형식이라 건너뛰었어요.`);
  for (const p of merged.locked) out.push(`이 기기의 ${PART_NAME[p]}은 더 새 버전이 저장해 둔 것이라 건드리지 않았어요.`);
  if (parsed.skipped) out.push(`알아볼 수 없거나 범위를 벗어난 항목 ${parsed.skipped}개는 건너뛰었어요.`);
  return out.join(' ');
}

// ---------------------------------------------------------------- 살아 있는 진행과 잇기
// progress: { wardrobe: Wardrobe, story: Story, chapters: Chapters } (main이 넘긴다). 없으면 최고 기록만 다룬다.

// 저장 키에 더 새 형식(v > known)이 들어 있는가. 그 진행은 이 버전이 읽지 못했으니 내보내지도, 덮어쓰지도 않는다
// (lumen.run·lumen.chapters와 같은 규칙. story.js는 스스로 막지 않아 여기서 본다).
function newerSaved(key, known) {
  try {
    const raw = JSON.parse(load(key));
    return !!raw && typeof raw === 'object' && Number.isInteger(raw.v) && raw.v > known;
  } catch {
    return false;
  }
}

function snapshot(progress, totalZones) {
  const { wardrobe: w, story: st, chapters: ch } = progress ?? {};
  return {
    best: loadBest(totalZones),
    wardrobe: w ? { owned: [...w.owned], wear: { ...w.wear } } : null,
    story: st && !newerSaved('lumen.story', PART_V.story) ? { seen: [...st.seen], found: [...st.found] } : null,
    chapters: ch && !ch.locked ? { flags: [...ch.flags] } : null,
  };
}

function hasProgress(s) {
  return hasRecords(s.best) || !!s.wardrobe?.owned.length || !!s.story?.seen.length || !!s.story?.found.length || !!s.chapters?.flags.length;
}

// 각 객체의 저장 함수로 더한다(메모리와 저장소가 함께 바뀐다). 처음 화면에서만 부른다.
function applyProgress(progress, add) {
  const { wardrobe: w, story: st, chapters: ch } = progress;
  if (add.owned.length || Object.keys(add.wear).length) w.absorb(add.owned, add.wear);
  for (const id of add.seen) st.markSeen(id);
  for (const id of add.found) st.markFound(id);
  // chapters.js에는 밖에서 표시를 더하는 공개 함수가 없어 _setFlag를 쓴다(저장과 더 새 버전 잠금 규칙을 그대로 따른다).
  for (const f of add.flags) ch._setFlag(f);
}

// 설정 화면의 "기록" 묶음. 기록이 바뀌면 onChange()로 타이틀 표시를 갱신하게 한다.
// 배포 직후 캐시된 옛 index.html과 섞여 요소가 없으면 아무것도 하지 않는다.
export function initRecordsPanel({ totalZones, onChange, mobile, progress = null }) {
  const $ = (id) => document.getElementById(id);
  const root = $('records-panel');
  if (!root) return { refresh() {} };
  const el = {
    best: $('records-best'), progress: $('records-progress'), store: $('records-store'), msg: $('records-msg'), file: $('records-file'),
    exportBtn: $('records-export'), importBtn: $('records-import'), clearBtn: $('records-clear'),
  };
  const CLEAR = el.clearBtn.textContent;
  let clearArmed = null; // 지우기를 처음 누른 시각. null이면 아직 확인 대기 중이 아니다.
  let canImport = true;

  const say = (text, kind = '') => {
    el.msg.textContent = text;
    el.msg.className = `hint ${kind}`;
  };

  async function refresh() {
    const s = snapshot(progress, totalZones);
    el.best.textContent = hasRecords(s.best) ? describeBest(s.best, totalZones) : '아직 남긴 기록이 없어요.';
    if (el.progress) {
      const w = progress?.wardrobe;
      const more = [];
      if (w?.foundCount) more.push(`모은 옷가지 ${w.foundCount}/${w.findableCount}`);
      if (s.story?.seen.length) more.push(`들은 이야기 ${s.story.seen.length}개`);
      if (s.story?.found.length) more.push(`주운 기록 ${s.story.found.length}개`);
      el.progress.textContent = more.length ? `내보내기에 함께 담는 진행: ${more.join(' · ')}` : '';
    }
    el.exportBtn.disabled = !hasProgress(s);
    el.clearBtn.disabled = !hasRecords(s.best);
    el.importBtn.disabled = !canImport;
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
    const file = exportFile(snapshot(progress, totalZones));
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

  el.importBtn.addEventListener('click', () => canImport && el.file.click());
  el.file.addEventListener('change', async () => {
    const file = el.file.files?.[0];
    el.file.value = '';
    if (!file || !canImport) return;
    try {
      if (file.size > MAX_FILE) throw new Error('기록 파일치고 너무 커요. 내보낸 .json 파일을 골라 주세요.');
      const parsed = parseRecords(await file.text(), totalZones);
      if (!storageAvailable()) throw new Error('이 브라우저가 저장소를 막아 두어 가져온 기록을 저장하지 못했어요.');
      // 가져온 기록과 지금 기록 중 더 좋은 쪽을 남기고, 진행은 더하기만 한다(가져오기로 이 기기의 진행이 줄지 않게).
      const merged = mergeRecords(snapshot(progress, totalZones), parsed);
      if (!save(KEY, JSON.stringify(merged.best))) throw new Error('이 브라우저가 저장소를 막아 두어 가져온 기록을 저장하지 못했어요.');
      if (progress) applyProgress(progress, merged.add);
      requestPersist();
      say(describeImport(parsed, merged, totalZones), 'good');
      onChange();
    } catch (err) {
      say(err.message, 'warn');
    }
    refresh();
  });

  // 실수로 지우지 않게 두 번 눌러야 지운다(전체 화면에서 확인 창을 띄우면 전체 화면이 풀리는 브라우저가 있다).
  // 최고 기록만 지운다. 이야기 진행은 수첩의 '이야기 처음부터'로 따로 지운다.
  el.clearBtn.addEventListener('click', () => {
    const now = performance.now();
    if (clearArmed === null || now - clearArmed > 4000) {
      const armedAt = now;
      clearArmed = armedAt;
      el.clearBtn.textContent = '한 번 더 누르면 지워요';
      setTimeout(() => {
        if (clearArmed !== armedAt) return; // 그사이 지웠거나 다시 눌렀다
        clearArmed = null;
        el.clearBtn.textContent = CLEAR;
      }, 4100);
      return;
    }
    clearArmed = null;
    el.clearBtn.textContent = CLEAR;
    remove(KEY);
    say('최고 기록을 지웠어요.');
    onChange();
    refresh();
  });

  return {
    // inRun: 판 도중(일시정지에서 연 설정)이면 가져오기를 막는다. 진행 중인 장의 차례가 갑자기 바뀌지 않게
    // (수첩의 '이야기 처음부터'와 같은 규칙).
    refresh({ inRun = false } = {}) {
      canImport = !inRun;
      say(inRun ? '가져오기는 처음 화면의 설정에서 할 수 있어요(판 도중에는 진행이 바뀌지 않게 막아 두었어요).' : '');
      clearArmed = null;
      el.clearBtn.textContent = CLEAR;
      return refresh();
    },
  };
}
