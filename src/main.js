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
import { QUALITY, ZOOM, loadSettings, saveSettings, bindSettings } from './settings.js';
import { loadBest, recordRun, hasRecords, describeBest, initRecordsPanel } from './records.js';
import { initPwa } from './pwa.js';
import { Story, DOCS, sceneById } from './story.js';
import { Dialogue } from './dialogue.js';
import { SCENES } from './script.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const mobile = matchMedia('(pointer: coarse)').matches;
const settings = loadSettings({ mobile });

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
renderer.shadowMap.enabled = QUALITY[settings.quality].shadows;
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
const post = new Post(renderer, { samples: QUALITY[settings.quality].samples });
const player = new Player(scene, { mobile });
const shades = new Shades(scene);
const car = new Vehicle(scene);
const input = new Input(renderer.domElement);
const hud = new Hud();
const sound = new Sound();
sound.setVolume(settings.volume, settings.ambience);
const story = new Story(scene, world);
const dialogue = new Dialogue({ sound });

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
  zoom: settings.zoom,
  zoomTarget: settings.zoom,
  zoomBoost: 0,
  hintFlash: false,
  driving: false,
  holdLock: false,
  hintCar: false,
  flashNoteAt: -99,
  clock: 0, // 화면 연출용 시계. 이야기 장면 중에도 흐른다(게임 시간 game.time은 멈춘다).
};

// 이야기 장면: 차례를 기다리는 장면 id와, 장면이 카메라를 옮긴 곳
const storyQueue = [];
const storyCam = { on: false, x: 0, z: 0, zoom: null };

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

// 휴대폰을 돌리면 resize 이벤트가 크기가 다 바뀌기 전에 오거나(iOS) 아예 늦게 오는 경우가 있어,
// 매 프레임 창 크기·DPR을 비교해 달라졌을 때만 다시 맞춘다.
const view = { w: 0, h: 0, dpr: 0 };
function resize() {
  view.w = innerWidth;
  view.h = innerHeight;
  view.dpr = devicePixelRatio;
  renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY[settings.quality].dpr));
  // 탭이 숨겨진 채로 열리면 크기가 0일 수 있다. 0 크기 렌더 타깃은 만들지 않는다.
  renderer.setSize(Math.max(1, innerWidth), Math.max(1, innerHeight));
  const c = renderer.domElement;
  post.setSize(Math.max(1, c.width), Math.max(1, c.height));
}
function checkResize() {
  if (innerWidth !== view.w || innerHeight !== view.h || devicePixelRatio !== view.dpr) resize();
}
resize();

// 짧은 변 기준으로 보여 줄 범위를 정한다. 휴대폰(짧은 변 430px 이하)은 세로·가로 모두 짧은 변에
// 17칸(반경 8.5)을 보여 줘서 화면을 돌려도 캐릭터 크기가 그대로이고, 긴 변 쪽으로 시야만 넓어진다.
// 짧은 변이 600px 이상인 화면(데스크톱·태블릿)은 예전처럼 세로 반경을 줌 값 그대로 쓴다.
function viewHalfFor(w, h, zoom) {
  const aspect = w / h;
  const minShort = 8.5 * (zoom / ZOOM.base);
  if (aspect < 1) return Math.max(zoom, minShort / aspect);
  const t = Math.min(1, Math.max(0, (h - 430) / (600 - 430)));
  return minShort + (zoom - minShort) * t;
}

function updateCamera(dt) {
  game.zoom += (Math.min(24, game.zoomTarget + game.zoomBoost) - game.zoom) * (1 - Math.exp(-dt * 10));
  const w = Math.max(1, innerWidth);
  const h = Math.max(1, innerHeight);
  const aspect = w / h;
  viewHalf = viewHalfFor(w, h, game.zoom);
  camera.left = -viewHalf * aspect;
  camera.right = viewHalf * aspect;
  camera.top = viewHalf;
  camera.bottom = -viewHalf;
  camera.updateProjectionMatrix();
  const shake = settings.shake ? game.shake : 0;
  shakeOffset.set((Math.random() - 0.5) * shake, 0, (Math.random() - 0.5) * shake);
  camera.position.copy(camFocus).add(shakeOffset).addScaledVector(CAM_DIR, CAM_DIST);
  camera.lookAt(tmp.copy(camFocus).add(shakeOffset));
  camera.updateMatrixWorld();
  pxPerUnit = renderer.domElement.height / (2 * viewHalf);
}

