import * as THREE from 'three';
import { load, save } from './storage.js';
import { makeBeaconMaterial } from './world.js';

// 옷장: 비옷 색·모자·안경·배낭. 능력치는 없는 순수 외형이다.
// free 항목은 처음부터 갖고 있고, 나머지는 마을에 떨어진 꾸러미를 주워 영구히 얻는다.

export const SLOTS = [
  { id: 'coat', name: '비옷' },
  { id: 'hat', name: '모자' },
  { id: 'glasses', name: '안경' },
  { id: 'pack', name: '배낭' },
];

export const ITEMS = [
  { id: 'coat.yellow', slot: 'coat', name: '노랑', color: 0xe3b13d, free: true },
  { id: 'coat.red', slot: 'coat', name: '빨강', color: 0xc4453a, free: true },
  { id: 'coat.green', slot: 'coat', name: '숲초록', color: 0x55804c, free: true },
  { id: 'coat.teal', slot: 'coat', name: '청록', color: 0x3f9c8f },
  { id: 'coat.orange', slot: 'coat', name: '주황', color: 0xdd7a3a },
  { id: 'coat.sky', slot: 'coat', name: '하늘', color: 0x7fb3d9 },
  { id: 'coat.lilac', slot: 'coat', name: '라일락', color: 0x9a7fc0 },
  { id: 'coat.pink', slot: 'coat', name: '분홍', color: 0xe08a9c },
  { id: 'coat.white', slot: 'coat', name: '흰색', color: 0xe6e1d6 },
  { id: 'hat.hood', slot: 'hat', name: '후드', color: null, free: true },
  { id: 'hat.bare', slot: 'hat', name: '맨머리', color: 0x4a3426, free: true },
  { id: 'hat.beanie', slot: 'hat', name: '비니', color: 0x2f6f73 },
  { id: 'hat.cap', slot: 'hat', name: '야구 모자', color: 0x2f4a78 },
  { id: 'hat.straw', slot: 'hat', name: '밀짚모자', color: 0xdcc07a },
  { id: 'hat.bucket', slot: 'hat', name: '버킷햇', color: 0x7c8450 },
  { id: 'glasses.none', slot: 'glasses', name: '없음', color: null, free: true },
  { id: 'glasses.round', slot: 'glasses', name: '둥근 안경', color: 0x2b2420 },
  { id: 'glasses.sun', slot: 'glasses', name: '선글라스', color: 0x15181c },
  { id: 'glasses.goggles', slot: 'glasses', name: '고글', color: 0x4aa3b5 },
  { id: 'pack.canvas', slot: 'pack', name: '캔버스 배낭', color: 0x7b5a3e, free: true },
  { id: 'pack.none', slot: 'pack', name: '없음', color: null, free: true },
  { id: 'pack.day', slot: 'pack', name: '데이팩', color: 0xc0503c },
  { id: 'pack.hiking', slot: 'pack', name: '등산 배낭', color: 0x3c6a8a },
  { id: 'pack.military', slot: 'pack', name: '군용 배낭', color: 0x5e6b3c },
];

const BY_ID = new Map(ITEMS.map((it) => [it.id, it]));
export const itemById = (id) => BY_ID.get(id);
export const DEFAULT_WEAR = Object.fromEntries(SLOTS.map((s) => [s.id, ITEMS.find((it) => it.slot === s.id && it.free).id]));

// 토스트 문장용 이름: 비옷 색은 '청록 비옷'처럼 부른다.
export const itemLabel = (it) => (it.slot === 'coat' ? `${it.name} 비옷` : it.name);

// 받침 유무로 '을/를'을 고른다.
export function objParticle(word) {
  const c = word.charCodeAt(word.length - 1) - 0xac00;
  return c >= 0 && c < 11172 && c % 28 !== 0 ? '을' : '를';
}

// ---------------------------------------------------------------- 저장

const KEY = 'lumen.wardrobe';
const MAX_OWNED = 200;

export class Wardrobe {
  constructor() {
    this.owned = new Set();
    this.wear = { ...DEFAULT_WEAR };
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
    save(KEY, JSON.stringify({ v: 1, owned: [...this.owned], wear: this.wear }));
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
const tmp = new THREE.Vector3();

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
  spawn(world, wardrobe, avoid) {
    this.clear();
    const pool = shuffled(wardrobe.lockedItems);
    const spots = shuffled(world.loot.filter((l) => Math.hypot(l.x - avoid.x, l.z - avoid.z) > 16));
    const placed = [];
    for (const it of pool) {
      if (placed.length >= DROP_COUNT) break;
      const spot = spots.find((s) => placed.every((p) => Math.hypot(p.x - s.x, p.z - s.z) > 14));
      if (!spot) break;
      const a = Math.random() * Math.PI * 2;
      tmp.set(spot.x + Math.cos(a) * 1.3, 0, spot.z + Math.sin(a) * 1.3);
      for (let i = 0; i < 3; i++) world.collide(tmp, 0.55);
      placed.push({ x: tmp.x, z: tmp.z });
      this._add(it, tmp.x, world.heightAt(tmp.x, tmp.z), tmp.z);
    }
    return this.list.length;
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

const PREVIEW_DIR = new THREE.Vector3(1, 0.55, 1).normalize();
// 고른 부위가 잘 보이게 돌려 세울 각도(카메라 방위 π/4 기준). 배낭은 등이 보이게.
const SHOW_YAW = { coat: Math.PI / 4 + 0.5, hat: Math.PI / 4 + 0.35, glasses: Math.PI / 4 + 0.15, pack: Math.PI / 4 + Math.PI - 0.5 };

export class Closet {
  constructor(wardrobe, onChange) {
    this.wardrobe = wardrobe;
    this.onChange = onChange;
    this.tab = 'coat';
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 80);
    this.yaw = Math.PI / 4 + 0.5;
    this.hold = 0;
    this.holdYaw = null;
    this.tabsEl = document.getElementById('closet-tabs');
    this.gridEl = document.getElementById('closet-grid');
    this.countEl = document.getElementById('closet-count');
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
    this.holdYaw = SHOW_YAW[slot];
    this.hold = 2.5;
  }

  open() {
    this.yaw = SHOW_YAW.coat;
    this.hold = 0;
    this.holdYaw = null;
    this.render();
  }

  render() {
    if (!this.ok) return;
    const w = this.wardrobe;
    this.countEl.textContent = `모은 옷가지 ${w.foundCount} / ${w.findableCount}`;
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
      if (owned) b.dataset.id = it.id;
      else b.disabled = true;
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
      note.textContent = owned ? (on ? '입는 중' : '') : '마을에서 찾기';
      b.append(sw, name, note);
      return b;
    }));
  }

  // 미리보기: 천천히 돌다가, 부위를 고르면 그쪽을 잠시 보여 준다. 화면 방향에 맞춰 인물을 패널 반대편에 둔다.
  update(dt, player) {
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
    cam.position.copy(tmp).addScaledVector(PREVIEW_DIR, 20);
    cam.lookAt(tmp);
    cam.updateMatrixWorld();
  }
}
