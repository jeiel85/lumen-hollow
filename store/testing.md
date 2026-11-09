# 비공개 테스트 안내 (#53)

개인 개발자 계정이라 **테스터 12명 이상이 14일 연속 참여한 비공개 테스트**를 거쳐야 프로덕션 출시를 신청할 수 있다. 이 문서는 ① 테스트를 여는 쪽(개발자)의 준비, ② 테스터에게 그대로 보낼 안내문(한국어·영어), ③ Threads 모집 글 초안, ④ 테스트 기간에 볼 수치다. Play Console의 단계별 화면 이름은 `README.md` 4~5번에 있다.

## 1. 여는 쪽 준비 (개발자)

- **테스터 목록은 구글 그룹으로** 받는 것을 권한다. Play Console 비공개 테스트 트랙의 테스터에 '구글 그룹'(그룹 이메일)을 넣으면, 테스터가 그룹에 스스로 가입하는 것만으로 테스터가 된다. 공개 모집 글에 이메일을 받지 않아도 되고, 목록을 손으로 고칠 일이 없다. 그룹은 '누구나 가입'으로 두고, 그룹 이메일로 메일이 가지 않게 '게시 권한: 관리자만'으로 둔다. 지인·가족은 이메일 목록으로 따로 넣어도 된다(둘 다 쓸 수 있다).
- **올릴 빌드**: 상품 `story_ch2_4`와 라이선스 테스터를 갖추기 전에는 **결제 잠금을 끈 빌드**(`lumen-hollow-<버전>-paywall-off.aab`)를 올린다. 테스터가 2~4장까지 막히지 않는다. 결제 시험을 시작할 때 비공개 테스터를 **모두** 라이선스 테스터에 넣은 뒤 잠금 켠 빌드로 바꾼다(`android/README.md` '앱 안 결제'). 넣지 않은 테스터는 실제로 결제된다.
- **참여 링크**는 트랙의 테스터 탭에 나온다(보통 `https://play.google.com/apps/testing/com.jeiel85.lumenhollow`). 첫 검토가 끝나야 링크로 설치할 수 있다.
- **14일 세기**: 테스터가 테스트에서 나가거나 그룹을 떠나면 그 사람은 빠진다. 12명에 딱 맞추지 말고 15명 안팎을 모은다. Play Console 대시보드의 '프로덕션 액세스' 카드에 진행 상황이 나온다.
- 테스트를 연 날을 #53에 적는다. 이야기 집계(아래 4절)를 그날부터 본다.

## 2. 테스터에게 보낼 안내문

### 한국어

```
Lumen Hollow 비공개 테스트에 참여해 주셔서 고맙습니다.

■ 설치
1) (구글 그룹으로 받는 경우) 이 그룹에 가입해 주세요: [그룹 주소]
2) 참여 링크를 열고 '테스터 되기'를 눌러 주세요: [참여 링크]
3) 같은 화면의 'Google Play에서 다운로드'로 설치합니다. 플레이 스토어에 로그인한 구글 계정이 1)·2)와 같아야 해요.
※ 14일 동안 테스트에서 나가지 말고 앱을 지우지 말아 주세요. 출시 조건이 '12명이 14일 연속 참여'예요.

■ 해 주시면 좋은 것
· 1장 '돌아갈 자리'를 끝까지 해 보기. 밤을 여러 번 넘겨야 하지만, 중간에 그만둬도 다음에 이어서 할 수 있어요. 쉬움·보통·어려움 중 편한 난이도로 하시면 돼요.
· 테스트판은 2~4장도 열려 있어요. 시간이 되면 이어서 해 주세요.
· 설정 → 화면 → 'FPS 표시'를 켜면 화면 구석에 숫자가 나와요. 버벅일 때 그 숫자를 알려 주세요.
· 설정 → 온라인 보급품은 켜 둔 채로 두면 좋아요. 이야기 장면을 어디까지 봤는지가 이름 없이 날짜별 횟수로만 집계돼서, 어디서 그만두게 되는지 고치는 데 써요(개인정보처리방침 3절).

■ 의견 보내는 법
· 플레이 스토어 앱 페이지의 '비공개 의견'(테스터에게만 보여요), 또는 메일 jeiel85@gmail.com
· 적어 주시면 고치기 쉬운 것: 폰 기종·안드로이드 버전, 어디서 막혔는지/헷갈렸는지, 어색한 문장, 버벅인 장면과 FPS 숫자, 스크린샷
· 특히 궁금한 것: 화면 위·아래가 잘리거나 노치에 가리는 곳이 있는지, 다른 앱에 다녀오거나 화면을 껐다 켠 뒤 소리가 다시 나는지, 설정 → 기록 → 내보내기·가져오기가 되는지
```