// ---------------------------------------------------------------- 기록

function saveBest() {
  recordRun({ nights: game.nights, zones: world.poweredZones, won: game.won, day: env.day }, world.totalZones);
}

function renderBest() {
  const b = loadBest(world.totalZones);
  $('best').textContent = hasRecords(b) ? `최고 기록 · ${describeBest(b, world.totalZones)}` : '';
}

// ---------------------------------------------------------------- 게임 흐름

// 배포 직후 캐시된 옛 index.html과 섞이면 settings 화면이 없을 수 있다.
const SCREENS = ['title', 'pause', 'end', 'settings', 'journal'];
function setScreen(id) {
  if (id !== 'settings') settingsFrom = null;
  if (id !== 'journal') journalFrom = null;
  for (const s of SCREENS) $(s)?.classList.toggle('hidden', s !== id);
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
  storyQueue.length = 0;
  storyCam.on = false;
  storyCam.zoom = null;
  story.resetRun();
  Object.assign(game, {
    state: 'play', nights: 0, hold: 0, holdKey: null, peaceful: false, won: false, shake: 0, hintFlash: false,
    driving: false, holdLock: false, zoomBoost: 0, flashNoteAt: -99,
  });
  hud.setDriving(false);
  camFocus.copy(player.pos);
  setScreen(null);
  hud.clearToasts();
  hud.show(true);
  hud.showTouch(mobile || input.usingTouch);
  $('key-hints').classList.toggle('hidden', mobile);
  // 처음 하는 사람은 도착 장면이 같은 내용을 들려준다.
  if (!queueStory('start')) hud.toast('정전된 마을. 불이 남은 곳은 은신처뿐이다.');
  later(1.8, () => hud.toast('퓨즈를 모아 꺼진 배전함에 끼우면 그 구역에 다시 불이 들어온다.'));
  later(3.8, () => hud.toast('화살표가 가장 가까운 배전함을 가리킨다. 퓨즈 하나는 이미 갖고 있다.'));
  later(6.4, () => !game.driving && hud.toast('은신처 앞 도로에 낡은 트럭이 서 있다. 연료가 남은 동안은 몰 수 있다.'));
  flushStory();
}

