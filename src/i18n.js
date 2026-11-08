import { load } from './storage.js';
import { UI_EN } from './i18n.en.js';

// 화면 글의 언어(#60). 한국어가 원문이고, 영어는 한국어 원문을 열쇠로 한 사전(src/i18n.en.js)과 대본(src/script.en.js)으로 바꾼다.
// 언어는 페이지를 열 때 한 번 정한다: 설정의 언어(lumen.settings.lang: 'auto' | 'ko' | 'en'), 'auto'면 기기 언어가 한국어일 때만
// 한국어. 설정에서 바꾸면 페이지를 다시 연다(모든 모듈이 열 때 글을 정하므로). 결정은 DECISIONS.md "영어 지원".

export const LANGS = ['ko', 'en'];

export function chooseLang(pref, deviceLangs) {
  if (pref === 'ko' || pref === 'en') return pref;
  const first = (deviceLangs?.[0] ?? 'ko').toLowerCase();
  return first.startsWith('ko') ? 'ko' : 'en';
}

function readPref() {
  try {
    const s = JSON.parse(load('lumen.settings'));
    return typeof s?.lang === 'string' ? s.lang : 'auto';
  } catch {
    return 'auto';
  }
}

const device = typeof navigator !== 'undefined' ? navigator.languages?.length ? navigator.languages : [navigator.language] : ['ko'];
// ?lang=en·ko로 열면 설정과 상관없이 그 언어(시험·스크린샷용)
const forced = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('lang') : null;
export const lang = chooseLang(forced ?? readPref(), device);
export const isKo = lang === 'ko';

const missing = new Set();

// {이름} 자리에 vars의 값을 넣는다.
function fill(text, vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k])));
}

// 한국어 원문 ko를 지금 언어로(코드에서는 tr). 지역 변수 t와 겹치지 않게 이름을 tr로 둔다. 사전에 없으면 한국어 그대로 두고 한 번만 알린다(tests/node/i18n.test.mjs가 빠진 것을 잡는다).
export function tr(ko, vars) {
  if (isKo) return fill(ko, vars);
  const en = UI_EN[ko];
  if (en === undefined) {
    if (!missing.has(ko)) {
      missing.add(ko);
      console.warn(`[i18n] 영어가 없습니다: ${ko}`);
    }
    return fill(ko, vars);
  }
  return fill(en, vars);
}

// 한국어일 때만 붙는 조사(을/를 등)를 피하려고, 영어에서는 문장을 통째로 tr()로 바꾼다. 이 함수는 한국어 받침 판정만 한다.
export function hasBatchim(word) {
  const code = String(word).charCodeAt(String(word).length - 1) - 0xac00;
  return code >= 0 && code < 11172 && code % 28 !== 0;
}

// index.html의 고정 글(글자 마디와 aria-label·title·alt·placeholder)을 사전으로 바꾼다. 페이지를 열 때 한 번 부른다.
const ATTRS = ['aria-label', 'title', 'alt', 'placeholder', 'content'];
export function translateDom(root = document.body) {
  document.documentElement.lang = lang;
  if (isKo) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
  for (const n of nodes) {
    const raw = n.nodeValue;
    const key = raw.trim();
    // 스크립트·noscript 안의 글(주석 등)과 data-no-t(언어 이름 등)는 그대로 둔다.
    if (!key || !/[가-힣]/.test(key) || n.parentElement?.closest('[data-no-t], script, style, noscript')) continue;
    n.nodeValue = raw.replace(key, tr(key));
  }
  for (const el of root.querySelectorAll('*')) {
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v && /[가-힣]/.test(v) && !(a === 'content' && el.tagName !== 'META')) el.setAttribute(a, tr(v.trim()));
    }
  }
  // 글자가 든 그림(로고)은 영어판 그림으로(data-src-en·data-srcset-en)
  for (const el of root.querySelectorAll('[data-src-en]')) el.setAttribute('src', el.dataset.srcEn);
  for (const el of root.querySelectorAll('[data-srcset-en]')) el.setAttribute('srcset', el.dataset.srcsetEn);
  const title = document.querySelector('title');
  if (title && /[가-힣]/.test(title.textContent)) title.textContent = tr(title.textContent.trim());
}
