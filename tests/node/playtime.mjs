// 2~4장 보강(#58)으로 늘어난 플레이 시간 추정. 실제 플레이 측정이 아니라 모형이다(BACKLOG.md: 비공개 테스트에서 실측).
//   node tests/node/playtime.mjs
// 모형: 장면 줄 = 글자 수/42(찍히는 속도) + 1.2초(읽고 넘기기), 기록 = 글자 수/12 + 2초, 걷기 = 직선 거리 × 1.3 / 5.2m/s,
// 길게 누르기 = dur + 0.4초, 밤 = 게임 시간 × HOUR_SECONDS / 그 장의 시간 배율. 헤매기·실패·다시 하기는 넣지 않는다(하한).
import { makeGame, load } from './env.mjs';

const { SCENES, CLUES } = await load('src/script.js');
const { HOUR_SECONDS } = await load('src/env.js');
const { SPEED } = await load('src/player.js');
const { chapters: C } = await makeGame({ chapters: true });

const scene = (id) => SCENES.find((s) => s.id === id).lines.reduce((t, l) => t + l.text.length / 42 + 1.2, 0);
const doc = (id) => {
  const c = CLUES.find((x) => x.id === id);
  const n = [...(c.body ?? []), c.note ?? '', c.hand ?? ''].join('').length;
  return n / 12 + 2;
};
const P = (p) => ({ x: p.x, z: p.z });
const spot = (id) => P(C.spot(id));
const walk = (pts) => {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  return (d * 1.3) / SPEED;
};
const hold = (dur, n = 1) => n * (dur + 0.4);
const R = C.river;
const L = C.lakeRefs;

const parts = {
  2: {
    '등잔 넷·기름 걷기': walk([C.pierEnd, spot('oilBottle'), spot('lampDock'), spot('lampSteps'), spot('lampTower'), spot('oilCan'), spot('lampHut')]),
    '기름 줍기·등잔 채우기': hold(0.6, 2) + hold(1.0, 4),
    '당직 일지 세 장': doc('page1926') + doc('page1979') + doc('pagelast'),
    '「당직 수칙」': scene('rules') + scene('landing') - scene('landing'),
    '첫 밤 당직(18.3→6시, 0.6배)': ((24 - 18.3 + 6) * HOUR_SECONDS) / 0.6,
  },
  3: {
    '봉투 다섯 나르기(바구니 ↔ 침상)': walk(R.bedSpots.flatMap((b) => [spot('basket'), P(b)])) + walk([R.bedSpots[4], spot('basket')]) * 0,
    '봉투 들기·놓기': hold(0.5, 5) + hold(0.6, 5),
    '새 표찰 다섯': ['bed3', 'bed8', 'bed11', 'bed14', 'bed20'].reduce((t, id) => t + doc(id), 0),
    '「다섯 자리」': scene('fivebeds'),
    '둑길 밤길(창고 → 구호소) + 출렁임 기다림': walk([R.storeOut, R.tentMark]) + 12,
    '「열둘을 데려온 길」': scene('stretchers'),
    '약사의 이송 수첩(선택)': doc('carrybook'),
  },
  4: {
    '「남은 창」': scene('third'),
    '교실 → 배전반 → 침상, 배전반 두 번': walk([R.classOut, spot('board'), R.bedsMark]) + hold(0.8, 2),
    '세 번째 그림자가 서쪽 길로 오기 + 비추기': (() => {
      const pts = [R.target3, ...R.lanes.west];
      let d = 0;
      for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      return d / 2.6 + 3.2 / 1.2 + 1.5;
    })(),
    '이름표 다섯 줍기(선택)': walk([R.stepsOut, ...['tag1986', 'tag1991', 'tag1960', 'tag1958', 'tag1963'].map(spot)]) + ['tag1958', 'tag1960', 'tag1963', 'tag1986', 'tag1991'].reduce((t, id) => t + doc(id) + 0.9, 0),
    '「첫 제보 다음」': scene('reports'),
  },
};

const fmt = (s) => `${Math.floor(s / 60)}분 ${String(Math.round(s % 60)).padStart(2, '0')}초`;
let all = 0;
for (const [ch, items] of Object.entries(parts)) {
  const sum = Object.values(items).reduce((a, b) => a + b, 0);
  all += sum;
  console.log(`\n${ch}장 +${fmt(sum)}`);
  for (const [k, v] of Object.entries(items)) console.log(`  ${k.padEnd(30)} ${fmt(v)}`);
}
// 지금 2~4장 장면·기록 전체(보강 전후 비교용)
const ch = (x) => x.ch ?? 1;
const sceneAll = SCENES.filter((s) => ch(s) > 1).reduce((t, s) => t + scene(s.id), 0);
const docAll = CLUES.filter((c) => ch(c) > 1 && c.body).reduce((t, c) => t + doc(c.id), 0);
console.log(`\n보강으로 늘어난 합(하한): +${fmt(all)}`);
console.log(`2~4장 장면 ${SCENES.filter((s) => ch(s) > 1).length}개 읽기 ${fmt(sceneAll)}, 기록 ${CLUES.filter((c) => ch(c) > 1 && c.body).length}개 ${fmt(docAll)}`);
