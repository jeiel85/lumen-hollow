import * as THREE from 'three';
import { Builder, Frame, geo } from './geometry.js';
import { LAMP_RADIUS, makePoolTexture, pushOut } from './world.js';
import { load, save, remove } from './storage.js';
import { LAKE, ISLAND, clueById } from './story.js';
import { CHAPTERS, OBJECTIVES } from './script.js';

// 2~4장: 1장을 마친 뒤 이어지는 이야기. 마을과 겹치지 않는 두 무대(호수의 등대섬, 강 건너 옛 학교)를 짓고,
// 지금 무엇을 할 차례인지를 진행 상태(본 장면·주운 기록·아래 표시)에서 매번 다시 계산한다.
// 그래서 탭이 어디서 닫혀도 다시 열면 그 차례에서 이어진다. 대본은 script.js, 장면 재생·화면은 main·dialogue가 한다.

const KEY = 'lumen.chapters';
const VERSION = 1; // 저장 형식: { v: 1, flags: [표시] }. 바꾸면 DECISIONS.md도 고친다.
// 장면·기록만으로는 알 수 없는 진행: 4장 예비등 둘, 목표 그림자 귀환 둘(장면보다 먼저 남긴다), 3장 사진 뒤집기
const FLAGS = new Set(['lampDoor', 'lampYard', 'home1', 'home2', 'flip']);

const WARM = new THREE.Color(1.0, 0.72, 0.42);
// 3·4장 무대(강 건너 옛 학교)의 원점. 마을 바닥(±150)과 호숫가 숲 밖이라 서로 보이지 않는다.
export const RIVER = { x: 300, z: 0 };
const REACH = 1.8;
const U = Math.SQRT1_2;
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

function loadFlags() {
  let raw = null;
  try {
    raw = JSON.parse(load(KEY));
  } catch {
    raw = null; // 손상된 기록은 처음부터
  }
  const out = new Set();
  if (raw && typeof raw === 'object' && raw.v === VERSION && Array.isArray(raw.flags)) {
    for (const f of raw.flags) if (FLAGS.has(f)) out.add(f);
  }
  return out;
}

// ---------------------------------------------------------------- 무대

// 플레이어·그늘이가 쓰는 땅. World(마을)와 같은 이름의 함수(collide·heightAt·lightAt·addLoad·inBounds·nearestHome)를 갖춘다.
// 걸을 수 있는 곳은 원·직사각형(Frame 기준 지역 좌표)의 합집합이고, 그 밖으로 나가면 가장 가까운 곳으로 되돌린다.
class Stage {
  constructor(name, height) {
    this.name = name;
    this.height = height;
    this.areas = [];
    this.colliders = [];
    this.lamps = []; // 안전한 불빛 { x, z, r, on, level }
    this.homes = []; // 흩어진 그림자가 날아갈 창 { x, y, z }
    this.calm = []; // 그늘이가 깨어나지 않는 곳(건물 안) { x0, x1, z0, z1 }
    this.night = 0;
    this.spawnRange = [7, 12];
  }

  circle(x, z, r) {
    this.areas.push({ c: true, x, z, r });
  }

  rect(f, x0, x1, z0, z1) {
    this.areas.push({ f, x0, x1, z0, z1 });
  }

  heightAt(x, z) {
    return this.height(x, z);
  }

  _local(a, x, z) {
    const dx = x - a.f.x;
    const dz = z - a.f.z;
    return [dx * a.f.c - dz * a.f.s, dx * a.f.s + dz * a.f.c];
  }

  _in(a, x, z, m) {
    if (a.c) return (x - a.x) ** 2 + (z - a.z) ** 2 <= Math.max(0, a.r - m) ** 2;
    const [lx, lz] = this._local(a, x, z);
    return lx >= a.x0 + m && lx <= a.x1 - m && lz >= a.z0 + m && lz <= a.z1 - m;
  }

  _project(a, x, z, m) {
    if (a.c) {
      const dx = x - a.x;
      const dz = z - a.z;
      const d = Math.hypot(dx, dz) || 1e-6;
      const r = Math.max(0, a.r - m);
      return { x: a.x + (dx / d) * r, z: a.z + (dz / d) * r };
    }
    let [lx, lz] = this._local(a, x, z);
    lx = clamp(lx, a.x0 + m, a.x1 - m);
    lz = clamp(lz, a.z0 + m, a.z1 - m);
    return { x: a.f.px(lx, lz), z: a.f.pz(lx, lz) };
  }

  walkable(x, z, m = 0) {
    return this.areas.some((a) => this._in(a, x, z, m));
  }

  collide(p, r) {
    pushOut(this.colliders, p, r);
    if (this.walkable(p.x, p.z, r)) return;
    let best = null;
    let bd = Infinity;
    for (const a of this.areas) {
      const q = this._project(a, p.x, p.z, r);
      const d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    if (best) {
      p.x = best.x;
      p.z = best.z;
    }
  }

  lightAt(x, z) {
    if (this.night < 0.3) return null;
    for (const L of this.lamps) {
      if (L.level < 0.5) continue;
      const dx = x - L.x;
      const dz = z - L.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < L.r * L.r) return { L, dx, dz, d: Math.sqrt(d2), r: L.r };
    }
    return null;
  }

  // 무대의 등은 차단기가 없다(그늘이가 몰려도 꺼지지 않는다).
  addLoad() {}

  inBounds(x, z) {
    if (!this.walkable(x, z, 0.6)) return false;
    if (this.calm.some((c) => x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1)) return false;
    const p = { x, z };
    pushOut(this.colliders, p, 0.4);
    return Math.abs(p.x - x) + Math.abs(p.z - z) < 1e-6;
  }

  nearestHome(x, z) {
    let best = null;
    let bd = Infinity;
    for (const h of this.homes) {
      const d = (h.x - x) ** 2 + (h.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = h;
      }
    }
    return best;
  }
}

// ---------------------------------------------------------------- 사람

const SKIN = 0xefc8a6;
const LOOKS = {
  gran: { coat: 0x6e5a7e, pants: 0x4a4038, hair: 0xd8d4cc },
  pharm: { coat: 0xe8ece8, pants: 0x3a4658, hair: 0x2a2220 },
  owner: { coat: 0x8a3a32, pants: 0x3a3f44, hair: 0x3a3028 },
  jeong: { coat: 0x3f5a46, pants: 0x3a3f44, hair: 0x2a2220 },
  mom: { coat: 0xd9c8a8, pants: 0x5a5048, hair: 0x3a2a22 },
  patient: { coat: 0x8a8f96, pants: 0x4a4f56, hair: 0x8a8580 },
  n1: { coat: 0x5a7a96, pants: 0x3a3f44, hair: 0x2a2220 },
  n2: { coat: 0xb08a4a, pants: 0x4a4038, hair: 0x5a4030 },
  n3: { coat: 0x7a8a5a, pants: 0x3a4658, hair: 0x9a948a },
};

// 주인공과 비슷한 비율의 로우폴리 인물(발바닥이 원점, 정면 +z). pose: 'stand' | 'sit'(seat 높이에 걸터앉음)
// 누운 사람은 'stand'를 눕혀 쓴다(rotation.x = -π/2면 머리가 -z, 얼굴이 위).
function personGeo(look, pose = 'stand', seat = 0.45) {
  const b = new Builder();
  const { coat, pants, hair } = look;
  const boot = 0x3a2e28;
  if (pose === 'sit') {
    const y = seat;
    for (const s of [-1, 1]) {
      b.add(geo.box(), s * 0.11, y + 0.07, 0.22, 0.15, 0.15, 0.46, pants);
      b.add(geo.box(), s * 0.11, y - 0.18, 0.42, 0.15, 0.42, 0.16, pants);
      b.add(geo.box(), s * 0.11, Math.max(0.06, y - 0.42), 0.46, 0.17, 0.12, 0.24, boot);
    }
    b.add(geo.cyl(8, 0.353), 0, y + 0.44, -0.02, 0.68, 0.76, 0.68, coat);
    for (const s of [-1, 1]) {
      b.add(geo.box(), s * 0.3, y + 0.5, 0.1, 0.12, 0.42, 0.13, coat, 0, -0.5);
      b.add(geo.box(), s * 0.24, y + 0.26, 0.3, 0.1, 0.1, 0.12, SKIN);
    }
    b.add(geo.sphere(10, 8), 0, y + 0.98, 0, 0.44, 0.44, 0.44, SKIN);
    b.add(geo.sphere(10, 6), 0, y + 1.06, -0.04, 0.47, 0.32, 0.47, hair);
    return b.build();
  }
  for (const s of [-1, 1]) {
    b.add(geo.box(), s * 0.11, 0.36, 0, 0.15, 0.5, 0.17, pants);
    b.add(geo.box(), s * 0.11, 0.07, 0.03, 0.17, 0.12, 0.24, boot);
  }
  b.add(geo.cyl(8, 0.353), 0, 0.98, 0, 0.68, 0.78, 0.68, coat);
  for (const s of [-1, 1]) {
    b.add(geo.box(), s * 0.31, 1.0, 0, 0.12, 0.56, 0.13, coat, 0, 0, s * 0.12);
    b.add(geo.box(), s * 0.34, 0.68, 0, 0.1, 0.1, 0.12, SKIN);
  }
  b.add(geo.sphere(10, 8), 0, 1.52, 0.02, 0.44, 0.44, 0.44, SKIN);
  b.add(geo.sphere(10, 6), 0, 1.6, -0.03, 0.47, 0.32, 0.47, hair);
  return b.build();
}

