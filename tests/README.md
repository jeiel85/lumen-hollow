# 시험

## Node 시험 (`tests/node/`)

브라우저 없이 게임 모듈(`src/`)을 불러와 돌린다. three.js는 `vendor/` 사본을 쓰고 canvas·localStorage는 흉내만 낸다(`env.mjs`). PR마다 `.github/workflows/game-test.yml`이 돌린다.

```bash
node --test --disable-warning=ExperimentalWarning "tests/node/*.test.mjs"
```

| 파일 | 지키는 것 |
|---|---|
| `world.test.mjs` | 구역·배전함·뒤질 곳 수, 판마다 물건 수와 같은 시드의 같은 배치, 건물 충돌·마을 경계, 밤·낮 빛 판정 |
| `story.test.mjs` | 이야기 소품·2~4장 무대를 놓아도 막힌 보급품 슬롯이 서버 목록과 같음, 1장 기록이 빈 슬롯에서 2.1m 밖, 1장 기록 자리 기준값, 배포한 옷가지 id 유지 |
| `chapters.test.mjs` | 2~4장 무대 이음매를 144/60/30/20fps로 양방향 통과, 바깥 경계, 순서 자유 구간의 진행 계산, `lumen.chapters` 저장(깨짐·더 새 버전) |
| `records.test.mjs` | 기록 파일 v1·v2 읽기·왕복, 모르는 id·범위 밖 값을 세어 건너뛰기, 합치기(합집합·이 기기 진행 보존·더 새 버전 `lumen.chapters`), 2~4장 표시 목록이 `chapters.js`와 같음 |
| `wardrobe.test.mjs` | 옷가지 꾸러미가 시작 지점에서 걸어서 닿는 자리·트럭에서 떨어진 자리에만 놓임(울타리로 막힌 합성 마을 포함), 옷장 미리보기 시선이 은신처 앞에서 트여 있고 트럭이 가리면 다른 방위 |
| `sw.test.mjs` | 서비스 워커 사전 캐시 목록의 파일이 모두 있고 `src/*.js`·import map·manifest 아이콘과 짝이 맞음. 배포 워크플로(`pages.yml`)도 배포 전에 이것만 돌린다 |

기록 자리나 옷가지를 **일부러** 바꿨을 때만 기준값을 다시 뽑는다. 옷가지 id는 더해지기만 한다(빠지면 시험이 실패한다).

```bash
node --disable-warning=ExperimentalWarning tests/node/gen-fixtures.mjs
```

## 브라우저 시험 (`tests/e2e/`)

헤드리스 Chrome을 CDP로 조종해 `?debug`의 `window.lumen`으로 실제 게임을 진행한다. 저장소 폴더를 정적 서버로 띄우고 돌린다(Chrome 위치는 환경 변수 `CHROME`, 없으면 운영체제 기본 위치).

```bash
python -m http.server 8000
```

```bash
node tests/e2e/walk.mjs
```

| 파일 | 하는 일 |
|---|---|
| `walk.mjs` | 순간이동 없이 입력 경로로 조향해 60fps 간격으로 걷기(2장 빈터 → 선착장 판자 → 나룻배, 3장 둑 ↔ 나루 판자) |
| `chapter1.mjs` | 1장 배전함 여덟 곳 → 엔딩 → 승리 화면 '다음 장'으로 2장 |
| `chapters.mjs` | 2~4장을 처음부터 끝까지(순서 자유 구간은 역순으로), 끝 화면과 수첩 |
| `resume.mjs` | 4장 첫 귀환 직후 나갔다 다시 열기, 마지막 밤 실패 → 다시 하기, 낮의 목표 그림자, 수첩 범위 |
| `settings.mjs` | 설정 화면의 온라인 켜기/끄기, 기록 파일 v2 내보내기·가져오기(v1 포함, 건너뛴 값 안내), 판 도중 가져오기 막기, 옷장 포커스·잠긴 항목·미리보기 시선, 저장소가 막힌 브라우저의 안내 |
| `sw.mjs` | 서비스 워커 두 빌드: 첫 설치 → 오프라인 실행 준비됨, 새 빌드 → 처음 화면 '다시 열기', 파일이 빠진 빌드·덜 퍼진 배포 → 지난 버전으로 준비됨(이유), 첫 설치 실패 → 이유 안내. 빌드 번호를 찍은 사본을 임시 폴더에 만들어 스스로 띄운다(인자는 포트) |
| `layout.mjs` | 휴대폰 가로 크기(예: `640 300`, `568 280`, `660 340`)에서 HUD 묶음(상태 창·미니맵·터치 버튼·보급품 단추·장 목표·남기기 창)이 겹치지 않음 |

인자는 `[url] [폭 높이]`이고, 스크린샷은 `tests/e2e/shots/`(git 제외)에 남는다. 실패가 있으면 종료 코드 1. GitHub Actions의 **Game tests → Run workflow**에서 `e2e`를 켜면 소프트웨어 GL로 같은 시험을 돌린다.

`lumen.step(초, 간격)`은 기본 0.05초 간격이다. 걷기·충돌처럼 프레임 간격에 따라 결과가 달라지는 것은 `1/60`을 준다(50ms 간격에서는 한 걸음이 0.26m라 좁은 틈을 우연히 넘는다).
