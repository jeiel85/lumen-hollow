// 영어 지원(#60): 화면 글 열쇠가 영어 사전에 빠짐없이 있고, 영어에 한글이 남지 않으며, 자리표시가 맞는다.
// 영어 대본(src/script.en.js)은 장면·기록마다 줄 수가 같다. 기기 언어로 언어를 고르는 규칙.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './env.mjs';
import { allKeys } from './i18n-keys.mjs';

const { UI_EN } = await load('src/i18n.en.js');
const { EN } = await load('src/script.en.js');
const { chooseLang } = await load('src/i18n.js');
const S = await load('src/script.js');
const HANGUL = /[가-힣]/;
// 한국어 조사·동사만 담던 자리표시는 영어 문장에서 빠져도 된다.
const PARTICLE_ONLY = new Set(['은', '는', '을', '를', '입어', '써', '메', '붕대를', '연료통을', '배터리 팩을']);

test('화면 글 열쇠가 모두 영어 사전에 있고, 쓰지 않는 열쇠가 없다', () => {
  const keys = allKeys();
  const missing = [...keys.keys()].filter((k) => !(k in UI_EN));
  assert.deepEqual(missing, [], `영어가 없는 열쇠 ${missing.length}개`);
  const unused = Object.keys(UI_EN).filter((k) => !keys.has(k));
  assert.deepEqual(unused, [], '쓰지 않는 열쇠');
});

test('영어 화면 글에 한글이 없고, 뜻을 담은 자리표시는 그대로 있다', () => {
  for (const [ko, en] of Object.entries(UI_EN)) {
    assert.equal(typeof en, 'string', ko);
    assert.ok(!HANGUL.test(en), `${ko} → ${en}`);
    if (en === '' || PARTICLE_ONLY.has(ko)) continue;
    for (const m of ko.matchAll(/\{(\d+)\}/g)) {
      if (en.includes(m[0])) continue;
      // 조사만 담던 자리는 빠져도 된다: 그 자리를 채우는 값은 위 PARTICLE_ONLY 열쇠들이다(코드에서 확인)
      assert.ok(/\{\d+\}\{\d+\}/.test(ko) || /은|는|을|를/.test(ko.slice(ko.indexOf(m[0]) + m[0].length, ko.indexOf(m[0]) + m[0].length + 1)),
        `자리표시 ${m[0]}가 빠짐: ${ko} → ${en}`);
    }
  }
});

test('영어 대본: 모든 장면·기록·말하는 사람·목표가 있고 줄 수가 같으며 한글이 없다', () => {
  for (const k of Object.keys(S.SPEAKERS)) assert.equal(typeof EN.speakers[k], 'string', `speaker ${k}`);
  for (const c of S.CHAPTERS) assert.ok(EN.chapters[c.n], `chapter ${c.n}`);
  for (const k of Object.keys(S.OBJECTIVES)) assert.ok(EN.objectives[k], `objective ${k}`);
  assert.ok(EN.finale.title && EN.finale.text);
  for (const s of S.SCENES) {
    const e = EN.scenes[s.id];
    assert.ok(e, `scene ${s.id}`);
    assert.equal(e.lines.length, s.lines.length, `scene ${s.id} 줄 수`);
    assert.ok(e.title);
  }
  for (const c of S.CLUES) {
    const e = EN.clues[c.id];
    assert.ok(e, `clue ${c.id}`);
    assert.equal(e.body?.length, c.body?.length, `clue ${c.id} 본문 줄 수`);
    for (const k of ['note', 'hand']) assert.equal(typeof e[k], typeof c[k], `clue ${c.id}.${k}`);
    if (c.flip) for (const k of Object.keys(c.flip)) if (typeof c.flip[k] !== 'number') assert.ok(e.flip?.[k] !== undefined, `clue ${c.id}.flip.${k}`);
  }
  const text = JSON.stringify(EN);
  const left = text.match(/[^"]*[가-힣][^"]*/g);
  assert.equal(left, null, `영어 대본에 남은 한글: ${left?.slice(0, 3)}`);
});

test('언어 고르기: 설정이 우선, 자동이면 기기 언어가 한국어일 때만 한국어', () => {
  assert.equal(chooseLang('auto', ['ko-KR', 'en-US']), 'ko');
  assert.equal(chooseLang('auto', ['en-US', 'ko-KR']), 'en');
  assert.equal(chooseLang('auto', ['ja-JP']), 'en');
  assert.equal(chooseLang('auto', []), 'ko');
  assert.equal(chooseLang('ko', ['en-US']), 'ko');
  assert.equal(chooseLang('en', ['ko-KR']), 'en');
  assert.equal(chooseLang('fr', ['ko']), 'ko');
});
