import * as THREE from 'three';
import { makeBeam, addXray, PLAYER_R } from './player.js';
import { BOUND, queryColliders } from './world.js';

// 은신처 앞에 세워 둔 낡은 1톤 트럭(앞이 납작한 캡오버). 연료가 있으면 몰 수 있고, 밤에는 전조등이 그늘이를 태운다.
// 좌표 규약은 플레이어와 같다: 방향각 a의 정면 = (sin a, cos a), a가 커지면 왼쪽으로 돈다.

const HALF_W = 0.95;
const HALF_L = 2.15;
const REACH = Math.hypot(HALF_W, HALF_L); // 차체 중심에서 모서리까지
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
const LAMP_FUEL = 0.3; // 짐칸 작업등(발전기)이 쓰는 연료 %/s. 연료 40%면 밤 하나 남짓 버틴다.
const LAMP_MAX_SPEED = 1.5; // 작업등은 세워 둔 채로만 켠다. 이보다 빨리 움직이면 꺼진다.
const SKID_MAX = 480;
// 한 번에 움직이는 최대 거리(m, 차체 모서리 기준). 프레임 이동이 이보다 길면 잘게 나눠 움직인다.
// 얇은 충돌체를 건너뛰려면 차체 중심이 그 한가운데를 넘어야 하므로(반폭 0.95 + 울타리 반두께 0.08),
// 그보다 훨씬 짧게 잡아 최고속·프레임 간격을 올려도 울타리(두께 0.16)·전봇대(반지름 0.17)를 뚫지 않는다.
const MAX_STEP = 0.3;
const MAX_SUBSTEPS = 32;
const SWEEP_PAD = 1; // 충돌 질의 범위 여유(m). 한 번 밀어낼 때 이보다 많이 밀리면 다음 반복에서 다시 고른다.
// 연료통 하나가 채우는 양(%). 넘쳐 버리지 않게 통째로 들어갈 자리가 있을 때만 붓는다(연료 60% 이하).
export const CAN_FUEL = 40;

