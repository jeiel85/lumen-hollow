// 이야기 대본 《돌아갈 자리》: 무전·대면 장면(SCENES), 남은 기록(CLUES), 장 정보(CHAPTERS)와 목표 문구(OBJECTIVES).
// 화면에 나오는 글이므로 콘텐츠다(조건은 LICENSE-CONTENT.md). 설정 요약은 docs/story.md. 영어판은 src/script.en.js(id로 짝짓기).
// 1장 장면이 언제 나오는지(when)와 무엇을 여는지(unlocks)는 여기서 정하고, 1장 기록이 마을 어디에 놓이는지는 src/story.js,
// 2~4장 장면을 트는 순서와 기록 자리는 src/chapters.js가 정한다.
//
// 장면 줄 형식
//   who  : SPEAKERS의 키. 'nar'는 서술(이름표 없음).
//   radio: 무전기로 들리는 줄인지. 빠지면 1장은 할머니·낯선 목소리가 무전, 대면 장면(inPerson)은 모두 육성으로 본다.
//   cam  : 이 줄에서 카메라를 옮긴다. at = 'player' | 'lighthouse' | 'dock' | 'town' | 기록 id | 장의 장소 이름,
//          cut = 암전 뒤 옮기기, zoom = 그때의 카메라 거리, hour = 시각 바꾸기,
//          weather = 'clear'(비 그침), fx = 'lighthouse'(등대 점등, 그늘이가 물러난다)
//   art  : 이 줄부터 컷신 그림 art/story/<이름>.webp를 장면 뒤에 깐다. null이면 걷고 3D 화면으로 돌아간다.
//          다음 art가 나올 때까지 이어지고, 바꿀 때마다 암전한다. 그림을 깐 채 끝난 장면은 암전한 뒤 걷힌다.
//          그림 파일은 sw.js 사전 캐시에도 넣는다(tests/node/sw.test.mjs가 짝을 맞춘다).
// when : 1장 — 'start' 첫 판 시작 · 'dusk' 첫 해질녘 · 'dawn' 첫 새벽 · { zones: n } 은신처를 포함해 고친 구역이 n개가 될 때
//        · 'win' 마지막 구역 · 'clue' 기록을 읽을 때(급수탑). 'chapter' — 2~4장, src/chapters.js가 차례에 맞춰 튼다.
// ch   : 몇 장의 장면·기록인지(빠지면 1장). 수첩은 다다른 장까지만 보여 준다.

import { isKo } from './i18n.js';
import { EN } from './script.en.js';

export const SPEAKERS = {
  me: '나', gran: '할머니', other: '낯선 목소리', nar: '',
  owner: '식당 주인', pharm: '약사', kid: '아이', doha: '도하', jeong: '오정석', patient: '낯선 환자', mom: '엄마',
};

export const CHAPTERS = [
  { n: 1, title: '돌아갈 자리' },
  { n: 2, title: '인계' },
  { n: 3, title: '빈 들것' },
  { n: 4, title: '점호' },
];

// 2~4장 화면 위쪽에 뜨는 지금의 목표
export const OBJECTIVES = {
  ferry: '배를 타고 할머니를 만나자',
  oil: '섬 등잔 넷에 기름을 채우자 — 당직실 뒤 기름통, 나룻배 기름병',
  vigil: '새벽까지 등잔 넷을 지키자 — 정시마다 돌계단 무전기',
  search: '다음 당직자를 부를 준비를 하자 — 당직실 인계부와 부두 보관함',
  call: '부두에서 다음 당직자를 부르자',
  leave: '나룻배를 타고 마을로 돌아가자',
  go: '강 건너 구호소에서 가족의 행방을 묻자',
  beds: '침상 다섯에 짐 봉투를 찾아 주자 — 짐 바구니는 구호소 탁자에',
  store: '둑길 창고에서 명부와 짐표의 번호를 맞춰 보자',
  levee: '둑길 가로등을 따라 구호소로 돌아가자',
  back: '구호소의 약사에게 명부와 짐표를 반납하자',
  annex: '별관 동쪽 교실로 가자',
  lamps: '두 환자가 밤을 넘길 수 있게 예비등을 켜자',
  wait: '교실 계단에서 밤을 기다리자',
  night: '운동장으로 다가오는 그림자를 비추자',
  rest: '물 한 모금 마시고 다시 비추자',
  class: '교실로 돌아가자',
  route: '배전반으로 가로등 하나를 꺼 그림자를 본관 창으로 보내자',
  broadcast: '방송대에서 아침 방송을 시작하자',
};

// 4장을 마친 뒤의 끝 화면
export const FINALE = {
  title: '돌아갈 자리',
  text: '첫 제보를 받아 적었다. 왼쪽 끈만 흰 운동화.',
};

