# 공유 보급품 API (Cloudflare Workers + D1)

Lumen Hollow의 비동기 온라인 요소 "공유 보급품"의 서버다. 설계는 [docs/online-caches.md](../docs/online-caches.md), 백엔드 선택은 [DECISIONS.md](../DECISIONS.md) D-001에 있다.

```
src/index.js      Worker 진입점(fetch, scheduled)
src/app.js        라우팅과 규칙: 두기·쓰기·고마워요·내 기록·정리 작업
src/rules.js      규칙 수치(상자당 8회, 24시간 1회, 수명 72시간 등). 수치는 여기서만 바꾼다
src/slots.js      막힌 슬롯 목록(자동 생성, `npm run gen-slots`)
src/admin.js      운영 대시보드 API(읽기 전용, 별도 Worker). 아래 '운영 대시보드'
dashboard/        운영 대시보드 페이지(정적 자산)
schema.sql        D1 스키마
admin.sql         킬 스위치·일괄 정리·성공 지표 SQL
test/             규칙 테스트(Node 내장 SQLite로 D1을 흉내 냄)
```

## 비용 원칙: Workers Free 플랜에 머문다

- **Workers Free 플랜에서는 요금이 나오지 않는다.** 무료 한도(Workers 하루 요청 10만 건, D1 하루 읽은 행 500만·쓴 행 10만, 저장 5GB)를 넘으면 청구되지 않고 요청이 오류로 막힌다(Workers는 Error 1027, D1은 쿼리 실패). 게임은 이를 서버 장애와 똑같이 처리해 혼자 하는 판으로 계속된다.
- 요금은 계정을 **Workers Paid(월 최소 $5)** 로 올렸을 때만 생긴다. 배포 전에 대시보드의 Workers & Pages → Plans에서 이 계정이 Free인지 확인한다. 이미 Paid라면 그 위에서는 한도를 넘는 사용량이 과금될 수 있다.
- 비용 위험을 남기지 않으려고 설정을 이렇게 했다.
  - Workers Logs(저장 로그)를 껐다. 2026-12-01부터 Cloudflare Observability 요금 체계로 바뀐다고 공지되어 있다. 기본 지표(요청 수·오류율)는 대시보드에서 보이고, 실시간 로그는 `npx wrangler tail`로 본다.
  - 분당 레이트 리밋 바인딩은 선택으로 두었다. 무료 플랜에서 쓸 수 있는지 공식 문서로 확인하지 못했다. 배포가 이 설정 때문에 거절되면 `wrangler.toml`의 `[[ratelimits]]` 두 블록을 지우고 다시 배포한다. 하루 한도는 D1이 그대로 지킨다.
- 돈이 들지 않아도 운영 시간은 든다: 남용 확인, 한도 조정, 백업 확인, 장애 확인. D-001의 "비용이 0이어도 남는 일"을 본다.

## 로컬 실행

Node 22.13 이상이 필요하다(테스트가 내장 `node:sqlite`를 쓴다).

```bash
cd server
npm ci
cp .dev.vars.example .dev.vars
npm run db:local
npm run dev
```

게임은 저장소 루트에서 정적 서버로 연다. localhost에서만 `?api=`로 서버 주소를 바꿀 수 있다. 운영 서버는 배포 주소(`https://jeiel85.github.io`)만 허용하므로, 로컬 게임은 `?api=`로 로컬 서버를 가리켜야 온라인 기능이 동작한다. 로컬 서버의 허용 출처는 `.dev.vars`의 `ALLOWED_ORIGINS`다.

```text
http://localhost:8000/?api=http://127.0.0.1:8787
```

정리 작업(cron)은 로컬에서 자동으로 돌지 않는다. 손으로 부른다: `curl "http://127.0.0.1:8787/cdn-cgi/local/scheduled"`.

```bash
npm test
```

`world.js`나 `src/slots.js`를 바꾸면 `test/slots.test.mjs`가 실패한다. 마을 배치가 바뀌었는지 보고 `src/slots.js`의 `SLOT_LAYOUT`을 올릴지 정한 뒤 `npm run gen-slots`로 서버 목록을 다시 만든다.

## 배포 (사용자가 직접 실행)

Cloudflare 계정이 있다는 전제다. 아래 명령은 모두 `server/` 폴더에서 실행한다. 3~6단계는 Cloudflare에 실제 자원을 만들거나 바꾼다.

1. 의존성 설치와 로그인. 브라우저가 열리면 Cloudflare 계정으로 승인한다.

   ```bash
   npm ci
   ```

   ```bash
   npx wrangler login
   ```

   ```bash
   npx wrangler whoami
   ```

2. 플랜 확인: 대시보드 Workers & Pages → Plans가 **Free**인지 본다(위 "비용 원칙").

3. D1 데이터베이스를 만든다. 출력된 `database_id`를 `wrangler.toml`의 `database_id` 자리에 넣는다.

   ```bash
   npx wrangler d1 create lumen-hollow-caches
   ```

4. 스키마를 운영 D1에 적용한다.

   ```bash
   npx wrangler d1 execute lumen-hollow-caches --remote --file schema.sql
   ```

5. IP 해시용 비밀값을 넣는다. 첫 명령으로 무작위 값을 만들어, 두 번째 명령의 입력 프롬프트에 붙여 넣는다. 명령줄 인자로 넘기지 않아야 셸 기록에 남지 않는다.

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```

   ```bash
   npx wrangler secret put IP_HASH_SECRET
   ```

6. 배포한다. 출력되는 주소(`https://lumen-hollow-caches.<계정 서브도메인>.workers.dev`)를 적어 둔다. `[[ratelimits]]` 때문에 거절되면 그 두 블록을 지우고 다시 실행한다.

   ```bash
   npx wrangler deploy
   ```

