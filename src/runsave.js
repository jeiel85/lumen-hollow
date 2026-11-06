import { load, save, remove } from './storage.js';
import { BOUND } from './world.js';
import { phaseName } from './env.js';
import { RUN_TAKE_LIMIT } from './online.js';

// 진행 중인 판 저장(이어하기). 모바일에서 백그라운드로 간 탭이 종료돼도 처음 화면의 '이어하기'로 돌아온다.
// 형식과 그 이유는 DECISIONS.md "판 중간 저장" 항목. 형식을 바꾸면 RUN_VERSION을 올리고 이전 형식도 읽게 한다.
// 그늘이·대기 중인 안내 문구·트럭 속도·옷가지 꾸러미 위치·공유 보급품 목록은 저장하지 않는다(이어할 때 새로 정한다).
export const RUN_KEY = 'lumen.run';
export const RUN_VERSION = 1;
const MAX_LEN = 16384;

// 뒤질 곳 하나에 남은 물건을 한 글자로 적는다. 뒤진 곳은 '_'. 한 번 배포한 글자는 다른 물건에 다시 쓰지 않는다.
const ITEM_CODE = { empty: '.', fuse: 'f', battery: 'b', bandage: 'h', fuel: 'c' };
const CODE_ITEM = Object.fromEntries(Object.entries(ITEM_CODE).map(([item, code]) => [code, item]));
const SEARCHED = '_';
const HINTED_FUSE = 'F'; // 깨어난 사람이 촛불을 켜 둔(알려 준) 퓨즈 자리

// 한 번 본 안내. 저장 이름 → game의 키. 모르는 이름은 읽을 때 버린다.
const HINTS = { flash: 'hintFlash', car: 'hintCar', thanks: 'hintThanks', lamp: 'hintLamp', load: 'hintLoad', told: 'hintTold' };

const r3 = (v) => Math.round(v * 1000) / 1000;
const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const bool = (v) => typeof v === 'boolean';
const obj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

// 마을 지문: 뒤질 곳·배전함의 수와 자리. 마을 생성이 바뀐 버전에서는 저장된 뒤진 곳 목록이 다른 자리를 가리키므로
// 이어하지 않는다. 좌표는 10cm 단위로 반올림해 엔진마다 다를 수 있는 마지막 자리 오차를 지운다.
export function layoutPrint(world) {
  let h = 0x811c9dc5;
  const mix = (s) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  };
  for (const l of world.loot) mix(`${l.x.toFixed(1)},${l.z.toFixed(1)};`);
  for (const f of world.fuseBoxes) mix(`${f.zone}${f.x.toFixed(1)},${f.z.toFixed(1)};`);
  return `${world.loot.length}.${world.totalZones}.${(h >>> 0).toString(16)}`;
}

// 지금 판의 상태를 저장할 값으로 만든다. 저장 형식에 없는 물건이 있으면 예외를 던진다(조용히 빈 곳으로 바꾸지 않는다).
export function captureRun({ world, player, car, env, game, shades }) {
  let loot = '';
  for (const l of world.loot) {
    if (l.hinted && !l.searched && l.item !== 'fuse') throw new Error(`퓨즈가 아닌 자리에 촛불 단서가 있습니다: ${l.item}`);
    const code = l.searched ? SEARCHED : l.hinted ? HINTED_FUSE : ITEM_CODE[l.item];
    if (!code) throw new Error(`저장 형식에 없는 물건입니다: ${l.item}`);
    loot += code;
  }
  return {
    v: RUN_VERSION,
    savedAt: Date.now(),
    layout: layoutPrint(world),
    loot,
    zones: Object.values(world.zones).filter((z) => z.powered).map((z) => ({ id: z.id, on: z.on, tripped: z.tripped, load: r3(z.load) })),
    env: { day: env.day, hour: r3(env.hour), rainyNight: env.rainyNight, rain: r3(env.rainLevel) },
    player: {
      x: r3(player.pos.x), z: r3(player.pos.z), facing: r3(player.facing),
      // 살아 있는 동안만 저장하므로 체력이 반올림으로 0이 되지 않게 한다.
      hp: Math.max(0.001, r3(player.hp)), battery: r3(player.battery),
      fuses: player.fuses, bandages: player.bandages, cans: player.cans, flash: player.flashOn,
    },
    car: { x: r3(car.pos.x), z: r3(car.pos.z), a: r3(car.a), fuel: r3(car.fuel), driving: game.driving, lamp: car.lamp, lampLoad: r3(world.truckLamp.load) },
    run: {
      nights: game.nights, banished: shades.banished, returned: game.returned, cacheTaken: game.cacheTaken,
      hints: Object.keys(HINTS).filter((k) => game[HINTS[k]]),
    },
  };
}

export function writeRun(data) {
  return save(RUN_KEY, JSON.stringify(data));
}

export function clearRun() {
  remove(RUN_KEY);
}

// 저장된 판을 읽는다. { status, run }
// - 'ok': 이어할 수 있다. run은 검증을 거친 값이다.
// - 'none': 저장이 없다.
// - 'newer': 더 새 버전이 쓴 저장. 지우지 않고 둔다(새 버전으로 돌아가면 이어할 수 있게).
// - 'layout': 마을 배치가 다른 버전의 저장. 이어할 수 없고, 새 판을 시작하면 덮어쓴다.
// - 'corrupt': 깨졌거나 범위를 벗어난 값. 지운다.
export function readRun(world) {
  const text = load(RUN_KEY);
  if (text === null) return { status: 'none' };
  let raw;
  try {
    raw = text.length <= MAX_LEN ? JSON.parse(text) : null;
  } catch {
    raw = null;
  }
  if (obj(raw) && Number.isInteger(raw.v) && raw.v > RUN_VERSION) return { status: 'newer' };
  if (obj(raw) && raw.v === RUN_VERSION && typeof raw.layout === 'string' && raw.layout !== layoutPrint(world)) return { status: 'layout' };
  const run = obj(raw) && raw.v === RUN_VERSION ? validate(raw, world) : null;
  if (!run) {
    console.warn('[run] 저장된 판이 깨져 있어 지웁니다.');
    clearRun();
    return { status: 'corrupt' };
  }
  return { status: 'ok', run };
}

