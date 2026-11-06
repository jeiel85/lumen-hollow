import * as THREE from 'three';
import { makeBeam, addXray } from './player.js';

// 은신처 앞에 세워 둔 낡은 픽업트럭. 연료가 있으면 몰 수 있고, 밤에는 전조등이 그늘이를 태운다.
// 좌표 규약은 플레이어와 같다: 방향각 a의 정면 = (sin a, cos a), a가 커지면 왼쪽으로 돈다.

const HALF_W = 0.95;
const HALF_L = 2.15;
const AXLE = 1.15; // 앞·뒤 충돌 원의 중심 거리
const COLLIDE_R = 1.0;
const WHEEL_R = 0.38;
export const MAX_FWD = 15;
const MAX_REV = 5.5;
const ACCEL = 8.5;
const BRAKE = 20;
const COAST = 2.4;
const STEER_RATE = 2.3;
const GRIP = 16; // 옆미끄러짐을 잡아 주는 최대 가속도(m/s²). 넘치면 미끄러지며 바퀴 자국이 남는다.
const LIGHT_RANGE = 17;
const LIGHT_ANGLE = 0.5;
const FUEL_IDLE = 0.12; // 시동만 걸려 있을 때 %/s
const FUEL_DRIVE = 1.5; // 가속 페달을 끝까지 밟았을 때 추가 %/s
export const RAM_SPEED = 6; // 이 속도 이상으로 들이받으면 그늘이가 흩어진다
const SKID_MAX = 480;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const approach = (v, target, step) => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));
const wrap = (a) => {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
};

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export class Vehicle {
  constructor(scene) {
    this.root = new THREE.Group();
    this.model = new THREE.Group();
    this.root.add(this.model);
    scene.add(this.root);

    this.mats = [];
    const mat = (c) => {
      const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, flatShading: true, emissive: c, emissiveIntensity: 0 });
      this.mats.push(m);
      return m;
    };
    const paint = mat(0x5f9183);
    const cream = mat(0xe6dbc1);
    const dark = mat(0x33383b);
    const rust = mat(0x9c6a4c);
    const can = mat(0xb04a3a);
    const glass = new THREE.MeshStandardMaterial({ color: 0x2e3d44, roughness: 0.25, metalness: 0.2, flatShading: true });
    const meshes = [];
    const box = (w, h, d, m, x, y, z, parent = this.model) => {
      const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      me.position.set(x, y, z);
      me.castShadow = true;
      me.receiveShadow = true;
      parent.add(me);
      meshes.push(me);
      return me;
    };

    // 차체: 앞쪽 엔진룸, 가운데 운전석, 뒤쪽 짐칸
    box(1.9, 0.5, 4.2, paint, 0, 0.66, 0);
    box(1.84, 0.16, 1.3, paint, 0, 0.98, 1.42);
    box(1.8, 0.3, 1.5, paint, 0, 1.06, 0.05);
    box(1.72, 0.44, 1.4, glass, 0, 1.43, 0.05);
    box(1.8, 0.09, 1.5, cream, 0, 1.69, 0.05);
    for (const s of [-1, 1]) box(0.1, 0.36, 1.55, paint, s * 0.9, 1.08, -1.32);
    box(1.9, 0.36, 0.1, paint, 0, 1.08, -2.1);
    box(1.94, 0.2, 0.16, dark, 0, 0.5, 2.14);
    box(1.94, 0.2, 0.16, dark, 0, 0.5, -2.14);
    box(0.9, 0.06, 0.04, cream, 0, 0.98, 2.12);
    // 짐칸의 연료통과 녹슨 상자
    box(0.34, 0.44, 0.5, can, 0.42, 1.13, -1.6);
    box(0.62, 0.34, 0.58, rust, -0.36, 1.08, -1.1);

    // 전조등·후미등은 조명 대신 자체 발광 색으로만 표현한다(블룸이 번지게 밝게).
    this.headMat = new THREE.MeshBasicMaterial({ color: 0x8a8a80 });
    this.tailMat = new THREE.MeshBasicMaterial({ color: 0x4a1410 });
    for (const s of [-1, 1]) {
      box(0.34, 0.18, 0.05, this.headMat, s * 0.62, 0.78, 2.11);
      box(0.24, 0.16, 0.05, this.tailMat, s * 0.74, 0.86, -2.16);
    }

    this.wheels = [];
    const wheelGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.28, 10).rotateZ(Math.PI / 2);
    const hubGeo = new THREE.BoxGeometry(0.04, 0.5, 0.12);
    const tyre = mat(0x26282a);
    for (const [x, z] of [[-0.88, 1.3], [0.88, 1.3], [-0.88, -1.3], [0.88, -1.3]]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, WHEEL_R, z);
      this.model.add(pivot);
      const w = new THREE.Mesh(wheelGeo, tyre);
      w.castShadow = true;
      pivot.add(w);
      meshes.push(w);
      // 굴러가는 게 보이도록 바퀴에 밝은 휠캡 막대
      const hub = new THREE.Mesh(hubGeo, cream);
      hub.position.x = x > 0 ? 0.15 : -0.15;
      w.add(hub);
      this.wheels.push({ pivot, w, front: z > 0 });
    }
    addXray(meshes, 0x30574d);

    // 전조등: 그림자는 손전등만 드리운다(그림자 맵 하나 더 그리는 비용을 아끼려고).
    this.light = new THREE.SpotLight(0xfff0d6, 0, LIGHT_RANGE + 8, LIGHT_ANGLE, 0.55, 1.2);
    this.light.position.set(0, 0.85, 2.2);
    this.light.target.position.set(0, 0, 9);
    this.model.add(this.light, this.light.target);
    this.beams = [];
    for (const s of [-1, 1]) {
      const beam = makeBeam(10, 0.3);
      beam.position.set(s * 0.62, 0.78, 2.14);
      beam.rotation.x = 0.06;
      beam.rotation.y = -s * 0.04;
      this.model.add(beam);
      this.beams.push(beam);
    }

    // 미끄러질 때 남는 바퀴 자국. 오래된 것부터 덮어쓰는 고리 버퍼.
    this.skids = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.24, 0.5).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x141618, transparent: true, opacity: 0.38, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      SKID_MAX,
    );
    this.skids.count = 0;
    this.skids.frustumCulled = false;
    this.skids.renderOrder = 1;
    scene.add(this.skids);
    this.skidNext = 0;
    this.skidDist = 0;

    this.pos = this.root.position;
    this.vel = new THREE.Vector3();
    this.reset(0, 0, 0);
  }

  reset(x, z, a, fuel = 40) {
    this.pos.set(x, 0, z);
    this.a = a;
    this.vel.set(0, 0, 0);
    this.fuel = fuel;
    this.occupied = false;
    this.reverse = false;
    this.steerVis = 0;
    this.prevVf = 0;
    this.crashCool = 0;
    this.slip = 0;
    this.braking = false;
    this.throttle = 0;
    this.skids.count = 0;
    this.skidNext = 0;
    this._place();
  }

  get speed() {
    return this.vel.x * Math.sin(this.a) + this.vel.z * Math.cos(this.a);
  }

  get running() {
    return this.occupied && this.fuel > 0;
  }

  // 점을 차체 좌표(lx: 오른쪽, lz: 앞쪽)로
  _local(x, z) {
    const dx = x - this.pos.x;
    const dz = z - this.pos.z;
    const s = Math.sin(this.a);
    const c = Math.cos(this.a);
    return { lx: -dx * c + dz * s, lz: dx * s + dz * c };
  }

  _world(lx, lz, out) {
    const s = Math.sin(this.a);
    const c = Math.cos(this.a);
    out.x = this.pos.x - lx * c + lz * s;
    out.z = this.pos.z + lx * s + lz * c;
    return out;
  }

  // 차체 사각형 가장자리까지 거리(안이면 0)
  distanceTo(x, z) {
    const { lx, lz } = this._local(x, z);
    return Math.hypot(Math.max(0, Math.abs(lx) - HALF_W), Math.max(0, Math.abs(lz) - HALF_L));
  }

  contains(x, z, pad = 0) {
    const { lx, lz } = this._local(x, z);
    return Math.abs(lx) < HALF_W + pad && Math.abs(lz) < HALF_L + pad;
  }

  // 반지름 r인 원을 차체 밖으로 밀어낸다. p는 x·z를 가진 객체.
  pushOut(p, r) {
    let { lx, lz } = this._local(p.x, p.z);
    const ox = HALF_W + r - Math.abs(lx);
    const oz = HALF_L + r - Math.abs(lz);
    if (ox <= 0 || oz <= 0) return false;
    if (ox < oz) lx = (lx < 0 ? -1 : 1) * (HALF_W + r);
    else lz = (lz < 0 ? -1 : 1) * (HALF_L + r);
    this._world(lx, lz, p);
    return true;
  }

  // 내릴 자리: 운전석 쪽부터 막히지 않은 곳을 고른다.
  exitSpot(world) {
    const tries = [[-(HALF_W + 0.75), 0.3], [HALF_W + 0.75, 0.3], [0, -(HALF_L + 0.75)], [0, HALF_L + 0.75]];
    for (const [lx, lz] of tries) {
      this._world(lx, lz, _a);
      _b.copy(_a);
      world.collide(_b, 0.36);
      if (_b.distanceTo(_a) < 0.05 && !this.contains(_b.x, _b.z, 0.3)) return { x: _b.x, z: _b.z };
    }
    this._world(tries[0][0], tries[0][1], _a);
    world.collide(_a, 0.36);
    return { x: _a.x, z: _a.z };
  }

  // 전조등 빛 안이면 0~1, 아니면 0
  beamStrength(x, z) {
    if (!this.running) return 0;
    const fx = Math.sin(this.a);
    const fz = Math.cos(this.a);
    const dx = x - (this.pos.x + fx * HALF_L);
    const dz = z - (this.pos.z + fz * HALF_L);
    const d = Math.hypot(dx, dz);
    if (d > LIGHT_RANGE || d < 0.01) return 0;
    const c = (dx * fx + dz * fz) / d;
    const edge = Math.cos(LIGHT_ANGLE * 0.95);
    if (c < edge) return 0;
    return Math.min(1, ((c - edge) / (1 - edge)) * 3) * (1 - (d / LIGHT_RANGE) * 0.5);
  }

  // 스틱으로 가고 싶은 방향(월드 dx, dz)과 세기를 받아 가속·핸들 입력으로 바꾼다(터치용).
  // 거의 뒤쪽을 가리키면 멈춘 상태에서 후진으로 전환하고, 옆으로 꺾으면 다시 전진한다.
  steerToward(dx, dz, mag) {
    if (mag < 0.15) {
      this.reverse = false;
      return { thr: 0, steer: 0 };
    }
    const want = Math.atan2(dx, dz);
    const diff = wrap(want - this.a);
    if (!this.reverse && Math.abs(diff) > 2.5 && this.speed < 1.5) this.reverse = true;
    if (this.reverse) {
      const back = wrap(want - this.a - Math.PI);
      if (Math.abs(back) <= 1.3) return { thr: -mag, steer: clamp(back * 2.2, -1, 1) };
      this.reverse = false;
    }
    return { thr: mag * (Math.abs(diff) > 1.6 ? 0.35 : 1), steer: clamp(-diff * 2.2, -1, 1) };
  }

  // ctl: { thr: -1~1(앞·뒤), steer: -1~1(오른쪽 +) }. 사람이 타지 않았으면 무시하고 주차 브레이크.
  update(dt, ctl, world, night) {
    const ev = { crash: 0, stalled: false };
    this.crashCool = Math.max(0, this.crashCool - dt);
    if (!this.occupied && this.vel.lengthSq() < 1e-6) {
      this.slip = 0;
      this.throttle = 0;
      this.braking = false;
      this._animate(dt, 0, 0, night);
      return ev;
    }
    const fx = Math.sin(this.a);
    const fz = Math.cos(this.a);
    let vf = this.vel.x * fx + this.vel.z * fz;
    let vl = -this.vel.x * fz + this.vel.z * fx;

    let thr = this.occupied && ctl ? clamp(ctl.thr, -1, 1) : 0;
    const steer = this.occupied && ctl ? clamp(ctl.steer, -1, 1) : 0;
    this.braking = false;
    if (!this.occupied) {
      vf = approach(vf, 0, BRAKE * dt);
    } else if (thr > 0 && vf < -0.3) {
      vf = approach(vf, 0, BRAKE * thr * dt);
      this.braking = true;
    } else if (thr < 0 && vf > 0.3) {
      vf = approach(vf, 0, BRAKE * -thr * dt);
      this.braking = true;
    } else if (thr !== 0 && this.fuel > 0) {
      const target = thr > 0 ? MAX_FWD * thr : MAX_REV * thr;
      if (Math.abs(vf) < Math.abs(target)) vf = approach(vf, target, ACCEL * (0.4 + 0.6 * Math.abs(thr)) * dt);
      else vf = approach(vf, target, COAST * dt);
    } else {
      vf = approach(vf, 0, COAST * dt);
    }
    if (this.braking || this.fuel <= 0) thr = 0;
    this.throttle = Math.abs(thr);

    // 핸들: 굴러야 돌고, 빠를수록 덜 꺾인다. 후진 중에는 반대로 돈다.
    const grip = Math.min(1, Math.abs(vf) / 3) / (1 + Math.abs(vf) * 0.045);
    const yaw = -steer * STEER_RATE * grip * Math.sign(vf);
    this.a = wrap(this.a + yaw * dt);
    // 속도 벡터는 그대로 두고 차체만 돌린 뒤, 옆으로 미끄러지는 성분을 접지력만큼 잡는다.
    this.vel.set(fx * vf - fz * vl, 0, fz * vf + fx * vl);
    const nfx = Math.sin(this.a);
    const nfz = Math.cos(this.a);
    vf = this.vel.x * nfx + this.vel.z * nfz;
    vl = approach(-this.vel.x * nfz + this.vel.z * nfx, 0, GRIP * dt);
    this.slip = Math.abs(vl);
    this.vel.set(nfx * vf - nfz * vl, 0, nfz * vf + nfx * vl);
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    // 충돌: 앞·뒤 두 원으로 차체를 근사해 정적 충돌체 밖으로 밀어낸다.
    _a.set(this.pos.x + nfx * AXLE, 0, this.pos.z + nfz * AXLE);
    _b.set(this.pos.x - nfx * AXLE, 0, this.pos.z - nfz * AXLE);
    const ax = _a.x, az = _a.z, bx = _b.x, bz = _b.z;
    world.collide(_a, COLLIDE_R);
    world.collide(_b, COLLIDE_R);
    const nx = _a.x - ax + _b.x - bx;
    const nz = _a.z - az + _b.z - bz;
    const push = Math.hypot(nx, nz);
    if (push > 1e-5) {
      this.pos.x = (_a.x + _b.x) / 2;
      this.pos.z = (_a.z + _b.z) / 2;
      // 한쪽 끝만 밀렸으면 차체가 그만큼 돈다(모서리로 스치며 비틀리는 느낌).
      this.a = wrap(this.a + clamp(wrap(Math.atan2(_a.x - _b.x, _a.z - _b.z) - this.a), -0.08, 0.08));
      const ux = nx / push;
      const uz = nz / push;
      const vn = this.vel.x * ux + this.vel.z * uz;
      if (vn < 0) {
        this.vel.x -= ux * vn * 1.25;
        this.vel.z -= uz * vn * 1.25;
        this.vel.multiplyScalar(0.94);
        if (-vn > 3.5 && this.crashCool <= 0) {
          ev.crash = -vn;
          this.crashCool = 0.4;
        }
      }
    }
    const gy = world.heightAt(this.pos.x, this.pos.z);
    this.pos.y += (gy - this.pos.y) * (1 - Math.exp(-dt * 14));

    // 연료
    if (this.running) {
      this.fuel = Math.max(0, this.fuel - (FUEL_IDLE + FUEL_DRIVE * this.throttle) * dt);
      if (this.fuel <= 0) ev.stalled = true;
    }

    // 바퀴 자국: 옆으로 크게 미끄러지거나 빠르게 급제동할 때
    const nvf = this.speed;
    const skidding = this.slip > 2.2 || (this.braking && Math.abs(nvf) > 7);
    this.skidDist += Math.abs(nvf) * dt;
    if (skidding && this.skidDist > 0.42) {
      this.skidDist = 0;
      for (const lx of [-0.88, 0.88]) this._skid(lx, -1.3, world);
      if (this.slip > 3.5) for (const lx of [-0.88, 0.88]) this._skid(lx, 1.3, world);
    }

    this._animate(dt, steer, nvf, night);
    this.prevVf = nvf;
    return ev;
  }

  _skid(lx, lz, world) {
    this._world(lx, lz, _p);
    _p.y = world.heightAt(_p.x, _p.z) + 0.03;
    const dir = Math.atan2(this.vel.x, this.vel.z);
    _q.setFromAxisAngle(_up, Number.isFinite(dir) ? dir : this.a);
    _m.compose(_p, _q, _s);
    this.skids.setMatrixAt(this.skidNext, _m);
    this.skids.instanceMatrix.needsUpdate = true;
    this.skidNext = (this.skidNext + 1) % SKID_MAX;
    this.skids.count = Math.min(SKID_MAX, this.skids.count + 1);
  }

  _animate(dt, steer, vf, night) {
    this.steerVis += (steer * 0.45 - this.steerVis) * (1 - Math.exp(-dt * 10));
    const spin = (vf * dt) / WHEEL_R;
    for (const wh of this.wheels) {
      wh.w.rotation.x += spin;
      if (wh.front) wh.pivot.rotation.y = -this.steerVis;
    }
    // 가감속에 앞뒤로, 회전에 옆으로 살짝 기울인다.
    const acc = dt > 0 ? (vf - this.prevVf) / dt : 0;
    const k = 1 - Math.exp(-dt * 6);
    this.model.rotation.x += (clamp(-acc * 0.006, -0.06, 0.06) - this.model.rotation.x) * k;
    this.model.rotation.z += (clamp(steer * vf * 0.004, -0.05, 0.05) - this.model.rotation.z) * k;
    this._place();

    const on = this.running ? 1 : 0;
    this.light.intensity = on * (4 + 46 * night);
    for (const b of this.beams) b.material.uniforms.uOpacity.value = on * night * 0.22;
    this.headMat.color.setRGB(0.55, 0.55, 0.5).multiplyScalar(on ? 1.6 + 4 * night : 1);
    const tail = this.braking ? 5 : on ? 1.4 + night : 0.35;
    this.tailMat.color.setRGB(0.9, 0.12, 0.08).multiplyScalar(tail);
    for (const m of this.mats) m.emissiveIntensity = 0.16 * night;
  }

  _place() {
    this.root.rotation.y = this.a;
  }
}
