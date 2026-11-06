import * as THREE from 'three';
import { World, CAR_SPAWN } from './world.js';
import { Environment } from './env.js';
import { Post } from './post.js';
import { Player, PLAYER_R } from './player.js';
import { Shades } from './shades.js';
import { Vehicle, MAX_FWD } from './vehicle.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { Sound } from './audio.js';
import { load, save } from './storage.js';
import { Caches } from './caches.js';
import { Online, NOTES, KIND_NAMES, RUN_TAKE_LIMIT, BATTERY_PACK, BATTERY_PACK_MIN, MAX_MINE, PLACE_RADIUS, CACHE_REACH } from './online.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const mobile = matchMedia('(pointer: coarse)').matches;

// index.html의 로드 감시 타이머가 "아직 불러오는 중" 안내를 띄운 뒤에 모듈이 도착했다면, 안내를 걷고 타이틀로 돌아간다.
if (document.body.dataset.slowLoad) {
  delete document.body.dataset.slowLoad;
  $('error').classList.add('hidden');
  $('title').classList.remove('hidden');
}

function showFatal(message, err) {
  console.error(err);
  // 배포 직후 캐시된 옛 index.html과 섞일 수 있어, 새로 추가된 요소는 없을 수도 있다고 보고 다룬다.
  const errTitle = $('error-title');
  if (errTitle) errTitle.textContent = '실행할 수 없어요';
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
const car = new Vehicle(scene);
const input = new Input(renderer.domElement);
const hud = new Hud();
const sound = new Sound();
const online = new Online(params);
const caches = new Caches(scene, world);

const START = new THREE.Vector3(0, 0, 3.2);
player.reset(START.x, START.z);
car.reset(CAR_SPAWN.x, CAR_SPAWN.z, CAR_SPAWN.a);

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
  zoomBoost: 0,
  hintFlash: false,
  driving: false,
  holdLock: false,
  hintCar: false,
  flashNoteAt: -99,
  // 공유 보급품: run은 판마다 늘어, 이전 판에 보낸 요청의 응답을 버리는 데 쓴다.
  run: 0,
  startedAt: 0,
  onlineLive: false,
  onlinePaused: false,
  cacheTaken: 0,
  cacheBusy: false,
  placing: null,
  placeNote: 1,
  hintThanks: false,
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
const camGoal = new THREE.Vector3();
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
  game.zoom += (Math.min(24, game.zoomTarget + game.zoomBoost) - game.zoom) * (1 - Math.exp(-dt * 10));
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
  if (game.contextLost || !game.ready) return;
  sound.init();
  world.reset((Math.random() * 1e9) | 0);
  player.reset(START.x, START.z);
  car.reset(CAR_SPAWN.x, CAR_SPAWN.z, CAR_SPAWN.a);
  shades.clear();
  shades.banished = 0;
  const h = Number(params.get('hour'));
  env.setHour(Number.isFinite(h) && params.has('hour') ? h : 7.5);
  env.day = 1;
  env.rainyNight = true;
  env.rainLevel = 0;
  timers.length = 0;
  Object.assign(game, {
    state: 'play', nights: 0, hold: 0, holdKey: null, peaceful: false, won: false, shake: 0, hintFlash: false,
    driving: false, holdLock: false, zoomBoost: 0, flashNoteAt: -99,
    run: game.run + 1, startedAt: game.time, onlineLive: false, onlinePaused: false, cacheTaken: 0, cacheBusy: false,
  });
  closePlace();
  caches.clear();
  hud.setOnline(false);
  if (online.enabled && hud.hasOnlineUi) bg(loadCaches(game.run));
  hud.setDriving(false);
  camFocus.copy(player.pos);
  setScreen(null);
  hud.clearToasts();
  hud.show(true);
  hud.showTouch(mobile || input.usingTouch);
  $('key-hints').classList.toggle('hidden', mobile);
  hud.toast('정전된 마을. 불이 남은 곳은 은신처뿐이다.');
  later(1.8, () => hud.toast('퓨즈를 모아 꺼진 배전함에 끼우면 그 구역에 다시 불이 들어온다.'));
  later(3.8, () => hud.toast('화살표가 가장 가까운 배전함을 가리킨다. 퓨즈 하나는 이미 갖고 있다.'));
  later(6.4, () => !game.driving && hud.toast('은신처 앞 도로에 낡은 트럭이 서 있다. 연료가 남은 동안은 몰 수 있다.'));
}

