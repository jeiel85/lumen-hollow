import { load, save } from './storage.js';
import { tr } from './i18n.js';

// 밤의 변화(#57): 밤마다 대응이 달라지도록 해질녘에 그날 밤 사건을 정하고(첫 밤은 사건 없이), 둘째 밤 무렵부터
// 빛먹이·떼 그늘이가 섞여 나온다(언제부터인지는 난이도 단계, src/difficulty.js). 1장 판에만 있다(2~4장은 이야기가 밤을 정한다).
// 처음 만난 것은 이 기기에 남고(lumen.nights), 수첩 '밤의 기록'에 설명이 열린다. 형식은 DECISIONS.md "밤의 변화".

const KEY = 'lumen.nights';
const VERSION = 1;

// 그늘이 종류. look: 크기·눈빛(HDR)·눈 주위 빛, stat: 빠르기·흩어지기까지 비추는 시간·피해 배율.
export const KINDS = {
  shade: {
    name: tr('그늘이'),
    look: { size: 1, eye: [5.0, 6.5, 7.0], glow: [0.55, 0.85, 1.0] },
    stat: { speed: 1, tough: 1, damage: 1 },
    note: tr('잠든 사람의 그림자. 빛 안으로는 못 들어오고, 손전등으로 오래 비추면 흩어져 주인에게 돌아간다. 가로등 가장자리에 몰려 버티면 과부하가 걸린다.'),
  },
  eater: {
    name: tr('빛먹이'),
    look: { size: 1.3, eye: [6.5, 3.0, 8.5], glow: [0.85, 0.5, 1.0] },
    stat: { speed: 0.78, tough: 1.7, damage: 1 },
    note: tr('보랏빛 눈의 큰 그늘이. 사람보다 가로등을 먼저 찾아가 붙고, 하나만 붙어도 그 구역 차단기가 금세 내려간다. 가까이 오면 손전등이 깜박이며 배터리를 빨아들인다. 느리지만 오래 비춰야 흩어지니 가로등에 닿기 전에 막자.'),
    meet: tr('보랏빛 눈의 큰 그늘이 — 빛먹이다. 가로등에 붙으면 차단기가 금세 내려간다. 닿기 전에 손전등으로 흩어 놓자.'),
  },
  swarm: {
    name: tr('떼 그늘이'),
    look: { size: 0.68, eye: [5.5, 7.5, 5.0], glow: [0.6, 1.0, 0.75] },
    stat: { speed: 1.2, tough: 0.5, damage: 0.5 },
    note: tr('작은 그늘이 여럿이 한 방향에서 함께 온다. 빠르지만 금방 흩어지니 손전등을 쓸듯이 돌려 한꺼번에 비추자.'),
    meet: tr('작은 그늘이 떼가 몰려온다. 빠르지만 약하다 — 손전등을 쓸듯이 돌려 비추자.'),
  },
};

// 밤 사건. dusk: 해질녘 안내, note: 수첩 설명, short: 시계 옆에 붙는 한 단어.
export const EVENTS = {
  fog: {
    name: tr('짙은 안개'),
    short: tr('안개'),
    dusk: tr('오늘 밤은 안개가 짙다. 손전등이 멀리 닿지 않고, 그늘이는 가까이 와서야 보인다. 속삭임에 귀를 기울이자.'),
    note: tr('안개 낀 밤에는 멀리 보이지 않고 손전등이 짧게 닿는다. 화면 밖 그늘이 표시도 가까이 와서야 뜬다. 불빛 가까이 머물고 속삭임으로 다가오는 방향을 듣자.'),
  },
  surge: {
    name: tr('전압 출렁임'),
    short: tr('출렁임'),
    dusk: tr('변전소가 불안하게 웅웅거린다. 오늘 밤은 가로등이 깜박인 뒤 몇 초씩 꺼진다. 은신처 발전기와 트럭 작업등은 흔들리지 않는다.'),
    note: tr('전압이 출렁이는 밤에는 가까운 구역의 가로등이 깜박인 뒤 3초쯤 꺼진다. 그사이 그늘이가 들어온다. 깜박이면 손전등을 켜 두거나, 은신처 발전기·트럭 작업등 곁으로 옮기자.'),
  },
};

// 수첩 '밤의 기록'에 보이는 순서
export const NOTES = [
  ...Object.entries(KINDS).map(([id, k]) => ({ id, name: k.name, note: k.note })),
  ...Object.entries(EVENTS).map(([id, e]) => ({ id, name: e.name, note: e.note })),
];
const IDS = new Set(NOTES.map((n) => n.id));

// 해질녘에 그날 밤 사건을 고른다. 첫 밤(nights 0)은 사건 없이, 그 뒤로는 사건 없음 4 : 안개 3 : 출렁임 3이고
// 같은 사건이 이틀 연달아 오지 않는다. 돌려주는 값은 EVENTS의 이름 또는 null.
export function pickEvent(nights, prev, rand = Math.random) {
  if (nights <= 0) return null;
  const pool = [[null, 4], ['fog', 3], ['surge', 3]].filter(([id]) => !id || id !== prev);
  const total = pool.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [id, w] of pool) {
    if ((r -= w) < 0) return id;
  }
  return null;
}

export const isEvent = (v) => typeof v === 'string' && Object.prototype.hasOwnProperty.call(EVENTS, v);

// 처음 만난 그늘이 종류·밤 사건. 저장이 막혀도 이번 세션 동안은 기억한다.
export class NightLog {
  constructor() {
    this.seen = new Set();
    try {
      const raw = JSON.parse(load(KEY));
      if (raw && raw.v === VERSION && Array.isArray(raw.seen)) for (const id of raw.seen) if (IDS.has(id)) this.seen.add(id);
    } catch {
      // 손상된 기록은 처음부터
    }
  }

  has(id) {
    return this.seen.has(id);
  }

  // 처음 만났으면 남기고 true
  mark(id) {
    if (!IDS.has(id) || this.seen.has(id)) return false;
    this.seen.add(id);
    save(KEY, JSON.stringify({ v: VERSION, seen: [...this.seen] }));
    return true;
  }
}
