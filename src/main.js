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
import { Wardrobe, OutfitDrops, Closet, itemLabel, objParticle } from './wardrobe.js';
import { Switchboard } from './grid.js';
import { Wisps } from './wisps.js';
import { Caches } from './caches.js';
import { Online, NOTES, KIND_NAMES, RUN_TAKE_LIMIT, BATTERY_PACK, BATTERY_PACK_MIN, MAX_MINE, PLACE_RADIUS, CACHE_REACH } from './online.js';
import { Story, DOCS, sceneById, chapterOf } from './story.js';
import { Dialogue } from './dialogue.js';
import { SCENES, FINALE } from './script.js';
import { Chapters } from './chapters.js';
import { Minimap } from './minimap.js';
import { captureRun, writeRun, readRun, clearRun, restoreWorld, describeRun, RUN_KEY } from './runsave.js';

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

// 오류 화면이 떠 있는 동안은 판을 멈춘다(화면이 가려진 채로 그늘이에게 공격받지 않게, #14).
let halted = false;
let booted = false; // 시작 준비가 끝났는지(그 뒤의 오류는 일시적일 수 있어 '계속하기'를 준다)

function showFatal(message, err, { canContinue = false } = {}) {
  console.error(err);
  halted = true;
  // 배포 직후 캐시된 옛 index.html과 섞일 수 있어, 새로 추가된 요소는 없을 수도 있다고 보고 다룬다.
  const errTitle = $('error-title');
  if (errTitle) errTitle.textContent = canContinue ? '문제가 생겼어요' : '실행할 수 없어요';
  $('error-text').textContent = message;
  $('error-continue')?.classList.toggle('hidden', !canContinue);
  $('error').classList.remove('hidden');
  $('title').classList.add('hidden');
}

addEventListener('error', (e) => showFatal(`게임 실행 중 오류가 발생했습니다: ${e.message}`, e.error, { canContinue: booted }));
addEventListener('unhandledrejection', (e) => showFatal(`게임 실행 중 오류가 발생했습니다: ${e.reason}`, e.reason, { canContinue: booted }));

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
const wisps = new Wisps(scene);
const input = new Input(renderer.domElement);
const hud = new Hud();
const sound = new Sound();
sound.setVolume(settings.volume, settings.ambience);
const story = new Story(scene, world);
const dialogue = new Dialogue({ sound });
// 2~4장 무대와 진행. 장 안에서는 ground가 그 무대(섬·강 건너 학교)이고, 1장 판에서는 마을(world)이다.
const chapters = new Chapters(scene, world, story);
let ground = world;
// 구석 미니맵과 눌러서 펼치는 전체 지도(시간은 멈추지 않는다)
const minimap = new Minimap({
  mini: $('minimap'), panel: $('map'), full: $('map-canvas'), title: $('map-title'), legend: $('map-legend'), close: $('map-close'),
}, { world, story, chapters, player, car });

const wardrobe = new Wardrobe();
player.setOutfit(wardrobe.wear);
const drops = new OutfitDrops(scene);
const closet = new Closet(wardrobe, () => player.setOutfit(wardrobe.wear));

const online = new Online(params);
const caches = new Caches(scene, world);

const START = new THREE.Vector3(0, 0, 3.2);
player.reset(START.x, START.z);
car.reset(CAR_SPAWN.x, CAR_SPAWN.z, CAR_SPAWN.a);

const EMPTY_LINES = ['빈 서랍이다.', '오래된 영수증뿐이다.', '누군가 먼저 다녀갔다.', '쓸 만한 건 없다.', '젖은 신문만 남았다.', '라디오는 대답하지 않았다.'];

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
  hintLamp: false,
  hintLoad: false,
  returned: 0, // 이번 판에 집으로 돌려보낸 그림자 수(깨어남 단서 주기)
  hintTold: false,
  clock: 0, // 화면 연출용 시계. 이야기 장면 중에도 흐른다(게임 시간 game.time은 멈춘다).
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
  savedAt: 0, // 판을 마지막으로 저장한 게임 시간(game.time)
  chapter: 0, // 2~4장을 하는 중이면 그 장 번호(1장 판이면 0)
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
const SCREENS = ['title', 'pause', 'end', 'settings', 'closet', 'journal', 'grid'];
function setScreen(id) {
  if (id !== 'settings') settingsFrom = null;
  if (id !== 'journal') journalFrom = null;
  for (const s of SCREENS) $(s)?.classList.toggle('hidden', s !== id);
}

// 옷장: 처음 화면에서 주인공을 은신처 앞에 세워 놓고 가까이서 돌려 보며 갈아입힌다.
function openCloset() {
  if (!game.ready || game.contextLost || game.state !== 'title') return;
  game.state = 'closet';
  game.titleHour = env.hour;
  env.setHour(12); // 색이 왜곡되지 않는 한낮 빛에서 고른다
  env.rainLevel = 0;
  player.reset(START.x, START.z);
  player.pos.y = world.heightAt(START.x, START.z);
  closet.open();
  setScreen('closet');
}

function closeCloset() {
  if (game.state !== 'closet') return;
  game.state = 'title';
  env.setHour(game.titleHour);
  setScreen('title');
}

const WEAR_VERB = { coat: '입어', hat: '써', glasses: '써', pack: '메' };

function foundOutfit(item) {
  wardrobe.unlock(item.id);
  wardrobe.put(item.id);
  player.setOutfit(wardrobe.wear);
  sound.play('pickup');
  const label = itemLabel(item);
  hud.toast(`${label}${objParticle(label)} 주웠다! 바로 ${WEAR_VERB[item.slot]} 봤다. 처음 화면 '옷장'에서 언제든 바꿀 수 있다.`, 'good');
}

// 새 판·이어하기·2~4장이 함께 쓰는 준비: 그늘이·타이머·이야기·온라인 상태와 화면을 판 시작 상태로 돌린다.
// 마을·플레이어·트럭·시간은 부르는 쪽이 정한다. chapter면 온라인 보급품을 받지 않는다(장 무대에는 보급품 자리가 없다).
function beginRun({ chapter = false } = {}) {
  sound.init();
  shades.clear();
  shades.banished = 0;
  // 지난 판의 날아가던 빛과 촛불 단서를 치운다(뒤질 곳 내용이 바뀌므로 남으면 엉뚱한 자리를 가리킨다).
  // 이어하기는 저장된 촛불을 이 뒤에 다시 켠다.
  wisps.clear();
  timers.length = 0;
  storyQueue.length = 0;
  storyCam.on = false;
  storyCam.zoom = null;
  dialogue.reset();
  story.resetRun();
  Object.assign(game, {
    state: 'play', nights: 0, hold: 0, holdKey: null, peaceful: false, won: false, shake: 0, hintFlash: false,
    driving: false, holdLock: false, zoomBoost: 0, hintLoad: false, returned: 0, hintTold: false,
    run: game.run + 1, startedAt: game.time, onlineLive: false, onlinePaused: false, cacheTaken: 0, cacheBusy: false,
    savedAt: game.time, chapter: 0, otherTab: false, pendingTake: null,
  });
  if (!chapter) {
    chapters.end();
    ground = world;
    hud.setChapter(null);
  }
  closePlace();
  caches.clear();
  hud.setOnline(false);
  if (!chapter && online.enabled && hud.hasOnlineUi) bg(loadCaches(game.run));
  hud.setDriving(false);
  setScreen(null);
  hud.clearToasts();
  hud.show(true);
  hud.showTouch(mobile || input.usingTouch);
  $('key-hints').classList.toggle('hidden', mobile);
}

function startGame() {
  if (game.contextLost || !game.ready) return;
  world.reset((Math.random() * 1e9) | 0);
  player.reset(START.x, START.z);
  car.reset(CAR_SPAWN.x, CAR_SPAWN.z, CAR_SPAWN.a);
  const h = Number(params.get('hour'));
  env.setHour(Number.isFinite(h) && params.has('hour') ? h : 7.5);
  env.day = 1;
  env.rainyNight = true;
  env.rainLevel = 0;
  beginRun();
  camFocus.copy(player.pos);
  // 지난 판의 저장을 바로 이 판으로 덮는다. 첫 자동 저장 전에 탭이 죽어도 지난 판이 되살아나지 않게.
  saveRun();
  // 처음 하는 사람은 도착 장면이 같은 내용을 들려준다.
  if (!queueStory('start')) hud.toast('정전된 골짜기. 은신처의 불 하나가 길을 지킨다.');
  later(1.8, () => hud.toast('퓨즈를 모아 배전함을 고치자. 복구한 구역에 불을 보낼 수 있다.'));
  later(3.8, () => hud.toast('화살표가 가까운 배전함을 가리킨다. 비상함에서 찾은 퓨즈 하나가 있다.'));
  later(6.4, () => !game.driving && hud.toast('은신처 앞에 낡은 트럭이 남아 있다. 연료가 있으면 운전할 수 있다.'));
  // 아직 옷가지를 하나도 줍지 않았을 때만 존재를 알려 준다.
  if (drops.spawn(world, wardrobe, START) && wardrobe.foundCount === 0) {
    later(9.5, () => hud.toast('누군가 남긴 옷가지 꾸러미가 빛난다. 주운 옷은 옷장에 남는다.'));
  }
  flushStory();
}

