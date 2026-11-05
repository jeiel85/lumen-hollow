import * as THREE from 'three';
import { World } from './world.js';
import { Environment } from './env.js';
import { Post } from './post.js';
import { Player } from './player.js';
import { Shades } from './shades.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { Sound } from './audio.js';
import { load, save } from './storage.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const mobile = matchMedia('(pointer: coarse)').matches;

function showFatal(message, err) {
  console.error(err);
  $('error-text').textContent = message;
  $('error').classList.remove('hidden');
  $('title').classList.add('hidden');
}

addEventListener('error', (e) => showFatal(`게임 실행 중 오류가 발생했습니다: ${e.message}`, e.error));
addEventListener('unhandledrejection', (e) => showFatal(`게임 실행 중 오류가 발생했습니다: ${e.reason}`, e.reason));

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: $('game'), antialias: false, powerPreference: 'high-performance' });
} catch (err) {
  showFatal('이 브라우저(또는 그래픽 드라이버)에서 WebGL2를 사용할 수 없어 게임을 시작하지 못했습니다.', err);
  throw err;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.setClearColor(0x0b1416);

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 500);
const CAM_DIR = new THREE.Vector3(1, 1.2, 1).normalize();
const CAM_DIST = 150;
const SCREEN_RIGHT = new THREE.Vector3(1, 0, -1).normalize();
const SCREEN_DOWN = new THREE.Vector3(1, 0, 1).normalize();

const world = new World(scene, { mobile });
const env = new Environment(scene, { mobile });
const post = new Post(renderer, { samples: mobile ? 2 : 4 });
const player = new Player(scene, { mobile });
const shades = new Shades(scene);
const input = new Input(renderer.domElement);
const hud = new Hud();
const sound = new Sound();

const START = new THREE.Vector3(0, 0, 3.2);
player.reset(START.x, START.z);

const EMPTY_LINES = ['텅 빈 서랍뿐이다.', '먼지 쌓인 영수증 몇 장.', '누군가 먼저 다녀갔다.', '쓸 만한 건 없다.', '젖은 신문 더미뿐이다.', '고장 난 라디오. 소리는 안 난다.'];

const game = {
  state: 'title',
  nights: 0,
  hold: 0,
  holdKey: null,
  peaceful: false,
  won: false,
  shake: 0,
  time: 0,
  zoom: 12.5,
  zoomTarget: 12.5,
  hintFlash: false,
};

// 게임 시간 기준 지연 실행. 일시정지 중에는 멈추고, 새 판을 시작하면 비운다.
const timers = [];
function later(sec, fn) {
  timers.push({ at: game.time + sec, fn });
}
function runTimers() {
  const due = timers.filter((t) => t.at <= game.time);
  if (!due.length) return;
  for (const t of due) timers.splice(timers.indexOf(t), 1);
  for (const t of due) t.fn();
}

const camFocus = new THREE.Vector3(0, 0, 0);
const shakeOffset = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const aimPoint = new THREE.Vector3();
const ndc = new THREE.Vector2();
const tmp = new THREE.Vector3();
let viewHalf = 12.5;
let pxPerUnit = 30;

// ---------------------------------------------------------------- 화면 크기

function resize() {
  // 탭이 숨겨진 채로 열리면 크기가 0일 수 있다. 0 크기 렌더 타깃은 만들지 않는다.
  renderer.setSize(Math.max(1, innerWidth), Math.max(1, innerHeight));
  const c = renderer.domElement;
  post.setSize(Math.max(1, c.width), Math.max(1, c.height));
}
addEventListener('resize', resize);
resize();

