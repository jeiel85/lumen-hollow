import * as THREE from 'three';
import { glowTexture } from './shades.js';
import { makeBeaconMaterial } from './world.js';

// 돌려보낸 그림자: 흩어진 그늘이에서 옅은 빛이 떠올라 주인이 잠든 집으로 날아간다(이야기의 '돌아가는 그림자').
// 촛불: 그림자를 돌려받아 깨어난 누군가가 숨은 퓨즈 자리에 켜 두는 작은 불과 금빛 기둥.
const WISPS = 16;
const FLASHES = 6;
const CANDLES = 10;

export class Wisps {
  constructor(scene) {
    const tex = glowTexture();
    this.wisps = [];
    for (let i = 0; i < WISPS; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(0.7, 0.88, 1.0), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 });
      const s = new THREE.Sprite(mat);
      s.visible = false;
      s.renderOrder = 6;
      scene.add(s);
      // 지나온 길이 보이도록 뒤따르는 작은 빛 둘
      const trail = [0.07, 0.14].map((lag) => {
        const tm = mat.clone();
        const ts = new THREE.Sprite(tm);
        ts.visible = false;
        ts.renderOrder = 6;
        scene.add(ts);
        return { s: ts, mat: tm, lag };
      });
      this.wisps.push({ s, mat, trail, active: false, t: 0, dur: 1, a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), done: null });
    }
    // 도착한 집 창가에 잠깐 번지는 따뜻한 빛(깨어남)
    this.flashes = [];
    for (let i = 0; i < FLASHES; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(1.0, 0.78, 0.45), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 });
      const s = new THREE.Sprite(mat);
      s.visible = false;
      s.renderOrder = 6;
      scene.add(s);
      this.flashes.push({ s, mat, t: -1 });
    }
    // 촛불: 작은 불꽃 + 금빛 기둥. 기둥 셰이더는 배전함 신호 기둥과 같은 프로그램이라 더 컴파일하지 않는다.
    this.beaconMat = makeBeaconMaterial(new THREE.Color(1.0, 0.72, 0.28));
    const beaconGeo = new THREE.CylinderGeometry(0.22, 0.22, 14, 10, 1, true).translate(0, 7, 0);
    const flameGeo = new THREE.ConeGeometry(0.09, 0.26, 6).translate(0, 0.13, 0);
    const waxGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.22, 8).translate(0, 0.11, 0);
    this.flameMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.9, 0.7) });
    const waxMat = new THREE.MeshBasicMaterial({ color: 0xece4d2 });
    this.candles = [];
    for (let i = 0; i < CANDLES; i++) {
      const g = new THREE.Group();
      const wax = new THREE.Mesh(waxGeo, waxMat);
      const flame = new THREE.Mesh(flameGeo, this.flameMat);
      flame.position.y = 0.22;
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(1.0, 0.7, 0.35), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.7 }));
      halo.position.y = 0.36;
      halo.scale.set(0.9, 0.9, 1);
      const beacon = new THREE.Mesh(beaconGeo, this.beaconMat);
      beacon.renderOrder = 3;
      g.add(wax, flame, halo, beacon);
      g.visible = false;
      scene.add(g);
      this.candles.push({ g, flame, loot: null });
    }
  }

  clear() {
    for (const w of this.wisps) {
      w.active = false;
      w.s.visible = false;
      for (const tr of w.trail) tr.s.visible = false;
      w.done = null;
    }
    for (const f of this.flashes) {
      f.t = -1;
      f.s.visible = false;
    }
    for (const c of this.candles) {
      c.loot = null;
      c.g.visible = false;
    }
  }

  // from(x, z)에서 to(x, y, z)로 호를 그리며 날아간다. 도착하면 done()을 부른다.
  spawn(from, to, done) {
    const w = this.wisps.find((q) => !q.active);
    if (!w) {
      done?.();
      return;
    }
    const d = Math.hypot(to.x - from.x, to.z - from.z);
    w.a.set(from.x, 1.4, from.z);
    w.c.set(to.x, to.y, to.z);
    w.b.set((from.x + to.x) / 2, Math.max(1.4, to.y) + 2.5 + d * 0.18, (from.z + to.z) / 2);
    w.dur = 0.9 + d / 13;
    w.t = 0;
    w.done = done;
    w.active = true;
    w.s.visible = true;
    for (const tr of w.trail) tr.s.visible = true;
  }

  flash(at) {
    const f = this.flashes.find((q) => q.t < 0) ?? this.flashes[0];
    f.t = 0;
    f.s.position.set(at.x, at.y, at.z);
    f.s.visible = true;
  }

  candle(loot, y) {
    if (this.candles.some((c) => c.loot === loot)) return;
    const c = this.candles.find((q) => !q.loot);
    if (!c) return;
    c.loot = loot;
    c.g.position.set(loot.x, y, loot.z);
    c.g.visible = true;
  }

  clearCandle(loot) {
    const c = this.candles.find((q) => q.loot === loot);
    if (!c) return;
    c.loot = null;
    c.g.visible = false;
  }

  // 2차 베지어(부드럽게 출발·도착): 떠올랐다가 집 창가로 내려앉는다
  _at(w, k, out) {
    const e = k * k * (3 - 2 * k);
    return out.copy(w.a).multiplyScalar((1 - e) * (1 - e)).addScaledVector(w.b, 2 * (1 - e) * e).addScaledVector(w.c, e * e);
  }

  update(dt, t, night) {
    for (const w of this.wisps) {
      if (!w.active) continue;
      w.t += dt;
      const k = Math.min(1, w.t / w.dur);
      const wob = 0.75 + 0.25 * Math.sin(t * 14 + w.dur * 7);
      const alpha = Math.min(1, w.t * 5) * (1 - Math.max(0, (k - 0.85) / 0.15)) * wob * (0.6 + 0.4 * night);
      this._at(w, k, w.s.position);
      w.s.scale.setScalar(0.8 + 0.5 * Math.sin(Math.PI * k));
      w.mat.opacity = alpha;
      for (const tr of w.trail) {
        const kt = Math.max(0, k - tr.lag);
        this._at(w, kt, tr.s.position);
        tr.s.scale.setScalar((0.8 + 0.5 * Math.sin(Math.PI * kt)) * (1 - tr.lag * 3));
        tr.mat.opacity = alpha * (1 - tr.lag * 4.5);
      }
      if (k >= 1) {
        w.active = false;
        w.s.visible = false;
        for (const tr of w.trail) tr.s.visible = false;
        const done = w.done;
        w.done = null;
        done?.();
      }
    }
    for (const f of this.flashes) {
      if (f.t < 0) continue;
      f.t += dt;
      const k = f.t / 1.4;
      if (k >= 1) {
        f.t = -1;
        f.s.visible = false;
        continue;
      }
      f.mat.opacity = Math.sin(Math.PI * k) * (0.5 + 0.5 * night);
      f.s.scale.setScalar(1.2 + k * 2.2);
    }
    this.beaconMat.uniforms.uOpacity.value = (0.14 + 0.42 * night) * (0.75 + 0.25 * Math.sin(t * 2.6));
    this.flameMat.color.setRGB(3.2, 1.9, 0.7).multiplyScalar(0.8 + 0.2 * Math.sin(t * 17) * Math.sin(t * 7.3));
  }
}