// 처음 화면의 '새로 시작'. 이어할 수 있는 판이 있으면 지워도 되는지 먼저 묻는다.
// 브라우저 confirm()은 닫힐 때 늦게 오는 blur가 막 시작한 판을 일시정지시켜서, 처음 화면 안에서 묻는다.
// 두 번째 자리에 '취소'를 두어, '새로 시작'을 두 번 연달아 눌러도 판이 지워지지 않게 한다.
function newGame() {
  if (game.contextLost || !game.ready) return;
  const r = readRun(world);
  // 더 새 버전이 쓴 저장도 새 판이 덮어쓰므로 함께 묻는다.
  const lose = r.status === 'ok' ? `진행 중인 판(${describeRun(r.run, world.totalZones)})이 지워져요.`
    : r.status === 'newer' ? '더 새 버전에서 저장한 판이 지워져요.' : null;
  if (!lose || !$('new-confirm')) {
    startGame();
    return;
  }
  $('title-actions').classList.add('hidden');
  $('new-confirm').classList.remove('hidden');
  $('run-info').textContent = lose;
  $('new-no').focus();
}

function cancelNewGame() {
  renderRun();
  $('start-btn').focus();
}

// ---------------------------------------------------------------- 판 저장(이어하기)
// 형식·저장 시점은 DECISIONS.md "판 중간 저장". 탭이 가려질 때·닫힐 때·일시정지, 구역 복구·해질녘·새벽,
// 플레이 중 15초마다 저장한다. 승리·패배하면 지운다.

const SAVE_EVERY = 15; // 게임 시간(초)
const RUN_STATES = new Set(['play', 'pause', 'story', 'grid']);

// 같은 판을 두 탭에서 하면 나중에 저장한 탭이 다른 탭의 진행을 덮는다(#14). 다른 탭이 판 저장을 바꾸면
// 이 탭은 저장을 멈추고 알린다(이 탭에서 새 판을 시작하거나 이어하기를 다시 누르면 풀린다).
addEventListener('storage', (e) => {
  if (e.key !== RUN_KEY || e.storageArea !== localStorage) return;
  if (game.state === 'title') {
    renderRun();
    return;
  }
  if (game.otherTab || game.chapter || !RUN_STATES.has(game.state)) return;
  game.otherTab = true;
  hud.toast('다른 탭에서 이 판을 하고 있다. 이 탭의 진행은 이제 저장하지 않는다.', 'warn');
});

function saveRun() {
  // 끝난 판, 승리 뒤 산책, 처음 화면·옷장에서는 저장하지 않는다. 2~4장은 진행을 lumen.chapters·lumen.story에 바로 남기고
  // 1장 판 저장(이어하기)은 건드리지 않는다.
  if (game.chapter || !RUN_STATES.has(game.state) || game.won || game.peaceful || !player.alive || game.otherTab) return;
  game.savedAt = game.time;
  let data;
  // 남기기 요청이 오가는 중이면 가방은 요청 전 그대로 저장한다. 그 사이 탭이 죽어도 물건을 잃지 않는다
  // (서버에 남았다면 하나를 더 가진 쪽으로 어긋난다 — 잃는 쪽보다 낫다, #14).
  const inFlight = game.placing?.busy ? game.placing.kind : null;
  try {
    if (inFlight) reserve(inFlight, +1);
    data = captureRun({ world, player, car, env, game, shades });
  } catch (err) {
    // 저장 형식이 게임 상태를 따라가지 못한 버그다. 판은 계속하되, 고칠 수 있게 기록을 남긴다.
    console.error('[run] 판을 저장하지 못했습니다.', err);
    return;
  } finally {
    if (inFlight) reserve(inFlight, -1);
  }
  writeRun(data);
}

// 처음 화면의 '이어하기'
function resumeGame() {
  if (game.contextLost || !game.ready) return;
  const r = readRun(world);
  if (r.status !== 'ok') {
    renderRun();
    return;
  }
  const { player: p, car: c, env: e, run } = r.run;
  restoreWorld(world, r.run);
  player.reset(p.x, p.z);
  Object.assign(player, { hp: p.hp, battery: p.battery, fuses: p.fuses, bandages: p.bandages, cans: p.cans });
  world.collide(player.pos, PLAYER_R);
  player.pos.y = world.heightAt(player.pos.x, player.pos.z);
  player.facing = p.facing;
  player.model.rotation.y = p.facing;
  car.reset(c.x, c.z, c.a, c.fuel);
  car.lamp = c.lamp && c.fuel > 0;
  world.setTruckLamp(car.pos.x, car.pos.z, car.lamp);
  world.truckLamp.load = c.lampLoad;
  world.truckLamp.level = car.lamp ? 1 : 0;
  env.setHour(e.hour);
  env.day = e.day;
  env.rainyNight = e.rainyNight;
  env.rainLevel = e.rain;
  beginRun();
  game.nights = run.nights;
  game.returned = run.returned;
  game.cacheTaken = run.cacheTaken;
  if (run.pendingTake) bg(settleTake(run.pendingTake, game.run));
  // 저장된 촛불 단서(알려 준 퓨즈 자리)를 다시 켠다. beginRun이 지난 촛불을 치운 뒤라야 한다.
  for (const l of world.loot) if (l.hinted) wisps.candle(l, world.heightAt(l.x, l.z));
  shades.banished = run.banished;
  for (const key of run.hints) game[key] = true;
  if (c.driving) seatInCar();
  else player.flashOn = p.flash && player.battery > 0;
  camFocus.copy(player.pos);
  hud.toast(`지난 판을 이어 간다 · ${env.day}일째, 복구한 구역 ${world.poweredZones}/${world.totalZones}`, 'good');
  // 첫 판의 도착 무전 도중에 탭이 닫혔다면 처음부터 다시 튼다. 장면은 끝까지 봐야 본 것으로 남고
  // 그때 첫 기록이 열리는데, 도착 무전은 새 판을 시작할 때만 줄을 서기 때문이다.
  queueStory('start');
  if (world.poweredZones === world.totalZones) {
    // 마지막 배전함을 고친 직후, 엔딩이 나오기 전에 저장된 판이다.
    world.restoreAll();
    later(1.2, winGame);
  } else if (world.poweredZones > 1) {
    // 구역을 켠 뒤 무전이 오기 전에 탭이 닫혔다면 그 무전을 이어서 튼다(이미 본 장면은 다시 나오지 않는다).
    later(1.2, () => queueStory({ zones: world.poweredZones }));
  }
  drops.spawn(world, wardrobe, player.pos);
  flushStory();
}

// 처음 화면: 이어할 판이 있으면 '이어하기'와 요약을, 이어갈 수 없는 저장이면 그 이유를 보여 준다.
function renderRun() {
  const btn = $('resume-run-btn');
  const info = $('run-info');
  if (!btn || !info) return; // 배포 직후 캐시된 옛 index.html과 섞인 경우
  const r = readRun(world);
  const ok = r.status === 'ok';
  $('title-actions')?.classList.remove('hidden');
  $('new-confirm')?.classList.add('hidden');
  btn.classList.toggle('hidden', !ok);
  $('start-btn').classList.toggle('ghost', ok);
  if (game.ready) $('start-btn').textContent = ok ? '새로 시작' : '시작하기';
  if (ok) info.textContent = describeRun(r.run, world.totalZones);
  else if (r.status === 'layout') info.textContent = '게임이 업데이트되어 마을이 바뀌었어요. 지난 판은 이어 갈 수 없어요.';
  else if (r.status === 'newer') info.textContent = '더 새 버전에서 저장한 판이 있어요. 새로고침하면 이어 갈 수 있어요.';
  else info.textContent = '';
}

// 배전반: 플레이 중에만 열고, 여는 동안은 일시정지처럼 시간이 멈춘다.
let board = null;
function openGrid() {
  if (game.state !== 'play' || !board || game.chapter) return;
  // 보급품 남기기 창은 일시정지 때처럼 닫는다(보내는 중이면 그대로 둔다).
  if (game.placing && !game.placing.busy) closePlace();
  game.state = 'grid';
  board.open(world.zoneAt(player.pos.x, player.pos.z));
  $('grid-live')?.classList.toggle('hidden', !gridLive());
  setScreen('grid');
  $('grid-title')?.focus();
}