function updateCamera(dt) {
  game.zoom += (game.zoomTarget - game.zoom) * (1 - Math.exp(-dt * 10));
  const aspect = innerWidth / innerHeight;
  viewHalf = aspect < 1 ? Math.max(game.zoom, 8.5 / aspect) : game.zoom;
  camera.left = -viewHalf * aspect;
  camera.right = viewHalf * aspect;
  camera.top = viewHalf;
  camera.bottom = -viewHalf;
  camera.updateProjectionMatrix();
  shakeOffset.set((Math.random() - 0.5) * game.shake, 0, (Math.random() - 0.5) * game.shake);
  camera.position.copy(camFocus).add(shakeOffset).addScaledVector(CAM_DIR, CAM_DIST);
  camera.lookAt(tmp.copy(camFocus).add(shakeOffset));
  camera.updateMatrixWorld();
  pxPerUnit = renderer.domElement.height / (2 * viewHalf);
}

// ---------------------------------------------------------------- 기록

function loadBest() {
  const fallback = { nights: 0, zones: 1, winDay: 0 };
  try {
    return { ...fallback, ...JSON.parse(load('lumen.best')) };
  } catch {
    return fallback; // 손상된 기록은 무시하고 새로 시작
  }
}

function saveBest() {
  const best = loadBest();
  best.nights = Math.max(best.nights, game.nights);
  best.zones = Math.max(best.zones, world.poweredZones);
  if (game.won) best.winDay = best.winDay ? Math.min(best.winDay, env.day) : env.day;
  save('lumen.best', JSON.stringify(best));
}

function renderBest() {
  const b = loadBest();
  const parts = [];
  if (b.winDay) parts.push(`${b.winDay}일 만에 마을 복구`);
  parts.push(`최장 ${b.nights}번의 밤`, `최대 ${b.zones}/${world.totalZones} 구역`);
  $('best').textContent = b.nights || b.zones > 1 || b.winDay ? `최고 기록 · ${parts.join(' · ')}` : '';
}

// ---------------------------------------------------------------- 게임 흐름

function setScreen(id) {
  for (const s of ['title', 'pause', 'end']) $(s).classList.toggle('hidden', s !== id);
}

function startGame() {
  sound.init();
  world.reset((Math.random() * 1e9) | 0);
  player.reset(START.x, START.z);
  shades.clear();
  shades.banished = 0;
  const h = Number(params.get('hour'));
  env.setHour(Number.isFinite(h) && params.has('hour') ? h : 7.5);
  env.day = 1;
  env.rainyNight = true;
  env.rainLevel = 0;
  timers.length = 0;
  Object.assign(game, { state: 'play', nights: 0, hold: 0, holdKey: null, peaceful: false, won: false, shake: 0, hintFlash: false });
  camFocus.copy(player.pos);
  setScreen(null);
  hud.clearToasts();
  hud.show(true);
  hud.showTouch(mobile || input.usingTouch);
  $('key-hints').classList.toggle('hidden', mobile);
  hud.toast('정전된 마을. 불이 남은 곳은 은신처뿐이다.');
  later(1.8, () => hud.toast('퓨즈를 모아 꺼진 배전함에 끼우면 그 구역에 다시 불이 들어온다.'));
  later(3.8, () => hud.toast('화살표가 가장 가까운 배전함을 가리킨다. 퓨즈 하나는 이미 갖고 있다.'));
}

function pauseGame(on) {
  if (on && game.state === 'play') {
    game.state = 'pause';
    setScreen('pause');
  } else if (!on && game.state === 'pause') {
    game.state = 'play';
    setScreen(null);
  }
}

function endGame(won) {
  game.won = won;
  game.state = 'end';
  saveBest();
  hud.prompt(null);
  const zones = `${world.poweredZones}/${world.totalZones}`;
  if (won) {
    sound.play('win');
    $('end-title').textContent = '마을에 다시 불이 켜졌다';
    $('end-text').textContent = `${env.day}일째에 모든 구역을 밝혔다. 버틴 밤 ${game.nights}번 · 쫓아낸 그늘이 ${shades.banished}.`;
    $('continue-btn').classList.remove('hidden');
  } else {
    $('end-title').textContent = '어둠에 삼켜졌다';
    $('end-text').textContent = `버틴 밤 ${game.nights}번 · 밝힌 구역 ${zones} · 쫓아낸 그늘이 ${shades.banished}.`;
    $('continue-btn').classList.add('hidden');
  }
  setScreen('end');
}