// ---------------------------------------------------------------- 장

export class Chapters {
  constructor(scene, world, story) {
    this.world = world;
    this.story = story;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.flags = loadFlags();
    this.ch = 0; // 지금 하고 있는 장(2~4). 장 밖이면 0
    this.step = null;
    this.night = false; // 4장 마지막 밤이 시작됐는지(이번 실행 동안만)
    this.restDone = false; // 4장 첫 귀환 뒤 '다시 비추기'를 눌렀는지
    this.rowing = null;
    this.queued = new Set();
    this.timer = 0;
    this.wispBusy = false;
    this.knockAt = null;
    this.npcs = {};
    this.spots = [];
    this.links = null; // attach()로 받는 { api, shades, wisps }

    this.poolTex = makePoolTexture();
    this.headGeo = new THREE.SphereGeometry(0.22, 10, 6);
    this.poolGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.lake = this._buildLake();
    this.river = this._buildRiver();
    this.stage = null;
    this.end(); // 1장에서는 섬의 등·인물이 보이지 않는다(등대가 꺼진 섬에는 할머니의 등잔만 있다).
  }

  // main이 장면 재생·기록 읽기·안내를 맡긴다.
  attach(links) {
    this.links = links;
  }

  get api() {
    return this.links.api;
  }

  // ---------------------------------------------------------------- 진행 상태

  _save() {
    save(KEY, JSON.stringify({ v: VERSION, flags: [...this.flags] }));
  }

  flag(f) {
    return this.flags.has(f);
  }

  _setFlag(f) {
    if (this.flags.has(f)) return;
    this.flags.add(f);
    this._save();
  }

  // 수첩의 '이야기 처음부터'와 '2장부터 다시'
  wipe() {
    this.flags.clear();
    remove(KEY);
  }

  get available() {
    return this.story.isSeen('finale');
  }

  get done() {
    return this.story.isSeen('broadcast');
  }

  // 처음 화면 단추에 쓸 다음 장: { ch, title, fresh(그 장을 아직 시작하지 않음) }. 1장을 마치지 않았거나 다 끝냈으면 null.
  nextInfo() {
    const d = this._derive(true);
    if (d.ch < 2 || d.ch > 4) return null;
    const first = { 2: 'ferry', 3: 'go', 4: 'roll' }[d.ch];
    return { ch: d.ch, title: CHAPTERS[d.ch - 1].title, fresh: d.step === first && !(d.ch === 2 && this.story.isSeen('ferry')) };
  }

  // 지금 할 차례. fresh면 이번 실행의 상태(진행 중인 장·밤)를 무시하고 저장된 진행만 본다.
  _derive(fresh = false) {
    const S = (id) => this.story.isSeen(id);
    const F = (id) => this.story.isFound(id);
    const G = (f) => this.flags.has(f);
    const ch = fresh ? 0 : this.ch;
    if (!S('finale')) return { ch: 0 };
    if (!S('bowls') || (ch === 2 && S('bowls'))) {
      if (S('bowls')) return { ch: 2, step: 'leave' };
      if (!S('ferry')) return { ch: 2, step: 'ferry' };
      if (!S('landing')) return { ch: 2, step: 'landing' };
      if (S('relief')) return { ch: 2, step: 'bowls' };
      if (F('islandbook') && F('spare')) return { ch: 2, step: 'call' };
      return { ch: 2, step: 'search' };
    }
    if (!S('chair')) {
      if (!S('count')) return { ch: 3, step: 'go' };
      if (!G('flip')) return { ch: 3, step: F('manifest') && F('tag') ? 'compare' : 'store' };
      if (!S('key')) return { ch: 3, step: 'key' };
      if (!S('knock')) return { ch: 3, step: 'knock' };
      if (!F('transfer')) return { ch: 3, step: 'back' };
      return { ch: 3, step: 'annex' };
    }
    if (!S('broadcast')) {
      const night = !fresh && this.night;
      if (!S('roll')) return { ch: 4, step: 'roll' };
      if (!(G('lampDoor') && G('lampYard'))) return { ch: 4, step: 'lamps' };
      if (!G('home1')) return { ch: 4, step: night ? 'night1' : 'wait' };
      if (!S('firsthome')) return { ch: 4, step: 'firsthome' };
      if (!G('home2')) return { ch: 4, step: !fresh && this.restDone ? 'night2' : 'rest' };
      if (!S('secondhome')) return { ch: 4, step: 'secondhome' };
      if (!S('truth')) return { ch: 4, step: 'class' };
      return { ch: 4, step: 'broadcast' };
    }
    return { ch: 5 };
  }

  get objective() {
    return OBJECTIVES[{
      ferry: 'ferry', landing: 'ferry', search: 'search', call: 'call', bowls: 'call', leave: 'leave',
      go: 'go', store: 'store', compare: 'store', key: 'store', knock: 'back', back: 'back', annex: 'annex',
      roll: 'lamps', lamps: 'lamps', wait: 'wait', night1: 'night', firsthome: 'night', rest: 'rest', night2: 'night',
      secondhome: 'night', class: 'class', broadcast: 'broadcast',
    }[this.step]] ?? '';
  }

  get label() {
    return this.ch ? `${this.ch}장 · ${CHAPTERS[this.ch - 1].title}` : '';
  }

  // 게임 시간이 흐르는 빠르기. 2장만 해가 지고, 3·4장은 이야기가 시각을 정한다.
  get timeScale() {
    return this.ch === 2 ? 1 : 0;
  }

  // 저절로 깨어나는 그늘이: 2장 밤, 4장 마지막 밤(목표 그림자를 쫓는 동안)
  spawning(night) {
    if (this.ch === 2) return night > 0.75;
    if (this.ch === 4) return (this.step === 'night1' || this.step === 'night2') && night > 0.75;
    return false;
  }

  get shadeCap() {
    return this.ch === 4 ? 2 : 3;
  }

  // ---------------------------------------------------------------- 시작

  // 지금 차례에 맞는 무대와 자리를 정한다. 플레이어·시각은 돌려준 값으로 main이 맞춘다.
  begin() {
    this.ch = 0;
    this.night = false;
    this.restDone = false;
    this.rowing = null;
    this.queued.clear();
    this.wispBusy = false;
    this.knockAt = null;
    this.timer = 0;
    const d = this._derive(true);
    if (d.ch < 2 || d.ch > 4) return null;
    this.ch = d.ch;
    const play = [];
    let at;
    let hour;
    let rainy = false;
    if (d.ch === 2) {
      this.stage = this.lake;
      hour = 15.0; // 해 지기까지 약 20초. 섬에서 첫 밤을 고정등 아래에서 맞게 된다.
      rainy = true;
      this.story.parkBoat();
      if (d.step === 'ferry') {
        at = this.villageStart;
      } else {
        this._moorAtIsland();
        at = this.pierEnd;
        if (d.step === 'landing') play.push('landing');
        if (d.step === 'bowls') play.push('bowls');
      }
    } else {
      this.stage = this.river;
      this.story.parkBoat();
      hour = 10.5;
      if (d.ch === 3) {
        if (d.step === 'go') at = this.river.start;
        else if (d.step === 'annex') at = this.river.tentOut;
        else at = this.river.storeOut;
        if (d.step === 'key') play.push('key');
        if (d.step === 'knock') play.push('knock');
      } else {
        at = this.river.stepsOut;
        hour = 16.6;
        if (d.step === 'roll') play.push('roll');
        if (['firsthome', 'rest', 'secondhome', 'class'].includes(d.step)) {
          this.night = true;
          hour = 20.6;
        }
        if (d.step === 'firsthome') play.push('firsthome');
        if (d.step === 'secondhome') play.push('secondhome');
        if (d.step === 'broadcast') {
          at = this.river.podiumOut;
          hour = 7.2;
        }
      }
    }
    for (const id of play) this.queued.add(id);
    this._refresh();
    return { ch: d.ch, title: CHAPTERS[d.ch - 1].title, x: at.x, z: at.z, facing: at.a ?? 0, hour, rainy, play };
  }

  // 장을 떠날 때(처음 화면, 끝 화면 뒤)
  end() {
    this.ch = 0;
    this.step = null;
    this.stage = null;
    this.rowing = null;
    this.night = false;
    this.story.parkBoat();
    for (const n of Object.values(this.npcs)) n.mesh.visible = false;
    this.workBoat.visible = false;
    for (const L of this.lake.lamps) {
      L.on = false;
      L.level = 0;
    }
  }

