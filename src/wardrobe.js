import * as THREE from 'three';
import { load, save, storageAvailable } from './storage.js';
import { makeBeaconMaterial, BOUND } from './world.js';
import { tr } from './i18n.js';

// 옷장: 비옷 색·모자·안경·배낭. 능력치는 없는 순수 외형이다.
// free 항목은 처음부터 갖고 있고, 나머지는 마을에 떨어진 꾸러미를 주워 영구히 얻는다.

export const SLOTS = [
  { id: 'coat', name: tr('비옷') },
  { id: 'hat', name: tr('모자') },
  { id: 'glasses', name: tr('안경') },
  { id: 'pack', name: tr('배낭') },
];

export const ITEMS = [
  { id: 'coat.yellow', slot: 'coat', name: tr('노랑'), color: 0xe3b13d, free: true },
  { id: 'coat.red', slot: 'coat', name: tr('빨강'), color: 0xc4453a, free: true },
  { id: 'coat.green', slot: 'coat', name: tr('숲초록'), color: 0x55804c, free: true },
  { id: 'coat.teal', slot: 'coat', name: tr('청록'), color: 0x3f9c8f },
  { id: 'coat.orange', slot: 'coat', name: tr('주황'), color: 0xdd7a3a },
  { id: 'coat.sky', slot: 'coat', name: tr('하늘'), color: 0x7fb3d9 },
  { id: 'coat.lilac', slot: 'coat', name: tr('라일락'), color: 0x9a7fc0 },
  { id: 'coat.pink', slot: 'coat', name: tr('분홍'), color: 0xe08a9c },
  { id: 'coat.white', slot: 'coat', name: tr('흰색'), color: 0xe6e1d6 },
  { id: 'hat.hood', slot: 'hat', name: tr('후드'), color: null, free: true },
  { id: 'hat.bare', slot: 'hat', name: tr('맨머리'), color: 0x4a3426, free: true },
  { id: 'hat.beanie', slot: 'hat', name: tr('비니'), color: 0x2f6f73 },
  { id: 'hat.cap', slot: 'hat', name: tr('야구 모자'), color: 0x2f4a78 },
  { id: 'hat.straw', slot: 'hat', name: tr('밀짚모자'), color: 0xdcc07a },
  { id: 'hat.bucket', slot: 'hat', name: tr('버킷햇'), color: 0x7c8450 },
  { id: 'glasses.none', slot: 'glasses', name: tr('없음'), color: null, free: true },
  { id: 'glasses.round', slot: 'glasses', name: tr('둥근 안경'), color: 0x2b2420 },
  { id: 'glasses.sun', slot: 'glasses', name: tr('선글라스'), color: 0x15181c },
  { id: 'glasses.goggles', slot: 'glasses', name: tr('고글'), color: 0x4aa3b5 },
  { id: 'pack.canvas', slot: 'pack', name: tr('캔버스 배낭'), color: 0x7b5a3e, free: true },
  { id: 'pack.none', slot: 'pack', name: tr('없음'), color: null, free: true },
  { id: 'pack.day', slot: 'pack', name: tr('데이팩'), color: 0xc0503c },
  { id: 'pack.hiking', slot: 'pack', name: tr('등산 배낭'), color: 0x3c6a8a },
  { id: 'pack.military', slot: 'pack', name: tr('군용 배낭'), color: 0x5e6b3c },
];

const BY_ID = new Map(ITEMS.map((it) => [it.id, it]));
export const itemById = (id) => BY_ID.get(id);
export const DEFAULT_WEAR = Object.fromEntries(SLOTS.map((s) => [s.id, ITEMS.find((it) => it.slot === s.id && it.free).id]));

// 토스트 문장용 이름: 비옷 색은 '청록 비옷'처럼 부른다.
export const itemLabel = (it) => (it.slot === 'coat' ? tr('{0} 비옷', [it.name]) : it.name);

// 받침 유무로 '을/를'을 고른다.
export function objParticle(word) {
  const c = word.charCodeAt(word.length - 1) - 0xac00;
  return c >= 0 && c < 11172 && c % 28 !== 0 ? tr('을') : tr('를');
}