function continueWalk() {
  game.state = 'play';
  game.peaceful = true;
  env.setHour(Math.max(env.hour, 19.4) % 24);
  setScreen(null);
  hud.toast('오늘 밤은 조용하다. 불 켜진 마을을 천천히 걸어 보자.', 'good');
}

function backToTitle() {
  game.state = 'title';
  hud.show(false);
  hud.showTouch(false);
  hud.prompt(null);
  shades.clear();
  renderBest();
  setScreen('title');
}

function toggleFlash() {
  if (player.battery <= 0) {
    hud.toast('배터리가 없다. 켜진 가로등 아래에서 충전된다.', 'warn');
    return;
  }
  player.flashOn = !player.flashOn;
  sound.play('click');
}

function useBandage() {
  if (player.bandages <= 0) {
    hud.toast('붕대가 없다.', 'warn');
    return;
  }
  if (player.hp >= 100) {
    hud.toast('지금은 다친 곳이 없다.');
    return;
  }
  player.bandages--;
  player.hp = Math.min(100, player.hp + 35);
  sound.play('heal');
  hud.toast('붕대를 감았다. 체력 +35');
}

function completeLoot(loot) {
  world.markSearched(loot);
  switch (loot.item) {
    case 'fuse':
      player.fuses++;
      sound.play('pickup');
      hud.toast('퓨즈를 찾았다!', 'good');
      break;
    case 'battery':
      player.battery = Math.min(100, player.battery + 45);
      sound.play('pickup');
      hud.toast('배터리를 찾았다. 손전등 +45%', 'good');
      break;
    case 'bandage':
      if (player.bandages < 5) {
        player.bandages++;
        hud.toast(`붕대를 찾았다. (${mobile ? '붕대 버튼' : 'Q'}로 사용)`, 'good');
      } else {
        player.hp = Math.min(100, player.hp + 35);
        hud.toast('붕대가 가득 차서 바로 감았다. 체력 +35', 'good');
      }
      sound.play('pickup');
      break;
    default:
      sound.play('empty');
      hud.toast(EMPTY_LINES[Math.floor(Math.random() * EMPTY_LINES.length)]);
  }
}

function restoreZone(box) {
  const zone = world.zones[box.zone];
  player.fuses--;
  world.powerZone(box.zone);
  sound.play('power');
  hud.toast(`${zone.name}에 다시 전기가 들어왔다! (${world.poweredZones}/${world.totalZones})`, 'good');
  if (env.night < 0.3) later(1.5, () => hud.toast('밤이 되면 이 구역의 가로등이 그늘이를 막아 준다.'));
  if (world.poweredZones === world.totalZones) later(2.2, () => endGame(true));
}

function interact(dt) {
  const target = world.nearestInteractable(player.pos.x, player.pos.z, 1.8);
  const key = target ? target.ref : null;
  if (key !== game.holdKey) {
    game.hold = 0;
    game.holdKey = key;
  }
  if (!target) {
    hud.prompt(null);
    return;
  }
  const how = input.usingTouch || mobile ? '버튼을 길게 눌러' : 'E를 길게 눌러';
  if (target.kind === 'loot') {
    const dur = 1.0;
    game.hold = input.interactHeld ? game.hold + dt : 0;
    hud.prompt(`${how} 뒤지기`, Math.min(1, game.hold / dur));
    if (game.hold >= dur) {
      game.hold = 0;
      completeLoot(target.ref);
    }
    return;
  }
  const name = world.zones[target.ref.zone].name;
  if (player.fuses <= 0) {
    game.hold = 0;
    hud.prompt(`${name} 배전함 — 퓨즈가 필요하다`, 0);
    return;
  }
  const dur = 1.6;
  game.hold = input.interactHeld ? game.hold + dt : 0;
  hud.prompt(`${how} 퓨즈 끼우기 · ${name}`, Math.min(1, game.hold / dur));
  if (game.hold >= dur) {
    game.hold = 0;
    restoreZone(target.ref);
  }
}

