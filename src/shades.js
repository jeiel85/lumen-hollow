import * as THREE from 'three';
import { LOAD_PER_SHADE } from './world.js';
import { RAM_SPEED } from './vehicle.js';
import { DIFFICULTY } from './difficulty.js';
import { KINDS } from './nights.js';

// 그늘이(Shade): 밤에만 나타나는 그림자 형체. 빛에 닿으면 물러나고 오래 비추면 흩어진다.
const MAX = 18;
const FAR = 46; // 차로 멀리 달아나면 뒤에 남은 그늘이는 사라진다(새로 깨어날 자리를 비운다).
const EATER_SEEK = 24; // 빛먹이가 찾아가는 켜진 가로등 거리
const EATER_LOAD = 5; // 빛먹이 하나가 거는 과부하(보통 그늘이의 배수)
const JAM_R = 7; // 빛먹이가 손전등을 방해하는 거리

export function glowTexture() {
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
      this.list.push({
        g, mat, eyeMat, glowMat, arms, body, head, active: false, state: 'idle', x: 0, z: 0, vx: 0, vz: 0, fade: 0, burn: 0, cool: 0,
        seed: Math.random() * 100, tag: null, tough: 1, path: null, kind: 'shade', size: 1, seek: null, seekAt: 0,
      });
    }
    this.spawnTimer = 2;
    this.banished = 0;
  }

  // 저절로 깨어나는 그늘이 수(목표 그늘이는 빼고 센다)
  get activeCount() {
    return this.list.filter((s) => s.active && !s.tag).length;
  }

  // 이야기가 정한 그늘이(4장 마지막 밤). tag는 흩어질 때 returned에 실려 누구에게 돌아가는지 가린다.
  // path의 점들을 차례로 지나 플레이어에게 다가오고, tough만큼 오래 비춰야 흩어지며, 멀리 있어도 사라지지 않는다.
  // 생김새는 다른 그늘이와 같다(누구의 그림자인지는 돌아간 창으로만 알린다).
  spawnTarget(x, z, tag, { path = [], tough = 3 } = {}) {
    const s = this.list.find((e) => !e.active);
    if (!s) return false;
    Object.assign(s, { active: true, state: 'rise', x, z, vx: 0, vz: 0, fade: 0, burn: 0, cool: 0, tag, tough, path: path.map((p) => ({ ...p })) });
    this._kind(s, 'shade');
    s.g.visible = true;
    return true;
  }

  // 종류에 맞게 크기·눈빛을 바꾼다(그늘이 메시는 미리 만든 묶음을 돌려 쓴다).
  _kind(s, kind) {
    const k = KINDS[kind] ?? KINDS.shade;
    s.kind = kind;
    s.size = k.look.size;
    s.seek = null;
    s.seekAt = -Infinity;
    s.eyeMat.color.setRGB(...k.look.eye);
    s.glowMat.color.setRGB(...k.look.glow);
  }

  count(kind) {
    let n = 0;
    for (const s of this.list) if (s.active && s.kind === kind && s.state !== 'die') n++;
    return n;
  }

  hasTarget(tag) {
    return this.list.some((s) => s.active && s.tag === tag && s.state !== 'die');
  }

  clear() {
    for (const s of this.list) {
      s.active = false;
      s.g.visible = false;
      s.tag = null;
    }
  }

  // 플레이어에게서 world.spawnRange(기본 15~23m) 떨어진, 빛 밖의 갈 수 있는 땅에서 깨어난다.
  // around: 깨어날 방향(라디안, 그 쪽 ±0.7). 없으면 아무 방향. 건물 안에서는 깨어나지 않는다(#1).
  _spawn(px, pz, world, around = null) {
    const s = this.list.find((e) => !e.active);
    if (!s) return false;
    const [d0, d1] = world.spawnRange ?? [15, 23];
    const probe = { x: 0, z: 0 };
    for (let tries = 0; tries < 12; tries++) {
      const a = around === null ? Math.random() * Math.PI * 2 : around + (Math.random() - 0.5) * 1.4;
      const d = d0 + Math.random() * (d1 - d0);
      const x = px + Math.cos(a) * d;
      const z = pz + Math.sin(a) * d;
      if (!world.inBounds(x, z)) continue;
      if (world.lightAt(x, z)) continue;
      probe.x = x;
      probe.z = z;
      world.collide(probe, 0.3);
      if (Math.abs(probe.x - x) + Math.abs(probe.z - z) > 0.01) continue; // 벽·건물 안
      Object.assign(s, { active: true, state: 'rise', x, z, vx: 0, vz: 0, fade: 0, burn: 0, cool: 0, tag: null, tough: 1, path: null });
      this._kind(s, 'shade');
      s.g.visible = true;
      this._last = s;
      return true;
    }
    return false;
  }

  _become(s, kind, tough) {
    this._kind(s, kind);
    s.tough = tough * KINDS[kind].stat.tough;
  }

  // 떼 그늘이: 한 자리 둘레(0.7~1.6m)에 n마리. 벽·빛 안이면 그 자리는 건너뛴다.
  _pack(px, pz, world, n, around, tough) {
    if (!this._spawn(px, pz, world, around)) return 0;
    const lead = this._last;
    this._become(lead, 'swarm', tough);
    const probe = { x: 0, z: 0 };
    let made = 1;
    for (let i = 1; i < n * 3 && made < n; i++) {
      const s = this.list.find((e) => !e.active);
      if (!s) break;
      const a = Math.random() * Math.PI * 2;
      const r = 0.7 + Math.random() * 0.9;
      const x = lead.x + Math.cos(a) * r;
      const z = lead.z + Math.sin(a) * r;
      if (!world.inBounds(x, z) || world.lightAt(x, z)) continue;
      probe.x = x;
      probe.z = z;
      world.collide(probe, 0.3);
      if (Math.abs(probe.x - x) + Math.abs(probe.z - z) > 0.01) continue;
      Object.assign(s, { active: true, state: 'rise', x, z, vx: 0, vz: 0, fade: 0, burn: 0, cool: 0, tag: null, path: null });
      this._become(s, 'swarm', tough);
      s.g.visible = true;
      made++;
    }
    return made;
  }

  // 빛먹이가 찾아갈 켜진 가로등(가장 가까운 것). 1초마다, 노리던 가로등이 꺼지면 바로 다시 고른다.
  _seekLamp(s, world, t) {
    const live = s.seek && world.zones[s.seek.zone].level >= 0.5;
    if (t - s.seekAt < 1 && (live || !s.seek)) return live ? s.seek : null;
    s.seekAt = t;
    s.seek = null;
    if (!world.lamps || world.night < 0.3) return null;
    let best = EATER_SEEK * EATER_SEEK;
    for (const L of world.lamps) {
      if (world.zones[L.zone].level < 0.5) continue;
      const d2 = (L.x - s.x) ** 2 + (L.z - s.z) ** 2;
      if (d2 < best) {
        best = d2;
        s.seek = L;
      }
    }
    return s.seek;
  }

  // ctx: { player, world, night, nights, spawning, car, driving, cap, diff }. cap은 저절로 깨어나는 그늘이 수의 상한(빠지면 밤마다
  // 늘어난다), diff는 난이도 단계 값(src/difficulty.js, 빠지면 보통).
  update(dt, t, ctx) {
    const { player, world, night, nights, spawning, car, driving, cap, diff = DIFFICULTY.normal } = ctx;
    const px = player.pos.x;
    const pz = player.pos.z;
    // returned: 이번 프레임에 흩어져 주인에게 돌아가는 그림자 자리(빛줄기 연출·깨어남 단서용)
    // jam: 빛먹이가 손전등을 방해하는 세기(0~1), seen: 가까이(14m) 보이는 종류(처음 만남 안내용)
    const events = { hits: 0, banished: 0, rammed: 0, nearest: Infinity, burning: 0, pressing: 0, returned: [], jam: 0, seen: new Set() };
    const ramming = driving && Math.abs(car.speed) >= RAM_SPEED;

    // 장이 정한 상한도 단계 배율을 따른다(쉬움 3 → 2). 하나 아래로는 줄이지 않는다.
    const target = !spawning ? 0 : cap !== undefined ? Math.max(1, Math.round(cap * diff.count)) : Math.min(Math.round((5 + nights * 2) * diff.count), diff.cap, MAX);
    this.spawnTimer -= dt;
    if (spawning && this.spawnTimer <= 0 && this.activeCount < target) {
      // 깊은 밤(세 번째 밤부터)에는 손전등이 비추는 반대쪽에서 깨어나거나 두 방향에서 한꺼번에 몰려온다.
      // 한 방향만 잘 겨누면 밤이 깊어져도 압박이 없던 문제(#14·#21). 1장 판에만(장의 목표 그림자는 cap으로 따로 정한다).
      // 보통은 셋째 밤부터 오르기 시작해 다섯 번째 밤에서 멈춘다(완벽 조준 봇이 어둠에서 분당 0~3대). 단계가 시작하는 밤을 정한다.
      const deep = cap === undefined && diff.deep !== null ? Math.min(3, Math.max(0, nights - diff.deep + 1)) : 0;
      const behind = Math.atan2(-Math.cos(player.facing), -Math.sin(player.facing));
      const flank = deep > 0 && Math.random() < Math.min(0.4, 0.08 * deep);
      const tough = (1 + Math.min(0.3, 0.06 * deep)) * diff.tough; // 깊은 밤의 그늘이는 조금 더 오래 비춰야 흩어진다
      // 새 그늘이(#57, 1장 판만): 빛먹이는 가로등을 먼저 찾아가고, 떼 그늘이는 한 방향에서 여럿이 함께 온다.
      const roll = Math.random();
      const eater = cap === undefined && !!diff.eater && nights >= diff.eater.from && this.count('eater') < diff.eater.max && roll < 0.16;
      const pack = !eater && cap === undefined && !!diff.swarm && nights >= diff.swarm.from && roll < 0.3
        && this.activeCount + diff.swarm.size <= target + 1;
      if (eater) {
        if (this._spawn(px, pz, world)) this._become(this._last, 'eater', tough);
      } else if (pack) {
        this._pack(px, pz, world, diff.swarm.size, flank ? behind : null, tough);
      } else if (this._spawn(px, pz, world, flank ? behind : null)) {
        this._last.tough = cap === undefined ? tough : diff.tough;
      }
      if (deep > 0 && this.activeCount < target && Math.random() < Math.min(0.4, 0.08 * deep)) {
        if (this._spawn(px, pz, world, behind + (Math.random() < 0.5 ? -1 : 1) * Math.PI * 0.5)) this._last.tough = tough;
      }
      this.spawnTimer = ((1.2 + Math.random() * 1.8) / (1 + 0.12 * deep)) * diff.gap;
    }
    const base = Math.min(2.4 + nights * 0.2, 3.4) * diff.speed;

    for (const s of this.list) {
      if (!s.active) continue;
      if (!spawning && night < 0.6 && s.state !== 'die' && !s.tag) s.state = 'die';

      const dx = px - s.x;
      const dz = pz - s.z;
      const d = Math.hypot(dx, dz) || 0.001;
      s.cool = Math.max(0, s.cool - dt);

      if (s.state === 'rise') {
        s.fade = Math.min(1, s.fade + dt / 1.3);
        if (s.fade >= 1) s.state = 'stalk';
      } else if (s.state === 'stalk' && d > FAR && !s.tag) {
        s.state = 'die';
      } else if (s.state === 'stalk') {
        const stat = KINDS[s.kind].stat;
        const lunge = (d < 5 ? 4.6 * diff.speed : base) * stat.speed;
        const wob = Math.sin(t * 0.8 + s.seed) * 0.45;
        let ux = dx / d;
        let uz = dz / d;
        // 빛먹이는 사람이 바로 곁(5m)이 아니면 가까운 켜진 가로등으로 간다(빛에 밀려 가장자리에 붙는다).
        const lamp = s.kind === 'eater' && d > 5 ? this._seekLamp(s, world, t) : null;
        if (lamp) {
          const lx = lamp.x - s.x;
          const lz = lamp.z - s.z;
          const ld = Math.hypot(lx, lz) || 0.001;
          ux = lx / ld;
          uz = lz / ld;
        }
        if (s.kind === 'eater' && d < JAM_R && player.flashActive) events.jam = Math.max(events.jam, 1 - d / JAM_R);
        // 정해진 길이 있으면 그 점들을 먼저 지난다(골대를 돌아 들어오는 식).
        const way = s.path?.[0];
        if (way) {
          const wx = way.x - s.x;
          const wz = way.z - s.z;
          const wd = Math.hypot(wx, wz);
          if (wd < 1.3) s.path.shift();
          else {
            ux = wx / wd;
            uz = wz / wd;
          }
        }
        const rx = ux - uz * wob;
        const rz = uz + ux * wob;
        const rl = Math.hypot(rx, rz);
        ux = rx / rl;
        uz = rz / rl;
        const speed = s.cool > 0 ? -1.2 : lunge;
        const k = 1 - Math.exp(-dt * 3);
        s.vx += (ux * speed - s.vx) * k;
        s.vz += (uz * speed - s.vz) * k;

        // 건물 너머는 손전등·전조등이 닿지 않는다(#14)
        let pb = player.beamStrength(s.x, s.z);
        if (pb > 0 && world.blocksSight?.(px, pz, s.x, s.z)) pb = 0;
        let cb = car ? car.beamStrength(s.x, s.z) : 0;
        if (cb > 0 && world.blocksSight?.(car.pos.x, car.pos.z, s.x, s.z)) cb = 0;
        const beam = Math.max(pb, cb);
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
        // 벽·건물을 지나가지 않는다(2~4장 무대에서는 걸을 수 있는 곳 밖으로도 못 나간다, #14)
        world.collide(s, 0.3);

        // 켜진 빛(가로등·트럭 작업등) 안으로는 못 들어온다. 경계로 밀려나며 조금씩 타고, 버티는 동안 그 빛에 부하를 건다.
        // 빛이 겹친 곳(길 건너 가로등, 가로등 옆에 세운 트럭)에서는 한 빛 밖으로 밀어낸 자리가 다른 빛 안일 수 있어
        // 몇 번 되풀이한다. 끝내 못 빠져나오면 이번 이동을 취소하고, 빛에 둘러싸인 셈이라 빨리 탄다.
        let lit = world.lightAt(s.x, s.z);
        if (lit) {
          s.burn += dt * 0.25;
          world.addLoad(lit, dt * LOAD_PER_SHADE * diff.load * (s.kind === 'eater' ? EATER_LOAD : 1));
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
        if (s.burn >= s.tough || rammed) {
          s.state = 'die';
          events.banished++;
          this.banished++;
          events.returned.push({ x: s.x, z: s.z, tag: s.tag });
        } else if (touching && s.cool <= 0 && player.alive) {
          if (player.hurt(Math.round(diff.damage * stat.damage), s.x, s.z)) events.hits++;
          s.cool = 1.3;
          s.vx = -(dx / d) * 5;
          s.vz = -(dz / d) * 5;
        }
      } else if (s.state === 'die') {
        s.fade -= dt / 0.8;
        if (s.fade <= 0) {
          s.active = false;
          s.g.visible = false;
          s.tag = null;
          continue;
        }
      }

      if (s.state !== 'die') {
        events.nearest = Math.min(events.nearest, d);
        if (d < 14 && s.fade > 0.5 && !s.tag) events.seen.add(s.kind);
      }
      const hover = Math.sin(t * 2.1 + s.seed) * 0.07;
      s.g.position.set(s.x, world.heightAt(s.x, s.z) + 0.05 + hover, s.z);
      s.g.rotation.y = Math.atan2(dx, dz);
      const burnt = s.burn / s.tough;
      const jitter = burnt > 0.05 ? 1 - burnt * 0.5 * (0.5 + 0.5 * Math.sin(t * 40 + s.seed)) : 1;
      s.mat.opacity = 0.88 * s.fade * jitter;
      s.eyeMat.opacity = s.fade;
      s.glowMat.opacity = s.fade * (0.55 + 0.25 * Math.sin(t * 3 + s.seed)) * (1 - Math.min(1, burnt));
      const squash = s.state === 'die' ? 0.4 + 0.6 * s.fade : 1;
      s.g.scale.set((1 + (1 - squash) * 0.6) * s.size, squash * s.size, (1 + (1 - squash) * 0.6) * s.size);
      for (let i = 0; i < 2; i++) s.arms[i].rotation.x = Math.sin(t * 3 + s.seed + i * 1.6) * 0.25 - (d < 4 ? 0.9 : 0.2);
      const sh = s.fade > 0.6 && s.state !== 'die';
      s.body.castShadow = sh;
      s.head.castShadow = sh;
    }
    return events;
  }
}
