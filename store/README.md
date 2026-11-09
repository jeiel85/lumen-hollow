# 플레이 스토어 등록 자료

Lumen Hollow 안드로이드 앱(`com.jeiel85.lumenhollow`)을 Play Console에 등록할 때 쓰는 문구·답안·그래픽이다(이슈 #52, 추적 #61). 빌드·서명은 [../android/README.md](../android/README.md).

| 파일 | 쓰는 곳 |
|---|---|
| [listing.md](listing.md) | 스토어 등록정보: 앱 이름, 간단한·자세한 설명, 카테고리, 연락처, 그래픽 목록 |
| [app-content.md](app-content.md) | 앱 콘텐츠 신고: 개인정보처리방침, 광고, 앱 액세스, 콘텐츠 등급(IARC), 타겟층, 데이터 보안 |
| `graphics/` | 앱 아이콘 512, 대표 그래픽 1024×500 (`python -X utf8 store/graphics.py`로 다시 만든다) |
| `screenshots/` | 실제 게임 화면 스크린샷 — 휴대폰 세로 1080×1920, 가로 1920×1080 (`node store/shoot.mjs [url]`, 저장소를 정적 서버로 띄운 뒤) |
| [../privacy.html](../privacy.html) | 개인정보처리방침. 웹판과 함께 배포되어 `https://jeiel85.github.io/lumen-hollow/privacy.html` |

이 폴더는 웹판 배포에 들어가지 않는다(`.github/workflows/pages.yml`의 복사 목록 밖).

## 비공개 테스트까지 순서 (사용자 작업)

1. Play Console에서 앱 만들기: 앱 이름 `Lumen Hollow: 빛으로 버티는 밤`, 기본 언어 한국어, 게임, 무료.
2. 앱 콘텐츠: [app-content.md](app-content.md)대로 답한다.
3. 스토어 등록정보: [listing.md](listing.md)의 문구와 그래픽을 넣는다.
4. 테스트 → 비공개 테스트 → 트랙 만들기 → 테스터(구글 계정 이메일 목록, 12명 이상) → 새 버전에 AAB(`android/app/build/outputs/bundle/release/app-release.aab`)를 올린다. 처음 올릴 때 Play 앱 서명을 사용하도록 동의한다(업로드 키는 `android/README.md`).
5. 검토가 끝나면 테스터에게 참여 링크를 보내고, 12명 이상이 14일 연속 참여하도록 한다. 그동안 사전 출시 보고서(실기기 자동 실행)를 본다 — #53. 테스터 모으기(구글 그룹)·안내문·Threads 모집 글 초안·테스트 동안 볼 수치는 [testing.md](testing.md).