function onTimeEvent(ev) {
  if (ev === 'dusk') {
    env.rainyNight = game.nights === 0 || Math.random() < 0.55;
    sound.play('dusk');
    hud.toast('해가 진다… 가로등 불빛 가까이 머물자.', 'warn');
    if (!game.hintFlash) {
      game.hintFlash = true;
      later(1.6, () => hud.toast(`${mobile ? '손전등 버튼' : 'F 키나 마우스 클릭'}으로 손전등을 켜자. 오래 비추면 그늘이가 흩어진다.`));
    }
  } else if (ev === 'night') {
    if (!game.peaceful) hud.toast('그늘이들이 깨어났다.', 'warn');
  } else if (ev === 'dawn') {
    game.nights++;
    env.day++;
    sound.play('dawn');
    if (!game.peaceful) hud.toast(`${game.nights}번째 밤을 버텼다. 날이 밝는다.`, 'good');
    if (player.flashOn) player.flashOn = false;
  }
}

function step(dt) {
  runTimers();
  if (input.consume('KeyF') || input.consume('MouseLeft') || input.consume('Touch_flash')) toggleFlash();
  if (input.consume('KeyQ') || input.consume('Touch_band')) useBandage();

  for (const ev of env.advance(dt)) onTimeEvent(ev);

  const ms = input.moveScreen();
  const move = tmp.set(0, 0, 0).addScaledVector(SCREEN_RIGHT, ms.x).addScaledVector(SCREEN_DOWN, ms.y);
  let aim = null;
  if (input.aiming) {
    ndc.set(input.mouse.x, input.mouse.y);
    raycaster.setFromCamera(ndc, camera);
    aimPlane.constant = -(player.pos.y + 0.9);
    if (raycaster.ray.intersectPlane(aimPlane, aimPoint)) aim = aimPoint;
  }
  player.update(dt, game.time, { x: move.x, z: move.z }, aim, world, env.night, env.rainLevel);

  const lit = world.lightAt(player.pos.x, player.pos.z);
  if (lit) player.battery = Math.min(100, player.battery + dt * 3.5);
  if (env.night < 0.3) player.hp = Math.min(100, player.hp + dt * 0.8);
  else if (lit) player.hp = Math.min(100, player.hp + dt * 1.2);
  if (player.flashOn && player.battery <= 0) {
    player.flashOn = false;
    hud.toast('손전등 배터리가 다 됐다!', 'warn');
  }

  const spawning = !game.peaceful && env.night > 0.75;
  const ev = shades.update(dt, game.time, { player, world, night: env.night, nights: game.nights, spawning });
  if (ev.hits) {
    sound.play('hurt');
    game.shake = 0.45;
  }
  if (ev.banished) sound.play('banish');
  game.dread = ev.nearest < 12 ? 1 - ev.nearest / 12 : 0;

  interact(dt);

  if (!player.alive) endGame(false);
}