7. 확인: 응답이 `{"enabled":true,"caches":[],...}`이면 된다.

   ```bash
   curl "https://lumen-hollow-caches.<계정 서브도메인>.workers.dev/v1/caches?layout=1"
   ```

8. 게임에 연결: `src/online.js`의 `ONLINE_API`에 6단계 주소를 넣고(끝에 `/` 없이) 커밋한다. main에 머지하면 Pages 배포로 공개된다. 이 값이 비어 있는 동안에는 온라인 기능 전체가 꺼져 있다(요청도, 화면 요소도 없음).

## 운영

- 실시간 로그: `npx wrangler tail`
- 성공 지표·상태·남용 신호 보기: 아래 '운영 대시보드'(웹 페이지)
- 킬 스위치·일괄 정리: [admin.sql](admin.sql)의 문장을 `npx wrangler d1 execute lumen-hollow-caches --remote --command "..."`로 실행한다. 대시보드는 읽기 전용이라 이 일은 하지 않는다.
- 복구: D1 Time Travel(무료 7일)로 특정 시각으로 되돌린다. `npx wrangler d1 time-travel info lumen-hollow-caches`로 확인하고 `npx wrangler d1 time-travel restore lumen-hollow-caches --timestamp=<ISO 시각>`으로 복원한다. 복원은 되돌릴 수 없는 작업이므로 먼저 `info`로 시점을 확인한다.
- 규칙 수치를 바꾸려면 `src/rules.js`를 고쳐 다시 배포한다. 종류·문구 수를 바꾸면 `schema.sql`의 CHECK와 클라이언트 `src/online.js`도 맞춘다.

## 운영 대시보드

성공 지표([docs/online-caches.md](../docs/online-caches.md) 14절)와 서비스 상태를 브라우저(휴대폰 포함)에서 보는 읽기 전용 페이지다. 게임 Worker와 따로 배포하는 Worker `lumen-hollow-admin`이 같은 D1을 읽기만 한다. 인증 방식과 대안 비교는 [DECISIONS.md](../DECISIONS.md) D-003에 있다.

```
src/admin.js          API: GET /api/summary?range=1d|7d|launch (Bearer 토큰)
dashboard/            페이지(HTML·JS·CSS). 응답 헤더(CSP 등)는 dashboard/_headers
wrangler.admin.toml   이 Worker의 설정. 출시 시각 LAUNCH_AT(14일 판단의 시작점)이 여기 있다
```

보이는 것: 서비스 켜짐·꺼짐(킬 스위치), 살아 있는 보급품, 정리 작업(cron)이 제때 돌았는지, 14일 판단(14.2절 기준 대비 지금 수치), 최근 24시간 많이 둔 소유자와 오늘 IP 하루 한도 사용, 기간별 지표와 일별 추이(UTC 날짜), 이번 조회가 읽은 D1 행 수.

### 로컬 실행

`.dev.vars`에 `ADMIN_TOKEN`(32자 이상)을 넣는다(`.dev.vars.example` 참고). 로컬 D1은 게임 Worker와 같은 것을 쓰므로 `npm run db:local`을 먼저 한 번 실행한다.

```bash
npm run dev:admin
```

`http://localhost:8788`을 열고 `.dev.vars`의 토큰을 넣는다. 로컬에서 여러 날의 화면을 보고 싶으면 `.dev.vars`에 `LAUNCH_AT`을 지난 시각으로 둔다.

### 배포 (사용자가 직접 실행)

모두 `server/` 폴더에서 실행한다. 1·3단계는 Cloudflare에 실제 자원을 만들거나 바꾼다.

1. 배포한다. 출력되는 주소(`https://lumen-hollow-admin.<계정 서브도메인>.workers.dev`)를 적어 둔다. 토큰을 넣기 전까지 API는 503으로 닫혀 있다.

   ```bash
   npx wrangler deploy -c wrangler.admin.toml
   ```

2. 토큰을 만든다. 출력된 값을 비밀번호 관리자 같은 안전한 곳에 둔다. 채팅·메모 앱에 붙여 두지 않는다.

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```

3. 토큰을 Worker 비밀값으로 넣는다. 입력 프롬프트에 2단계 값을 붙여 넣는다(명령줄 인자로 넘기지 않아야 셸 기록에 남지 않는다).

   ```bash
   npx wrangler secret put ADMIN_TOKEN -c wrangler.admin.toml
   ```

4. 1단계 주소를 열고 토큰을 넣는다. "이 기기에서 기억하기"를 고르지 않으면 탭을 닫을 때 지워진다.

- 토큰 바꾸기: 2·3단계를 다시 한다. 기존 브라우저 로그인은 그 즉시 모두 풀린다.
- 실시간 로그: `npx wrangler tail -c wrangler.admin.toml`
- 걷어 내기: `npx wrangler delete -c wrangler.admin.toml`. 게임과 데이터에는 영향이 없다.
- 비용: 페이지 파일 요청은 무료·무제한이고, `/api/summary` 요청은 Workers Free 하루 10만 건을 게임과 함께 쓴다. 조회 한 번에 D1에서 읽은 행 수가 화면 아래에 나온다(무료 한도 하루 500만 행). 결제 수단이나 유료 플랜은 필요 없다.
