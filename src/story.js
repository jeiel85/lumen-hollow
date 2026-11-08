import * as THREE from 'three';
import { Builder, Frame, geo, tint } from './geometry.js';
import { makeBeaconMaterial } from './world.js';
import { SLOT_COUNT, blockedSlots, slotPos } from './slots.js';
import { Rng } from './rng.js';
import { load, save, remove } from './storage.js';
import { SCENES, CLUES } from './script.js';

// 이야기 진행: 어떤 무전 장면을 봤고 어떤 기록을 주웠는지 이 브라우저에 남기고(판이 끝나도 이어진다),
// 마을에 기록 소품·표식을 놓고, 숲 너머 호수와 등대 풍경을 만든다. 대본은 script.js, 화면은 dialogue.js.

const KEY = 'lumen.story';
const VERSION = 1; // 저장 형식: { v: 1, seen: [장면 id], found: [기록 id] }. 바꾸면 DECISIONS.md도 고친다.

const SCENE_BY_ID = new Map(SCENES.map((s) => [s.id, s]));
const CLUE_BY_ID = new Map(CLUES.map((c) => [c.id, c]));
const UNLOCKED_BY = new Map();
for (const s of SCENES) for (const id of s.unlocks ?? []) UNLOCKED_BY.set(id, s.id);

// 수첩에 남는 글(급수탑처럼 장면으로 보는 곳은 빼고)
export const DOCS = CLUES.filter((c) => !c.scene);

// 몇 장의 장면·기록인지(script.js의 ch, 빠지면 1장)
export const chapterOf = (item) => item.ch ?? 1;

export function sceneById(id) {
  return SCENE_BY_ID.get(id) ?? null;
}

export function clueById(id) {
  return CLUE_BY_ID.get(id) ?? null;
}

// 숲 너머 북서쪽(화면 위쪽) 호수. 마을 이동 한계(±87)와 숲(±118) 밖이라 1장에서는 장면에서만 보이고,
// 2장(src/chapters.js)에서 선착장과 섬을 걷는다. ISLAND는 섬의 걸을 수 있는 반경, PIER는 섬 부두가 뻗는 방향(남동, 마을 쪽).
export const LAKE = { x: -162, z: -162, r: 34 };
export const ISLAND = { r: 9.2, pier: 13.6, top: 0.5 };
const LANTERN_Y = 10.2;
const SHORE = 0x7d8d5b;
const PINES = [0x56704a, 0x63784a, 0x4b6243, 0x77874c];
const READ_R = 1.8;

// 기록이 놓이는 곳. 마을은 고정 시드로 만들어지지만 가로수·가로등·뒤질 곳이 블록마다 달라서,
// 후보 [x, z, 정면 각도] 가운데 충돌체·뒤질 곳·배전함과 겹치지 않는 첫 자리를 쓴다.
// 정면(+z가 0)은 카메라 쪽(+x, +z)을 보게 해서 소품의 글 쪽이 보이게 한다.
// 인도 쪽 후보는 공유 보급품 슬롯(블록 중심에서 11m 줄, 3m 간격) 사이, 줄보다 안쪽에 둔다.
const PLACES = {
  log: [[2.5, 1.2, 0], [2.9, 1.5, 0], [-2.6, 1.3, 0]], // 은신처 현관 오른쪽
  notice: [[2.9, 54.9, 0], [-2.9, 54.9, 0], [3.0, 55.3, 0], [-3.0, 55.3, 0]], // 남쪽 광장(공원) 북쪽 입구
  diner: [[29.0, 9.3, 0], [32.0, 9.3, 0], [38.0, 9.3, 0]], // 골목식당 앞
  chart: [[-6.0, -22.7, 0], [-3.0, -22.7, 0], [3.0, -22.7, 0]], // 약국 앞
  diary: [[29.0, -54.7, 0], [32.0, -54.7, 0], [35.0, -54.7, 0], [41.3, -61.0, Math.PI / 2], [41.3, -67.0, Math.PI / 2], [26.0, -54.7, 0]], // 동북 주택가 남쪽 길가
  letter: [[29.0, 41.3, 0], [35.0, 41.3, 0], [32.0, 41.3, 0], [41.3, 29.0, Math.PI / 2], [41.3, 35.0, Math.PI / 2], [38.0, 41.3, 0]], // 동남 주택가 길가
  order: [[-69.9, 64.6, 0], [-60.3, 64.8, 0], [-70.8, 63.9, 0], [-58.5, 63.6, 0]], // 헛간 앞마당
};
// 소품 충돌체가 빈 보급품 슬롯을 새로 막지 않게 하는 거리. slots.js는 충돌체에서 1m 안의 슬롯을 막고,
// 가장 큰 소품(게시판)의 반 대각선이 1m 남짓이다. 슬롯 목록은 서버와 맞춰야 하는 약속이라 바뀌면 안 된다.
const SLOT_CLEAR = 2.1;
// 남쪽 광장 공원 동상(블록 중심)과 약국 거리 급수탑 사다리. world.js의 _park·_tower와 같은 자리다.
const STATUE = { x: 0, z: 64 };
const LADDER = { x: 4.75, z: -66 };

