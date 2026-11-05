import * as THREE from 'three';

export const SPEED = 5.2;
export const FLASH_RANGE = 13;
const FLASH_ANGLE = 0.42;
const BEAM_LEN = 10;
const BEAM_HALF = 0.33;

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
    const pack = mat(0x7b5a3e);
    const dark = mat(0x26292c);
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
    const hood = add(new THREE.SphereGeometry(0.26, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), coat, 0, 1.55, -0.05, this.body);
    hood.rotation.x = -0.35;
    add(new THREE.BoxGeometry(0.4, 0.44, 0.2), pack, 0, 1.02, -0.3, this.body);
    add(new THREE.BoxGeometry(0.1, 0.36, 0.12), coat, 0.3, 1.0, 0.12, this.body, false).rotation.x = -0.9;
    add(new THREE.CylinderGeometry(0.05, 0.06, 0.26, 8), dark, 0.3, 0.92, 0.36, this.body, false).rotation.x = Math.PI / 2;

    // 건물에 가려졌을 때 보이는 실루엣. 깊이 비교를 반전한 가산 재질을 불투명 패스에서
    // 몸체보다 먼저(renderOrder 1 < 2) 그려서, 자기 몸에 가린 부분은 실루엣이 생기지 않게 한다.
    const xray = new THREE.MeshBasicMaterial({ color: 0x6a5634, blending: THREE.AdditiveBlending, depthFunc: THREE.GreaterDepth, depthWrite: false });
    for (const m of meshes) {
      m.renderOrder = 2;
      const ghost = new THREE.Mesh(m.geometry, xray);
      ghost.renderOrder = 1;
      m.add(ghost);
    }

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

    const beamGeo = new THREE.ConeGeometry(Math.tan(BEAM_HALF) * BEAM_LEN, BEAM_LEN, 28, 1, true)
      .translate(0, -BEAM_LEN / 2, 0)
      .rotateX(-Math.PI / 2);
    this.beamMat = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 }, uColor: { value: new THREE.Color(1.0, 0.92, 0.75) }, uLen: { value: BEAM_LEN } },
      vertexShader: `uniform float uLen; varying float vT; varying vec3 vN;
        void main(){ vT = position.z / uLen; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uOpacity; uniform vec3 uColor; varying float vT; varying vec3 vN;
        void main(){ float edge = pow(clamp(abs(vN.z), 0.0, 1.0), 1.6); float a = pow(clamp(1.0 - vT, 0.0, 1.0), 2.0) * smoothstep(0.0, 0.06, vT) * edge * uOpacity; gl_FragColor = vec4(uColor, a); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.beam = new THREE.Mesh(beamGeo, this.beamMat);
    this.beam.position.set(0.3, 0.95, 0.5);
    this.beam.rotation.x = 0.07;
    this.beam.renderOrder = 7;
    this.model.add(this.beam);

    // 발밑 표시 고리
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.52, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xfff1c9, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    ring.position.y = 0.03;
    this.root.add(ring);

    this.pos = this.root.position;
    this.vel = new THREE.Vector3();
    this.facing = 0;
    this.phase = 0;
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
    this.flashOn = false;
    this.invuln = 0;
    this.hurtFx = 0;
    this.alive = true;
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

    const k = 1 - Math.exp(-dt * 12);
    this.vel.x += (move.x * SPEED - this.vel.x) * k;
    this.vel.z += (move.z * SPEED - this.vel.z) * k;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    world.collide(this.pos, 0.36);
    const gy = world.heightAt(this.pos.x, this.pos.z);
    this.pos.y += (gy - this.pos.y) * (1 - Math.exp(-dt * 20));

    const speed = Math.hypot(this.vel.x, this.vel.z);
    let want = this.facing;
    if (aim) want = Math.atan2(aim.x - this.pos.x, aim.z - this.pos.z);
    else if (speed > 0.4) want = Math.atan2(this.vel.x, this.vel.z);
    this.facing = lerpAngle(this.facing, want, 1 - Math.exp(-dt * 14));
    this.model.rotation.y = this.facing;

    const moving = Math.min(1, speed / SPEED);
    this.phase += dt * speed * 2.4;
    const sw = Math.sin(this.phase) * 0.7 * moving;
    this.legs[0].rotation.x = sw;
    this.legs[1].rotation.x = -sw;
    this.body.position.y = Math.abs(Math.sin(this.phase)) * 0.05 * moving;
    this.body.rotation.z = Math.sin(this.phase) * 0.04 * moving;

    if (this.flashActive) this.battery = Math.max(0, this.battery - dt * 1.15);
    const on = this.flashActive ? 1 : 0;
    const flick = this.battery < 15 && on ? (Math.sin(t * 37) * Math.sin(t * 13) > 0.6 ? 0.25 : 1) : 1;
    this.flash.intensity = on * flick * (14 + 26 * night);
    for (const m of this.mats) m.emissiveIntensity = 0.22 * night;
    this.beamMat.uniforms.uOpacity.value = on * flick * night * (0.2 + rain * 0.18);
    return speed;
  }
}
