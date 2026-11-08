// 난이도 단계(#56). 1장 판은 새로 시작할 때 고른 단계로 끝까지 가고(판 저장에 남는다), 2~4장은 설정의 단계를 바로 따른다.
// 최고 기록은 단계마다 따로 남긴다(records.js). 값은 tests/e2e/balance.mjs(완벽 조준 봇)로 잰 것: DECISIONS.md "난이도 단계".
//
// count: 밤마다 늘어나는 그늘이 수의 배율, cap: 그 상한, speed: 걷는·덮치는 빠르기 배율, damage: 한 번 닿을 때 체력 피해,
// deep: 깊은 밤 압박(등 뒤·두 방향에서 깨어남, 오래 버팀)이 시작되는 밤 번호(0부터, null이면 없음),
// gap: 깨어나는 간격 배율, drain: 손전등 배터리 닳는 빠르기 배율, load: 가로등 과부하가 오르는 빠르기 배율,
// tough: 흩어지기까지 비춰야 하는 시간 배율.
export const DIFFICULTY = {
  easy: { label: '쉬움', count: 0.6, cap: 8, speed: 0.82, damage: 8, deep: null, gap: 1.4, drain: 0.55, load: 0.45, tough: 0.8 },
  normal: { label: '보통', count: 1, cap: 14, speed: 1, damage: 15, deep: 2, gap: 1, drain: 1, load: 1, tough: 1 },
  hard: { label: '어려움', count: 1.3, cap: 18, speed: 1.12, damage: 18, deep: 0, gap: 0.8, drain: 1.25, load: 1.35, tough: 1.15 },
};
export const LEVELS = Object.keys(DIFFICULTY);
export const DEFAULT_LEVEL = 'normal';

// 고를 때 보이는 한 줄 설명
export const LEVEL_NOTE = {
  easy: '그늘이가 적고 느리다. 이야기를 따라가고 싶을 때',
  normal: '밤마다 그늘이가 늘고, 셋째 밤부터 등 뒤에서도 온다',
  hard: '첫 밤부터 사방에서 온다. 손전등과 가로등을 아껴 써야 한다',
};

export const isLevel = (v) => typeof v === 'string' && Object.prototype.hasOwnProperty.call(DIFFICULTY, v);
export const levelOf = (v) => DIFFICULTY[isLevel(v) ? v : DEFAULT_LEVEL];