  // ---------------------------------------------------------------- 차례 맞추기

  _refresh() {
    if (!this.ch) return;
    const d = this._derive();
    this.step = d.step;
    this._dress();
    const api = this.links?.api;
    if (!api) return;
    // 진행만으로 정해지는 장면은 바로 튼다(이미 줄 섰으면 두 번 세우지 않는다).
    if (['landing', 'bowls', 'key', 'roll', 'firsthome', 'secondhome'].includes(this.step)) this._play(this.step);
    if (this.step === 'knock' && this.knockAt === null) {
      // 창고를 나서는 길에 걸려 오는 무전
      this.knockAt = 1;
      api.later(2.4, () => this._play('knock'));
    }
  }

  _play(id) {
    if (this.story.isSeen(id) || this.queued.has(id)) return;
    this.queued.add(id);
    this.api.queue(id);
  }

  // 장면이 끝났을 때(건너뛴 경우 포함). main의 playScene이 부른다.
  after(id) {
    this.queued.delete(id);
    if (!this.ch) return;
    const api = this.api;
    switch (id) {
      case 'ferry':
        this.rowing = null;
        this._moorAtIsland();
        api.place(this.pierEnd);
        break;
      case 'relief':
        api.toast('식당 주인이 인계부에 이름을 적었다.', 'story');
        break;
      case 'bowls':
        api.later(0.8, () => api.toast('섬을 떠날 때다. 부두의 나룻배로 가자.'));
        break;
      case 'count':
        api.later(0.8, () => api.toast('약사에게 창고 열쇠를 받았다.', 'good'));
        break;
      case 'chair':
        // 3장이 끝났다. 같은 무대에서 4장을 시작한다.
        api.next();
        return;
      case 'firsthome':
        api.later(0.6, () => api.toast('약사가 물병을 들고 계단 아래에 서 있다.'));
        break;
      case 'truth':
        this.night = false;
        this.links.shades.clear();
        this.links.player.flashOn = false;
        api.card('이튿날 아침');
        api.setHour(7.2);
        api.place(this.river.classOut);
        break;
      case 'broadcast':
        api.finish();
        return;
      default:
        break;
    }
    this._refresh();
  }

  // 기록을 다 읽었을 때(main의 openDoc이 부른다)
  docClosed() {
    this._refresh();
  }

  // ---------------------------------------------------------------- 상호작용

