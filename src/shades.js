import * as THREE from 'three';
import { BOUND, LOAD_PER_SHADE } from './world.js';
import { RAM_SPEED } from './vehicle.js';

// 그늘이(Shade): 밤에만 나타나는 그림자 형체. 빛에 닿으면 물러나고 오래 비추면 흩어진다.
const MAX = 18;
const FAR = 46; // 차로 멀리 달아나면 뒤에 남은 그늘이는 사라진다(새로 깨어날 자리를 비운다).

function glowTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Shades {
  constructor(scene) {
    this.list = [];
    const bodyGeo = new THREE.CylinderGeometry(0.16, 0.42, 1.5, 7, 2);
    const pos = bodyGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < -0.7) pos.setXYZ(i, pos.getX(i) * (1 + Math.sin(i * 1.7) * 0.25), y, pos.getZ(i) * (1 + Math.cos(i * 2.3) * 0.25));
    }
    bodyGeo.computeVertexNormals();
    const headGeo = new THREE.SphereGeometry(0.3, 8, 6);
    const armGeo = new THREE.BoxGeometry(0.09, 0.95, 0.09);
    const eyeGeo = new THREE.SphereGeometry(0.075, 6, 4);
    const glowTex = glowTexture();
    for (let i = 0; i < MAX; i++) {
      const g = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: 0x06080a, transparent: true, opacity: 0, depthWrite: false });
      const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5.0, 6.5, 7.0), transparent: true, opacity: 0 });
      const body = new THREE.Mesh(bodyGeo, mat);
      body.position.y = 0.85;
      const head = new THREE.Mesh(headGeo, mat);
      head.position.set(0, 1.72, 0.04);
      head.scale.set(1, 1.15, 1);
      const arms = [];
      for (const s of [-1, 1]) {
        const arm = new THREE.Mesh(armGeo, mat);
        arm.position.set(s * 0.36, 1.05, 0.05);
        arm.rotation.z = s * 0.18;
        arms.push(arm);
        g.add(arm);
      }
      for (const s of [-1, 1]) {
        const eye = new THREE.Mesh(eyeGeo, eyeMat);
        eye.position.set(s * 0.11, 1.76, 0.29);
        g.add(eye);
      }
      // 어둠 속에서도 위치를 알 수 있게 눈 주위에 옅은 빛
      const glowMat = new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(0.55, 0.85, 1.0), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 });
      const glow = new THREE.Sprite(glowMat);
      glow.position.set(0, 1.76, 0.3);
      glow.scale.set(0.9, 0.9, 1);
      g.add(glow);
      body.castShadow = head.castShadow = true;
      g.add(body, head);
      g.visible = false;
      scene.add(g);
      this.list.push({ g, mat, eyeMat, glowMat, arms, body, head, active: false, state: 'idle', x: 0, z: 0, vx: 0, vz: 0, fade: 0, burn: 0, cool: 0, seed: Math.random() * 100 });
    }
    this.spawnTimer = 2;
    this.banished = 0;
  }

  get activeCount() {
    return this.list.filter((s) => s.active).length;
  }

  clear() {
    for (const s of this.list) {
      s.active = false;
      s.g.visible = false;
    }
  }

  _spawn(px, pz, world) {
    const s = this.list.find((e) => !e.active);
    if (!s) return;
    for (let tries = 0; tries < 10; tries++) {
      const a = Math.random() * Math.PI * 2;
      const d = 15 + Math.random() * 8;
      const x = px + Math.cos(a) * d;
      const z = pz + Math.sin(a) * d;
      if (Math.abs(x) > BOUND || Math.abs(z) > BOUND) continue;
      if (world.lightAt(x, z)) continue;
      Object.assign(s, { active: true, state: 'rise', x, z, vx: 0, vz: 0, fade: 0, burn: 0, cool: 0 });
      s.g.visible = true;
      return;
    }
  }

  // ctx: { player, world, night, nights, spawning, car, driving }
  update(dt, t, ctx) {
    const { player, world, night, nights, spawning, car, driving } = ctx;
    const px = player.pos.x;
    const pz = player.pos.z;
    const events = { hits: 0, banished: 0, rammed: 0, nearest: Infinity, burning: 0, pressing: 0 };
    const ramming = driving && Math.abs(car.speed) >= RAM_SPEED;

    const target = spawning ? Math.min(5 + nights * 2, 14) : 0;
    this.spawnTimer -= dt;
    if (spawning && this.spawnTimer <= 0 && this.activeCount < target) {
      this._spawn(px, pz, world);
      this.spawnTimer = 1.2 + Math.random() * 1.8;
    }
    const base = Math.min(2.4 + nights * 0.2, 3.4);

    for (const s of this.list) {
      if (!s.active) continue;
      if (!spawning && night < 0.6 && s.state !== 'die') s.state = 'die';

      const dx = px - s.x;
      const dz = pz - s.z;
      const d = Math.hypot(dx, dz) || 0.001;
      s.cool = Math.max(0, s.cool - dt);

      if (s.state === 'rise') {
        s.fade = Math.min(1, s.fade + dt / 1.3);
        if (s.fade >= 1) s.state = 'stalk';
      } else if (s.state === 'stalk' && d > FAR) {
        s.state = 'die';
      } else if (s.state === 'stalk') {
        const lunge = d < 5 ? 4.6 : base;
        const wob = Math.sin(t * 0.8 + s.seed) * 0.45;
        let ux = dx / d;
        let uz = dz / d;
        const rx = ux - uz * wob;
        const rz = uz + ux * wob;
        const rl = Math.hypot(rx, rz);
        ux = rx / rl;
        uz = rz / rl;
        const speed = s.cool > 0 ? -1.2 : lunge;
        const k = 1 - Math.exp(-dt * 3);
        s.vx += (ux * speed - s.vx) * k;
        s.vz += (uz * speed - s.vz) * k;

        const beam = Math.max(player.beamStrength(s.x, s.z), car ? car.beamStrength(s.x, s.z) : 0);
        if (beam > 0) {
          s.burn += dt * (0.55 + beam * 0.75);
          s.vx -= (dx / d) * 9 * dt * beam;
          s.vz -= (dz / d) * 9 * dt * beam;
          events.burning++;
        } else {
          s.burn = Math.max(0, s.burn - dt * 0.35);
        }
        const x0 = s.x;
        const z0 = s.z;
        s.x += s.vx * dt;
        s.z += s.vz * dt;
        if (car) car.pushOut(s, 0.3);

        // 켜진 빛(가로등·트럭 작업등) 안으로는 못 들어온다. 경계로 밀려나며 조금씩 타고, 버티는 동안 그 빛에 부하를 건다.
        // 빛이 겹친 곳(길 건너 가로등, 가로등 옆에 세운 트럭)에서는 한 빛 밖으로 밀어낸 자리가 다른 빛 안일 수 있어
        // 몇 번 되풀이한다. 끝내 못 빠져나오면 이번 이동을 취소하고, 빛에 둘러싸인 셈이라 빨리 탄다.
        let lit = world.lightAt(s.x, s.z);
        if (lit) {
          s.burn += dt * 0.25;
          world.addLoad(lit, dt * LOAD_PER_SHADE);
          events.pressing++;
          for (let k = 0; lit && k < 4; k++) {
            const n = lit.d || 0.001;
            s.x = lit.L.x + (lit.dx / n) * (lit.r + 0.01);
            s.z = lit.L.z + (lit.dz / n) * (lit.r + 0.01);
            lit = world.lightAt(s.x, s.z);
          }
          if (lit) {
            s.x = x0;
            s.z = z0;
            s.vx = 0;
            s.vz = 0;
            s.burn += dt * 1.5;
          }
        }
        // 빠르게 달리는 차에 부딪히면 그 자리에서 흩어진다.
        const rammed = ramming && car.contains(s.x, s.z, 0.45);
        if (rammed) events.rammed++;
        const touching = driving ? car.distanceTo(s.x, s.z) < 0.45 : d < 0.85;
        if (s.burn >= 1 || rammed) {
          s.state = 'die';
          events.banished++;
          this.banished++;
        } else if (touching && s.cool <= 0 && player.alive) {
          if (player.hurt(15, s.x, s.z)) events.hits++;
          s.cool = 1.3;
          s.vx = -(dx / d) * 5;
          s.vz = -(dz / d) * 5;
        }
      } else if (s.state === 'die') {
        s.fade -= dt / 0.8;
        if (s.fade <= 0) {
          s.active = false;
          s.g.visible = false;
          continue;
        }
      }

      if (s.state !== 'die') events.nearest = Math.min(events.nearest, d);
      const hover = Math.sin(t * 2.1 + s.seed) * 0.07;
      s.g.position.set(s.x, world.heightAt(s.x, s.z) + 0.05 + hover, s.z);
      s.g.rotation.y = Math.atan2(dx, dz);
      const jitter = s.burn > 0.05 ? 1 - s.burn * 0.5 * (0.5 + 0.5 * Math.sin(t * 40 + s.seed)) : 1;
      s.mat.opacity = 0.88 * s.fade * jitter;
      s.eyeMat.opacity = s.fade;
      s.glowMat.opacity = s.fade * (0.55 + 0.25 * Math.sin(t * 3 + s.seed)) * (1 - Math.min(1, s.burn));
      const squash = s.state === 'die' ? 0.4 + 0.6 * s.fade : 1;
      s.g.scale.set(1 + (1 - squash) * 0.6, squash, 1 + (1 - squash) * 0.6);
      for (let i = 0; i < 2; i++) s.arms[i].rotation.x = Math.sin(t * 3 + s.seed + i * 1.6) * 0.25 - (d < 4 ? 0.9 : 0.2);
      const sh = s.fade > 0.6 && s.state !== 'die';
      s.body.castShadow = sh;
      s.head.castShadow = sh;
    }
    return events;
  }
}
