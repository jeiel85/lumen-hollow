// 브라우저용 게임 모듈(src/)을 Node에서 불러오기 위한 준비.
// three.js는 vendor/ 사본을 쓰고, canvas·localStorage는 흉내만 낸다(그리기 결과는 시험하지 않는다).
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

export const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const threeUrl = pathToFileURL(path.join(repo, 'vendor/three/three.module.js')).href;

register(`data:text/javascript,${encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return next(${JSON.stringify(threeUrl)}, ctx);
  return next(spec, ctx);
}`)}`);

// 어떤 속성을 읽거나 불러도 자기 자신을 돌려주는 빈 객체(canvas 2D 컨텍스트·그라디언트 대역)
const stub = new Proxy(function stub() {}, {
  get: (t, k) => (k === 'width' || k === 'height' ? 64 : k === Symbol.toPrimitive ? () => 0 : k === 'then' ? undefined : stub),
  set: () => true,
  apply: () => stub,
});
globalThis.document ??= { createElement: () => stub };

const store = new Map();
export const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
  clear: () => store.clear(),
};
globalThis.window ??= globalThis;
// 화면 글의 언어(src/i18n.js)는 기기 언어를 따른다. 시험은 한국어 원문으로 돌린다(영어는 i18n 시험이 따로 본다).
Object.defineProperty(globalThis, 'navigator', { value: { language: 'ko-KR', languages: ['ko-KR'] }, configurable: true, writable: true });
globalThis.localStorage ??= localStorage;

export const load = (rel) => import(pathToFileURL(path.join(repo, rel)).href);

// 마을·이야기·2~4장 무대를 한 번에 만든다(게임 시작과 같은 순서).
export async function makeGame({ chapters = false } = {}) {
  const THREE = await import('three');
  const { World } = await load('src/world.js');
  const { Story } = await load('src/story.js');
  const scene = new THREE.Scene();
  const world = new World(scene, {});
  const story = new Story(scene, world);
  let ch = null;
  if (chapters) {
    const { Chapters } = await load('src/chapters.js');
    ch = new Chapters(scene, world, story);
  }
  return { THREE, scene, world, story, chapters: ch };
}
