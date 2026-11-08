// 미니맵: 화면 구석의 작은 지도(내 주변)와 눌러서 펼치는 전체 지도.
// 아이소 카메라와 같은 방향으로 45° 돌려 그린다: 화면 오른쪽 = (1,0,-1)/√2, 아래 = (1,0,1)/√2.
// 움직이지 않는 바닥·건물은 무대마다 한 번 그려 두고(정적 층), 표시만 초당 10번 다시 그린다.
import { BOUND, EDGE, PITCH, ZONE_NAMES } from './world.js';

const S2 = Math.SQRT1_2;
const toU = (x, z) => (x - z) * S2;
const toV = (x, z) => (x + z) * S2;
const PPM = 3; // 정적 층의 1m당 픽셀
const VIEW_R = 34; // 작은 지도에 보이는 반경(m)
const REDRAW_MS = 100;

const COL = {
  ground: '#1d2620', water: '#1b3138', asphalt: '#30353a', sidewalk: '#454a47', lot: '#3b4434', walk: '#4c4a40',
  building: '#141a1f', lit: 'rgba(255, 196, 110, 0.26)', lamp: '#ffcf86', fuseDead: '#ff8a4c', fuseOk: '#8fd98a',
  clue: '#6fb6ff', hint: '#ffd36b', truck: '#a8d0d4', me: '#ffffff', edge: 'rgba(255, 255, 255, 0.16)', name: 'rgba(240, 232, 214, 0.85)',
};

// 무대 하나의 정적 층: 오프스크린 캔버스와 그 좌표계(u, v 범위)
function makeLayer(boundsR, cu, cv, paint) {
  const size = Math.ceil(boundsR * 2 * PPM);
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  // 월드 (x, z)를 그대로 그리면 돌아간 (u, v) 위치에 찍히게 변환을 건다.
  const k = PPM * S2;
  g.setTransform(k, k, -k, k, (boundsR - cu) * PPM, (boundsR - cv) * PPM);
  paint(g);
  g.setTransform(1, 0, 0, 1, 0, 0);
  return { canvas: c, r: boundsR, cu, cv };
}

function quad(g, f, x0, x1, z0, z1) {
  g.beginPath();
  g.moveTo(f.px(x0, z0), f.pz(x0, z0));
  g.lineTo(f.px(x1, z0), f.pz(x1, z0));
  g.lineTo(f.px(x1, z1), f.pz(x1, z1));
  g.lineTo(f.px(x0, z1), f.pz(x0, z1));
  g.closePath();
}

function paintColliders(g, colliders) {
  g.fillStyle = COL.building;
  for (const c of colliders) {
    if (c.t === 0) g.fillRect(c.x0, c.z0, c.x1 - c.x0, c.z1 - c.z0);
    else if (c.r >= 0.9) {
      g.beginPath();
      g.arc(c.x, c.z, c.r, 0, Math.PI * 2);
      g.fill();
    }
  }
}

function townLayer(world) {
  const R = (BOUND + 4) * Math.SQRT2;
  return makeLayer(R, 0, 0, (g) => {
    g.fillStyle = COL.ground;
    g.fillRect(-200, -200, 400, 400);
    g.fillStyle = COL.asphalt;
    g.fillRect(-EDGE, -EDGE, EDGE * 2, EDGE * 2);
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 5; col++) {
        const cx = (col - 2) * PITCH;
        const cz = (row - 2) * PITCH;
        g.fillStyle = COL.sidewalk;
        g.fillRect(cx - 12, cz - 12, 24, 24);
        g.fillStyle = COL.lot;
        g.fillRect(cx - 10, cz - 10, 20, 20);
      }
    }
    paintColliders(g, world.colliders);
  });
}

