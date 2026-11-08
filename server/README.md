# 공유 보급품 API (Cloudflare Workers + D1)

Lumen Hollow의 비동기 온라인 요소 "공유 보급품"의 서버다. 설계는 [docs/online-caches.md](../docs/online-caches.md), 백엔드 선택은 [DECISIONS.md](../DECISIONS.md) D-001에 있다.

```
src/index.js      Worker 진입점(fetch, scheduled)
src/app.js        라우팅과 규칙: 두기·쓰기·고마워요·내 기록·정리 작업
src/rules.js      규칙 수치(상자당 8회, 24시간 1회, 수명 72시간 등). 수치는 여기서만 바꾼다
src/slots.js      막힌 슬롯 목록(자동 생성, `npm run gen-slots`)
src/admin.js      운영 대시보드 API(읽기 전용, 별도 Worker). 아래 '운영 대시보드'
dashboard/        운영 대시보드 페이지(정적 자산). DOM을 쓰지 않는 부분은 dashboard/logic.js
schema.sql        D1 스키마(새 데이터베이스용 전체)
migrations/       이미 있는 D1에 차례로 적용하는 스키마 변경. 아래 '스키마 바꾸기'
admin.sql         킬 스위치·일괄 정리·성공 지표 SQL
test/             규칙·대시보드·스키마 테스트(Node 내장 SQLite로 D1을 흉내 냄)
```

게임 API는 [docs/online-caches.md](../docs/online-caches.md) 8절, 2026-11-08에 더한 이야기 진행 집계(`POST /v1/story`)·판 토큰·`rules`는 18절에 있다.

## 비용 원칙: Workers Free 플랜에 머문다

- **Workers Free 플랜에서는 요금이 나오지 않는다.** 무료 한도(Workers 하루 요청 10만 건, D1 하루 읽은 행 500만·쓴 행 10만, 저장 5GB)를 넘으면 청구되지 않고 요청이 오류로 막힌다(Workers는 Error 1027, D1은 쿼리 실패). 게임은 이를 서버 장애와 똑같이 처리해 혼자 하는 판으로 계속된다.
- 요금은 계정을 **Workers Paid(월 최소 $5)** 로 올렸을 때만 생긴다. 배포 전에 대시보드의 Workers & Pages → Plans에서 이 계정이 Free인지 확인한다. 이미 Paid라면 그 위에서는 한도를 넘는 사용량이 과금될 수 있다.
- 비용 위험을 남기지 않으려고 설정을 이렇게 했다.
  - Workers Logs(저장 로그)를 껐다. 2026-12-01부터 Cloudflare Observability 요금 체계로 바뀐다고 공지되어 있다. 기본 지표(요청 수·오류율)는 대시보드에서 보이고, 실시간 로그는 `npx wrangler tail`로 본다.
  - 분당 레이트 리밋 바인딩(`[[ratelimits]]`)은 선택으로 두었다. 코드는 바인딩이 없어도 동작하고, 하루 한도는 D1이 그대로 지킨다. 무료 플랜에서의 비용·가용성은 아래와 같다.
- 돈이 들지 않아도 운영 시간은 든다: 남용 확인, 한도 조정, 백업 확인, 장애 확인. D-001의 "비용이 0이어도 남는 일"을 본다.

### 분당 레이트 리밋 바인딩의 무료 플랜 비용·가용성 (2026-11-08 공식 문서 확인, 이슈 #17)