export const SCENES = [
  // ---------------------------------------------------------------- 1장 · 돌아갈 자리
  {
    id: 'arrival',
    title: '남겨 둔 불',
    when: 'start',
    unlocks: ['log'],
    lines: [
      { who: 'nar', text: '그날 밤 엄마는 내 손에 손전등을 쥐여 주었다.', art: 'prologue-hand' },
      { who: 'nar', text: '불빛이 흔들리는 동안 엄마가 내 이름을 불렀다.' },
      { who: 'nar', text: '건전지 뚜껑이 벌어졌다. 엄마가 내 손가락을 그 위에 꼭 포개 주었다.' },
      { who: 'nar', text: '그 손을 다시 잡았을 때 엄마는 대답하지 않았다.' },
      { who: 'nar', text: '사흘 동안 이어지던 재난 방송은 넷째 날 끊겼다.' },
      { who: 'gran', text: '…지직… 누구든 들리면 루멘 할로로 오너라.' },
      { who: 'gran', text: '불을 다시 켜야 한다. 누구든 들리면…' },
      { who: 'nar', text: '도시 체육관 사람들에게 엄마와 집 주소를 부탁하고 길을 나섰다.', art: 'prologue-road' },
      { who: 'nar', text: '스무 날을 걸어, 어릴 적 살던 골짜기에 닿았다.' },
      { who: 'nar', text: '은신처의 발전기만 돌고 있었다. 비상함에는 퓨즈 하나가 남아 있었다.', art: null },
      { who: 'me', text: '할머니, 저예요. 은신처에 왔어요.' },
      { who: 'gran', text: '우리 강아지… 살아 있었구나.' },
      { who: 'gran', text: '해가 지면 불빛 곁에 있어라. 그늘이는 밤에 움직인다.' },
      { who: 'gran', text: '배전함에 퓨즈를 끼우면 그 구역을 복구할 수 있다.' },
      { who: 'me', text: '엄마는 도시에서 잠들었어요. 아무리 불러도 안 일어나요.' },
      { who: 'gran', text: '…알겠다. 여기서부터 불을 되찾자꾸나.' },
      { who: 'gran', text: '현관의 관리 일지도 읽어 봐라. 먼저 버틴 사람이 남긴 거다.' },
    ],
  },
  {
    id: 'dusk',
    title: '빛의 가장자리',
    when: 'dusk',
    lines: [
      { who: 'gran', text: '해가 진다. 가로등이나 은신처 불빛 곁으로 가거라.' },
      { who: 'gran', text: '그늘이가 오면 손전등을 비춰라. 흩어질 때까지 오래.' },
      { who: 'gran', text: '불빛 가장자리에 너무 오래 몰리면 차단기가 내려갈 수 있다.' },
      { who: 'gran', text: '꺼진 구역은 새벽에 다시 켜지니, 다른 불빛을 찾아라.' },
    ],
  },
  {
    id: 'dawn',
    title: '대답 없는 아침',
    when: 'dawn',
    lines: [
      { who: 'me', text: '할머니, 저 살아 있어요.' },
      { who: 'gran', text: '그래. 네 목소리를 들으니 이제 숨이 쉬어지는구나.' },
      { who: 'me', text: '밤에 저한테 오던 것들, 사람처럼 움직였어요.' },
      { who: 'gran', text: '네가 본 게 맞다. 내가 아는 것부터 차근차근 말해 주마.' },
      { who: 'gran', text: '무슨 일이 있어도 손전등을 거두지는 마라.' },
    ],
  },
  {
    id: 'light1',
    title: '첫 번째 수리',
    when: { zones: 2 },
    unlocks: ['notice'],
    lines: [
      { who: 'gran', text: '첫 배전함을 고쳤구나. 여기서도 전선이 반짝이는 게 보인다.' },
      { who: 'me', text: '등대에서 마을이 다 보여요?' },
      { who: 'gran', text: '그래. 하지만 모든 집 안까지 보이는 건 아니다.' },
      { who: 'me', text: '대체 무슨 일이 있었던 거예요?' },
      { who: 'gran', text: '의회가 등대를 끄는 잔치를 열었다. 불 하나로 불 백 개를 사겠다고.' },
      { who: 'gran', text: '광장 게시판에 그날 안내문이 있을 게다. 내가 써 둔 말도.' },
    ],
  },
  {
    id: 'shadows',
    title: '그림자가 떠난 자리',
    when: { zones: 3 },
    unlocks: ['diner', 'chart'],
    lines: [
      { who: 'gran', text: '두 번째 배전함이구나. 이제 말해 줘야겠다.' },
      { who: 'gran', text: '첫 불이 꺼지자 호수 밑 어둠이 선로를 타고 퍼졌다.' },
      { who: 'gran', text: '마을에서 도시까지, 불이 거의 한꺼번에 나갔다.' },
      { who: 'gran', text: '완전히 어두워진 곳에서 사람들의 그림자가 떨어져 나갔지.' },
      { who: 'me', text: '엄마 곁에 있었는데… 저는 왜 괜찮았을까요?' },
      { who: 'gran', text: '네 손전등이 네 그림자를 붙들었는지도 모른다. 확실하진 않다.' },
      { who: 'gran', text: '식당 메뉴판과 약국 기록을 봐라. 그날을 본 사람들이 남겼다.' },
    ],
  },
  {
    id: 'return',
    title: '돌아갈 자리',
    when: { zones: 4 },
    unlocks: ['diary'],
    lines: [
      { who: 'gran', text: '세 번째 배전함이다. 이제 숨기지 않으마.' },
      { who: 'gran', text: '그늘이는 잠든 사람에게서 떨어진 그림자다.' },
      { who: 'me', text: '그럼 제가 손전등으로 쫓은 건…' },
      { who: 'gran', text: '빼앗은 게 아니다. 빛을 오래 받으면 제 주인에게 돌아간다.' },
      { who: 'gran', text: '작은 빛이 집으로 가거든 끝까지 보거라. 누군가는 그때 눈을 뜬다.' },
      { who: 'me', text: '저한테 달려든 건요?' },
      { who: 'gran', text: '붙어 있을 자리를 찾아서다. 그래도 가까이 두면 네가 다친다.' },
      { who: 'me', text: '그럼 계속 비출게요. 돌아갈 때까지.' },
      { who: 'gran', text: '그래. 도하 일기도 찾아보거라. 그 아이는 이상을 먼저 봤다.' },
    ],
  },
  {
    id: 'founders',
    title: '남겨진 약속',
    when: { zones: 5 },
    unlocks: ['plaque', 'tower'],
    lines: [
      { who: 'gran', text: '네 번째 배전함. 절반을 고쳤구나.' },
      { who: 'me', text: '이 골짜기에서는 예전에도 이런 일이 있었어요?' },
      { who: 'gran', text: '1926년 겨울, 여기 살던 열두 가구가 같은 밤을 겪었다.' },
      { who: 'gran', text: '이웃의 그림자를 빛으로 되찾고 호수 섬에 첫 불을 세웠지.' },
      { who: 'gran', text: '그 뒤로 사람들은 선로와 불을 돌아가며 지켰다.' },
      { who: 'gran', text: '광장 명판에 남은 말을 읽어 봐라. 급수탑에서는 섬이 보인다.' },
    ],
  },
  {
    id: 'lookout',
    title: '건너편의 불',
    when: 'clue',
    lines: [
      { who: 'nar', text: '녹슨 사다리를 올라 난간을 붙잡았다.' },
      { who: 'nar', text: '숲 너머 호수 한가운데 꺼진 등대가 서 있었다.', cam: { at: 'lighthouse', cut: true, zoom: 20 } },
      { who: 'gran', text: '꼭대기의 작은 등잔이 보이니? 내가 여기 있다.' },
      { who: 'me', text: '배로 나오시면 안 돼요?' },
      { who: 'gran', text: '밤마다 물에서 어둠이 올라온다. 등잔을 두고 떠날 수 없다.' },
      { who: 'gran', text: '첫 불에 전기가 닿을 때 스위치를 올릴 사람도 있어야 하고.' },
      { who: 'nar', text: '물가 선착장에 작은 배가 묶여 있었다.', cam: { at: 'dock', zoom: 12 } },
      { who: 'gran', text: '길이 열리면 그 배로 오너라. 지금은 그곳까지 갈 수 없다.' },
    ],
  },
  {
    id: 'promise',
    title: '내 손으로',
    when: { zones: 6 },
    unlocks: ['letter'],
    lines: [
      { who: 'gran', text: '다섯 번째 배전함이구나. 더는 미룰 수 없겠다.' },
      { who: 'gran', text: '의회의 소등 결정에 반대했다. 그래 놓고 스위치를 내렸다.', art: 'confession-switch' },
      { who: 'me', text: '할머니가요?' },
      { who: 'gran', text: '옛 경고가 사실일까 무서웠다. 거짓일까 봐도 무서웠고.' },
      { who: 'gran', text: '끝까지 막지 못했다. 네 엄마가 잠든 데 내 몫이 있다.' },
      { who: 'me', text: '그걸 알고도 저한테 여기 오라고 하셨어요?' },
      { who: 'gran', text: '혼자서는 선로를 되살릴 수 없었다. 네게 부탁할 자격도 없는데.' },
      { who: 'me', text: '화가 나요. 그래도 엄마를 두고 멈출 수는 없어요.' },
      { who: 'gran', text: '…그래. 내 잘못은 내가 안고 가마. 네 손은 불을 켜는 데 써라.' },
      { who: 'gran', text: '우리 집 우편함에 부치지 못한 편지가 있다. 읽어 주겠니.' },
    ],
  },
  {
    id: 'line',
    title: '끊어 둔 길',
    when: { zones: 7 },
    unlocks: ['order'],
    lines: [
      { who: 'gran', text: '여섯 번째 배전함. 이제 옛 선로 이야기를 해야겠다.' },
      { who: 'gran', text: '소등식에 선로를 끊으라는 지시가 내려갔지만, 현장은 달랐다.' },
      { who: 'gran', text: '작업자가 선을 자르지 않고 접속기를 열어 뒀다.' },
      { who: 'gran', text: '네가 배전함들을 복구하는 동안 접속기는 다시 이어지도록 되어 있다.' },
      { who: 'me', text: '누가 일부러 돌아갈 길을 남긴 거네요.' },
      { who: 'gran', text: '혹시 불을 다시 켜야 할까 봐 그랬겠지. 헛간의 지시서를 봐라.' },
      { who: 'gran', text: '출력이 모자라 지금은 복구한 동네를 모두 밝힐 수 없다.' },
      { who: 'gran', text: '마지막 배전함을 고치면 출력이 돌아와 아홉 구역이 이어진다.' },
    ],
  },
  {
    id: 'last',
    title: '하나를 남기고',
    when: { zones: 8 },
    lines: [
      { who: 'gran', text: '일곱 번째 배전함이다. 이제 하나 남았다.' },
      { who: 'me', text: '마지막 걸 고치면 할머니가 등대를 켤 수 있어요?' },
      { who: 'gran', text: '전기가 닿으면 내가 스위치를 올리마. 이번에는 내 손으로.' },
      { who: 'me', text: '엄마도 깨어날까요?' },
      { who: 'gran', text: '그 그림자가 어디 있는지 모른다. 멀리 있다면 오래 걸릴 게다.' },
      { who: 'gran', text: '반드시 깨어난다고는 못 하겠다. 그래도 길을 열어 주자.' },
      { who: 'me', text: '네. 마지막 퓨즈를 찾을게요.' },
    ],
  },
  {
    id: 'finale',
    title: '돌아갈 자리',
    when: 'win',
    lines: [
      { who: 'nar', text: '마지막 퓨즈를 끼웠다. 전선을 따라 울림이 숲으로 달려갔다.' },
      { who: 'gran', text: '전기가 왔다. …얘야, 이번에는 내가 올리마.' },
      { who: 'nar', text: '무전 너머로 스위치가 올라가는 소리가 났다.' },
      { who: 'nar', text: '호수 가운데 첫 불이 다시 켜졌다.', cam: { at: 'lighthouse', cut: true, zoom: 18, hour: 21, weather: 'clear', fx: 'lighthouse' } },
      { who: 'gran', text: '보이니? 네가 여기까지 불을 보내 줬다.' },
      { who: 'nar', text: '빛이 호수를 돌자 숲 가장자리의 어둠이 물러났다.' },
      { who: 'nar', text: '마을의 창마다 불이 번졌다. 돌아갈 자리를 찾는 작은 빛들이 보였다.', cam: { at: 'town', cut: true, zoom: 19 } },
      { who: 'me', text: '할머니, 저 창가에도 이제 누가 있는 거죠?' },
      { who: 'gran', text: '그래. 이제 저 집에서도 밖에 누가 있나 내다볼 수 있겠구나.' },
      { who: 'other', text: '…지직… 강 건너 대피소다. 방금 불이 들어왔다. 누구 들리나?', art: 'finale-firstlight' },
      { who: 'me', text: '들려요! 여기는 루멘 할로예요. 저희도 살아 있어요.' },
      { who: 'gran', text: '들었니? 어둠이 지나간 길로 불도 가고 있다.' },
      { who: 'me', text: '엄마가 대답할 때까지 계속 부를래요.' },
      { who: 'gran', text: '그래. 날이 밝으면 배를 타고 내게 오너라.' },
      { who: 'gran', text: '그리고 함께 네 엄마를 찾으러 가자.' },
    ],
  },

  // ---------------------------------------------------------------- 2장 · 인계
  {
    id: 'ferry',
    ch: 2,
    title: '나루에서',
    when: 'chapter',
    inPerson: true,
    lines: [
      { who: 'nar', text: '어릴 때는 물살이 무서워 배 바닥만 봤다. 이번에는 건너편 난간을 보고 노를 저었다.', cam: { at: 'lake', cut: true, zoom: 16 }, art: 'ferry-row' },
      { who: 'gran', radio: true, text: '뱃머리를 조금만 왼쪽으로. 그래, 거기서부턴 물이 데려온다.' },
      { who: 'me', radio: true, text: '저 보여요?' },
      { who: 'gran', radio: true, text: '노 젓는 솜씨 보니 너 맞다.' },
    ],
  },
  {
    id: 'landing',
    ch: 2,
    title: '첫 대면',
    when: 'chapter',
    inPerson: true,
    unlocks: ['islandbook', 'spare'],
    lines: [
      { who: 'nar', text: '할머니가 내 손을 끌어 올렸다. 엄지에 반창고가 세 겹이었다.', cam: { at: 'pier', cut: true, zoom: 9 }, art: 'landing-hands' },
      { who: 'me', text: '손은 왜 그래요?' },
      { who: 'gran', text: '무전기 누르는 자리가 하도 쓰려서. 너는 밥 먹었니?' },
      { who: 'me', text: '엄마 얘기부터 해요.' },
      { who: 'nar', text: '할머니는 차려 둔 두 그릇 위에 다시 뚜껑을 덮었다.', cam: { at: 'table', zoom: 9 }, art: null },
      { who: 'gran', text: '해 지기 전에 등잔부터 채우자. 얘기는 불 옆에서 하마.' },
    ],
  },
  {
    // 등잔 넷을 다 채우면(#58). 끝나면 해가 지고 첫 밤 당직이 시작된다.
    id: 'rules',
    ch: 2,
    title: '당직 수칙',
    when: 'chapter',
    inPerson: true,
    lines: [
      { who: 'nar', text: '네 번째 심지에 불이 붙었다. 할머니가 돌계단에 앉아 내 손을 등잔 불빛 안으로 끌어 넣었다.', cam: { at: 'stoneSteps', cut: true, zoom: 8, hour: 18.3, weather: 'clear' }, art: 'watch-hands' },
      { who: 'gran', text: '당직은 셋만 지키면 된다. 불을 보고, 물을 보고, 무전을 듣는다.' },
      { who: 'gran', text: '보랏빛 눈은 사람보다 불을 먼저 먹으러 온다. 등잔에 닿기 전에 비춰라.' },
      { who: 'gran', text: '무전은 정시마다 한 번. 대답이 없으면 세 번까지 부르고, 그다음엔 적어 둬라.' },
      { who: 'me', text: '엄마 얘기는 언제 해 주실 거예요?' },
      { who: 'gran', text: '네 엄마 얘기는 네 엄마 앞에서 하마. 그래야 내가 도망을 못 간다.' },
      { who: 'me', text: '그럼 오늘 밤은 제가 들을게요. 할머니는 눈 좀 붙이세요.' },
      { who: 'gran', text: '스무 날 만에 처음 듣는 말이구나. 등잔 하나라도 꺼지면 깨워라.' },
      { who: 'nar', text: '할머니는 눕지 않았다. 무전기를 내 옆 계단에 내려 두고 앉은 채로 눈을 감았다.', art: null },
    ],
  },
  {
    id: 'relief',
    ch: 2,
    title: '대타',
    when: 'chapter',
    inPerson: true,
    lines: [
      { who: 'me', radio: true, text: '여기는 등대섬. 첫 불 지키는 사람, 한 명 구해요. 교대 시간은 같이 정해요.' },
      { who: 'other', radio: true, text: '식당 하는 사람이오. 국솥은 이웃한테 맡겼고. 내가 갈게요.' },
      { who: 'gran', text: '배 멀미 심한 양반이 어딜 온다고.' },
      { who: 'owner', radio: true, text: '그래서 나도 밥은 안 먹었수.' },
      { who: 'nar', text: '잠시 뒤 마을에서 온 작업배가 닿았다. 무전기에서 듣던 목소리가 바로 옆에서 났다.', cam: { at: 'pier', cut: true, zoom: 10 } },
      { who: 'nar', text: '주인은 돌계단에 앉아서야 얼굴빛이 돌아왔다.' },
      { who: 'owner', text: '내 가게 문 안 열리디? 잠금쇠가 안에서 휘었어. 뒷문으로 손님들 내보냈지.' },
      { who: 'gran', text: '불 한 바퀴 도는 거 보고 인계란에 이름 쓰시오.' },
      { who: 'nar', text: '할머니는 그가 마지막 획을 긋고 나서야 외투를 집었다.' },
    ],
  },
  {
    id: 'bowls',
    ch: 2,
    title: '두 그릇',
    when: 'chapter',
    inPerson: true,
    lines: [
      { who: 'me', text: '아까 그 밥, 이제 먹어도 돼요?', cam: { at: 'table', cut: true, zoom: 9 } },
      { who: 'nar', text: '할머니는 식은 밥을 주먹만 하게 뭉쳤다. 한 덩이는 내 손에, 한 덩이는 외투 주머니에 넣었다.', art: 'bowls-riceballs' },
      { who: 'pharm', radio: true, text: '강 건너 대피소입니다. 도시에서 환자들을 옮겼어요. 가족 찾는 분은 이쪽으로 오세요.' },
      { who: 'me', radio: true, text: '엄마가 살던 동네도요?' },
      { who: 'pharm', radio: true, text: '이름을 잃어버린 분들이 있어요. 오시면 짐부터 같이 봐요.' },
      { who: 'nar', text: '우리는 빈 밥그릇을 포개 놓고 나룻배를 밀었다. 마을 나루에서부터는 강둑을 따라 걸었다.' },
    ],
  },

  // ---------------------------------------------------------------- 3장 · 빈 들것
  {
    id: 'count',
    ch: 3,
    title: '열두 번째 칸',
    when: 'chapter',
    inPerson: true,
    lines: [
      { who: 'pharm', text: '한서윤이에요. 처음에 약국으로 온 분은 열둘. 여기까지 열둘 다 데려왔어요.', cam: { at: 'tent', cut: true, zoom: 10 } },
      { who: 'me', text: '다 깨어났어요?' },
      { who: 'pharm', text: '열한 분요. 마지막 한 분은 여전히 주무세요. 그런데 그분은 이 마을 사람이에요.' },
      { who: 'nar', text: '들것 옆에 신발이 열한 켤레 가지런히 놓였다. 깨어난 사람들이 환자를 기다리고 있었다.', cam: { at: 'shoes', zoom: 7 }, art: 'count-shoes' },
      { who: 'pharm', text: '도시에서 온 분들은 본관 처마 밑 병상에 모셨어요. 비가 들이쳐 표찰 다섯 장이 번졌고요.', cam: { at: 'beds', cut: true, zoom: 10 }, art: null },
      { who: 'me', text: '엄마도 거기 있을까요?' },
      { who: 'pharm', text: '가서 봐요. 짐 바구니 봉투도 제 침상을 찾아 줘요. 깨어난 분들이 거들 거예요.' },
    ],
  },
  {
    // 본관 침상 다섯에 짐 봉투를 다 찾아 주면(#58). 창고 열쇠는 여기서 받는다.
    id: 'fivebeds',
    ch: 3,
    title: '다섯 자리',
    when: 'chapter',
    inPerson: true,
    unlocks: ['manifest', 'tag'],
    lines: [
      { who: 'nar', text: '다섯 자리에 새 표찰을 꽂았다. 다섯 중에 엄마는 없었다.', cam: { at: 'beds', cut: true, zoom: 9 } },
      { who: 'me', text: '다섯 분 다 누가 찾고 있겠죠. 저처럼요.' },
      { who: 'pharm', text: '그래서 표찰이 중요해요. 찾는 사람은 이름보다 물건을 먼저 기억하거든요.' },
      { who: 'pharm', text: '이제 명부를 봐요. 둑길 창고에서 장부와 짐표를 가져와 줄래요?' },
      { who: 'nar', text: '약사가 손수건에 싼 열쇠를 내밀었다. 창고까지 이어진 둑길에 진흙이 말라붙어 있었다.' },
    ],
  },
  {
    id: 'key',
    ch: 3,
    title: '엄마의 열쇠',
    when: 'chapter',
    inPerson: true,
    lines: [
      { who: 'me', text: '우리 집 열쇠예요. 사진 뒤에 엄마가 쓴 글도 있어요.', art: 'key-photo' },
      { who: 'gran', text: '그 먼 도시에서 여기까지 누가 업고 왔을까.' },
      { who: 'me', text: '제가 엄마한테 가는 줄 알았어요. 엄마도 오고 있었어요.' },
      { who: 'nar', text: '스무 날 동안 나는 비어 있는 집에 대고 매일 밤 잘 자라고 했었다.' },
      { who: 'pharm', radio: true, text: '잘하셨어요. 이제는 어디다 대고 말해야 하는지도 알잖아요.' },
    ],
  },
  {
    id: 'knock',
    ch: 3,
    title: '문 밖의 아이',
    when: 'chapter',
    inPerson: true,
    unlocks: ['transfer'],
    lines: [
      { who: 'kid', radio: true, text: '대피소 당번 아저씨 찾아요. 아, 아빠. 나 도하야. 내 가방 혹시 거기 있어?' },
      { who: 'me', radio: true, text: '도하야, 아빠는 어디서 다시 만났니?' },
      { who: 'doha', radio: true, text: '식당이요. 그날 대피소 문을 두드렸는데 안 열려서요. 식당 뒤에는 불이 있었어요.' },
      { who: 'jeong', radio: true, text: '다음 날 찾았어요. 그놈이 식당 뒷문 등 밑에서 자고 있더라고.' },
      { who: 'doha', radio: true, text: '손전등 켰어요. 근데 졸려서 아빠 찾는 건 아침에 하려고요.' },
      { who: 'nar', text: '아이는 말끝마다 아빠 무전기의 단추를 너무 일찍 놓았다. 이제는 그 짧은 침묵도 겁나지 않았다.' },
    ],
  },
  {
    // 밤 둑길을 건너 구호소에 닿으면(#58). 이어서 약사의 인계 쪽지를 받는다.
    id: 'stretchers',
    ch: 3,
    title: '열둘을 데려온 길',
    when: 'chapter',
    inPerson: true,
    lines: [
      { who: 'pharm', text: '그 둑길을 밤에 혼자 건너왔어요?', cam: { at: 'tent', cut: true, zoom: 10 } },
      { who: 'me', text: '가로등이 자꾸 꺼졌어요. 그래도 다음 불이 보였어요.' },
      { who: 'pharm', text: '우리는 들것 여섯에 열두 분을 나눠 싣고 그 길로 왔어요. 두 번 오갔죠.', art: 'stretchers-levee' },
      { who: 'pharm', text: '앞사람은 손전등을, 뒷사람은 들것을 들었어요. 쉴 때는 들것을 불 밑에 내려놓고요.' },
      { who: 'pharm', text: "기록에는 '이송 무사'라고만 썼어요. 실은 무서워서 숫자만 셌어요. 하나부터 열둘까지." },
      { who: 'me', text: '그래서 열둘 다 데려오신 거네요.' },
      { who: 'pharm', text: '다 데려왔다는 말은 마지막 한 분이 깨셔야 맞는 말이에요.', art: null },
    ],
  },
  {
    id: 'chair',
    ch: 3,
    title: '보호자 자리',
    when: 'chapter',
    inPerson: true,
    lines: [
      { who: 'nar', text: '별관 창에 석유등 하나가 비쳤다. 그 옆으로 의자 하나가 비어 있었다.', cam: { at: 'classroom', cut: true, zoom: 9 } },
      { who: 'gran', text: '얘야, 엄마한테 내 얘기는 내가 하마.' },
      { who: 'me', text: '네. 근데 먼저 엄마 손 좀 잡을게요.' },
      { who: 'nar', text: '엄마 손바닥에는 손전등 손잡이와 같은 너비의 굳은살이 있었다. 내 엄지가 그 자리에 꼭 들어갔다.', cam: { at: 'windowBed', zoom: 6 }, art: 'chair-hands' },
    ],
  },

  // ---------------------------------------------------------------- 4장 · 점호
  {
    id: 'roll',
    ch: 4,
    title: '두 사람',
    when: 'chapter',
    inPerson: true,
    unlocks: ['roster'],
    lines: [
      { who: 'nar', text: '창가에 엄마가, 문가에는 약국에서 온 마지막 환자가 누워 있었다.', cam: { at: 'classroom', cut: true, zoom: 9 } },
      { who: 'pharm', text: '본관에서 여기로 옮겼어요. 이분 가족은 아직 연락이 없어요.' },
      { who: 'gran', text: '네 엄마 옆에는 내가 앉으마. 손전등은 네가 가져가거라.' },
      { who: 'me', text: '그날도 엄마가 그랬어요. 나만 불 안에 남겨 놓고요.' },
      { who: 'gran', text: '그럼 오늘은 둘 다 불 안에 두자.' },
    ],
  },
  {
    id: 'firsthome',
    ch: 4,
    title: '문가',
    when: 'chapter',
    inPerson: true,
    lines: [
      { who: 'nar', text: '손전등 끝에서 풀린 빛이 문가 쪽 창을 넘었다. 문가에서 누군가 기침했다.', cam: { at: 'doorBed', cut: true, zoom: 7 } },
      { who: 'patient', radio: true, text: '내 신발 어디 있소?' },
      { who: 'jeong', radio: true, text: '여기요. 천천히요. 기다린 사람들이 열한 명이나 돼요.' },
      { who: 'nar', text: '무전기를 쥔 손에 힘이 풀렸다. 창가에서는 아무 소리도 나지 않았다.', cam: { at: 'player', cut: true } },
      { who: 'me', text: '엄마인 줄 알았어요.' },
      { who: 'pharm', text: '잠깐 앉을래요? 내가 비출게요.' },
      { who: 'me', text: '물 한 모금만 주세요. 아직 비출 수 있어요.' },
    ],
  },
  {
    id: 'secondhome',
    ch: 4,
    title: '창가',
    when: 'chapter',
    inPerson: true,
    lines: [
      { who: 'nar', text: '운동장 끝에서 그림자 하나가 달려왔다. 나는 두 손으로 손잡이를 쥐었다.' },
      { who: 'nar', text: '빛이 교실 쪽으로 건너갔다. 한참 뒤에 무전 단추 누르는 소리가 났다.', cam: { at: 'windowBed', cut: true, zoom: 7 } },
      { who: 'nar', text: '할머니가 창턱의 무전기를 엄마 손에 대 주었다.', art: 'mom-wakes' },
      { who: 'mom', radio: true, text: '…그거 아직도 쓰니? 건전지 뚜껑 잘 빠지는데.' },
      { who: 'me', radio: true, text: '테이프 붙였어요.' },
      { who: 'mom', radio: true, text: '잘했네.' },
      { who: 'nar', text: '할 말이 수없이 많았다. 처음 나온 건 웃음이었다. 나는 불 켜진 계단을 두 칸씩 올랐다.', cam: { at: 'steps', cut: true, zoom: 9 }, art: null },
    ],
  },
  {
    id: 'truth',
    ch: 4,
    title: '세 사람',
    when: 'chapter',
    inPerson: true,
    lines: [
      { who: 'gran', text: '첫 불을 끈 건 엄마다. 너한테 전화할 시간이 있었는데도 안 했다.', cam: { at: 'windowBed', cut: true, zoom: 7 } },
      { who: 'mom', text: '무서웠지?' },
      { who: 'gran', text: '응.' },
      { who: 'mom', text: '나도 무서웠어. 애 손에 불 쥐여 주고 아무것도 안 보였어.' },
      { who: 'nar', text: '할머니는 외투 주머니에서 납작해진 주먹밥을 꺼냈다. 엄마가 그것을 세 조각으로 갈랐다.', art: 'three-riceball' },
      { who: 'mom', text: '다음엔 전화해. 무서우면 특히.' },
      { who: 'gran', text: '그러마.' },
      { who: 'me', text: '나도 그 전화 받을래요.' },
      { who: 'nar', text: '우리는 같은 의자 끝에 걸터앉아서 찬밥을 먹었다. 아무도 먼저 일어나지 않았다.' },
    ],
  },
  {
    // 세 사람 다음, 아직 밤(#58). 운동장 가로등 하나를 꺼 세 번째 그림자에게 본관으로 가는 길을 낸다.
    id: 'third',
    ch: 4,
    title: '남은 창',
    when: 'chapter',
    inPerson: true,
    lines: [
      { who: 'nar', text: '문가에서 약사가 낮게 불렀다. 운동장 끝에서 그림자 하나가 오도 가도 못하고 있었다.', cam: { at: 'yard', cut: true, zoom: 16 } },
      { who: 'pharm', text: '본관으로 가려는 것 같은데 운동장 불이 길을 막아요. 당직실 배전반은 셋 중 둘만 켜져요.' },
      { who: 'me', text: '하나를 끄면 길이 나겠네요. 끈 자리는 제가 비출게요.', cam: { at: 'classroom', cut: true, zoom: 9 } },
      { who: 'mom', text: '다녀와. 이번엔 우리가 창가에서 보고 있을게.' },
      { who: 'gran', text: '가거라. 남의 집 창도 창이다.' },
    ],
  },
  {
    id: 'broadcast',
    ch: 4,
    title: '첫 아침 방송',
    when: 'chapter',
    inPerson: true,
    lines: [
      { who: 'nar', text: '아침에 나는 할머니 대신 송신 단추를 눌렀다. 엄지 마디로 누르니 아프지 않았다.', art: 'broadcast-morning' },
      { who: 'me', radio: true, text: '여기는 루멘 할로, 강 건너 옛 학교입니다. 사람을 찾는 분은 듣고 계세요.' },
      { who: 'me', radio: true, text: '이름을 몰라도 돼요. 마지막으로 본 곳과 갖고 있던 물건을 말해 주세요.' },
      { who: 'nar', text: '짧은 잡음 뒤에 첫 대답이 왔다.' },
      { who: 'other', radio: true, text: '파란 운동화예요. 왼쪽 끈만 흰색이고요.' },
      { who: 'me', radio: true, text: '잠깐만요. 적고 있어요. 왼쪽 끈만 흰색.' },
      { who: 'nar', text: '창가에서 엄마가 새 종이를 내 쪽으로 밀어 주었다.', cam: { at: 'classroom', cut: true, zoom: 10 }, art: null },
    ],
  },
  {
    // 첫 아침 방송 바로 다음, 끝 화면 전(#58). 첫 제보는 3장 본관 11번 침상과 이어진다.
    id: 'reports',
    ch: 4,
    title: '첫 제보 다음',
    when: 'chapter',
    inPerson: true,
    lines: [
      { who: 'pharm', text: '본관 11번 침상 분이 새벽에 깨셨어요. 신발부터 찾으셨대요.', cam: { at: 'beds', cut: true, zoom: 9 } },
      { who: 'me', radio: true, text: '파란 운동화 찾으시는 분, 들리세요? 그분 강 건너 옛 학교 본관에 계세요. 새벽에 깨셨어요.' },
      { who: 'other', radio: true, text: '…끈이 끊어져서 제가 흰 끈으로 매 줬거든요. 지금 갈게요.' },
      { who: 'nar', text: '두 번째 제보가 들어왔다. 세 번째도. 엄마가 받아 적고 나는 송신 단추를 눌렀다.', art: 'reports-memo' },
      { who: 'nar', text: '할머니는 점호판 아래에 새 당직표를 그렸다. 이번에는 칸이 모자랐다.' },
    ],
  },
];