function loadProgress() {
  let raw = null;
  try {
    raw = JSON.parse(load(KEY));
  } catch {
    raw = null; // 손상된 기록은 처음부터
  }
  const seen = new Set();
  const found = new Set();
  if (raw && typeof raw === 'object' && raw.v === VERSION) {
    if (Array.isArray(raw.seen)) for (const id of raw.seen) if (SCENE_BY_ID.has(id)) seen.add(id);
    if (Array.isArray(raw.found)) for (const id of raw.found) if (CLUE_BY_ID.has(id)) found.add(id);
  }
  return { seen, found };
}

export class Story {
  constructor(scene, world) {
    this.world = world;
    this.root = new THREE.Group();
    scene.add(this.root);
    ({ seen: this.seen, found: this.found } = loadProgress());
    this.spots = [];
    // 소품을 놓기 전(마을 충돌체만 있을 때)의 빈 보급품 슬롯
    const blocked = new Set(blockedSlots(world));
    this.slotSpots = [];
    for (let id = 0; id < SLOT_COUNT; id++) if (!blocked.has(id)) this.slotSpots.push(slotPos(id));
    this.lit = false;
    this.lightLevel = 0;

    const b = new Builder();
    for (const clue of CLUES) if (chapterOf(clue) === 1) this._place(b, clue);
    this._lake(b);
    const mesh = new THREE.Mesh(b.build(), world.staticMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.root.add(mesh);
    this._markers();
    this.refresh();
  }

  // ---------------------------------------------------------------- 진행 상태

  _save() {
    save(KEY, JSON.stringify({ v: VERSION, seen: [...this.seen], found: [...this.found] }));
  }

  isSeen(id) {
    return this.seen.has(id);
  }

  isFound(id) {
    return this.found.has(id);
  }

  isUnlocked(clueId) {
    const by = UNLOCKED_BY.get(clueId);
    return !!by && this.seen.has(by);
  }

  // ch장까지의 수첩 글 가운데 주운 것. ch를 빼면 1장만 센다.
  foundDocs(ch = 1) {
    return DOCS.filter((c) => chapterOf(c) <= ch && this.found.has(c.id)).length;
  }

  get hasProgress() {
    return this.seen.size > 0;
  }

  // 사건(event)에 맞춰 아직 안 본 1장 장면 id를 순서대로 돌려준다. 2~4장 장면은 src/chapters.js가 직접 튼다.
  // event: 'start' | 'dusk' | 'dawn' | 'win' | { zones: n }
  scenesFor(event) {
    const out = [];
    for (const s of SCENES) {
      if (this.seen.has(s.id) || chapterOf(s) !== 1) continue;
      if (typeof event === 'object' ? typeof s.when === 'object' && s.when.zones <= event.zones : s.when === event) out.push(s.id);
    }
    return out;
  }

  // 장면을 다 봤거나 건너뛰었을 때. 새로 열린 기록을 돌려준다.
  markSeen(id) {
    if (!SCENE_BY_ID.has(id) || this.seen.has(id)) return [];
    this.seen.add(id);
    this._save();
    this.refresh();
    return (SCENE_BY_ID.get(id).unlocks ?? []).map((c) => CLUE_BY_ID.get(c)).filter(Boolean);
  }

  markFound(id) {
    if (!CLUE_BY_ID.has(id) || this.found.has(id)) return false;
    this.found.add(id);
    this._save();
    this.refresh();
    return true;
  }

  // 2~4장 진행을 처음부터 다시 할 때: 그 장들의 장면·기록만 지운다.
  forgetChapters() {
    for (const s of SCENES) if (chapterOf(s) > 1) this.seen.delete(s.id);
    for (const c of CLUES) if (chapterOf(c) > 1) this.found.delete(c.id);
    this._save();
    this.refresh();
  }

  // 수첩의 "이야기 처음부터". 판 도중에는 부르지 않는다(main이 처음 화면에서만 허용).
  wipe() {
    this.seen.clear();
    this.found.clear();
    remove(KEY);
    this.refresh();
  }

  // ---------------------------------------------------------------- 마을의 기록

  // 손이 닿는 기록(이미 읽은 것도 다시 읽을 수 있다). 가장 가까운 것 하나.
  nearest(x, z, r = READ_R) {
    let best = null;
    let bd = r * r;
    for (const s of this.spots) {
      if (!this.isUnlocked(s.clue.id)) continue;
      const d = (s.ix - x) ** 2 + (s.iz - z) ** 2;
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best ? { spot: best, clue: best.clue, dist: Math.sqrt(bd) } : null;
  }

  // 아직 안 읽은 열린 기록 가운데 가장 가까운 곳(화면 밖 화살표용)
  target(x, z) {
    let best = null;
    let bd = Infinity;
    for (const s of this.spots) {
      if (!this.isUnlocked(s.clue.id) || this.found.has(s.clue.id)) continue;
      const d = Math.hypot(s.ix - x, s.iz - z);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best ? { spot: best, dist: bd } : null;
  }

  // 카메라가 장면에서 바라볼 곳
  anchor(name) {
    if (name === 'lighthouse') return { x: LAKE.x + 2, z: LAKE.z + 2 };
    if (name === 'dock') return { x: this.dock.x, z: this.dock.z };
    if (name === 'town') return { x: 0, z: 2 };
    const s = this.spots.find((p) => p.clue.id === name);
    return s ? { x: s.x, z: s.z } : null;
  }

  _blocked(x, z, r) {
    const w = this.world;
    for (const c of w.colliders) {
      if (c.t === 0) {
        const nx = Math.min(Math.max(x, c.x0), c.x1);
        const nz = Math.min(Math.max(z, c.z0), c.z1);
        if ((x - nx) ** 2 + (z - nz) ** 2 < r * r) return true;
      } else if ((x - c.x) ** 2 + (z - c.z) ** 2 < (c.r + r) ** 2) {
        return true;
      }
    }
    return false;
  }

  // 소품 자리와 그 앞(읽는 사람이 서는 곳)이 비어 있고, 뒤질 곳·배전함과 손이 겹치지 않는 후보를 고른다.
  _pick(id, cands) {
    const w = this.world;
    for (const [x, z, a] of cands) {
      const ix = x + Math.sin(a) * 1.0;
      const iz = z + Math.cos(a) * 1.0;
      if (this._blocked(x, z, 0.55) || this._blocked(ix, iz, 0.4)) continue;
      if (w.loot.some((l) => Math.hypot(l.x - ix, l.z - iz) < 2.4)) continue;
      if (w.fuseBoxes.some((f) => Math.hypot(f.ix - ix, f.iz - iz) < 2.6)) continue;
      if (w.lamps.some((L) => Math.hypot(L.x - x, L.z - z) < 1.2)) continue;
      if (this.slotSpots.some((q) => Math.hypot(q.x - x, q.z - z) < SLOT_CLEAR)) continue;
      return { x, z, a, ix, iz };
    }
    const [x, z, a] = cands[0];
    console.warn(`[story] 기록 '${id}'를 둘 빈자리를 찾지 못해 첫 후보에 둡니다.`);
    return { x, z, a, ix: x + Math.sin(a), iz: z + Math.cos(a) };
  }

  _place(b, clue) {
    let p;
    if (clue.id === 'plaque') {
      p = { x: STATUE.x, z: STATUE.z + 0.66, a: 0, ix: STATUE.x, iz: STATUE.z + 1.6 };
    } else if (clue.id === 'tower') {
      p = { x: LADDER.x, z: LADDER.z, a: Math.PI / 2, ix: LADDER.x + 0.75, iz: LADDER.z };
    } else {
      p = this._pick(clue.id, PLACES[clue.id]);
    }
    const f = new Frame(p.x, p.z, p.a);
    const y0 = this.world.heightAt(p.x, p.z);
    let top = y0 + 1.5;
    switch (clue.kind) {
      case 'clipboard':
        if (clue.id === 'order') {
          // 전력소 공구함 위에 기대 둔 지시서
          f.add(b, geo.box(), 0, y0 + 0.24, 0, 0.95, 0.48, 0.5, 0xd27a2c);
          f.add(b, geo.box(), 0, y0 + 0.5, 0, 0.98, 0.06, 0.53, 0x9c5520);
          f.add(b, geo.box(), 0, y0 + 0.56, 0, 0.3, 0.06, 0.08, 0x3a3532);
          f.add(b, geo.box(), 0.15, y0 + 0.75, 0.3, 0.4, 0.52, 0.03, 0x8a6a48, 0, -0.35);
          f.add(b, geo.box(), 0.15, y0 + 0.76, 0.32, 0.32, 0.42, 0.01, 0xf2ecdc, 0, -0.35);
          this.world.colliders.push(f.aabb(0, 0, 0.95, 0.5, 0.05));
          top = y0 + 1.2;
        } else {
          // 기둥에 꽂아 둔 판
          const post = clue.id === 'chart' ? 0x4f8a6e : 0x6b5a48;
          f.add(b, geo.box(), 0, y0 + 0.62, 0, 0.1, 1.24, 0.1, post);
          f.add(b, geo.box(), 0, y0 + 1.22, 0.06, 0.5, 0.64, 0.04, 0x8a6a48, 0, -0.18);
          f.add(b, geo.box(), 0, y0 + 1.2, 0.09, 0.4, 0.5, 0.01, 0xf2ecdc, 0, -0.18);
          f.add(b, geo.box(), 0, y0 + 1.5, 0.05, 0.18, 0.06, 0.05, 0xb8b2a4, 0, -0.18);
          this.world.colliders.push({ t: 1, x: p.x, z: p.z, r: 0.18 });
          top = y0 + 1.7;
        }
        break;
      case 'poster':
        for (const s of [-0.8, 0.8]) f.add(b, geo.box(), s, y0 + 0.85, 0, 0.1, 1.7, 0.1, 0x5d4a3a);
        f.add(b, geo.box(), 0, y0 + 1.3, 0, 1.8, 1.0, 0.07, 0x9a7650);
        f.add(b, geo.box(), 0, y0 + 1.86, 0, 1.95, 0.08, 0.2, 0x5d4a3a);
        f.add(b, geo.box(), -0.2, y0 + 1.3, 0.04, 0.56, 0.78, 0.01, 0xf1e6c8);
        f.add(b, geo.box(), 0.45, y0 + 1.45, 0.04, 0.32, 0.28, 0.01, 0xe9e4d6, 0, 0, 0.08);
        f.add(b, geo.box(), 0.55, y0 + 1.1, 0.04, 0.3, 0.3, 0.01, 0xd8e2e4, 0, 0, -0.06);
        f.add(b, geo.box(), -0.62, y0 + 1.55, 0.04, 0.22, 0.26, 0.01, 0xf0d9b8, 0, 0, 0.1);
        this.world.colliders.push(f.aabb(0, 0, 1.9, 0.2, 0.05));
        top = y0 + 2.1;
        break;
      case 'chalk':
        // A자 입간판
        for (const s of [-1, 1]) {
          f.add(b, geo.box(), 0, y0 + 0.52, s * 0.2, 0.66, 1.0, 0.05, 0x7a5a40, 0, s * 0.22);
          f.add(b, geo.box(), 0, y0 + 0.55, s * 0.22, 0.54, 0.82, 0.02, 0x2f4a3a, 0, s * 0.22);
        }
        f.add(b, geo.box(), 0, y0 + 0.62, 0.235, 0.36, 0.05, 0.01, 0xe8e4d8, 0, 0.22);
        f.add(b, geo.box(), -0.05, y0 + 0.46, 0.25, 0.28, 0.04, 0.01, 0xe8e4d8, 0, 0.22);
        this.world.colliders.push({ t: 1, x: p.x, z: p.z, r: 0.4 });
        top = y0 + 1.4;
        break;
      case 'diary':
        // 길가에 떨어진 노란 책가방과 일기장, 꺼진 손전등
        f.add(b, geo.box(), 0, y0 + 0.16, 0, 0.46, 0.3, 0.54, 0xe2b23c, 0.4, 0.15);
        f.add(b, geo.box(), 0.02, y0 + 0.27, 0.2, 0.36, 0.12, 0.2, 0xc99a2c, 0.4, 0.15);
        f.add(b, geo.box(), 0.5, y0 + 0.03, 0.25, 0.3, 0.03, 0.36, 0xf2ecdc, -0.3);
        f.add(b, geo.box(), 0.5, y0 + 0.05, 0.25, 0.31, 0.01, 0.37, 0x6f8fb0, -0.3);
        f.add(b, geo.cyl(8), -0.45, y0 + 0.06, 0.35, 0.1, 0.32, 0.1, 0x3a3f44, 1.1, Math.PI / 2);
        this.world.colliders.push({ t: 1, x: p.x, z: p.z, r: 0.3 });
        top = y0 + 0.9;
        break;
      case 'brass':
        // 동상 받침대 남쪽 면의 놋쇠 명판(받침대는 world.js가 만든다)
        f.add(b, geo.box(), 0, y0 + 0.55, 0, 0.78, 0.42, 0.03, 0x8a6a2e);
        f.add(b, geo.box(), 0, y0 + 0.55, 0.01, 0.68, 0.32, 0.02, 0xb8923f);
        top = y0 + 2.9;
        break;
      case 'letter':
        // 할머니 집 우편함
        f.add(b, geo.box(), 0, y0 + 0.55, 0, 0.1, 1.1, 0.1, 0x5d4a3a);
        f.add(b, geo.box(), 0, y0 + 1.22, 0, 0.36, 0.32, 0.56, 0x3f6a8a);
        f.add(b, geo.box(), 0, y0 + 1.4, 0, 0.36, 0.08, 0.56, 0x335874);
        f.add(b, geo.box(), 0.21, y0 + 1.32, -0.08, 0.03, 0.3, 0.06, 0xb5554a);
        f.add(b, geo.box(), 0, y0 + 1.2, 0.29, 0.22, 0.08, 0.01, 0xe8e2d0);
        this.world.colliders.push({ t: 1, x: p.x, z: p.z, r: 0.2 });
        top = y0 + 1.75;
        break;
      default:
        top = y0 + 2.2; // 급수탑 사다리(world.js)
        break;
    }
    this.spots.push({ clue, x: p.x, z: p.z, ix: p.ix, iz: p.iz, top });
  }

  // ---------------------------------------------------------------- 표식(반짝임·빛기둥)

  _markers() {
    const n = this.spots.length;
    const pos = new Float32Array(n * 3);
    const seeds = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const s = this.spots[i];
      pos[i * 3] = s.x;
      pos[i * 3 + 1] = s.top;
      pos[i * 3 + 2] = s.z;
      seeds[i] = i * 1.7;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    this.glintOn = new THREE.BufferAttribute(new Float32Array(n), 1);
    g.setAttribute('aOn', this.glintOn);
    this.glintMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPx: { value: 30 }, uNight: { value: 0 } },
      vertexShader: `
        attribute float aSeed; attribute float aOn;
        uniform float uTime; uniform float uPx;
        varying float vA;
        void main(){
          vec3 p = position; p.y += sin(uTime * 1.6 + aSeed) * 0.1;
          float tw = 0.7 + 0.3 * sin(uTime * 2.4 + aSeed * 2.1);
          vA = aOn * tw;
          gl_PointSize = aOn * uPx * 1.1 * (0.85 + 0.15 * tw);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `
        uniform float uNight; varying float vA;
        void main(){
          vec2 q = gl_PointCoord - 0.5;
          float core = exp(-dot(q, q) * 70.0);
          float ring = exp(-pow(length(q) - 0.3, 2.0) * 900.0) * 0.5;
          float a = (core + ring) * vA;
          gl_FragColor = vec4(vec3(0.62, 0.86, 1.0) * mix(2.3, 3.0, uNight), a);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(g, this.glintMat);
    points.frustumCulled = false;
    points.renderOrder = 4;
    this.root.add(points);

    // 열렸지만 아직 안 읽은 기록 위의 푸른 빛기둥(배전함의 붉은 기둥과 구별)
    const beamGeo = new THREE.CylinderGeometry(0.26, 0.26, 16, 12, 1, true).translate(0, 8, 0);
    this.beamMat = makeBeaconMaterial(new THREE.Color(0.45, 0.75, 1.0)); // 배전함·옷가지 기둥과 같은 셰이더
    for (const s of this.spots) {
      s.beam = new THREE.Mesh(beamGeo, this.beamMat);
      s.beam.position.set(s.x, s.top - 0.2, s.z);
      s.beam.renderOrder = 3;
      s.beam.visible = false;
      this.root.add(s.beam);
    }
  }

  // 진행 상태가 바뀌면 표식을 다시 맞춘다.
  refresh() {
    for (let i = 0; i < this.spots.length; i++) {
      const s = this.spots[i];
      const open = this.isUnlocked(s.clue.id) && !this.found.has(s.clue.id);
      this.glintOn.array[i] = open ? 1 : 0;
      s.beam.visible = open;
    }
    this.glintOn.needsUpdate = true;
  }

  // ---------------------------------------------------------------- 호수와 등대

  _lake(b) {
    const L = LAKE;
    // 기본 바닥(±150) 밖 호수 둘레의 땅. 겹치는 면이 깜박이지 않게 기본 바닥과 맞닿게만 깐다.
    b.add(geo.box(), -205, -0.05, -150, 110, 0.1, 220, SHORE);
    b.add(geo.box(), -95, -0.05, -205, 110, 0.1, 110, SHORE);
    // 모래톱과 물
    b.add(geo.cyl(40), L.x, 0.012, L.z, L.r * 2 + 5, 0.02, L.r * 2 + 5, 0xb8a882);
    const water = new THREE.Mesh(
      new THREE.CylinderGeometry(L.r, L.r, 0.04, 48),
      new THREE.MeshStandardMaterial({ color: 0x406a74, roughness: 0.28, metalness: 0.05 }),
    );
    water.position.set(L.x, 0.035, L.z);
    water.receiveShadow = true;
    water.frustumCulled = false;
    this.root.add(water);

    // 섬과 등대. 2장에서 걷는 땅이라 걸을 수 있는 반경(ISLAND.r)보다 조금 넓게 깐다. 윗면 높이는 ISLAND.top.
    const rng = new Rng(1926);
    const R = ISLAND.r;
    b.add(geo.cyl(28), L.x, 0.22, L.z, (R + 1.7) * 2, 0.44, (R + 1.5) * 2, 0x8f8a7c);
    b.add(geo.cyl(28), L.x, 0.45, L.z, (R + 0.5) * 2, 0.1, (R + 0.4) * 2, 0x7d8d5b);
    const PIER_AN = Math.PI / 4; // 섬 부두 방향(남동). 바윗돌은 그쪽을 비운다.
    for (let i = 0; i < 22; i++) {
      const an = (i / 22) * Math.PI * 2 + rng.range(-0.1, 0.1);
      if (Math.abs(Math.atan2(Math.sin(an - PIER_AN), Math.cos(an - PIER_AN))) < 0.42) continue;
      const rr = R + 1.2 + rng.range(-0.3, 0.3);
      b.add(geo.ico(0), L.x + Math.cos(an) * rr, 0.32, L.z + Math.sin(an) * rr, rng.range(1.1, 2.0), rng.range(0.6, 1.1), rng.range(1, 1.7), 0x8c887e, an);
    }
    const lx = L.x;
    const lz = L.z;
    const seg = [[0.45, 1.6, 0xefe9de], [2.45, 1.48, 0xb5463c], [4.45, 1.36, 0xefe9de], [6.45, 1.24, 0xb5463c]];
    for (const [y, r, c] of seg) {
      const rTop = r - 0.12;
      b.add(geo.cyl(16, rTop / (2 * r)), lx, y + 1.0, lz, r * 2, 2.0, r * 2, c);
    }
    b.add(geo.cyl(16), lx, 8.6, lz, 2.0, 0.2, 2.0, 0x3c4245);
    b.add(geo.cyl(16), lx, 8.95, lz, 2.6, 0.12, 2.6, 0x2f3437);
    for (let i = 0; i < 10; i++) {
      const an = (i / 10) * Math.PI * 2;
      b.add(geo.box(), lx + Math.cos(an) * 1.22, 9.3, lz + Math.sin(an) * 1.22, 0.06, 0.6, 0.06, 0x2f3437);
    }
    b.add(geo.cyl(16), lx, 9.62, lz, 2.5, 0.06, 2.5, 0x2f3437);
    b.add(geo.cyl(16), lx, 9.25, lz, 1.9, 0.5, 1.9, 0x3c4245);
    b.add(geo.cyl(10), lx, LANTERN_Y + 0.85, lz, 1.95, 0.12, 1.95, 0x2f3437);
    b.add(geo.cone(12), lx, LANTERN_Y + 1.45, lz, 2.1, 1.1, 2.1, 0x8a3a32);
    b.add(geo.sphere(8, 6), lx, LANTERN_Y + 2.1, lz, 0.32, 0.32, 0.32, 0x2f3437);
    // 등대 당직실(등대지기 오두막). 정면(+z)이 카메라 쪽(남동)을 본다. 앞 처마 밑에 밥상이 있다.
    const hf = new Frame(lx + 4.6, lz - 2.4, Math.PI / 4);
    hf.add(b, geo.box(), 0, 1.6, 0, 3.4, 2.2, 2.6, 0xe2d6bd);
    hf.add(b, geo.gable(), 0, 3.25, 0, 2.6, 1.1, 3.4, 0xe2d6bd, Math.PI / 2);
    hf.add(b, geo.box(), 0, 3.3, 0.74, 3.8, 0.1, 1.62, 0x6d4e42, 0, 0.75);
    hf.add(b, geo.box(), 0, 3.3, -0.74, 3.8, 0.1, 1.62, 0x6d4e42, 0, -0.75);
    hf.add(b, geo.box(), 0.7, 1.4, 1.32, 0.7, 1.4, 0.05, 0x4b3a32);
    hf.add(b, geo.box(), -0.9, 1.95, 1.32, 0.8, 0.5, 0.05, 0x9fc4c8); // 창
    // 처마와 기둥, 밥상(두 그릇과 뚜껑), 걸상
    hf.add(b, geo.box(), 0, 2.72, 2.15, 3.6, 0.08, 1.7, 0x6d4e42, 0, -0.12);
    for (const sx of [-1.65, 1.65]) hf.add(b, geo.box(), sx, 1.6, 2.85, 0.12, 2.2, 0.12, 0x5d4a3a);
    hf.add(b, geo.box(), 0.75, 0.82, 2.25, 1.3, 0.06, 0.8, 0x9a6e4c);
    for (const [tx, tz] of [[0.2, -0.3], [1.3, -0.3], [0.2, 0.3], [1.3, 0.3]]) hf.add(b, geo.box(), tx, 0.65, 2.25 + tz, 0.07, 0.32, 0.07, 0x6e543d);
    for (const bx of [0.5, 1.0]) {
      hf.add(b, geo.cyl(10), bx, 0.9, 2.2, 0.32, 0.12, 0.32, 0xe9e4d6);
      hf.add(b, geo.sphere(8, 4), bx, 0.96, 2.2, 0.3, 0.14, 0.3, 0x8a9aa0);
    }
    hf.add(b, geo.box(), 0.75, 0.62, 3.05, 1.1, 0.08, 0.32, 0x8a6a48);
    this.hut = hf;
    // 섬 뒤편 소나무 몇 그루(실루엣)
    for (const [ox, oz, sc] of [[-5.6, -4.4, 1.2], [-3.2, -6.4, 1.0], [-6.8, -1.2, 0.9], [1.2, -7.0, 1.1]]) {
      const tx = lx + ox;
      const tz = lz + oz;
      b.add(geo.cyl(5), tx, 0.5 + 0.4 * sc, tz, 0.24 * sc, 0.8 * sc, 0.24 * sc, 0x6b4e3a);
      for (let k = 0; k < 3; k++) {
        const r = (1.8 - k * 0.45) * sc;
        b.add(geo.cone(7), tx, 0.5 + 0.7 * sc + k * 0.85 * sc + 0.75 * sc, tz, r, 1.6 * sc, r, PINES[k], k * 0.4);
      }
    }
    // 사람이 지내던 섬: 부두 계단에서 등대·당직실로 가는 돌길, 풀, 장작더미와 빨랫줄, 물통.
    // 호숫가 숲과 다른 난수를 써서 숲 배치는 그대로 둔다.
    const deco = new Rng(1031);
    const stone = (x, z, s) => b.add(geo.cyl(7), x, ISLAND.top + 0.015, z, s, 0.04, s * 0.8, 0x9a968a, deco.range(0, 3));
    for (let t = R - 1.4; t > 2.0; t -= 0.85) stone(lx + t * Math.SQRT1_2 + deco.range(-0.25, 0.25), lz + t * Math.SQRT1_2 + deco.range(-0.25, 0.25), deco.range(0.55, 0.75));
    for (let k = 1; k <= 4; k++) {
      const t = k / 5;
      const px = lx + 4.2 * Math.SQRT1_2 + (hf.px(0, 2.6) - lx - 4.2 * Math.SQRT1_2) * t;
      const pz = lz + 4.2 * Math.SQRT1_2 + (hf.pz(0, 2.6) - lz - 4.2 * Math.SQRT1_2) * t;
      stone(px + deco.range(-0.2, 0.2), pz + deco.range(-0.2, 0.2), deco.range(0.5, 0.7));
    }
    for (let i = 0; i < 46; i++) {
      const an = deco.range(0, Math.PI * 2);
      const rr = deco.range(2.4, R - 0.4);
      const x = lx + Math.cos(an) * rr;
      const z = lz + Math.sin(an) * rr;
      if (Math.abs(Math.atan2(Math.sin(an - PIER_AN), Math.cos(an - PIER_AN))) < 0.28) continue;
      if (Math.hypot(x - hf.x, z - hf.z) < 3.4) continue;
      const s = deco.range(0.5, 0.9);
      b.add(geo.cone(5), x, ISLAND.top + 0.12 * s, z, 0.32 * s, 0.26 * s, 0.32 * s, deco.pick([0x6f8a4a, 0x7d9652, 0x627c42]), deco.range(0, 3));
    }
    // 당직실 옆: 장작더미, 빨랫줄(수건 두 장), 물통
    for (let k = 0; k < 3; k++) hf.add(b, geo.cyl(6), -2.6, 0.62 + k * 0.2, -0.6 + k * 0.08, 0.2, 1.2, 0.2, 0x8a6a48, 0, Math.PI / 2);
    for (let k = 0; k < 4; k++) hf.add(b, geo.cyl(6), -2.6, 0.62, -0.95 + k * 0.24, 0.2, 1.2, 0.2, 0x7a5a3e, 0, Math.PI / 2);
    for (const sx of [-0.8, 1.2]) hf.add(b, geo.box(), sx, 1.3, -2.4, 0.08, 1.6, 0.08, 0x5d4a3a);
    hf.add(b, geo.box(), 0.2, 2.05, -2.4, 2.0, 0.02, 0.02, 0xd9d4c8);
    hf.add(b, geo.box(), -0.25, 1.75, -2.4, 0.5, 0.6, 0.02, 0xe9e4d6);
    hf.add(b, geo.box(), 0.6, 1.8, -2.4, 0.45, 0.5, 0.02, 0x8fb0c0);
    hf.add(b, geo.cyl(10), 2.3, 0.85, 0.6, 0.6, 0.7, 0.6, 0x3f6a8a);
    hf.add(b, geo.cyl(10), 2.3, 1.21, 0.6, 0.62, 0.04, 0.62, 0x335874);

    // 섬 부두: 돌계단을 내려가 물 위로 뻗은 나무 부두. 계단 위 고정등과 부두 보관함은 2장(src/chapters.js)이 쓴다.
    const pf = new Frame(lx, lz, PIER_AN);
    for (let k = 0; k < 3; k++) pf.add(b, geo.box(), 0, 0.42 - k * 0.07, R - 0.9 + k * 0.62, 2.6, 0.2, 0.66, 0x9a968a);
    pf.add(b, geo.box(), 0, 0.42, (R + 0.6 + ISLAND.pier) / 2, 2.0, 0.12, ISLAND.pier - R - 0.6, 0x8f6c4e);
    for (let k = R + 0.8; k < ISLAND.pier; k += 1) pf.add(b, geo.box(), 0, 0.49, k, 2.02, 0.02, 0.06, 0x6e543d);
    for (const sx of [-0.9, 0.9]) for (const pz of [R + 1.2, (R + ISLAND.pier) / 2 + 0.5, ISLAND.pier - 0.2]) pf.add(b, geo.cyl(6), sx, 0.3, pz, 0.16, 1.0, 0.16, 0x5a4232);
    // 부두 난간 기둥의 구명환
    pf.add(b, geo.cyl(12), -1.02, 0.95, R + 1.7, 0.62, 0.62, 0.12, 0xd8452f, 0, Math.PI / 2);
    pf.add(b, geo.cyl(12), -1.03, 0.95, R + 1.7, 0.36, 0.64, 0.13, 0x3a3f44, 0, Math.PI / 2);
    this.islandPier = pf;

    // 등대 유리방(불이 켜지면 빛난다)과 할머니의 등잔
    this.lampMat = new THREE.MeshBasicMaterial({ color: 0x1a2124 });
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 1.4, 12), this.lampMat);
    lamp.position.set(lx, LANTERN_Y, lz);
    this.root.add(lamp);
    this.oilMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const oil = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), this.oilMat);
    this.oilPos = new THREE.Vector3(lx + 0.77, 9.15, lz + 0.77);
    oil.position.copy(this.oilPos);
    this.root.add(oil);