// ---------------------------------------------------------------- 저장

const KEY = 'lumen.wardrobe';
const MAX_OWNED = 200;

export class Wardrobe {
  constructor() {
    this.owned = new Set();
    this.wear = { ...DEFAULT_WEAR };
    // 저장소가 막힌 브라우저(사생활 보호 모드 등)면 false. 주운 옷은 이 페이지 동안만 남고, 옷장·습득 안내가 알린다.
    this.storeOk = storageAvailable();
    this._load();
  }

  // 손상되거나 다른 버전이 쓴 기록도 읽을 수 있는 만큼만 읽는다. 모르는 id는 지우지 않고 보존해서
  // 새 버전에서 얻은 옷가지가 이전 버전을 한 번 거쳐도 사라지지 않게 한다.
  _load() {
    let raw = null;
    try {
      raw = JSON.parse(load(KEY));
    } catch {
      return;
    }
    if (!raw || typeof raw !== 'object') return;
    if (Array.isArray(raw.owned)) {
      for (const id of raw.owned) {
        if (typeof id === 'string' && id.length <= 40 && this.owned.size < MAX_OWNED) this.owned.add(id);
      }
    }
    const w = raw.wear && typeof raw.wear === 'object' ? raw.wear : {};
    for (const s of SLOTS) {
      const it = itemById(w[s.id]);
      if (it && it.slot === s.id && this.has(it.id)) this.wear[s.id] = it.id;
    }
  }

  _save() {
    this.storeOk = save(KEY, JSON.stringify({ v: 1, owned: [...this.owned], wear: this.wear }));
  }

  has(id) {
    const it = itemById(id);
    return !!it && (it.free || this.owned.has(id));
  }

  get lockedItems() {
    return ITEMS.filter((it) => !this.has(it.id));
  }

  get foundCount() {
    return ITEMS.filter((it) => !it.free && this.owned.has(it.id)).length;
  }

  get findableCount() {
    return ITEMS.filter((it) => !it.free).length;
  }

  unlock(id) {
    if (!itemById(id) || this.has(id)) return false;
    this.owned.add(id);
    this._save();
    return true;
  }

  put(id) {
    const it = itemById(id);
    if (!it || !this.has(id)) return false;
    this.wear[it.slot] = id;
    this._save();
    return true;
  }

  // 기록 파일 가져오기(records.js): 옷가지를 더하고 옷차림을 바꾼 뒤 한 번에 저장한다. 검증은 부르는 쪽이 했다.
  absorb(owned, wear) {
    for (const id of owned) if (itemById(id) && !this.has(id) && this.owned.size < MAX_OWNED) this.owned.add(id);
    for (const [slot, id] of Object.entries(wear)) {
      const it = itemById(id);
      if (it && it.slot === slot && this.has(id)) this.wear[slot] = id;
    }
    this._save();
  }
}

// ---------------------------------------------------------------- 3D 부품
// 좌표는 주인공 body 기준(머리 중심 (0, 1.52, 0.02), 반지름 0.22, 앞이 +z, 등판은 z≈-0.29).
// mat(color, opts)로 재질을 받아 주인공(밤 발광 조절)과 꾸러미(빛나는 전시)가 같은 모양을 쓴다.

function box(g, mat, color, w, h, d, x, y, z, opts) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
  m.position.set(x, y, z);
  g.add(m);
  return m;
}

function mesh(g, mat, color, geo, x, y, z, opts) {
  const m = new THREE.Mesh(geo, mat(color, opts));
  m.position.set(x, y, z);
  g.add(m);
  return m;
}

