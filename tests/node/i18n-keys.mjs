// 영어 사전(src/i18n.en.js)에 있어야 할 한국어 열쇠를 모은다(#60).
// 1) src/*.js의 tr('...') 첫 인자(문자열 그대로), 2) index.html <body>의 글자 마디와 aria-label·title·alt·placeholder, <title>.
// src/i18n.js translateDom()과 같은 규칙: 앞뒤 공백을 떼고, 한글이 든 것만, data-no-t 안은 뺀다.
//   node tests/node/i18n-keys.mjs           → 사전에 없는 열쇠를 JSON으로
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HANGUL = /[가-힣]/;

function unescape(s) {
  return s.replace(/\\(.)/g, (m, c) => ({ n: '\n', t: '\t' }[c] ?? c));
}

export function sourceKeys() {
  const keys = new Map(); // 열쇠 → 처음 나온 파일
  const dir = path.join(repo, 'src');
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.js') && !n.startsWith('i18n') && n !== 'script.en.js')) {
    const src = readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/\btr\(\s*'((?:[^'\\\n]|\\.)*)'/g)) {
      const k = unescape(m[1]);
      if (HANGUL.test(k) && !keys.has(k)) keys.set(k, `src/${f}`);
    }
  }
  // 간판 글귀(src/world.js SIGNS)는 한국어가 가게 고르기 열쇠라 그대로 두고 그릴 때 tr(글귀)로 바꾼다.
  const world = readFileSync(path.join(dir, 'world.js'), 'utf8');
  const signs = world.match(/const SIGNS = \[([\s\S]*?)\];/);
  for (const m of signs ? signs[1].matchAll(/\['([^']+)'/g) : []) if (!keys.has(m[1])) keys.set(m[1], 'src/world.js SIGNS');
  return keys;
}

export function htmlKeys() {
  const keys = new Map();
  const html = readFileSync(path.join(repo, 'index.html'), 'utf8');
  const title = html.match(/<title>([^<]*)<\/title>/);
  if (title && HANGUL.test(title[1])) keys.set(title[1].trim(), 'index.html <title>');
  let body = html.slice(html.indexOf('<body'));
  body = body.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<noscript[\s\S]*?<\/noscript>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  // data-no-t가 붙은 요소의 글은 뺀다(언어 이름 등). 한 줄짜리 요소만 쓴다.
  body = body.replace(/<(\w+)[^>]*\sdata-no-t[^>]*>[^<]*<\/\1>/g, '');
  for (const m of body.matchAll(/>([^<>]+)</g)) {
    const k = m[1].replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
    if (k && HANGUL.test(k)) keys.set(k, 'index.html');
  }
  for (const m of body.matchAll(/\s(?:aria-label|title|alt|placeholder)="([^"]*)"/g)) {
    const k = m[1].trim();
    if (HANGUL.test(k)) keys.set(k, 'index.html');
  }
  return keys;
}

export function allKeys() {
  return new Map([...htmlKeys(), ...sourceKeys()]);
}

// 직접 실행: 사전에 없는 열쇠를 출력한다(번역할 목록).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { UI_EN } = await import(pathToFileURL(path.join(repo, 'src/i18n.en.js')).href);
  const missing = [...allKeys()].filter(([k]) => !(k in UI_EN)).map(([k, where]) => ({ ko: k, where }));
  const unused = Object.keys(UI_EN).filter((k) => !allKeys().has(k));
  console.log(JSON.stringify({ total: allKeys().size, missing: missing.length, unused, keys: missing }, null, 1));
}