// 모든 값을 검사해 새 객체로 옮긴다. 하나라도 어긋나면 null.
function validate(raw, world) {
  const { loot, zones, env, player: p, car, run } = raw;
  if (!num(raw.savedAt, 0, Number.MAX_SAFE_INTEGER)) return null;
  if (typeof loot !== 'string' || loot.length !== world.loot.length) return null;
  for (const ch of loot) if (ch !== SEARCHED && ch !== HINTED_FUSE && !CODE_ITEM[ch]) return null;

  if (!Array.isArray(zones) || zones.length > world.totalZones) return null;
  const outZones = [];
  for (const z of zones) {
    if (!obj(z) || !world.zones[z.id] || outZones.some((o) => o.id === z.id)) return null;
    if (!bool(z.on) || !bool(z.tripped) || !num(z.load, 0, 1)) return null;
    outZones.push({ id: z.id, on: z.on, tripped: z.tripped, load: z.load });
  }
  const home = outZones.find((z) => z.id === 'H');
  if (!home || !home.on) return null;
  // 켜 둔 구역 수가 그 수리 단계의 변전소 출력을 넘으면 손으로 고친 값이다(world.capacity와 같은 식).
  const repaired = outZones.length - 1;
  const cap = repaired >= world.totalZones - 1 ? repaired : 2 + Math.floor(repaired / 3);
  if (outZones.filter((z) => z.id !== 'H' && z.on).length > cap) return null;

  if (!obj(env) || !int(env.day, 1, 9999) || !num(env.hour, 0, 24) || !bool(env.rainyNight) || !num(env.rain, 0, 1)) return null;
  if (!obj(p) || !num(p.x, -BOUND, BOUND) || !num(p.z, -BOUND, BOUND) || !num(p.facing, -1e4, 1e4)) return null;
  if (!num(p.hp, 0.001, 100) || !num(p.battery, 0, 100) || !bool(p.flash)) return null;
  if (!int(p.fuses, 0, 99) || !int(p.bandages, 0, 5) || !int(p.cans, 0, 99)) return null;
  if (!obj(car) || !num(car.x, -BOUND, BOUND) || !num(car.z, -BOUND, BOUND) || !num(car.a, -1e4, 1e4)) return null;
  if (!num(car.fuel, 0, 100) || !bool(car.driving) || !bool(car.lamp) || !num(car.lampLoad, 0, 1)) return null;
  if (!obj(run) || !int(run.nights, 0, 9999) || !int(run.banished, 0, 1e7) || !int(run.returned, 0, 1e7) || !int(run.cacheTaken, 0, RUN_TAKE_LIMIT)) return null;
  if (!Array.isArray(run.hints) || run.hints.length > 50) return null;

  return {
    savedAt: raw.savedAt,
    loot,
    zones: outZones,
    env: { day: env.day, hour: env.hour % 24, rainyNight: env.rainyNight, rain: env.rain },
    player: { x: p.x, z: p.z, facing: p.facing, hp: p.hp, battery: p.battery, fuses: p.fuses, bandages: p.bandages, cans: p.cans, flash: p.flash },
    car: { x: car.x, z: car.z, a: car.a, fuel: car.fuel, driving: car.driving, lamp: car.lamp, lampLoad: car.lampLoad },
    run: {
      nights: run.nights, banished: run.banished, returned: run.returned, cacheTaken: run.cacheTaken,
      hints: run.hints.filter((k) => typeof k === 'string' && HINTS[k]).map((k) => HINTS[k]),
    },
  };
}

// 마을을 저장된 판의 상태로 되돌린다: 뒤질 곳의 물건과 뒤진 곳, 고친 구역의 스위치·차단기·부하.
export function restoreWorld(world, run) {
  world.reset(1); // 구역·작업등·사건을 판 시작 상태로 돌린 뒤 저장값을 덮는다(여기서 섞인 물건은 아래에서 모두 바뀐다)
  for (let i = 0; i < world.loot.length; i++) {
    const l = world.loot[i];
    const ch = run.loot[i];
    if (ch === SEARCHED) {
      l.item = 'empty';
      world.markSearched(l);
    } else if (ch === HINTED_FUSE) {
      l.item = 'fuse';
      world.hintLoot(l); // 촛불 모양은 main이 wisps로 다시 켠다
    } else {
      l.item = CODE_ITEM[ch];
    }
  }
  for (const s of run.zones) {
    const z = world.zones[s.id];
    z.powered = true;
    z.on = s.on;
    z.tripped = s.tripped;
    z.load = s.load;
    // 켜져 있던 구역은 이어하자마자 가로등이 그늘이를 막도록 다 켜진 상태에서 시작한다.
    z.level = z.on && !z.tripped ? 1 : 0;
    z.glow = z.level;
  }
}

// 처음 화면에 보여 줄 한 줄 요약
export function describeRun(run, totalZones) {
  const nights = run.run.nights ? ` · 버틴 밤 ${run.run.nights}번` : '';
  return `${run.env.day}일째 ${phaseName(run.env.hour)} · 밝힌 구역 ${run.zones.length}/${totalZones}${nights}`;
}