const BUILD = {
  // 비니·야구 모자의 둥근 부분은 모자 아래 머리카락(반지름 약 0.22)을 덮도록 0.245로 잡는다.
  'hat.beanie'(g, mat) {
    mesh(g, mat, 0x2f6f73, new THREE.SphereGeometry(0.245, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0, 1.55, 0).rotation.x = -0.12;
    mesh(g, mat, 0x285c60, new THREE.CylinderGeometry(0.252, 0.252, 0.075, 10), 0, 1.575, 0).rotation.x = -0.12;
    mesh(g, mat, 0xf0e6d0, new THREE.SphereGeometry(0.055, 6, 5), 0, 1.8, -0.03);
  },
  'hat.cap'(g, mat) {
    const crown = mesh(g, mat, 0x2f4a78, new THREE.SphereGeometry(0.245, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0, 1.56, 0);
    crown.scale.y = 0.85;
    box(g, mat, 0x263d63, 0.28, 0.024, 0.2, 0, 1.585, 0.285).rotation.x = 0.15;
    box(g, mat, 0x263d63, 0.035, 0.02, 0.035, 0, 1.768, 0);
  },
  'hat.straw'(g, mat) {
    mesh(g, mat, 0xdcc07a, new THREE.CylinderGeometry(0.4, 0.42, 0.03, 14), 0, 1.66, 0.02);
    mesh(g, mat, 0xd2b56d, new THREE.CylinderGeometry(0.18, 0.22, 0.17, 12), 0, 1.74, 0.02);
    mesh(g, mat, 0x8a4b2f, new THREE.CylinderGeometry(0.207, 0.217, 0.04, 12), 0, 1.69, 0.02);
  },
  'hat.bucket'(g, mat) {
    mesh(g, mat, 0x7c8450, new THREE.CylinderGeometry(0.2, 0.235, 0.15, 12), 0, 1.72, 0.02);
    mesh(g, mat, 0x6d7446, new THREE.CylinderGeometry(0.255, 0.33, 0.05, 12), 0, 1.635, 0.02);
  },
  'glasses.round'(g, mat) {
    const ring = new THREE.TorusGeometry(0.045, 0.011, 4, 12);
    for (const s of [-1, 1]) {
      mesh(g, mat, 0x2b2420, ring, s * 0.078, 1.55, 0.245);
      box(g, mat, 0x2b2420, 0.012, 0.012, 0.16, s * 0.125, 1.555, 0.17);
    }
    box(g, mat, 0x2b2420, 0.04, 0.012, 0.012, 0, 1.56, 0.25);
  },
  'glasses.sun'(g, mat) {
    for (const s of [-1, 1]) {
      box(g, mat, 0x15181c, 0.1, 0.062, 0.02, s * 0.072, 1.55, 0.24, { roughness: 0.3 }).rotation.y = s * 0.25;
      box(g, mat, 0x15181c, 0.012, 0.012, 0.16, s * 0.125, 1.56, 0.16);
    }
    box(g, mat, 0x15181c, 0.04, 0.012, 0.012, 0, 1.565, 0.25);
  },
  'glasses.goggles'(g, mat) {
    mesh(g, mat, 0x2a2a2a, new THREE.CylinderGeometry(0.228, 0.228, 0.045, 12, 1, true), 0, 1.56, 0.02);
    box(g, mat, 0x2a2a2a, 0.27, 0.1, 0.035, 0, 1.555, 0.21);
    box(g, mat, 0x4aa3b5, 0.25, 0.08, 0.05, 0, 1.555, 0.225, { roughness: 0.25 });
  },
  'pack.canvas'(g, mat) {
    box(g, mat, 0x7b5a3e, 0.4, 0.44, 0.2, 0, 1.02, -0.3);
    box(g, mat, 0x654832, 0.41, 0.12, 0.215, 0, 1.2, -0.3);
  },
  'pack.day'(g, mat) {
    box(g, mat, 0xc0503c, 0.32, 0.34, 0.16, 0, 1.1, -0.27);
    box(g, mat, 0xa8432f, 0.22, 0.13, 0.05, 0, 1.0, -0.37);
  },
  'pack.hiking'(g, mat) {
    box(g, mat, 0x3c6a8a, 0.38, 0.64, 0.24, 0, 1.08, -0.33);
    box(g, mat, 0x335b77, 0.39, 0.1, 0.25, 0, 1.42, -0.33);
    mesh(g, mat, 0x9b4a3a, new THREE.CylinderGeometry(0.075, 0.075, 0.46, 8), 0, 1.5, -0.4).rotation.z = Math.PI / 2;
  },
  'pack.military'(g, mat) {
    box(g, mat, 0x5e6b3c, 0.44, 0.42, 0.22, 0, 1.02, -0.31);
    box(g, mat, 0x525e34, 0.45, 0.1, 0.23, 0, 1.19, -0.31);
    for (const s of [-1, 1]) box(g, mat, 0x525e34, 0.15, 0.17, 0.08, s * 0.11, 0.93, -0.46);
  },
};

// 모델이 없는 항목(후드·맨머리·없음)은 null. 비옷 색은 재질 색만 바꾸므로 여기서 만들지 않는다.
export function buildPart(id, mat) {
  const fn = BUILD[id];
  if (!fn) return null;
  const g = new THREE.Group();
  fn(g, mat);
  return g;
}

// 떨어진 비옷 꾸러미: 개어 놓은 옷 모양
function buildFolded(color, mat) {
  const g = new THREE.Group();
  box(g, mat, color, 0.42, 0.1, 0.32, 0, 0, 0);
  box(g, mat, color, 0.4, 0.06, 0.12, 0, 0.075, 0.08);
  box(g, mat, 0xf0e6d0, 0.12, 0.02, 0.12, 0.1, 0.06, -0.06);
  return g;
}

export function disposeTree(root) {
  const geos = new Set();
  const mats = new Set();
  root.traverse((o) => {
    if (o.geometry) geos.add(o.geometry);
    if (o.material) mats.add(o.material);
  });
  for (const x of geos) x.dispose();
  for (const x of mats) x.dispose();
}

// ---------------------------------------------------------------- 마을에 떨어진 꾸러미

const DROP_COUNT = 3;
const PICK_REACH = 0.8; // 걸어서 줍는 거리(main의 drops.take 1.0m)보다 조금 안쪽
const TRUCK_CLEAR = 3.5; // 세워 둔 트럭(약 2×4.2m) 둘레에는 놓지 않는다
const tmp = new THREE.Vector3();

// ---------------------------------------------------------------- 걸어서 닿는 곳
// 마을 이동 한계(BOUND) 안을 CELL 칸으로 나눠, 정적 충돌체를 플레이어 반지름만큼 부풀려 막힌 칸을 찍고,
// 출발점에서 상하좌우로 이어진 칸을 찾는다. 울타리 안쪽·연못 가장자리·건물 사이 막힌 틈처럼 걸어서 못 가는 자리를 거른다.
// 대각선으로는 잇지 않아(부푼 충돌체 두 모서리 사이로 새지 않게) 실제보다 조금 보수적이다. 트럭처럼 움직이는 것은 넣지 않는다.
const CELL = 0.4;

export class ReachMap {
  constructor(colliders, from, r, bound = BOUND) {
    const n = Math.floor((bound * 2) / CELL) + 1;
    this.n = n;
    this.bound = bound;
    const blocked = new Uint8Array(n * n);
    const idx = (v) => (v + bound) / CELL;
    for (const c of colliders) {
      const box = c.t === 0;
      const x0 = box ? c.x0 - r : c.x - c.r - r;
      const x1 = box ? c.x1 + r : c.x + c.r + r;
      const z0 = box ? c.z0 - r : c.z - c.r - r;
      const z1 = box ? c.z1 + r : c.z + c.r + r;
      const rr = box ? r * r : (c.r + r) ** 2;
      for (let i = Math.max(0, Math.ceil(idx(x0))); i <= Math.min(n - 1, Math.floor(idx(x1))); i++) {
        const x = i * CELL - bound;
        for (let j = Math.max(0, Math.ceil(idx(z0))); j <= Math.min(n - 1, Math.floor(idx(z1))); j++) {
          const z = j * CELL - bound;
          const dx = box ? x - Math.min(Math.max(x, c.x0), c.x1) : x - c.x;
          const dz = box ? z - Math.min(Math.max(z, c.z0), c.z1) : z - c.z;
          if (dx * dx + dz * dz < rr) blocked[i * n + j] = 1;
        }
      }
    }
    this.blocked = blocked;
    this.reach = new Uint8Array(n * n);
    // 출발점 칸이 충돌체에 걸쳐 막혔으면 2m 안의 가장 가까운 빈 칸에서 시작한다.
    const s = this._find(from.x, from.z, 2, (k) => !blocked[k]);
    if (s < 0) return;
    const reach = this.reach;
    const queue = new Int32Array(n * n);
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    reach[s] = 1;
    const visit = (k) => {
      if (reach[k] || blocked[k]) return;
      reach[k] = 1;
      queue[tail++] = k;
    };
    while (head < tail) {
      const k = queue[head++];
      const i = (k / n) | 0;
      const j = k - i * n;
      if (i > 0) visit(k - n);
      if (i < n - 1) visit(k + n);
      if (j > 0) visit(k - 1);
      if (j < n - 1) visit(k + 1);
    }
  }

  // (x, z)에서 rad 안의 칸 가운데 ok를 만족하는 가장 가까운 칸 번호(없으면 -1)
  _find(x, z, rad, ok) {
    const { n, bound } = this;
    let best = -1;
    let bd = rad * rad;
    for (let i = Math.max(0, Math.ceil((x - rad + bound) / CELL)); i <= Math.min(n - 1, Math.floor((x + rad + bound) / CELL)); i++) {
      for (let j = Math.max(0, Math.ceil((z - rad + bound) / CELL)); j <= Math.min(n - 1, Math.floor((z + rad + bound) / CELL)); j++) {
        const d = (i * CELL - bound - x) ** 2 + (j * CELL - bound - z) ** 2;
        if (d <= bd && ok(i * n + j)) {
          bd = d;
          best = i * n + j;
        }
      }
    }
    return best;
  }

  // 출발점에서 걸어가 (x, z)의 rad 안에 설 수 있는가
  near(x, z, rad = PICK_REACH) {
    return this._find(x, z, rad, (k) => this.reach[k] === 1) >= 0;
  }
}

const shuffled = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export class OutfitDrops {
  constructor(scene) {
    this.root = new THREE.Group();
    scene.add(this.root);
    this.list = [];
    this.ringGeo = new THREE.RingGeometry(0.45, 0.58, 28).rotateX(-Math.PI / 2);
    // 멀리서도 보이는 크림색 빛기둥. 배전함의 붉은 기둥(18m)보다 낮게 해서 구별한다.
    this.beamGeo = new THREE.CylinderGeometry(0.32, 0.32, 6, 12, 1, true).translate(0, 3, 0);
    this.beamMat = makeBeaconMaterial(new THREE.Color(1.0, 0.86, 0.55));
  }

  clear() {
    for (const d of this.list) {
      this.root.remove(d.g);
      d.part.traverse((o) => o.geometry?.dispose());
      for (const m of d.mats) m.dispose();
      d.ringMat.dispose();
    }
    this.list.length = 0;
  }

  // 아직 없는 옷가지 중 최대 3개를 시작 지점에서 먼 수색 지점 근처, 서로 떨어진 곳에 놓는다.
  // avoid는 플레이어가 서 있는 곳(새 판은 시작 지점)이고, 거기서 걸어서 닿는 자리만 쓴다.
  // truck: 세워 둔 트럭 위치(옆이나 밑에 놓지 않는다). radius: 플레이어 충돌 반지름(player.js PLAYER_R).
  spawn(world, wardrobe, avoid, { truck = null, radius = 0.36 } = {}) {
    this.clear();
    const reach = this.reachFrom(world, avoid, radius);
    const pool = shuffled(wardrobe.lockedItems);
    const spots = shuffled(world.loot.filter((l) => Math.hypot(l.x - avoid.x, l.z - avoid.z) > 16));
    const placed = [];
    for (const it of pool) {
      if (placed.length >= DROP_COUNT) break;
      let at = null;
      for (const s of spots) {
        if (!placed.every((p) => Math.hypot(p.x - s.x, p.z - s.z) > 14)) continue;
        at = this._spotNear(world, s, reach, truck);
        if (at) break;
      }
      if (!at) break;
      placed.push(at);
      this._add(it, at.x, world.heightAt(at.x, at.z), at.z);
    }
    return this.list.length;
  }

  // 충돌체는 마을을 지을 때 정해지고(판마다 물건만 섞는다) 이야기 소품이 그 뒤에 더해지므로,
  // 충돌체 수와 출발 칸이 같으면 지난번 지도를 다시 쓴다.
  reachFrom(world, from, radius) {
    const key = `${world.colliders.length}:${Math.round(from.x / CELL)}:${Math.round(from.z / CELL)}:${radius}`;
    if (this._reachKey !== key) {
      this._reach = new ReachMap(world.colliders, from, radius);
      this._reachKey = key;
    }
    return this._reach;
  }

  // 수색 지점에서 1.3m 떨어진 여덟 방향 가운데, 충돌체 밖으로 밀어낸 뒤에도 걸어서 집을 수 있는 첫 자리
  _spotNear(world, s, reach, truck) {
    const a0 = Math.random() * Math.PI * 2;
    for (let k = 0; k < 8; k++) {
      const a = a0 + (k * Math.PI) / 4;
      tmp.set(s.x + Math.cos(a) * 1.3, 0, s.z + Math.sin(a) * 1.3);
      for (let i = 0; i < 3; i++) world.collide(tmp, 0.55);
      if (truck && Math.hypot(tmp.x - truck.x, tmp.z - truck.z) < TRUCK_CLEAR) continue;
      if (reach.near(tmp.x, tmp.z)) return { x: tmp.x, z: tmp.z };
    }
    return null;
  }

  _add(item, x, y, z) {
    const mats = [];
    const mat = (color, opts = {}) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: opts.roughness ?? 0.75, flatShading: true, emissive: color, emissiveIntensity: 0.3 });
      mats.push(m);
      return m;
    };
    const part = item.slot === 'coat' ? buildFolded(item.color, mat) : buildPart(item.id, mat);
    // 몸에 붙는 위치로 만든 부품을 가운데로 옮기고, 작은 안경은 크게 보여 준다.
    part.position.sub(new THREE.Box3().setFromObject(part).getCenter(tmp));
    const holder = new THREE.Group();
    holder.scale.setScalar(item.slot === 'glasses' ? 2.6 : item.slot === 'hat' ? 1.5 : 1.25);
    // 안경은 납작해서 옆에서 보면 선처럼 보이므로 앞면이 위로 비치게 기울인다.
    const tilt = new THREE.Group();
    tilt.rotation.x = item.slot === 'glasses' ? -0.5 : 0;
    tilt.add(part);
    holder.add(tilt);
    part.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffe3a8, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
    const ring = new THREE.Mesh(this.ringGeo, ringMat);
    ring.position.y = 0.04;
    const beam = new THREE.Mesh(this.beamGeo, this.beamMat);
    beam.renderOrder = 3;
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.add(holder, ring, beam);
    this.root.add(g);
    this.list.push({ item, x, z, g, holder, part, mats, ringMat, seed: Math.random() * 10 });
  }

  update(dt, t, night) {
    this.beamMat.uniforms.uOpacity.value = (0.16 + 0.34 * night) * (0.75 + 0.25 * Math.sin(t * 2.6));
    for (const d of this.list) {
      d.holder.rotation.y += dt * 1.4;
      d.holder.position.y = 0.8 + Math.sin(t * 2 + d.seed) * 0.08;
      d.ringMat.opacity = 0.35 + 0.25 * Math.sin(t * 3 + d.seed);
      for (const m of d.mats) m.emissiveIntensity = 0.3 + 0.6 * night;
    }
  }

  // 반경 안에 들어온 꾸러미를 집어 그 항목을 돌려준다.
  take(x, z, r) {
    const i = this.list.findIndex((d) => Math.hypot(d.x - x, d.z - z) < r);
    if (i < 0) return null;
    const [d] = this.list.splice(i, 1);
    this.root.remove(d.g);
    d.part.traverse((o) => o.geometry?.dispose());
    for (const m of d.mats) m.dispose();
    d.ringMat.dispose();
    return d.item;
  }
}

