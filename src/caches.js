import * as THREE from 'three';
import { Builder, geo } from './geometry.js';
import { SLOT_COUNT, blockedSlots, slotPos } from './slots.js';

// 마을에 놓인 공유 보급품(다른 생존자가 남긴 상자)의 표시와 위치 찾기.
// 셰이더 사전 컴파일(main.js warmUp) 전에 장면에 넣어 두려고, 메시는 고정 용량으로 미리 만든다.
const MAX = 400;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0);

function crateGeometry() {
  const b = new Builder();
  b.add(geo.box(), 0, 0.27, 0, 0.64, 0.42, 0.5, 0x6f5a43);
  b.add(geo.box(), 0, 0.5, 0, 0.68, 0.07, 0.54, 0x4f948c);
  b.add(geo.box(), 0, 0.29, 0.255, 0.2, 0.2, 0.02, 0xe9e3d2);
  b.add(geo.box(), 0, 0.29, 0.262, 0.05, 0.14, 0.01, 0x4f948c);
  b.add(geo.box(), 0, 0.29, 0.262, 0.14, 0.05, 0.01, 0x4f948c);
  return b.build();
}

export class Caches {
  constructor(scene, world) {
    this.world = world;
    this.items = [];
    const blocked = new Set(blockedSlots(world));
    this.free = [];
    for (let id = 0; id < SLOT_COUNT; id++) if (!blocked.has(id)) this.free.push(id);
    this.freeSet = new Set(this.free);

    const g = crateGeometry();
    this.mesh = new THREE.InstancedMesh(g, world.staticMat, MAX);
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    // 두기 전에 보여 주는 반투명 상자
    this.ghost = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x9fe3dc, transparent: true, opacity: 0.4, depthWrite: false }));
    this.ghost.visible = false;
    this.ghost.renderOrder = 5;
    scene.add(this.ghost);

    // 청록 반짝임: 수색 지점(따뜻한 노랑)과 구별한다.
    this.pos = new Float32Array(MAX * 3);
    const seeds = new Float32Array(MAX);
    for (let i = 0; i < MAX; i++) seeds[i] = (Math.sin(i * 91.7) * 43758.5453) % 10;
    const gg = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3);
    gg.setAttribute('position', this.posAttr);
    gg.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    gg.setDrawRange(0, 0);
    this.glintMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPx: { value: 30 }, uNight: { value: 0 } },
      vertexShader: `
        attribute float aSeed; uniform float uTime; uniform float uPx; varying float vA;
        void main(){
          vec3 p = position; p.y += sin(uTime * 1.6 + aSeed) * 0.07;
          float tw = 0.7 + 0.3 * sin(uTime * 2.4 + aSeed * 1.7);
          vA = tw;
          gl_PointSize = uPx * 0.75 * (0.85 + 0.15 * tw);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `
        uniform float uNight; varying float vA;
        void main(){
          vec2 q = gl_PointCoord - 0.5;
          float core = exp(-dot(q, q) * 70.0);
          float d = length(q) * 2.0 - 0.62; // pow()는 음수 밑에서 NaN이 되므로 제곱을 직접 쓴다
          float ring = exp(-d * d * 90.0) * 0.5;
          gl_FragColor = vec4(vec3(0.45, 1.0, 0.92) * mix(1.3, 2.4, uNight), (core + ring) * vA);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.glints = new THREE.Points(gg, this.glintMat);
    this.glints.frustumCulled = false;
    this.glints.renderOrder = 4;
    scene.add(this.glints);
  }

  // ---------------------------------------------------------------- 목록

  set(list) {
    this.items = [];
    const used = new Set();
    for (const c of list) {
      // 서버가 막지 않는 겹침(같은 슬롯 두 개)이나 이 버전에서 막힌 칸은 그리지 않는다.
      if (!this.freeSet.has(c.slot) || used.has(c.slot) || this.items.length >= MAX) continue;
      used.add(c.slot);
      this.items.push(this._place(c));
    }
    this._rebuild();
  }

  add(c) {
    this.items = this.items.filter((it) => it.slot !== c.slot && it.id !== c.id);
    this.items.push(this._place(c));
    this._rebuild();
  }

  remove(id) {
    this.items = this.items.filter((it) => it.id !== id);
    this._rebuild();
  }

  clear() {
    this.items = [];
    this.showGhost(null);
    this._rebuild();
  }

  _place(c) {
    const { x, z } = slotPos(c.slot);
    const side = Math.floor(c.slot / 6) % 4;
    const ry = (side < 2 ? 0 : Math.PI / 2) + (((c.slot * 37) % 7) - 3) * 0.05;
    return { ...c, x, z, ry };
  }

  _rebuild() {
    const n = this.items.length;
    for (let i = 0; i < n; i++) {
      const it = this.items[i];
      const y = this.world.heightAt(it.x, it.z);
      _q.setFromAxisAngle(_up, it.ry);
      _m.compose(_p.set(it.x, y, it.z), _q, _s);
      this.mesh.setMatrixAt(i, _m);
      this.pos[i * 3] = it.x;
      this.pos[i * 3 + 1] = y + 0.95;
      this.pos[i * 3 + 2] = it.z;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.posAttr.needsUpdate = true;
    this.glints.geometry.setDrawRange(0, n);
  }

  // ---------------------------------------------------------------- 찾기

  nearest(x, z, r) {
    let best = null;
    let bd = r * r;
    for (const it of this.items) {
      const d = (it.x - x) ** 2 + (it.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = it;
      }
    }
    return best;
  }

  // 반경 r 안에서 비어 있는(막히지 않았고 보급품도 없는) 가장 가까운 슬롯
  freeSlotNear(x, z, r) {
    const taken = new Set(this.items.map((it) => it.slot));
    let best = null;
    let bd = r * r;
    for (const slot of this.free) {
      if (taken.has(slot)) continue;
      const p = slotPos(slot);
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = { slot, x: p.x, z: p.z };
      }
    }
    return best;
  }

  showGhost(spot) {
    this.ghost.visible = Boolean(spot);
    if (!spot) return;
    const side = Math.floor(spot.slot / 6) % 4;
    this.ghost.position.set(spot.x, this.world.heightAt(spot.x, spot.z), spot.z);
    this.ghost.rotation.y = side < 2 ? 0 : Math.PI / 2;
  }

  update(t, pxPerUnit, night) {
    this.glintMat.uniforms.uTime.value = t;
    this.glintMat.uniforms.uPx.value = pxPerUnit;
    this.glintMat.uniforms.uNight.value = night;
    if (this.ghost.visible) this.ghost.material.opacity = 0.3 + 0.15 * Math.sin(t * 5);
  }
}
