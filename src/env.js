import * as THREE from 'three';
import { tr } from './i18n.js';

// 게임 속 1시간 = HOUR_SECONDS 초. 낮(6~18.5시) 약 94초, 밤 약 86초.
export const HOUR_SECONDS = 7.5;

const col = (h) => new THREE.Color(h);

// 시간대별 조명/그레이딩 키프레임. 아침의 옅은 민트, 오후의 주황, 비 오는 밤의 청록.
const KEYS = [
  { h: 0.0, sun: '#86a6cc', sunI: 0.55, sky: '#34525c', gnd: '#121b1d', hemiI: 0.95, exp: 1.0, tint: '#a9c9c8', lift: '#081312', sat: 0.72, bloom: 0.95, thr: 0.75 },
  { h: 4.8, sun: '#86a6cc', sunI: 0.55, sky: '#34525c', gnd: '#121b1d', hemiI: 0.95, exp: 1.0, tint: '#a9c9c8', lift: '#081312', sat: 0.72, bloom: 0.95, thr: 0.75 },
  { h: 6.1, sun: '#ffb38c', sunI: 1.3, sky: '#aebfc8', gnd: '#4f5150', hemiI: 0.95, exp: 1.0, tint: '#ffe4dc', lift: '#161114', sat: 0.82, bloom: 0.55, thr: 1.1 },
  { h: 8.2, sun: '#fff1dc', sunI: 2.7, sky: '#d0e6de', gnd: '#7f917c', hemiI: 1.3, exp: 1.0, tint: '#eef8f1', lift: '#1c2521', sat: 0.7, bloom: 0.35, thr: 1.5 },
  { h: 12.5, sun: '#fff7ea', sunI: 3.1, sky: '#d6e3e4', gnd: '#8f8e78', hemiI: 1.2, exp: 1.0, tint: '#fffaf2', lift: '#171716', sat: 0.88, bloom: 0.3, thr: 1.6 },
  { h: 15.8, sun: '#ffc78c', sunI: 3.1, sky: '#e3c09a', gnd: '#7d5c40', hemiI: 1.1, exp: 1.0, tint: '#ffe6cc', lift: '#1f150d', sat: 0.95, bloom: 0.4, thr: 1.4 },
  { h: 17.4, sun: '#ffab6e', sunI: 2.5, sky: '#cfa08e', gnd: '#62483a', hemiI: 0.95, exp: 1.0, tint: '#ffe0c8', lift: '#1e130f', sat: 0.92, bloom: 0.5, thr: 1.2 },
  { h: 18.6, sun: '#d08378', sunI: 0.6, sky: '#5a5a74', gnd: '#221e27', hemiI: 0.8, exp: 1.0, tint: '#d2c2dd', lift: '#0d0b14', sat: 0.82, bloom: 0.8, thr: 0.9 },
  { h: 19.7, sun: '#86a6cc', sunI: 0.55, sky: '#34525c', gnd: '#121b1d', hemiI: 0.95, exp: 1.0, tint: '#a9c9c8', lift: '#081312', sat: 0.72, bloom: 0.95, thr: 0.75 },
  { h: 24.0, sun: '#86a6cc', sunI: 0.55, sky: '#34525c', gnd: '#121b1d', hemiI: 0.95, exp: 1.0, tint: '#a9c9c8', lift: '#081312', sat: 0.72, bloom: 0.95, thr: 0.75 },
].map((k) => ({ ...k, sun: col(k.sun), sky: col(k.sky), gnd: col(k.gnd), tint: col(k.tint), lift: col(k.lift) }));

const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (v) => Math.min(1, Math.max(0, v));

export function nightAmount(h) {
  if (h >= 19.3 || h < 4.8) return 1;
  if (h >= 17.8) return smooth((h - 17.8) / 1.5);
  if (h < 6.3) return 1 - smooth((h - 4.8) / 1.5);
  return 0;
}

export function phaseName(h) {
  if (h >= 5 && h < 7) return tr('새벽');
  if (h >= 7 && h < 11) return tr('아침');
  if (h >= 11 && h < 15) return tr('한낮');
  if (h >= 15 && h < 18) return tr('오후');
  if (h >= 18 && h < 19.5) return tr('해질녘');
  return tr('밤');
}