### English

```
Thanks for joining the Lumen Hollow closed test.

Install
1) (If we use a Google Group) Join this group: [group address]
2) Open the opt-in link and tap "Become a tester": [opt-in link]
3) Install with "Download it on Google Play". Use the same Google account in the Play Store as in steps 1-2.
Please stay in the test and keep the app installed for 14 days. Release requires 12 testers for 14 days in a row.

What helps most
- Play Chapter 1, "A Place to Return", to the end. It takes several nights, but you can quit and continue later. Any difficulty is fine.
- Chapters 2-4 are unlocked in the test build. Please continue if you have time.
- Settings -> Display -> "Show FPS" puts a number in the corner. Tell us that number when the game stutters.
- Please leave Settings -> Online supply caches on. Story scenes reached are counted only as daily totals without any ID, to find where players stop (see the privacy policy).

Feedback
- "Private feedback" on the Play Store page (only visible to testers), or email jeiel85@gmail.com
- Useful details: phone model and Android version, where you got stuck or confused, awkward English, scenes that stuttered with the FPS number, screenshots
- We especially want to know: anything cut off at the top/bottom or hidden by a notch, whether sound comes back after switching apps or turning the screen off and on, and whether Settings -> Records -> Export/Import works
```

> 영어 안내문의 메뉴 이름은 영어판 화면 글(`src/i18n.en.js`)과 맞춘다. 화면 글을 바꾸면 여기도 고친다.

## 3. Threads 모집 글 초안

**게시는 사용자가 원고를 확인하고 승인한 뒤에만** `threads-announce` 스킬로 올린다. 참여 링크가 열린 뒤(첫 검토 통과 뒤) 올리고, `[ ]` 자리를 실제 주소로 채운다. 결제 잠금을 끈 빌드를 올렸을 때만 '2~4장까지 모두 열려 있다'가 맞다.

본문 (주제 태그 `인디 게임`, 이미지는 Pages의 `docs/night.jpg` 같은 공개 스크린샷)

```
빛으로 버티는 밤 — Lumen Hollow를 플레이 스토어에 내려고 비공개 테스터를 모집합니다.

정전된 한국 읍내에서 낮에는 퓨즈를 모으고, 밤에는 손전등과 가로등 불빛으로 그림자 '그늘이'를 버티는 생존 게임이에요. 네 장짜리 이야기가 있고, 테스트판에서는 2~4장까지 모두 열려 있어요.

안드로이드 폰과 구글 계정만 있으면 되고, 14일 동안 앱을 지우지 않고 두어 주시면 돼요. 참여 방법은 답글에 적었어요.

웹에서 1장을 먼저 해 볼 수 있어요.
https://jeiel85.github.io/lumen-hollow/
```

답글

```
참여 방법
1) 구글 그룹 가입: [그룹 주소]
2) 참여 링크에서 '테스터 되기': [참여 링크]
3) 플레이 스토어에서 설치

해 보시고 막힌 곳, 버벅인 곳, 어색한 문장을 알려 주시면 고쳐서 반영할게요. 플레이 스토어 앱 페이지의 비공개 의견이나 DM으로 보내 주세요. 테스터 교환도 환영합니다.
```

## 4. 테스트 기간에 볼 수치

운영 대시보드(`server/README.md` '운영 대시보드') → 이야기 진행 → **안드로이드 앱** 단추. 앱에서 온 횟수만 보인다(웹판 1장 데모 플레이어와 섞이지 않는다, `DECISIONS.md` 2026-11-09 '이야기 집계의 웹·앱 나누기').

- **1장 완주**: 장 표의 1장 '마침' ÷ 첫 장면(`arrival`) '끝남'. 장면은 기기마다 한 번만 나오고 1장 마침은 다시 깨도 세므로 대략값이다.
- **그만두는 지점**: 장면 표에서 앞 장면보다 횟수가 크게 줄어드는 곳. 대본 순서는 `src/script.js`의 `SCENES`.
- **건너뛰는 장면**: 장면 표의 '비율'(건너뜀 ÷ 끝남)이 높은 장면은 길거나 지루하다는 뜻일 수 있다.
- **2~4장**: 장 표의 2~4장 '들어감'·'마침'. 테스트판은 잠금이 없어 결제 전환은 여기서 보지 않는다.
- 개발자의 에뮬레이터 시험도 앱으로 잡힌다. 테스트를 연 날 이전 값은 빼고 본다(기간 단추 '최근 7일' 등).
- 의견은 #53 댓글에 모으고, 고칠 것은 #53 체크리스트나 새 버그 이슈로 옮긴다.
