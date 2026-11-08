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
