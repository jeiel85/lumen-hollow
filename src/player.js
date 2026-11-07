import * as THREE from 'three';
import { DEFAULT_WEAR, buildPart, disposeTree, itemById } from './wardrobe.js';

export const SPEED = 5.2;
export const PLAYER_R = 0.36; // 충돌 반지름
export const FLASH_RANGE = 13;
const FLASH_ANGLE = 0.42;
const BEAM_LEN = 10;
const BEAM_HALF = 0.33;

// 손전등·전조등이 비 오는 밤공기에 그리는 빛줄기. 꼭짓점이 원점, 밑면이 +z 쪽(len)인 열린 원뿔.
export function makeBeam(len, half) {
  const geom = new THREE.ConeGeometry(Math.tan(half) * len, len, 28, 1, true)
    .translate(0, -len / 2, 0)
    .rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 }, uColor: { value: new THREE.Color(1.0, 0.92, 0.75) }, uLen: { value: len } },
    vertexShader: `uniform float uLen; varying float vT; varying vec3 vN;
      void main(){ vT = position.z / uLen; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uOpacity; uniform vec3 uColor; varying float vT; varying vec3 vN;
      void main(){ float edge = pow(clamp(abs(vN.z), 0.0, 1.0), 1.6); float a = pow(clamp(1.0 - vT, 0.0, 1.0), 2.0) * smoothstep(0.0, 0.06, vT) * edge * uOpacity; gl_FragColor = vec4(uColor, a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.renderOrder = 7;
  return mesh;
}

// 건물에 가려졌을 때 보이는 실루엣. 깊이 비교를 반전한 가산 재질을 불투명 패스에서
// 몸체보다 먼저(renderOrder 1 < 2) 그려서, 자기 몸에 가린 부분은 실루엣이 생기지 않게 한다.
export function addXray(meshes, color) {
  const xray = new THREE.MeshBasicMaterial({ color, blending: THREE.AdditiveBlending, depthFunc: THREE.GreaterDepth, depthWrite: false });
  for (const m of meshes) {
    m.renderOrder = 2;
    const ghost = new THREE.Mesh(m.geometry, xray);
    ghost.renderOrder = 1;
    m.add(ghost);
  }
}

const UP = new THREE.Vector3(0, 1, 0);

const lerpAngle = (a, b, t) => {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

export class Player {
  constructor(scene, { mobile = false } = {}) {
    this.root = new THREE.Group();
    this.model = new THREE.Group();
    this.root.add(this.model);
    scene.add(this.root);

    // 밤에도 주인공이 묻히지 않도록 자기 색으로 살짝 빛나게 한다 (update에서 세기 조절)
    this.mats = [];
    const mat = (c) => {
      const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, flatShading: true, emissive: c, emissiveIntensity: 0 });
      this.mats.push(m);
      return m;
    };
    const coat = mat(0xe3b13d);
    const pants = mat(0x3a4658);
    const skin = mat(0xefc8a6);
    const boot = mat(0x3a2e28);
    const dark = mat(0x26292c);
    const hairMat = mat(0x4a3426);
    this.coatMat = coat;
    const meshes = [];
    const add = (geo, m, x, y, z, parent = this.model, shadow = true) => {
      const me = new THREE.Mesh(geo, m);
      me.position.set(x, y, z);
      me.castShadow = shadow;
      parent.add(me);
      meshes.push(me);
      return me;
    };

    this.legs = [];
    for (const s of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(s * 0.11, 0.62, 0);
      this.model.add(hip);
      add(new THREE.BoxGeometry(0.15, 0.48, 0.17), pants, 0, -0.26, 0, hip);
      add(new THREE.BoxGeometry(0.17, 0.12, 0.24), boot, 0, -0.54, 0.03, hip);
      this.legs.push(hip);
    }
    this.body = new THREE.Group();
    this.model.add(this.body);
    add(new THREE.CylinderGeometry(0.24, 0.34, 0.78, 8), coat, 0, 0.98, 0, this.body);
    add(new THREE.SphereGeometry(0.22, 10, 8), skin, 0, 1.52, 0.02, this.body);
    this.hood = add(new THREE.SphereGeometry(0.26, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), coat, 0, 1.55, -0.05, this.body);
    this.hood.rotation.x = -0.35;
    // 후드를 벗으면(모자를 쓰거나 맨머리) 보이는 머리카락. 이마가 드러나게 뒤로 기울인다.
    this.hair = add(new THREE.SphereGeometry(0.232, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.56), hairMat, 0, 1.53, 0, this.body);
    this.hair.rotation.x = -0.45;
    this.hair.visible = false;
    // 모자·안경·배낭은 setOutfit이 갈아 끼운다.
    this.parts = { hat: null, glasses: null, pack: null };
    this.partMats = [];

    // 오른팔(-x): 어깨에 매달려 걸음에 맞춰 흔든다. 앞으로 흔들 때 팔꿈치가 조금 더 굽는다.
    this.arm = new THREE.Group();
    this.arm.position.set(-0.27, 1.26, 0);
    this.arm.rotation.z = -0.2; // 몸통(아래로 넓어지는 원뿔)에 파묻히지 않게 살짝 벌린다
    this.body.add(this.arm);
    add(new THREE.BoxGeometry(0.12, 0.31, 0.13), coat, 0, -0.135, 0, this.arm);
    this.elbow = new THREE.Group();
    this.elbow.position.y = -0.27;
    this.arm.add(this.elbow);
    add(new THREE.BoxGeometry(0.11, 0.25, 0.12), coat, 0, -0.11, 0, this.elbow);
    add(new THREE.BoxGeometry(0.09, 0.1, 0.1), skin, 0, -0.28, 0, this.elbow);

    // 왼팔(+x): 손전등을 허리 높이에서 앞으로 겨눈 채 고정한다. 빛줄기·조명이 model에 고정돼
    // 있으므로 이 팔은 흔들지 않는다. 어깨→팔꿈치→손목을 점으로 잡고 마디를 그 사이에 놓는다.
    const limb = (a, b, w, d) => {
      const dir = new THREE.Vector3().subVectors(b, a);
      // 관절에서 이웃 마디와 겹쳐 틈이 보이지 않도록 양 끝을 0.03씩 늘린다
      const me = add(new THREE.BoxGeometry(w, dir.length() + 0.06, d), coat, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, this.body);
      me.quaternion.setFromUnitVectors(UP, dir.normalize());
    };
    const shoulder = new THREE.Vector3(0.27, 1.26, 0);
    const elbow = new THREE.Vector3(0.35, 1.0, 0.05);
    const wrist = new THREE.Vector3(0.31, 0.93, 0.23);
    limb(shoulder, elbow, 0.12, 0.13);
    limb(elbow, wrist, 0.11, 0.12);
    add(new THREE.BoxGeometry(0.12, 0.12, 0.09), skin, 0.3, 0.92, 0.27, this.body); // 손전등을 쥔 주먹
    add(new THREE.CylinderGeometry(0.05, 0.06, 0.26, 8), dark, 0.3, 0.92, 0.36, this.body, false).rotation.x = Math.PI / 2;

    addXray(meshes, 0x6a5634);
    this.setOutfit(DEFAULT_WEAR);

    // 손전등
    this.flash = new THREE.SpotLight(0xfff0d2, 0, FLASH_RANGE + 7, FLASH_ANGLE, 0.5, 1.15);
    this.flash.position.set(0.3, 0.95, 0.52);
    this.flash.target.position.set(0.3, 0.2, 6);
    this.flash.castShadow = true;
    const fs = this.flash.shadow;
    fs.mapSize.set(mobile ? 512 : 1024, mobile ? 512 : 1024);
    fs.camera.near = 0.3;
    fs.camera.far = FLASH_RANGE + 7;
    fs.bias = -0.0008;
    fs.normalBias = 0.02;
    this.model.add(this.flash, this.flash.target);

    this.beam = makeBeam(BEAM_LEN, BEAM_HALF);
    this.beamMat = this.beam.material;
    this.beam.position.set(0.3, 0.95, 0.5);
    this.beam.rotation.x = 0.07;
    this.model.add(this.beam);

    // 발밑 표시 고리
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.52, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xfff1c9, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    ring.position.y = 0.03;
    this.root.add(ring);
    this.ring = ring;

    this.pos = this.root.position;
    this.vel = new THREE.Vector3();
    this.facing = 0;
    this.phase = 0;
    this.footfall = 0;
    this.reset(0, 0);
  }

  reset(x, z) {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.facing = 0;
    this.hp = 100;
    this.battery = 100;
    this.fuses = 1;
    this.bandages = 0;
    this.cans = 0;
    this.flashOn = false;
    // update가 돌지 않는 화면(처음 화면·옷장)에서도 지난 판의 손전등 빛이 남지 않게 바로 끈다.
    this.flash.intensity = 0;
    this.beamMat.uniforms.uOpacity.value = 0;
    this.invuln = 0;
    this.hurtFx = 0;
    this.alive = true;
    this.setRiding(false);
  }

  // 차에 타 있는 동안은 몸을 숨기고 손전등을 끈다. 손전등 조명 자체는 장면에 남겨 둔다
  // (조명 개수가 바뀌면 모든 재질의 셰이더가 다시 컴파일되어 프레임이 멈춘다).
  setRiding(on) {
    this.riding = on;
    this.body.visible = !on;
    for (const l of this.legs) l.visible = !on;
    this.ring.visible = !on;
    this.beam.visible = !on;
    if (on) this.flashOn = false;
    this.vel.set(0, 0, 0);
  }

  // 옷장 착용 상태를 모델에 반영한다. 비옷 색은 몸통·팔·후드가 함께 쓰는 재질 색을 바꾸고,
  // 모자·안경·배낭은 부품을 새로 만들어 끼운다(이전 부품은 GPU 자원까지 해제).
  setOutfit(wear) {
    const coat = itemById(wear.coat) ?? itemById(DEFAULT_WEAR.coat);
    this.coatMat.color.setHex(coat.color);
    this.coatMat.emissive.setHex(coat.color);
    this.hood.visible = wear.hat === 'hat.hood';
    this.hair.visible = !this.hood.visible;
    // 모자 아래에서는 머리카락을 조금 줄여 모자 겉면을 뚫고 나오지 않게 한다.
    this.hair.scale.setScalar(wear.hat === 'hat.bare' ? 1 : 0.95);
    this.partMats.length = 0;
    const mat = (c, opts = {}) => {
      const m = new THREE.MeshStandardMaterial({ color: c, roughness: opts.roughness ?? 0.75, flatShading: true, emissive: c, emissiveIntensity: 0 });
      this.partMats.push(m);
      return m;
    };
    for (const slot of Object.keys(this.parts)) {
      const old = this.parts[slot];
      if (old) {
        this.body.remove(old);
        disposeTree(old);
      }
      const g = buildPart(wear[slot], mat);
      if (g) {
        const meshes = [];
        g.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            meshes.push(o);
          }
        });
        addXray(meshes, 0x6a5634);
        this.body.add(g);
      }
      this.parts[slot] = g;
    }
    // 바뀐 재질의 밤 발광 세기를 다음 update 전에도 맞춰 둔다.
    for (const m of this.partMats) m.emissiveIntensity = this.mats[0].emissiveIntensity;
  }

  // 옷장 미리보기용 차렷 자세(걷기 흔적을 지우고 빈팔만 숨 쉬듯 살짝 흔든다)
  idlePose(t) {
    this.legs[0].rotation.x = 0;
    this.legs[1].rotation.x = 0;
    this.body.position.y = 0;
    this.body.rotation.z = 0;
    this.arm.rotation.x = Math.sin(t * 1.7) * 0.03;
    this.elbow.rotation.x = -0.18;
  }

  get flashActive() {
    return this.flashOn && this.battery > 0;
  }

  hurt(amount, fromX, fromZ) {
    if (this.invuln > 0 || !this.alive) return false;
    this.hp = Math.max(0, this.hp - amount);
    this.invuln = 0.9;
    this.hurtFx = 1;
    const dx = this.pos.x - fromX;
    const dz = this.pos.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    this.vel.x += (dx / d) * 7;
    this.vel.z += (dz / d) * 7;
    if (this.hp <= 0) this.alive = false;
    return true;
  }

  // 빛줄기 안에 있으면 0~1 강도, 아니면 0
  beamStrength(x, z) {
    if (!this.flashActive) return 0;
    const dx = x - this.pos.x;
    const dz = z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > FLASH_RANGE || d < 0.01) return 0;
    const c = (dx * Math.sin(this.facing) + dz * Math.cos(this.facing)) / d;
    const edge = Math.cos(FLASH_ANGLE * 0.95);
    if (c < edge) return 0;
    return Math.min(1, (c - edge) / (1 - edge) * 3) * (1 - (d / FLASH_RANGE) * 0.5);
  }

  update(dt, t, move, aim, world, night, rain) {
    this.invuln = Math.max(0, this.invuln - dt);
    this.hurtFx = Math.max(0, this.hurtFx - dt * 1.8);
    this.footfall = 0;
    if (this.riding) {
      this.flash.intensity = 0;
      this.beamMat.uniforms.uOpacity.value = 0;
      return 0;
    }

    const k = 1 - Math.exp(-dt * 12);
    this.vel.x += (move.x * SPEED - this.vel.x) * k;
    this.vel.z += (move.z * SPEED - this.vel.z) * k;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    world.collide(this.pos, PLAYER_R);
    const gy = world.heightAt(this.pos.x, this.pos.z);
    this.pos.y += (gy - this.pos.y) * (1 - Math.exp(-dt * 20));

    const speed = Math.hypot(this.vel.x, this.vel.z);
    let want = this.facing;
    if (aim) want = Math.atan2(aim.x - this.pos.x, aim.z - this.pos.z);
    else if (speed > 0.4) want = Math.atan2(this.vel.x, this.vel.z);
    this.facing = lerpAngle(this.facing, want, 1 - Math.exp(-dt * 14));
    this.model.rotation.y = this.facing;

    const moving = Math.min(1, speed / SPEED);
    const prevPhase = this.phase;
    this.phase += dt * speed * 2.4;
    // 발이 땅에 닿는 순간(다리가 가장 멀리 벌어질 때, 위상 π/2 + kπ)이면 그 걸음의 빠르기(0~1), 아니면 0. 발소리에 쓴다.
    const stride = (p) => Math.floor((p - Math.PI / 2) / Math.PI);
    if (moving > 0.2 && stride(this.phase) !== stride(prevPhase)) this.footfall = moving;
    const sw = Math.sin(this.phase) * 0.7 * moving;
    this.legs[0].rotation.x = sw;
    this.legs[1].rotation.x = -sw;
    // 오른팔은 같은 쪽 다리(legs[0], -x)와 반대로 흔든다. 음수 회전이 앞쪽이다.
    const armSwing = -sw * 0.85 + Math.sin(t * 1.7) * 0.03 * (1 - moving);
    this.arm.rotation.x = armSwing;
    this.elbow.rotation.x = -0.18 - Math.max(0, -armSwing) * 0.6;
    this.body.position.y = Math.abs(Math.sin(this.phase)) * 0.05 * moving;
    this.body.rotation.z = Math.sin(this.phase) * 0.04 * moving;

    if (this.flashActive) this.battery = Math.max(0, this.battery - dt * 1.15);
    const on = this.flashActive ? 1 : 0;
    const flick = this.battery < 15 && on ? (Math.sin(t * 37) * Math.sin(t * 13) > 0.6 ? 0.25 : 1) : 1;
    this.flash.intensity = on * flick * (14 + 26 * night);
    for (const m of this.mats) m.emissiveIntensity = 0.22 * night;
    for (const m of this.partMats) m.emissiveIntensity = 0.22 * night;
    this.beamMat.uniforms.uOpacity.value = on * flick * night * (0.2 + rain * 0.18);
    return speed;
  }
}
