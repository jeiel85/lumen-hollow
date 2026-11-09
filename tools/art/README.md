# 그림 만들기 자료 (`art/`)

`art/`의 그림(처음 화면 키 아트·로고·메뉴 패널·누름단추·아이콘·컷신)은 코덱스 CLI의 이미지 생성으로 원본을 뽑고
아래 스크립트로 다듬었다. 그림을 고치거나 더할 때 같은 화풍·치수를 맞추도록 그때 쓴 프롬프트와 가공 스크립트를 둔다(#45).
게임에는 들어가지 않는다(배포 단계·앱 빌드가 복사하지 않는다). 생성 원본(PNG)은 크기 때문에 두지 않는다.

## 그림을 바꿀 때의 규칙

- **내용을 바꾸면 파일 이름도 바꾼다**(예: `ferry-row.webp` → `ferry-row-2.webp`). 그림은 버전 쿼리 없는 주소라,
  같은 이름으로 덮어쓰면 GitHub Pages의 10분 캐시 동안 옛 그림이 보이고, 서비스 워커 캐시는 다음 빌드까지 옛 그림을 준다.
  이름을 바꾸면 쓰는 곳(`index.html`·`style.css`·대본 줄의 `art`)과 `sw.js` 사전 캐시 목록을 같이 고친다.
  짝이 안 맞으면 `tests/node/sw.test.mjs`가 잡는다.
- 컷신 그림을 더하면 `src/dialogue.js` `ART_ALT`에 화면 낭독기용 짧은 설명(한국어 원문 + `src/i18n.en.js` 영어)도 더한다
  (`tests/node/story.test.mjs`, `i18n.test.mjs`).
- 1장 컷신만 `sw.js` 사전 캐시에 넣는다. 웹판은 1장 데모이고, 2~4장 그림은 앱이 담는다.
- 처음 화면 그림(`title-wide`·`title-tall`)을 바꾸면 `lqip.py`로 흐린 미리보기를 다시 만들어 `style.css`에 붙인다.

## 만드는 순서

1. **생성**: `gen.sh <이름> <프롬프트 파일> [참고 그림...]` → `raw/<이름>.png`.
   `codex exec`에 "이미지 생성 도구를 정확히 한 번, 프롬프트를 그대로" 머리말을 붙여 넘기고, 출력의 `session id:`로
   `~/.codex/generated_images/<session id>/`에서 그림을 찾는다(다른 세션도 같은 곳에 그림을 만들어 "가장 최근 파일"로 고르면 섞인다).
   - 참고 그림(`-i`)은 **절대 경로**여야 한다. 상대 경로면 생성이 실패한다(Git Bash에서는 `pwd -W`로 Windows 경로).
   - 크기: 16:9를 부탁하면 1672×941, 세로 941×1672, 정사각 1254. 3:2는 1536×1024.
   - 그림 속 글자(로고)는 정확히 나오지만 확대해서 확인한다. 한 부분만 고칠 때는 원본을 `-i`로 주고
     "이 부분만 바꿔" 편집 프롬프트를 쓴다(`key-*-b`, `story-key-photo-b`, `logo-*-en`).
2. **가공**:
   - 컷신·키 아트(불투명): `python -X utf8 proc.py photo raw/<이름>.png <출력>.webp` (품질 80, 크기 그대로)
   - 로고·아이콘(검은 바탕에 빛나는 그림 → 투명): 알파 = 가장 밝은 채널(8 이하 잡음은 0), 색 = 원색/알파.
     `proc.py logo|glow`
   - 메뉴 자산 한꺼번에: `python -X utf8 menu.py` — 키 아트, 로고(가로 1240·두 줄 840), 배전함 패널(640px 9조각, 테두리 띠 40px),
     누름단추(높이 96px, 바깥 검정만 귀퉁이 채우기로 지움), 아이콘(4×2 칸 → 96px), 로고 전구 위치(`style.css` `.logo-glow`의 퍼센트)
   - 영어 로고: `python -X utf8 logo-en.py <생성 폴더> <저장소>` — 한국어 로고의 내용 상자 크기·자리에 맞춰 넣는다.
3. **확인**: 게임에서 처음 화면·메뉴(가로·세로·휴대폰 가로)와 컷신을 찍어 본다. 인물은 장면마다 얼굴이 달라지므로
   손·뒷모습·실루엣 위주로 연출한다.

## 프롬프트 (`prompts/`)

`gen.sh`가 붙이는 머리말을 뺀 본문이다. 이름은 생성할 때의 이름(`raw/`)이고, `-a`·`-b`는 고쳐 뽑은 차례다.

| 프롬프트 | 결과 | 참고 그림(`-i`) |
|---|---|---|
| `key-wide-a`·`key-tall-a` → `key-wide-b`·`key-tall-b` | `title-wide`·`title-tall` | 게임 화면 스크린샷 → `-a` 결과(인물을 어른 비율로 고친 편집) |
| `logo-a`, `logo-stack` | `logo-wide`, `logo-stack` | 없음, 가로 로고 |
| `logo-wide-en`, `logo-stack-en` | `logo-wide-en`, `logo-stack-en` | 한국어 로고(편집) |
| `panel-a`, `button-a`, `icons-a` | `panel`, `btn-lit`·`btn-dark`, `icon-*` | 없음 |
| `story-*`(13장) | `art/story/<이름>` | 키 아트(화풍 맞추기). `story-key-photo-b`는 `story-key-photo` 결과의 짐표 숫자만 17로 고친 편집 |
| `story-watch-hands`·`story-stretchers-levee`·`story-reports-memo` | 2~4장 보강(#58) 때 더한 셋 | 비슷한 기존 컷신을 PNG로 바꿔 붙였다(당시 폴더에 `landing-hands`·`count-shoes`·`broadcast-morning` 참고본) |

`story-*`의 첫 문단(화풍·색·인물 연출·"글자 없음")은 같은 머리말이다. 새 컷신은 이 머리말에 장면 설명을 붙여 쓴다.