    // 회전하는 빛줄기 두 갈래
    const beamGeo = new THREE.ConeGeometry(3.2, 34, 18, 1, true).translate(0, -17, 0).rotateZ(Math.PI / 2);
    this.lhBeamMat = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform float uOpacity; varying vec2 vUv; void main(){ float a = pow(clamp(vUv.y, 0.0, 1.0), 1.6) * uOpacity; gl_FragColor = vec4(vec3(1.0, 0.9, 0.68), a); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.beamPivot = new THREE.Group();
    this.beamPivot.position.set(lx, LANTERN_Y, lz);
    for (const r of [0, Math.PI]) {
      const m = new THREE.Mesh(beamGeo, this.lhBeamMat);
      m.rotation.y = r;
      m.rotation.z = -0.06;
      m.renderOrder = 5;
      this.beamPivot.add(m);
    }
    this.beamPivot.visible = false;
    this.root.add(this.beamPivot);

    // 실제 광원은 world의 고정 개수 PointLight 풀이 가까운 후보를 골라 비춘다(개수가 바뀌면 셰이더 재컴파일).
    this.lhLight = { level: 0, power: 40 };
    this.oilLight = { level: 0, power: 5 };
    this.world.cands.push(
      { kind: 1, ref: this.lhLight, x: lx, y: LANTERN_Y, z: lz, color: new THREE.Color(1.0, 0.86, 0.6), i: 0, d: 0 },
      { kind: 1, ref: this.oilLight, x: this.oilPos.x, y: this.oilPos.y + 0.4, z: this.oilPos.z, color: new THREE.Color(1.0, 0.55, 0.2), i: 0, d: 0 },
    );

    // 마을 쪽 물가의 선착장과 묶여 있는 나룻배
    const u = Math.SQRT1_2;
    const dx = L.x + (L.r - 1.5) * u;
    const dz = L.z + (L.r - 1.5) * u;
    this.dock = { x: dx - 2.5 * u, z: dz - 2.5 * u };
    const df = new Frame(dx, dz, -3 * Math.PI / 4);
    df.add(b, geo.box(), 0, 0.42, 3.4, 1.6, 0.12, 8.0, 0x8f6c4e);
    for (let k = 0; k < 8; k++) df.add(b, geo.box(), 0, 0.49, 0.2 + k, 1.62, 0.02, 0.06, 0x6e543d);
    for (const s of [-0.75, 0.75]) for (const lz2 of [0, 3.4, 7.2]) df.add(b, geo.cyl(6), s, 0.3, lz2, 0.16, 1.0, 0.16, 0x5a4232);
    df.add(b, geo.cyl(6), 0.75, 1.0, 7.2, 0.14, 1.2, 0.14, 0x5a4232);
    df.add(b, geo.box(), 0.75, 1.68, 7.2, 0.22, 0.26, 0.22, 0x2f3437);
    // 나룻배: 선체, 안쪽, 가로 의자, 노. 2장에서 섬으로 건너가므로 따로 움직이는 메시로 둔다.
    const bb = new Builder();
    bb.add(geo.box(), 0, 0.2, 0, 1.05, 0.38, 2.6, 0x7a4f36);
    bb.add(geo.box(), 0, 0.27, 0, 0.85, 0.3, 2.3, 0x4f3627);
    bb.add(geo.box(), 0, 0.32, 1.4, 0.7, 0.3, 0.5, 0x7a4f36, 0, 0.3);
    bb.add(geo.box(), 0, 0.38, -0.2, 0.9, 0.06, 0.3, 0x9a6e4c);
    bb.add(geo.box(), -0.45, 0.42, -0.4, 0.06, 0.05, 2.2, 0xa8835c, 0.3);
    bb.add(geo.box(), 0.45, 0.42, -0.4, 0.06, 0.05, 2.2, 0xa8835c, -0.3);
    this.boat = new THREE.Mesh(bb.build(), this.world.staticMat);
    this.boat.castShadow = true;
    this.boat.receiveShadow = true;
    this.boatHome = { x: df.px(1.75, 5.0), z: df.pz(1.75, 5.0), a: df.a };
    this.dockPier = df;
    this.root.add(this.boat);
    this.parkBoat();

    // 호숫가 숲. 마을 숲(±118)과 따로 결정적 난수를 써서 마을 배치는 그대로 둔다.
    let placed = 0;
    for (let guard = 0; placed < 150 && guard < 2000; guard++) {
      const x = rng.range(-250, -100);
      const z = rng.range(-250, -100);
      if (Math.max(Math.abs(x), Math.abs(z)) < 121) continue;
      const d = Math.hypot(x - L.x, z - L.z);
      if (d < L.r + 4.5) continue;
      if (Math.hypot(x - dx, z - dz) < 9) continue;
      const s = rng.range(0.9, 1.5);
      const col = tint(rng.pick(PINES), rng, 0.05);
      b.add(geo.cyl(5), x, 0.4 * s, z, 0.24 * s, 0.8 * s, 0.24 * s, 0x6b4e3a);
      for (let k = 0; k < 3; k++) {
        const r = (2.0 - k * 0.5) * s;
        b.add(geo.cone(7), x, 0.7 * s + k * 0.85 * s + 0.75 * s, z, r, 1.6 * s, r, col, k * 0.4);
      }
      placed++;
    }
  }