function stageLayer(stage) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const grow = (x, z) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); };
  for (const a of stage.areas) {
    if (a.c) { grow(a.x - a.r, a.z - a.r); grow(a.x + a.r, a.z + a.r); }
    else for (const [lx, lz] of [[a.x0, a.z0], [a.x1, a.z0], [a.x1, a.z1], [a.x0, a.z1]]) grow(a.f.px(lx, lz), a.f.pz(lx, lz));
  }
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const R = (Math.hypot(x1 - x0, z1 - z0) / 2) * 1.08 + VIEW_R * 0.5;
  return makeLayer(R, toU(cx, cz), toV(cx, cz), (g) => {
    g.fillStyle = COL.water;
    g.fillRect(cx - 2 * R, cz - 2 * R, 4 * R, 4 * R);
    g.fillStyle = COL.walk;
    for (const a of stage.areas) {
      if (a.c) {
        g.beginPath();
        g.arc(a.x, a.z, a.r, 0, Math.PI * 2);
        g.fill();
      } else {
        quad(g, a.f, a.x0, a.x1, a.z0, a.z1);
        g.fill();
      }
    }
    paintColliders(g, stage.colliders);
  });
}

export class Minimap {
  // els: { mini, panel, full, title, legend, close }. src: { world, story, chapters, player, car }
  constructor(els, src) {
    this.el = els;
    this.src = src;
    this.layers = new Map();
    this.isOpen = false;
    this._last = 0;
    this._key = '';
    els.mini?.addEventListener('click', () => this.toggle());
    els.mini?.addEventListener('keydown', (e) => {
      if (e.code !== 'Enter' && e.code !== 'Space') return;
      e.preventDefault();
      this.toggle();
    });
    els.close?.addEventListener('click', () => this.close());
    els.full?.addEventListener('click', () => this.close());
  }