// kind: 글이 적힌 물건. 읽는 화면의 모양(종이·칠판·놋쇠 명판·편지지)과 1장 마을에 놓이는 소품을 정한다.
// where: 수첩과 안내에 쓰는 위치 설명. hand: 종이 위 손글씨. note: 읽고 난 뒤 '나'의 한마디.
// match: 3장 대조 화면에 띄울 본문 줄 번호. flip: 뒤집어야 보이는 면(3장 짐표) — 두 단서를 맞춰 본 뒤에만 뒤집을 수 있다.
// cue·bag: 3장 본관 침상 표찰에만 — 환자에게 남은 단서와 짝이 맞는 짐 봉투(상호작용 안내에 나온다).
export const CLUES = [
  // ---------------------------------------------------------------- 1장
  {
    id: 'log',
    title: '은신처 관리 일지',
    where: '은신처 현관 옆 게시대',
    kind: 'clipboard',
    body: [
      '[비상 대피소 · 당번 오정석]',
      '소등식 23:30. 주민들은 광장으로 갔다. 나는 당번.',
      '23:59. 등대 불이 꺼지고 박수가 들렸다.',
      '00:00. 마을 정전. 비상 발전기 가동. 도시도 정전이라는 무전.',
      '00:02. 광장에서 비명. 바닥에 있던 사람들 그림자가',
      '둘째 날. 방송: 불빛 곁에 머물 것. 잠든 사람을 어둠에 두지 말 것.',
      '넷째 날. 방송이 끊겼다. 문에 규칙을 붙였다.',
      '해 지기 전 들어올 것. 불을 지킬 것. 밤에는 문밖을 확인하지 말 것.',
      '여섯째 날. 문밖에서 딸 목소리가 났다. 겁이 나 문을 못 열었다.',
      '날이 밝으면 찾으러 간다. 발전기와 비상함의 퓨즈는 남겨 둔다.',
    ],
    note: '그가 딸을 찾았는지는 적혀 있지 않았다.',
  },
  {
    id: 'notice',
    title: '등대 소등식 안내',
    where: '남쪽 광장 게시판',
    kind: 'poster',
    body: [
      '등대 소등식에 주민 여러분을 초대합니다.',
      '오래된 등대 하나를 쉬게 하고, 그 비용으로 가로등 백 개를 켭니다!',
      '그믐밤 자정, 광장에 모여 따뜻한 차를 나눕니다.',
      '— 루멘 골짜기 마을 의회',
    ],
    hand: '그 불은 배만을 위한 불이 아니다. 끄지 마라. — 윤',
    note: '할머니 글씨 아래로 누군가 접었다 편 자국이 남아 있었다.',
  },
  {
    id: 'diner',
    title: '식당 메뉴판 뒷면',
    where: '골목식당 앞 메뉴판',
    kind: 'chalk',
    body: [
      '자정. 등대가 꺼졌다. 손님들이 박수 쳤다.',
      '가게 불이 나갔다. 벽의 그림자들이 먼저 일어났다.',
      '그림자들이 문밖으로 나가자 주인들이 식탁에 엎드렸다.',
      '숨은 쉰다. 불러도 안 깬다.',
      '라이터를 켜면 내 그림자는 발밑에 붙어 있다.',
      '기름이 얼마 안 남',
    ],
    note: '문은 안에서 잠겨 있었다. 유리창의 김만으로는 안을 알 수 없다.',
  },
  {
    id: 'chart',
    title: '약국 야간 기록',
    where: '한빛약국 앞 기록판',
    kind: 'clipboard',
    body: [
      '[한빛약국 · 한서윤]',
      '사흘째. 업혀 온 환자 열두 명. 호흡과 맥박 유지, 의식 없음.',
      '조명 아래에서도 환자의 그림자가 관찰되지 않음.',
      '바깥의 그림자 하나에 불빛을 오래 비춘 뒤 작은 빛이 집 쪽으로 이동함.',
      '이후 보호자가 환자의 각성을 보고함. 관련 여부는 추가 확인 필요.',
      '도시에서 온 사람도 같은 증상을 보았다고 함.',
      '남은 랜턴은 하나. 오늘 밤은',
    ],
    note: '셔터 너머는 조용했다. 나는 기록판을 제자리에 놓았다.',
  },
  {
    id: 'diary',
    title: '도하의 일기장',
    where: '동북 주택가 노란 책가방',
    kind: 'diary',
    body: [
      '10월 24일 맑음. 등대 할머니가 밤은 물처럼 고인다고 했다.',
      '다들 웃었다. 나는 물이 넘치면 어디로 갈지 궁금했다.',
      '10월 28일 흐림. 시험으로 등대를 잠깐 껐다.',
      '내 그림자가 손을 한 박자 늦게 흔들었다. 엄마는 못 봤다.',
      '10월 30일 비. 내일 소등식에 손전등을 가져갈 거다.',
      '그림자가 길을 잃으면 불러 줄 거다. 여기라고.',
    ],
    note: '책가방 안에는 건전지 하나가 굴러다녔다. 도하는 어디 있을까.',
  },
  {
    id: 'plaque',
    title: '광장 동상 명판',
    where: '남쪽 광장 동상',
    kind: 'brass',
    body: [
      '1926년 겨울, 이 골짜기의 열두 가구가 서로의 불을 지켰다.',
      '그림자를 잃은 이웃이 돌아오도록 호수 섬에 첫 불을 세웠다.',
      '불을 지키는 일은 한 사람의 일이 아니다.',
      '첫 불을 끄지 마라. 골짜기의 밤이 깨어난다.',
    ],
    note: '어릴 적 매일 지나던 글이었다. 이제야 끝까지 읽었다.',
  },
  {
    id: 'tower',
    title: '급수탑',
    where: '약국 거리 급수탑 사다리',
    kind: 'ladder',
    scene: 'lookout',
  },
  {
    id: 'letter',
    title: '부치지 못한 편지',
    where: '동남 주택가 우편함',
    kind: 'letter',
    body: [
      '우리 강아지에게.',
      '내일 밤 등대 불을 끈단다. 의회는 내 손으로 끄라고 한다.',
      '말렸지만 다들 오래된 겁이라고 했다. 나도 반은 그렇게 믿었다.',
      '사실이라면 무섭고, 아니라면 내가 지킨 세월이 허무할까 봐 무섭다.',
      '오늘은 네 엄마에게 전화하려다 말았다. 걱정만 시킬까 봐.',
      '겨울에는 엄마랑 내려오렴. 네가 살던 방에 불을 켜 두마.',
      '— 할머니가',
    ],
    note: '현관등은 꺼져 있었다. 편지 끝은 접히지 않은 채였다.',
  },
  {
    id: 'order',
    title: '전력소 작업 지시서 #1031',
    where: '헛간 들판 전력소 공구함',
    kind: 'clipboard',
    body: [
      '작업: 등대 선로 차단. 의회 결정 제12호.',
      '경로: 헛간 변전함 → 숲길 전신주 → 선착장 → 등대섬.',
      '일시: 소등 직후. 광역 송전망과 이어진 선로를 분리할 것.',
      '작업자 메모: 절단 대신 복구 연동 접속기를 열어 둔다.',
      '각 배전함을 복구하면 접속기가 다시 이어지도록 설정했다.',
      '출력 제한 중에는 일부 가로등만 사용. 마지막 배전함 복구 시 전 구역 공급.',
      '아홉 구역 공급이 확보되면 등대에서 램프를 켤 수 있다.',
      '1926년 선로를 누군가는 지금까지 고쳐 왔다. 이번에는 내가 남긴다.',
    ],
    note: '끊긴 줄 알았던 길에 누군가 돌아올 방법을 남겼다.',
  },

  // ---------------------------------------------------------------- 2장
  {
    id: 'islandbook',
    ch: 2,
    title: '인계부',
    where: '등대섬 당직실 벽',
    kind: 'diary',
    body: [
      '등명기는 전기가 들어오면 돌아간다. 당직자는 불이 도는지 물가에서 눈으로 확인할 것.',
      '다음 사람 얼굴을 보고 자리를 뜰 것.',
      '윤씨 앞 차례 박씨. 박씨 앞 차례 한씨.',
    ],
    note: '마지막 장에 할머니 이름만 스물세 번 적혀 있었다.',
  },
  {
    id: 'spare',
    ch: 2,
    title: '예비 송수신기 종이띠',
    where: '등대섬 부두 보관함',
    kind: 'letter',
    body: [
      '예비 송수신기. 단추가 뻑뻑합니다. 손톱 말고 엄지 마디로 눌러 주세요.',
      '반납자 오정석. 애가 자꾸 무전기를 장난감으로 알아서 끈은 높이 매 둡니다.',
    ],
  },
  // 당직 일지 세 장(#58): 섬 등잔을 채우면 그 밑 깡통에서 나온다(부두 등잔 밑은 비어 있다).
  {
    id: 'page1926',
    ch: 2,
    title: '당직 일지 · 1926년 겨울',
    where: '등대 아래 등잔 밑',
    kind: 'diary',
    body: [
      '1926년 동지. 첫 불 당직은 열두 집이 하룻밤씩 돌아가며 선다.',
      '오늘 밤 자는 사람 다섯. 곁에 앉을 사람 다섯. 남는 둘은 등잔을 본다.',
      '자는 사람 곁을 비우지 말 것. 다음 사람 얼굴을 보고 자리를 뜰 것.',
    ],
    note: '한 장에 글씨가 열두 가지였다.',
  },
  {
    id: 'page1979',
    ch: 2,
    title: '당직 일지 · 1979년 장마',
    where: '돌계단 등잔 밑',
    kind: 'diary',
    body: [
      '호수에 배 다닐 일이 없어졌다고 당직을 둘로 줄였다.',
      '의회는 불이 잘 도니 괜찮다고 한다.',
      '불이 잘 도는 건 누가 보고 있어서다.',
      '박씨 물러남. 다음 당직 윤씨네 맏딸.',
    ],
    note: "맏딸 아래에 할머니 글씨로 '네' 한 글자가 적혀 있었다.",
  },
  {
    id: 'pagelast',
    ch: 2,
    title: '당직 일지 · 올해',
    where: '당직실 처마 등잔 밑',
    kind: 'diary',
    body: [
      '소등 다음 날부터 혼자. 인계받을 사람 없음.',
      '열이레째. 대답 없음. 대답 없음. 대답 없음. 적어 둔다.',
      '부두 등잔 밑은 비워 둔다. 다음 사람 자리다.',
      '스무 날째.',
    ],
    note: '스무 날째 칸에는 내 이름 첫 글자만 있었다. 나머지는 번져 있었다.',
  },

  // ---------------------------------------------------------------- 3장
  {
    id: 'manifest',
    ch: 3,
    title: '이송 명부',
    where: '둑길 창고 벽',
    kind: 'clipboard',
    body: [
      '시내 체육관 출발. 집을 찾아가 모셔 온 분은 처음 발견한 주소로 등록함.',
      '이름 아는 분은 성명, 모르는 분은 발견 장소와 소지품을 적을 것.',
      '17번. 아파트 계단참. 한쪽 양말만 신음. 오른손이 무언가 쥐었던 모양으로 굳어 있음.',
      '목적지 변경. 본관 만실. 강 건너 옛 학교 별관.',
    ],
    match: 2,
  },
  {
    id: 'tag',
    ch: 3,
    title: '17번 소지품 봉투',
    where: '둑길 창고 선반',
    kind: 'letter',
    body: ['현관 열쇠 하나. 고무줄 두 개. 작은 사진 한 장.'],
    match: 0,
    flip: {
      label: '사진 뒤집기',
      body: ['사진 속에서 나는 동상 머리 위로 손을 뻗고 있었다. 뒷면에 엄마 글씨가 있었다.'],
      hand: '윤 여사님은 이 사진 보면 또 애 떨어진다고 하시겠지.',
    },
  },
  {
    id: 'transfer',
    ch: 3,
    title: '약사의 인계 쪽지',
    where: '구호소 약사',
    kind: 'letter',
    body: [
      '별관 동쪽 교실 17번.',
      '보호자가 오면 이름부터 묻지 말고 환자 손을 잡게 해 주세요.',
      '방문객 의자는 내 것을 가져가세요.',
    ],
    hand: '— 서윤',
  },
  // 본관 처마 밑 침상 다섯의 새 표찰(#58). cue: 환자에게 남은 단서, bag: 짝이 맞는 짐 봉투(구호소 탁자의 바구니).
  // 봉투를 제 침상에 놓으면 표찰을 읽고 수첩에 남는다. note는 곁의 깨어난 이웃이 하는 말.
  {
    id: 'bed3',
    ch: 3,
    title: '새 표찰 · 3번',
    where: '본관 처마 밑 병상',
    kind: 'letter',
    cue: '왼손에 회색 털장갑 한 짝',
    bag: '오른손 장갑 한 짝, 시내버스표',
    body: ['3번 · 체육관 동쪽 문', '회색 털장갑, 시내버스표'],
    note: '깨어난 이웃 — "깨 보니 손부터 시리더라고요. 장갑은 끼워 드릴게요."',
  },
  {
    id: 'bed8',
    ch: 3,
    title: '새 표찰 · 8번',
    where: '본관 처마 밑 병상',
    kind: 'letter',
    cue: '콧등에 안경 자국',
    bag: '금테 안경, 왼쪽 다리에 테이프',
    body: ['8번 · 시장 버스 정류장 의자', '금테 안경, 왼쪽 다리에 테이프'],
    note: '깨어난 이웃 — "테이프 감은 안경은 못 버려요. 우리 영감도 그랬어요."',
  },
  {
    id: 'bed11',
    ch: 3,
    title: '새 표찰 · 11번',
    where: '본관 처마 밑 병상',
    kind: 'letter',
    cue: '오른발에만 파란 운동화, 끈도 파랑',
    bag: '왼쪽 파란 운동화, 끈은 흰색',
    body: ['11번 · 체육관 계단', '파란 운동화, 왼쪽 끈만 흰색'],
    note: '깨어난 이웃 — "끈을 바꿔 맨 걸 보니 누가 매어 준 신발이네요."',
  },
  {
    id: 'bed14',
    ch: 3,
    title: '새 표찰 · 14번',
    where: '본관 처마 밑 병상',
    kind: 'letter',
    cue: '손가락에 감긴 겨자색 털실',
    bag: '뜨다 만 겨자색 목도리, 대바늘 둘',
    body: ['14번 · 아파트 경비실', '뜨다 만 겨자색 목도리'],
    note: '깨어난 이웃 — "코 풀리지 않게 바늘은 꽂아 둘게요. 깨면 이어 뜨시겠지."',
  },
  {
    id: 'bed20',
    ch: 3,
    title: '새 표찰 · 20번',
    where: '본관 처마 밑 병상',
    kind: 'letter',
    cue: '손등에 볼펜으로 그린 별',
    bag: '크레용 그림 한 장, 별 다섯과 사람 둘',
    body: ['20번 · 체육관 매점 앞', '손등에 볼펜 별, 아이 그림 한 장'],
    note: '깨어난 이웃 — "별 안 지워지게 소매를 내려 드려요. 그린 아이가 확인할 거예요."',
  },
  {
    // 읽지 않아도 진행된다(#58). 구호소 탁자, 짐 바구니 옆.
    id: 'carrybook',
    ch: 3,
    title: '약사의 이송 수첩',
    where: '구호소 탁자',
    kind: 'clipboard',
    body: [
      '[이송 · 한빛약국 → 강 건너 구호소 · 한서윤]',
      '첫째 밤. 들것 여섯, 앞뒤로 둘씩. 열두 분 가운데 여섯 분. 이송 무사.',
      '둘째 밤. 나머지 여섯 분. 둑길 가로등 둘 꺼짐. 손전등으로 대신함. 이송 무사.',
      '나흘 뒤부터 한두 분씩 깨어남. 깨면 먼저 신발을 찾음.',
      '열한 분 깨어남. 깬 분들이 들것을 다시 멤. 이제 메는 사람이 더 많음.',
      '남은 한 분. 곁에 앉을 사람을 정할 것.',
    ],
    note: '숫자 옆마다 작은 점이 찍혀 있었다. 하나씩 센 자국 같았다.',
  },

  // ---------------------------------------------------------------- 4장
  {
    id: 'roster',
    ch: 4,
    title: '당직실 점호판',
    where: '운동장 당직실',
    kind: 'chalk',
    body: [
      '오늘 자는 사람 둘. 곁에 앉을 사람 둘.',
      '창가 윤씨 딸 — 어머니가 옴.',
      '문가 성명 미상 — 당직 오정석.',
      '남는 자리 없음. 모두 곁에 사람이 있음.',
    ],
  },
  // 옛 학교 곳곳의 이름표 다섯(#58). 찾지 않아도 진행되고, 끝 화면에 찾은 수가 나온다.
  {
    id: 'tag1958',
    ch: 4,
    title: '이름표 · 박○○',
    where: '본관 신발장',
    kind: 'letter',
    body: ['1학년 1반 박○○', '1958년'],
    note: '인계부의 박씨네 아이였을까. 이름 두 자는 닳아 없었다.',
  },
  {
    id: 'tag1960',
    ch: 4,
    title: '이름표 · 윤○○',
    where: '구령대 밑',
    kind: 'letter',
    body: ['6학년 1반 윤○○', '1960년'],
    note: '할머니 글씨였다. 받침을 크게 쓰는 버릇이 그때도 있었다.',
  },
  {
    id: 'tag1963',
    ch: 4,
    title: '이름표 · 한○○',
    where: '운동장 당직실 뒤',
    kind: 'letter',
    body: ['4학년 2반 한○○', '1963년'],
    note: '약사님과 같은 성이다. 물어보면 웃을 것 같았다.',
  },
  {
    id: 'tag1986',
    ch: 4,
    title: '이름표 · 오정석',
    where: '교실 교탁',
    kind: 'letter',
    body: ['2학년 1반 오정석', '1986년'],
    note: '아저씨 이름이었다. 2학년 글씨가 도하 글씨랑 똑같았다.',
  },
  {
    id: 'tag1991',
    ch: 4,
    title: '이름표 · 이름 없음',
    where: '교실 뒤 책상 서랍',
    kind: 'letter',
    body: ['3학년 2반 ○○○', '1991년'],
    note: '이름 칸이 지워져 있었다. 뒷면에 할머니 글씨로 우리 집 옛 전화번호가 적혀 있었다.',
  },
];