  // 나룻배를 마을 쪽 선착장에 매어 둔다.
  parkBoat() {
    const h = this.boatHome;
    this.boat.position.set(h.x, 0, h.z);
    this.boat.rotation.set(0, h.a, 0);
  }

  // 판을 새로 시작할 때: 등대는 꺼진 채, 할머니의 등잔만 켜져 있다.
  resetRun() {
    this.lit = false;
    this.lightLevel = 0;
    this.beamPivot.visible = false;
    this.parkBoat();
  }

  setLighthouse(on) {
    this.lit = on;
    if (on) this.beamPivot.visible = true;
  }

  update(dt, t, night, pxPerUnit) {
    this.glintMat.uniforms.uTime.value = t;
    this.glintMat.uniforms.uPx.value = pxPerUnit;
    this.glintMat.uniforms.uNight.value = night;
    this.beamMat.uniforms.uOpacity.value = (0.16 + 0.34 * night) * (0.75 + 0.25 * Math.sin(t * 1.7));

    this.lightLevel += ((this.lit ? 1 : 0) - this.lightLevel) * (1 - Math.exp(-dt * 1.4));
    const k = this.lightLevel;
    this.lampMat.color.setRGB(0.1 + k * 7.0, 0.13 + k * 6.0, 0.14 + k * 4.2);
    this.lhLight.level = k;
    this.lhBeamMat.uniforms.uOpacity.value = k * (0.07 + 0.3 * night);
    this.beamPivot.rotation.y = t * 0.55;
    // 등잔은 등대가 다시 켜지면 할 일을 마친다.
    const flick = 0.82 + 0.18 * Math.sin(t * 9.3) * Math.sin(t * 5.1 + 1.3);
    const oil = (1 - k) * flick;
    this.oilMat.color.setRGB(oil * 5.5, oil * 2.6, oil * 0.8);
    this.oilLight.level = oil * (0.4 + 0.6 * night);
  }
}
