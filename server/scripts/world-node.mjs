// 브라우저용 마을 생성 코드(src/world.js)를 Node에서 돌려 슬롯 표를 계산한다.
// three.js는 vendor/ 사본을 쓰고, 빛 웅덩이 텍스처용 canvas만 흉내 낸다(그리기 결과는 쓰지 않는다).
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const threeUrl = pathToFileURL(path.join(repo, 'vendor/three/three.module.js')).href;

register(`data:text/javascript,${encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return next(${JSON.stringify(threeUrl)}, ctx);
  return next(spec, ctx);
}`)}`);

globalThis.document ??= {
  createElement: () => ({
    getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {} }),
  }),
};

export async function computeSlots() {
  const THREE = await import('three');
  const { World } = await import(pathToFileURL(path.join(repo, 'src/world.js')).href);
  const slots = await import(pathToFileURL(path.join(repo, 'src/slots.js')).href);
  const world = new World(new THREE.Scene(), {});
  return { layout: slots.SLOT_LAYOUT, count: slots.SLOT_COUNT, blocked: slots.blockedSlots(world) };
}

export const generatedPath = path.join(repo, 'server/src/slots.js');

export function render({ layout, count, blocked }) {
  const rows = [];
  for (let i = 0; i < blocked.length; i += 20) rows.push(`  ${blocked.slice(i, i + 20).join(', ')},`);
  return `// 자동 생성 파일 — 직접 고치지 않는다. server/에서 \`npm run gen-slots\`로 다시 만든다.
// 원본: src/slots.js (SLOT_LAYOUT ${layout}). 막힌 칸 ${blocked.length}개, 둘 수 있는 칸 ${count - blocked.length}개.
export const LAYOUT = ${layout};
export const SLOT_COUNT = ${count};
export const BLOCKED_SLOTS = Object.freeze([
${rows.join('\n')}
]);
`;
}
