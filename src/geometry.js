import * as THREE from 'three';

// 정적인 마을 지오메트리를 정점 색상 하나의 메시로 합치는 도구.
// 수천 개의 상자·원기둥을 드로우콜 한 번으로 그리기 위해 쓴다.

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();
const _c = new THREE.Color();

const cache = new Map();

function prep(key, make) {
  let g = cache.get(key);
  if (!g) {
    g = make();
    if (g.index) g = g.toNonIndexed();
    g.computeVertexNormals();
    cache.set(key, g);
  }
  return g;
}

// 박공 지붕용 삼각기둥. 단면은 x-y, 용마루는 z축. 모든 기본 도형처럼 원점 중심 단위 크기.
function makeGable() {
  const A = [-0.5, -0.5, 0.5], B = [-0.5, -0.5, -0.5], Cc = [0, 0.5, -0.5], D = [0, 0.5, 0.5];
  const E = [0.5, -0.5, 0.5], F = [0.5, -0.5, -0.5];
  const tris = [A, D, Cc, A, Cc, B, E, Cc, D, E, F, Cc, A, E, D, F, B, Cc];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
  return g;
}

export const geo = {
  box: () => prep('box', () => new THREE.BoxGeometry(1, 1, 1)),
  cyl: (seg = 8, top = 0.5) => prep(`cyl${seg}_${top}`, () => new THREE.CylinderGeometry(top, 0.5, 1, seg)),
  cone: (seg = 7) => prep(`cone${seg}`, () => new THREE.ConeGeometry(0.5, 1, seg)),
  ico: (detail = 0) => prep(`ico${detail}`, () => new THREE.IcosahedronGeometry(0.5, detail)),
  sphere: (w = 10, h = 6) => prep(`sph${w}_${h}`, () => new THREE.SphereGeometry(0.5, w, h)),
  gable: () => prep('gable', makeGable),
};

export class Builder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.col = [];
    this.count = 0;
  }

  add(g, x, y, z, sx, sy, sz, color, ry = 0, rx = 0, rz = 0) {
    _e.set(rx, ry, rz);
    _q.setFromEuler(_e);
    _p.set(x, y, z);
    _s.set(sx, sy, sz);
    _m.compose(_p, _q, _s);
    _nm.getNormalMatrix(_m);
    if (color && color.isColor) _c.copy(color);
    else _c.set(color);

    const P = g.attributes.position;
    const N = g.attributes.normal;
    const n = P.count;
    const pos = new Float32Array(n * 3);
    const nor = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      _v.fromBufferAttribute(P, i).applyMatrix4(_m);
      _n.fromBufferAttribute(N, i).applyMatrix3(_nm).normalize();
      const k = i * 3;
      pos[k] = _v.x; pos[k + 1] = _v.y; pos[k + 2] = _v.z;
      nor[k] = _n.x; nor[k + 1] = _n.y; nor[k + 2] = _n.z;
      col[k] = _c.r; col[k + 1] = _c.g; col[k + 2] = _c.b;
    }
    this.pos.push(pos);
    this.nor.push(nor);
    this.col.push(col);
    this.count += n;
  }

  build() {
    const join = (chunks) => {
      const out = new Float32Array(this.count * 3);
      let o = 0;
      for (const c of chunks) {
        out.set(c, o);
        o += c.length;
      }
      return out;
    };
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(join(this.pos), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(join(this.nor), 3));
    g.setAttribute('color', new THREE.BufferAttribute(join(this.col), 3));
    g.computeBoundingSphere();
    this.pos = this.nor = this.col = null;
    return g;
  }
}

// 지역 좌표계(정면 = +z)로 건물을 짓고 a 라디안만큼 돌려 배치한다.
export class Frame {
  constructor(x, z, a) {
    this.x = x;
    this.z = z;
    this.a = a;
    this.c = Math.cos(a);
    this.s = Math.sin(a);
  }

  px(lx, lz) {
    return this.x + lx * this.c + lz * this.s;
  }

  pz(lx, lz) {
    return this.z - lx * this.s + lz * this.c;
  }

  add(b, g, lx, ly, lz, sx, sy, sz, color, ry = 0, rx = 0, rz = 0) {
    b.add(g, this.px(lx, lz), ly, this.pz(lx, lz), sx, sy, sz, color, this.a + ry, rx, rz);
  }

  // 회전된 직사각형 바닥면의 AABB (90도 단위 회전만 사용)
  aabb(lx, lz, w, d, pad = 0) {
    const swap = Math.abs(this.s) > 0.5;
    const hw = (swap ? d : w) / 2 + pad;
    const hd = (swap ? w : d) / 2 + pad;
    const cx = this.px(lx, lz);
    const cz = this.pz(lx, lz);
    return { t: 0, x0: cx - hw, x1: cx + hw, z0: cz - hd, z1: cz + hd };
  }
}

export function tint(hex, rng, amount = 0.05) {
  const c = new THREE.Color(hex);
  const hsl = {};
  c.getHSL(hsl);
  c.setHSL(
    (hsl.h + rng.range(-amount, amount) * 0.25 + 1) % 1,
    hsl.s,
    THREE.MathUtils.clamp(hsl.l + rng.range(-amount, amount), 0, 1),
  );
  return c;
}