function pauseGame(on) {
  if (on && game.state === 'play') {
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
  const zones = `${world.poweredZones}/${world.totalZones}`;
  // 그늘이가 사람들의 그림자라는 걸 들은 뒤에는 '쫓아낸' 대신 '돌려보낸'이라고 적는다.
  const sent = story.isSeen('return') ? '집으로 돌려보낸 그늘이' : '쫓아낸 그늘이';
  if (won) {
    sound.play('win');
    $('end-title').textContent = '등대에 다시 불이 켜졌다';
    $('end-text').textContent = `${env.day}일째, 마을 아홉 구역과 호수의 첫 불을 모두 밝혔다. 버틴 밤 ${game.nights}번 · ${sent} ${shades.banished}.`;
    $('continue-btn').classList.remove('hidden');
  } else {
    $('end-title').textContent = '어둠에 삼켜졌다';
    $('end-text').textContent = `버틴 밤 ${game.nights}번 · 밝힌 구역 ${zones} · ${sent} ${shades.banished}.`;
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
  storyQueue.length = 0;
  game.state = 'title';
  hud.show(false);
  hud.showTouch(false);
  hud.prompt(null);
  shades.clear();
  renderBest();
  setScreen('title');
}

// ---------------------------------------------------------------- 이야기

// 사건(event)에 맞는 아직 안 본 장면을 줄 세운다. 줄 세운 게 있으면 true.
function queueStory(event) {
  if (!dialogue.ok) return false;
  let added = false;
  for (const id of story.scenesFor(event)) {
    if (storyQueue.includes(id)) continue;
    storyQueue.push(id);
    added = true;
  }
  return added;
}

// 게임 중이고 다른 장면·기록이 열려 있지 않으면 다음 장면을 튼다.
function flushStory() {
  if (!storyQueue.length || game.state !== 'play' || dialogue.busy) return false;
  playScene(storyQueue.shift());
  return true;
}

function enterStory() {
  game.state = 'story';
  game.hold = 0;
  hud.prompt(null);
  hud.show(false);
  hud.showTouch(false);
}

function leaveStory() {
  game.state = 'play';
  if (storyCam.on || storyCam.zoom !== null) {
    // 멀리 갔던 카메라는 dialogue가 화면을 가린 동안 플레이어에게 바로 돌아온다.
    storyCam.on = false;
    storyCam.zoom = null;
    camFocus.copy(player.pos);
    game.zoomBoost = 0;
    game.zoom = game.zoomTarget;
  }
  hud.show(true);
  hud.showTouch(mobile || input.usingTouch);
  // 장면을 넘기며 누른 키가 곧바로 상호작용·손전등으로 이어지지 않게 한다.
  input.endFrame();
  game.holdLock = true;
  game.hold = 0;
}

function playScene(id, after) {
  const sc = sceneById(id);
  if (!sc || !dialogue.ok) {
    after?.();
    return;
  }
  enterStory();
  storyCam.on = false;
  storyCam.zoom = null;
  dialogue.play(sc, {
    onCam: storyCamera,
    onEnd: () => {
      const opened = story.markSeen(id);
      leaveStory();
      for (const c of opened) hud.toast(`새 기록 — ${c.where}`, 'story');
      if (id === 'arrival') later(1.2, () => hud.toast('푸른 빛기둥과 푸른 화살표가 아직 안 읽은 기록이 있는 곳을 알려 준다.', 'story'));
      after?.();
    },
  });
}

// 장면 줄의 카메라 지시(src/script.js 머리말 참고)
function storyCamera(cam) {
  if (!cam) return;
  if (Number.isFinite(cam.hour)) env.setHour(cam.hour);
  if (cam.weather === 'clear') {
    env.rainyNight = false;
    env.rainLevel = 0;
  }
  if (cam.fx === 'lighthouse' && !story.lit) {
    story.setLighthouse(true);
    sound.play('beacon');
    // 첫 불이 켜지면 떠돌던 그림자들은 집으로 돌아간다(화면이 까만 동안 사라진다).
    shades.clear();
  }
  const at = cam.at && cam.at !== 'player' ? story.anchor(cam.at) : null;
  storyCam.on = !!at;
  if (at) {
    storyCam.x = at.x;
    storyCam.z = at.z;
  }
  storyCam.zoom = Number.isFinite(cam.zoom) ? cam.zoom : null;
  if (cam.cut) {
    if (at) camFocus.set(at.x, 0, at.z);
    else camFocus.copy(player.pos);
    const goal = storyCam.zoom ?? game.zoomTarget;
    game.zoomBoost = goal - game.zoomTarget;
    game.zoom = Math.min(24, goal);
  }
}

// 마을의 기록을 읽는다. 처음 읽으면 수첩에 남는다.
function openDoc(clue) {
  const first = !story.isFound(clue.id);
  enterStory();
  dialogue.showDoc(clue, {
    first,
    onClose: () => {
      leaveStory();
      if (!first || !story.markFound(clue.id)) return;
      sound.play('pickup');
      hud.toast(`수첩에 적었다 (${story.foundDocs}/${DOCS.length})`, 'story');
      if (story.foundDocs === 1) later(1.4, () => hud.toast('읽은 기록과 무전은 일시정지 → 수첩에서 다시 볼 수 있다.'));
    },
  });
}

// 마지막 구역에 불이 들어왔을 때. 처음이면 등대가 다시 켜지는 장면을 보고 끝 화면으로 간다.
function winGame() {
  const finale = dialogue.ok ? story.scenesFor('win')[0] : null;
  const finish = () => {
    story.setLighthouse(true);
    endGame(true);
  };
  if (!finale) {
    finish();
    return;
  }
  storyQueue.length = 0; // 마지막 장면이 남은 장면을 대신한다(못 본 장면은 다음 판에 나온다)
  playScene(finale, finish);
}

let journalFrom = null; // 수첩을 연 곳('title' | 'pause')

function openJournal() {
  if (!$('journal') || !dialogue.ok || journalFrom || settingsFrom || (game.state !== 'title' && game.state !== 'pause')) return;
  journalFrom = game.state;
  renderJournal();
  setScreen('journal');
  $('journal-title')?.focus();
}

function renderJournal() {
  dialogue.renderJournal({
    story, scenes: SCENES, docs: DOCS, canReset: journalFrom === 'title',
    onRead: (item) => dialogue.showDoc(item, { onClose: () => $('journal-close')?.focus({ preventScroll: true }) }),
    onReset: () => {
      story.wipe();
      renderJournal();
    },
  });
}

function closeJournal() {
  if (!journalFrom) return;
  const back = journalFrom;
  journalFrom = null;
  setScreen(back);
  (back === 'pause' ? $('pause-journal-btn') : $('journal-btn'))?.focus({ preventScroll: true });
}

// ---------------------------------------------------------------- 설정

let settingsFrom = null; // 설정 화면을 연 곳('title' | 'pause'). 닫으면 그리로 돌아간다.
let settingsUi = null;
let recordsUi = null;
let pwaUi = null;

function openSettings() {
  // 그래픽 컨텍스트를 잃은 동안에는 화질을 바꿔도 셰이더를 컴파일할 수 없으니 열지 않는다.
  if (!$('settings') || settingsFrom || game.contextLost || (game.state !== 'title' && game.state !== 'pause')) return;
  settingsFrom = game.state;
  settingsUi?.sync();
  recordsUi?.refresh();
  pwaUi?.render();
  setScreen('settings');
  $('settings-title')?.focus();
}

function closeSettings() {
  if (!settingsFrom) return;
  const back = settingsFrom;
  settingsFrom = null;
  setScreen(back);
  (back === 'pause' ? $('pause-settings-btn') : $('settings-btn'))?.focus({ preventScroll: true });
}

function toggleMute() {
  sound.init();
  const muted = sound.toggleMute();
  hud.setMuted(muted);
  return muted;
}

function applyQuality() {
  const q = QUALITY[settings.quality];
  post.setSamples(q.samples);
  resize();
  if (renderer.shadowMap.enabled === q.shadows) return;
  renderer.shadowMap.enabled = q.shadows;
  // 그림자 유무는 셰이더에 들어가므로 모든 재질을 다시 컴파일한다. 끌 때는 그림자 맵 메모리도 돌려준다.
  scene.traverse((o) => {
    for (const m of [o.material].flat()) if (m) m.needsUpdate = true;
    if (!q.shadows && o.isLight && o.shadow?.map) {
      o.shadow.map.dispose();
      o.shadow.map = null;
    }
  });
  if (game.ready) warmUp();
}

function applySetting(key) {
  switch (key) {
    case 'volume':
    case 'ambience':
      sound.setVolume(settings.volume, settings.ambience);
      break;
    case 'quality':
      applyQuality();
      break;
    case 'zoom':
      game.zoomTarget = settings.zoom;
      break;
    case 'lefty':
      $('touch').classList.toggle('lefty', settings.lefty);
      break;
    case 'fps':
      hud.showFps(settings.fps);
      break;
    case 'shake':
      document.body.classList.toggle('calm', !settings.shake);
      break;
    default:
      break; // tilt는 매 프레임 읽는다
  }
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
  // 불이 들어오는 걸 잠깐 보여 준 뒤 할머니의 무전이 온다.
  if (world.poweredZones === world.totalZones) later(2.2, winGame);
  else later(2.4, () => queueStory({ zones: world.poweredZones }));
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

  const px = player.pos.x;
  const pz = player.pos.z;
  let target = world.nearestInteractable(px, pz, 1.8);
  let targetDist = Infinity;
  if (target) {
    const loot = target.kind === 'loot';
    targetDist = Math.hypot((loot ? target.ref.x : target.ref.ix) - px, (loot ? target.ref.z : target.ref.iz) - pz);
  }
  const note = dialogue.ok ? story.nearest(px, pz) : null;
  if (note && note.dist < targetDist) {
    target = { kind: 'clue', ref: note.spot, clue: note.clue };
    targetDist = note.dist;
  }
  const carDist = car.distanceTo(px, pz);
  if (carDist < 1.3 && carDist < targetDist) target = { kind: 'car', ref: car };
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
  if (target.kind === 'clue') {
    const c = target.clue;
    const dur = 0.6;
    const done = holdProgress(dt, dur);
    const verb = c.scene ? '급수탑 오르기' : `${story.isFound(c.id) ? '다시 읽기' : '읽기'} · ${c.title}`;
    hud.prompt(`${how} ${verb}`, Math.min(1, game.hold / dur));
    if (done) {
      game.hold = 0;
      game.holdLock = true;
      if (c.scene) playScene(c.scene, () => story.markFound(c.id));
      else openDoc(c);
    }
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
    if (!queueStory('dusk')) hud.toast('해가 진다… 가로등 불빛 가까이 머물자.', 'warn');
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
    if (!game.peaceful) queueStory('dawn');
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
  if (flushStory()) return;
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
const fpsMeter = { frames: 0, since: 0 };
function frame(now) {
  requestAnimationFrame(frame);
  // rAF 타임스탬프가 직전 performance.now()보다 앞설 수 있어 음수 dt를 막는다.
  const raw = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  checkResize();

  const w = input.takeWheel();
  if (w && game.state === 'play') {
    game.zoomTarget = Math.min(ZOOM.max, Math.max(ZOOM.min, game.zoomTarget + w * 1.2));
    settings.zoom = game.zoomTarget;
    saveSettings(settings);
  }
  // 장면·읽기 화면의 키는 dialogue가 먼저 받는다.
  if (!dialogue.busy && (input.consume('Escape') || input.consume('KeyP'))) {
    if (settingsFrom) closeSettings();
    else if (journalFrom) closeJournal();
    else if (game.state === 'play') pauseGame(true);
    else if (game.state === 'pause') pauseGame(false);
  }
  if (input.consume('KeyM')) {
    const muted = toggleMute();
    if (game.state === 'play') hud.toast(muted ? '소리를 껐다.' : '소리를 켰다.');
  }
  if (settings.fps) {
    fpsMeter.frames++;
    if (now - fpsMeter.since >= 500) {
      hud.setFps((fpsMeter.frames * 1000) / (now - fpsMeter.since));
      fpsMeter.frames = 0;
      fpsMeter.since = now;
    }
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
  } else if (game.state === 'story') {
    // 이야기 장면: 시간·그늘이·플레이어는 멈추고, 비·불빛·등대와 카메라만 움직인다.
    dt = raw;
    dialogue.update(raw);
    if (storyCam.on) camGoal.set(storyCam.x, 0, storyCam.z);
    else camGoal.copy(player.pos);
    camFocus.lerp(camGoal, 1 - Math.exp(-raw * 2.4));
    const boost = (storyCam.zoom ?? game.zoomTarget) - game.zoomTarget;
    game.zoomBoost += (boost - game.zoomBoost) * (1 - Math.exp(-raw * 2));
  } else if (game.state === 'title') {
    dt = raw;
    game.time += dt;
    env.setHour(env.hour + dt * 0.9);
    const t = game.time;
    camFocus.set(Math.sin(t * 0.05) * 22, 0, Math.cos(t * 0.037) * 18 - 4);
  }
  game.clock += dt;
  game.shake = Math.max(0, game.shake - raw * 1.6);

  updateCamera(raw);
  env.update(dt, camFocus, pxPerUnit);
  world.update(dt, game.clock, env.night, camFocus, pxPerUnit);
  story.update(dt, game.clock, env.night, pxPerUnit);
  world.setWetness(env.rainLevel);
  if (game.state !== 'title') {
    sound.setMix({ rain: env.rainLevel, night: env.night, dread: game.state === 'play' ? game.dread ?? 0 : 0 });
  }
  // 일시정지 중에는 공회전, 그 밖(타이틀·종료 화면)에는 엔진을 끈다.
  const engineOn = game.driving && car.running && (game.state === 'play' || game.state === 'pause');
  sound.setEngine(game.state === 'play' && engineOn ? {
    on: true, rpm: Math.min(1, Math.abs(car.speed) / MAX_FWD), load: car.throttle, skid: Math.min(1, Math.max(0, car.slip - 2) / 4),
  } : { on: engineOn });

  // 흔들림·점멸을 끄면 체력 경고는 깜박이지 않는 붉은 테두리로, 피격 번쩍임은 절반으로 줄인다.
  const lowHp = player.hp < 30 && game.state === 'play' ? 0.25 + (settings.shake ? 0.15 * Math.sin(game.time * 5) : 0) : 0;
  // 화질을 바꿔 셰이더를 다시 컴파일하는 동안에는 숨긴 물체까지 켜져 있으니 그리지 않고 직전 화면을 둔다.
  if (!(game.warming && game.ready)) {
    post.render(scene, camera, env.look, game.clock, {
      focus: 0.5, band: 0.07, blurScale: settings.tilt ? (game.state === 'title' ? 1.25 : 1.0) : 0,
      hurt: Math.max(player.hurtFx * (settings.shake ? 0.9 : 0.45), lowHp),
    });
  }

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
    const note = game.state === 'play' && dialogue.ok ? story.target(player.pos.x, player.pos.z) : null;
    if (note) {
      tmp.set(note.spot.x, note.spot.top, note.spot.z).project(camera);
      const off = Math.abs(tmp.x) > 0.9 || Math.abs(tmp.y) > 0.9;
      hud.storyPointer((tmp.x * 0.5 + 0.5) * innerWidth, (-tmp.y * 0.5 + 0.5) * innerHeight, note.dist, off);
    } else {
      hud.storyPointer(0, 0, 0, false);
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
$('mute-btn').addEventListener('click', toggleMute);
hud.setMuted(sound.muted);
$('settings-btn')?.addEventListener('click', openSettings);
$('journal-btn')?.addEventListener('click', openJournal);
$('pause-journal-btn')?.addEventListener('click', openJournal);
$('journal-close')?.addEventListener('click', closeJournal);
$('pause-settings-btn')?.addEventListener('click', openSettings);
$('settings-close')?.addEventListener('click', closeSettings);
if ($('settings')) {
  settingsUi = bindSettings($('settings'), settings, applySetting);
  recordsUi = initRecordsPanel({ totalZones: world.totalZones, onChange: renderBest, mobile });
}
pwaUi = initPwa({ onAskInstall: openSettings });
for (const key of ['lefty', 'fps', 'shake']) applySetting(key);
addEventListener('blur', () => pauseGame(true));
document.addEventListener('visibilitychange', () => document.hidden && pauseGame(true));

// ?debug: 콘솔에서 상태를 들여다보고 시뮬레이션을 고정 간격으로 돌려 보는 개발용 핸들
if (params.has('debug')) {
  window.lumen = {
    THREE, scene, camera, renderer, world, env, post, player, shades, car, game, input, hud, startGame,
    story, dialogue, storyQueue, playScene, openDoc, queueStory,
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
  if (lost) closeSettings();
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
// 화질 설정으로 그림자를 켜고 끌 때도 다시 부른다. 겹쳐 돌면 숨김 목록이 꼬이므로 차례로 돈다.
let warmChain = Promise.resolve();
function warmUp() {
  warmChain = warmChain.then(warmUpOnce);
  return warmChain;
}

async function warmUpOnce() {
  updateCamera(0);
  const first = !game.ready;
  const hidden = [];
  game.warming = true;
  scene.traverse((o) => {
    if (!o.visible) {
      hidden.push(o);
      o.visible = true;
    }
  });
  try {
    // 프로그램 변형(출력 색공간·톤매핑)은 현재 렌더 타깃으로 정해지므로, 실제로 그리는 HDR 타깃 기준으로 컴파일한다.
    renderer.setRenderTarget(post.rtScene);
    const compile = renderer.compileAsync(scene, camera);
    // 설정 변경 때는 컴파일이 끝날 때까지 화면을 멈춰 두므로, 드라이버가 응답하지 않아도 8초 뒤에는 다시 그린다.
    await (first ? compile : Promise.race([compile, new Promise((resolve) => setTimeout(resolve, 8000))]));
    renderer.setRenderTarget(null);
    // 처음 한 번은 후처리 패스까지 그려 GPU 자원을 올린다. 설정 변경 때는 숨긴 물체가 화면에 비치지 않게 생략한다.
    if (first) post.render(scene, camera, env.look, 0, { focus: 0.5, band: 0.07, blurScale: 1, hurt: 0 });
  } catch (err) {
    console.error('[warmup] 셰이더 사전 컴파일에 실패했습니다. 첫 등장 때 끊김이 있을 수 있습니다.', err);
  } finally {
    for (const o of hidden) o.visible = false;
    game.warming = false;
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
  if (params.get('start') === '1') startGame();
});