function pauseGame(on) {
  if (on && game.state === 'play') {
    if (game.placing && !game.placing.busy) closePlace();
    game.state = 'pause';
    setScreen('pause');
  } else if (!on && game.state === 'pause' && !game.contextLost) {
    game.state = 'play';
    setScreen(null);
  }
}

function endGame(won) {
  game.won = won;
  game.state = 'end';
  saveBest();
  hud.prompt(null);
  if (game.placing && !game.placing.busy) closePlace();
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
  if (game.driving) leaveCar();
  game.state = 'title';
  game.run++; // 아직 오지 않은 보급품 응답은 버린다
  game.onlineLive = false;
  game.cacheBusy = false;
  closePlace();
  caches.clear();
  hud.setOnline(false);
  hud.show(false);
  hud.showTouch(false);
  hud.prompt(null);
  shades.clear();
  renderBest();
  renderOnline();
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
    case 'fuel':
      player.cans++;
      sound.play('pickup');
      hud.toast('연료통을 찾았다. 트럭에 타면 부어 넣는다.', 'good');
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

// ---------------------------------------------------------------- 공유 보급품
// 설계: docs/online-caches.md. 서버를 못 쓰면 판은 보급품 없이 그대로 진행된다.

const OBJ = { bandage: '붕대를', fuel: '연료통을', battery: '배터리 팩을' };
const CHARGES = 8; // 서버 rules.js의 charges(안내 문구용)

// 온라인 처리는 부가 기능이라, 여기서 난 예외가 전역 오류 화면(unhandledrejection)으로 번져 판을 끝내면 안 된다.
// 기록을 남기고 플레이어에게 알린 뒤 게임은 계속한다.
function bg(promise) {
  promise.catch((err) => {
    console.error('[online] 처리 중 오류', err);
    game.cacheBusy = false;
    if (game.placing?.busy) closePlace();
    if (game.state === 'play') hud.toast('온라인 보급품을 처리하다 문제가 생겼다. 게임은 계속된다.', 'warn');
  });
}

// 판을 시작할 때 다른 생존자의 보급품을 한 번 받는다. 이전 판이나 타이틀로 돌아간 뒤 도착한 응답은 버린다.
async function loadCaches(run) {
  const r = await online.list();
  if (run !== game.run || game.state === 'title') return;
  const at = Math.max(0.3, game.startedAt + 8.6 - game.time);
  if (!r.ok) {
    later(at, () => hud.toast('다른 생존자의 흔적을 불러오지 못했다. 이번 판은 혼자 버틴다.', 'warn'));
    return;
  }
  if (!r.enabled) {
    game.onlinePaused = true; // 서버가 기능을 잠시 껐다(킬 스위치). 안내 없이 혼자 하는 판으로 둔다.
    return;
  }
  caches.set(r.caches);
  game.onlineLive = true;
  hud.setOnline(true);
  const others = r.caches.filter((c) => !c.mine).length;
  later(at, () => hud.toast(others
    ? `다른 생존자가 남긴 보급품 ${others}개가 마을 어딘가에 있다. 청록빛을 찾아보자.`
    : '아직 이 마을에 남겨진 보급품이 없다. 남는 물건이 있으면 다음 사람을 위해 남겨 보자.'));
}

// 서버 거절 사유를 플레이어에게 알릴 문장으로 바꾼다. 상태를 바꿔야 하는 사유는 여기서 함께 처리한다.
function onlineError(r, c) {
  switch (r.error) {
    case 'used_today': return '오늘은 이미 이 보급품을 꺼냈다.';
    case 'gone':
    case 'not_found':
      if (c) caches.remove(c.id);
      return '보급품이 이미 비었거나 사라졌다.';
    case 'own_cache':
      if (c) c.mine = true;
      return '내가 남긴 보급품이다.';
    case 'already_thanked': return '이미 고마워요를 보냈다.';
    case 'not_used': return '꺼내 쓴 보급품에만 고마워요를 보낼 수 있다.';
    case 'slot_taken': return '누군가 방금 그 자리에 보급품을 두었다.';
    case 'player_limit': return `한 사람이 남겨 둘 수 있는 보급품은 ${MAX_MINE}개까지다.`;
    case 'ip_daily': return '오늘은 더 할 수 없다. 내일 다시 해 보자.';
    case 'town_full': return '마을에 보급품이 가득 찼다.';
    case 'rate': return '너무 빠르다. 잠시 뒤에 다시 해 보자.';
    case 'disabled':
      game.onlineLive = false;
      game.onlinePaused = true;
      hud.setOnline(false);
      closePlace();
      caches.clear();
      return '온라인 보급품이 잠시 꺼졌다.';
    case 'timeout':
    case 'network': return '연결이 끊겨 서버에 닿지 않았다.';
    default: return `서버가 요청을 처리하지 못했다 (${r.error}).`;
  }
}

function grantShared(kind) {
  if (kind === 'bandage') {
    if (player.bandages < 5) {
      player.bandages++;
      hud.toast('다른 생존자가 남긴 붕대를 꺼냈다.', 'good');
    } else {
      player.hp = Math.min(100, player.hp + 35);
      hud.toast('붕대가 가득 차서 바로 감았다. 체력 +35', 'good');
    }
  } else if (kind === 'fuel') {
    player.cans++;
    hud.toast('다른 생존자가 남긴 연료통을 꺼냈다. 트럭에 타면 부어 넣는다.', 'good');
  } else {
    player.battery = Math.min(100, player.battery + BATTERY_PACK);
    hud.toast(`다른 생존자가 남긴 배터리 팩. 손전등 +${BATTERY_PACK}%`, 'good');
  }
  sound.play('pickup');
}

async function takeCache(c) {
  const run = game.run;
  game.cacheBusy = true;
  const r = await online.use(c.id);
  if (run !== game.run) return;
  game.cacheBusy = false;
  if (!r.ok) {
    hud.toast(onlineError(r, c), r.error === 'used_today' ? '' : 'warn');
    return;
  }
  game.cacheTaken++;
  grantShared(KIND_NAMES[r.data?.kind] ? r.data.kind : c.kind);
  c.charges = r.data?.charges ?? c.charges - 1;
  if (c.charges <= 0) caches.remove(c.id);
  if (!game.hintThanks) {
    game.hintThanks = true;
    later(1.6, () => hud.toast('상자 앞에서 다시 길게 누르면 남긴 사람에게 고마워요를 보낼 수 있다.'));
  }
}

async function sendThanks(c) {
  const run = game.run;
  game.cacheBusy = true;
  const r = await online.thank(c.id);
  if (run !== game.run) return;
  game.cacheBusy = false;
  if (!r.ok) {
    hud.toast(onlineError(r, c), r.error === 'already_thanked' ? '' : 'warn');
    return;
  }
  c.thanks = r.data?.thanks ?? c.thanks + 1;
  sound.play('click');
  hud.toast('고마워요를 보냈다. 이 보급품이 마을에 조금 더 오래 남는다.', 'good');
}

function cacheInteract(dt, c, how) {
  const name = KIND_NAMES[c.kind];
  if (game.cacheBusy) {
    game.hold = 0;
    hud.prompt('서버에 묻는 중…', 1);
    return;
  }
  if (c.mine) {
    game.hold = 0;
    hud.prompt(`내가 남긴 ${name} · ${c.charges}번 남음`, 0);
    return;
  }
  if (online.usedRecently(c.id)) {
    if (online.hasThanked(c.id)) {
      game.hold = 0;
      hud.prompt(`고마워요를 보낸 ${name} 상자`, 0);
      return;
    }
    const done = holdProgress(dt, 0.6);
    hud.prompt(`${how} 고마워요 보내기`, Math.min(1, game.hold / 0.6));
    if (done) {
      game.hold = 0;
      game.holdLock = true;
      bg(sendThanks(c));
    }
    return;
  }
  const note = NOTES[c.note] ? ` · '${NOTES[c.note]}'` : '';
  if (game.cacheTaken >= RUN_TAKE_LIMIT) {
    game.hold = 0;
    hud.prompt(`다른 생존자가 남긴 ${name}${note} — 이번 판에는 더 꺼낼 수 없다(${RUN_TAKE_LIMIT}번까지)`, 0);
    return;
  }
  const done = holdProgress(dt, 1.0);
  hud.prompt(`${how} 다른 생존자가 남긴 ${name} 꺼내기 · ${c.charges}번 남음${note}`, Math.min(1, game.hold / 1.0));
  if (done) {
    game.hold = 0;
    game.holdLock = true;
    bg(takeCache(c));
  }
}

function placeOptions() {
  return { bandage: player.bandages > 0, fuel: player.cans > 0, battery: player.battery >= BATTERY_PACK_MIN };
}

function closePlace() {
  game.placing = null;
  caches.showGhost(null);
  hud.hidePlace();
}

function togglePlace() {
  if (game.state !== 'play') return;
  if (game.placing) {
    if (!game.placing.busy) closePlace();
    return;
  }
  if (!game.onlineLive) {
    if (online.available && hud.hasOnlineUi) {
      if (!online.enabled) hud.toast('온라인 보급품이 꺼져 있다. 처음 화면에서 켤 수 있다.');
      else if (game.onlinePaused) hud.toast('온라인 보급품이 잠시 꺼져 있다.');
      else hud.toast('다른 생존자와 연결되지 않아 지금은 남길 수 없다.');
    }
    return;
  }
  if (game.driving) {
    hud.toast('트럭에서 내려야 남길 수 있다.');
    return;
  }
  const spot = caches.freeSlotNear(player.pos.x, player.pos.z, PLACE_RADIUS);
  if (!spot) {
    hud.toast('여기엔 둘 자리가 없다. 인도 위 빈 곳으로 가 보자.');
    return;
  }
  game.placing = { spot, note: game.placeNote, busy: false };
  refreshPlace();
}

// 남기기 창이 열려 있는 동안 매 프레임: 가까운 빈 슬롯을 따라가고, 가진 물건에 맞춰 버튼을 켠다.
function refreshPlace() {
  const p = game.placing;
  if (!p) return;
  if (game.driving || game.state !== 'play') {
    if (!p.busy) closePlace();
    return;
  }
  if (!p.busy) {
    const spot = caches.freeSlotNear(player.pos.x, player.pos.z, PLACE_RADIUS);
    if (!spot) {
      closePlace();
      hud.toast('둘 자리에서 멀어졌다.');
      return;
    }
    p.spot = spot;
  }
  caches.showGhost(p.spot);
  const can = placeOptions();
  if (p.busy) for (const k of Object.keys(can)) can[k] = false;
  hud.showPlace({
    counts: { bandage: `${player.bandages}개`, fuel: `${player.cans}개`, battery: `손전등 ${BATTERY_PACK}%` },
    can, note: NOTES[p.note] || '없음', sub: `— ${CHARGES}명이 하나씩 꺼내 쓴다`, busy: p.busy,
  });
}

function cycleNote() {
  const p = game.placing;
  if (!p || p.busy) return;
  p.note = (p.note + 1) % NOTES.length;
  game.placeNote = p.note;
  refreshPlace();
}

// 요청하는 동안 물건을 맡겨 두었다가(그새 써 버리지 않게), 서버가 거절하면 돌려준다.
function reserve(kind, sign) {
  if (kind === 'bandage') player.bandages += sign;
  else if (kind === 'fuel') player.cans += sign;
  else player.battery = Math.min(100, Math.max(0, player.battery + sign * BATTERY_PACK));
}

async function placeCache(kind) {
  const p = game.placing;
  if (!p || p.busy || !placeOptions()[kind]) return;
  const run = game.run;
  reserve(kind, -1);
  p.busy = true;
  refreshPlace();
  const r = await online.place(p.spot.slot, kind, p.note);
  if (run !== game.run) return; // 새 판의 인벤토리에는 손대지 않는다
  closePlace();
  if (!r.ok) {
    reserve(kind, +1);
    hud.toast(`${onlineError(r)} 가진 것은 그대로다.`, 'warn');
    return;
  }
  caches.add({ ...r.data.cache, mine: true });
  sound.play('pickup');
  hud.toast(`${OBJ[kind]} 남겼다. 다른 생존자 ${r.data.cache.charges}명이 하나씩 꺼내 쓸 수 있다.`, 'good');
}

// 타이틀 화면: 켜기/끄기, 내 보급품 소식, 기록 지우기
let summaryAt = -Infinity;
function renderOnline() {
  const box = $('online');
  if (!box) return;
  box.classList.toggle('hidden', !online.available);
  if (!online.available) return;
  const on = online.enabled;
  const toggle = $('online-toggle');
  toggle.textContent = on ? '온라인 보급품 켜짐' : '온라인 보급품 꺼짐';
  toggle.setAttribute('aria-pressed', String(on));
  const sum = $('online-summary');
  if (!on) {
    sum.textContent = '꺼 두면 서버에 아무것도 보내지 않아요.';
    return;
  }
  if (performance.now() - summaryAt < 60000) return;
  summaryAt = performance.now();
  sum.textContent = '';
  bg(online.summary().then((r) => {
    if (!online.enabled) return;
    if (!r.ok || !r.data) {
      summaryAt = -Infinity;
      sum.textContent = r.error === 'disabled' ? '온라인 보급품이 잠시 꺼져 있어요.' : '온라인 소식을 불러오지 못했어요.';
      return;
    }
    const d = r.data;
    sum.textContent = d.placed ? `당신이 남긴 보급품 ${d.placed}개 · 다른 생존자 ${d.users}명이 꺼내 썼고, 고마워요 ${d.thanks}번` : '';
  }));
}

async function forgetOnline() {
  if (!confirm('서버에 있는 내 온라인 기록(남긴 보급품, 꺼낸 기록, 고마워요)을 지울까요? 되돌릴 수 없어요.')) return;
  const btn = $('online-forget');
  btn.disabled = true;
  const r = await online.forget();
  btn.disabled = false;
  summaryAt = -Infinity;
  $('online-summary').textContent = r.ok ? '내 온라인 기록을 지웠어요.' : `지우지 못했어요: ${onlineError(r)}`;
}

// 트럭 타기·내리기
function enterCar() {
  let poured = 0;
  while (player.cans > 0 && car.fuel < 90) {
    car.fuel = Math.min(100, car.fuel + 40);
    player.cans--;
    poured++;
  }
  if (poured) {
    sound.play('pour');
    hud.toast(`연료통 ${poured}개를 부었다. 연료 ${Math.round(car.fuel)}%`, 'good');
  }
  game.driving = true;
  car.occupied = true;
  player.setRiding(true);
  player.pos.copy(car.pos);
  hud.setDriving(true);
  sound.play('door');
  sound.play('carstart');
  if (!game.hintCar) {
    game.hintCar = true;
    later(0.6, () => hud.toast(input.usingTouch || mobile
      ? '스틱을 민 쪽으로 달린다. 뒤로 당기면 후진. 멈춘 뒤 내리기 버튼을 길게.'
      : 'W 가속 · S 브레이크·후진 · A/D 핸들. 멈춘 뒤 E를 길게 눌러 내린다.'));
    later(3.2, () => hud.toast('연료는 달릴수록 줄어든다. 퓨즈를 끼우거나 뒤지려면 내려야 한다.'));
  }
}

function leaveCar() {
  const spot = car.exitSpot(world);
  game.driving = false;
  car.occupied = false;
  car.reverse = false;
  player.setRiding(false);
  player.pos.set(spot.x, world.heightAt(spot.x, spot.z), spot.z);
  player.facing = car.a;
  player.model.rotation.y = car.a;
  hud.setDriving(false);
  sound.play('door');
}

function holdProgress(dt, dur) {
  game.hold = input.interactHeld && !game.holdLock ? game.hold + dt : 0;
  return game.hold >= dur;
}

function interact(dt) {
  // 타고 내린 직후에는 키를 한 번 떼야 다음 길게 누르기를 받는다(누른 채로 곧바로 내리거나 뒤지지 않게).
  if (game.holdLock && !input.interactHeld) game.holdLock = false;
  const how = input.usingTouch || mobile ? '버튼을 길게 눌러' : 'E를 길게 눌러';

  if (game.driving) {
    if (game.holdKey !== 'exit') {
      game.hold = 0;
      game.holdKey = 'exit';
    }
    if (Math.abs(car.speed) > 2.5) {
      game.hold = 0;
      hud.prompt(input.interactHeld && !game.holdLock ? '속도를 줄여야 내릴 수 있다' : null, 0);
      return;
    }
    const done = holdProgress(dt, 0.35);
    hud.prompt(`${how} 내리기`, Math.min(1, game.hold / 0.35));
    if (done) {
      game.hold = 0;
      game.holdLock = true;
      leaveCar();
    }
    return;
  }

  let target = world.nearestInteractable(player.pos.x, player.pos.z, 1.8);
  const spot = (t) => (t.kind === 'fuse' ? { x: t.ref.ix, z: t.ref.iz } : { x: t.ref.x, z: t.ref.z });
  const dist = (t) => {
    const p = spot(t);
    return Math.hypot(p.x - player.pos.x, p.z - player.pos.z);
  };
  const shared = game.onlineLive ? caches.nearest(player.pos.x, player.pos.z, CACHE_REACH) : null;
  if (shared && (!target || dist({ kind: 'cache', ref: shared }) < dist(target))) target = { kind: 'cache', ref: shared };
  const carDist = car.distanceTo(player.pos.x, player.pos.z);
  if (carDist < 1.3) {
    if (!target || dist(target) > carDist) target = { kind: 'car', ref: car };
  }
  const key = target ? target.ref : null;
  if (key !== game.holdKey) {
    game.hold = 0;
    game.holdKey = key;
  }
  if (!target) {
    hud.prompt(null);
    return;
  }
  if (target.kind === 'car') {
    if (car.fuel <= 0 && player.cans <= 0) {
      game.hold = 0;
      hud.prompt('트럭 — 연료가 바닥났다. 연료통이 필요하다', 0);
      return;
    }
    const pour = player.cans > 0 && car.fuel < 90 ? ` · 연료통 ${player.cans}개 붓기` : '';
    const done = holdProgress(dt, 0.5);
    hud.prompt(`${how} 트럭 타기${pour}`, Math.min(1, game.hold / 0.5));
    if (done) {
      game.hold = 0;
      game.holdLock = true;
      enterCar();
    }
    return;
  }
  if (target.kind === 'cache') {
    cacheInteract(dt, target.ref, how);
    return;
  }
  if (target.kind === 'loot') {
    const dur = 1.0;
    const done = holdProgress(dt, dur);
    hud.prompt(`${how} 뒤지기`, Math.min(1, game.hold / dur));
    if (done) {
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
  const done = holdProgress(dt, dur);
  hud.prompt(`${how} 퓨즈 끼우기 · ${name}`, Math.min(1, game.hold / dur));
  if (done) {
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

function walk(dt) {
  const fromX = player.pos.x;
  const fromZ = player.pos.z;
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
  car.update(dt, null, world, env.night);
  // 세워 둔 트럭과 정적 충돌체를 번갈아 풀어, 트럭이 밀어낸 자리가 벽 속이 되지 않게 한다.
  // 트럭과 벽 사이 틈처럼 둘 다 만족하는 자리가 없으면 이번 이동을 취소한다.
  for (let i = 0; i < 3 && car.pushOut(player.pos, PLAYER_R); i++) world.collide(player.pos, PLAYER_R);
  if (car.distanceTo(player.pos.x, player.pos.z) < PLAYER_R - 1e-3) {
    player.pos.x = fromX;
    player.pos.z = fromZ;
  }
}

// 키보드는 W/S 가속·A/D 핸들, 터치 스틱은 민 방향으로 차가 알아서 꺾어 간다.
function drive(dt) {
  const keys = input.driveKeys();
  let ctl = keys;
  if (!keys.any) {
    const ms = input.moveScreen();
    const dir = tmp.set(0, 0, 0).addScaledVector(SCREEN_RIGHT, ms.x).addScaledVector(SCREEN_DOWN, ms.y);
    ctl = car.steerToward(dir.x, dir.z, Math.hypot(ms.x, ms.y));
  }
  const ev = car.update(dt, ctl, world, env.night);
  if (ev.crash) {
    sound.play('crash');
    game.shake = Math.min(0.6, 0.15 + ev.crash * 0.04);
  }
  if (ev.stalled) {
    sound.play('stall');
    hud.toast('연료가 떨어졌다! 트럭이 멈춘다. 연료통을 찾아야 한다.', 'warn');
  }
  player.pos.copy(car.pos);
  player.facing = car.a;
  player.update(dt, game.time, { x: 0, z: 0 }, null, world, env.night, env.rainLevel);
}

function step(dt) {
  runTimers();
  const flashKey = input.consume('KeyF') || input.consume('Touch_flash');
  const flashClick = input.consume('MouseLeft');
  if (game.driving) {
    if (flashKey && game.time - game.flashNoteAt > 4) {
      game.flashNoteAt = game.time;
      hud.toast('차 안에서는 손전등 대신 전조등이 앞을 비춘다.');
    }
  } else if (flashKey || flashClick) {
    toggleFlash();
  }
  if (input.consume('KeyQ') || input.consume('Touch_band')) useBandage();
  if (input.consume('KeyG')) togglePlace();
  if (game.placing) {
    for (const [code, kind] of [['Digit1', 'bandage'], ['Digit2', 'fuel'], ['Digit3', 'battery']]) {
      if (input.consume(code)) bg(placeCache(kind));
    }
    if (input.consume('KeyN')) cycleNote();
    refreshPlace();
  }

  for (const ev of env.advance(dt)) onTimeEvent(ev);

  if (game.driving) drive(dt);
  else walk(dt);

  const lit = world.lightAt(player.pos.x, player.pos.z);
  if (lit) player.battery = Math.min(100, player.battery + dt * 3.5);
  if (env.night < 0.3) player.hp = Math.min(100, player.hp + dt * 0.8);
  else if (lit) player.hp = Math.min(100, player.hp + dt * 1.2);
  if (player.flashOn && player.battery <= 0) {
    player.flashOn = false;
    hud.toast('손전등 배터리가 다 됐다!', 'warn');
  }

  const spawning = !game.peaceful && env.night > 0.75;
  const ev = shades.update(dt, game.time, { player, world, night: env.night, nights: game.nights, spawning, car, driving: game.driving });
  if (ev.hits) {
    sound.play('hurt');
    game.shake = 0.45;
  }
  if (ev.rammed) {
    sound.play('crash');
    game.shake = Math.max(game.shake, 0.3);
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
  const esc = input.consume('Escape');
  const pKey = input.consume('KeyP');
  if (esc && game.placing && game.state === 'play') {
    if (!game.placing.busy) closePlace();
  } else if (esc || pKey) {
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
    // 운전 중에는 달리는 쪽을 더 보여 주고 조금 멀리서 본다.
    camGoal.copy(player.pos);
    if (game.driving) camGoal.addScaledVector(car.vel, 0.45);
    camFocus.lerp(camGoal, 1 - Math.exp(-dt * (game.driving ? 4 : 6)));
    const boost = game.driving ? 2.5 + 2.5 * Math.min(1, Math.abs(car.speed) / MAX_FWD) : 0;
    game.zoomBoost += (boost - game.zoomBoost) * (1 - Math.exp(-dt * 1.5));
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
  caches.update(game.time, pxPerUnit, env.night);
  world.setWetness(env.rainLevel);
  if (game.state !== 'title') {
    sound.setMix({ rain: env.rainLevel, night: env.night, dread: game.state === 'play' ? game.dread ?? 0 : 0 });
  }
  // 일시정지 중에는 공회전, 그 밖(타이틀·종료 화면)에는 엔진을 끈다.
  const engineOn = game.driving && car.running && (game.state === 'play' || game.state === 'pause');
  sound.setEngine(game.state === 'play' && engineOn ? {
    on: true, rpm: Math.min(1, Math.abs(car.speed) / MAX_FWD), load: car.throttle, skid: Math.min(1, Math.max(0, car.slip - 2) / 4),
  } : { on: engineOn });

  const lowHp = player.hp < 30 && game.state === 'play' ? 0.25 + 0.15 * Math.sin(game.time * 5) : 0;
  post.render(scene, camera, env.look, game.time, {
    focus: 0.5, band: 0.07, blurScale: game.state === 'title' ? 1.25 : 1.0,
    hurt: Math.max(player.hurtFx * 0.9, lowHp),
  });

  if (game.state !== 'title') {
    hud.update({
      day: env.day, hour: env.hour, zonesOn: world.poweredZones, zonesTotal: world.totalZones,
      hp: player.hp, battery: player.battery, fuses: player.fuses, bandages: player.bandages, flashOn: player.flashActive,
      cans: player.cans, driving: game.driving, fuel: car.fuel,
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
// 공유 보급품 화면 요소. 배포 직후 옛 index.html과 섞이면 없을 수 있다(hud.hasOnlineUi가 기능을 숨긴다).
// 누른 버튼에 포커스가 남으면 Space(상호작용 키)가 그 버튼을 다시 눌러 버리므로 바로 놓는다.
const tap = (el, fn) => el?.addEventListener('click', (e) => {
  e.currentTarget.blur();
  fn();
});
tap($('drop-btn'), togglePlace);
for (const btn of document.querySelectorAll('#place [data-kind]')) tap(btn, () => bg(placeCache(btn.dataset.kind)));
tap($('place-note'), cycleNote);
tap($('place-cancel'), () => game.placing && !game.placing.busy && closePlace());
$('online-toggle')?.addEventListener('click', () => {
  online.setEnabled(!online.enabled);
  summaryAt = -Infinity;
  renderOnline();
});
$('online-forget')?.addEventListener('click', () => bg(forgetOnline()));
addEventListener('blur', () => pauseGame(true));
document.addEventListener('visibilitychange', () => document.hidden && pauseGame(true));

// ?debug: 콘솔에서 상태를 들여다보고 시뮬레이션을 고정 간격으로 돌려 보는 개발용 핸들
if (params.has('debug')) {
  window.lumen = {
    THREE, scene, camera, renderer, world, env, post, player, shades, car, game, input, hud, startGame, online, caches,
    step(sec) {
      let t = last;
      for (let i = 0, n = Math.round(sec / 0.05); i < n; i++) frame((t += 50));
      last = performance.now();
    },
  };
}

// ---------------------------------------------------------------- WebGL 컨텍스트 손실

// 모바일 백그라운드 전환·GPU 리셋 때 컨텍스트를 잃을 수 있다. three.js가 복구를 허용(preventDefault)하고
// 복구되면 GPU 자원을 다시 올리므로, 여기서는 진행을 멈추고 안내한 뒤 복구를 기다린다.
let reloadHintTimer = 0;
function setContextLost(lost) {
  game.contextLost = lost;
  $('gl-notice')?.classList.toggle('hidden', !lost);
  $('gl-reload')?.classList.add('hidden');
  clearTimeout(reloadHintTimer);
  for (const id of ['start-btn', 'resume-btn', 'restart-btn', 'continue-btn']) $(id).disabled = lost || !game.ready;
  if (lost) {
    pauseGame(true);
    // 브라우저가 끝내 복구해 주지 않는 경우를 위해 새로고침 안내를 띄운다.
    reloadHintTimer = setTimeout(() => $('gl-reload')?.classList.remove('hidden'), 6000);
  } else {
    resize();
  }
}
renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  console.warn('[gl] WebGL 컨텍스트를 잃었습니다. 복구를 기다립니다.');
  setContextLost(true);
});
renderer.domElement.addEventListener('webglcontextrestored', () => {
  console.info('[gl] WebGL 컨텍스트가 복구되었습니다.');
  setContextLost(false);
});
$('gl-reload')?.addEventListener('click', () => location.reload());

// ---------------------------------------------------------------- 시작 준비

// 밤·비·그늘이처럼 처음엔 숨겨진 물체까지 포함해 셰이더를 미리 컴파일해 둔다.
// 그렇지 않으면 첫 밤이나 첫 그늘이 등장 순간에 컴파일로 프레임이 멈춘다.
async function warmUp() {
  updateCamera(0);
  const hidden = [];
  scene.traverse((o) => {
    if (!o.visible) {
      hidden.push(o);
      o.visible = true;
    }
  });
  try {
    // 프로그램 변형(출력 색공간·톤매핑)은 현재 렌더 타깃으로 정해지므로, 실제로 그리는 HDR 타깃 기준으로 컴파일한다.
    renderer.setRenderTarget(post.rtScene);
    await renderer.compileAsync(scene, camera);
    renderer.setRenderTarget(null);
    post.render(scene, camera, env.look, 0, { focus: 0.5, band: 0.07, blurScale: 1, hurt: 0 });
  } catch (err) {
    console.error('[warmup] 셰이더 사전 컴파일에 실패했습니다. 첫 등장 때 끊김이 있을 수 있습니다.', err);
  } finally {
    for (const o of hidden) o.visible = false;
  }
}

renderBest();
env.setHour(Number(params.get('hour')) || 16.5);
document.body.classList.add('ready');
requestAnimationFrame(frame);
warmUp().then(() => {
  game.ready = true;
  document.body.classList.add('loaded');
  $('start-btn').textContent = '시작하기';
  setContextLost(game.contextLost ?? false);
  // 사전 컴파일이 메인 스레드를 오래 막는 느린 기기에서 요청 시간 제한이 헛걸리지 않게, 준비가 끝난 뒤 소식을 받는다.
  renderOnline();
  if (params.get('start') === '1') startGame();
});