// ---------------------------------------------------------------- 옷장 화면

// 미리보기 카메라: 인물(허리 높이)에서 방위 az 쪽으로 20m, 높이 비율은 게임 카메라보다 낮게(0.55).
// 기본 방위는 게임 카메라와 같은 π/4(+x·+z 쪽)다.
const BASE_AZ = Math.PI / 4;
const VIEW_DIST = 20;
// 고른 부위가 잘 보이게 돌려 세울 각도(카메라 방위 기준). 배낭은 등이 보이게.
const SHOW_YAW = { coat: 0.5, hat: 0.35, glasses: 0.15, pack: Math.PI - 0.5 };

export function previewDir(az, out = new THREE.Vector3()) {
  return out.set(Math.sin(az) * Math.SQRT2, 0.55, Math.cos(az) * Math.SQRT2).normalize();
}

// ---------------------------------------------------------------- 미리보기 시선
// 은신처 앞 시작 지점은 고정 시드 마을이라 기본 방위가 늘 트여 있지만(tests/node/wardrobe.test.mjs),
// 처음 화면의 트럭은 지난 판에 세워 둔 자리에 그대로 있어 인물을 가릴 수 있다. 그래서 열 때마다
// 카메라에서 인물의 발·허리·머리로 광선을 쏘아, 그림자를 드리우는 불투명한 물체(건물·나무·소품·트럭)에 먼저 닿으면
// 가려진 것으로 보고 방위를 좌우로 조금씩 돌려 본다.
const VIEW_TRY = [0, -0.35, 0.35, -0.7, 0.7, -1.05, 1.05, -1.4, 1.4];
const VIEW_PROBES = [0.35, 0.95, 1.55];
const ray = new THREE.Raycaster();
const vDir = new THREE.Vector3();
const vFrom = new THREE.Vector3();
const vTo = new THREE.Vector3();

