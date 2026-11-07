import * as THREE from 'three';
import { Builder, Frame, geo, tint } from './geometry.js';
import { Rng } from './rng.js';

// 마을: 5x5 블록, 블록 24m(인도 포함) + 도로 8m = 피치 32m.
export const PITCH = 32;
export const EDGE = 84; // 아스팔트 끝
export const BOUND = 87; // 플레이어 이동 한계
export const LAMP_RADIUS = 5.6; // 켜진 가로등의 안전 반경
export const TRUCK_LAMP_RADIUS = 4.2; // 트럭 짐칸 작업등의 안전 반경
// 배전: 빛 경계에 붙어 버티는 그늘이 하나가 그 구역 부하를 초당 이만큼 올린다. 부하가 1이 되면 차단기가 내려간다.
export const LOAD_PER_SHADE = 0.016;
const LOAD_DECAY = 0.04; // 아무도 누르지 않을 때 초당 빠지는 부하
// 탈 수 있는 트럭을 세워 두는 곳: 은신처 남쪽 도로의 북쪽 차선, 앞이 트인 서쪽을 향해.
export const CAR_SPAWN = { x: 4, z: 13.4, a: -Math.PI / 2 };
const LOT_Y = 0.16;
const ROADS = [-80, -48, -16, 16, 48, 80];

const C = {
  grassOuter: 0x7d8d5b, road: 0x5a6062, line: 0xe4d9bc, crosswalk: 0xe2dfd4,
  sidewalk: 0xbcb8ad, grass: 0x92a066, dirt: 0xa7855c, gravel: 0xa8a292, paving: 0xc3bba9, path: 0xb89f78,
  foundation: 0x8c867b,
  // 읍내 주택: 붉은 벽돌·미색 미장, 함석지붕은 파랑·초록·빨강
  houseWalls: [0xeadfc8, 0xa65a48, 0xd9d4c8, 0xb8684f, 0xe6dcc4, 0x9d5544, 0xc9c2b0, 0xe0cfa8],
  roofs: [0x3f6f9e, 0x4c8a68, 0xa8483a, 0x3d7f86, 0x5d6f95, 0x8d5236],
  shopWalls: [0xd9ccb2, 0xc7b699, 0xb9c6c0, 0xdab9a1, 0xa3b7ab, 0xcfc4b6],
  roofFlat: 0x8a857a, trim: 0xf1ede2, glass: 0x3d4c55, door: 0x4b3a32, wood: 0x8f6c4e, brick: 0x9a5546,
  slab: 0xcfc9bb, tank: [0x3f8a5a, 0x3a6fa8, 0x4f9a7a], jar: 0x6a3f2c, concrete: 0x9b9a92, wire: 0x1f2326,
  center: 0xd8ae3a, paddy: 0x6d8f87, rice: [0x8fb04c, 0x9cc057, 0x84a845],
  pine: [0x56704a, 0x63784a, 0x4b6243, 0x77874c], leaf: [0x6f8b50, 0x8b9b54, 0x5e7c56, 0x9fa25a], trunk: 0x6b4e3a,
  barn: 0xc4c2b8, fence: 0x8e7259, crop: [0x7e9046, 0x8fa04c, 0x6f8a42], hay: 0xd2b46b,
  cars: [0x8f6b5a, 0x6c8791, 0xc8b88e, 0x7c8a69, 0xa45c4c, 0xd9d3c5, 0x5a6b7d], tyre: 0x2b2b2d,
  tower: 0xbdb7a8, metal: 0x6c7377, dark: 0x2f3437, awning: [0xb5554a, 0x4f7a6e, 0xd0a14a, 0x5d6f95],
  bench: 0x7d5e44, water: 0x58777e, pole: 0x3c4245, boxBody: 0x5f7464, sign: 0x2c3236,
};

const TYPES = [
  ['farm', 'houses', 'tower', 'houses', 'farm'],
  ['houses', 'shops', 'pharmacy', 'shops', 'houses'],
  ['park', 'shops', 'home', 'diner', 'park'],
  ['houses', 'houses', 'shops', 'houses', 'houses'],
  ['barn', 'houses', 'park', 'houses', 'farm'],
];

const ZONE_MAP = ['AABCC', 'AABCC', 'DDHEE', 'FFGII', 'FFGII'];
// 배전반에 그리는 3×3 구역 배치(북쪽이 위). 블록 지도 ZONE_MAP을 구역 단위로 줄인 것.
export const ZONE_GRID = ['ABC', 'DHE', 'FGI'];

export const ZONE_NAMES = {
  A: '서북 농장', B: '약국 거리', C: '동북 주택가', D: '서쪽 공원', E: '다이너 거리',
  F: '헛간 들판', G: '남쪽 광장', H: '은신처', I: '동남 주택가',
};

const LOT_COLOR = {
  houses: C.grass, home: C.grass, park: C.grass, farm: C.dirt, barn: C.dirt,
  tower: C.gravel, shops: C.paving, pharmacy: C.paving, diner: C.paving,
};

const WARM = new THREE.Color(1.0, 0.72, 0.42);
const _col = new THREE.Color();
const _mat4 = new THREE.Matrix4();

// 신호 기둥: 위로 갈수록 옅어지는 가산 원통(uv.y 0→1). 배전함과 옷가지 꾸러미가 같은 셰이더를 써서
// 프로그램을 공유한다(시작 때 미리 컴파일되므로 꾸러미가 처음 나타날 때 멈추지 않는다).
export function makeBeaconMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 }, uColor: { value: new THREE.Color(color) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform float uOpacity; uniform vec3 uColor; varying vec2 vUv; void main(){ float a = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 2.2) * uOpacity; gl_FragColor = vec4(uColor, a); }',
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

// 한글 간판. [글귀, 바탕, 글자색]. 약국·다이너는 이야기에 나오는 가게라 따로 고정한다.
const SIGNS = [
  ['약국', '#2f7d5a', '#ffffff'], ['다이너', '#b34d5a', '#fff3e6'],
  ['슈퍼', '#c8372d', '#ffffff'], ['철물점', '#2d5f9a', '#ffffff'], ['세탁소', '#ffffff', '#2d5f9a'],
  ['다방', '#6a3b2a', '#ffe7b8'], ['미용실', '#ffffff', '#c8372d'], ['분식', '#f2c230', '#2a1c10'],
  ['문구사', '#3f8a5a', '#ffffff'], ['정육점', '#ffffff', '#b8241f'], ['식당', '#c8372d', '#fff3c4'],
  ['전파사', '#2d4f7a', '#ffe48a'], ['양품점', '#ffffff', '#3a3a3a'], ['부동산', '#1f6b8a', '#ffffff'],
  ['사진관', '#ffffff', '#1f4f7a'], ['방앗간', '#f0e2c0', '#8a3a1c'], ['이발소', '#ffffff', '#c8372d'],
  ['꽃집', '#f6d7e0', '#a8325a'], ['수선집', '#e9e3d4', '#3a4a5a'], ['반찬가게', '#f2c230', '#3a2a10'],
];
const SIGN_COLS = 2;
const SIGN_ROWS = 16;