class Rain {
  constructor(scene, count) {
    this.n = count;
    this.drops = new Float32Array(count * 3);
    this.speed = new Float32Array(count);
    this.lines = new Float32Array(count * 6);
    this.focus = new THREE.Vector3();
    this.seeded = false;
    const g = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(this.lines, 3);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.attr);
    this.mat = new THREE.LineBasicMaterial({ color: 0xcfe2ea, transparent: true, opacity: 0, depthWrite: false });
    this.mesh = new THREE.LineSegments(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    scene.add(this.mesh);

    const m = 140;
    this.sp = new Float32Array(m * 3);
    this.sage = new Float32Array(m).fill(1);
    this.si = 0;
    const sg = new THREE.BufferGeometry();
    this.spAttr = new THREE.BufferAttribute(this.sp, 3).setUsage(THREE.DynamicDrawUsage);
    this.ageAttr = new THREE.BufferAttribute(this.sage, 1).setUsage(THREE.DynamicDrawUsage);
    sg.setAttribute('position', this.spAttr);
    sg.setAttribute('aAge', this.ageAttr);
    this.splashMat = new THREE.ShaderMaterial({
      uniforms: { uPx: { value: 30 }, uOpacity: { value: 0 } },
      vertexShader: `attribute float aAge; uniform float uPx; varying float vAge;
        void main(){ vAge = aAge; gl_PointSize = uPx * 0.55; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uOpacity; varying float vAge;
        void main(){
          if (vAge >= 1.0) discard;
          vec2 p = (gl_PointCoord - 0.5) * 2.0; p.y /= 0.62;
          float r = length(p); float rad = 0.25 + vAge * 0.7;
          float ring = smoothstep(rad - 0.18, rad, r) * (1.0 - smoothstep(rad, rad + 0.08, r));
          gl_FragColor = vec4(vec3(0.85, 0.93, 0.97), ring * (1.0 - vAge) * (1.0 - vAge) * uOpacity);
        }`,
      transparent: true, depthWrite: false,
    });
    this.splashes = new THREE.Points(sg, this.splashMat);
    this.splashes.frustumCulled = false;
    this.splashes.renderOrder = 6;
    scene.add(this.splashes);
  }

  _respawn(i, top) {
    const k = i * 3;
    this.drops[k] = this.focus.x + (Math.random() - 0.5) * 60;
    this.drops[k + 1] = top ? 16 + Math.random() * 8 : Math.random() * 24;
    this.drops[k + 2] = this.focus.z + (Math.random() - 0.5) * 60;
    this.speed[i] = 24 + Math.random() * 8;
  }

  update(dt, level, focus, pxPerUnit) {
    this.focus.copy(focus);
    const visible = level > 0.01;
    this.mesh.visible = visible;
    this.splashes.visible = visible;
    if (!visible) return;
    if (!this.seeded) {
      for (let i = 0; i < this.n; i++) this._respawn(i, false);
      this.seeded = true;
    }
    const count = Math.floor(this.n * level);
    const wx = 2.5, wz = 1.2;
    for (let i = 0; i < count; i++) {
      const k = i * 3;
      const s = this.speed[i];
      this.drops[k] += wx * dt;
      this.drops[k + 1] -= s * dt;
      this.drops[k + 2] += wz * dt;
      if (this.drops[k + 1] < 0) {
        if (Math.random() < 0.18) {
          const j = this.si = (this.si + 1) % this.sage.length;
          this.sp[j * 3] = this.drops[k];
          this.sp[j * 3 + 1] = 0.22;
          this.sp[j * 3 + 2] = this.drops[k + 2];
          this.sage[j] = 0;
        }
        this._respawn(i, true);
      }
      if (this.drops[k] - focus.x > 30) this.drops[k] -= 60;
      else if (this.drops[k] - focus.x < -30) this.drops[k] += 60;
      if (this.drops[k + 2] - focus.z > 30) this.drops[k + 2] -= 60;
      else if (this.drops[k + 2] - focus.z < -30) this.drops[k + 2] += 60;
      const o = i * 6;
      const len = 0.035;
      this.lines[o] = this.drops[k];
      this.lines[o + 1] = this.drops[k + 1];
      this.lines[o + 2] = this.drops[k + 2];
      this.lines[o + 3] = this.drops[k] - wx * len;
      this.lines[o + 4] = this.drops[k + 1] + s * len;
      this.lines[o + 5] = this.drops[k + 2] - wz * len;
    }
    this.mesh.geometry.setDrawRange(0, count * 2);
    this.attr.needsUpdate = true;
    this.mat.opacity = 0.34 * level;

    for (let j = 0; j < this.sage.length; j++) if (this.sage[j] < 1) this.sage[j] = Math.min(1, this.sage[j] + dt * 2.6);
    this.spAttr.needsUpdate = true;
    this.ageAttr.needsUpdate = true;
    this.splashMat.uniforms.uPx.value = pxPerUnit;
    this.splashMat.uniforms.uOpacity.value = 0.55 * level;
  }
}