  get available() {
    return Boolean(this.el.mini && this.el.panel && this.el.full);
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  open() {
    if (!this.available) return;
    this.isOpen = true;
    this.el.panel.classList.remove('hidden');
    this.el.mini.setAttribute('aria-expanded', 'true');
    this._last = 0;
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.panel.classList.add('hidden');
    this.el.mini.setAttribute('aria-expanded', 'false');
  }

  _layer(stage) {
    const key = stage ?? 'town';
    if (!this.layers.has(key)) this.layers.set(key, stage ? stageLayer(stage) : townLayer(this.src.world));
    return this.layers.get(key);
  }

  // 지금 무대(1장 마을 또는 2~4장 무대)의 표시들
  _marks(chapter) {
    const { world, story, chapters, player, car } = this.src;
    const m = { lamps: [], dead: [], fixed: [], hints: [], targets: [], truck: null, glow: [] };
    if (!chapter) {
      for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 5; col++) {
          const cx = (col - 2) * PITCH;
          const cz = (row - 2) * PITCH;
          const z = world.zones[world.zoneAt(cx, cz)];
          if (z && z.level > 0.5) m.glow.push({ x: cx, z: cz });
        }
      }
      for (const L of world.lamps) if (world.zones[L.zone].level > 0.5) m.lamps.push(L);
      if (world.truckLamp.level > 0.5) m.lamps.push(world.truckLamp);
      for (const b of world.fuseBoxes) (world.zones[b.zone].powered ? m.fixed : m.dead).push(b);
      for (const l of world.loot) if (l.hinted && !l.searched) m.hints.push(l);
      if (story) for (const s of story.spots) if (story.isUnlocked(s.clue.id) && !story.isFound(s.clue.id)) m.targets.push({ x: s.ix, z: s.iz });
      if (car && !car.hidden) m.truck = { x: car.pos.x, z: car.pos.z, a: car.a };
    } else {
      const st = chapters.stage;
      for (const L of st?.lamps ?? []) if (L.on || L.level > 0.5) m.lamps.push(L);
      for (const s of chapters.targetList()) m.targets.push(s);
    }
    m.me = { x: player.pos.x, z: player.pos.z, f: player.facing };
    return m;
  }

  // 매 프레임 부른다. chapter: 지금 장(0이면 1장 마을)
  update(now, chapter) {
    if (!this.available || now - this._last < REDRAW_MS) return;
    this._last = now;
    const stage = chapter ? this.src.chapters.stage : null;
    if (chapter && !stage) return;
    const layer = this._layer(stage);
    const marks = this._marks(chapter);
    const key = `${chapter}`;
    if (key !== this._key) {
      this._key = key;
      this._legend(chapter);
    }
    this._drawMini(layer, marks, chapter);
    if (this.isOpen) this._drawFull(layer, marks, chapter);
  }

  _fit(canvas) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (w && h && (canvas.width !== w || canvas.height !== h)) {
      canvas.width = w;
      canvas.height = h;
    }
    return { w: canvas.width, h: canvas.height, dpr };
  }

  _drawMini(layer, marks, chapter) {
    const cv = this.el.mini;
    const { w, h, dpr } = this._fit(cv);
    if (!w) return;
    const g = cv.getContext('2d');
    const s = w / (VIEW_R * 2); // 1m당 픽셀
    const mu = toU(marks.me.x, marks.me.z);
    const mv = toV(marks.me.x, marks.me.z);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    g.save();
    g.beginPath();
    g.arc(w / 2, h / 2, w / 2 - 1, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = chapter ? COL.water : COL.ground;
    g.fillRect(0, 0, w, h);
    // 정적 층에서 내 주변 정사각형을 잘라 붙인다
    const sx = (mu - layer.cu + layer.r) * PPM;
    const sy = (mv - layer.cv + layer.r) * PPM;
    const half = VIEW_R * PPM;
    g.drawImage(layer.canvas, sx - half, sy - half, half * 2, half * 2, 0, 0, w, h);
    const k = s * S2;
    g.setTransform(k, k, -k, k, w / 2 - s * mu, h / 2 - s * mv);
    this._paintMarks(g, marks, s, { w, h, mu, mv, dpr, clampR: VIEW_R - 2.5 });
    g.restore();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.strokeStyle = COL.edge;
    g.lineWidth = 1.5 * dpr;
    g.beginPath();
    g.arc(w / 2, h / 2, w / 2 - g.lineWidth, 0, Math.PI * 2);
    g.stroke();
  }

  _drawFull(layer, marks, chapter) {
    const cv = this.el.full;
    const { w, h, dpr } = this._fit(cv);
    if (!w) return;
    const g = cv.getContext('2d');
    const s = Math.min(w, h) / (layer.r * 2); // 무대 전체가 들어가게
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, h);
    const iw = layer.canvas.width * (s / PPM);
    g.drawImage(layer.canvas, (w - iw) / 2, (h - iw) / 2, iw, iw);
    const k = s * S2;
    g.setTransform(k, k, -k, k, w / 2 - s * layer.cu, h / 2 - s * layer.cv);
    this._paintMarks(g, marks, s, { w, h, dpr, full: true });
    if (!chapter) {
      // 구역 이름
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.font = `${Math.round(12 * dpr)}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.fillStyle = COL.name;
      for (const [id, c] of Object.entries(this._zoneCenters())) {
        g.fillText(ZONE_NAMES[id], w / 2 + s * (toU(c.x, c.z) - layer.cu), h / 2 + s * (toV(c.x, c.z) - layer.cv));
      }
    }
  }

  // 구역 이름을 놓을 자리: 그 구역 블록들의 가운데
  _zoneCenters() {
    if (this._centers) return this._centers;
    const sum = {};
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 5; col++) {
        const x = (col - 2) * PITCH;
        const z = (row - 2) * PITCH;
        const id = this.src.world.zoneAt(x, z);
        const t = (sum[id] ??= { x: 0, z: 0, n: 0 });
        t.x += x;
        t.z += z;
        t.n++;
      }
    }
    this._centers = Object.fromEntries(Object.entries(sum).map(([id, t]) => [id, { x: t.x / t.n, z: t.z / t.n }]));
    return this._centers;
  }

  // 표시를 그린다. g는 월드 좌표 변환이 걸린 상태. s: 1m당 픽셀(크기를 화면 픽셀로 맞출 때 쓴다)
  _paintMarks(g, m, s, o) {
    const px = (n) => (n * o.dpr) / s; // 화면 n픽셀에 해당하는 미터
    const dot = (x, z, r, fill) => {
      g.fillStyle = fill;
      g.beginPath();
      g.arc(x, z, r, 0, Math.PI * 2);
      g.fill();
    };
    // 작은 지도 밖의 표시는 가장자리에 붙인다(방향을 알 수 있게)
    const pin = (x, z) => {
      if (!o.clampR) return { x, z, out: false };
      const dx = x - m.me.x;
      const dz = z - m.me.z;
      const d = Math.hypot(dx, dz);
      if (d <= o.clampR) return { x, z, out: false };
      return { x: m.me.x + (dx / d) * o.clampR, z: m.me.z + (dz / d) * o.clampR, out: true };
    };
    g.fillStyle = COL.lit;
    for (const c of m.glow) g.fillRect(c.x - 12, c.z - 12, 24, 24);
    for (const L of m.lamps) dot(L.x, L.z, Math.max(1.1, px(2.2)), COL.lamp);
    for (const b of m.fixed) dot(b.x, b.z, px(3.5), COL.fuseOk);
    for (const h of m.hints) dot(h.x, h.z, px(3.5), COL.hint);
    if (m.truck) {
      g.save();
      g.translate(m.truck.x, m.truck.z);
      g.rotate(-m.truck.a);
      g.fillStyle = COL.truck;
      g.fillRect(-1.1, -2.2, 2.2, 4.4);
      g.restore();
    }
    // 고장 배전함: 작은 지도에서는 가장 가까운 하나만 가장자리에 붙인다
    let near = null;
    let nd = Infinity;
    for (const b of m.dead) {
      const d = Math.hypot(b.x - m.me.x, b.z - m.me.z);
      if (d < nd) { nd = d; near = b; }
    }
    for (const b of m.dead) {
      const p = b === near ? pin(b.x, b.z) : { x: b.x, z: b.z, out: false };
      g.strokeStyle = COL.fuseDead;
      g.lineWidth = px(2);
      g.beginPath();
      g.arc(p.x, p.z, px(p.out ? 3.5 : 4.5), 0, Math.PI * 2);
      g.stroke();
      if (!p.out) dot(p.x, p.z, px(1.8), COL.fuseDead);
    }
    for (const t of m.targets) {
      const p = pin(t.x, t.z);
      dot(p.x, p.z, px(p.out ? 3.5 : 4.5), COL.clue);
      if (!p.out) dot(p.x, p.z, px(2), '#e8f3ff');
    }
    // 나: 바라보는 방향 화살표
    const f = m.me.f;
    const fx = Math.sin(f);
    const fz = Math.cos(f);
    const r = px(o.full ? 7 : 6);
    g.fillStyle = COL.me;
    g.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    g.lineWidth = px(1.2);
    g.beginPath();
    g.moveTo(m.me.x + fx * r, m.me.z + fz * r);
    g.lineTo(m.me.x - fx * r * 0.6 + fz * r * 0.62, m.me.z - fz * r * 0.6 - fx * r * 0.62);
    g.lineTo(m.me.x - fx * r * 0.25, m.me.z - fz * r * 0.25);
    g.lineTo(m.me.x - fx * r * 0.6 - fz * r * 0.62, m.me.z - fz * r * 0.6 + fx * r * 0.62);
    g.closePath();
    g.fill();
    g.stroke();
  }

  _legend(chapter) {
    const el = this.el.legend;
    if (!el) return;
    const rows = chapter
      ? [['me', '나'], ['clue', '갈 곳'], ['lamp', '켜진 불빛']]
      : [['me', '나'], ['dead', '고장 난 배전함'], ['ok', '고친 배전함'], ['lamp', '켜진 가로등'], ['clue', '읽을 기록'], ['candle', '촛불 단서'], ['truck', '트럭']];
    el.replaceChildren(...rows.map(([k, t]) => {
      const li = document.createElement('li');
      const i = document.createElement('i');
      i.className = `mk ${k}`;
      li.append(i, t);
      return li;
    }));
    if (this.el.title) this.el.title.textContent = chapter ? this.src.chapters.label : '마을 지도';
  }
}