// scene에서 skip(주인공) 밑을 뺀, 지금 보이고 그림자를 드리우는 메시
export function viewBlockers(scene, skip) {
  const out = [];
  scene.traverseVisible((o) => {
    if (!o.isMesh || !o.castShadow) return;
    for (let p = o; p; p = p.parent) if (p === skip) return;
    out.push(o);
  });
  return out;
}

// feet(발 위치)에 선 인물이 방위 az의 미리보기 카메라에서 가리지 않고 보이는가
export function viewClear(blockers, feet, az) {
  previewDir(az, vDir);
  vFrom.set(feet.x, feet.y + 0.9, feet.z).addScaledVector(vDir, VIEW_DIST);
  for (const h of VIEW_PROBES) {
    vTo.set(feet.x, feet.y + h, feet.z).sub(vFrom);
    const dist = vTo.length();
    ray.set(vFrom, vTo.normalize());
    ray.far = dist - 0.3; // 인물 바로 앞(발밑 연석 등)은 가림으로 치지 않는다
    if (ray.intersectObjects(blockers, false).length) return false;
  }
  return true;
}

// 가리지 않는 방위. 다 가려지면 기본 방위.
export function chooseView(blockers, feet) {
  for (const d of VIEW_TRY) if (viewClear(blockers, feet, BASE_AZ + d)) return BASE_AZ + d;
  return BASE_AZ;
}