// 간판 글귀를 한 장의 캔버스에 모은다. 서버 테스트(Node)처럼 글자를 못 그리는 환경에서는 바탕색만 칠한다.
function makeSignAtlas() {
  const cw = 256, ch = 64;
  const cv = document.createElement('canvas');
  cv.width = cw * SIGN_COLS;
  cv.height = ch * SIGN_ROWS;
  const g = cv.getContext('2d');
  SIGNS.forEach(([text, bg, fg], i) => {
    const x = (i % SIGN_COLS) * cw;
    const y = Math.floor(i / SIGN_COLS) * ch;
    g.fillStyle = bg;
    g.fillRect(x, y, cw, ch);
    if (typeof g.fillText !== 'function') return;
    g.fillStyle = fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const size = text.length > 3 ? 36 : 44;
    g.font = `800 ${size}px "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", "Noto Sans CJK KR", sans-serif`;
    g.fillText(text, x + cw / 2, y + ch / 2 + 2, cw - 24);
  });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function hash(n) {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

export function makePoolTexture() {
  const size = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(150,150,150,1)');
  grd.addColorStop(0.75, 'rgba(40,40,40,1)');
  grd.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 시야를 가리는 충돌체: 건물·차처럼 두께가 있는 상자만(울타리·전봇대·나무 줄기는 손전등 빛이 넘어간다).
export function sightBoxes(colliders) {
  return colliders.filter((c) => c.t === 0 && Math.min(c.x1 - c.x0, c.z1 - c.z0) >= 0.6);
}

// 선분 a→b가 상자 가운데 하나라도 지나는가(손전등·전조등이 벽 너머를 비추지 못하게, #14). 슬랩 방식.
export function segmentBlocked(boxes, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  for (const c of boxes) {
    if (Math.max(ax, bx) < c.x0 || Math.min(ax, bx) > c.x1 || Math.max(az, bz) < c.z0 || Math.min(az, bz) > c.z1) continue;
    let t0 = 0;
    let t1 = 1;
    let hit = true;
    for (const [o, d, lo, hi] of [[ax, dx, c.x0, c.x1], [az, dz, c.z0, c.z1]]) {
      if (Math.abs(d) < 1e-9) {
        if (o < lo || o > hi) { hit = false; break; }
        continue;
      }
      let u = (lo - o) / d;
      let v = (hi - o) / d;
      if (u > v) [u, v] = [v, u];
      t0 = Math.max(t0, u);
      t1 = Math.min(t1, v);
      if (t0 > t1) { hit = false; break; }
    }
    if (hit) return true;
  }
  return false;
}

// 원(반지름 r) vs 정적 충돌체 목록(t: 0 축 정렬 상자, t: 1 원). p를 직접 밀어낸다. 마을과 2~4장 무대가 함께 쓴다.
export function pushOut(colliders, p, r) {
  for (const c of colliders) {
    if (c.t === 0) {
      if (p.x < c.x0 - r || p.x > c.x1 + r || p.z < c.z0 - r || p.z > c.z1 + r) continue;
      const nx = Math.min(Math.max(p.x, c.x0), c.x1);
      const nz = Math.min(Math.max(p.z, c.z0), c.z1);
      const dx = p.x - nx;
      const dz = p.z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        p.x = nx + (dx / d) * r;
        p.z = nz + (dz / d) * r;
      } else {
        const l = p.x - c.x0, rr = c.x1 - p.x, u = p.z - c.z0, dd = c.z1 - p.z;
        const m = Math.min(l, rr, u, dd);
        if (m === l) p.x = c.x0 - r;
        else if (m === rr) p.x = c.x1 + r;
        else if (m === u) p.z = c.z0 - r;
        else p.z = c.z1 + r;
      }
    } else {
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const rr = c.r + r;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr || d2 < 1e-8) continue;
      const d = Math.sqrt(d2);
      p.x = c.x + (dx / d) * rr;
      p.z = c.z + (dz / d) * rr;
    }
  }
}

export class World {
  constructor(scene, { mobile = false } = {}) {
    this.root = new THREE.Group();
    scene.add(this.root);
    this.sb = new Builder();
    this.colliders = [];
    this.lamps = [];
    this.signs = [];
    this.loot = [];
    this.fuseBoxes = [];
    this.night = 0;
    this.zones = {};
    for (const id of Object.keys(ZONE_NAMES)) {
      this.zones[id] = {
        id, name: ZONE_NAMES[id], powered: false, on: true, load: 0, tripped: false,
        level: 0, glow: 0, win: new Builder(), mat: null, seed: hash(id.charCodeAt(0)) * 100,
      };
    }
    this.homeBreaker = null; // 은신처 발전기의 차단기(은신처에는 배전함이 없다)
    // 트럭 짐칸 작업등. 가로등처럼 안전 반경을 만들고, 그늘이가 몰리면 따로 과부하가 걸린다.
    this.truckLamp = { extra: true, x: 0, z: 0, on: false, level: 0, glow: 0, load: 0, r: TRUCK_LAMP_RADIUS };
    this.events = [];
    this.anchors = this._findAnchors();
    // 장식 전용 난수. 마을 생성 난수(rng)의 순서를 바꾸면 뒤질 곳·가로수 자리가 바뀌어
    // 공유 보급품 슬롯 목록(서버와의 약속)과 이야기 기록 자리가 어긋나므로, 새 장식은 모두 이것으로 고른다.
    this.deco = new Rng(1926);
    this.signQuads = {}; // 구역별 간판 글귀 사각형(마감 때 구역마다 메시 하나로 합친다)
    this.homes = []; // 사람이 잠들어 있는 집의 현관(돌려보낸 그림자가 날아가는 곳)
    this.wireSparks = {}; // 구역별 점등 불꽃이 흐를 전선 조각
    const rng = new Rng(20261105);
    this._ground();
    this._roads(rng);
    for (let row = 0; row < 5; row++) for (let col = 0; col < 5; col++) this._block(row, col, rng);
    this._forest(rng);
    this._cars(rng);
    this._utility();
    this._finalize(mobile);
    this.reset(1);
  }

  // ---------------------------------------------------------------- 생성

  _findAnchors() {
    const out = {};
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 5; col++) {
        const id = ZONE_MAP[row][col];
        const d = Math.abs(row - 2) + Math.abs(col - 2);
        if (!out[id] || d < out[id].d) out[id] = { row, col, d };
      }
    }
    return out;
  }

  _ground() {
    const b = this.sb;
    b.add(geo.box(), 0, -0.05, 0, 300, 0.1, 300, C.grassOuter);
    b.add(geo.box(), 0, 0, 0, EDGE * 2, 0.02, EDGE * 2, C.road);
  }

  _roads(rng) {
    const b = this.sb;
    // 중앙선: 교차로 사이마다 노란 두 줄 실선
    const stops = [-EDGE + 1, ...ROADS.flatMap((r) => [r - 6, r + 6]), EDGE - 1].sort((p, q) => p - q);
    for (const rc of ROADS) {
      for (let i = 0; i + 1 < stops.length; i += 2) {
        const a = stops[i], e = stops[i + 1];
        if (e - a < 1) continue;
        const mid = (a + e) / 2, len = e - a;
        for (const o of [-0.14, 0.14]) {
          b.add(geo.box(), rc + o, 0.021, mid, 0.1, 0.02, len, C.center);
          b.add(geo.box(), mid, 0.021, rc + o, len, 0.02, 0.1, C.center);
        }
      }
    }
    for (const rx of ROADS) {
      for (const rz of ROADS) {
        for (const s of [-1, 1]) {
          if (Math.abs(rz + s * 5.3) < 80 && rng.chance(0.55)) {
            for (let i = 0; i < 7; i++) b.add(geo.box(), rx - 3.3 + i * 1.1, 0.02, rz + s * 5.3, 0.55, 0.02, 1.8, C.crosswalk);
          }
          if (Math.abs(rx + s * 5.3) < 80 && rng.chance(0.55)) {
            for (let i = 0; i < 7; i++) b.add(geo.box(), rx + s * 5.3, 0.02, rz - 3.3 + i * 1.1, 1.8, 0.02, 0.55, C.crosswalk);
          }
        }
      }
    }
  }

  _block(row, col, rng) {
    const type = TYPES[row][col];
    const zone = ZONE_MAP[row][col];
    const cx = (col - 2) * PITCH;
    const cz = (row - 2) * PITCH;
    const b = this.sb;
    b.add(geo.box(), cx, 0.07, cz, 24, 0.14, 24, C.sidewalk);
    b.add(geo.box(), cx, 0.15, cz, 20, 0.02, 20, LOT_COLOR[type]);

    const ctx = { cx, cz, zone, rng, row, col, near: Math.abs(row - 2) + Math.abs(col - 2) === 1 };
    const diag = (row + col) % 2 === 0 ? [[1, 1], [-1, -1]] : [[1, -1], [-1, 1]];
    const corners = type === 'home' ? [[1, 1], [1, -1], [-1, 1], [-1, -1]] : diag;
    for (const [sx, sz] of corners) this._lamp(cx + sx * 10.9, cz + sz * 10.9, sx, sz, zone);

    const anchor = this.anchors[zone];
    if (zone !== 'H' && anchor.row === row && anchor.col === col) this._fuseBox(ctx);

    switch (type) {
      case 'houses': this._houses(ctx); break;
      case 'shops': this._shops(ctx, null); break;
      case 'pharmacy': this._shops(ctx, 'pharmacy'); break;
      case 'diner': this._shops(ctx, 'diner'); break;
      case 'park': this._park(ctx); break;
      case 'farm': this._farm(ctx, false); break;
      case 'barn': this._farm(ctx, true); break;
      case 'tower': this._tower(ctx); break;
      case 'home': this._home(ctx); break;
      default: throw new Error(`unknown block type ${type}`);
    }
    this._streetTrees(ctx);
    if (type !== 'farm' && type !== 'barn') this._tufts(ctx, type === 'park' || type === 'houses' || type === 'home' ? 22 : 6);
  }

  _addLoot(x, z, ctx) {
    this.loot.push({ x, z, near: ctx.near, item: 'empty', searched: false });
  }

  _boxCollider(x0, x1, z0, z1) {
    this.colliders.push({ t: 0, x0, x1, z0, z1 });
  }

  _circleCollider(x, z, r) {
    this.colliders.push({ t: 1, x, z, r });
  }

  _lamp(x, z, sx, sz, zone) {
    const b = this.sb;
    const dx = sx * 0.55, dz = sz * 0.55;
    b.add(geo.box(), x, 0.2, z, 0.34, 0.12, 0.34, C.pole);
    b.add(geo.cyl(6), x, 0.14 + 1.85, z, 0.15, 3.7, 0.15, C.pole);
    b.add(geo.box(), x + dx / 2, 3.78, z + dz / 2, 0.08, 0.08, 0.95, C.pole, Math.atan2(sx, sz));
    b.add(geo.box(), x + dx, 3.74, z + dz, 0.46, 0.1, 0.46, C.pole);
    this.lamps.push({ x: x + dx, y: 3.6, z: z + dz, zone });
    this._circleCollider(x, z, 0.22);
  }

  _fuseBox(ctx) {
    const { cx, cz, row, col, zone } = ctx;
    const b = this.sb;
    const dcol = Math.sign(2 - col);
    const drow = Math.sign(2 - row);
    let x, z, a;
    if (dcol !== 0) {
      x = cx + dcol * 11;
      z = cz + 4;
      a = dcol > 0 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      x = cx + 4;
      z = cz + drow * 11;
      a = drow > 0 ? 0 : Math.PI;
    }
    const f = new Frame(x, z, a);
    f.add(b, geo.box(), 0, 0.22, 0, 1.3, 0.16, 0.9, C.foundation);
    f.add(b, geo.box(), 0, 1.0, 0, 1.0, 1.4, 0.6, C.boxBody);
    f.add(b, geo.box(), 0, 1.75, 0, 1.12, 0.1, 0.72, C.metal);
    f.add(b, geo.box(), 0, 1.0, 0.31, 0.72, 1.05, 0.04, C.metal);
    f.add(b, geo.box(), 0, 1.3, 0.34, 0.32, 0.24, 0.02, 0xd8b23a);
    this.fuseBoxes.push({ x, z, zone, ix: f.px(0, 0.9), iz: f.pz(0, 0.9), light: null, beacon: null });
    this.colliders.push(f.aabb(0, 0, 1.0, 0.6, 0.05));
  }

  _windows(f, zone, w, d, floors, y0, fh, spacing, doorX, rng, st) {
    const faces = [[w, d / 2, 0, 1], [w, d / 2, 0, -1], [d, w / 2, 1, 1], [d, w / 2, 1, -1]];
    const winB = this.zones[zone].win;
    for (let fi = 0; fi < 4; fi++) {
      if (st.faces && !st.faces[fi]) continue;
      const [len, off, side, sign] = faces[fi];
      const n = Math.max(1, Math.floor((len - 0.6) / spacing));
      for (let fl = st.firstFloor ?? 0; fl < floors; fl++) {
        for (let i = 0; i < n; i++) {
          const t = (i - (n - 1) / 2) * spacing;
          if (fi === 0 && fl === 0 && Math.abs(t - doorX) < st.doorClear) continue;
          if (st.skip && rng.chance(st.skip)) continue;
          const y = y0 + fl * fh + fh * st.yFrac;
          const o = off + 0.03;
          const lx = side ? sign * o : t;
          const lz = side ? t : sign * o;
          const ry = side ? Math.PI / 2 : 0;
          if (rng.chance(st.lit)) {
            _col.setRGB(1, rng.range(0.8, 1), rng.range(0.6, 0.9));
            f.add(winB, geo.box(), lx, y, lz, st.ww, st.wh, 0.08, _col, ry);
          } else {
            f.add(this.sb, geo.box(), lx, y, lz, st.ww, st.wh, 0.08, C.glass, ry);
          }
          if (st.sill) {
            const so = off + 0.07;
            f.add(this.sb, geo.box(), side ? sign * so : t, y - st.wh / 2 - 0.05, side ? t : sign * so, st.ww + 0.2, 0.08, 0.16, C.trim, ry);
          }
        }
      }
    }
  }

  _house(x, z, a, ctx, o = {}) {
    const { rng, zone } = ctx;
    const b = this.sb;
    const f = new Frame(x, z, a);
    const w = o.w ?? rng.range(4.8, 6.4);
    const d = o.d ?? rng.range(4.4, 5.6);
    const floors = o.floors ?? (rng.chance(0.35) ? 2 : 1);
    const fh = 2.5;
    const y0 = LOT_Y + 0.3;
    const wallH = floors * fh + 0.2;
    const top = y0 + wallH;
    const wall = tint(o.wall ?? rng.pick(C.houseWalls), rng, 0.04);
    const roof = tint(o.roof ?? rng.pick(C.roofs), rng, 0.04);

    f.add(b, geo.box(), 0, LOT_Y + 0.15, 0, w + 0.24, 0.3, d + 0.24, C.foundation);
    f.add(b, geo.box(), 0, y0 + wallH / 2, 0, w, wallH, d, wall);
    f.add(b, geo.box(), 0, top - 0.06, 0, w + 0.08, 0.12, d + 0.08, C.trim);

    // 평지붕 양옥(옥상 난간·물탱크·장독)과 함석 박공지붕을 섞는다. 고르는 건 장식 난수로,
    // 마을 난수는 박공지붕일 때와 똑같이 뽑아 순서를 지킨다.
    const flat = !o.gable && this.deco.chance(0.45);
    const rh = rng.range(1.5, 2.1);
    const chimney = rng.chance(0.45);
    if (flat) {
      this._flatRoof(f, w, d, top, wall);
    } else {
      const hw = d / 2 + 0.45;
      const L = Math.hypot(hw, rh) + 0.1;
      const th = Math.atan2(rh, hw);
      f.add(b, geo.gable(), 0, top + rh / 2, 0, d, rh, w, wall, Math.PI / 2);
      f.add(b, geo.box(), 0, top + rh / 2 + 0.05, hw / 2, w + 0.7, 0.14, L, roof, 0, th);
      f.add(b, geo.box(), 0, top + rh / 2 + 0.05, -hw / 2, w + 0.7, 0.14, L, roof, 0, -th);
      // 함석 골: 지붕 면을 따라 옅은 줄
      for (let k = -2; k <= 2; k++) {
        for (const sgn of [1, -1]) {
          f.add(b, geo.box(), (k * (w + 0.7)) / 5.2, top + rh / 2 + 0.13, (sgn * hw) / 2, 0.06, 0.03, L * 0.98, _col.set(roof).offsetHSL(0, 0, 0.06), 0, sgn * th);
        }
      }
      if (chimney) f.add(b, geo.box(), w * 0.28, top + rh * 0.7, -d * 0.18, 0.55, 1.5, 0.55, C.brick);
    }

    const doorX = o.doorX ?? rng.range(-w * 0.2, w * 0.2);
    f.add(b, geo.box(), doorX, y0 + 1.0, d / 2 + 0.02, 1.15, 2.1, 0.06, C.trim);
    f.add(b, geo.box(), doorX, y0 + 0.95, d / 2 + 0.05, 0.92, 1.9, 0.06, C.door);
    f.add(b, geo.box(), doorX, LOT_Y + 0.17, d / 2 + 0.75, 2.4, 0.18, 1.4, C.wood);
    for (const s of [-1, 1]) f.add(b, geo.box(), doorX + s * 1.05, y0 + 1.1, d / 2 + 1.3, 0.12, 2.2, 0.12, C.trim);
    f.add(b, geo.box(), doorX, y0 + 2.28, d / 2 + 0.8, 2.7, 0.12, 1.65, roof, 0, 0.14);

    this._windows(f, zone, w, d, floors, y0, fh, 1.7, doorX, rng, { ww: 0.85, wh: 1.0, yFrac: 0.55, doorClear: 1.1, lit: o.lit ?? 0.7, sill: true });

    for (const s of [-1, 1]) {
      if (rng.chance(0.7)) f.add(b, geo.ico(), s * (w / 2 - 0.4), LOT_Y + 0.35, d / 2 + 0.55, 0.9, 0.75, 0.8, tint(rng.pick(C.leaf), rng, 0.05));
    }
    this.colliders.push(f.aabb(0, 0, w + 0.24, d + 0.24));
    if (o.loot !== false) this._addLoot(f.px(doorX, d / 2 + 2.0), f.pz(doorX, d / 2 + 2.0), ctx);
    // 은신처(loot: false)는 주인공의 집이라 빼고, 나머지 집 현관 위 창가를 기억해 둔다.
    // nx, nz: 현관 쪽 벽이 바라보는 방향(깨어난 집의 창에 불을 켤 때 쓴다)
    if (o.loot !== false) {
      this.homes.push({
        x: f.px(doorX, d / 2 + 0.3), y: y0 + 2.2, z: f.pz(doorX, d / 2 + 0.3), zone,
        nx: f.px(0, 1) - f.px(0, 0), nz: f.pz(0, 1) - f.pz(0, 0),
      });
    }
    return { f, w, d, doorX, top };
  }

  // 옥상: 슬래브, 낮은 난간, 물탱크(받침 위 원통), 장독 몇 개
  _flatRoof(f, w, d, top, wall) {
    const b = this.sb;
    const dr = this.deco;
    f.add(b, geo.box(), 0, top + 0.08, 0, w + 0.3, 0.16, d + 0.3, C.slab);
    const ph = 0.55;
    f.add(b, geo.box(), 0, top + 0.16 + ph / 2, d / 2 + 0.08, w + 0.3, ph, 0.14, wall);
    f.add(b, geo.box(), 0, top + 0.16 + ph / 2, -d / 2 - 0.08, w + 0.3, ph, 0.14, wall);
    f.add(b, geo.box(), w / 2 + 0.08, top + 0.16 + ph / 2, 0, 0.14, ph, d + 0.3, wall);
    f.add(b, geo.box(), -w / 2 - 0.08, top + 0.16 + ph / 2, 0, 0.14, ph, d + 0.3, wall);
    const tx = dr.pick([-1, 1]) * (w / 2 - 1.0);
    const tz = -d / 2 + 1.0;
    f.add(b, geo.box(), tx, top + 0.45, tz, 1.3, 0.5, 1.3, C.dark);
    f.add(b, geo.cyl(12), tx, top + 1.35, tz, 1.25, 1.3, 1.25, dr.pick(C.tank));
    f.add(b, geo.cyl(12), tx, top + 2.04, tz, 0.5, 0.1, 0.5, 0x2c3a33);
    if (dr.chance(0.6)) {
      for (let i = 0; i < 3; i++) {
        const jx = -tx * 0.5 + (i - 1) * 0.55;
        const jz = d / 2 - 0.9;
        f.add(b, geo.sphere(8, 6), jx, top + 0.42, jz, 0.5, 0.55, 0.5, C.jar);
        f.add(b, geo.cyl(8), jx, top + 0.72, jz, 0.34, 0.06, 0.34, 0x4a2c1f);
      }
    }
  }

  _houses(ctx) {
    const { cx, cz, rng } = ctx;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const px = cx + sx * 5;
      const pz = cz + sz * 5;
      if (rng.chance(0.15)) {
        this._roundTree(px + rng.range(-2, 2), pz + rng.range(-2, 2), rng.range(0.9, 1.2), rng);
        this._pineTree(px + rng.range(-3, 3), pz + rng.range(-3, 3), rng.range(0.8, 1.1), rng);
        continue;
      }
      const faceX = rng.chance(0.5);
      const a = faceX ? (sx > 0 ? Math.PI / 2 : -Math.PI / 2) : (sz > 0 ? 0 : Math.PI);
      this._house(px, pz, a, ctx);
      if (rng.chance(0.6)) {
        const tx = px + (faceX ? -sx * 3.8 : rng.range(-3.5, 3.5));
        const tz = pz + (faceX ? rng.range(-3.5, 3.5) : -sz * 3.8);
        if (rng.chance(0.5)) this._pineTree(tx, tz, rng.range(0.8, 1.15), rng);
        else this._roundTree(tx, tz, rng.range(0.8, 1.1), rng);
      }
    }
  }

  _shop(x, z, a, ctx, o = {}) {
    const { rng, zone } = ctx;
    const b = this.sb;
    const f = new Frame(x, z, a);
    const w = o.w ?? rng.range(11, 15.5);
    const d = o.d ?? rng.range(6.8, 8.2);
    const floors = o.floors ?? rng.int(1, 3);
    const fh = 3.0;
    const y0 = LOT_Y;
    const h = floors * fh + 0.5;
    const top = y0 + h;
    const wall = tint(o.wall ?? rng.pick(C.shopWalls), rng, 0.04);

    f.add(b, geo.box(), 0, y0 + h / 2, 0, w, h, d, wall);
    f.add(b, geo.box(), 0, top + 0.25, d / 2 - 0.12, w, 0.5, 0.24, wall);
    f.add(b, geo.box(), 0, top + 0.25, -d / 2 + 0.12, w, 0.5, 0.24, wall);
    f.add(b, geo.box(), w / 2 - 0.12, top + 0.25, 0, 0.24, 0.5, d, wall);
    f.add(b, geo.box(), -w / 2 + 0.12, top + 0.25, 0, 0.24, 0.5, d, wall);
    f.add(b, geo.box(), 0, top + 0.03, 0, w - 0.4, 0.06, d - 0.4, C.roofFlat);
    f.add(b, geo.box(), 0, top - 0.05, d / 2 + 0.06, w + 0.1, 0.18, 0.14, C.trim);
    const units = rng.int(1, 3);
    for (let k = 0; k < units; k++) {
      const ux = rng.range(-w / 2 + 1.6, w / 2 - 1.6);
      const uz = rng.range(-d / 2 + 1.4, d / 2 - 1.4);
      f.add(b, geo.box(), ux, top + 0.45, uz, 1.3, 0.8, 1.0, C.metal);
      f.add(b, geo.cyl(8), ux + 0.3, top + 1.0, uz, 0.4, 0.3, 0.4, C.dark);
    }
    if (this.deco.chance(0.6)) {
      const tx = this.deco.pick([-1, 1]) * (w / 2 - 1.2);
      f.add(b, geo.box(), tx, top + 0.3, -d / 2 + 1.2, 1.4, 0.3, 1.4, C.dark);
      f.add(b, geo.cyl(12), tx, top + 1.15, -d / 2 + 1.2, 1.35, 1.4, 1.35, this.deco.pick(C.tank));
    }

    const doorX = o.doorX ?? rng.range(-w * 0.22, w * 0.22);
    f.add(b, geo.box(), doorX, y0 + 1.15, d / 2 + 0.03, 1.5, 2.35, 0.06, C.trim);
    f.add(b, geo.box(), doorX, y0 + 1.1, d / 2 + 0.06, 1.25, 2.2, 0.06, C.door);
    const winB = this.zones[zone].win;
    for (const side of [-1, 1]) {
      const edge = side < 0 ? -w / 2 + 0.6 : w / 2 - 0.6;
      const inner = doorX + side * 1.0;
      const len = Math.abs(edge - inner);
      if (len < 1.2) continue;
      const mid = (edge + inner) / 2;
      _col.setRGB(1, rng.range(0.85, 1), rng.range(0.7, 0.9));
      f.add(o.darkFront ? b : winB, geo.box(), mid, y0 + 1.35, d / 2 + 0.04, len, 1.7, 0.08, o.darkFront ? C.glass : _col);
      const panes = Math.max(1, Math.round(len / 1.6));
      for (let p = 0; p <= panes; p++) {
        f.add(b, geo.box(), mid - len / 2 + (len * p) / panes, y0 + 1.35, d / 2 + 0.09, 0.08, 1.8, 0.04, C.trim);
      }
    }
    const aw = o.awning ?? rng.pick(C.awning);
    const awW = Math.min(w - 1, 7.5);
    f.add(b, geo.box(), doorX * 0.4, y0 + 2.78, d / 2 + 0.65, awW, 0.1, 1.4, aw, 0, 0.32);
    for (let s = 0; s < 5; s++) {
      f.add(b, geo.box(), doorX * 0.4 - awW / 2 + awW * (s + 0.5) / 5, y0 + 2.79, d / 2 + 0.65, awW / 10, 0.11, 1.41, C.trim, 0, 0.32);
    }
    // 간판: 바탕판 + 한글 글귀. 바탕판 색은 마을 난수 순서를 지키려 뽑기만 하고 글귀 바탕색을 쓴다.
    const signW = Math.min(w - 2, 5);
    const oldSign = o.signColor ?? tint(rng.pick(C.awning), rng, 0.08);
    const si = o.signText != null ? SIGNS.findIndex((x) => x[0] === o.signText) : 2 + Math.floor(this.deco.next() * (SIGNS.length - 2));
    const sign = SIGNS[si] ? new THREE.Color(SIGNS[si][1]) : oldSign;
    f.add(b, geo.box(), doorX * 0.4, y0 + 3.5, d / 2 + 0.08, signW, 0.9, 0.1, sign);
    if (si >= 0) this._signQuad(zone, f, doorX * 0.4, y0 + 3.5, d / 2 + 0.135, Math.min(signW - 0.2, 3.2), 0.8, si);

    if (floors > 1) {
      this._windows(f, zone, w, d, floors, y0, fh, 1.8, doorX, rng, { ww: 1.1, wh: 1.3, yFrac: 0.5, doorClear: 0, lit: 0.55, firstFloor: 1, skip: 0.1 });
    }
    this._windows(f, zone, w, d, 1, y0, fh, 2.4, doorX, rng, { ww: 0.9, wh: 1.0, yFrac: 0.5, doorClear: 0, lit: 0.35, faces: [false, true, true, true], skip: 0.35 });

    this.colliders.push(f.aabb(0, 0, w, d));
    if (o.loot !== false) this._addLoot(f.px(doorX, d / 2 + 1.7), f.pz(doorX, d / 2 + 1.7), ctx);

    if (o.openSign) {
      const lx = doorX + (doorX > 0 ? -1.9 : 1.9);
      const ly = y0 + 1.75;
      const lz = d / 2 + 0.12;
      const parts = [
        [lx, ly + 0.22, 0.9, 0.07], [lx, ly - 0.22, 0.9, 0.07],
        [lx - 0.45, ly, 0.07, 0.5], [lx + 0.45, ly, 0.07, 0.5], [lx, ly, 0.5, 0.08],
      ].map(([px, py, sx, sy]) => ({ x: f.px(px, lz), y: py, z: f.pz(px, lz), sx, sy, sz: 0.05, ry: f.a }));
      this._neon(zone, parts, o.openSign, { x: f.px(lx, lz + 0.6), y: ly, z: f.pz(lx, lz + 0.6) }, 6);
    }
    return { f, w, d, top, doorX, y0 };
  }

  _shops(ctx, variant) {
    const { cx, cz, rng, zone } = ctx;
    const neonColors = [new THREE.Color(0.2, 0.8, 1.0), new THREE.Color(1.0, 0.3, 0.25), new THREE.Color(1.0, 0.7, 0.2)];
    if (variant === 'pharmacy') {
      const s = this._shop(cx, cz + 4.6, 0, ctx, { w: 13, d: 7.6, floors: 2, wall: 0xe4e6dc, awning: 0x4f8a6e, signColor: 0x6fb28f, doorX: -1.5, signText: '약국' });
      const { f, w, d, y0 } = s;
      const lx = w / 2 - 0.6;
      const ly = y0 + 4.3;
      f.add(this.sb, geo.box(), lx, ly, d / 2 + 0.45, 0.08, 0.08, 0.9, C.dark);
      f.add(this.sb, geo.box(), lx, ly, d / 2 + 1.05, 0.12, 1.25, 1.25, C.sign);
      const lz = d / 2 + 1.05;
      const parts = [
        { x: f.px(lx, lz), y: ly, z: f.pz(lx, lz), sx: 0.2, sy: 0.9, sz: 0.3, ry: f.a },
        { x: f.px(lx, lz), y: ly, z: f.pz(lx, lz), sx: 0.2, sy: 0.3, sz: 0.9, ry: f.a },
      ];
      this._neon(zone, parts, new THREE.Color(0.15, 1.0, 0.45), { x: f.px(lx + 0.8, lz), y: ly - 0.4, z: f.pz(lx + 0.8, lz) }, 22);
    } else if (variant === 'diner') {
      const s = this._shop(cx, cz + 4.6, 0, ctx, { w: 15, d: 7.4, floors: 1, wall: 0xe8dcc4, awning: 0xb34d5a, signColor: 0xc96a76, doorX: 2.5, signText: '다이너' });
      const { f, w, d, top } = s;
      const pink = new THREE.Color(1.0, 0.28, 0.55);
      this._neon(zone, [{ x: f.px(0, d / 2 + 0.16), y: top - 0.3, z: f.pz(0, d / 2 + 0.16), sx: w - 0.4, sy: 0.08, sz: 0.06, ry: f.a }], pink, { x: f.px(-3, d / 2 + 1.2), y: top - 0.6, z: f.pz(-3, d / 2 + 1.2) }, 10);
      const px = -w / 2 - 1.4;
      const pz = d / 2 + 1.0;
      f.add(this.sb, geo.cyl(6), px, 2.9, pz, 0.22, 5.6, 0.22, C.dark);
      f.add(this.sb, geo.box(), px, 5.6, pz, 2.8, 1.4, 0.24, 0x5b2f36);
      const parts = [];
      for (const side of [-1, 1]) {
        const zz = pz + side * 0.15;
        parts.push(
          { x: f.px(px, zz), y: 6.3, z: f.pz(px, zz), sx: 2.8, sy: 0.08, sz: 0.06, ry: f.a },
          { x: f.px(px, zz), y: 4.9, z: f.pz(px, zz), sx: 2.8, sy: 0.08, sz: 0.06, ry: f.a },
          { x: f.px(px - 1.4, zz), y: 5.6, z: f.pz(px - 1.4, zz), sx: 0.08, sy: 1.4, sz: 0.06, ry: f.a },
          { x: f.px(px + 1.4, zz), y: 5.6, z: f.pz(px + 1.4, zz), sx: 0.08, sy: 1.4, sz: 0.06, ry: f.a },
          { x: f.px(px, zz), y: 5.78, z: f.pz(px, zz), sx: 1.8, sy: 0.14, sz: 0.06, ry: f.a },
          { x: f.px(px - 0.3, zz), y: 5.42, z: f.pz(px - 0.3, zz), sx: 1.2, sy: 0.1, sz: 0.06, ry: f.a },
        );
      }
      this._neon(zone, parts, pink, { x: f.px(px, pz + 1), y: 5.2, z: f.pz(px, pz + 1) }, 18);
      this._circleCollider(f.px(px, pz), f.pz(px, pz), 0.3);
    } else {
      this._shop(cx, cz + 4.6, 0, ctx, { openSign: rng.chance(0.6) ? rng.pick(neonColors) : null });
    }
    // 북쪽 절반: 뒤를 보는 상점 (카메라에서는 뒷면이 보인다)
    this._shop(cx, cz - 4.8, Math.PI, ctx, { d: rng.range(6.5, 7.6), openSign: null, darkFront: rng.chance(0.4) });
    if (rng.chance(0.7)) this._roundTree(cx + rng.pick([-8.6, 8.6]), cz - 0.2, 0.75, rng);
    if (variant === null && rng.chance(0.5)) this._addLoot(cx + rng.range(-6, 6), cz - 0.1, ctx);
  }

  // 간판 글귀 사각형(정면 +z). 마감 때 구역마다 메시 하나로 합쳐, 그 구역에 불이 들어오면 밤에 빛난다.
  _signQuad(zone, f, lx, ly, lz, w, h, idx) {
    const u0 = (idx % SIGN_COLS) / SIGN_COLS;
    const v1 = 1 - Math.floor(idx / SIGN_COLS) / SIGN_ROWS;
    const u1 = u0 + 1 / SIGN_COLS;
    const v0 = v1 - 1 / SIGN_ROWS;
    const pts = [[-w / 2, -h / 2, u0, v0], [w / 2, -h / 2, u1, v0], [w / 2, h / 2, u1, v1], [-w / 2, h / 2, u0, v1]];
    const q = pts.map(([x, y, u, v]) => ({ x: f.px(lx + x, lz), y: ly + y, z: f.pz(lx + x, lz), u, v }));
    (this.signQuads[zone] ??= []).push({ q, nx: Math.sin(f.a), nz: Math.cos(f.a) });
  }

  _neon(zone, parts, color, light, power) {
    const nb = new Builder();
    for (const p of parts) nb.add(geo.box(), p.x, p.y, p.z, p.sx, p.sy, p.sz, 0xffffff, p.ry ?? 0);
    const mat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const mesh = new THREE.Mesh(nb.build(), mat);
    this.root.add(mesh);
    this.signs.push({ mat, color, zone, x: light.x, y: light.y, z: light.z, power, fire: false, flick: 0, seed: hash(this.signs.length + 3) * 50, level: 0 });
  }

  _pineTree(x, z, s, rng, y = LOT_Y) {
    const b = this.sb;
    const col = tint(rng.pick(C.pine), rng, 0.05);
    b.add(geo.cyl(5), x, y + 0.4 * s, z, 0.24 * s, 0.8 * s, 0.24 * s, C.trunk);
    if (rng.chance(0.5)) {
      b.add(geo.cone(7), x, y + 0.6 * s + 1.9 * s, z, 1.7 * s, 3.8 * s, 1.7 * s, col);
    } else {
      for (let k = 0; k < 3; k++) {
        const r = (2.0 - k * 0.5) * s;
        b.add(geo.cone(7), x, y + 0.7 * s + k * 0.85 * s + 0.75 * s, z, r, 1.6 * s, r, col, k * 0.4);
      }
    }
    this._circleCollider(x, z, 0.3 * s);
  }

  _roundTree(x, z, s, rng, y = LOT_Y) {
    const b = this.sb;
    const col = tint(rng.pick(C.leaf), rng, 0.05);
    b.add(geo.cyl(5), x, y + 0.6 * s, z, 0.26 * s, 1.2 * s, 0.26 * s, C.trunk);
    b.add(geo.ico(0), x, y + 1.9 * s, z, 2.1 * s, 1.9 * s, 2.1 * s, col, rng.range(0, 3));
    if (rng.chance(0.5)) b.add(geo.ico(0), x + 0.5 * s, y + 2.5 * s, z - 0.3 * s, 1.3 * s, 1.2 * s, 1.3 * s, col, rng.range(0, 3));
    this._circleCollider(x, z, 0.3 * s);
  }

  _streetTrees(ctx) {
    const { cx, cz, rng } = ctx;
    const sides = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    for (const [sx, sz] of sides) {
      if (!rng.chance(0.45)) continue;
      const t = rng.pick([-6, 6]) + rng.range(-1, 1);
      const x = sx ? cx + sx * 11 : cx + t;
      const z = sz ? cz + sz * 11 : cz + t;
      if (this.fuseBoxes.some((f) => Math.hypot(f.x - x, f.z - z) < 2.6)) continue;
      this.sb.add(geo.box(), x, 0.145, z, 1.1, 0.02, 1.1, 0x6e5a48);
      this._roundTree(x, z, rng.range(0.6, 0.8), rng, 0.14);
    }
  }

  _tufts(ctx, count) {
    const { cx, cz, rng } = ctx;
    for (let i = 0; i < count; i++) {
      const x = cx + rng.range(-9.5, 9.5);
      const z = cz + rng.range(-9.5, 9.5);
      const c = tint(rng.pick(C.pine), rng, 0.06);
      this.sb.add(geo.cone(3), x, LOT_Y + 0.18, z, 0.35, 0.36, 0.35, c, rng.range(0, 3));
    }
  }

  _fence(x0, z0, x1, z1, collide = true) {
    const b = this.sb;
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 0.5) return;
    const n = Math.max(1, Math.round(len / 1.3));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      b.add(geo.box(), x0 + (x1 - x0) * t, LOT_Y + 0.45, z0 + (z1 - z0) * t, 0.11, 0.9, 0.11, C.fence);
    }
    const ry = Math.atan2(x1 - x0, z1 - z0);
    for (const hy of [0.45, 0.75]) b.add(geo.box(), (x0 + x1) / 2, LOT_Y + hy, (z0 + z1) / 2, 0.06, 0.08, len, C.fence, ry);
    if (collide) this._boxCollider(Math.min(x0, x1) - 0.08, Math.max(x0, x1) + 0.08, Math.min(z0, z1) - 0.08, Math.max(z0, z1) + 0.08);
  }

  // 사각 울타리, 각 변 가운데에 폭 3m 출입구
  _fenceRing(cx, cz, r) {
    const g = 1.5;
    this._fence(cx - r, cz - r, cx - g, cz - r); this._fence(cx + g, cz - r, cx + r, cz - r);
    this._fence(cx - r, cz + r, cx - g, cz + r); this._fence(cx + g, cz + r, cx + r, cz + r);
    this._fence(cx - r, cz - r, cx - r, cz - g); this._fence(cx - r, cz + g, cx - r, cz + r);
    this._fence(cx + r, cz - r, cx + r, cz - g); this._fence(cx + r, cz + g, cx + r, cz + r);
  }

  _bench(x, z, ry) {
    const f = new Frame(x, z, ry);
    const b = this.sb;
    f.add(b, geo.box(), 0, LOT_Y + 0.45, 0, 1.8, 0.1, 0.5, C.bench);
    f.add(b, geo.box(), 0, LOT_Y + 0.75, -0.22, 1.8, 0.4, 0.08, C.bench);
    for (const s of [-0.75, 0.75]) f.add(b, geo.box(), s, LOT_Y + 0.22, 0, 0.1, 0.44, 0.45, C.dark);
    this.colliders.push(f.aabb(0, 0, 1.8, 0.5));
  }

  _park(ctx) {
    const { cx, cz, rng } = ctx;
    const b = this.sb;
    b.add(geo.box(), cx, LOT_Y + 0.012, cz, 20, 0.02, 1.8, C.path);
    b.add(geo.box(), cx, LOT_Y + 0.012, cz, 1.8, 0.02, 20, C.path);
    const q = rng.pick([[1, 1], [-1, 1], [1, -1], [-1, -1]]);
    const px = cx + q[0] * 5.4;
    const pz = cz + q[1] * 5.4;
    b.add(geo.cyl(20), px, LOT_Y + 0.02, pz, 6.6, 0.05, 5.2, C.water);
    for (let i = 0; i < 9; i++) {
      const an = (i / 9) * Math.PI * 2;
      b.add(geo.ico(0), px + Math.cos(an) * 3.4, LOT_Y + 0.12, pz + Math.sin(an) * 2.7, 0.7, 0.35, 0.6, 0x9d9a8e, an);
    }
    this._circleCollider(px, pz, 2.7);
    // 가운데 조각상
    b.add(geo.box(), cx, LOT_Y + 0.5, cz, 1.3, 1.0, 1.3, 0xb7b2a6);
    b.add(geo.cyl(6, 0.3), cx, LOT_Y + 1.6, cz, 0.6, 1.2, 0.6, 0x7f8f88);
    b.add(geo.ico(0), cx, LOT_Y + 2.4, cz, 0.55, 0.55, 0.55, 0x7f8f88);
    this._circleCollider(cx, cz, 0.85);

    for (let i = 0; i < 16; i++) {
      const tx = cx + rng.range(-9, 9);
      const tz = cz + rng.range(-9, 9);
      if (Math.abs(tx - cx) < 1.8 || Math.abs(tz - cz) < 1.8) continue;
      if (Math.hypot(tx - px, tz - pz) < 4.4) continue;
      if (rng.chance(0.45)) this._pineTree(tx, tz, rng.range(0.7, 1.1), rng);
      else this._roundTree(tx, tz, rng.range(0.7, 1.15), rng);
    }
    this._bench(cx + 3.6, cz + 1.5, Math.PI);
    this._bench(cx - 1.5, cz - 4.2, -Math.PI / 2);
    const binX = cx - 1.4;
    const binZ = cz + 3.0;
    b.add(geo.cyl(8), binX, LOT_Y + 0.45, binZ, 0.6, 0.9, 0.6, 0x55605a);
    this._circleCollider(binX, binZ, 0.35);
    this._addLoot(cx + 3.6, cz + 0.6, ctx);
    if (rng.chance(0.6)) this._addLoot(binX - 0.8, binZ, ctx);
  }

  _farm(ctx, withBarn) {
    const { cx, cz, rng } = ctx;
    const b = this.sb;
    this._fenceRing(cx, cz, 9.6);
    const z0 = withBarn ? 1.6 : -8.2;
    // 헛간 없는 농장은 물 댄 논(벼), 헛간 농장은 밭. 마을 난수 순서는 그대로 두고 색만 바꾼다.
    const paddy = !withBarn;
    if (paddy) b.add(geo.box(), cx, LOT_Y + 0.04, cz, 18.6, 0.06, 18.6, C.paddy);
    for (let z = z0; z <= 8.3; z += 1.25) {
      if (!paddy) b.add(geo.box(), cx, LOT_Y + 0.05, cz + z, 17.5, 0.1, 0.55, 0x8f7050);
      for (let x = -8.4; x <= 8.4; x += 0.9) {
        if (Math.abs(x) < 1.4) continue;
        const c = tint(rng.pick(paddy ? C.rice : C.crop), rng, 0.05);
        // 마을 난수는 원래 호출 순서(흔들림 → 키 → 방향) 그대로 뽑는다.
        const jx = rng.range(-0.1, 0.1);
        const hgt = rng.range(0.5, 0.75);
        const rot = rng.range(0, 3);
        b.add(geo.cone(5), cx + x + jx, LOT_Y + (paddy ? 0.3 : 0.38), cz + z, paddy ? 0.3 : 0.42, paddy ? hgt * 0.8 : hgt, paddy ? 0.3 : 0.42, c, rot);
      }
    }
    // 논두렁: 가운데 통로 양옆 흙둑
    if (paddy) for (const s of [-1, 1]) b.add(geo.box(), cx + s * 1.05, LOT_Y + 0.1, cz, 0.5, 0.14, 18.6, 0x8f7a58);
    if (withBarn) {
      const f = new Frame(cx - 2.5, cz - 4.2, 0);
      const w = 10, d = 7.2, h = 5.0, top = LOT_Y + h;
      f.add(b, geo.box(), 0, LOT_Y + h / 2, 0, w, h, d, C.barn);
      const rh = 3.0, hw = d / 2 + 0.5, L = Math.hypot(hw, rh) + 0.1, th = Math.atan2(rh, hw);
      f.add(b, geo.gable(), 0, top + rh / 2, 0, d, rh, w, C.barn, Math.PI / 2);
      f.add(b, geo.box(), 0, top + rh / 2 + 0.06, hw / 2, w + 0.6, 0.16, L, 0x3f6f9e, 0, th);
      f.add(b, geo.box(), 0, top + rh / 2 + 0.06, -hw / 2, w + 0.6, 0.16, L, 0x3f6f9e, 0, -th);
      f.add(b, geo.box(), 0, LOT_Y + 1.6, d / 2 + 0.04, 3.4, 3.2, 0.08, 0xefe8da);
      f.add(b, geo.box(), 0, LOT_Y + 1.6, d / 2 + 0.07, 3.0, 2.9, 0.06, 0x7c3a2d);
      f.add(b, geo.box(), 0, LOT_Y + 1.6, d / 2 + 0.1, 0.16, 3.9, 0.04, 0xefe8da, 0, 0, 0.83);
      f.add(b, geo.box(), 0, LOT_Y + 1.6, d / 2 + 0.1, 0.16, 3.9, 0.04, 0xefe8da, 0, 0, -0.83);
      f.add(b, geo.box(), 0, top + 1.0, d / 2 + 0.06, 1.4, 1.0, 0.06, 0xefe8da);
      this._windows(f, ctx.zone, w, d, 1, LOT_Y, h, 2.6, 0, rng, { ww: 1.0, wh: 1.0, yFrac: 0.62, doorClear: 2.2, lit: 0.6, faces: [true, false, true, true] });
      this.colliders.push(f.aabb(0, 0, w, d));
      this._addLoot(f.px(0, d / 2 + 1.4), f.pz(0, d / 2 + 1.4), ctx);
      // 사일로
      const sx = cx + 6.0, sz = cz - 5.0;
      b.add(geo.cyl(12), sx, LOT_Y + 3.6, sz, 3.0, 7.2, 3.0, 0xc9c1b0);
      b.add(geo.sphere(12, 6), sx, LOT_Y + 7.2, sz, 3.0, 2.2, 3.0, 0x8a8f8c);
      for (const k of [1.6, 3.6, 5.6]) b.add(geo.cyl(12), sx, LOT_Y + k, sz, 3.08, 0.12, 3.08, 0x9a9384);
      this._circleCollider(sx, sz, 1.6);
    }
    // 건초 더미, 상자
    const bales = rng.int(2, 3);
    for (let i = 0; i < bales; i++) {
      const hx = cx + rng.pick([-7.5, 7.5]) + rng.range(-0.5, 0.5);
      const hz = cz + (withBarn ? rng.range(2, 8) : rng.range(-8, 8));
      b.add(geo.cyl(10), hx, LOT_Y + 0.6, hz, 1.2, 1.1, 1.2, C.hay, 0, 0, Math.PI / 2);
      this._circleCollider(hx, hz, 0.65);
    }
    const crX = cx + 1.0 + rng.range(-0.2, 0.2);
    const crZ = cz + (withBarn ? 0.4 : rng.range(-6, 6));
    b.add(geo.box(), crX, LOT_Y + 0.4, crZ, 0.85, 0.8, 0.85, C.wood, 0.3);
    b.add(geo.box(), crX, LOT_Y + 0.4, crZ, 0.9, 0.12, 0.9, 0x6e543d, 0.3);
    this._circleCollider(crX, crZ, 0.5);
    this._addLoot(crX - 0.9, crZ, ctx);
    // 허수아비
    if (!withBarn) {
      const sx = cx - 4.5, sz = cz + rng.range(-5, 5);
      b.add(geo.box(), sx, LOT_Y + 1.0, sz, 0.1, 2.0, 0.1, C.wood);
      b.add(geo.box(), sx, LOT_Y + 1.5, sz, 1.4, 0.08, 0.08, C.wood);
      b.add(geo.box(), sx, LOT_Y + 1.35, sz, 0.55, 0.7, 0.3, 0x7d6a92);
      b.add(geo.cone(7), sx, LOT_Y + 2.1, sz, 0.8, 0.4, 0.8, C.hay);
    }
  }

  _tower(ctx) {
    const { cx, cz, rng } = ctx;
    const b = this.sb;
    const tx = cx + 2.5, tz = cz - 2.0;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      b.add(geo.cyl(6), tx + sx * 1.4, LOT_Y + 3.6, tz + sz * 1.4, 0.22, 7.2, 0.22, C.metal);
      this._circleCollider(tx + sx * 1.4, tz + sz * 1.4, 0.2);
    }
    for (const y of [2.4, 4.8]) {
      b.add(geo.box(), tx, LOT_Y + y, tz - 1.4, 2.8, 0.1, 0.1, C.metal);
      b.add(geo.box(), tx, LOT_Y + y, tz + 1.4, 2.8, 0.1, 0.1, C.metal);
      b.add(geo.box(), tx - 1.4, LOT_Y + y, tz, 0.1, 0.1, 2.8, C.metal);
      b.add(geo.box(), tx + 1.4, LOT_Y + y, tz, 0.1, 0.1, 2.8, C.metal);
    }
    b.add(geo.cyl(14), tx, LOT_Y + 8.4, tz, 4.4, 2.6, 4.4, C.tower);
    b.add(geo.cyl(14), tx, LOT_Y + 7.15, tz, 4.6, 0.12, 4.6, 0x8aa497);
    b.add(geo.cone(14), tx, LOT_Y + 10.25, tz, 4.7, 1.1, 4.7, 0x8aa497);
    b.add(geo.box(), tx + 2.25, LOT_Y + 4.5, tz, 0.08, 6.0, 0.4, C.metal);
    // 창고
    const f = new Frame(cx - 5.5, cz + 4.5, 0);
    const w = 4.6, d = 3.6, h = 2.6;
    f.add(b, geo.box(), 0, LOT_Y + h / 2, 0, w, h, d, 0xb9b39e);
    const rh = 1.2, hw = d / 2 + 0.3, L = Math.hypot(hw, rh) + 0.1, th = Math.atan2(rh, hw);
    f.add(b, geo.gable(), 0, LOT_Y + h + rh / 2, 0, d, rh, w, 0xb9b39e, Math.PI / 2);
    f.add(b, geo.box(), 0, LOT_Y + h + rh / 2 + 0.05, hw / 2, w + 0.5, 0.12, L, C.metal, 0, th);
    f.add(b, geo.box(), 0, LOT_Y + h + rh / 2 + 0.05, -hw / 2, w + 0.5, 0.12, L, C.metal, 0, -th);
    f.add(b, geo.box(), 0, LOT_Y + 1.0, d / 2 + 0.04, 1.6, 2.0, 0.06, 0x6b6358);
    this.colliders.push(f.aabb(0, 0, w, d));
    this._addLoot(f.px(0, d / 2 + 1.3), f.pz(0, d / 2 + 1.3), ctx);
    for (let i = 0; i < 5; i++) {
      const x = cx + rng.range(-9, 9), z = cz + rng.range(-9, 9);
      if (Math.hypot(x - tx, z - tz) < 4 || Math.hypot(x - (cx - 5.5), z - (cz + 4.5)) < 4) continue;
      this._pineTree(x, z, rng.range(0.8, 1.1), rng);
    }
    this._fence(cx - 9.6, cz - 9.6, cx + 9.6, cz - 9.6);
    this._fence(cx - 9.6, cz - 9.6, cx - 9.6, cz + 2);
  }

  _home(ctx) {
    const { cx, cz, rng } = ctx;
    const b = this.sb;
    this._house(cx, cz - 2.5, 0, ctx, { w: 7.2, d: 5.6, floors: 1, wall: 0xe9d6b4, roof: 0x3f6f9e, doorX: 0, lit: 1, loot: false, gable: true });
    // 정원, 장작, 발전기, 모닥불
    for (const s of [-1, 1]) {
      b.add(geo.box(), cx + s * 6.5, LOT_Y + 0.15, cz - 3, 2.6, 0.3, 4.6, 0x7a5a42);
      for (let i = 0; i < 6; i++) {
        b.add(geo.ico(0), cx + s * 6.5 + rng.range(-0.9, 0.9), LOT_Y + 0.5, cz - 3 + rng.range(-1.9, 1.9), 0.5, 0.45, 0.5, tint(rng.pick(C.crop), rng, 0.06));
      }
      this._boxCollider(cx + s * 6.5 - 1.3, cx + s * 6.5 + 1.3, cz - 5.3, cz - 0.7);
    }
    const gx = cx + 7.5, gz = cz + 5.5;
    b.add(geo.box(), gx, LOT_Y + 0.5, gz, 1.6, 1.0, 1.0, 0x6d7a5c);
    b.add(geo.cyl(8), gx + 0.5, LOT_Y + 1.25, gz, 0.2, 0.6, 0.2, C.dark);
    this._boxCollider(gx - 0.85, gx + 0.85, gz - 0.55, gz + 0.55);
    this.homeBreaker = { x: gx, z: gz, zone: 'H', ix: gx, iz: gz + 1.25, home: true };
    this._neon('H', [{ x: gx - 0.4, y: LOT_Y + 1.05, z: gz + 0.51, sx: 0.12, sy: 0.12, sz: 0.04 }], new THREE.Color(0.3, 1.0, 0.4), { x: gx, y: 1.6, z: gz + 0.8 }, 3);
    const fx = cx - 4.2, fz = cz + 4.8;
    for (let i = 0; i < 7; i++) {
      const an = (i / 7) * Math.PI * 2;
      b.add(geo.ico(0), fx + Math.cos(an) * 0.75, LOT_Y + 0.12, fz + Math.sin(an) * 0.75, 0.38, 0.26, 0.38, 0x8c887e, an);
    }
    for (let i = 0; i < 3; i++) b.add(geo.box(), fx, LOT_Y + 0.15, fz, 1.1, 0.14, 0.18, 0x5a4232, (i * Math.PI) / 3);
    this._circleCollider(fx, fz, 0.8);
    const fire = new Builder();
    fire.add(geo.cone(5), fx, LOT_Y + 0.55, fz, 0.6, 0.8, 0.6, 0xffffff);
    fire.add(geo.cone(5), fx + 0.15, LOT_Y + 0.45, fz + 0.1, 0.4, 0.55, 0.4, 0xffffff, 1);
    const fireMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    this.root.add(new THREE.Mesh(fire.build(), fireMat));
    this.signs.push({ mat: fireMat, color: new THREE.Color(1.0, 0.45, 0.12), zone: 'H', x: fx, y: 1.3, z: fz, power: 16, fire: true, flick: 0, seed: 7, level: 0 });
    this._bench(fx + 2.3, fz + 0.2, -Math.PI / 2);
    for (let i = 0; i < 3; i++) b.add(geo.cyl(7), cx + 4.6, LOT_Y + 0.22 + i * 0.4, cz + 1.3 + (i % 2) * 0.2, 0.36, 1.4, 0.36, 0x7a5a40, 0, Math.PI / 2);
    this._boxCollider(cx + 3.8, cx + 5.4, cz + 1.0, cz + 1.8);
    this._pineTree(cx - 8, cz + 8, 1.0, rng);
    this._roundTree(cx + 8.2, cz - 8.2, 1.1, rng);
    this._addLoot(cx + 5.6, cz + 2.4, ctx);
  }

  _forest(rng) {
    let placed = 0;
    let guard = 0;
    while (placed < 560 && guard++ < 5000) {
      const x = rng.range(-118, 118);
      const z = rng.range(-118, 118);
      if (Math.max(Math.abs(x), Math.abs(z)) < 89) continue;
      const s = rng.range(0.9, 1.5);
      if (rng.chance(0.75)) this._pineTree(x, z, s, rng, 0);
      else this._roundTree(x, z, s, rng, 0);
      placed++;
    }
    for (let i = 0; i < 260; i++) {
      const x = rng.range(-100, 100);
      const z = rng.range(-100, 100);
      if (Math.max(Math.abs(x), Math.abs(z)) < 85) continue;
      this.sb.add(geo.cone(3), x, 0.18, z, 0.4, 0.4, 0.4, tint(rng.pick(C.pine), rng, 0.06), rng.range(0, 3));
    }
  }

  _cars(rng) {
    const b = this.sb;
    let made = 0;
    let guard = 0;
    while (made < 16 && guard++ < 200) {
      const rc = rng.pick(ROADS.slice(1, 5));
      const vertical = rng.chance(0.5);
      const t = rng.range(-76, 76);
      if (ROADS.some((r) => Math.abs(t - r) < 8)) continue;
      const lane = rng.pick([-2.2, 2.2, -3.0, 3.0]);
      const x = vertical ? rc + lane : t;
      const z = vertical ? t : rc + lane;
      if (this.colliders.some((c) => c.car && Math.abs((c.x0 + c.x1) / 2 - x) < 6 && Math.abs((c.z0 + c.z1) / 2 - z) < 6)) continue;
      const a = (vertical ? 0 : Math.PI / 2) + (rng.chance(0.5) ? Math.PI : 0) + rng.range(-0.08, 0.08);
      const f = new Frame(x, z, a);
      const body = tint(rng.pick(C.cars), rng, 0.04);
      f.add(b, geo.box(), 0, 0.62, 0, 1.8, 0.66, 3.9, body);
      f.add(b, geo.box(), 0, 1.22, -0.25, 1.6, 0.58, 2.0, C.glass);
      f.add(b, geo.box(), 0, 1.53, -0.25, 1.62, 0.06, 1.9, body);
      f.add(b, geo.box(), 0, 0.62, 1.96, 1.6, 0.18, 0.04, 0xd8d0b8);
      for (const [wx, wz] of [[-0.9, 1.25], [0.9, 1.25], [-0.9, -1.25], [0.9, -1.25]]) {
        f.add(b, geo.cyl(8), wx, 0.35, wz, 0.7, 0.26, 0.7, C.tyre, 0, 0, Math.PI / 2);
      }
      const box = f.aabb(0, 0, 1.8, 3.9, 0.05);
      box.car = true;
      this.colliders.push(box);
      if (rng.chance(0.55)) this._addLoot(f.px(0, -2.6), f.pz(0, -2.6), { near: false });
      made++;
    }
  }

  // 전봇대와 전선: 안쪽 도로마다 한쪽 인도(블록 변 가운데)에 전봇대를 세우고 전선을 잇는다.
  // 장식 난수만 쓰고, 충돌체는 보급품 슬롯(인도 중심선에서 ±1.5m 간격)에서 1m 넘게 떨어진 자리에만 둔다.
  _utility() {
    const b = this.sb;
    const dr = this.deco;
    const centers = [-64, -32, 0, 32, 64];
    const HV = 7.15; // 고압선 높이
    const lines = [];
    for (const rc of ROADS.slice(1, 5)) {
      const off = rc + 4.6;
      lines.push(centers.map((t) => ({ x: off, z: t, along: 'z' })));
      lines.push(centers.map((t) => ({ x: t, z: off, along: 'x' })));
    }
    const zoneOf = (x, z) => this.zoneAt(x, z);
    for (const poles of lines) {
      for (const P of poles) {
        const across = P.along === 'z' ? [1, 0] : [0, 1];
        b.add(geo.cyl(8, 0.36), P.x, 3.8, P.z, 0.3, 7.6, 0.3, C.concrete);
        b.add(geo.cyl(8), P.x, 1.0, P.z, 0.33, 0.7, 0.33, 0xd6b03a); // 노란 전주 표지
        b.add(geo.box(), P.x, HV - 0.12, P.z, across[0] ? 1.8 : 0.12, 0.12, across[1] ? 1.8 : 0.12, 0x4a4e50);
        for (const k of [-0.75, 0, 0.75]) b.add(geo.cyl(6), P.x + across[0] * k, HV - 0.02, P.z + across[1] * k, 0.1, 0.18, 0.1, 0xd8d4c8);
        if (dr.chance(0.45)) {
          const tx = P.x + across[0] * 0.38, tz = P.z + across[1] * 0.38;
          b.add(geo.cyl(10), tx, 5.55, tz, 0.55, 0.9, 0.55, 0x8c9294); // 변압기
          b.add(geo.cyl(10), tx, 6.05, tz, 0.6, 0.1, 0.6, 0x6c7274);
        }
        this.colliders.push({ t: 1, x: P.x, z: P.z, r: 0.17, pole: true });
      }
      for (let i = 0; i + 1 < poles.length; i++) {
        const A = poles[i], B = poles[i + 1];
        const across = A.along === 'z' ? [1, 0] : [0, 1];
        // 고압선 세 가닥(불꽃이 흐르는 선)과 아래쪽 통신선 두 가닥
        for (const [k, y0, sag, spark] of [[-0.75, HV, 0.9, true], [0, HV, 0.9, true], [0.75, HV, 0.9, true], [-0.2, 5.3, 0.6, false], [0.15, 5.05, 0.7, false]]) {
          const ax = A.x + across[0] * k, az = A.z + across[1] * k;
          const bx = B.x + across[0] * k, bz = B.z + across[1] * k;
          this._wire(ax, az, bx, bz, y0, sag, spark ? (t) => zoneOf(t < 0.5 ? A.x : B.x, t < 0.5 ? A.z : B.z) : null);
        }
      }
    }
  }

  // 처지는 전선 한 가닥: 포물선을 8토막 상자로. spark(t)가 있으면 토막마다 그 구역 불꽃 조각에도 넣는다.
  _wire(ax, az, bx, bz, y, sag, spark) {
    const n = 8;
    const P = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      P.push([ax + (bx - ax) * t, y - 4 * sag * t * (1 - t), az + (bz - az) * t]);
    }
    for (let i = 0; i < n; i++) {
      const [x0, y0, z0] = P[i];
      const [x1, y1, z1] = P[i + 1];
      const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
      const h = Math.hypot(dx, dz);
      const len = Math.hypot(h, dy);
      const ry = Math.atan2(dx, dz);
      const rx = Math.atan2(-dy, h);
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, mz = (z0 + z1) / 2;
      this.sb.add(geo.box(), mx, my, mz, 0.05, 0.05, len + 0.02, C.wire, ry, rx);
      if (spark) {
        const zid = spark((i + 0.5) / n);
        if (zid) (this.wireSparks[zid] ??= new Builder()).add(geo.box(), mx, my, mz, 0.11, 0.11, len + 0.02, 0xffffff, ry, rx);
      }
    }
  }

  _finalize(mobile) {
    const staticMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92, metalness: 0 });
    this.staticMat = staticMat;
    const mesh = new THREE.Mesh(this.sb.build(), staticMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.root.add(mesh);
    this.sb = null;

    for (const z of Object.values(this.zones)) {
      if (z.win.count === 0) continue;
      const mat = new THREE.MeshStandardMaterial({
        color: C.glass, vertexColors: true, flatShading: true, roughness: 0.3, metalness: 0.1,
        emissive: WARM, emissiveIntensity: 0,
      });
      mat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= vColor.rgb;',
        );
      };
      z.mat = mat;
      const wm = new THREE.Mesh(z.win.build(), mat);
      wm.receiveShadow = true;
      wm.frustumCulled = false;
      this.root.add(wm);
      z.win = null;
    }

    // 간판: 구역마다 글귀 사각형을 메시 하나로. 낮엔 색이 보이고, 불 들어온 구역은 밤에 뒤에서 켠 것처럼 빛난다.
    const atlas = makeSignAtlas();
    for (const [zid, quads] of Object.entries(this.signQuads)) {
      const pos = [], nor = [], uv = [], idx = [];
      for (const { q, nx, nz } of quads) {
        const base = pos.length / 3;
        for (const v of q) {
          pos.push(v.x, v.y, v.z);
          nor.push(nx, 0, nz);
          uv.push(v.u, v.v);
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      const mat = new THREE.MeshStandardMaterial({ map: atlas, emissiveMap: atlas, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.55 });
      const mesh = new THREE.Mesh(g, mat);
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      this.root.add(mesh);
      this.zones[zid].signMat = mat;
    }
    this.signQuads = null;

    // 전선 불꽃: 구역에 불이 들어오는 순간 배전함에서 전선을 따라 퍼져 나가는 빛. 구역마다 따로 그린다.
    for (const [zid, sb] of Object.entries(this.wireSparks)) {
      const z = this.zones[zid];
      const origin = this.breakerOf(zid) ?? { x: 0, z: 0 };
      const mat = new THREE.ShaderMaterial({
        uniforms: { uT: { value: 0 }, uA: { value: 0 }, uO: { value: new THREE.Vector2(origin.x, origin.z) } },
        vertexShader: 'uniform vec2 uO; varying float vD; void main(){ vD = distance(position.xz, uO); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform float uT; uniform float uA; varying float vD; void main(){ float k = (vD - uT) / 3.0; float a = exp(-k * k) * uA; gl_FragColor = vec4(vec3(1.0, 0.86, 0.55) * 3.2, a); }',
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(sb.build(), mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 5;
      mesh.visible = false;
      this.root.add(mesh);
      z.spark = { mesh, mat };
      z.pulse = -1;
    }
    this.wireSparks = null;

    // 가로등 머리와 바닥 빛 웅덩이 (인스턴싱)
    const n = this.lamps.length;
    this.heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.36, 0.1, 0.36), new THREE.MeshBasicMaterial({ color: 0xffffff }), n);
    const poolMat = new THREE.MeshBasicMaterial({ map: makePoolTexture(), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
    const poolGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.pools = new THREE.InstancedMesh(poolGeo, poolMat, n + 1); // 마지막 칸은 트럭 작업등
    this.pools.renderOrder = 2;
    const size = LAMP_RADIUS * 2.3;
    for (let i = 0; i < n; i++) {
      const L = this.lamps[i];
      _mat4.makeTranslation(L.x, L.y, L.z);
      this.heads.setMatrixAt(i, _mat4);
      this.heads.setColorAt(i, _col.setRGB(0, 0, 0));
      _mat4.makeScale(size, 1, size).setPosition(L.x, 0.2, L.z);
      this.pools.setMatrixAt(i, _mat4);
      this.pools.setColorAt(i, _col.setRGB(0, 0, 0));
    }
    this.pools.setMatrixAt(n, _mat4.makeScale(0, 1, 0));
    this.pools.setColorAt(n, _col.setRGB(0, 0, 0));
    this.heads.frustumCulled = false;
    this.pools.frustumCulled = false;
    this.root.add(this.heads, this.pools);

    // 배전함 상태등과 신호 기둥
    const lightGeo = new THREE.SphereGeometry(0.11, 8, 6);
    const beaconGeo = new THREE.CylinderGeometry(0.3, 0.3, 18, 12, 1, true).translate(0, 9, 0);
    this.beaconMat = makeBeaconMaterial(new THREE.Color(1.0, 0.35, 0.25));
    for (const fb of this.fuseBoxes) {
      fb.light = new THREE.Mesh(lightGeo, new THREE.MeshBasicMaterial({ color: 0xff0000 }));
      fb.light.position.set(fb.x, 1.92, fb.z);
      fb.beacon = new THREE.Mesh(beaconGeo, this.beaconMat);
      fb.beacon.position.set(fb.x, 1.9, fb.z);
      fb.beacon.renderOrder = 3;
      this.root.add(fb.light, fb.beacon);
    }

    // 수색 가능 지점 반짝임
    const ln = this.loot.length;
    const lp = new Float32Array(ln * 3);
    const seeds = new Float32Array(ln);
    for (let i = 0; i < ln; i++) {
      const l = this.loot[i];
      lp[i * 3] = l.x;
      lp[i * 3 + 1] = this.heightAt(l.x, l.z) + 0.75;
      lp[i * 3 + 2] = l.z;
      seeds[i] = hash(i + 0.5) * 10;
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.BufferAttribute(lp, 3));
    gg.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    this.glintOn = new THREE.BufferAttribute(new Float32Array(ln).fill(1), 1);
    gg.setAttribute('aOn', this.glintOn);
    // 깨어난 주민이 촛불로 알려 준 퓨즈 자리는 금빛으로 크게 반짝인다.
    this.glintHint = new THREE.BufferAttribute(new Float32Array(ln), 1);
    gg.setAttribute('aHint', this.glintHint);
    this.glintMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPx: { value: 30 }, uNight: { value: 0 } },
      vertexShader: `
        attribute float aSeed; attribute float aOn; attribute float aHint;
        varying float vH;
        uniform float uTime; uniform float uPx;
        varying float vA;
        void main(){
          vec3 p = position; p.y += sin(uTime * 2.0 + aSeed) * 0.08;
          float tw = 0.65 + 0.35 * sin(uTime * 3.1 + aSeed * 2.3);
          vA = aOn * tw;
          vH = aHint;
          gl_PointSize = aOn * uPx * 0.9 * (0.8 + 0.2 * tw) * (1.0 + aHint * 0.7);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `
        uniform float uNight; varying float vA; varying float vH;
        void main(){
          vec2 q = gl_PointCoord - 0.5;
          float core = exp(-dot(q, q) * 90.0);
          float rays = max(0.0, 1.0 - abs(q.x) * 14.0) * max(0.0, 1.0 - abs(q.y) * 2.2)
                     + max(0.0, 1.0 - abs(q.y) * 14.0) * max(0.0, 1.0 - abs(q.x) * 2.2);
          float a = (core + rays * 0.6) * vA;
          gl_FragColor = vec4(mix(vec3(1.0, 0.9, 0.65), vec3(1.0, 0.62, 0.2), vH) * mix(1.4, 2.6, uNight) * (1.0 + vH * 0.4), a);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.glints = new THREE.Points(gg, this.glintMat);
    this.glints.frustumCulled = false;
    this.glints.renderOrder = 4;
    this.root.add(this.glints);

    // 근처 광원만 실제 PointLight로 비춘다. 개수가 바뀌면 셰이더가 재컴파일되므로 항상 고정 개수 유지.
    this.pool = [];
    const count = mobile ? 4 : 6;
    for (let i = 0; i < count; i++) {
      const pl = new THREE.PointLight(0xffffff, 0, 12, 1.6);
      this.pool.push(pl);
      this.root.add(pl);
    }
    this.cands = [
      ...this.lamps.map((L) => ({ kind: 0, ref: L, x: L.x, y: L.y - 0.2, z: L.z, color: WARM, i: 0, d: 0 })),
      ...this.signs.map((S) => ({ kind: 1, ref: S, x: S.x, y: S.y, z: S.z, color: S.color, i: 0, d: 0 })),
      { kind: 2, ref: this.truckLamp, x: 0, y: 5.2, z: 0, color: new THREE.Color(1.0, 0.86, 0.66), i: 0, d: 0 },
    ];
    this.active = [];
  }

  // ---------------------------------------------------------------- 상태

  reset(seed) {
    for (const z of Object.values(this.zones)) {
      z.powered = z.id === 'H';
      z.on = true;
      z.load = 0;
      z.tripped = false;
      z.level = z.powered ? 1 : 0;
      z.glow = z.level;
      z.pulse = -1;
    }
    Object.assign(this.truckLamp, { on: false, level: 0, glow: 0, load: 0 });
    this.events.length = 0;
    const rng = new Rng(seed * 7919 + 13);
    const n = this.loot.length;
    const items = [];
    const add = (k, c) => { for (let i = 0; i < c; i++) items.push(k); };
    add('fuse', 11);
    add('battery', 13);
    add('bandage', 8);
    add('fuel', 7);
    while (items.length < n) items.push('empty');
    items.length = n;
    rng.shuffle(items);
    for (let i = 0; i < n; i++) {
      this.loot[i].item = items[i];
      this.loot[i].searched = false;
      this.loot[i].hinted = false;
      this.glintOn.array[i] = 1;
      this.glintHint.array[i] = 0;
    }
    // 은신처 옆 블록에 퓨즈가 하나는 있도록 보장
    const near = this.loot.filter((l) => l.near);
    if (near.length && !near.some((l) => l.item === 'fuse')) {
      const donor = this.loot.find((l) => !l.near && l.item === 'fuse');
      const tgt = rng.pick(near);
      if (donor) [donor.item, tgt.item] = [tgt.item, donor.item];
    }
    this.glintOn.needsUpdate = true;
    this.glintHint.needsUpdate = true;
  }

  // 돌려보낸 그림자가 찾아갈 집: 가장 가까운 집 현관 창가
  nearestHome(x, z) {
    let best = null;
    let bd = Infinity;
    for (const h of this.homes) {
      const d = (h.x - x) ** 2 + (h.z - z) ** 2;
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }

  // 촛불 단서를 둘 숨은 퓨즈: 단서가 가장 적게 놓인 구역을 먼저 고르고, 그 안에서 (x, z)에 가장 가까운 것.
  // 한곳에서만 버텨도 단서가 그 주변에 몰리지 않고 마을에 고르게 퍼진다(#28).
  hiddenFuseSpread(x, z) {
    const hints = {};
    for (const l of this.loot) if (l.hinted) hints[this.zoneAt(l.x, l.z)] = (hints[this.zoneAt(l.x, l.z)] ?? 0) + 1;
    let best = null;
    let bs = Infinity;
    for (const l of this.loot) {
      if (l.item !== 'fuse' || l.searched || l.hinted) continue;
      const score = (hints[this.zoneAt(l.x, l.z)] ?? 0) * 1e6 + (l.x - x) ** 2 + (l.z - z) ** 2;
      if (score < bs) { bs = score; best = l; }
    }
    return best;
  }

  hintLoot(loot) {
    const i = this.loot.indexOf(loot);
    if (i < 0) return;
    loot.hinted = true;
    this.glintHint.array[i] = 1;
    this.glintHint.needsUpdate = true;
  }

  get totalZones() {
    return Object.keys(this.zones).length;
  }

  get poweredZones() {
    return Object.values(this.zones).filter((z) => z.powered).length;
  }

  // ---------------------------------------------------------------- 배전
  // 은신처는 자체 발전기로 늘 켜져 있고 변전소 출력(capacity)을 쓰지 않는다. 나머지 구역은 배전함을 고친 뒤에도
  // 변전소 출력만큼만 동시에 켤 수 있다. 출력은 배전함을 셋 고칠 때마다 하나씩 오르고, 여덟 곳을 다 고치면
  // 변전소가 정상 출력으로 돌아와 마을 전체가 켜진다(승리).

  get repairedCount() {
    let n = 0;
    for (const z of Object.values(this.zones)) if (z.id !== 'H' && z.powered) n++;
    return n;
  }

  // 다 고치면 변전소가 제 출력을 되찾아 한도가 없어진다(승리 뒤 산책에서도 껐다 켤 수 있게).
  get capacity() {
    const r = this.repairedCount;
    return r >= this.totalZones - 1 ? r : 2 + Math.floor(r / 3);
  }

  get onCount() {
    let n = 0;
    for (const z of Object.values(this.zones)) if (z.id !== 'H' && z.powered && z.on) n++;
    return n;
  }

  get trippedCount() {
    let n = 0;
    for (const z of Object.values(this.zones)) if (z.powered && z.tripped) n++;
    return n;
  }

  // 배전함을 고친다. 출력이 남으면 바로 켜고, 모자라면 꺼 둔 채로 고쳐 둔다. { on }을 돌려준다.
  powerZone(id) {
    const z = this.zones[id];
    if (!z || z.powered) return null;
    z.on = false;
    z.powered = true;
    z.load = 0;
    z.tripped = false;
    z.on = this.onCount < this.capacity;
    if (z.on) z.pulse = 0;
    return { on: z.on };
  }

  // 마지막 배전함을 고치면 변전소가 정상 출력을 되찾아 출력 한도와 상관없이 모든 구역을 켠다.
  restoreAll() {
    for (const z of Object.values(this.zones)) {
      if (!z.powered) continue;
      if (!z.on || z.tripped) z.pulse = 0;
      z.on = true;
      z.tripped = false;
      z.load = 0;
    }
  }

  // 배전반 스위치. 켜려는데 출력이 모자라면 false.
  setSwitch(id, on) {
    const z = this.zones[id];
    if (!z || !z.powered || z.id === 'H') return false;
    if (on === z.on) return true;
    if (on && this.onCount >= this.capacity) return false;
    // 부하와 차단 상태는 그대로 둔다. 껐다 켜는 것으로 차단기를 원격으로 올리거나 부하를 비울 수 없게.
    z.on = on;
    if (on && !z.tripped) z.pulse = 0;
    return true;
  }

  // 빛 경계에 붙은 그늘이가 그 빛의 부하를 올린다. lit은 lightAt의 결과.
  addLoad(lit, amount) {
    const src = lit.L.extra ? lit.L : this.zones[lit.L.zone];
    if (!src || src.tripped) return;
    src.load += amount;
    if (src.load < 1) return;
    src.load = 0;
    if (lit.L.extra) {
      src.on = false;
      this.events.push({ type: 'truckTrip' });
    } else {
      src.tripped = true;
      this.events.push({ type: 'trip', zone: src.id });
    }
  }

  resetBreaker(id) {
    const z = this.zones[id];
    if (!z || !z.tripped) return false;
    z.tripped = false;
    z.load = 0.35; // 올리자마자 다시 내려가지 않게 조금 여유를 둔다
    if (z.on) z.pulse = 0;
    return true;
  }

  // 새벽: 내려간 차단기는 마을 관리 회로가 다시 올리고 부하도 비운다. 다시 올린 구역 수를 돌려준다.
  dawnReset() {
    let n = 0;
    for (const z of Object.values(this.zones)) {
      if (z.tripped) n++;
      z.tripped = false;
      z.load = 0;
    }
    this.truckLamp.load = 0;
    return n;
  }

  takeEvents() {
    if (!this.events.length) return null;
    const out = this.events.slice();
    this.events.length = 0;
    return out;
  }

  // 트럭 작업등 위치·상태를 매 프레임 넘겨받는다.
  setTruckLamp(x, z, on) {
    const L = this.truckLamp;
    L.x = x;
    L.z = z;
    if (on && !L.on) L.load = 0;
    L.on = on;
  }

  breakerOf(id) {
    return id === 'H' ? this.homeBreaker : this.fuseBoxes.find((f) => f.zone === id) ?? null;
  }

  // 블록 좌표로 구역을 찾는다(도로 위는 가장 가까운 블록). 마을 밖이면 null.
  zoneAt(x, z) {
    const col = Math.round(x / PITCH) + 2;
    const row = Math.round(z / PITCH) + 2;
    if (col < 0 || col > 4 || row < 0 || row > 4) return null;
    return ZONE_MAP[row][col];
  }

  // 플레이어 근처에서 켜져 있는(또는 차단된) 빛 가운데 가장 부하가 신경 쓰이는 것: HUD 부하 막대용.
  nearbyLoad(x, z, reach) {
    let best = null;
    const r2 = (LAMP_RADIUS + reach) ** 2;
    for (const L of this.lamps) {
      const zn = this.zones[L.zone];
      if (!zn.powered || !zn.on) continue;
      if ((L.x - x) ** 2 + (L.z - z) ** 2 > r2) continue;
      if (!best || zn.tripped || zn.load > best.load) best = zn;
      if (zn.tripped) break;
    }
    const T = this.truckLamp;
    if (T.on && (T.x - x) ** 2 + (T.z - z) ** 2 < (T.r + reach) ** 2 && (!best || (!best.tripped && T.load > best.load))) {
      return { name: '트럭 작업등', load: T.load, tripped: false };
    }
    return best ? { name: best.name, load: best.load, tripped: best.tripped } : null;
  }

  markSearched(loot) {
    loot.searched = true;
    const i = this.loot.indexOf(loot);
    if (i >= 0) {
      this.glintOn.array[i] = 0;
      this.glintOn.needsUpdate = true;
    }
  }

  nearestDeadBox(x, z) {
    let best = null;
    let bd = Infinity;
    for (const f of this.fuseBoxes) {
      if (this.zones[f.zone].powered) continue;
      const d = Math.hypot(f.x - x, f.z - z);
      if (d < bd) { bd = d; best = f; }
    }
    return best ? { box: best, dist: bd } : null;
  }

  nearestInteractable(x, z, r) {
    let best = null;
    let bd = r * r;
    for (const l of this.loot) {
      if (l.searched) continue;
      const d = (l.x - x) ** 2 + (l.z - z) ** 2;
      if (d < bd) { bd = d; best = { kind: 'loot', ref: l }; }
    }
    for (const f of this.fuseBoxes) {
      const zn = this.zones[f.zone];
      if (zn.powered && !zn.tripped) continue;
      const d = (f.ix - x) ** 2 + (f.iz - z) ** 2;
      if (d < bd * 1.4) { bd = d; best = { kind: zn.powered ? 'breaker' : 'fuse', ref: f }; }
    }
    const hb = this.homeBreaker;
    if (hb && this.zones.H.tripped) {
      const d = (hb.ix - x) ** 2 + (hb.iz - z) ** 2;
      if (d < bd * 1.4) { bd = d; best = { kind: 'breaker', ref: hb }; }
    }
    return best;
  }

  heightAt(x, z) {
    const bx = Math.round(x / PITCH);
    const bz = Math.round(z / PITCH);
    if (Math.abs(bx) > 2 || Math.abs(bz) > 2) return 0.01;
    const lx = Math.abs(x - bx * PITCH);
    const lz = Math.abs(z - bz * PITCH);
    if (lx < 10 && lz < 10) return LOT_Y;
    if (lx < 12 && lz < 12) return 0.14;
    return 0.01;
  }

  // 원(플레이어) vs 정적 충돌체. p를 직접 밀어낸다.
  collide(p, r) {
    pushOut(this.colliders, p, r);
    p.x = Math.min(Math.max(p.x, -BOUND), BOUND);
    p.z = Math.min(Math.max(p.z, -BOUND), BOUND);
  }

  // 그늘이가 깨어날 수 있는 곳(마을 이동 한계 안)
  inBounds(x, z) {
    return Math.abs(x) <= BOUND && Math.abs(z) <= BOUND;
  }

  // a에서 b가 건물에 가려 보이지 않는가(손전등이 벽 너머를 태우지 않게)
  blocksSight(ax, az, bx, bz) {
    this._sight ??= sightBoxes(this.colliders);
    return segmentBlocked(this._sight, ax, az, bx, bz);
  }

  // 켜진 가로등(또는 트럭 작업등) 불빛 안인지. 안이면 빛의 중심·거리·안전 반경을 돌려준다.
  // 깜박임(glow)이 아니라 켜진 정도(level)로 판단해, 과부하로 깜박이는 동안 경계가 흔들리지 않게 한다.
  lightAt(x, z) {
    if (this.night < 0.3) return null;
    for (const L of this.lamps) {
      if (this.zones[L.zone].level < 0.5) continue;
      const dx = x - L.x;
      const dz = z - L.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < LAMP_RADIUS * LAMP_RADIUS) return { L, dx, dz, d: Math.sqrt(d2), r: LAMP_RADIUS };
    }
    const T = this.truckLamp;
    if (T.level >= 0.5) {
      const dx = x - T.x;
      const dz = z - T.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < T.r * T.r) return { L: T, dx, dz, d: Math.sqrt(d2), r: T.r };
    }
    return null;
  }

  // ---------------------------------------------------------------- 프레임 갱신

  update(dt, t, night, focus, pxPerUnit) {
    this.night = night;
    for (const z of Object.values(this.zones)) {
      const lit = z.powered && z.on && !z.tripped;
      if (lit && z.level < 1) z.level = Math.min(1, z.level + dt / 1.8);
      else if (!lit && z.level > 0) z.level = Math.max(0, z.level - dt / (z.tripped ? 0.5 : 0.9));
      z.load = Math.max(0, z.load - dt * LOAD_DECAY);
      let flick = z.level > 0 && z.level < 1 ? (hash(Math.floor(t * 16) + z.seed) > 0.45 ? 1 : 0.12) : 1;
      // 과부하가 걸리면 부하가 클수록 자주 깜박인다(차단기가 내려가기 전 경고).
      if (lit && z.load > 0.5 && hash(Math.floor(t * 14) + z.seed * 3.1) < (z.load - 0.5) * 1.1) flick *= 0.3;
      z.glow = z.level * flick;
      if (z.mat) z.mat.emissiveIntensity = 1.25 * night * z.glow;
      if (z.signMat) z.signMat.emissiveIntensity = 0.06 + 1.5 * night * z.glow;
      if (z.spark) {
        const on = z.pulse >= 0 && z.pulse < 3.2;
        z.spark.mesh.visible = on;
        if (on) {
          z.pulse += dt;
          z.spark.mat.uniforms.uT.value = z.pulse * 26;
          z.spark.mat.uniforms.uA.value = Math.min(1, z.pulse * 4) * Math.min(1, (3.2 - z.pulse) * 1.5);
        } else if (z.pulse >= 3.2) {
          z.pulse = -1;
        }
      }
    }
    const T = this.truckLamp;
    T.load = Math.max(0, T.load - dt * LOAD_DECAY);
    T.level = T.on ? Math.min(1, T.level + dt / 0.35) : Math.max(0, T.level - dt / 0.35);
    const tg = T.level * night * (T.load > 0.5 && hash(Math.floor(t * 14) + 91) < (T.load - 0.5) * 1.1 ? 0.3 : 1);
    T.glow = tg;
    const tn = this.lamps.length;
    const ts = T.level > 0 ? T.r * 2.3 : 0;
    // 웅덩이 행렬은 트럭 작업등 칸만 움직인다. 바뀐 때만 그 한 칸만 올린다(#21).
    const pk = this._poolKey ??= { s: -1, x: 0, z: 0 };
    if (ts !== pk.s || (ts > 0 && (T.x !== pk.x || T.z !== pk.z))) {
      Object.assign(pk, { s: ts, x: T.x, z: T.z });
      this.pools.setMatrixAt(tn, _mat4.makeScale(ts, 1, ts).setPosition(T.x, 0.2, T.z));
      const im = this.pools.instanceMatrix;
      im.clearUpdateRanges();
      im.addUpdateRange(tn * 16, 16);
      im.needsUpdate = true;
    }
    this.pools.setColorAt(tn, _col.setRGB(1.0, 0.82, 0.6).multiplyScalar(tg * 0.42));

    for (let i = 0; i < this.lamps.length; i++) {
      const g = this.zones[this.lamps[i].zone].glow * night;
      const base = 0.45 * (1 - night) + 0.04;
      this.heads.setColorAt(i, _col.setRGB(base + g * 7.0, base + g * 5.4, base * 0.95 + g * 3.2));
      this.pools.setColorAt(i, _col.setRGB(1.0, 0.76, 0.46).multiplyScalar(g * 0.42));
    }
    this.heads.instanceColor.needsUpdate = true;
    this.pools.instanceColor.needsUpdate = true;

    for (const s of this.signs) {
      let k = s.fire ? 1 : this.zones[s.zone].glow;
      if (s.fire) {
        k *= 0.78 + 0.22 * Math.sin(t * 11 + s.seed) * Math.sin(t * 7.3 + s.seed * 2);
      } else if (k > 0) {
        s.flick -= dt;
        if (s.flick < -2 - hash(Math.floor(t) + s.seed) * 6) s.flick = 0.25;
        if (s.flick > 0 && hash(Math.floor(t * 30) + s.seed) > 0.5) k *= 0.15;
      }
      s.level = k * (0.3 + 0.7 * night);
      s.mat.color.copy(s.color).multiplyScalar(0.22 + s.level * (s.fire ? 4.5 : 3.6));
    }

    const blink = Math.sin(t * 5) > 0 ? 1 : 0.15;
    for (const fb of this.fuseBoxes) {
      const zn = this.zones[fb.zone];
      const on = zn.powered;
      // 상태등: 미복구 빨강 깜박임, 차단됨 주황 깜박임, 켜짐 초록, 꺼 둠 어두운 초록
      if (!on) fb.light.material.color.setRGB(3.0 * blink, 0.2 * blink, 0.15 * blink);
      else if (zn.tripped) fb.light.material.color.setRGB(3.2 * blink, 1.5 * blink, 0.1 * blink);
      else if (zn.on) fb.light.material.color.setRGB(0.3, 2.6, 0.5);
      else fb.light.material.color.setRGB(0.08, 0.5, 0.12);
      fb.beacon.visible = !on;
    }
    this.beaconMat.uniforms.uOpacity.value = (0.05 + 0.4 * night) * (0.75 + 0.25 * Math.sin(t * 2.2));

    this.glintMat.uniforms.uTime.value = t;
    this.glintMat.uniforms.uPx.value = pxPerUnit;
    this.glintMat.uniforms.uNight.value = night;

    this._updateLights(focus, night);
  }

  _updateLights(focus, night) {
    const act = this.active;
    act.length = 0;
    if (night > 0.02) {
      for (const c of this.cands) {
        if (c.kind === 2) {
          c.x = c.ref.x;
          c.z = c.ref.z;
        }
        const g = c.kind === 0 ? this.zones[c.ref.zone].glow * night * 40 : c.kind === 2 ? c.ref.glow * 18 : c.ref.level * c.ref.power;
        if (g < 0.05) continue;
        c.i = g;
        c.d = (c.x - focus.x) ** 2 + (c.z - focus.z) ** 2;
        act.push(c);
      }
      act.sort((a, b) => a.d - b.d);
    }
    for (let i = 0; i < this.pool.length; i++) {
      const pl = this.pool[i];
      const c = act[i];
      if (!c) {
        pl.intensity = 0;
        continue;
      }
      pl.position.set(c.x, c.y, c.z);
      pl.color.copy(c.color);
      pl.intensity = c.i;
    }
  }

  setWetness(w) {
    this.staticMat.roughness = 0.92 - 0.42 * w;
  }
}