  // (x, z)에서 손이 닿는 가장 가까운 할 일. { label, dur, act } 또는 막힌 안내 { label, blocked: true }
  nearest(x, z) {
    let best = null;
    let bd = Infinity;
    for (const s of this.spots) {
      if (s.stage !== this.stage || !s.show()) continue;
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < (s.reach ?? REACH) && d < bd) {
        bd = d;
        best = s;
      }
    }
    if (!best) return null;
    const label = typeof best.label === 'function' ? best.label() : best.label;
    const blocked = best.blocked?.() ?? null;
    return blocked ? { key: best, label: blocked, blocked: true } : { key: best, label, dur: best.dur ?? 0.6, act: () => best.act() };
  }

  // 화면 밖 푸른 화살표가 가리킬 곳
  target(x, z) {
    let list = [];
    const st = this.step;
    const unread = (ids) => this.spots.filter((s) => ids.includes(s.clue) && !this.story.isFound(s.clue));
    if (st === 'ferry') list = [this.spot('boatVillage')];
    else if (st === 'search') list = unread(['islandbook', 'spare']);
    else if (st === 'call') list = [this.spot('call')];
    else if (st === 'leave') list = [this.spot('boatIsland')];
    else if (st === 'go') list = [this.river.tentMark];
    else if (st === 'store') list = unread(['manifest', 'tag']);
    else if (st === 'compare') list = [this.spot('manifest')];
    else if (st === 'back') list = [this.spot('return')];
    else if (st === 'annex') list = [this.river.stepsMark];
    else if (st === 'lamps') list = ['lampDoor', 'lampYard'].filter((f) => !this.flag(f)).map((f) => this.spot(f));
    else if (st === 'wait') list = [this.spot('wait')];
    else if (st === 'rest') list = [this.spot('water')];
    else if (st === 'class') list = [this.spot('class')];
    else if (st === 'broadcast') list = [this.spot('podium')];
    let best = null;
    let bd = Infinity;
    for (const s of list) {
      if (!s) continue;
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best ? { x: best.x, z: best.z, top: best.top ?? 2.2, dist: bd } : null;
  }

  spot(id) {
    return this.spots.find((s) => s.id === id) ?? null;
  }

  _readClue(id) {
    const clue = clueById(id);
    if (!clue) return;
    const S = this.story;
    if (id === 'manifest' || id === 'tag') {
      const other = id === 'manifest' ? 'tag' : 'manifest';
      // 두 번째 것을 읽거나, 둘 다 읽고 아직 사진을 뒤집지 않았으면 17번을 나란히 맞춰 본다.
      if (!this.flag('flip') && S.isFound(other)) {
        this.api.compare(clueById('manifest'), clueById('tag'), () => {
          this._setFlag('flip');
        });
        return;
      }
    }
    this.api.openDoc(clue);
  }

  // 플레이 중 매 프레임(게임 시간): 다가가면 시작되는 장면, 4장 목표 그림자
  update(dt, player) {
    if (!this.ch) return;
    const px = player.pos.x;
    const pz = player.pos.z;
    const R = this.river;
    if (this.step === 'go' && Math.hypot(px - R.tentMark.x, pz - R.tentMark.z) < 8) this._play('count');
    if (this.step === 'annex' && Math.hypot(px - R.stepsMark.x, pz - R.stepsMark.z) < 3.6) this._play('chair');
    if ((this.step === 'night1' || this.step === 'night2') && !this.wispBusy) {
      const tag = this.step === 'night1' ? 't1' : 't2';
      const sh = this.links.shades;
      if (!sh.hasTarget(tag)) {
        this.timer -= dt;
        if (this.timer <= 0) {
          const t = tag === 't1' ? R.target1 : R.target2;
          if (sh.spawnTarget(t.x, t.z, tag, { path: t.path, tough: 3.2 })) this.timer = 5;
        }
      }
    }
  }

  // 흩어진 그늘이. 목표 그림자면 정해진 창으로 보내고 true(main이 따로 보내지 않는다).
  onReturned(p) {
    if (!this.ch || !p.tag) return false;
    const R = this.river;
    const first = p.tag === 't1';
    this._setFlag(first ? 'home1' : 'home2');
    this.wispBusy = true;
    const bed = first ? R.doorBed : R.windowBed;
    const { wisps, shades } = this.links;
    this.api.sound('banish');
    wisps.spawn(p, { x: bed.x, y: 2.4, z: bed.z }, () => {
      this.wispBusy = false;
      if (this.ch !== 4) return;
      wisps.flash({ x: bed.x, y: 1.6, z: bed.z });
      this.api.sound('hint');
      this.api.toast(first ? '빛이 문가 쪽 창으로 들어갔다.' : '빛이 창가 쪽 창으로 들어갔다.', 'story');
      shades.clear();
      this._refresh();
    });
    return true;
  }

  // 2장의 해질녘·밤·새벽 안내
  onTime(ev) {
    if (this.ch !== 2) return null;
    if (ev === 'dusk') return ['해가 진다. 부두 돌계단의 고정등 아래로 가자.', 'warn'];
    if (ev === 'night') return ['그늘이가 섬으로 올라온다.', 'warn'];
    if (ev === 'dawn') return ['섬에 날이 밝는다.', 'good'];
    return null;
  }

  // ---------------------------------------------------------------- 매 프레임 연출(모든 상태)

  tick(dt, t, night, player) {
    if (this.stage) this.stage.night = night;
    for (const st of [this.lake, this.river]) {
      for (const L of st.lamps) {
        L.level += ((L.on ? 1 : 0) - L.level) * (1 - Math.exp(-dt * 3));
        const k = L.level;
        const g = k * (0.3 + 0.7 * night);
        L.headMat.color.setRGB(0.12 + g * 6.5, 0.12 + g * 5.0, 0.12 + g * 3.0);
        L.poolMat.opacity = k * night * 0.55;
        L.light.level = k * night;
      }
    }
    const glow = 0.2 + 0.8 * night;
    this.river.winMat.color.setRGB(1.0 * glow * 2.2, 0.78 * glow * 2.2, 0.48 * glow * 2.2);
    this.oilMat.color.setRGB((1.2 + 0.2 * Math.sin(t * 9)) * 2.4, 1.1, 0.35);
    // 2장 나룻배: 장면이 도는 동안 섬으로 저어 간다.
    if (this.rowing) {
      const r = this.rowing;
      r.t = Math.min(1, r.t + dt / r.dur);
      const e = r.t * r.t * (3 - 2 * r.t);
      const boat = this.story.boat;
      boat.position.set(r.from.x + (r.to.x - r.from.x) * e, Math.sin(t * 2.2) * 0.03, r.from.z + (r.to.z - r.from.z) * e);
      boat.rotation.set(Math.sin(t * 1.7) * 0.03, r.from.a, 0);
      player.pos.set(boat.position.x - Math.sin(r.from.a) * 0.4, 0.22, boat.position.z - Math.cos(r.from.a) * 0.4);
      player.model.rotation.y = r.from.a;
    }
  }

  // 카메라가 장면에서 바라볼 곳
  anchor(name) {
    const a = this.anchors[name];
    return a ? { x: a.x, z: a.z } : null;
  }

  // 가까이 있는 인물의 이름표 { text, x, y, z }
  labels(x, z, range = 9) {
    const out = [];
    for (const n of Object.values(this.npcs)) {
      if (!n.mesh.visible || !n.label) continue;
      const p = n.mesh.position;
      if (Math.hypot(p.x - x, p.z - z) > range) continue;
      out.push({ text: n.label, x: p.x, y: p.y + n.top, z: p.z });
    }
    return out;
  }

  // 4장 손전등 전지 보충
  get canRecharge() {
    return this.ch === 4 && this.night;
  }

  // ---------------------------------------------------------------- 인물 배치

  _npc(id, look, label, { pose = 'stand', seat = 0.45, lie = false } = {}) {
    const mesh = new THREE.Mesh(personGeo(LOOKS[look], pose, seat), this.world.staticMat);
    mesh.castShadow = !lie; // 잠든 사람에게는 그림자가 없다(그림자가 떨어져 나갔다)
    mesh.receiveShadow = true;
    mesh.visible = false;
    this.root.add(mesh);
    this.npcs[id] = { mesh, label, lie, top: pose === 'sit' ? seat + 1.5 : lie ? 0.6 : 2.05 };
    return this.npcs[id];
  }

  _show(id, at, a = 0) {
    const n = this.npcs[id];
    if (!at) {
      n.mesh.visible = false;
      return;
    }
    n.mesh.visible = true;
    n.mesh.position.set(at.x, at.y ?? this.stage?.heightAt(at.x, at.z) ?? 0, at.z);
    if (n.lie) n.mesh.rotation.set(-Math.PI / 2, 0, 0, 'YXZ');
    n.mesh.rotation.y = a;
  }

  // 진행에 맞춰 인물·배·등을 둔다.
  _dress() {
    for (const n of Object.values(this.npcs)) n.mesh.visible = false;
    const S = (id) => this.story.isSeen(id);
    const G = (f) => this.flags.has(f);
    const L = this.lakeRefs;
    const R = this.river;
    this.workBoat.visible = this.ch === 2 && S('relief');
    for (const lamp of this.lake.lamps) lamp.on = this.ch === 2;
    R.lampDoor.on = this.ch === 4 && G('lampDoor');
    R.lampYard.on = this.ch === 4 && G('lampYard');
    R.chairShade.visible = this.ch === 4 && G('lampDoor') && G('lampYard');
    if (this.ch === 2) {
      if (this.step === 'ferry' || this.step === 'landing') this._show('gran', L.granPier, L.granPier.a);
      else this._show('gran', L.granTable, L.granTable.a);
      if (S('relief')) this._show('ownerSit', L.ownerSteps, L.ownerSteps.a);
    } else if (this.ch === 3) {
      this._show('pharm', R.pharmTent, 0);
      this._show('gran', S('count') ? R.granTent : R.granStart, S('count') ? 0 : Math.PI / 2);
      this._show('patientTent', R.stretcher, 0);
      R.villagers.forEach((v, i) => this._show(`n${i + 1}`, v, 0));
      this._show('momLie', R.windowBedLie, 0);
    } else if (this.ch === 4) {
      this._show('pharm', R.pharmSteps, Math.PI / 2 + 0.4);
      this._show('granSit', R.granChair, -Math.PI / 2);
      this._show('jeongSit', R.jeongChair, -Math.PI / 2);
      if (G('home1')) this._show('patientSit', R.doorBedSit, 0);
      else this._show('patientLie', R.doorBedLie, 0);
      if (G('home2')) this._show('momSit', R.windowBedSit, 0);
      else this._show('momLie', R.windowBedLie, 0);
    }
  }

  _moorAtIsland() {
    const m = this.lakeRefs.mooring;
    this.story.boat.position.set(m.x, 0, m.z);
    this.story.boat.rotation.set(0, m.a, 0);
  }

  // 2장: 마을 선착장에서 배를 타고 섬으로(나루 장면이 도는 동안 저어 간다)
  _row() {
    const h = this.story.boatHome;
    const m = this.lakeRefs.mooring;
    this.rowing = { t: 0, dur: 9, from: { x: h.x, z: h.z, a: h.a }, to: { x: m.x, z: m.z } };
    this.links.player.flashOn = false;
    this._play('ferry');
  }

  // ---------------------------------------------------------------- 등

  _lamp(b, stage, x, z, on, y0 = 0) {
    b.add(geo.cyl(6), x, y0 + 1.7, z, 0.14, 3.4, 0.14, 0x3c4245);
    b.add(geo.box(), x, y0 + 3.42, z + 0.25, 0.1, 0.08, 0.6, 0x3c4245);
    const headMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
    const head = new THREE.Mesh(this.headGeo, headMat);
    head.position.set(x, y0 + 3.28, z + 0.52);
    head.scale.set(1, 0.6, 1);
    const poolMat = new THREE.MeshBasicMaterial({
      map: this.poolTex, color: new THREE.Color(1.0, 0.76, 0.46), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0,
    });
    const pool = new THREE.Mesh(this.poolGeo, poolMat);
    pool.position.set(x, y0 + 0.07, z);
    pool.scale.set(LAMP_RADIUS * 2.3, 1, LAMP_RADIUS * 2.3);
    pool.renderOrder = 2;
    this.root.add(head, pool);
    const L = { x, z, r: LAMP_RADIUS, on, level: on ? 1 : 0, headMat, poolMat, light: { level: 0, power: 34 } };
    this.world.cands.push({ kind: 1, ref: L.light, x, y: y0 + 3.0, z: z + 0.4, color: WARM, i: 0, d: 0 });
    stage.lamps.push(L);
    stage.colliders.push({ t: 1, x, z, r: 0.16 });
    return L;
  }

  // ---------------------------------------------------------------- 2장 무대: 마을 선착장과 등대섬

  _buildLake() {
    const story = this.story;
    // 높이: 섬 윗면, 섬 부두·마을 선착장 판자, 물가 모래
    const onPier = (f, x, z, z0, z1) => {
      const dx = x - f.x;
      const dz = z - f.z;
      const lz = dx * f.s + dz * f.c;
      return Math.abs(dx * f.c - dz * f.s) < 1.1 && lz > z0 && lz < z1;
    };
    const st = new Stage('lake', (x, z) => {
      if ((x - LAKE.x) ** 2 + (z - LAKE.z) ** 2 < (ISLAND.r + 0.6) ** 2) return ISLAND.top;
      if (onPier(story.islandPier, x, z, ISLAND.r, ISLAND.pier + 0.2) || onPier(story.dockPier, x, z, -1.4, 7.6)) return 0.48;
      return 0.02;
    });
    st.spawnRange = [6, 11];
    const b = new Builder();
    const pf = story.islandPier;
    const df = story.dockPier;
    const hf = story.hut;
    const R = ISLAND.r;
    // 걸을 수 있는 곳: 섬, 섬 부두, 마을 쪽 물가 빈터와 선착장
    st.circle(LAKE.x, LAKE.z, R);
    st.rect(pf, -0.95, 0.95, R - 1.2, ISLAND.pier - 0.1);
    st.rect(df, -5, 5, -7.5, -1.4);
    st.rect(df, -0.75, 0.75, -1.6, 7.3);
    // 등대·당직실·밥상·나무
    st.colliders.push({ t: 1, x: LAKE.x, z: LAKE.z, r: 1.75 });
    st.colliders.push({ t: 1, x: hf.x, z: hf.z, r: 1.95 });
    st.colliders.push({ t: 1, x: hf.px(0.75, 2.25), z: hf.pz(0.75, 2.25), r: 0.72 });
    for (const [hx, hz, r] of [[-2.6, -0.6, 0.6], [2.3, 0.6, 0.35], [-0.8, -2.4, 0.1], [1.2, -2.4, 0.1]]) st.colliders.push({ t: 1, x: hf.px(hx, hz), z: hf.pz(hx, hz), r });
    for (const [ox, oz] of [[-5.6, -4.4], [-3.2, -6.4], [-6.8, -1.2], [1.2, -7.0]]) st.colliders.push({ t: 1, x: LAKE.x + ox, z: LAKE.z + oz, r: 0.35 });
    st.calm.push({ x0: hf.x - 2.2, x1: hf.x + 2.2, z0: hf.z - 2.2, z1: hf.z + 2.2 });
    // 돌계단 위 고정등, 부두 보관함, 마을 선착장 등
    this._lamp(b, st, pf.px(1.25, R - 1.5), pf.pz(1.25, R - 1.5), true, ISLAND.top);
    this._lamp(b, st, df.px(-1.7, -2.6), df.pz(-1.7, -2.6), true);
    const bx = pf.px(-0.55, 12.4);
    const bz = pf.pz(-0.55, 12.4);
    pf.add(b, geo.box(), -0.55, 0.78, 12.4, 0.8, 0.6, 0.55, 0x3f6a8a);
    pf.add(b, geo.box(), -0.55, 1.1, 12.4, 0.84, 0.06, 0.6, 0x335874);
    pf.add(b, geo.box(), -0.55, 0.82, 12.69, 0.3, 0.12, 0.02, 0xe8e2d0);
    st.colliders.push({ t: 1, x: bx, z: bz, r: 0.42 });
    // 당직실 벽의 인계부
    hf.add(b, geo.box(), -1.05, 1.55, 1.34, 0.62, 0.78, 0.05, 0x5d4a3a);
    hf.add(b, geo.box(), -1.05, 1.55, 1.37, 0.5, 0.64, 0.02, 0xf2ecdc);
    hf.add(b, geo.box(), -1.05, 1.98, 1.36, 0.08, 0.1, 0.04, 0xb8b2a4);
    // 작업배(교대 온 식당 주인이 타고 온 배)
    const wb = new Builder();
    wb.add(geo.box(), 0, 0.25, 0, 1.5, 0.5, 3.6, 0x3f6a8a);
    wb.add(geo.box(), 0, 0.32, 0, 1.3, 0.42, 3.3, 0x2b4a60);
    wb.add(geo.box(), 0, 0.42, 1.95, 1.0, 0.36, 0.5, 0x3f6a8a, 0, 0.3);
    wb.add(geo.box(), 0, 0.95, -0.6, 1.1, 0.9, 1.2, 0xe8e6de);
    wb.add(geo.box(), 0, 1.44, -0.6, 1.24, 0.08, 1.36, 0x5a6062);
    wb.add(geo.box(), 0, 1.05, -0.02, 0.8, 0.4, 0.04, 0x9fc4c8);
    this.workBoat = new THREE.Mesh(wb.build(), this.world.staticMat);
    this.workBoat.castShadow = true;
    this.workBoat.position.set(pf.px(-1.95, 12.0), 0, pf.pz(-1.95, 12.0));
    this.workBoat.rotation.y = pf.a + Math.PI;
    this.workBoat.visible = false;
    this.root.add(this.workBoat);

    const mesh = new THREE.Mesh(b.build(), this.world.staticMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);

    // 흩어진 그림자는 물 건너 마을 쪽으로 날아간다.
    for (const an of [Math.PI / 4 - 0.5, Math.PI / 4, Math.PI / 4 + 0.5]) {
      st.homes.push({ x: LAKE.x + Math.cos(an) * (LAKE.r + 14), y: 2.2, z: LAKE.z + Math.sin(an) * (LAKE.r + 14) });
    }

    const at = (f, lx, lz, a = 0, y) => ({ x: f.px(lx, lz), z: f.pz(lx, lz), a: f.a + a, y });
    this.lakeRefs = {
      mooring: at(pf, 1.7, 11.8, Math.PI),
      granPier: at(pf, 0.7, R + 0.2, 0, ISLAND.top),
      granTable: at(hf, 2.0, 2.25, -Math.PI / 2, ISLAND.top),
      ownerSteps: at(pf, -0.75, R - 0.3, 0, 0.18),
    };
    this.villageStart = at(df, 0.6, -4.8);
    this.pierEnd = at(pf, 0, ISLAND.pier - 0.8, Math.PI);
    this.anchors = {
      lake: { x: LAKE.x + 19.5 * U, z: LAKE.z + 19.5 * U },
      pier: at(pf, 0, R + 1.6),
      table: at(hf, 0.75, 2.6),
    };

    this._npc('gran', 'gran', '할머니');
    this._npc('ownerSit', 'owner', '식당 주인', { pose: 'sit', seat: 0.36 });

    const add = (s) => this.spots.push({ stage: st, ...s });
    add({ id: 'boatVillage', x: story.boatHome.x, z: story.boatHome.z, reach: 2.4, top: 1.2, show: () => this.step === 'ferry', label: '나룻배에 오르기', dur: 0.8, act: () => this._row() });
    add({
      id: 'book', clue: 'islandbook', x: hf.px(-1.05, 2.35), z: hf.pz(-1.05, 2.35), top: 2.4, show: () => this.story.isUnlocked('islandbook'),
      label: () => `${this.story.isFound('islandbook') ? '다시 읽기' : '읽기'} · 인계부`, act: () => this._readClue('islandbook'),
    });
    add({
      id: 'spare', clue: 'spare', x: pf.px(0.25, 12.4), z: pf.pz(0.25, 12.4), top: 1.6, show: () => this.story.isUnlocked('spare'),
      label: () => (this.story.isFound('spare') ? '다시 읽기 · 예비 송수신기 종이띠' : '보관함 열기 · 예비 송수신기'), act: () => this._readClue('spare'),
    });
    add({ id: 'call', x: pf.px(0, R - 1.0), z: pf.pz(0, R - 1.0), top: 2.0, show: () => this.step === 'call', label: '예비 무전기로 다음 당직자 부르기', dur: 1.0, act: () => this._play('relief') });
    add({ id: 'boatIsland', x: this.lakeRefs.mooring.x, z: this.lakeRefs.mooring.z, reach: 2.3, top: 1.2, show: () => this.step === 'leave', label: '나룻배로 마을에 돌아가기', dur: 0.8, act: () => this.api.next() });
    return st;
  }

  // ---------------------------------------------------------------- 3·4장 무대: 강 건너 옛 학교

  _riverHeight(x, z) {
    if (x >= -10.4 && x <= 4.4 && z >= 5.6 && z <= 22.4) return 0.52; // 별관 교실 바닥
    if (z >= 12.3 && z <= 15.7 && x > 4.4 && x <= 6.5) return x < 5.1 ? 0.42 : x < 5.8 ? 0.28 : 0.14; // 교실 계단
    if (x >= -79.2 && x <= -76.8 && z < -29) return 0.48; // 나루 부두
    let h = 0;
    if (z >= -29.5 && z <= -19.5) {
      h = z < -27 ? (z + 29.5) / 2.5 : z <= -22 ? 1 : (-19.5 - z) / 2.5;
      h *= 0.7 * clamp(1 - (x - 32) / 8, 0, 1);
    }
    return 0.02 + h;
  }

  _buildRiver() {
    const st = new Stage('river', (x, z) => this._riverHeight(x - RIVER.x, z - RIVER.z));
    st.spawnRange = [8, 14];
    const b = new Builder();
    const f = new Frame(RIVER.x, RIVER.z, 0);
    const A = (g, lx, ly, lz, sx, sy, sz, c, ry = 0, rx = 0, rz = 0) => f.add(b, g, lx, ly, lz, sx, sy, sz, c, ry, rx, rz);
    const box = (x0, x1, z0, z1) => st.colliders.push({ t: 0, x0: RIVER.x + x0, x1: RIVER.x + x1, z0: RIVER.z + z0, z1: RIVER.z + z1 });
    const circ = (x, z, r) => st.colliders.push({ t: 1, x: RIVER.x + x, z: RIVER.z + z, r });
    const P = (x, z, extra = {}) => ({ x: RIVER.x + x, z: RIVER.z + z, ...extra });
    const tree = (x, z, s = 1) => {
      A(geo.cyl(6), x, 0.9 * s, z, 0.3 * s, 1.8 * s, 0.3 * s, 0x6b4e3a);
      A(geo.ico(1), x, 2.5 * s, z, 2.6 * s, 2.2 * s, 2.6 * s, 0x5f7a46);
      circ(x, z, 0.35 * s);
    };

    st.rect(f, -86, 70, -29.3, 40);
    st.rect(f, -79.1, -76.9, -35.8, -29);
    // 땅·강·둑길
    A(geo.box(), 0, -0.05, -10, 220, 0.1, 200, 0x7d8d5b);
    const water = new THREE.Mesh(
      new THREE.BoxGeometry(220, 0.04, 17),
      new THREE.MeshStandardMaterial({ color: 0x406a74, roughness: 0.28, metalness: 0.05 }),
    );
    water.position.set(RIVER.x, 0.03, RIVER.z - 38);
    water.receiveShadow = true;
    this.root.add(water);
    A(geo.box(), 0, 0.03, -30.1, 220, 0.04, 1.6, 0x8a7a5a);
    A(geo.box(), -27, 0.35, -24.5, 118, 0.7, 5, 0xa8946a);
    A(geo.box(), -23, 0.35, -28.25, 126, 0.12, 2.6, 0x86965c, 0, -0.273);
    A(geo.box(), -23, 0.35, -20.75, 126, 0.12, 2.6, 0x86965c, 0, 0.273);
    A(geo.box(), 36, 0.35, -24.5, 8.05, 0.12, 5, 0xa8946a, 0, 0, -0.0873);
    // 강 건너 마을(흩어진 그림자가 돌아가는 집)
    const winB = new Builder();
    [-70, -48, -26, -4, 18, 40].forEach((hx, i) => {
      const col = [0xe2d6bd, 0xd9cfbf, 0xc9b9a0][i % 3];
      A(geo.box(), hx, 1.3, -55, 5, 2.6, 4, col);
      A(geo.gable(), hx, 3.1, -55, 4.2, 1.0, 5.4, [0x6d4e42, 0x5a6a7a, 0x8a3a32][i % 3], Math.PI / 2);
      winB.add(geo.box(), RIVER.x + hx + 1.1, 1.5, RIVER.z - 52.98, 0.9, 0.8, 0.04, 0xffffff);
      st.homes.push({ x: RIVER.x + hx + 1.1, y: 1.6, z: RIVER.z - 52.6 });
      tree(hx + 3.6, -58, 0.9);
    });
    // 나루: 부두, 매어 둔 나룻배, 푯말
    A(geo.box(), -78, 0.42, -32.5, 2.2, 0.12, 7, 0x8f6c4e);
    for (let k = -35.5; k < -29.5; k += 1) A(geo.box(), -78, 0.49, k, 2.22, 0.02, 0.06, 0x6e543d);
    for (const sx of [-79, -77]) for (const pz of [-35.8, -32.5, -29.6]) A(geo.cyl(6), sx, 0.3, pz, 0.16, 1.0, 0.16, 0x5a4232);
    A(geo.box(), -80.3, 0.2, -33.5, 1.05, 0.38, 2.6, 0x7a4f36);
    A(geo.box(), -80.3, 0.27, -33.5, 0.85, 0.3, 2.3, 0x4f3627);
    A(geo.box(), -74.6, 1.0 + 0.7, -22.2, 0.12, 2.0, 0.12, 0x5d4a3a);
    A(geo.box(), -74.6, 2.4 + 0.7, -22.1, 1.3, 0.5, 0.08, 0xe9e2cc);
    // 물에 잠긴 옛길(통행 금지)
    A(geo.box(), -40, 0.01, -9, 92, 0.02, 6, 0x5a6062);
    for (const [px, pz, sx, sz] of [[-60, -9, 9, 4.6], [-44, -8.4, 12, 5], [-26, -9.4, 7, 4], [-12, -8.8, 10, 4.8]]) A(geo.box(), px, 0.025, pz, sx, 0.02, sz, 0x4a6a72);
    for (const bz of [-11, -7]) A(geo.box(), -68, 0.5, bz, 0.12, 1.0, 0.12, 0x3a3f44);
    for (const [k, c] of [[0, 0xd8d4c8], [1, 0xc8372d], [2, 0xd8d4c8], [3, 0xc8372d]]) A(geo.box(), -68, 0.85, -10.25 + k * 0.85, 0.08, 0.22, 0.84, c);
    box(-68.2, -67.8, -11.2, -6.8);
    // 둑길 가로등
    for (const lx of [-62, -34, -6, 22]) this._lamp(b, st, RIVER.x + lx, RIVER.z - 20.6, true);
    this._lamp(b, st, RIVER.x - 72.6, RIVER.z - 21.0, true, 0.5);
    for (const tx of [-56, -18, 8]) tree(tx, -16.5, 1.1);

    // 둑길 창고: 문(동쪽)·벽의 명부·바깥 선반의 소지품 봉투
    A(geo.box(), -40, 1.4, -15, 7, 2.8, 4.5, 0xb8b2a4);
    A(geo.box(), -40, 2.95, -15, 7.6, 0.12, 5.2, 0x5a7a96, 0, 0.12);
    A(geo.box(), -36.47, 1.0, -15.4, 0.05, 2.0, 1.4, 0x2f2a26);
    A(geo.box(), -35.9, 2.3, -15.2, 1.2, 0.08, 4.2, 0x5a7a96, 0, 0, -0.2);
    A(geo.box(), -36.42, 1.55, -13.5, 0.05, 0.78, 0.62, 0x5d4a3a);
    A(geo.box(), -36.39, 1.55, -13.5, 0.02, 0.64, 0.5, 0xf2ecdc);
    for (const sy of [0.45, 0.95]) A(geo.box(), -35.9, sy, -16.8, 0.5, 0.06, 1.0, 0x8a6a48);
    for (const sz of [-17.25, -16.35]) A(geo.box(), -35.9, 0.55, sz, 0.5, 1.1, 0.06, 0x6e543d);
    A(geo.box(), -35.9, 1.1, -16.9, 0.32, 0.22, 0.4, 0xc9a86a);
    A(geo.box(), -35.85, 0.6, -16.6, 0.3, 0.24, 0.3, 0xb08a4a);
    box(-43.5, -36.5, -17.25, -12.75);
    circ(-35.9, -16.8, 0.5);

    // 옛 학교 본관(2층). 아래층 동쪽은 구호소로 쓰여 밤에도 불이 켜져 있다.
    A(geo.box(), 31, 3.3, -15, 38, 6.6, 8, 0xd9cfbf);
    A(geo.box(), 31, 0.45, -10.96, 38.1, 0.9, 0.1, 0x9a8f80);
    A(geo.box(), 31, 6.75, -15, 38.4, 0.3, 8.4, 0x9a8f80);
    for (let fl = 0; fl < 2; fl++) {
      for (let i = 0; i < 12; i++) {
        const wx = 13.8 + i * 3.1;
        if (fl === 0 && Math.abs(wx - 31) < 2) continue;
        if (fl === 0 && i >= 7) winB.add(geo.box(), RIVER.x + wx, 1.9 + fl * 3.0, RIVER.z - 10.93, 1.5, 1.1, 0.04, 0xffffff);
        else A(geo.box(), wx, 1.9 + fl * 3.0, -10.95, 1.5, 1.1, 0.04, 0x6d8a92);
      }
    }
    A(geo.box(), 31, 1.2, -10.95, 2.4, 2.4, 0.06, 0x3a3532);
    A(geo.box(), 31, 2.6, -10.2, 3.2, 0.12, 1.6, 0x5a6062);
    box(12, 50, -19, -11);
    this._lamp(b, st, RIVER.x + 33.4, RIVER.z - 9.6, true);

    // 구호소 천막: 들것 둘(하나는 비었다), 신발 열한 켤레, 탁자의 무전기와 등, 깨어난 이웃의 걸상
    A(geo.box(), 42, 2.7, -5, 9, 0.1, 5, 0xeef0ec);
    A(geo.gable(), 42, 3.15, -5, 5.2, 0.8, 9.2, 0xe6e8e4, Math.PI / 2);
    for (const px of [37.6, 42, 46.4]) for (const pz of [-7.4, -2.6]) {
      A(geo.cyl(6), px, 1.35, pz, 0.1, 2.7, 0.1, 0x8a9096);
      circ(px, pz, 0.12);
    }
    for (const [sx, c] of [[39.4, 0x6f7a5a], [41.6, 0x6f7a5a]]) {
      A(geo.box(), sx, 0.35, -5.6, 0.72, 0.06, 2.0, c);
      for (const lz of [-6.5, -4.7]) A(geo.box(), sx, 0.18, lz, 0.72, 0.36, 0.06, 0x5a5f64);
      box(sx - 0.4, sx + 0.4, -6.65, -4.55);
    }
    const shoeCols = [0x3a3f44, 0x8a3a32, 0x5a4a3a, 0xe9e6dc, 0x3f5a7a, 0x6b4e3a, 0x2a2a2a, 0xb08a4a, 0x5a6a4a, 0x7a5a8a, 0x4a3a2a];
    for (let i = 0; i < 11; i++) {
      const sx = 37.9 + i * 0.62;
      for (const o of [-0.08, 0.08]) A(geo.box(), sx + o, 0.06, -3.55, 0.11, 0.08, 0.26, shoeCols[i]);
    }
    A(geo.box(), 45.6, 0.8, -6.4, 1.6, 0.06, 0.8, 0x9a6e4c);
    for (const [tx, tz] of [[-0.7, -0.3], [0.7, -0.3], [-0.7, 0.3], [0.7, 0.3]]) A(geo.box(), 45.6 + tx, 0.4, -6.4 + tz, 0.06, 0.8, 0.06, 0x6e543d);
    A(geo.box(), 45.2, 0.98, -6.4, 0.34, 0.3, 0.18, 0x3a3f44);
    A(geo.box(), 45.2, 1.2, -6.4, 0.03, 0.3, 0.03, 0x2a2a2a);
    box(44.7, 46.5, -6.85, -5.95);
    A(geo.box(), 45, 0.42, -7.9, 3.8, 0.08, 0.5, 0x8a6a48);
    for (const lx of [43.4, 46.6]) A(geo.box(), lx, 0.2, -7.9, 0.08, 0.4, 0.4, 0x6e543d);
    box(43, 47, -8.2, -7.6);
    this._lamp(b, st, RIVER.x + 36.6, RIVER.z - 2.2, true);

    // 구령대(방송대): 확성기 기둥 둘, 송신기 놓인 책상
    A(geo.box(), 26, 0.5, -2.2, 6.4, 1.0, 3.0, 0xbdb6a6);
    for (let k = 0; k < 2; k++) A(geo.box(), 26, 0.17 + k * 0.33, -0.45 + (1 - k) * 0.35, 3.2, 0.34 + k * 0.33, 0.36, 0xc9c2b2);
    for (const px of [22.6, 29.4]) {
      A(geo.cyl(6), px, 2.25, -3.3, 0.14, 4.5, 0.14, 0x5a6062);
      A(geo.cone(8), px, 4.3, -3.0, 0.5, 0.7, 0.5, 0xd8d4c8, 0, Math.PI / 2 - 0.25);
    }
    A(geo.box(), 26, 1.4, -2.6, 1.4, 0.8, 0.6, 0x6e543d);
    A(geo.box(), 25.8, 1.92, -2.6, 0.4, 0.24, 0.26, 0x3a3f44);
    A(geo.cyl(6), 26.4, 2.1, -2.5, 0.04, 0.6, 0.04, 0x2a2a2a);
    box(22.8, 29.2, -3.7, -0.7);
    circ(22.6, -3.3, 0.18);
    circ(29.4, -3.3, 0.18);

    // 운동장: 흙바닥, 흰 선, 골대 둘
    A(geo.box(), 34, 0.012, 19, 52, 0.02, 34, 0xb89a6e);
    for (const [cx, cz, sx, sz] of [[34, 3.2, 48, 0.12], [34, 34.8, 48, 0.12], [10.1, 19, 0.12, 31.6], [57.9, 19, 0.12, 31.6], [34, 19, 0.12, 31.6]]) A(geo.box(), cx, 0.028, cz, sx, 0.012, sz, 0xe9e6dc);
    for (const gx of [12, 56]) {
      for (const gz of [16, 21]) {
        A(geo.cyl(6), gx, 1.2, gz, 0.12, 2.4, 0.12, 0xe9e6dc);
        circ(gx, gz, 0.14);
      }
      A(geo.box(), gx, 2.4, 18.5, 0.12, 0.12, 5.1, 0xe9e6dc);
      A(geo.box(), gx + (gx < 30 ? -0.9 : 0.9), 1.2, 18.5, 0.04, 2.3, 5.0, 0xc9ccc8);
    }
    for (let tx = 10; tx <= 58; tx += 8) tree(tx, 39.5, 1.0);
    for (let tz = 10; tz <= 34; tz += 8) tree(66, tz, 0.95);

    // 별관 동쪽 교실(지붕 없이 안을 보인다): 뒤 벽(북·서)의 창, 앞쪽 허리 벽, 동쪽 문과 계단
    A(geo.box(), -3, 0.25, 14, 14.8, 0.5, 16.8, 0x9a8f80);
    A(geo.box(), -3, 0.51, 14, 14.0, 0.02, 16.0, 0xb08a5a);
    A(geo.box(), -3, 2.05, 5.9, 14.8, 3.1, 0.6, 0xe6dccb);
    A(geo.box(), -10.1, 2.05, 14, 0.6, 3.1, 16.8, 0xe6dccb);
    A(geo.box(), -3, 3.68, 5.3, 15.6, 0.16, 1.6, 0x5a6062);
    A(geo.box(), -10.7, 3.68, 14, 1.6, 0.16, 17.6, 0x5a6062);
    for (const wx of [-7.2, -3.0, 1.2]) {
      A(geo.box(), wx, 2.25, 6.22, 2.1, 1.5, 0.05, 0x5d6a6e);
      A(geo.box(), wx, 2.25, 6.24, 1.9, 1.3, 0.04, 0x9fc4c8);
      A(geo.box(), wx, 1.45, 6.4, 2.2, 0.08, 0.3, 0xd9cfbf);
    }
    A(geo.box(), -9.77, 2.1, 14, 0.05, 1.3, 4.0, 0x2f4a3a);
    A(geo.box(), -3, 1.0, 22.1, 14.8, 1.0, 0.6, 0xe6dccb);
    A(geo.box(), 4.1, 1.0, 9.05, 0.6, 1.0, 6.9, 0xe6dccb);
    A(geo.box(), 4.1, 1.0, 18.95, 0.6, 1.0, 6.9, 0xe6dccb);
    for (const dz of [12.4, 15.6]) A(geo.box(), 4.1, 1.8, dz, 0.7, 2.6, 0.2, 0xd9cfbf);
    for (let k = 0; k < 3; k++) A(geo.box(), 4.75 + k * 0.7, 0.21 - k * 0.07, 14, 0.7, 0.42 - k * 0.14, 3.4, 0xc9c2b2);
    box(-10.4, 4.4, 5.6, 6.2);
    box(-10.4, -9.8, 5.6, 22.4);
    box(-10.4, 4.4, 21.8, 22.4);
    box(3.8, 4.4, 5.6, 12.5);
    box(3.8, 4.4, 15.5, 22.4);
    st.calm.push({ x0: RIVER.x - 10.5, x1: RIVER.x + 6.6, z0: RIVER.z + 5.5, z1: RIVER.z + 22.5 });
    // 침대 둘(문가·창가)과 보호자 의자, 교탁, 밀어 둔 책걸상, 창턱의 석유등
    const bed = (bx) => {
      A(geo.box(), bx, 0.8, 8.6, 1.0, 0.08, 2.0, 0x8a9096);
      A(geo.box(), bx, 0.92, 8.6, 0.92, 0.16, 1.9, 0xe9e6dc);
      A(geo.box(), bx, 1.04, 7.85, 0.6, 0.1, 0.36, 0xf2f0ea);
      for (const [lx, lz] of [[-0.45, -0.95], [0.45, -0.95], [-0.45, 0.95], [0.45, 0.95]]) A(geo.box(), bx + lx, 0.62, 8.6 + lz, 0.06, 0.3, 0.06, 0x6e747a);
      box(bx - 0.55, bx + 0.55, 7.55, 9.65);
    };
    bed(1.2);
    bed(-7.2);
    const chair = (cx) => {
      A(geo.box(), cx, 0.95, 9.2, 0.5, 0.06, 0.5, 0x9a6e4c);
      A(geo.box(), cx + 0.22, 1.3, 9.2, 0.06, 0.66, 0.5, 0x9a6e4c);
      for (const [lx, lz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) A(geo.box(), cx + lx, 0.72, 9.2 + lz, 0.05, 0.42, 0.05, 0x6e543d);
      circ(cx, 9.2, 0.32);
    };
    chair(2.5);
    chair(-5.9);
    A(geo.box(), -8.4, 0.95, 14, 0.9, 0.8, 1.6, 0x8a6a48);
    box(-8.85, -7.95, 13.2, 14.8);
    for (const [dx, dz] of [[-8.4, 19.5], [-6.6, 20.4], [-8.2, 20.9]]) {
      A(geo.box(), dx, 0.92, dz, 1.0, 0.06, 0.6, 0x9a6e4c);
      A(geo.box(), dx, 0.72, dz, 0.9, 0.4, 0.5, 0x6e747a);
    }
    box(-9, -6, 19, 21.4);
    A(geo.box(), -7.9, 1.62, 6.42, 0.18, 0.28, 0.18, 0x3a3f44);
    this.oilMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const oil = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), this.oilMat);
    oil.position.set(RIVER.x - 7.9, 1.86, RIVER.z + 6.42);
    this.root.add(oil);
    // 두 예비등이 켜지면 보호자 의자 밑에만 그림자가 진다(잠든 두 사람 밑은 여전히 비어 있다).
    const shadeMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.42, depthWrite: false });
    const chairShade = new THREE.Group();
    for (const cx of [2.5, -5.9]) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(0.42, 16).rotateX(-Math.PI / 2), shadeMat);
      m.position.set(RIVER.x + cx - 0.25, 0.535, RIVER.z + 9.45);
      m.scale.set(1.3, 1, 0.8);
      chairShade.add(m);
    }
    chairShade.visible = false;
    this.root.add(chairShade);
    const lampDoor = this._lamp(b, st, RIVER.x + 6.9, RIVER.z + 11.3, false);

    // 운동장 당직실: 남쪽 벽의 점호판, 예비등, 예비 전지 상자
    A(geo.box(), 64, 1.3, 2.5, 6, 2.6, 5, 0xe2d6bd);
    A(geo.gable(), 64, 3.05, 2.5, 5.4, 0.9, 6.4, 0x6d4e42, Math.PI / 2);
    A(geo.box(), 62.2, 1.0, 5.02, 0.9, 2.0, 0.05, 0x4b3a32);
    A(geo.box(), 65.9, 1.6, 5.02, 0.9, 0.7, 0.05, 0x9fc4c8);
    A(geo.box(), 64.2, 1.5, 5.04, 1.2, 0.9, 0.05, 0x7a5a40);
    A(geo.box(), 64.2, 1.5, 5.07, 1.06, 0.76, 0.02, 0x2f4a3a);
    A(geo.box(), 66.4, 0.22, 5.75, 0.6, 0.44, 0.42, 0x3f6a8a);
    A(geo.box(), 66.4, 0.46, 5.75, 0.64, 0.06, 0.46, 0x335874);
    box(61, 67, 0, 5);
    circ(66.4, 5.75, 0.4);
    const lampYard = this._lamp(b, st, RIVER.x + 59.6, RIVER.z + 6.4, false);

    const mesh = new THREE.Mesh(b.build(), this.world.staticMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);
    st.winMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const wins = new THREE.Mesh(winB.build(), st.winMat);
    this.root.add(wins);

    Object.assign(st, {
      lampDoor, lampYard, chairShade,
      start: P(-73.5, -24.4, { a: Math.PI / 2 }),
      storeOut: P(-33.6, -15, { a: -Math.PI / 2 }),
      tentOut: P(40, 0.8, { a: Math.PI }),
      stepsOut: P(7.6, 14, { a: Math.PI / 2 }),
      classOut: P(7.2, 13.2, { a: -Math.PI / 2 }),
      podiumOut: P(26, 2.0, { a: Math.PI }),
      tentMark: P(41, -4.6, { top: 3.6 }),
      stepsMark: P(5.4, 14, { top: 2.4 }),
      doorBed: P(1.2, 8.6),
      windowBed: P(-7.2, 8.6),
      stretcher: P(41.6, -4.75, { y: 0.68 }),
      pharmTent: P(40.3, -2.5),
      granStart: P(-72, -22.8),
      granTent: P(38.4, -2.4),
      villagers: [P(43.8, -7.75), P(45, -7.75), P(46.2, -7.75)],
      windowBedLie: P(-7.2, 9.5, { y: 1.3 }),
      doorBedLie: P(1.2, 9.5, { y: 1.3 }),
      windowBedSit: P(-7.2, 9.3, { y: 0.52 }),
      doorBedSit: P(1.2, 9.3, { y: 0.52 }),
      granChair: P(-5.9, 9.2, { y: 0.52 }),
      jeongChair: P(2.5, 9.2, { y: 0.52 }),
      pharmSteps: P(7.4, 16.6),
      // 4장 목표 그림자: 첫째는 문가 쪽(서쪽) 골대를 돌아 들어오고, 둘째는 운동장 끝(동쪽)에서 곧장 온다.
      target1: P(21, 37, { path: [P(17, 28), P(10.6, 23.6), P(9.6, 19.6)] }),
      target2: P(59, 22, { path: [P(44, 20), P(28, 17)] }),
    });
    Object.assign(this.anchors ??= {}, {
      tent: P(41, -4.6),
      shoes: P(41, -3.6),
      classroom: P(-3, 12.5),
      windowBed: P(-6.4, 9.2),
      doorBed: P(1.8, 9.2),
      steps: P(5.4, 14),
    });

    this._npc('pharm', 'pharm', '약사 한서윤');
    this._npc('patientTent', 'patient', '잠든 사람', { lie: true });
    this._npc('n1', 'n1', '깨어난 이웃', { pose: 'sit', seat: 0.46 });
    this._npc('n2', 'n2', '깨어난 이웃', { pose: 'sit', seat: 0.46 });
    this._npc('n3', 'n3', '깨어난 이웃', { pose: 'sit', seat: 0.46 });
    this._npc('momLie', 'mom', '엄마', { lie: true });
    this._npc('momSit', 'mom', '엄마', { pose: 'sit', seat: 0.5 });
    this._npc('patientLie', 'patient', '낯선 환자', { lie: true });
    this._npc('patientSit', 'patient', '낯선 환자', { pose: 'sit', seat: 0.5 });
    this._npc('granSit', 'gran', '할머니', { pose: 'sit', seat: 0.46 });
    this._npc('jeongSit', 'jeong', '오정석', { pose: 'sit', seat: 0.46 });

    const add = (s) => this.spots.push({ stage: st, ...s });
    const on4 = () => this.ch === 4 && this.story.isSeen('roll');
    add({
      id: 'manifest', clue: 'manifest', ...P(-35.4, -13.5), top: 2.4, show: () => this.ch === 3 && this.story.isUnlocked('manifest'),
      label: () => (!this.flag('flip') && this.story.isFound('tag') ? '17번 맞춰 보기 · 명부와 봉투' : `${this.story.isFound('manifest') ? '다시 읽기' : '읽기'} · 이송 명부`),
      act: () => this._readClue('manifest'),
    });
    add({
      id: 'tag', clue: 'tag', ...P(-35.0, -16.8), top: 1.8, show: () => this.ch === 3 && this.story.isUnlocked('tag'),
      label: () => (!this.flag('flip') && this.story.isFound('manifest') ? '17번 맞춰 보기 · 명부와 봉투' : `${this.story.isFound('tag') ? '다시 보기' : '열어 보기'} · 17번 소지품 봉투`),
      act: () => this._readClue('tag'),
    });
    add({ id: 'return', ...P(40.3, -1.5), reach: 2.2, top: 2.4, show: () => this.step === 'back', label: '약사에게 명부와 짐표 반납하기', dur: 0.8, act: () => this.api.openDoc(clueById('transfer')) });
    const lampAct = (f, where) => () => {
      this._setFlag(f);
      this.api.sound('power');
      this.api.toast(`${where} 예비등을 이었다.`, 'good');
      if (this.flag('lampDoor') && this.flag('lampYard')) {
        this.api.later(1.4, () => this.api.toast('두 등이 켜지자 문가와 창가 의자 밑에 그림자가 생겼다. 두 사람의 몸 밑만 여전히 비어 있다.', 'story'));
      }
      this._refresh();
    };
    add({ id: 'lampDoor', ...P(6.9, 12.3), top: 3.6, show: () => on4() && !this.flag('lampDoor'), label: '예비등 잇기 · 교실 문 앞', dur: 1.4, act: lampAct('lampDoor', '교실 문 앞') });
    add({ id: 'lampYard', ...P(59.6, 7.4), top: 3.6, show: () => on4() && !this.flag('lampYard'), label: '예비등 잇기 · 운동장 당직실', dur: 1.4, act: lampAct('lampYard', '운동장 당직실') });
    add({
      id: 'roster', clue: 'roster', ...P(64.2, 6.0), top: 2.4, show: () => this.ch === 4 && this.story.isUnlocked('roster'),
      label: () => `${this.story.isFound('roster') ? '다시 읽기' : '읽기'} · 당직실 점호판`, act: () => this._readClue('roster'),
    });
    add({
      id: 'battery', ...P(66.4, 6.7), top: 1.4, show: () => this.canRecharge, label: '예비 전지 갈아 끼우기', dur: 0.8,
      blocked: () => (this.links.player.battery >= 95 ? '예비 전지 상자 — 손전등 전지가 아직 넉넉하다' : null),
      act: () => this.api.recharge(),
    });
    add({
      id: 'wait', ...P(5.6, 15.4), top: 2.4, show: () => this.step === 'wait', label: '계단에 앉아 밤을 기다리기', dur: 0.8,
      act: () => {
        this.night = true;
        this.timer = 2.5;
        this.api.card('그날 밤');
        this.api.setHour(20.6);
        this.api.place(this.river.stepsOut);
        this.api.later(1.2, () => this.api.toast('운동장 끝에서 무언가 움직인다. 계단의 불빛 안에서 비추자.', 'warn'));
        this._refresh();
      },
    });
    add({
      id: 'water', ...P(7.4, 16.6), reach: 2.0, top: 2.4, show: () => this.step === 'rest', label: '물 한 모금 받고 다시 비추기', dur: 0.8,
      act: () => {
        this.restDone = true;
        this.timer = 2.5;
        this.links.player.hp = Math.min(100, this.links.player.hp + 30);
        this.api.toast('물을 마셨다. 운동장 끝을 다시 비춘다.', 'good');
        this._refresh();
      },
    });
    add({ id: 'class', ...P(4.0, 14), reach: 2.2, top: 2.6, show: () => this.step === 'class', label: '교실로 들어가기', dur: 0.6, act: () => this._play('truth') });
    add({ id: 'podium', ...P(26, 0.9), reach: 2.0, top: 2.6, show: () => this.step === 'broadcast', label: '송신 단추 누르기', dur: 1.0, act: () => this._play('broadcast') });
    return st;
  }
}