// 이름표 다섯(4장, 찾지 않아도 된다). 끝 화면에 찾은 수를 보인다.
export const NAMETAGS = ['tag1958', 'tag1960', 'tag1963', 'tag1986', 'tag1991'];
// 본관 침상 다섯의 표찰(3장). 봉투를 고르는 차례는 번호 순서다.
export const BEDS = ['bed3', 'bed8', 'bed11', 'bed14', 'bed20'];

// ---------------------------------------------------------------- 영어판(#60)
// 화면 언어가 영어면 같은 id의 영어 대본(src/script.en.js)으로 글만 바꾼다. 장면 순서·말하는 사람·그림·카메라는 그대로다.
// 줄 수가 다르면 그 장면은 바꾸지 않는다(tests/node/i18n.test.mjs가 짝을 지킨다).
function localize(en) {
  Object.assign(SPEAKERS, en.speakers);
  for (const c of CHAPTERS) c.title = en.chapters[c.n] ?? c.title;
  Object.assign(OBJECTIVES, en.objectives);
  Object.assign(FINALE, en.finale);
  for (const s of SCENES) {
    const e = en.scenes[s.id];
    if (!e || e.lines.length !== s.lines.length) continue;
    s.title = e.title;
    s.lines.forEach((l, i) => {
      l.text = e.lines[i];
    });
  }
  for (const c of CLUES) {
    const e = en.clues[c.id];
    if (!e) continue;
    for (const k of ['title', 'where', 'note', 'hand', 'cue', 'bag']) if (typeof e[k] === 'string') c[k] = e[k];
    if (Array.isArray(e.body) && e.body.length === c.body.length) c.body = e.body.slice();
    if (c.flip && e.flip) c.flip = { ...c.flip, ...e.flip };
  }
}
if (!isKo) localize(EN);