// ---------------------------------------------------------------- 루프

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  // rAF 타임스탬프가 직전 performance.now()보다 앞설 수 있어 음수 dt를 막는다.
  const raw = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;

  const w = input.takeWheel();
  if (w && game.state === 'play') game.zoomTarget = Math.min(22, Math.max(8, game.zoomTarget + w * 1.2));
  if (input.consume('Escape') || input.consume('KeyP')) {
    if (game.state === 'play') pauseGame(true);
    else if (game.state === 'pause') pauseGame(false);
  }
  if (input.consume('KeyM')) {
    sound.init();
    const muted = sound.toggleMute();
    $('mute-btn').textContent = muted ? '소리 꺼짐' : '소리 켜짐';
    if (game.state === 'play') hud.toast(muted ? '소리를 껐다.' : '소리를 켰다.');
  }

  let dt = 0;
  if (game.state === 'play') {
    dt = raw;
    game.time += dt;
    step(dt);
    camFocus.lerp(player.pos, 1 - Math.exp(-dt * 6));
  } else if (game.state === 'title') {
    dt = raw;
    game.time += dt;
    env.setHour(env.hour + dt * 0.9);
    const t = game.time;
    camFocus.set(Math.sin(t * 0.05) * 22, 0, Math.cos(t * 0.037) * 18 - 4);
  }
  game.shake = Math.max(0, game.shake - raw * 1.6);

  updateCamera(raw);
  env.update(dt, camFocus, pxPerUnit);
  world.update(dt, game.time, env.night, camFocus, pxPerUnit);
  world.setWetness(env.rainLevel);
  if (game.state !== 'title') {
    sound.setMix({ rain: env.rainLevel, night: env.night, dread: game.state === 'play' ? game.dread ?? 0 : 0 });
  }

  const lowHp = player.hp < 30 && game.state === 'play' ? 0.25 + 0.15 * Math.sin(game.time * 5) : 0;
  post.render(scene, camera, env.look, game.time, {
    focus: 0.5, band: 0.07, blurScale: game.state === 'title' ? 1.25 : 1.0,
    hurt: Math.max(player.hurtFx * 0.9, lowHp),
  });

  if (game.state !== 'title') {
    hud.update({
      day: env.day, hour: env.hour, zonesOn: world.poweredZones, zonesTotal: world.totalZones,
      hp: player.hp, battery: player.battery, fuses: player.fuses, bandages: player.bandages, flashOn: player.flashActive,
    });
    const dead = game.state === 'play' ? world.nearestDeadBox(player.pos.x, player.pos.z) : null;
    if (dead) {
      tmp.set(dead.box.x, 1.5, dead.box.z).project(camera);
      const off = Math.abs(tmp.x) > 0.9 || Math.abs(tmp.y) > 0.9;
      hud.pointer((tmp.x * 0.5 + 0.5) * innerWidth, (-tmp.y * 0.5 + 0.5) * innerHeight, dead.dist, off);
    } else {
      hud.pointer(0, 0, 0, false);
    }
  }
  input.endFrame();
}

// ---------------------------------------------------------------- UI 연결

$('start-btn').addEventListener('click', startGame);
$('resume-btn').addEventListener('click', () => pauseGame(false));
$('quit-btn').addEventListener('click', backToTitle);
$('restart-btn').addEventListener('click', startGame);
$('continue-btn').addEventListener('click', continueWalk);
$('title-btn').addEventListener('click', backToTitle);
$('pause-btn').addEventListener('click', () => pauseGame(true));
$('mute-btn').addEventListener('click', () => {
  sound.init();
  const muted = sound.toggleMute();
  $('mute-btn').textContent = muted ? '소리 꺼짐' : '소리 켜짐';
});
$('mute-btn').textContent = sound.muted ? '소리 꺼짐' : '소리 켜짐';
addEventListener('blur', () => pauseGame(true));
document.addEventListener('visibilitychange', () => document.hidden && pauseGame(true));

// ?debug: 콘솔에서 상태를 들여다보고 시뮬레이션을 고정 간격으로 돌려 보는 개발용 핸들
if (params.has('debug')) {
  window.lumen = {
    THREE, scene, camera, renderer, world, env, post, player, shades, game, input, startGame,
    step(sec) {
      let t = last;
      for (let i = 0, n = Math.round(sec / 0.05); i < n; i++) frame((t += 50));
      last = performance.now();
    },
  };
}

renderBest();
env.setHour(Number(params.get('hour')) || 16.5);
if (params.get('start') === '1') startGame();
document.body.classList.add('ready');
requestAnimationFrame(frame);