function closeGrid() {
  if (game.state !== 'grid') return;
  game.state = 'play';
  setScreen(null);
  saveRun(); // 바꾼 스위치를 남긴다
  // 배전반을 연 사이에 그래픽 컨텍스트를 잃었다면 진행하지 않고 일시정지로 둔다.
  if (game.contextLost) pauseGame(true);
}

// 밤(해질녘부터)에는 배전반을 여는 동안에도 시간이 흐른다. 위기 중에 열어 숨을 고르는 일시정지가 되지 않게(#21).
function gridLive() {
  return env.night > 0.3;
}

function pauseGame(on) {
  if (on && game.state === 'play') {
    if (game.placing && !game.placing.busy) closePlace();
    game.state = 'pause';
    hud.renderLog($('pause-log'));
    setScreen('pause');
    saveRun();
  } else if (!on && game.state === 'pause' && !game.contextLost) {
    game.state = 'play';
    setScreen(null);
  }
}

// 끝 화면의 단추: 1장 승리(산책·다음 장), 1장·2~4장 패배(다시 하기), 이야기 끝(수첩·처음 화면)
function endButtons({ walk = false, retry = true, next = false, journal = false } = {}) {
  $('continue-btn').classList.toggle('hidden', !walk);
  $('restart-btn').classList.toggle('hidden', !retry);
  $('next-chapter-btn')?.classList.toggle('hidden', !next);
  $('end-journal-btn')?.classList.toggle('hidden', !journal);
  $('title-btn').textContent = journal ? '처음 화면' : '처음 화면으로';
  const info = next ? chapters.nextInfo() : null;
  if (info && $('next-chapter-btn')) $('next-chapter-btn').textContent = `다음 장 · ${info.ch}장 ${info.title}`;
}

function endGame(won) {
  game.won = won;
  game.state = 'end';
  const prevBest = loadBest(world.totalZones);
  saveBest();
  clearRun(); // 끝난 판은 이어 갈 수 없다
  hud.prompt(null);
  if (game.placing && !game.placing.busy) closePlace();
  const zones = `${world.poweredZones}/${world.totalZones}`;
  // 그늘이가 사람들의 그림자라는 걸 들은 뒤에는 '쫓아낸' 대신 '돌려보낸'이라고 적는다.
  const sent = story.isSeen('return') ? '집으로 돌려보낸 그늘이' : '쫓아낸 그늘이';
  if (won) {
    sound.play('win');
    $('end-title').textContent = '첫 불이 돌아왔다';
    $('end-text').textContent = `${env.day}일째, 아홉 구역을 잇고 첫 불을 밝혔다. 버틴 밤 ${game.nights}번 · ${sent} ${shades.banished}.`;
    endButtons({ walk: true, next: dialogue.ok && !!chapters.nextInfo() });
  } else {
    $('end-title').textContent = '어둠에 삼켜졌다';
    $('end-text').textContent = `버틴 밤 ${game.nights}번 · 복구한 구역 ${zones} · ${sent} ${shades.banished}.`;
    endButtons();
  }
  const best = $('end-best');
  if (best) best.textContent = bestLine(prevBest);
  setScreen('end');
}

// 끝 화면의 기록 비교: 이번 판이 지난 최고 기록을 넘었으면 무엇을 넘었는지, 아니면 지금 최고 기록(#14)
function bestLine(prev) {
  const news = [];
  if (game.won && (!prev.winDay || env.day < prev.winDay)) news.push(prev.winDay ? `가장 빠른 복구(전에는 ${prev.winDay}일)` : '처음으로 마을을 되살렸다');
  if (game.nights > prev.nights) news.push(`가장 오래 버틴 밤(전에는 ${prev.nights}번)`);
  if (world.poweredZones > prev.zones) news.push(`가장 많이 밝힌 구역(전에는 ${prev.zones}곳)`);
  if (news.length) return `신기록 — ${news.join(' · ')}`;
  return hasRecords(prev) ? `최고 기록 · ${describeBest(prev, world.totalZones)}` : '';
}

function continueWalk() {
  game.state = 'play';
  game.peaceful = true;
  env.setHour(Math.max(env.hour, 19.4) % 24);
  setScreen(null);
  hud.toast('고요해진 마을을 천천히 걸어 보자.', 'good');
}

function backToTitle() {
  // 일시정지에서 나가면 판을 남겨 두어 처음 화면의 '이어하기'로 돌아온다(끝 화면에서 나가면 저장은 이미 지워졌다).
  // 2~4장은 진행이 이미 남아 있어 처음 화면의 장 단추로 같은 차례에서 이어 간다.
  saveRun();
  if (game.chapter) {
    game.chapter = 0;
    chapters.end();
    ground = world;
    hud.setChapter(null);
    story.resetRun();
    player.reset(START.x, START.z);
  }
  if (game.driving) leaveCar();
  car.lamp = false;
  world.setTruckLamp(car.pos.x, car.pos.z, false);
  wisps.clear();
  storyQueue.length = 0;
  dialogue.reset();
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
  drops.clear();
  renderBest();
  renderRun();
  renderChapter();
  renderOnline();
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
  // 보급품 남기기 창은 일시정지 때처럼 닫는다(보내는 중이면 그대로 둔다).
  if (game.placing && !game.placing.busy) closePlace();
  game.state = 'story';
  game.hold = 0;
  hud.prompt(null);
  hud.show(false);
  hud.showTouch(false);
}