export class Closet {
  constructor(wardrobe, onChange) {
    this.wardrobe = wardrobe;
    this.onChange = onChange;
    this.tab = 'coat';
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 80);
    this.az = null; // 이번에 열었을 때 고른 카메라 방위(첫 프레임에 정한다)
    this.yaw = BASE_AZ + SHOW_YAW.coat;
    this.hold = 0;
    this.holdYaw = null;
    this.tabsEl = document.getElementById('closet-tabs');
    this.gridEl = document.getElementById('closet-grid');
    this.countEl = document.getElementById('closet-count');
    this.storeEl = document.getElementById('closet-store'); // 새로 생긴 요소라 옛 HTML에는 없을 수 있다
    // 배포 직후 캐시된 옛 HTML과 섞이면 옷장 요소가 없다. 그때는 화면 없이 꾸러미·저장만 동작한다.
    this.ok = !!(this.tabsEl && this.gridEl && this.countEl);
    if (!this.ok) return;
    this.tabsEl.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-slot]');
      if (!b) return;
      this.tab = b.dataset.slot;
      this._showSlot(this.tab);
      this.render();
    });
    this.gridEl.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-id]');
      if (!b || !this.wardrobe.put(b.dataset.id)) return;
      this._showSlot(itemById(b.dataset.id).slot);
      this.onChange();
      this.render();
    });
  }

  _showSlot(slot) {
    this.holdYaw = (this.az ?? BASE_AZ) + SHOW_YAW[slot];
    this.hold = 2.5;
  }

  open() {
    this.az = null;
    this.hold = 0;
    this.holdYaw = null;
    this.render();
  }

  render() {
    if (!this.ok) return;
    const w = this.wardrobe;
    this.countEl.textContent = tr('모은 옷가지 {0} / {1}', [w.foundCount, w.findableCount]);
    if (this.storeEl) this.storeEl.textContent = w.storeOk ? '' : tr('이 브라우저는 저장소를 막아 두어 옷장이 이번 세션에만 남아요(사생활 보호 모드 등).');
    this.tabsEl.replaceChildren(...SLOTS.map((s) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.slot = s.id;
      b.className = `chip${s.id === this.tab ? ' on' : ''}`;
      b.setAttribute('aria-pressed', String(s.id === this.tab));
      b.textContent = s.name;
      return b;
    }));
    this.gridEl.replaceChildren(...ITEMS.filter((it) => it.slot === this.tab).map((it) => {
      const owned = w.has(it.id);
      const on = w.wear[it.slot] === it.id;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `closet-item${on ? ' on' : ''}${owned ? '' : ' locked'}`;
      // 잠긴 항목은 disabled 대신 aria-disabled로 두어 스크린리더·Tab이 건너뛰지 않고 '마을에서 찾기'와 설명을 읽게 한다.
      // data-id가 없어 눌러도 아무 일이 없다.
      if (owned) b.dataset.id = it.id;
      else {
        b.setAttribute('aria-disabled', 'true');
        b.setAttribute('aria-describedby', 'closet-note');
      }
      b.setAttribute('aria-pressed', String(on));
      const sw = document.createElement('span');
      sw.className = 'swatch';
      if (it.color === null) sw.classList.add('empty');
      else sw.style.background = `#${it.color.toString(16).padStart(6, '0')}`;
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = it.name;
      const note = document.createElement('span');
      note.className = 'note';
      note.textContent = owned ? (on ? tr('입는 중') : '') : tr('마을에서 찾기');
      b.append(sw, name, note);
      return b;
    }));
  }

  // 미리보기: 천천히 돌다가, 부위를 고르면 그쪽을 잠시 보여 준다. 화면 방향에 맞춰 인물을 패널 반대편에 둔다.
  update(dt, player) {
    if (this.az === null) {
      // 열고 나서 첫 프레임: 주인공이 시작 지점에 선 뒤라 여기서 시선을 고른다.
      let scene = player.root;
      while (scene.parent) scene = scene.parent;
      scene.updateMatrixWorld();
      this.az = chooseView(viewBlockers(scene, player.root), player.pos);
      this.yaw = this.az + SHOW_YAW.coat;
    }
    if (this.hold > 0) {
      this.hold -= dt;
      let d = ((this.holdYaw - this.yaw + Math.PI) % (Math.PI * 2)) - Math.PI;
      if (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * (1 - Math.exp(-dt * 6));
    } else {
      this.yaw += dt * 0.45;
    }
    player.model.rotation.y = this.yaw;
    player.facing = this.yaw;

    const aspect = innerWidth / Math.max(1, innerHeight);
    const portrait = aspect < 1;
    const half = portrait ? 1.95 : 1.2; // 세로 절반 높이(m)
    const fx = portrait ? 0.5 : 0.3; // 인물 중심의 화면 가로 위치(왼쪽부터)
    const fy = portrait ? 0.27 : 0.5; // 인물 중심의 화면 세로 위치(위부터)
    const W = half * 2 * aspect;
    const H = half * 2;
    const cam = this.camera;
    cam.left = -fx * W;
    cam.right = (1 - fx) * W;
    cam.top = fy * H;
    cam.bottom = -(1 - fy) * H;
    cam.updateProjectionMatrix();
    tmp.copy(player.pos);
    tmp.y += 0.9;
    cam.position.copy(tmp).addScaledVector(previewDir(this.az, vDir), VIEW_DIST);
    cam.lookAt(tmp);
    cam.updateMatrixWorld();
  }
}