| 확인한 것 | 결과 | 출처 |
|---|---|---|
| 플랜 제한 | 바인딩 문서에 플랜 제한이 없다. 요구 사항은 Wrangler 4.36.0 이상뿐이다(이 저장소는 4.158.0) | [Rate Limiting 바인딩](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) (2026-10-21 갱신) |
| 정식 기능인가 | 2025-09-19 GA. "stable and recommended for all production workloads" | [Changelog 2025-09-19](https://developers.cloudflare.com/changelog/2025-09-19-ratelimit-workers-ga/) |
| 요금 | Workers 가격표에 이 바인딩의 요금 항목이 없다. 초과 사용 요금은 Workers Paid에만 적혀 있고, Free는 "limited usage"(한도를 넘으면 막힘)다 | [Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/) (2026-10-02 갱신), [Workers Limits](https://developers.cloudflare.com/workers/platform/limits/) |
| 실제 배포 | 2026-11-06 Free 계정의 운영 배포에서 두 바인딩이 받아들여졌다 | 이 저장소 배포 기록 |
| 정확도 | Cloudflare 위치마다 따로 세는 근사치. 한도를 잠깐 넘을 수 있다. 엄격한 한도가 필요하면 Durable Objects를 쓰라고 한다 | 바인딩 문서 'Accuracy', 'Locality' |
| 무엇을 막지 못하나 | 한도 확인은 Worker 코드가 시작된 뒤에 돈다("applied after your Worker starts"). 그래서 막힌 요청도 Workers 하루 요청 수(10만 건)에 들어간다. 이 바인딩은 D1 읽기·쓰기와 CPU를 아낄 뿐, 요청 수 소진은 막지 못한다 | 바인딩 문서 첫 부분 |

결론: **이 계정이 Workers Free인 동안 바인딩 때문에 청구될 길은 없다**(Free 플랜에는 사용량 과금이 없다). 다만 "무료"라고 적은 공식 문장은 찾지 못했으므로, Workers Paid로 올리기 전에는 가격표를 다시 본다. 바인딩 문서는 IP를 키로 쓰지 말라고 권한다(공유 IP의 다른 사람까지 막을 수 있음). 이 서버는 계정이 없는 익명 설계라 IP 해시 외에 쓸 키가 없어 그대로 두고, 한도를 넉넉하게(읽기 30·쓰기 10·대시보드 20회/분)잡았다.

## 로컬 실행

Node 22.13 이상이 필요하다(테스트가 내장 `node:sqlite`를 쓴다).

```bash
cd server
npm ci
cp .dev.vars.example .dev.vars
npm run db:local
npm run dev
```

이미 로컬 D1이 있으면(`npm run db:local`을 예전에 했으면) 새 표·색인은 `npm run db:migrate:local`로 더한다.

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
- 킬 스위치·일괄 정리: [admin.sql](admin.sql)의 문장을 `npx wrangler d1 execute lumen-hollow-caches --remote --command "..."`로 실행한다. 대시보드는 읽기 전용이라 이 일은 하지 않는다. 킬 스위치는 이야기 진행 집계(`POST /v1/story`)도 함께 멈춘다.
- 복구: D1 Time Travel(Free 7일)로 특정 시각으로 되돌린다. 운영에서 하기 전에 아래 '복구 연습'을 한 번 해 둔다. `npx wrangler d1 time-travel info lumen-hollow-caches --timestamp=<시각>`으로 시점의 북마크를 확인하고 `npx wrangler d1 time-travel restore lumen-hollow-caches --timestamp=<시각>`으로 복원한다. 복원은 데이터베이스를 그 자리에서 덮어쓴다. 복원 출력에 나오는 '이전 북마크'를 적어 두면 그 북마크로 다시 되돌릴 수 있다.
- 규칙 수치를 바꾸려면 `src/rules.js`를 고쳐 다시 배포한다. 종류·문구 수를 바꾸면 `schema.sql`의 CHECK(+ 마이그레이션)와 클라이언트 `src/online.js`도 맞춘다. 클라이언트 안내 문구용 수치는 목록 응답의 `rules`로도 나간다.

### 스키마 바꾸기(마이그레이션)

새 데이터베이스는 `schema.sql` 하나로 만들고, 이미 있는 데이터베이스는 `migrations/`의 파일을 번호 순서로 적용한다. Wrangler가 적용한 파일을 D1 안의 `d1_migrations` 표에 적어 두므로 같은 파일을 두 번 적용하지 않는다. 운영 D1은 처음에 `schema.sql`로 만들었으므로 첫 적용 때 `0000_initial.sql`(출시 때 스키마, 모두 `IF NOT EXISTS`라 아무것도 바꾸지 않음)과 `0001_hardening.sql`이 함께 적용된다. `test/schema.test.mjs`가 "0000부터 차례로 적용한 결과 = schema.sql"과 "다시 적용해도 그대로"를 확인한다.

**순서: 마이그레이션을 먼저, 코드 배포는 그다음.** 0001이 만드는 표(`cron_runs`, `story_daily`)가 없는 채로 새 게임 Worker를 배포하면 정리 작업과 `POST /v1/story`가 실패한다(대시보드는 그 부분만 '기록 없음'으로 보이고 나머지는 동작한다).

1. 적용할 파일을 본다(운영 D1을 읽기만 한다).

   ```bash
   npx wrangler d1 migrations list lumen-hollow-caches --remote
   ```

2. 적용한다. 확인 질문에 `y`. 실패한 파일은 '적용됨'으로 기록되지 않는다. 0001은 모든 문장이 `IF NOT EXISTS`라 원인을 고친 뒤 같은 명령을 다시 실행하면 된다.

   ```bash
   npx wrangler d1 migrations apply lumen-hollow-caches --remote
   ```

3. 확인: 표·색인이 생겼는지 본다.

   ```bash
   npx wrangler d1 execute lumen-hollow-caches --remote --command "SELECT name FROM sqlite_master WHERE name IN ('cron_runs','story_daily','caches_created','caches_live_expiry','thanks_at')"
   ```

4. 게임 Worker와 대시보드 Worker를 배포한다(`npx wrangler deploy`, `npx wrangler deploy -c wrangler.admin.toml`).

색인을 만드는 동안 기존 행을 한 번 읽고 쓰므로 그만큼 D1 읽기·쓰기를 쓴다(지금 규모에서 수천 행 이하). 다음 변경은 0001을 고치지 말고 `0002_<이름>.sql`을 새로 만들고, `schema.sql`에도 같은 내용을 넣는다.

### 알림 (사용자가 대시보드에서 직접, 2026-11-08 확인)

오류율이나 무료 한도 사용량을 **Workers Free에서 무료로 알려 주는 Cloudflare 알림은 없다.** 확인한 것:

| 알림 | Free에서 | 출처 |
|---|---|---|
| Workers·D1 오류율, 무료 한도 근접 | 알림 목록에 없다 | [Available Notifications](https://developers.cloudflare.com/notifications/notification-available/) (2026-10-21 갱신) |
| Usage Based Billing (D1 Rows Read/Written 포함) | 안 됨: "Professional plans or higher", "available to Pay-as-you-go accounts only" | 같은 문서 'Billing', [D1 Billing](https://developers.cloudflare.com/d1/observability/billing/) |
| Monitors(직접 SQL 조건) | 쓸 수 없음: 우리 Worker를 볼 데이터셋이 Workers Logs(`logs.workersLogs`)뿐인데 비용 때문에 꺼 두었다. 플랜·요금도 문서에 없다 | [Monitors](https://developers.cloudflare.com/notifications/monitors/), [SQL API datasets](https://developers.cloudflare.com/analytics/sql-api/datasets/) |
| Cloudflare Status — Incident Alerts | **됨**: "All Cloudflare plans". Cloudflare 자체 장애(Workers·D1 등 구성요소)를 메일로 받는다. 우리 Worker의 오류·한도 초과는 아니다 | 같은 문서 'Cloudflare Status' |

그래서 받을 수 있는 것은 Cloudflare 플랫폼 장애 알림 하나다. 설정(결제 수단을 묻는 화면이 나오면 멈춘다):

1. [Cloudflare 대시보드](https://dash.cloudflare.com/?to=/:account/notifications)에서 **Alerts** → **Platform Notifications**.
2. **Create a Notification** → 목록의 **Cloudflare Status**에서 **Incident Alerts** → **Select**.
3. 영향 수준(impact)은 major·critical, 구성요소(components)는 Workers와 D1을 고른다(고르지 않으면 모든 장애가 온다).
4. 이름(예: `lumen-hollow 플랫폼 장애`)을 넣고 받을 메일 주소를 더한 뒤 **Create**. 만든 뒤 ⋯ 메뉴의 **Test**로 메일이 오는지 본다.

우리 서비스의 상태는 끌어 와서 본다.
- **운영 대시보드**(아래): 정리 작업 실패·늦음, 서비스 켜짐, 조회가 읽은 D1 행 수, 남용 신호, 이야기 집계 하루 상한.
- **Cloudflare 대시보드**: Workers & Pages → `lumen-hollow-caches` → Metrics(요청·오류·CPU), [D1](https://dash.cloudflare.com/?to=/:account/workers/d1) → `lumen-hollow-caches` → Metrics(읽은 행·쓴 행·저장 크기, 31일 보관, [D1 Metrics](https://developers.cloudflare.com/d1/observability/metrics-analytics/)). 무료 한도는 계정 전체 합계(하루 읽기 500만·쓰기 10만 행)와 비교한다.
- 메일로 받고 싶다면(선택, 만들지 않았다): GitHub Actions 예약 워크플로가 하루 한 번 `GET /v1/caches?layout=1`(토큰 필요 없음)을 불러 실패하면 워크플로가 실패하게 하면, GitHub가 실패 메일을 보낸다. 공개 저장소라 무료이고 Workers 요청을 하루 1건 쓴다. 정리 작업 실패까지 보려면 대시보드 토큰을 GitHub 비밀값에 둬야 해서 토큰이 놓이는 곳이 하나 늘어난다. 할지는 사용자가 정한다.

### 복구 연습 (D1 Time Travel, 버리는 데이터베이스로)

운영 D1(`lumen-hollow-caches`)은 건드리지 않는다. 연습용 데이터베이스를 만들어 되돌려 보고 지운다. Free 계정은 데이터베이스를 10개까지 만들 수 있고 Time Travel과 복원에는 추가 비용이 없다([Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) "Database history and restoring a database incur no additional costs", [D1 Limits](https://developers.cloudflare.com/d1/platform/limits/)). 복원은 데이터베이스당 10분에 10번까지다. 명령은 `server/`에서, 이름은 모두 `lumen-hollow-drill`이다. 이름을 잘못 쓰면 운영 데이터베이스가 덮어써지므로 **명령마다 데이터베이스 이름을 확인한다.**

1. 연습용 데이터베이스를 만든다(`wrangler.toml`에 넣지 않는다. 이름으로만 부른다).

   ```bash
   npx wrangler d1 create lumen-hollow-drill
   ```

2. 운영과 같은 스키마를 넣고 표시용 행을 하나 넣는다.

   ```bash
   npx wrangler d1 execute lumen-hollow-drill --remote --file schema.sql
   npx wrangler d1 execute lumen-hollow-drill --remote --command "INSERT INTO daily_stats (day, metric, value) VALUES ('2000-01-01', 'drill', 1)"
   ```

3. 1분 넘게 기다린 뒤 지금 시각(Unix 초)을 적어 둔다. 이 시각으로 되돌릴 것이다(Time Travel은 분 단위다).

   ```bash
   date +%s
   ```

4. '실수'를 한다: 표시용 행을 지우고, 지워졌는지 본다(`[]`이면 지워진 것).

   ```bash
   npx wrangler d1 execute lumen-hollow-drill --remote --command "DELETE FROM daily_stats WHERE metric = 'drill'"
   npx wrangler d1 execute lumen-hollow-drill --remote --command "SELECT * FROM daily_stats WHERE metric = 'drill'"
   ```

5. 3단계 시각의 북마크를 확인하고 복원한다. 확인 질문에 `y`. 출력의 "To undo this operation, you can restore to the previous bookmark" 값을 적어 둔다.

   ```bash
   npx wrangler d1 time-travel info lumen-hollow-drill --timestamp=<3단계 숫자>
   npx wrangler d1 time-travel restore lumen-hollow-drill --timestamp=<3단계 숫자>
   ```

6. 행이 돌아왔는지 본다. `drill` 행이 보이면 성공이다. 되돌리기(undo)도 연습하려면 5단계에서 적은 북마크로 `npx wrangler d1 time-travel restore lumen-hollow-drill --bookmark=<북마크>`를 실행하고 행이 다시 사라지는지 본다.

   ```bash
   npx wrangler d1 execute lumen-hollow-drill --remote --command "SELECT * FROM daily_stats WHERE metric = 'drill'"
   ```

7. 연습용 데이터베이스를 지운다(확인 질문에 `y`).

   ```bash
   npx wrangler d1 delete lumen-hollow-drill
   ```

연습한 날과 걸린 시간을 이슈 #17에 남긴다. 운영에서 되돌릴 때 기억할 것: 복원은 그 시각 뒤의 모든 기록(다른 플레이어의 두기·사용 포함)도 지운다. 실수 하나를 고치는 데는 `admin.sql`로 그 행만 고치는 편이 나을 때가 많다. 복원 전에 킬 스위치를 내려 그사이 새 기록이 생기지 않게 하고, 끝나면 다시 켠다.

### 2단계 남용 대응 켜기

설계 10절의 판 토큰·사람 확인은 서버에 만들어 두었고 기본은 꺼져 있다(설계 18.3절). **클라이언트가 `runToken`·`humanToken`을 보내도록 배포된 뒤에** 켠다. 먼저 켜면 모든 두기가 403이 된다.

- 판 토큰: `wrangler.toml`의 `RUN_TOKEN_REQUIRED = "true"`로 바꿔 `npx wrangler deploy`. 비밀값은 기존 `IP_HASH_SECRET`을 쓴다(토큰은 판 시작 때 받으므로 이 비밀값을 바꾸면 진행 중인 판의 토큰이 무효가 된다).
- 사람 확인: Cloudflare 대시보드 **Turnstile**에서 위젯을 만들고(호스트 이름 `jeiel85.github.io`, Free 플랜은 위젯 20개·확인 무제한, [Turnstile Plans](https://developers.cloudflare.com/turnstile/plans/)), 사이트 키는 클라이언트에, 비밀 키는 `npx wrangler secret put TURNSTILE_SECRET`(입력 프롬프트에 붙여 넣기)으로 넣은 뒤 `HUMAN_CHECK_REQUIRED = "true"`로 배포한다. 비밀값 없이 켜면 두기가 `503 misconfigured`로 닫힌 채 실패한다. 게임 페이지에 Cloudflare 스크립트가 더해지므로 처음 화면 개인정보 안내도 함께 고친다.
- 끄기: 값을 `"false"`로 되돌려 배포한다.
- 로컬 시험: `.dev.vars`에서 주석을 풀면 된다(`.dev.vars.example`, Turnstile 공식 시험용 비밀값).

## 운영 대시보드

성공 지표([docs/online-caches.md](../docs/online-caches.md) 14절)와 서비스 상태를 브라우저(휴대폰 포함)에서 보는 읽기 전용 페이지다. 게임 Worker와 따로 배포하는 Worker `lumen-hollow-admin`이 같은 D1을 읽기만 한다. 인증 방식과 대안 비교는 [DECISIONS.md](../DECISIONS.md) D-003에 있다.

```
src/admin.js          API: GET /api/summary?range=1d|7d|launch (Bearer 토큰)
dashboard/            페이지(HTML·JS·CSS). 응답 헤더(CSP 등)는 dashboard/_headers
wrangler.admin.toml   이 Worker의 설정. 출시 시각 LAUNCH_AT(14일 판단의 시작점)이 여기 있다
```

보이는 것: 서비스 켜짐·꺼짐(킬 스위치), 살아 있는 보급품, 정리 작업(cron)의 마지막 성공·실패와 이유(`cron_runs`), 14일 판단(14.2절 기준 대비 지금 수치), 최근 24시간 많이 둔 소유자와 오늘 IP 하루 한도 사용, 기간별 지표와 일별 추이(UTC 날짜), 이야기 진행(장별 들어감·마침, 장면별 끝남·건너뜀, 오늘 받은 사건 / 하루 상한), 이번 조회가 읽은 D1 행 수.

정리 작업 상태: 마지막 실행이 실패면 '실패', 마지막 성공이 26시간보다 오래면 '늦음'(하루 한 번 03:17 UTC에 돈다). 실행 기록이 아직 없으면 예전처럼 일별 집계 날짜로 판정한다. 알림이 아니라서 열어 봐야 보인다(위 '알림').

접속 플레이어는 사람 수가 아니라 ID 수의 근사값이다(설계 14.1절 끝의 한계). 일별 추이와 이야기 집계는 UTC 날짜라 한국 시간 자정~오전 9시 활동은 전날로 보인다.

**14일 판정 기록**: 판단일(2026-11-20)에 [docs/online-caches.md](../docs/online-caches.md) 14.4절의 표를 채워 커밋한다. 원본 기록은 90일 뒤 지워지므로, 출시 후 90일이 지나면 대시보드는 판정을 다시 계산하지 않고 14.4절을 보라고 알린다. '출시 이후' 기간도 그때부터는 지워진 기록이 빠진 합계라고 표시한다.

분당 한도: `/api/summary`는 토큰을 확인하기 전에 IP(토큰으로 만든 HMAC 키)당 분당 20번으로 묶는다(`RL_ADMIN`, 넘으면 `429`, `Retry-After: 60`). 틀린 토큰을 반복하는 요청과, 토큰이 샜을 때의 조회 반복(조회마다 D1 행을 읽어 게임과 함께 쓰는 하루 500만 행을 소모)을 묶는다. **Workers 하루 요청 수(10만 건)는 줄이지 못한다**: 막힌 요청도 Worker까지 와서 한 건으로 센다(위 '분당 레이트 리밋 바인딩'). 틀린 토큰 요청은 원래도 D1을 읽지 않아 값이 싸다. 요청 수 소진까지 막으려면 Worker 앞단의 WAF 규칙이 필요한데, workers.dev 주소에는 걸 수 없고 자기 도메인(Cloudflare 영역)이 있어야 한다.

### 로컬 실행

`.dev.vars`에 `ADMIN_TOKEN`(32자 이상)을 넣는다(`.dev.vars.example` 참고). 로컬 D1은 게임 Worker와 같은 것을 쓰므로 `npm run db:local`(예전에 했으면 `npm run db:migrate:local`)을 먼저 한 번 실행한다. 화면 로직 테스트는 `test/dashboard.test.mjs`(브라우저 없이 `dashboard/logic.js`를 확인)다.

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

- 토큰 바꾸기: 아래 '토큰 교체 절차'. 기존 브라우저 로그인은 그 즉시 모두 풀린다.
- 실시간 로그: `npx wrangler tail -c wrangler.admin.toml`
- 걷어 내기: `npx wrangler delete -c wrangler.admin.toml`. 게임과 데이터에는 영향이 없다.
- 비용: 페이지 파일 요청은 무료·무제한이고, `/api/summary` 요청은 Workers Free 하루 10만 건을 게임과 함께 쓴다. 조회 한 번에 D1에서 읽은 행 수가 화면 아래에 나온다(무료 한도 하루 500만 행). 결제 수단이나 유료 플랜은 필요 없다.

### 토큰 교체 절차

교체 주기(예: 분기마다, 기기를 잃었을 때, 토큰을 어디 붙여 넣은 것 같을 때)와 토큰을 어디에 둘지는 사용자가 정한다. 이 PC에는 지금 `%LOCALAPPDATA%\lumen-hollow-admin\ADMIN_TOKEN.txt`(현재 사용자만 읽기)에 있다. 비밀번호 관리자로 옮긴다면 4단계 뒤 그 파일을 지운다. 아래는 이 PC의 PowerShell에서 `server/` 폴더 기준이고, 토큰 값이 화면·클립보드·명령 기록에 나오지 않게 했다.

1. 새 토큰을 파일에 바로 쓴다(기존 파일을 덮어써서 파일 권한은 그대로다).

   ```powershell
   $f = "$env:LOCALAPPDATA\lumen-hollow-admin\ADMIN_TOKEN.txt"
   node -e "require('fs').writeFileSync(process.argv[1], require('crypto').randomBytes(32).toString('base64url'))" $f
   ```

2. Worker 비밀값을 바꾼다. 파이프로 넘긴 값은 Wrangler가 끝의 공백·줄바꿈을 지운다(4.158.0에서 확인). 이 순간부터 옛 토큰은 듣지 않는다.

   ```powershell
   Get-Content -Raw $f | npx wrangler secret put ADMIN_TOKEN -c wrangler.admin.toml
   ```

3. 확인: 새 토큰은 `200`, 틀린 토큰은 `401`이어야 한다.

   ```powershell
   $t = (Get-Content -Raw $f).Trim()
   curl.exe -s -o NUL -w "%{http_code}`n" -H "Authorization: Bearer $t" "https://lumen-hollow-admin.jeiel85.workers.dev/api/summary?range=1d"
   curl.exe -s -o NUL -w "%{http_code}`n" -H "Authorization: Bearer wrong-token-for-check" "https://lumen-hollow-admin.jeiel85.workers.dev/api/summary?range=1d"
   Remove-Variable t
   ```

4. 쓰는 브라우저(휴대폰, PC 앱 창)마다 다시 로그인한다. 열려 있던 화면은 다음 조회 때 '토큰이 맞지 않아요'로 로그인 화면이 된다. 붙여 넣을 때 클립보드를 쓴다면 `Get-Content -Raw $f | Set-Clipboard`로 복사하고, 넣은 뒤 `Set-Clipboard -Value $null`로 비운다.

2단계에서 실패하면(로그인 만료 등) Worker에는 옛 토큰이 그대로 있으니 원인을 고치고 2단계부터 다시 한다. 파일의 새 값은 아직 아무 데도 쓰이지 않았다.

## wrangler 자격 증명 저장 방식 (이 PC, 사용자가 정할 것)

`npx wrangler login`은 OAuth 토큰(계정의 Workers·D1 등을 바꿀 수 있음)을 기본으로 **평문 TOML 파일**에 둔다. 이 사용자 권한으로 도는 프로그램(예: 악성 npm 패키지)은 그 파일을 읽을 수 있다. 위치는 `npx wrangler whoami`가 알려 준다. 이번 작업에서는 이 PC의 설정을 바꾸지 않았다. 고를 수 있는 방법(출처: [Wrangler 일반 명령 — login·logout, OS 키체인 저장](https://developers.cloudflare.com/workers/wrangler/commands/general/), 2026-11-08 확인):

| 방법 | 명령 | 좋은 점 | 대가 |
|---|---|---|---|
| A. 그대로 | — | 할 일 없음 | 평문 파일. 토큰이 새면 계정 전체를 바꿀 수 있다 |
| B. OS 키체인 | `npx wrangler login --use-keyring` | 파일이 AES-256-GCM으로 암호화되고 키는 Windows 자격 증명 관리자에 들어간다. 이 저장소의 Wrangler 4.158.0이 지원한다(`wrangler login --help`로 확인). Windows용 `@napi-rs/keyring`은 처음 켤 때 Wrangler가 받는다(약 1.9MB) | 같은 사용자 권한의 프로그램은 자격 증명 관리자도 읽을 수 있어 완전한 보호는 아니다(문서가 아니라 이 메모의 판단). 끄기(`--no-use-keyring`)는 암호화 파일을 지우고 다시 로그인하게 한다 |
| C. 배포할 때만 로그인 | 배포 뒤 `npx wrangler logout` | 토큰을 무효로 하고 파일을 지운다. 평소에는 이 PC에 계정 권한이 없다 | 배포할 때마다 브라우저 승인 한 번 |
| D. 권한을 좁힌 API 토큰 | 대시보드에서 이 계정의 Workers Scripts·D1 편집만 있는 토큰을 만들어, 쓸 때만 `CLOUDFLARE_API_TOKEN` 환경 변수로 넘긴다 | 토큰이 새도 피해가 그 권한으로 묶인다. 값은 비밀번호 관리자에 둔다 | 토큰 만들기·교체를 사람이 챙긴다. 환경 변수에 넣는 순간은 그 셸에 노출된다 |

OAuth도 `npx wrangler login --scopes <범위...>`로 권한을 좁힐 수 있다(`--scopes-list`로 목록). 권하는 순서는 C(가장 단순) 또는 B+C다.

## 개인정보 법적 의무 확인 (법률 자문 아님, 사용자가 확인할 것)

**이 절은 법률 자문이 아니다.** 법을 읽고 확인할 항목을 정리한 메모이고, 해당 여부의 판단은 사용자(필요하면 전문가·개인정보보호위원회 상담)가 한다. 조문은 [한국법제연구원 법령 번역 사이트의 개인정보 보호법](https://elaw.klri.re.kr/kor_service/lawViewMultiContent.do?hseq=62389)(2023.3.14 개정, 법률 제19234호 판, 2026-11-08 열람)에서 옮겼다. 시행 중인 최신 조문은 [국가법령정보센터](https://www.law.go.kr/)에서 다시 확인한다.

서버가 가진 것: ① 플레이어 ID의 SHA-256(브라우저 저장소의 무작위 ID와 맞추면 그 브라우저를 가리킨다. 이름·연락처는 없다), ② 날짜마다 바뀌는 비밀값으로 만든 IP의 HMAC(48시간 이하. 비밀값을 가진 운영자는 특정 IP와 대조할 수 있다), ③ Cloudflare 접근 기록의 IP(플랫폼이 보관), ④ 이야기 진행 집계(날짜별 횟수만).

| 확인할 것 | 근거 조문(요지) | 지금 상태 |
|---|---|---|
| ①·②가 개인정보인가 | 제2조 제1호 나목: 그것만으로는 알아볼 수 없어도 "다른 정보와 쉽게 결합하여 알아볼 수 있는 정보"는 개인정보이고, 결합이 쉬운지는 다른 정보를 얻을 가능성 등 시간·비용·기술을 합리적으로 고려한다 | 판단하지 않았다. 보수적으로는 '해당한다'고 보고 아래를 갖춘다 |
| ④가 법 적용 밖인가 | 제58조의2: 시간·비용·기술을 합리적으로 고려할 때 다른 정보를 써도 더 이상 개인을 알아볼 수 없는 정보에는 이 법을 적용하지 않는다 | 사람을 가리키는 값을 처음부터 저장하지 않는다(설계 18.1절) |
| 수집 근거 | 제15조 제1항: 동의, 계약 이행, 개인정보처리자의 정당한 이익(정보주체의 권리보다 명백히 우선하고 합리적 범위) 등 | 기본 켜짐 + 처음 화면 안내 + 끄기. 어느 근거에 기대는지 정하지 않았다 |
| 처리방침 공개 | 제30조 제1항: 처리 목적, 처리·보유 기간, 파기 절차·방법, 처리 위탁, 정보주체의 권리·행사 방법, 개인정보 보호책임자 연락처, 자동 수집 장치의 설치·운영과 거부 등 | 루트 README '개인정보' 절에 목적·보유·파기·삭제 방법이 있다. 보호책임자 연락처, 처리 위탁(Cloudflare), 국외 이전 항목은 없다 |
| 국외 이전 | 제28조의8: 국외 처리위탁·보관은 원칙적으로 안 되고, 계약 이행에 필요한 위탁·보관이면 이전 항목·국가·시기와 방법·받는 자·목적과 기간·거부 방법을 처리방침에 공개하는 방식이 있다 | D1 위치는 'APAC'로만 알고 나라를 확인하지 않았다. 처리방침에 적지 않았다 |
| 만 14세 미만 | 제22조의2: 동의가 필요한 처리라면 법정대리인 동의와 그 확인 | 연령을 묻지 않는다 |
| 파기·안전조치 | 제21조(필요 없게 되면 지체 없이 파기), 제29조(안전조치) | 90일 자동 삭제, 비밀값·토큰 관리(이 README) |

물어볼 곳: [개인정보 포털](https://www.privacy.go.kr/)(개인정보보호위원회 상담·법령 해석 안내), 개인정보침해 신고센터(국번 없이 118). 결정한 내용은 `DECISIONS.md`에 남기고, 처음 화면 안내와 README '개인정보' 절을 그에 맞춘다.
