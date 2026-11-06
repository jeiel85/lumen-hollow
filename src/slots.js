import { PITCH } from './world.js';

// 공유 보급품을 둘 수 있는 인도 슬롯. 설계: docs/online-caches.md 6절.
// 마을 배치가 고정 시드라 같은 버전을 받은 모든 플레이어에게 같은 번호가 같은 자리다.
// 서버(server/src/slots.js)는 이 파일로 만든 "막힌 칸" 목록을 쓴다. 마을 생성이나 아래 규칙을 바꾸면
// SLOT_LAYOUT을 올리고 server/에서 `npm run gen-slots`로 서버 목록을 다시 만든다(서버 테스트가 어긋남을 잡는다).
export const SLOT_LAYOUT = 1;
export const SLOT_COUNT = 600;

const SIDES = [[0, 1], [0, -1], [1, 0], [-1, 0]]; // 남(+z)·북·동(+x)·서
const OFFSETS = [-7.5, -4.5, -1.5, 1.5, 4.5, 7.5];
const WALK = 11; // 블록 중심에서 인도 중심선까지

// slot = ((row * 5 + col) * 4 + side) * 6 + i
export function slotPos(id) {
  const i = id % 6;
  const side = Math.floor(id / 6) % 4;
  const block = Math.floor(id / 24);
  const row = Math.floor(block / 5);
  const col = block % 5;
  const cx = (col - 2) * PITCH;
  const cz = (row - 2) * PITCH;
  const [sx, sz] = SIDES[side];
  const t = OFFSETS[i];
  return { x: sx ? cx + sx * WALK : cx + t, z: sz ? cz + sz * WALK : cz + t };
}

// 충돌체(가로등 기둥·가로수·건물 등)에서 1m, 배전함·수색 지점에서 2m 안의 칸은 막는다.
export function blockedSlots(world) {
  const out = [];
  for (let id = 0; id < SLOT_COUNT; id++) {
    if (!isClear(world, slotPos(id))) out.push(id);
  }
  return out;
}

function isClear(world, p) {
  const r = 1.0;
  for (const c of world.colliders) {
    if (c.t === 0) {
      const nx = Math.min(Math.max(p.x, c.x0), c.x1);
      const nz = Math.min(Math.max(p.z, c.z0), c.z1);
      if (Math.hypot(p.x - nx, p.z - nz) < r) return false;
    } else if (Math.hypot(p.x - c.x, p.z - c.z) < c.r + r) {
      return false;
    }
  }
  for (const f of world.fuseBoxes) if (Math.hypot(f.ix - p.x, f.iz - p.z) < 2.0) return false;
  for (const l of world.loot) if (Math.hypot(l.x - p.x, l.z - p.z) < 2.0) return false;
  return true;
}
