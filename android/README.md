# 안드로이드 앱 (Capacitor)

웹판과 같은 게임 파일을 Capacitor로 감싼 플레이 스토어용 앱이다(이슈 #49, 결정은 [DECISIONS.md](../DECISIONS.md) "안드로이드 앱 포장"). 웹판은 빌드 없이 저장소 그대로 배포하고, 앱만 `scripts/build-app.mjs`로 필요한 파일을 `dist-app/`에 모아 담는다.

| 항목 | 값 |
|---|---|
| 패키지 이름 | `com.jeiel85.lumenhollow` (바꿀 수 없다) |
| 대상 API | 36 (Android 16), 최소 24 |
| 웹 출처 | `https://localhost` (Capacitor 기본). 앱 기록(localStorage)이 이 출처에 묶여 있어 `server.hostname`·`androidScheme`을 바꾸면 기록이 사라진다 |
| 전체 화면 | `capacitor.config.json`의 `SystemBars.hidden` |
| 뒤로 가기 | `src/native.js` → `src/main.js` `onBack()`: 열린 창 닫기, 판 도중 일시정지, 장면은 무시, 처음 화면에서만 앱 종료 |

## 준비

- Node 24, Android SDK(플랫폼 36, 빌드 도구 36)
- **JDK 21**: Capacitor 8은 Java 21로 컴파일한다. Android Studio에 들어 있는 것을 쓰면 된다.

```bash
npm ci
```

## 빌드

저장소 루트에서. `JAVA_HOME`이 JDK 17이면 Android Studio의 jbr로 바꿔서 실행한다.

```bash
npm run sync
```

```bash
cd android && ./gradlew assembleRelease bundleRelease
```

- APK(기기 설치 시험): `android/app/build/outputs/apk/release/app-release.apk`
- AAB(플레이 스토어 업로드): `android/app/build/outputs/bundle/release/app-release.aab`
- 올릴 때마다 `android/app/build.gradle`의 `versionCode`를 1 올리고, `versionName`을 게임 태그와 맞춘다.
- 게임 코드(`src/` 등)를 고쳤으면 `npm run sync`부터 다시 한다. `android/app/src/main/assets/public`은 빌드 산출물이라 저장소에 넣지 않는다.

## 앱 안 결제 (2~4장, #51)

Play Billing Library 8.0.0을 직접 쓰는 앱 안 플러그인(`app/src/main/java/.../BillingPlugin.java`)이 일회성 상품 **`story_ch2_4`** 하나를 판다. 맛보기는 2장 '첫 대면' 장면까지이고, 그 뒤는 사야 열린다. 결정은 [DECISIONS.md](../DECISIONS.md) "2~4장 한 번 결제".

Play Console에서 할 일(순서대로):

1. 결제 프로필(#54). 유료 상품을 만들려면 먼저 있어야 한다.
2. 결제 권한이 든 이 빌드(v0.22.0 이상)를 아무 트랙(비공개 테스트)에 올린다. 결제 권한이 든 빌드가 올라가야 상품을 만들 수 있다.
3. 수익 창출 → 제품 → 일회성 상품: 상품 ID `story_ch2_4`(지우면 같은 ID를 다시 못 쓴다), 이름 '이야기 2~4장', 가격(2,500~3,900원 중), 활성화.
4. 설정 → 라이선스 테스트: **비공개 테스트에 넣은 계정을 모두** 넣는다. 넣지 않은 테스터는 실제로 결제된다. 라이선스 테스터는 '항상 승인되는 테스트 카드'로 돈이 나가지 않는다.
5. 확인: 라이선스 테스터 폰에서 2장 첫 대면 뒤 결제 화면 → 사기 → 바로 2장 찾기로 이어짐 → 앱을 지웠다 다시 깔아도 열림 → 주문 관리에서 그 주문을 환불 → 앱을 다시 열면 잠김.

상품·라이선스 테스터를 갖추기 전에 테스터에게 줄 빌드는 결제 잠금을 끄고 만든다(프로덕션 빌드는 반드시 켠다).

```bash
LUMEN_PAYWALL=off npm run aab
```

릴리스 빌드는 WebView 원격 디버깅이 꺼져 있어, 결제 화면을 에뮬레이터에서 볼 때는 `assembleDebug`로 만든 디버그 앱에 `adb forward tcp:<포트> localabstract:webview_devtools_remote_<pid>`로 붙는다. Play 스토어가 없는 에뮬레이터 이미지(google_apis)에서는 결제 서비스에 닿지 못해(응답 3) '연결하지 못했어요'가 뜨는 것이 정상이다.

## 서명 키

- 업로드 키스토어 원본: 메인 체크아웃의 `.keystore/lumen-hollow-upload.jks`와 `.keystore/release-signing.properties`(비밀번호·별칭). git에서 제외되고(`.gitignore`, `.git/info/exclude`), 저장소에 절대 커밋하지 않는다.
- 백업: `G:\내 드라이브\모바일 앱 개발\Lumen Hollow\릴리즈 키스토어\` (2026-11-08 바이트 비교로 확인)
- 업로드 키 인증서 SHA-256: `4F:78:9B:D8:5A:DA:DD:AD:87:F9:B6:9F:4D:1D:4C:EA:28:AB:6F:34:3D:BC:EF:04:A3:18:5C:B5:76:76:7F:23`
- 플레이 앱 서명을 쓴다: 구글이 앱 서명 키를 보관하고, 이 키는 업로드용이다. 잃어버리면 Play Console에서 업로드 키 재설정을 신청할 수 있다.
- 워크트리처럼 `.keystore/`가 없는 곳에서는 `ANDROID_KEYSTORE_PATH`·`ANDROID_KEYSTORE_PASSWORD`·`ANDROID_KEY_ALIAS`·`ANDROID_KEY_PASSWORD` 환경 변수로 넘긴다. 둘 다 없으면 릴리스 빌드가 멈춘다(서명 안 된 파일을 만들지 않는다).

## 에뮬레이터 확인

```bash
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

릴리스 빌드는 WebView 원격 디버깅이 꺼져 있어 화면은 `adb exec-out screencap`, 로그는 `adb logcat -s Capacitor/Console`로 본다. 앱은 운영 서버에 붙으므로, 시험할 때는 설정에서 온라인 보급품을 끄거나 만든 기록을 지운다(성공 지표 오염 방지). WebView 140 미만(에뮬레이터 기본 이미지 등)에서는 Capacitor가 위쪽 막대 자리만큼 여백을 두어 화면 위에 어두운 띠가 보인다. 최신 WebView에서는 화면 끝까지 그린다.