function leaveStory() {
  // 장면 중에 판이 끝났으면(끝 화면) 그대로 둔다.
  if (game.state === 'story') game.state = 'play';
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
  // 장면 중에 그래픽 컨텍스트를 잃었으면 setContextLost의 일시정지가 'story' 상태라 걸리지 않았다.
  // 복구된 뒤 플레이어가 직접 이어서 하도록 여기서 일시정지한다.
  if (game.contextLost) pauseGame(true);
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
      if (id === 'arrival') later(1.2, () => hud.toast('푸른 빛기둥과 화살표가 아직 읽지 않은 기록을 가리킨다.', 'story'));
      if (chapterOf(sc) > 1) chapters.after(id);
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
  const at = cam.at && cam.at !== 'player' ? story.anchor(cam.at) ?? chapters.anchor(cam.at) : null;
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

// 수첩에 처음 적은 기록을 알린다. 그 장까지의 기록 가운데 몇 개를 주웠는지 센다.
function noteFound(clue) {
  const ch = chapterOf(clue);
  sound.play('pickup');
  hud.toast(`수첩에 적었다 (${story.foundDocs(ch)}/${DOCS.filter((c) => chapterOf(c) <= ch).length})`, 'story');
  if (story.foundDocs(4) === 1) later(1.4, () => hud.toast('읽은 기록과 무전은 일시정지 → 수첩에서 다시 볼 수 있다.'));
}

// 남은 기록을 읽는다. 처음 읽으면 수첩에 남는다.
function openDoc(clue) {
  const first = !story.isFound(clue.id);
  enterStory();
  dialogue.showDoc(clue, {
    first,
    flipped: clue.flip ? chapters.flag('flip') : false,
    onClose: () => {
      leaveStory();
      if (first && story.markFound(clue.id)) noteFound(clue);
      if (chapterOf(clue) > 1) chapters.docClosed();
    },
  });
}

// 3장: 이송 명부와 소지품 봉투의 17번을 맞춰 본다. 닫으면 두 기록 모두 수첩에 남는다.
function openCompare(a, b, onFlip) {
  enterStory();
  dialogue.showCompare(a, b, {
    onFlip,
    onClose: () => {
      leaveStory();
      for (const c of [a, b]) if (story.markFound(c.id)) noteFound(c);
      chapters.docClosed();
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

let journalFrom = null; // 수첩을 연 곳('title' | 'pause' | 'end')

function openJournal() {
  if (!$('journal') || !dialogue.ok || journalFrom || settingsFrom || !['title', 'pause', 'end'].includes(game.state)) return;
  journalFrom = game.state;
  renderJournal();
  setScreen('journal');
  $('journal-title')?.focus();
}

// 수첩은 다다른 장까지만 보여 준다(뒤 장의 기록이 '???'로라도 미리 드러나지 않게).
function reachedChapter() {
  if (chapters.done) return 4;
  return Math.max(1, game.chapter, chapters.nextInfo()?.ch ?? 1);
}

function renderJournal() {
  dialogue.renderJournal({
    story, scenes: SCENES, docs: DOCS, upTo: reachedChapter(), canReset: journalFrom === 'title',
    onRead: (item) => dialogue.showDoc(item, {
      flipped: item.flip ? chapters.flag('flip') : false,
      onClose: () => $('journal-close')?.focus({ preventScroll: true }),
    }),
    onReset: () => {
      story.wipe();
      chapters.wipe();
      renderJournal();
      renderChapter();
    },
  });
}

function closeJournal() {
  if (!journalFrom) return;
  const back = journalFrom;
  journalFrom = null;
  setScreen(back);
  ({ pause: $('pause-journal-btn'), end: $('end-journal-btn') }[back] ?? $('journal-btn'))?.focus({ preventScroll: true });
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

// 저사양 기기 화질 자동 조정(#1·#10): 플레이 중 6초 평균이 40fps 아래로 두 번 이어지면 화질을 한 단계 낮춘다.
// 올리지는 않는다(오르내림 반복을 막고, 높이는 건 사용자가 고른다). 셰이더를 다시 컴파일하는 동안·탭이 가려진 동안은 재지 않는다.
// ?debug에서는 끈다: 시험이 lumen.step()으로 메인 스레드를 오래 붙잡으면 실제 화면 갱신이 멈춰 느린 기기로 보인다.
const autoQ = { frames: 0, since: 0, slow: 0, off: params.has('debug') };
function watchQuality(now) {
  if (autoQ.off || game.state !== 'play' || game.warming || document.hidden) {
    autoQ.frames = 0;
    autoQ.since = now;
    return;
  }
  autoQ.frames++;
  const span = now - autoQ.since;
  if (span < 6000) return;
  const fps = (autoQ.frames * 1000) / span;
  autoQ.frames = 0;
  autoQ.since = now;
  autoQ.slow = fps < 40 ? autoQ.slow + 1 : 0;
  if (autoQ.slow < 2) return;
  autoQ.slow = 0;
  const next = settings.quality === 'high' ? 'mid' : settings.quality === 'mid' ? 'low' : null;
  if (!next) {
    autoQ.off = true;
    return;
  }
  settings.quality = next;
  saveSettings(settings);
  applyQuality();
  hud.toast(`화면이 느려 화질을 '${next === 'mid' ? '보통' : '낮음'}'으로 낮췄다. 설정에서 바꿀 수 있다.`);
}

function applySetting(key) {
  switch (key) {
    case 'volume':
    case 'ambience':
      sound.setVolume(settings.volume, settings.ambience);
      break;
    case 'quality':
      autoQ.off = true; // 손으로 고른 화질은 이번 실행 동안 자동으로 바꾸지 않는다
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
  if (loot.hinted) wisps.clearCandle(loot);
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
  const capBefore = world.capacity;
  player.fuses--;
  const res = world.powerZone(box.zone);
  sound.play('power');
  if (world.poweredZones === world.totalZones) {
    world.restoreAll();
    hud.toast('마지막 배전함을 고쳤다! 변전소가 출력을 되찾고 아홉 구역이 이어진다.', 'good');
    // 불이 들어오는 걸 잠깐 보여 준 뒤 할머니의 무전(엔딩)이 온다.
    later(2.2, winGame);
    saveRun(); // 엔딩 전에 탭이 닫혀도 이어하면 엔딩부터 나온다
    return;
  }
  const where = `배전반(${input.usingTouch || mobile ? '위쪽 전력 버튼' : 'Tab'})`;
  if (res?.on) {
    hud.toast(`${zone.name}의 배전함을 고쳤다! (${world.poweredZones}/${world.totalZones})`, 'good');
    if (env.night < 0.3) later(1.5, () => hud.toast('불이 켜진 가로등은 밤에 그늘이를 막아 준다.'));
  } else {
    hud.toast(`${zone.name} 배전함을 고쳤다. 변전소 출력이 모자라 꺼 두었다.`, 'warn');
    later(1.5, () => hud.toast(`${where}에서 오늘 밤 켤 구역을 고르자.`));
  }
  if (world.capacity > capBefore) later(3.0, () => hud.toast(`변전소 출력이 올랐다. 이제 ${world.capacity}곳까지 함께 켤 수 있다.`, 'good'));
  later(2.4, () => queueStory({ zones: world.poweredZones }));
  saveRun();
}

// ---------------------------------------------------------------- 돌아가는 그림자
// 흩어진 그늘이는 잠든 주인에게 돌아간다(이야기 '돌아가는 그림자'). 빛이 가장 가까운 집으로 날아가 창가가 잠깐 밝아지고,
// 여섯을 돌려보낼 때마다 깨어난 누군가가 아직 숨은 퓨즈 자리에 촛불(금빛 기둥)을 켜 둔다. 밤에 맞서 싸운 보상이다.
const RETURNS_PER_HINT = 6;

// 집이 먼 곳(공원·농장 한가운데)에서는 빛이 마을을 가로질러 길게 날지 않고, 그 집 쪽으로 이만큼 날다 사라진다(#28).
const WISP_REACH = 28;

function sendHome(p) {
  game.returned++;
  const home = world.nearestHome(p.x, p.z);
  if (!home) return;
  const reveal = game.returned % RETURNS_PER_HINT === 0;
  const run = game.run;
  const dx = home.x - p.x;
  const dz = home.z - p.z;
  const d = Math.hypot(dx, dz);
  const near = d <= WISP_REACH;
  const to = near ? home : { x: p.x + (dx / d) * WISP_REACH * 0.8, y: 7, z: p.z + (dz / d) * WISP_REACH * 0.8 };
  wisps.spawn(p, to, () => {
    if (run !== game.run) return;
    if (near) wisps.flash(home);
    wisps.wake(home);
    if (reveal) revealFuse(home);
  });
}

function revealFuse(home) {
  const loot = world.hiddenFuseSpread(home.x, home.z);
  // 촛불 자리가 없으면 표시하지 않는다(알려 준 것으로 쳐 버리면 그 퓨즈가 다음 단서에서 영영 빠진다).
  if (!loot || !wisps.candle(loot, world.heightAt(loot.x, loot.z))) return;
  world.hintLoot(loot);
  sound.play('hint');
  hud.toast(game.hintTold
    ? '누군가 또 퓨즈 곁에 촛불을 남겼다.'
    : '깨어난 누군가가 퓨즈 곁에 촛불을 남겼다. 금빛 기둥을 찾아가 보자.', 'good');
  game.hintTold = true;
}

// 과부하로 차단기가 내려간 구역을 배전함(은신처는 발전기)에서 다시 올린다.
function resetBreaker(ref) {
  if (!world.resetBreaker(ref.zone)) return;
  sound.play('breaker');
  hud.toast(`${ref.zone === 'H' ? '은신처' : world.zones[ref.zone].name}에 다시 불이 들어왔다.`, 'good');
}

function onGridEvent(e) {
  if (e.type === 'trip') {
    sound.play('trip');
    game.shake = Math.max(game.shake, 0.25);
    const home = e.zone === 'H';
    hud.toast(`${home ? '은신처' : world.zones[e.zone].name} 차단기가 내려갔다! ${home ? '발전기' : '배전함'}에서 다시 올리자.`, 'warn');
  } else if (e.type === 'truckTrip') {
    car.lamp = false;
    sound.play('trip');
    hud.toast('작업등이 과부하로 꺼졌다! 트럭에 타서 다시 켜자.', 'warn');
  }
}

// 운전석에서 짐칸 작업등(발전기)을 켜고 끈다. 내린 뒤에도 연료가 있는 동안 켜져 있다.
function toggleTruckLamp() {
  const r = car.toggleLamp();
  if (r === 'on' || r === 'off') sound.play('lamp');
  if (r === 'on' && !game.hintLamp) {
    game.hintLamp = true;
    hud.toast('짐칸 작업등을 켰다. 세워 둔 트럭 둘레가 가로등 아래처럼 안전해진다. 대신 연료를 쓴다.', 'good');
  } else if (r === 'moving') {
    hud.toast('작업등은 트럭을 세운 뒤에 켤 수 있다.');
  } else if (r === 'nofuel') {
    hud.toast('연료가 없어 발전기를 돌릴 수 없다.', 'warn');
  }
}

function onCarEvent(ev) {
  if (ev.lampOut === 'fuel') hud.toast('연료가 바닥나 작업등이 꺼졌다.', 'warn');
  else if (ev.lampOut === 'moving' && env.night > 0.3) hud.toast('출발하면서 작업등을 껐다.');
}

// ---------------------------------------------------------------- 2~4장
// 진행 규칙과 무대는 src/chapters.js. 여기서는 판 준비, 한 프레임, 상호작용, 실패·결말 화면을 맡는다.

// 처음 화면·1장 승리 화면의 '다음 장', 실패 뒤 '다시 하기', 장이 넘어갈 때. 지금 차례의 자리에서 시작한다.
function startChapter() {
  if (game.contextLost || !game.ready || !dialogue.ok || !chapters.nextInfo()) {
    renderChapter();
    return;
  }
  if (game.driving) leaveCar();
  car.lamp = false;
  world.setTruckLamp(car.pos.x, car.pos.z, false);
  drops.clear();
  beginRun({ chapter: true });
  const plan = chapters.begin();
  game.chapter = plan.ch;
  ground = chapters.stage;
  // 첫 불은 1장 끝에 다시 켜졌다.
  story.setLighthouse(true);
  story.lightLevel = 1;
  player.reset(plan.x, plan.z);
  Object.assign(player, { fuses: 0, bandages: 2 });
  placePlayer(plan);
  env.setHour(plan.hour);
  env.day = 1;
  env.rainyNight = plan.rainy;
  env.rainLevel = 0;
  game.nights = 1;
  hud.setChapter({ label: chapters.label });
  hud.setObjective(chapters.objective);
  showCard(`${plan.ch}장 · ${plan.title}`);
  // 진행에 따라 바로 이어 틀 장면은 제목 카드가 걷힌 뒤에 튼다.
  if (plan.play.length) later(1.6, () => plan.play.forEach((id) => storyQueue.includes(id) || storyQueue.push(id)));
}

// 장의 정해진 자리에 플레이어를 세운다(장 시작, 배에서 내릴 때, 밤·아침으로 넘어갈 때).
function placePlayer(at) {
  player.pos.set(at.x, ground.heightAt(at.x, at.z), at.z);
  const a = at.a ?? at.facing;
  if (Number.isFinite(a)) {
    player.facing = a;
    player.model.rotation.y = a;
  }
  camFocus.copy(player.pos);
}

// 장 제목·시간 넘김을 알리는 카드. 화면을 잠깐 덮어 순간 이동을 가린다.
let cardTimer = 0;
function showCard(text) {
  const card = $('chapter-card');
  if (!card) return;
  $('chapter-card-text').textContent = text;
  card.classList.remove('hidden', 'out');
  clearTimeout(cardTimer);
  cardTimer = setTimeout(() => {
    card.classList.add('out');
    cardTimer = setTimeout(() => card.classList.add('hidden'), 900);
  }, 1500);
}

function chapterStep(dt) {
  const flashKey = input.consume('KeyF') || input.consume('Touch_flash');
  const flashClick = input.consume('MouseLeft');
  if (flashKey || flashClick) toggleFlash();
  if (input.consume('KeyQ') || input.consume('Touch_band')) useBandage();
  input.consume('KeyG');
  const scale = chapters.timeScale;
  if (scale > 0) {
    for (const ev of env.advance(dt * scale)) {
      if (ev === 'dusk') {
        env.rainyNight = Math.random() < 0.55;
        sound.play('dusk');
        if (!game.hintFlash) {
          game.hintFlash = true;
          later(1.6, () => hud.toast(`${mobile ? '손전등 버튼' : 'F 키나 마우스 클릭'}으로 손전등을 켜자. 오래 비추면 그늘이가 흩어진다.`));
        }
      } else if (ev === 'dawn') {
        game.nights++;
        sound.play('dawn');
        if (player.flashOn) player.flashOn = false;
      }
      const msg = chapters.onTime(ev);
      if (msg) hud.toast(msg[0], msg[1]);
    }
  }
  walk(dt);
  const lit = ground.lightAt(player.pos.x, player.pos.z);
  if (lit) player.battery = Math.min(100, player.battery + dt * 3.5);
  if (env.night < 0.3) player.hp = Math.min(100, player.hp + dt * 0.8);
  else if (lit) player.hp = Math.min(100, player.hp + dt * 1.2);
  if (player.flashOn && player.battery <= 0) {
    player.flashOn = false;
    hud.toast(chapters.canRecharge ? '손전등 전지가 다 됐다! 당직실 상자에 예비 전지가 있다.' : '손전등 전지가 다 됐다!', 'warn');
  }
  chapters.update(dt, player);
  const ev = shades.update(dt, game.time, {
    player, world: ground, night: env.night, nights: game.nights, spawning: chapters.spawning(env.night), cap: chapters.shadeCap, car: null, driving: false,
  });
  if (ev.hits) {
    sound.play('hurt');
    game.shake = 0.45;
  }
  if (ev.banished) sound.play('banish');
  for (const p of ev.returned) {
    if (chapters.onReturned(p)) continue;
    // 목표가 아닌 그림자는 무대 밖 집 창가로 날아간다.
    game.returned++;
    const home = ground.nearestHome(p.x, p.z);
    const run = game.run;
    if (home) wisps.spawn(p, home, () => run === game.run && wisps.flash(home));
  }
  game.dread = ev.nearest < 12 ? 1 - ev.nearest / 12 : 0;
  if (player.alive) chapterInteract(dt);
  hud.setObjective(chapters.objective);
  if (!player.alive) chapterFail();
}

function chapterInteract(dt) {
  if (game.holdLock && !input.interactHeld) game.holdLock = false;
  const how = input.usingTouch || mobile ? '버튼을 길게 눌러' : 'E를 길게 눌러';
  const t = chapters.nearest(player.pos.x, player.pos.z);
  const key = t ? t.key : null;
  if (key !== game.holdKey) {
    game.hold = 0;
    game.holdKey = key;
  }
  if (!t) {
    hud.prompt(null);
    return;
  }
  if (t.blocked) {
    game.hold = 0;
    hud.prompt(t.label, 0);
    return;
  }
  const done = holdProgress(dt, t.dur);
  hud.prompt(`${how} ${t.label}`, Math.min(1, game.hold / t.dur));
  if (done) {
    game.hold = 0;
    game.holdLock = true;
    t.act();
  }
}

// 장에서 쓰러졌을 때. 주운 기록·돌려보낸 그림자·켠 등은 그대로 두고, 그 차례의 자리에서 다시 시작한다.
function chapterFail() {
  game.state = 'end';
  hud.prompt(null);
  hud.tags([]);
  $('end-title').textContent = '어둠에 삼켜졌다';
  $('end-text').textContent = `${chapters.label} — 찾은 기록과 돌려보낸 그림자는 그대로 남는다. 불빛 곁에서 다시 해 보자.`;
  if ($('end-best')) $('end-best').textContent = '';
  endButtons();
  setScreen('end');
}

// 4장 마지막 방송이 끝났을 때: 이야기의 끝 화면
function finishStory() {
  game.state = 'end';
  hud.prompt(null);
  hud.tags([]);
  sound.play('win');
  $('end-title').textContent = `《${FINALE.title}》`;
  $('end-text').textContent = FINALE.text;
  if ($('end-best')) $('end-best').textContent = '';
  endButtons({ retry: false, journal: true });
  setScreen('end');
}

// 처음 화면의 장 단추: 1장을 마쳤으면 다음 차례의 장을, 다 끝냈으면 2장부터 다시 걷기를 보인다.
let replayArmed = null;
function renderChapter() {
  const btn = $('chapter-btn');
  if (!btn) return;
  const info = dialogue.ok ? chapters.nextInfo() : null;
  const replay = dialogue.ok && chapters.done;
  btn.classList.toggle('hidden', !info && !replay);
  btn.disabled = game.contextLost || !game.ready;
  replayArmed = null;
  if (info) btn.textContent = `${info.fresh ? '다음 장' : '이어 가기'} · ${info.ch}장 ${info.title}`;
  else if (replay) btn.textContent = '2장부터 다시 걷기';
}

function chapterButton() {
  if (!chapters.done) {
    startChapter();
    return;
  }
  // 다 끝낸 이야기를 2장부터 다시: 실수로 지우지 않게 두 번 눌러야 한다(1장 기록은 남는다).
  const now = performance.now();
  if (replayArmed === null || now - replayArmed > 4000) {
    replayArmed = now;
    $('chapter-btn').textContent = '한 번 더 누르면 2장부터';
    return;
  }
  replayArmed = null;
  story.forgetChapters();
  chapters.wipe();
  startChapter();
}

chapters.attach({
  shades, wisps, player,
  api: {
    queue: (id) => storyQueue.includes(id) || storyQueue.push(id),
    later,
    place: (at) => placePlayer(at),
    toast: (text, kind) => hud.toast(text, kind),
    sound: (name) => sound.play(name),
    card: (text) => showCard(text),
    setHour: (h) => env.setHour(h),
    next: () => startChapter(),
    finish: () => finishStory(),
    openDoc: (clue) => openDoc(clue),
    compare: (a, b, onFlip) => openCompare(a, b, onFlip),
    recharge: () => {
      player.battery = 100;
      sound.play('pickup');
      hud.toast('예비 전지를 끼웠다. 손전등 100%', 'good');
    },
  },
});

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
    ? `다른 생존자가 남긴 보급품 ${others}개. 청록빛을 찾아보자.`
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
  game.pendingTake = { id: c.id, kind: c.kind };
  const r = await online.use(c.id);
  if (run !== game.run) return;
  game.cacheBusy = false;
  game.pendingTake = null;
  if (!r.ok) {
    hud.toast(onlineError(r, c), r.error === 'used_today' ? '' : 'warn');
    return;
  }
  game.cacheTaken++;
  grantShared(KIND_NAMES[r.data?.kind] ? r.data.kind : c.kind);
  c.charges = r.data?.charges ?? c.charges - 1;
  // 마지막 하나를 꺼냈어도 빈 상자는 이 판에 남겨 둔다. 서버는 소진된 상자에도 고마워요를 받으므로,
  // 바로 지우면 마지막 사람만 고마움을 전할 길이 없어진다. 고마워요를 보내면 그때 치운다.
  if (c.charges <= 0) {
    later(1.6, () => hud.toast('마지막 하나였다. 상자 앞에서 다시 길게 누르면 남긴 사람에게 고마워요를 보낼 수 있다.'));
  } else if (!game.hintThanks) {
    game.hintThanks = true;
    later(1.6, () => hud.toast('상자 앞에서 다시 길게 누르면 남긴 사람에게 고마워요를 보낼 수 있다.'));
  }
}

// 꺼내기 요청이 오가는 사이 탭이 닫혔던 판을 이어 할 때: 같은 상자를 다시 꺼내 본다. 성공하면 그때 받고,
// '오늘 이미 꺼냈다'(409 used_today)면 앞 요청이 서버에서 이뤄진 것이니 그 물건을 준다. 그 밖의 실패는 받지 않은 것이다.
async function settleTake(t, run) {
  if (!online.enabled) return;
  game.pendingTake = t;
  const r = await online.use(t.id);
  if (run !== game.run) return;
  game.pendingTake = null;
  if (r.ok || r.error === 'used_today') {
    if (r.ok) game.cacheTaken++;
    grantShared(KIND_NAMES[r.data?.kind] ? r.data.kind : t.kind);
    hud.toast('지난번에 꺼내던 보급품을 마저 받았다.', 'good');
  }
  saveRun();
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
  if (c.charges <= 0) {
    caches.remove(c.id);
    hud.toast('고마워요를 보냈다. 빈 상자는 치웠다.', 'good');
  } else {
    hud.toast('고마워요를 보냈다. 이 보급품이 마을에 조금 더 오래 남는다.', 'good');
  }
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
  const used = online.usedRecently(c.id);
  if (used && online.hasThanked(c.id)) {
    game.hold = 0;
    hud.prompt(`고마워요를 보낸 ${name} 상자`, 0);
    return;
  }
  if (!used && c.charges <= 0) {
    game.hold = 0;
    hud.prompt(`빈 ${name} 상자`, 0);
    return;
  }
  if (used) {
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
  p.kind = kind;
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
  // 넘쳐 버리지 않을 만큼만 붓는다(연료 60% 이하일 때 한 통씩, src/vehicle.js CAN_FUEL).
  const poured = car.pour(player.cans);
  player.cans -= poured;
  if (poured) {
    sound.play('pour');
    hud.toast(`연료통 ${poured}개를 부었다. 연료 ${Math.round(car.fuel)}%`, 'good');
  }
  seatInCar();
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

// 운전석에 앉힌다. 타기와 이어하기가 함께 쓴다.
function seatInCar() {
  game.driving = true;
  car.occupied = true;
  player.setRiding(true);
  player.pos.copy(car.pos);
  hud.setDriving(true);
}

// force가 거짓이면(플레이어가 내리기를 눌렀을 때) 문 앞이 모두 막혀 있으면 내리지 않고 알린다(옮겨 세우면 된다).
// 처음 화면으로 나가거나 장을 시작할 때는 force로 반드시 내린다.
function leaveCar(force = true) {
  const spot = car.exitSpot(world, { force });
  if (!spot) {
    hud.toast('문 앞이 막혀 내릴 수 없다. 트럭을 조금 옮겨 세우자.', 'warn');
    return;
  }
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
      leaveCar(false);
    }
    return;
  }

  let target = world.nearestInteractable(player.pos.x, player.pos.z, 1.8);
  // 손이 닿는 지점: 배전함·이야기 기록은 그 앞에 서는 자리, 나머지는 물건 자리
  const spot = (t) => (t.kind === 'fuse' || t.kind === 'breaker' || t.kind === 'clue' ? { x: t.ref.ix, z: t.ref.iz } : { x: t.ref.x, z: t.ref.z });
  const dist = (t) => {
    const p = spot(t);
    return Math.hypot(p.x - player.pos.x, p.z - player.pos.z);
  };
  const shared = game.onlineLive ? caches.nearest(player.pos.x, player.pos.z, CACHE_REACH) : null;
  if (shared && (!target || dist({ kind: 'cache', ref: shared }) < dist(target))) target = { kind: 'cache', ref: shared };
  const note = dialogue.ok ? story.nearest(player.pos.x, player.pos.z) : null;
  if (note && (!target || note.dist < dist(target))) target = { kind: 'clue', ref: note.spot, clue: note.clue };
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
    const cans = car.cansToPour(player.cans);
    const pour = cans ? ` · 연료통 ${cans}개 붓기` : player.cans > 0 ? ' · 연료가 넉넉해 연료통은 아껴 둔다' : '';
    const done = holdProgress(dt, 0.5);
    hud.prompt(`${how} 트럭 타기${pour}`, Math.min(1, game.hold / 0.5));
    if (done) {
      game.hold = 0;
      game.holdLock = true;
      enterCar();
    }
    return;
  }
  if (target.kind === 'breaker') {
    const ref = target.ref;
    const name = ref.zone === 'H' ? '은신처 발전기' : `${world.zones[ref.zone].name} 배전함`;
    const dur = 1.2;
    const done = holdProgress(dt, dur);
    hud.prompt(`${how} 차단기 올리기 · ${name}`, Math.min(1, game.hold / dur));
    if (done) {
      game.hold = 0;
      resetBreaker(ref);
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
    if (!queueStory('dusk')) hud.toast('해가 진다. 불빛 가까이 머물자.', 'warn');
    if (!game.hintFlash) {
      game.hintFlash = true;
      later(1.6, () => hud.toast(`${mobile ? '손전등 버튼' : 'F 키나 마우스 클릭'}으로 손전등을 켜자. 오래 비추면 그늘이가 흩어진다.`));
    }
    saveRun();
  } else if (ev === 'night') {
    if (!game.peaceful) hud.toast('어둠 속에서 그늘이가 움직인다.', 'warn');
    if (!game.peaceful && !game.hintLoad) {
      game.hintLoad = true;
      later(2.4, () => hud.toast('그늘이가 가로등 가장자리에 몰려 버티면 과부하가 걸린다. 깜박이기 시작하면 손전등으로 흩어 놓자.'));
    }
  } else if (ev === 'dawn') {
    game.nights++;
    env.day++;
    sound.play('dawn');
    const reset = world.dawnReset();
    wisps.dawn();
    if (!game.peaceful) hud.toast(`${game.nights}번째 밤을 버텼다. 날이 밝는다.`, 'good');
    if (reset) later(1.6, () => hud.toast('날이 밝자 내려갔던 차단기가 다시 올라갔다.'));
    if (player.flashOn) player.flashOn = false;
    if (!game.peaceful) queueStory('dawn');
    saveRun();
  }
}

// 터치에는 조준 막대가 없어 손전등이 걷는 쪽에 묶였다(뒤로 물러나며 비출 수 없었다, #14). 손전등을 켰으면
// 8m 안의 가장 가까운 그늘이 쪽을 비춘다. 없으면 걷는 쪽.
const TOUCH_AIM_R = 8;
const touchAimPoint = new THREE.Vector3();
function touchAim() {
  let best = null;
  let bd = TOUCH_AIM_R;
  for (const s of shades.list) {
    if (!s.active || s.state !== 'stalk') continue;
    const d = Math.hypot(s.x - player.pos.x, s.z - player.pos.z);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best ? touchAimPoint.set(best.x, player.pos.y + 0.9, best.z) : null;
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
  } else if ((input.usingTouch || mobile) && player.flashOn) {
    aim = touchAim();
  }
  player.update(dt, game.time, { x: move.x, z: move.z }, aim, ground, env.night, env.rainLevel);
  if (player.footfall) sound.footstep(player.footfall, env.rainLevel); // 걸음마다 발소리(비 오면 젖은 소리)
  if (game.chapter) return; // 장 무대에는 트럭이 없다
  onCarEvent(car.update(dt, null, world, env.night));
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
  onCarEvent(ev);
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

// frozen: 배전반을 연 밤(플레이어는 서 있고 입력·상호작용은 받지 않는다. 장면은 배전반을 닫은 뒤에 연다).
function step(dt, frozen = false) {
  runTimers();
  // 타이머가 장면(엔딩 등)을 열었거나 판을 끝냈으면 이번 프레임의 진행은 하지 않는다.
  if (frozen ? game.state !== 'grid' : game.state !== 'play' || flushStory()) return;
  if (game.chapter) {
    chapterStep(dt);
    return;
  }
  if (frozen) {
    stepWorld(dt, true);
    return;
  }
  const flashKey = input.consume('KeyF') || input.consume('Touch_flash');
  const flashClick = input.consume('MouseLeft');
  if (game.driving) {
    if (flashKey) toggleTruckLamp();
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

  stepWorld(dt, false);
}

function stepWorld(dt, frozen) {
  for (const ev of env.advance(dt)) onTimeEvent(ev);

  if (frozen) {
    // 플레이어는 서 있고, 트럭은 손을 뗀 채로 흐른다(작업등 연료·꺼짐도 그대로 — #36 리뷰)
    player.update(dt, game.time, { x: 0, z: 0 }, null, ground, env.night, env.rainLevel);
    onCarEvent(car.update(dt, null, world, env.night));
  } else if (game.driving) drive(dt);
  else walk(dt);
  world.setTruckLamp(car.pos.x, car.pos.z, car.lamp && car.fuel > 0);

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
    if (frozen) closeGrid(); // 맞으면 배전반에서 손을 뗀다
  }
  if (ev.rammed) {
    sound.play('crash');
    game.shake = Math.max(game.shake, 0.3);
  }
  if (ev.banished) sound.play('banish');
  for (const p of ev.returned) sendHome(p);
  game.dread = ev.nearest < 12 ? 1 - ev.nearest / 12 : 0;
  const gridEvents = world.takeEvents();
  if (gridEvents) for (const e of gridEvents) onGridEvent(e);

  // 이번 프레임에 쓰러졌으면 상호작용(기록 읽기·장면 시작)을 하지 않고 바로 끝 화면으로 간다.
  if (player.alive && !frozen) interact(dt);

  drops.update(dt, game.time, env.night);
  const found = drops.take(player.pos.x, player.pos.z, game.driving ? 1.8 : 1.0);
  if (found) foundOutfit(found);

  if (!player.alive) endGame(false);
  else if (game.time - game.savedAt >= SAVE_EVERY) saveRun();
}

// 화면 밖 16m 안에서 다가오는 그늘이(가까운 순 최대 6). 화면 안의 그늘이는 눈으로 보이니 표시하지 않는다.
const THREAT_R = 16;
const threatOut = [];
function offscreenThreats() {
  threatOut.length = 0;
  for (const s of shades.list) {
    if (!s.active || s.state !== 'stalk') continue;
    const d = Math.hypot(s.x - player.pos.x, s.z - player.pos.z);
    if (d > THREAT_R) continue;
    tmp.set(s.x, 0.8, s.z).project(camera);
    if (Math.abs(tmp.x) < 0.92 && Math.abs(tmp.y) < 0.92) continue;
    threatOut.push({ sx: (tmp.x * 0.5 + 0.5) * innerWidth, sy: (-tmp.y * 0.5 + 0.5) * innerHeight, k: 1 - d / THREAT_R, d });
  }
  threatOut.sort((a, b) => a.d - b.d);
  if (threatOut.length > 6) threatOut.length = 6;
  return threatOut;
}

// ---------------------------------------------------------------- 루프

let last = performance.now();
const fpsMeter = { frames: 0, since: 0 };
// 화면 갱신 루프. frame()은 다시 예약하지 않아서, 디버그 step()이 frame()을 직접 불러도 루프가 늘지 않는다.
function loop(now) {
  requestAnimationFrame(loop);
  if (!halted) watchQuality(now); // 실제 화면 갱신만 잰다(디버그 step의 가짜 시각은 빼고)
  frame(now);
}
function frame(now) {
  if (halted) return;
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
  const esc = input.consume('Escape');
  const pKey = input.consume('KeyP');
  // 장면·읽기 화면이 열려 있으면 그 키는 dialogue가 먼저 받았으니 여기서는 버린다.
  if (dialogue.busy) {
    // 아무것도 하지 않는다
  } else if (esc && game.placing && game.state === 'play' && !settingsFrom) {
    if (!game.placing.busy) closePlace();
  } else if (esc && minimap.isOpen && game.state === 'play' && !settingsFrom) {
    minimap.close();
  } else if (esc || pKey) {
    if (settingsFrom) closeSettings();
    else if (journalFrom) closeJournal();
    else if (game.state === 'play') pauseGame(true);
    else if (game.state === 'pause') pauseGame(false);
    else if (game.state === 'closet') closeCloset();
    else if (game.state === 'grid') closeGrid();
  }
  if (input.consume('Tab') || input.consume('KeyB')) {
    if (game.state === 'play' && !game.chapter) openGrid();
    else if (game.state === 'grid') closeGrid();
  }
  if (input.consume('KeyV') && game.state === 'play' && !dialogue.busy) minimap.toggle();
  if (minimap.isOpen && game.state !== 'play' && game.state !== 'story') minimap.close();
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
  if (game.state === 'grid' && gridLive() && !game.contextLost) {
    // 배전반 앞에 서 있는 채로 세상은 흐른다(움직임·행동 입력은 받지 않는다).
    dt = raw;
    game.time += dt;
    step(dt, true);
  } else if (game.state === 'play') {
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
    const boost = (storyCam.zoom ?? game.zoomTarget) - game.zoomTarget;
    // 움직임 줄이기: 카메라가 미끄러지지 않고 바로 자른다(#20)
    if (dialogue.reduce.matches) {
      camFocus.copy(camGoal);
      game.zoomBoost = boost;
    } else {
      camFocus.lerp(camGoal, 1 - Math.exp(-raw * 2.4));
      game.zoomBoost += (boost - game.zoomBoost) * (1 - Math.exp(-raw * 2));
    }
  } else if (game.state === 'title') {
    dt = raw;
    game.time += dt;
    env.setHour(env.hour + dt * 0.9);
    const t = game.time;
    camFocus.set(Math.sin(t * 0.05) * 22, 0, Math.cos(t * 0.037) * 18 - 4);
  } else if (game.state === 'closet') {
    dt = raw;
    game.time += dt;
    player.idlePose(game.time);
    closet.update(raw, player);
    camFocus.copy(player.pos); // 그림자·광원 선택 기준을 주인공 주변으로
  }
  game.clock += dt;
  if (game.state !== 'pause' && game.state !== 'story') hud.tickToasts(raw);
  game.shake = Math.max(0, game.shake - raw * 1.6);

  updateCamera(raw);
  env.update(dt, camFocus, pxPerUnit);
  world.update(dt, game.clock, env.night, camFocus, pxPerUnit);
  wisps.update(dt, game.clock, env.night);
  story.update(dt, game.clock, env.night, pxPerUnit);
  chapters.tick(dt, game.clock, env.night, player);
  caches.update(game.clock, pxPerUnit, env.night);
  world.setWetness(env.rainLevel);
  // 근처 빛의 부하: HUD 막대와 웅웅거림. 밤에 부하가 오르거나 차단됐을 때만 보인다.
  const near = (game.state === 'play' || game.state === 'grid') && !game.chapter ? world.nearbyLoad(player.pos.x, player.pos.z, 3) : null;
  const loadShown = env.night > 0.3 && near && (near.tripped || near.load > 0.04) ? near : null;
  if (game.state !== 'title') {
    const buzz = game.state === 'play' && loadShown && !loadShown.tripped ? Math.max(0, (loadShown.load - 0.35) / 0.65) : 0;
    sound.setMix({ rain: env.rainLevel, night: env.night, dread: game.state === 'play' ? game.dread ?? 0 : 0, buzz });
  }
  // 일시정지 중에는 공회전, 그 밖(타이틀·종료 화면)에는 엔진을 끈다.
  const engineOn = game.driving && car.running && (game.state === 'play' || game.state === 'pause' || game.state === 'grid');
  sound.setEngine(game.state === 'play' && engineOn ? {
    on: true, rpm: Math.min(1, Math.abs(car.speed) / MAX_FWD), load: car.throttle, skid: Math.min(1, Math.max(0, car.slip - 2) / 4),
  } : { on: engineOn });

  // 흔들림·점멸을 끄면 체력 경고는 깜박이지 않는 붉은 테두리로, 피격 번쩍임은 절반으로 줄인다.
  const lowHp = player.hp < 30 && game.state === 'play' ? 0.25 + (settings.shake ? 0.15 * Math.sin(game.time * 5) : 0) : 0;
  // 옷장은 전용 근접 카메라로 그리고, 인물이 화면 가운데가 아닐 수 있어 틸트시프트 흐림을 끈다.
  const inCloset = game.state === 'closet';
  // 화질을 바꿔 셰이더를 다시 컴파일하는 동안에는 숨긴 물체까지 켜져 있으니 그리지 않고 직전 화면을 둔다.
  if (!(game.warming && game.ready)) {
    post.render(scene, inCloset ? closet.camera : camera, env.look, game.clock, {
      focus: 0.5, band: 0.07, blurScale: settings.tilt && !inCloset ? (game.state === 'title' ? 1.25 : 1.0) : 0,
      hurt: Math.max(player.hurtFx * (settings.shake ? 0.9 : 0.45), lowHp),
    });
  }

  if (game.state === 'play' || game.state === 'pause' || game.state === 'grid') minimap.update(now, game.chapter);
  if (game.state !== 'title') {
    hud.update({
      day: env.day, dayLabel: game.chapter ? chapters.label : null, hour: env.hour, zonesOn: world.poweredZones, zonesTotal: world.totalZones,
      hp: player.hp, battery: player.battery, fuses: player.fuses, bandages: player.bandages, flashOn: player.flashActive,
      cans: player.cans, driving: game.driving, fuel: car.fuel,
      powerUsed: world.onCount, powerCap: world.capacity, tripped: world.trippedCount, load: loadShown,
    });
    hud.threats(game.state === 'play' || game.state === 'grid' ? offscreenThreats() : []);
    const dead = game.state === 'play' && !game.chapter ? world.nearestDeadBox(player.pos.x, player.pos.z) : null;
    if (dead) {
      tmp.set(dead.box.x, 1.5, dead.box.z).project(camera);
      const off = Math.abs(tmp.x) > 0.9 || Math.abs(tmp.y) > 0.9;
      hud.pointer((tmp.x * 0.5 + 0.5) * innerWidth, (-tmp.y * 0.5 + 0.5) * innerHeight, dead.dist, off);
    } else {
      hud.pointer(0, 0, 0, false);
    }
    let note = null;
    if (game.state === 'play' && dialogue.ok) {
      if (!game.chapter) {
        const t = story.target(player.pos.x, player.pos.z);
        if (t) note = { x: t.spot.x, y: t.spot.top, z: t.spot.z, dist: t.dist };
      } else {
        const t = chapters.target(player.pos.x, player.pos.z);
        if (t) note = { x: t.x, y: t.top, z: t.z, dist: t.dist };
      }
    }
    if (note) {
      tmp.set(note.x, note.y, note.z).project(camera);
      const off = Math.abs(tmp.x) > 0.9 || Math.abs(tmp.y) > 0.9;
      hud.storyPointer((tmp.x * 0.5 + 0.5) * innerWidth, (-tmp.y * 0.5 + 0.5) * innerHeight, note.dist, off);
    } else {
      hud.storyPointer(0, 0, 0, false);
    }
    // 2~4장: 가까운 인물의 이름표
    if (game.chapter && game.state === 'play') {
      const tags = chapters.labels(player.pos.x, player.pos.z).map((l) => {
        tmp.set(l.x, l.y, l.z).project(camera);
        return { text: l.text, x: (tmp.x * 0.5 + 0.5) * innerWidth, y: (-tmp.y * 0.5 + 0.5) * innerHeight };
      });
      // 가까이 붙은 이름표는 위로 쌓아 겹치지 않게 한다(아래쪽 것부터 자리를 잡는다).
      tags.sort((p, q) => q.y - p.y);
      for (let i = 1; i < tags.length; i++) {
        for (let j = 0; j < i; j++) {
          if (Math.abs(tags[i].x - tags[j].x) < 76 && Math.abs(tags[i].y - tags[j].y) < 22) tags[i].y = tags[j].y - 22;
        }
      }
      hud.tags(tags);
    } else {
      hud.tags([]);
    }
  }
  input.endFrame();
}

// ---------------------------------------------------------------- UI 연결

$('start-btn').addEventListener('click', newGame);
$('resume-run-btn')?.addEventListener('click', resumeGame);
$('new-yes')?.addEventListener('click', startGame);
$('new-no')?.addEventListener('click', cancelNewGame);
$('closet-btn')?.addEventListener('click', openCloset);
$('closet-close')?.addEventListener('click', closeCloset);
$('power-btn')?.addEventListener('click', openGrid);
$('grid-close')?.addEventListener('click', closeGrid);
if ($('grid')) board = new Switchboard(world, { onToggle: () => sound.play('click') });
$('resume-btn').addEventListener('click', () => pauseGame(false));
$('quit-btn').addEventListener('click', backToTitle);
$('restart-btn').addEventListener('click', () => (game.chapter ? startChapter() : startGame()));
$('next-chapter-btn')?.addEventListener('click', startChapter);
$('end-journal-btn')?.addEventListener('click', openJournal);
$('chapter-btn')?.addEventListener('click', chapterButton);
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
// 모바일에서 백그라운드로 간 탭은 알림 없이 종료될 수 있고, 그 전에 확실히 오는 마지막 신호가 visibilitychange(hidden)다.
// pagehide는 데스크톱에서 탭을 닫거나 다른 페이지로 갈 때를 받는다. 장면·배전반 화면처럼 일시정지가 걸리지 않는 상태도 저장한다.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  pauseGame(true);
  saveRun();
});
addEventListener('pagehide', saveRun);

// ?debug: 콘솔에서 상태를 들여다보고 시뮬레이션을 고정 간격으로 돌려 보는 개발용 핸들
if (params.has('debug')) {
  window.lumen = {
    THREE, scene, camera, renderer, world, env, post, player, shades, car, wisps, game, input, hud, sound, startGame,
    saveRun, resumeGame, readRun: () => readRun(world), backToTitle, pauseGame,
    wardrobe, drops, closet, openCloset, closeCloset, board, openGrid, closeGrid, online, caches,
    story, dialogue, storyQueue, playScene, openDoc, queueStory, chapters, startChapter, minimap, autoQ, get ground() { return ground; },
    // sec초를 dt초 간격으로 진행한다. 실제 화면처럼 걷기·충돌을 보려면 dt를 1/60로 준다(최대 0.05, frame의 상한).
    step(sec, dt = 0.05) {
      const ms = Math.min(50, Math.max(1, dt * 1000));
      let t = last;
      for (let i = 0, n = Math.round((sec * 1000) / ms); i < n; i++) frame((t += ms));
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
  // 이어하기·새로 시작 확인 버튼도 새로 생긴 요소라 없을 수 있다.
  for (const id of ['resume-run-btn', 'new-yes', 'chapter-btn', 'next-chapter-btn']) if ($(id)) $(id).disabled = lost || !game.ready;
  // 옷장 버튼은 새로 생긴 요소라, 배포 직후 옛 HTML과 섞이면 없을 수 있다.
  if ($('closet-btn')) $('closet-btn').disabled = lost || !game.ready;
  if (lost) closeSettings();
  // 밤에 연 배전반은 시간이 흐르므로, 그리지 못하는 동안 진행되지 않게 닫고 일시정지로 둔다(#36 리뷰)
  if (lost && game.state === 'grid') closeGrid();
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
// 일시적인 오류였다면 이어서 할 수 있게: 오류 화면을 닫고 판은 일시정지로 둔다(바로 그늘이 앞에 서지 않게).
$('error-continue')?.addEventListener('click', () => {
  $('error').classList.add('hidden');
  halted = false;
  last = performance.now();
  if (game.state === 'play' || game.state === 'grid') {
    if (game.state === 'grid') closeGrid();
    pauseGame(true);
  } else if (game.state === 'title') {
    $('title').classList.remove('hidden');
  }
});

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
renderRun();
renderChapter();
env.setHour(Number(params.get('hour')) || 16.5);
document.body.classList.add('ready');
booted = true;
requestAnimationFrame(loop);
warmUp().then(() => {
  game.ready = true;
  document.body.classList.add('loaded');
  $('start-btn').textContent = '시작하기';
  renderRun(); // 이어할 판이 있으면 '새로 시작'으로 바꾼다
  renderChapter();
  setContextLost(game.contextLost ?? false);
  // 사전 컴파일이 메인 스레드를 오래 막는 느린 기기에서 요청 시간 제한이 헛걸리지 않게, 준비가 끝난 뒤 소식을 받는다.
  renderOnline();
  if (params.get('start') === '1') startGame();
});
