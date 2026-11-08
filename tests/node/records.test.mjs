// 기록 파일(설정 화면 내보내기·가져오기, #10·#15·#20): v1(최고 기록만)과 v2(옷장·이야기·2~4장 진행 포함)를 읽고,
// 모르는 값은 세어 건너뛰고, 합칠 때 이 기기의 진행을 줄이지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { load, repo } from './env.mjs';

const R = await load('src/records.js');
const { ITEMS, DEFAULT_WEAR } = await load('src/wardrobe.js');
const { SCENES, CLUES } = await load('src/script.js');
const ZONES = 9;
const file = (data) => JSON.stringify({ format: 'lumen-hollow-records', exportedAt: '2026-11-08T00:00:00.000Z', ...data });
const locked = ITEMS.filter((it) => !it.free).map((it) => it.id);
const local = (over = {}) => ({
  best: { nights: 2, zones: 4, winDay: 0 },
  wardrobe: { owned: [locked[0]], wear: { ...DEFAULT_WEAR } },
  story: { seen: [SCENES[0].id], found: [] },
  chapters: { flags: ['flip'] },
  ...over,
});

test('v1 파일(최고 기록만)을 그대로 읽는다', () => {
  const r = R.parseRecords(file({ version: 1, best: { nights: 5, zones: 7, winDay: 12 } }), ZONES);
  assert.deepEqual(r.best, { nights: 5, zones: 7, winDay: 12 });
  assert.equal(r.wardrobe, null);
  assert.equal(r.story, null);
  assert.equal(r.chapters, null);
  assert.equal(r.skipped, 0);
});

test('v1 파일의 범위 밖 값은 버리고 그 수를 센다(구역 99, 음수 밤)', () => {
  const r = R.parseRecords(file({ version: 1, best: { nights: -3, zones: 99, winDay: 4 } }), ZONES);
  assert.deepEqual(r.best, { nights: 0, zones: 1, winDay: 4 });
  assert.equal(r.skipped, 2);
  assert.match(R.describeImport(r, R.mergeRecords(local(), r), ZONES), /항목 2개는 건너뛰었어요/);
});

test('v1 파일에 최고 기록이 없으면 거부한다', () => {
  assert.throws(() => R.parseRecords(file({ version: 1 }), ZONES), /최고 기록이 없어요/);
});

test('형식이 아니거나 더 새 버전이면 거부한다', () => {
  assert.throws(() => R.parseRecords('{oops', ZONES), /읽을 수 없어요/);
  assert.throws(() => R.parseRecords(JSON.stringify({ format: 'other', version: 1 }), ZONES), /기록 파일이 아니에요/);
  assert.throws(() => R.parseRecords(file({ version: 0, best: {} }), ZONES), /올바르지 않아요/);
  assert.throws(() => R.parseRecords(file({ version: 1.5, best: {} }), ZONES), /올바르지 않아요/);
  assert.throws(() => R.parseRecords(file({ version: 3, best: {} }), ZONES), /더 새 버전/);
  assert.throws(() => R.parseRecords(file({ version: 2 }), ZONES), /가져올 내용이 없어요/);
});

test('내보낸 v2 파일을 다시 읽으면 같은 진행이 나온다(왕복)', () => {
  const state = {
    best: { nights: 3, zones: 9, winDay: 6 },
    wardrobe: { owned: locked.slice(0, 3), wear: { ...DEFAULT_WEAR, coat: 'coat.teal' } },
    story: { seen: SCENES.slice(0, 4).map((s) => s.id), found: CLUES.slice(0, 2).map((c) => c.id) },
    chapters: { flags: ['lampDoor', 'flip'] },
  };
  const data = R.recordsFile(state, new Date('2026-11-08T00:00:00Z'));
  assert.equal(data.version, 2);
  assert.deepEqual(Object.keys(data), ['format', 'version', 'exportedAt', 'best', 'wardrobe', 'story', 'chapters']);
  // 각 부분은 그 저장 키(lumen.wardrobe·lumen.story·lumen.chapters)의 형식을 그대로 담는다.
  assert.equal(data.wardrobe.v, 1);
  assert.equal(data.story.v, 1);
  assert.equal(data.chapters.v, 1);
  const r = R.parseRecords(JSON.stringify(data), ZONES);
  assert.deepEqual(r.best, state.best);
  assert.deepEqual(r.wardrobe, state.wardrobe);
  assert.deepEqual(r.story, state.story);
  assert.deepEqual(r.chapters, state.chapters);
  assert.equal(r.skipped, 0);
  assert.deepEqual(r.partsSkipped, []);
});

test('v2: 모르는 id·잘못된 값은 건너뛰고 센다', () => {
  const r = R.parseRecords(file({
    version: 2,
    best: { nights: 1, zones: 2, winDay: 0 },
    wardrobe: {
      v: 1,
      owned: ['hat.cap', 'hat.unknown', 42, 'coat.yellow'], // coat.yellow는 처음부터 있는 옷이라 조용히 넘긴다
      wear: { coat: 'hat.cap', hat: 'hat.cap', tail: 'x', glasses: 'glasses.nope' },
    },
    story: { v: 1, seen: [SCENES[0].id, 'no-such-scene'], found: [CLUES[0].id, null] },
    chapters: { v: 1, flags: ['flip', 'fly'] },
  }), ZONES);
  assert.deepEqual(r.wardrobe.owned, ['hat.cap']);
  assert.deepEqual(r.wardrobe.wear, { hat: 'hat.cap' });
  assert.deepEqual(r.story, { seen: [SCENES[0].id], found: [CLUES[0].id] });
  assert.deepEqual(r.chapters, { flags: ['flip'] });
  // hat.unknown, 42, coat에 모자, tail, glasses.nope, 없는 장면, null, fly
  assert.equal(r.skipped, 8);
});