export class Environment {
  constructor(scene, { mobile = false } = {}) {
    this.hour = 7.5;
    this.day = 1;
    this.sun = new THREE.DirectionalLight(0xffffff, 2);
    this.sun.castShadow = true;
    const s = this.sun.shadow;
    const size = mobile ? 1024 : 2048;
    s.mapSize.set(size, size);
    this.shadowExtent = 34;
    Object.assign(s.camera, { left: -34, right: 34, top: 34, bottom: -34, near: 1, far: 220 });
    s.camera.updateProjectionMatrix();
    s.bias = -0.0004;
    s.normalBias = 0.04;
    s.radius = 3;
    this.snap = (this.shadowExtent * 2) / size;
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    scene.add(this.hemi);

    this.rain = new Rain(scene, mobile ? 900 : 1600);
    this.rainLevel = 0;
    this.rainyNight = true;

    this.night = 0;
    this.look = {
      exposure: 1, tint: new THREE.Color(1, 1, 1), lift: new THREE.Color(0, 0, 0),
      sat: 1, bloom: 0.5, threshold: 1, vignette: 1,
    };
    this._dir = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._center = new THREE.Vector3();
  }

  setHour(h) {
    this.hour = ((h % 24) + 24) % 24;
  }

  // 시간을 진행시키고 지나간 경계 이벤트를 돌려준다.
  advance(dt) {
    const events = [];
    const prev = this.hour;
    let next = prev + dt / HOUR_SECONDS;
    const crossed = (mark) => (prev < mark && next >= mark) || (next >= 24 && mark + 24 > prev && mark + 24 <= next);
    if (crossed(17.8)) events.push('dusk');
    if (crossed(19.2)) events.push('night');
    if (crossed(6.0)) events.push('dawn');
    if (next >= 24) next -= 24;
    this.hour = next;
    return events;
  }

  _sample(h) {
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1].h <= h) i++;
    const a = KEYS[i];
    const b = KEYS[i + 1];
    const t = smooth(clamp01((h - a.h) / (b.h - a.h)));
    return { a, b, t };
  }

  update(dt, focus, pxPerUnit) {
    const h = this.hour;
    const { a, b, t } = this._sample(h);
    const L = this.look;
    const lerp = (x, y) => x + (y - x) * t;

    this.night = nightAmount(h);
    const rainTarget = this.rainyNight ? smooth(clamp01((this.night - 0.35) / 0.5)) : 0;
    this.rainLevel += (rainTarget - this.rainLevel) * (1 - Math.exp(-dt * 0.6));
    const r = this.rainLevel;

    this.sun.color.copy(a.sun).lerp(b.sun, t);
    this.sun.intensity = lerp(a.sunI, b.sunI) * (1 - r * 0.25);
    this.hemi.color.copy(a.sky).lerp(b.sky, t);
    this.hemi.groundColor.copy(a.gnd).lerp(b.gnd, t);
    this.hemi.intensity = lerp(a.hemiI, b.hemiI) * (1 - r * 0.12);

    L.exposure = lerp(a.exp, b.exp);
    L.tint.copy(a.tint).lerp(b.tint, t);
    L.lift.copy(a.lift).lerp(b.lift, t);
    L.sat = lerp(a.sat, b.sat) - r * 0.06;
    L.bloom = lerp(a.bloom, b.bloom) + r * 0.15;
    L.threshold = lerp(a.thr, b.thr);
    L.vignette = 0.9 + this.night * 0.55;

    // 해: 6~18.6시 동안 하늘을 가로지른다. 밤에는 고정된 달빛.
    const dir = this._dir;
    if (h > 5.6 && h < 18.9) {
      const dayT = clamp01((h - 6) / 12.6);
      const az = THREE.MathUtils.degToRad(130 - 165 * dayT);
      const el = THREE.MathUtils.degToRad(5 + 58 * Math.pow(Math.sin(Math.PI * dayT), 0.85));
      dir.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    } else {
      const az = THREE.MathUtils.degToRad(70);
      const el = THREE.MathUtils.degToRad(50);
      dir.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    }

    // 그림자 카메라를 플레이어 주변에 붙이되 텍셀 단위로 맞춰 떨림을 막는다.
    const right = this._right.crossVectors(dir, THREE.Object3D.DEFAULT_UP).normalize();
    const up = this._up.crossVectors(right, dir).normalize();
    const sa = Math.round(focus.dot(right) / this.snap) * this.snap;
    const sb = Math.round(focus.dot(up) / this.snap) * this.snap;
    const sc = focus.dot(dir);
    const c = this._center.set(0, 0, 0).addScaledVector(right, sa).addScaledVector(up, sb).addScaledVector(dir, sc);
    this.sun.target.position.copy(c);
    this.sun.position.copy(c).addScaledVector(dir, 100);

    this.rain.update(dt, r, focus, pxPerUnit);
  }
}