// 내릴 자리 후보(차체 좌표, lx: 오른쪽, lz: 앞쪽). 운전석(왼쪽) 문 → 조수석 문 → 뒤 → 앞 → 옆 앞뒤 → 네 모서리 순서를
// 문에서 점점 멀리 되풀이한다. 처음 네 곳은 예전 후보와 같다.
const EXIT_SPOTS = [];
for (const o of [0.75, 1.3, 2.0, 3.0, 4.5]) {
  const sx = HALF_W + o;
  const sz = HALF_L + o;
  const cx = HALF_W + o * 0.7;
  const cz = HALF_L + o * 0.7;
  EXIT_SPOTS.push(
    [-sx, 0.3], [sx, 0.3], [0, -sz], [0, sz],
    [-sx, -1.4], [sx, -1.4], [-sx, 1.4], [sx, 1.4],
    [-cx, -cz], [cx, -cz], [-cx, cz], [cx, cz],
  );
}

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
const _near = [];

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
    const paint = mat(0x8fb6cf); // 하늘색 1톤 트럭
    const alum = mat(0xc9cfd1); // 짐칸 문짝
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

    // 차체: 운전석이 앞바퀴 위에 올라앉은 캡오버, 뒤쪽은 낮은 알루미늄 문짝 짐칸
    box(1.7, 0.25, 4.1, dark, 0, 0.55, 0); // 차대
    box(1.9, 0.1, 2.9, mat(0xa9b0b2), 0, 0.92, -0.72); // 짐칸 바닥
    for (const s of [-1, 1]) box(0.06, 0.42, 2.9, alum, s * 0.93, 1.18, -0.72);
    box(1.9, 0.42, 0.06, alum, 0, 1.18, -2.15);
    box(1.9, 0.95, 0.08, dark, 0, 1.42, 0.68); // 운전석 뒤 보호대
    box(1.86, 1.0, 1.42, paint, 0, 1.15, 1.44); // 운전석 아래
    box(1.8, 0.46, 1.2, glass, 0, 1.86, 1.47); // 옆 유리
    box(1.62, 0.5, 0.05, glass, 0, 1.84, 2.14); // 앞 유리
    for (const s of [-1, 1]) box(0.1, 0.5, 0.12, paint, s * 0.88, 1.86, 2.1); // 앞 기둥
    box(1.86, 0.1, 1.42, paint, 0, 2.14, 1.44); // 지붕
    box(1.86, 0.08, 1.44, cream, 0, 1.52, 1.44); // 띠
    box(1.94, 0.2, 0.16, dark, 0, 0.5, 2.18);
    box(1.94, 0.2, 0.16, dark, 0, 0.5, -2.14);
    box(1.1, 0.16, 0.04, cream, 0, 0.98, 2.16); // 그릴
    // 짐칸의 연료통과 녹슨 상자
    box(0.34, 0.44, 0.5, can, 0.42, 1.13, -1.6);
    box(0.62, 0.34, 0.58, rust, -0.36, 1.08, -1.1);
    // 짐칸 발전기와 작업등 기둥: 세워 두고 켜면 트럭 둘레가 가로등 아래처럼 안전해진다.
    box(0.56, 0.38, 0.46, mat(0x6d7a5c), -0.38, 1.09, -1.72);
    box(0.06, 1.7, 0.06, dark, 0.66, 1.75, -0.86);
    this.lampMat = new THREE.MeshBasicMaterial({ color: 0x5a564c });
    box(0.34, 0.2, 0.22, this.lampMat, 0.66, 2.62, -0.86);

    // 전조등·후미등은 조명 대신 자체 발광 색으로만 표현한다(블룸이 번지게 밝게).
    this.headMat = new THREE.MeshBasicMaterial({ color: 0x8a8a80 });
    this.tailMat = new THREE.MeshBasicMaterial({ color: 0x4a1410 });
    for (const s of [-1, 1]) {
      box(0.34, 0.18, 0.05, this.headMat, s * 0.62, 0.78, 2.17);
      box(0.24, 0.16, 0.05, this.tailMat, s * 0.74, 0.86, -2.19);
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
      beam.position.set(s * 0.62, 0.78, 2.19);
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
    this.lamp = false;
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

  // 가진 연료통 중 지금 넘치지 않게 부을 수 있는 수
  cansToPour(cans) {
    return Math.max(0, Math.min(cans, Math.floor((100 - this.fuel) / CAN_FUEL + 1e-9)));
  }

  // 넘치지 않을 만큼 연료통을 붓고 부은 수를 돌려준다.
  pour(cans) {
    const n = this.cansToPour(cans);
    this.fuel = Math.min(100, this.fuel + n * CAN_FUEL);
    return n;
  }

  // 짐칸 작업등을 켜고 끈다. 켤 수 없으면 이유('nofuel' | 'moving')를, 아니면 'on' | 'off'를 돌려준다.
  toggleLamp() {
    if (this.lamp) {
      this.lamp = false;
      return 'off';
    }
    if (this.fuel <= 0) return 'nofuel';
    if (Math.abs(this.speed) > LAMP_MAX_SPEED) return 'moving';
    this.lamp = true;
    return 'on';
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

  // 내릴 자리: 운전석 문 앞부터 둘레를 넓혀 가며, 충돌체 밖이고 문에서 벽에 막히지 않고 걸어 나갈 수 있는 곳을 고른다.
  // 그런 곳이 없으면 null(트럭을 조금 옮겨 세워야 한다). 다만 연료가 없어 움직일 수 없거나 force면 걸어 나갈 길이
  // 없어도 비어 있는 자리를 고른다(멈춘 트럭에 갇히지 않게). 어느 경우든 차체와 겹치는 자리는 돌려주지 않는다.
  exitSpot(world, { force = false } = {}) {
    for (const reach of [true, false]) {
      if (!reach && !force && this.fuel > 0) return null;
      for (const [lx, lz] of EXIT_SPOTS) {
        this._world(lx, lz, _a);
        const spot = this._freeSpot(world, _a.x, _a.z);
        if (spot && (!reach || this._walkOut(world, lx, lz, spot))) return spot;
      }
    }
    if (!force) return null;
    // 둘레 4.5m 안이 모두 막힌 경우(마을에는 없다): 운전석 쪽을 충돌체 밖으로, 다시 차체 밖으로 민다.
    this._world(EXIT_SPOTS[0][0], EXIT_SPOTS[0][1], _a);
    world.collide(_a, PLAYER_R);
    for (let i = 0; i < 3 && this.pushOut(_a, PLAYER_R + 0.02); i++) world.collide(_a, PLAYER_R);
    return { x: _a.x, z: _a.z };
  }

  // (x, z)에 플레이어가 설 수 있으면(정적 충돌체·마을 경계·차체와 겹치지 않으면) 그 자리, 아니면 null.
  // 충돌체에 살짝(5cm 미만) 닿는 자리는 밀려난 곳을 쓴다.
  _freeSpot(world, x, z) {
    _b.set(x, 0, z);
    world.collide(_b, PLAYER_R);
    if (Math.hypot(_b.x - x, _b.z - z) >= 0.05) return null;
    const sx = _b.x;
    const sz = _b.z;
    world.collide(_b, PLAYER_R);
    if (_b.x !== sx || _b.z !== sz) return null;
    if (this.distanceTo(sx, sz) < PLAYER_R + 0.05) return null;
    return { x: sx, z: sz };
  }

  // 차체 가장자리(후보 쪽 문 앞)에서 후보 자리까지 플레이어가 지나갈 수 있는지(그 사이에 벽·울타리가 없는지).
  _walkOut(world, lx, lz, spot) {
    const qx = clamp(lx, -HALF_W, HALF_W);
    const qz = clamp(lz, -HALF_L, HALF_L);
    const len = Math.hypot(lx - qx, lz - qz);
    if (len < 1e-6) return false;
    const off = PLAYER_R + 0.05;
    this._world(qx + ((lx - qx) / len) * off, qz + ((lz - qz) / len) * off, _p);
    const dx = spot.x - _p.x;
    const dz = spot.z - _p.z;
    const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.15));
    const r = PLAYER_R - 0.02;
    for (let i = 0; i <= n; i++) {
      const x = _p.x + (dx * i) / n;
      const z = _p.z + (dz * i) / n;
      _b.set(x, 0, z);
      world.collide(_b, r);
      if (Math.abs(_b.x - x) > 1e-6 || Math.abs(_b.z - z) > 1e-6) return false;
    }
    return true;
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
  // 거의 뒤쪽을 가리키면 먼저 브레이크를 밟고, 멈추면 후진으로 전환한다. 옆으로 꺾으면 다시 전진한다.
  steerToward(dx, dz, mag) {
    if (mag < 0.15) {
      this.reverse = false;
      return { thr: 0, steer: 0 };
    }
    const want = Math.atan2(dx, dz);
    const diff = wrap(want - this.a);
    if (!this.reverse && Math.abs(diff) > 2.5) {
      if (this.speed >= 1.5) return { thr: -mag, steer: 0 };
      this.reverse = true;
    }
    if (this.reverse) {
      const back = wrap(want - this.a - Math.PI);
      if (Math.abs(back) <= 1.3) return { thr: -mag, steer: clamp(back * 2.2, -1, 1) };
      this.reverse = false;
    }
    return { thr: mag * (Math.abs(diff) > 1.6 ? 0.35 : 1), steer: clamp(-diff * 2.2, -1, 1) };
  }

  // ctl: { thr: -1~1(앞·뒤), steer: -1~1(오른쪽 +) }. 사람이 타지 않았으면 무시하고 주차 브레이크.
  update(dt, ctl, world, night) {
    const ev = { crash: 0, stalled: false, lampOut: null };
    this.crashCool = Math.max(0, this.crashCool - dt);
    if (this.lamp) {
      this.fuel = Math.max(0, this.fuel - LAMP_FUEL * dt);
      if (this.fuel <= 0) {
        this.lamp = false;
        ev.lampOut = 'fuel';
      }
    }
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
    const vl = -this.vel.x * fz + this.vel.z * fx;

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

    // 정한 앞·옆 속도를 월드 속도로 돌려 둔 뒤 움직인다. 프레임 이동(모서리가 도는 거리 포함)이 MAX_STEP보다 길면
    // 잘게 나눠 움직인다(최고속이나 프레임 간격을 올려도 얇은 충돌체를 건너뛰지 않게). 나눠도 속도는 늘지 않는다.
    this.vel.set(fx * vf - fz * vl, 0, fz * vf + fx * vl);
    const sweep = (this.vel.length() + STEER_RATE * Math.abs(steer) * REACH) * dt;
    const n = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(sweep / MAX_STEP)));
    for (let i = 0; i < n; i++) this._step(dt / n, steer, world, ev);

    const gy = world.heightAt(this.pos.x, this.pos.z);
    this.pos.y += (gy - this.pos.y) * (1 - Math.exp(-dt * 14));

    // 연료
    if (this.lamp && Math.abs(this.speed) > LAMP_MAX_SPEED) {
      this.lamp = false;
      ev.lampOut = 'moving';
    }
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

  // 한 걸음(h초): 핸들만큼 돌고, 옆미끄러짐을 접지력만큼 잡고, 움직인 뒤 정적 충돌체 밖으로 밀어낸다.
  _step(h, steer, world, ev) {
    // 겹치지 않았던 이 걸음의 시작 상태(좁은 틈에 끼면 여기서 다른 움직임을 찾는다)
    const ox = this.pos.x;
    const oz = this.pos.z;
    const oa = this.a;
    // 핸들: 굴러야 돌고, 빠를수록 덜 꺾인다. 후진 중에는 반대로 돈다.
    const vf = this.vel.x * Math.sin(oa) + this.vel.z * Math.cos(oa);
    const grip = Math.min(1, Math.abs(vf) / 3) / (1 + Math.abs(vf) * 0.045);
    const na = wrap(oa - steer * STEER_RATE * grip * Math.sign(vf) * h);
    // 속도 벡터는 그대로 두고 차체만 돌린 뒤, 옆으로 미끄러지는 성분을 접지력만큼 잡는다.
    const vNew = this._gripped(na, h);
    this.slip = vNew.slip;

    // 충돌: 차체를 회전된 직사각형 그대로 정적 충돌체 밖으로 밀어낸다(한 벽이면 그 벽을 따라 미끄러진다).
    let r = this._tryPose(world, ox + vNew.x * h, oz + vNew.z * h, na);
    let v = vNew;
    if (!r.ok) {
      // 차폭보다 조금 넓은 틈에서 양쪽 벽에 끼면 미는 힘이 서로 상쇄되어 풀리지 않는다. 이 걸음을 통째로 취소하면
      // 핸들을 그쪽으로 꺾은 채로는 그 자리에 멈춘 것처럼 보이므로, 겹치지 않는 움직임을 차례로 찾는다:
      // 돌지 않고 이동 → 차가 향한 쪽으로만 이동 → 월드 축 하나로만 이동(축에 맞춘 골목·담을 따라) → 돌기만 → 그대로.
      // 돌지 못하면 속도도 돌리지 않는다. 마지막 '그대로'는 시작 상태가 부동소수 오차로 살짝 겹쳐 있었을 때
      // 거기서 한 번 더 밀어낸다.
      const vOld = this._gripped(oa, h);
      const fwd = (u, a) => {
        const s = Math.sin(a);
        const c = Math.cos(a);
        const d = (u.x * s + u.z * c) * h;
        return [s * d, c * d];
      };
      const xFirst = Math.abs(vOld.x) >= Math.abs(vOld.z);
      const ax = [vOld.x * h, 0];
      const az = [0, vOld.z * h];
      const tries = [
        [vOld, [vOld.x * h, vOld.z * h], oa],
        [vNew, fwd(vNew, na), na],
        [vOld, fwd(vOld, oa), oa],
        [vOld, xFirst ? ax : az, oa],
        [vOld, xFirst ? az : ax, oa],
        [vNew, [0, 0], na],
        [vOld, [0, 0], oa],
      ];
      let moved = tries[tries.length - 1];
      for (const t of tries) {
        r = this._tryPose(world, ox + t[1][0], oz + t[1][1], t[2]);
        if (r.ok) {
          moved = t;
          break;
        }
      }
      v = moved[0];
      this.vel.set(v.x, 0, v.z);
      // 빠진 이동 성분 쪽으로 가던 속도만 지운다(벽 쪽으로 미는 성분이 사라지고 나머지로 미끄러진다).
      const cx = v.x * h - moved[1][0];
      const cz = v.z * h - moved[1][1];
      const cl = Math.hypot(cx, cz);
      if (cl > 1e-9) {
        const ux = cx / cl;
        const uz = cz / cl;
        const vn = this.vel.x * ux + this.vel.z * uz;
        if (vn > 0) {
          this.vel.x -= ux * vn;
          this.vel.z -= uz * vn;
          this._crash(vn, ev);
        }
      }
      if (!r.ok) return;
    } else {
      this.vel.set(v.x, 0, v.z);
    }
    const push = Math.hypot(r.x, r.z);
    if (push > 1e-5) {
      const ux = r.x / push;
      const uz = r.z / push;
      const vn = this.vel.x * ux + this.vel.z * uz;
      if (vn < 0) {
        // 세게 부딪히면 조금 튕기고, 느리게 밀고 있을 때는 튕기지 않고 벽을 따라 미끄러진다
        // (저속에서 튕기면 앞뒤 방향이 번갈아 바뀌어 핸들이 반대로 먹고, 틈에 끼어 못 빠져나온다).
        const bounce = -vn > 2 ? 1.25 : 1;
        this.vel.x -= ux * vn * bounce;
        this.vel.z -= uz * vn * bounce;
        this.vel.multiplyScalar(Math.exp(-h * 2.5));
        this._crash(-vn, ev);
      }
    }
  }

  // 지금 속도를 방향 a의 차체 기준으로 보고 옆미끄러짐 성분을 접지력만큼(h초) 잡은 속도. this.vel은 건드리지 않는다.
  _gripped(a, h) {
    const s = Math.sin(a);
    const c = Math.cos(a);
    const vf = this.vel.x * s + this.vel.z * c;
    const vl = approach(-this.vel.x * c + this.vel.z * s, 0, GRIP * h);
    return { x: s * vf - c * vl, z: c * vf + s * vl, slip: Math.abs(vl) };
  }

  _crash(hit, ev) {
    if (hit > 3.5 && this.crashCool <= 0) {
      ev.crash = hit;
      this.crashCool = 0.4;
    }
  }

  // 차체를 (x, z, 방향 a)에 놓고 겹침을 푼다. _resolve의 결과를 돌려준다.
  _tryPose(world, x, z, a) {
    this.pos.x = x;
    this.pos.z = z;
    this.a = a;
    return this._resolve(world);
  }

  // 모서리에 여러 충돌체가 겹치면 몇 번 반복해 푼다. ok가 거짓이면 끝내 겹침이 남은 것(끼임).
  // 반복마다 그 자리 둘레의 충돌체를 새로 고르므로, 한 번에 SWEEP_PAD보다 많이 밀려도 다음 반복이 잡는다.
  // ok는 아무것도 밀어내지 않은(그래서 고른 범위를 벗어나지 않은) 반복이 있을 때만 참이다.
  _resolve(world) {
    let x = 0;
    let z = 0;
    for (let i = 0; i < 3; i++) {
      const r = this._collide(world);
      x += r.x;
      z += r.z;
      if (r.depth < 1e-4) return { x, z, ok: true };
    }
    return { x, z, ok: false };
  }

  // 차체(회전된 직사각형)와 정적 충돌체(축 정렬 상자·원)의 겹침을 풀어 위치를 고친다.
  // 밀어낸 총 변위(x, z)와 겹침 깊이의 합(depth, 0이면 겹친 곳 없음)을 돌려준다.
  // 상자는 분리축 정리(월드 x·z축, 차의 앞·옆 축)로 가장 얕게 겹친 축을 따라 밀어낸다.
  _collide(world) {
    const s = Math.sin(this.a);
    const c = Math.cos(this.a);
    const as = Math.abs(s);
    const ac = Math.abs(c);
    const carX = HALF_W * ac + HALF_L * as; // 차체를 월드 x·z축에 투영한 반길이
    const carZ = HALF_W * as + HALF_L * ac;
    let px = this.pos.x;
    let pz = this.pos.z;
    let tx = 0;
    let tz = 0;
    let depth = 0;
    const cols = world.colliders;
    const near = queryColliders(cols, px - carX - SWEEP_PAD, pz - carZ - SWEEP_PAD, px + carX + SWEEP_PAD, pz + carZ + SWEEP_PAD, _near);
    for (let k = 0; k < near.length; k++) {
      const col = cols[near[k]];
      if (col.t === 0) {
        const ex = (col.x1 - col.x0) / 2;
        const ez = (col.z1 - col.z0) / 2;
        const dx = px - (col.x0 + ex);
        const dz = pz - (col.z0 + ez);
        if (Math.abs(dx) >= ex + carX || Math.abs(dz) >= ez + carZ) continue;
        const df = dx * s + dz * c;
        const dr = -dx * c + dz * s;
        const of = HALF_L + ex * as + ez * ac - Math.abs(df);
        const or = HALF_W + ex * ac + ez * as - Math.abs(dr);
        if (of <= 0 || or <= 0) continue;
        // 네 축 중 가장 얕게 겹친 축(차를 상자에서 떼어 내는 쪽)
        const ox = ex + carX - Math.abs(dx);
        const oz = ez + carZ - Math.abs(dz);
        let o = ox;
        let mx = Math.sign(dx) || 1;
        let mz = 0;
        if (oz < o) { o = oz; mx = 0; mz = Math.sign(dz) || 1; }
        if (of < o) { o = of; const g = Math.sign(df) || 1; mx = s * g; mz = c * g; }
        if (or < o) { o = or; const g = Math.sign(dr) || 1; mx = -c * g; mz = s * g; }
        depth += o;
        px += mx * o;
        pz += mz * o;
        tx += mx * o;
        tz += mz * o;
      } else {
        const dx = col.x - px;
        const dz = col.z - pz;
        if (dx * dx + dz * dz >= (REACH + col.r) ** 2) continue;
        // 원 중심을 차체 좌표로 옮겨 사각형 위 가장 가까운 점과 비교
        const lx = -dx * c + dz * s;
        const lz = dx * s + dz * c;
        let ux = lx - clamp(lx, -HALF_W, HALF_W);
        let uz = lz - clamp(lz, -HALF_L, HALF_L);
        const d = Math.hypot(ux, uz);
        let o;
        if (d > 1e-6) {
          if (d >= col.r) continue;
          o = col.r - d;
          ux /= d;
          uz /= d;
        } else if (HALF_W - Math.abs(lx) < HALF_L - Math.abs(lz)) {
          o = HALF_W - Math.abs(lx) + col.r;
          ux = Math.sign(lx) || 1;
          uz = 0;
        } else {
          o = HALF_L - Math.abs(lz) + col.r;
          ux = 0;
          uz = Math.sign(lz) || 1;
        }
        // 차는 원에서 멀어지는 쪽(차체 좌표의 -u)으로 밀린다.
        const mx = c * ux - s * uz;
        const mz = -s * ux - c * uz;
        depth += o;
        px += mx * o;
        pz += mz * o;
        tx += mx * o;
        tz += mz * o;
      }
    }
    const cx = clamp(px, -BOUND + carX, BOUND - carX);
    const cz = clamp(pz, -BOUND + carZ, BOUND - carZ);
    tx += cx - px;
    tz += cz - pz;
    depth += Math.abs(cx - px) + Math.abs(cz - pz);
    this.pos.x = cx;
    this.pos.z = cz;
    return { x: tx, z: tz, depth };
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
    this.lampMat.color.setRGB(0.4, 0.39, 0.34).multiplyScalar(this.lamp && this.fuel > 0 ? 2.5 + 6 * night : 1);
  }

  _place() {
    this.root.rotation.y = this.a;
  }
}