test('v2: 형식 버전이 다른 부분은 통째로 건너뛰고 알린다', () => {
  const r = R.parseRecords(file({
    version: 2,
    best: { nights: 1, zones: 1, winDay: 0 },
    wardrobe: { v: 2, owned: ['hat.cap'] },
    story: 'broken',
    chapters: { v: 1, flags: ['flip'] },
  }), ZONES);
  assert.equal(r.wardrobe, null);
  assert.equal(r.story, null);
  assert.deepEqual(r.chapters, { flags: ['flip'] });
  assert.deepEqual(r.partsSkipped, ['wardrobe', 'story']);
  const text = R.describeImport(r, R.mergeRecords(local(), r), ZONES);
  assert.match(text, /옷장은 이 버전이 읽지 못하는 형식/);
  assert.match(text, /이야기 진행은 이 버전이 읽지 못하는 형식/);
});

test('합치기: 최고 기록은 더 좋은 쪽, 진행은 합집합이고 이 기기의 진행은 줄지 않는다', () => {
  const incoming = R.parseRecords(file({
    version: 2,
    best: { nights: 1, zones: 9, winDay: 8 },
    wardrobe: { v: 1, owned: [locked[0], locked[1]], wear: { coat: locked[1] } },
    story: { v: 1, seen: [SCENES[0].id, SCENES[1].id], found: [CLUES[0].id] },
    chapters: { v: 1, flags: ['flip', 'home1'] },
  }), ZONES);
  const m = R.mergeRecords(local({ best: { nights: 2, zones: 4, winDay: 10 } }), incoming);
  assert.deepEqual(m.best, { nights: 2, zones: 9, winDay: 8 });
  assert.deepEqual(m.add.owned, [locked[1]]);
  assert.deepEqual(m.add.seen, [SCENES[1].id]);
  assert.deepEqual(m.add.found, [CLUES[0].id]);
  assert.deepEqual(m.add.flags, ['home1']);
  assert.deepEqual(m.locked, []);
  assert.ok(locked[1].startsWith('coat.'));
  assert.deepEqual(m.add.wear, { coat: locked[1] });
  // 더하기만 하므로, 이 기기에만 있는 것을 빼는 목록은 없다.
  const empty = R.parseRecords(file({ version: 2, best: { nights: 0, zones: 1, winDay: 0 }, wardrobe: { v: 1, owned: [] }, story: { v: 1, seen: [], found: [] }, chapters: { v: 1, flags: [] } }), ZONES);
  const m2 = R.mergeRecords(local(), empty);
  assert.deepEqual(m2.best, local().best);
  assert.deepEqual(m2.add, { owned: [], wear: {}, seen: [], found: [], flags: [] });
  assert.match(R.describeImport(empty, m2, ZONES), /새로 더할 옷장·이야기 진행은 없었어요/);
});

test('합치기: 갖지 않은 옷으로는 갈아입지 않고, 같은 옷차림이면 바꾸지 않는다', () => {
  const coat = locked.find((id) => id.startsWith('coat.'));
  const incoming = { best: null, wardrobe: { owned: [], wear: { coat, hat: DEFAULT_WEAR.hat } }, story: null, chapters: null };
  const m = R.mergeRecords(local({ wardrobe: { owned: [], wear: { ...DEFAULT_WEAR } } }), incoming);
  assert.deepEqual(m.add.wear, {});
});

test('합치기: 이 기기의 이야기·2~4장 진행이 더 새 버전 저장이면(local의 그 부분 null) 건드리지 않고 알린다', () => {
  const incoming = R.parseRecords(file({ version: 2, story: { v: 1, seen: [SCENES[1].id], found: [] }, chapters: { v: 1, flags: ['flip'] } }), ZONES);
  const m = R.mergeRecords(local({ story: null, chapters: null }), incoming);
  assert.deepEqual(m.add.flags, []);
  assert.deepEqual(m.add.seen, []);
  assert.deepEqual(m.locked, ['story', 'chapters']);
  const text = R.describeImport(incoming, m, ZONES);
  assert.match(text, /이 기기의 이야기 진행은 더 새 버전이 저장해 둔 것이라 건드리지 않았어요/);
  assert.match(text, /이 기기의 2~4장 진행은 더 새 버전이 저장해 둔 것이라 건드리지 않았어요/);
});

test('v1 파일을 가져와도 옷장·이야기 진행은 그대로다', () => {
  const r = R.parseRecords(file({ version: 1, best: { nights: 9, zones: 9, winDay: 3 } }), ZONES);
  const m = R.mergeRecords(local(), r);
  assert.deepEqual(m.add, { owned: [], wear: {}, seen: [], found: [], flags: [] });
  assert.doesNotMatch(R.describeImport(r, m, ZONES), /새로 더할/);
});

test('기록 파일의 2~4장 표시 목록이 src/chapters.js FLAGS와 같다', () => {
  const src = readFileSync(path.join(repo, 'src/chapters.js'), 'utf8');
  const m = src.match(/const FLAGS = new Set\(\[([^\]]*)\]\)/);
  assert.ok(m, 'chapters.js에서 FLAGS를 찾지 못했다');
  const flags = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  assert.deepEqual([...R.CHAPTER_FLAGS].sort(), flags.sort());
});
