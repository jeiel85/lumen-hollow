// 1장 엔딩 뒤 2~4장을 처음부터 끝까지 자동으로 진행하며 확인한다.
//   node tests/e2e/chapters.mjs [url] [w h]   (url 기본값 http://127.0.0.1:8000/?debug — 저장소 폴더를 정적 서버로 띄운다)
import { launch, fullGame } from './cdp.mjs';

const [,, rawUrl = 'http://127.0.0.1:8000/?debug', w = '1280', h = '720'] = process.argv;
const url = fullGame(rawUrl); // 2~4장도 시험하므로 앱처럼 연다(#50)
const B = await launch(url, +w, +h);
const out = { checks: [], logs: B.logs };
const check = (name, ok, info) => {
  out.checks.push({ name, ok: !!ok, info });
  console.log(`${ok ? 'OK ' : 'NG '} ${name}${info !== undefined ? ` — ${JSON.stringify(info)}` : ''}`);
};

await B.sleep(1500);
for (let i = 0; i < 60; i++) {
  if (await B.ev('return !!(window.lumen && lumen.game.ready)')) break;
  await B.sleep(500);
}
// 시험 도우미: 장면·기록을 넘기고, 정해진 자리에 서서 E를 길게 누른다.
await B.ev(`
  const L = lumen;
  window.T = {
    settle(max = 60) {
      for (let i = 0; i < max; i++) {
        if (L.dialogue.docOpen) { if (L.dialogue.docFlip) L.dialogue.docFlip(); L.dialogue.closeDoc(); }
        if (L.dialogue.scene) L.dialogue.skip();
        L.step(0.5);
        if (L.game.state !== 'story' && !L.dialogue.busy && !L.storyQueue.length) return i;
      }
      return -1;
    },
    // 스크린샷용: 지금 장면 안에서만 n줄 넘긴다(장면이 끝나 다음 장면으로 넘어가지 않게)
    peek(n) {
      const id = L.dialogue.scene?.id;
      for (let i = 0; i < n && id && L.dialogue.scene?.id === id; i++) { L.dialogue.advance(); L.step(0.4); }
    },
    // 기다리는 장면(id)이 나오거나 큐에 들 때까지 지금 장면들을 넘긴다. 나왔으면 true
    until(id, max = 400) {
      for (let i = 0; i < max; i++) {
        if (L.dialogue.scene?.id === id || L.storyQueue.includes(id)) return true;
        if (L.dialogue.scene) L.dialogue.advance();
        L.step(0.15);
      }
      return false;
    },
    // 이어지는 장면까지 모두 줄마다 넘기며 끝까지 본다
    watch(max = 400) {
      for (let i = 0; i < max; i++) {
        if (!L.dialogue.scene) { L.step(0.6); if (!L.dialogue.scene && L.game.state !== 'story') return i; continue; }
        L.dialogue.advance();
        L.step(0.15);
      }
      return -1;
    },
    goto(x, z) {
      L.player.pos.set(x, L.ground.heightAt(x, z), z);
      L.step(0.1);
    },
    hold(sec = 2.2) {
      L.input.keys.add('KeyE');
      L.step(sec);
      L.input.keys.delete('KeyE');
      L.step(0.1);
    },
    use(id) {
      const s = L.chapters.spot(id);
      if (!s) return 'no-spot';
      T.goto(s.x, s.z);
      const n = L.chapters.nearest(L.player.pos.x, L.player.pos.z);
      if (!n) return 'nothing-near';
      if (n.blocked) return 'blocked:' + n.label;
      const label = n.label;
      T.hold(n.dur + 0.4);
      return label;
    },
    st() {
      return { state: L.game.state, ch: L.game.chapter, step: L.chapters.step, obj: L.chapters.objective, hour: +L.env.hour.toFixed(2), x: +L.player.pos.x.toFixed(1), z: +L.player.pos.z.toFixed(1), hp: Math.round(L.player.hp), flags: [...L.chapters.flags], q: [...L.storyQueue] };
    },
  };
  return true;
`);

// ---------------------------------------------------------------- 1장 확인
let r = await B.ev(`return { btn: document.getElementById('chapter-btn').className, next: lumen.chapters.nextInfo(), spots: lumen.story.spots.map(s => s.clue.id) }`);
check('1장 전에는 장 단추가 숨어 있다', r.btn.includes('hidden') && r.next === null, r);
r = await B.ev(`lumen.startGame(); lumen.step(0.6); return { state: lumen.game.state, scene: lumen.dialogue.scene?.id, first: lumen.dialogue.scene?.lines[0].text }`);
check('1장 도착 장면이 새 원고로 나온다', r.scene === 'arrival' && r.first.startsWith('그날 밤 엄마는'), r);
await B.shot('01-arrival');
r = await B.ev(`T.watch(); return T.st()`);
check('도착 장면을 끝까지 넘김', r.state === 'play', r);
// 1장을 끝낸 것으로 친다(엔딩까지 본 기록)
r = await B.ev(`
  for (const id of ['arrival','dusk','dawn','light1','shadows','return','founders','lookout','promise','line','last','finale']) lumen.story.markSeen(id);
  lumen.backToTitle(); lumen.step(0.2);
  return { btn: document.getElementById('chapter-btn').textContent, hidden: document.getElementById('chapter-btn').classList.contains('hidden') }`);
check('1장을 마치면 처음 화면에 2장 단추', !r.hidden && r.btn.includes('2장'), r);
await B.shot('02-title');

// ---------------------------------------------------------------- 2장
r = await B.ev(`document.getElementById('chapter-btn').click(); lumen.step(0.3); return T.st()`);
check('2장 시작: 마을 선착장, 목표 배 타기', r.ch === 2 && r.step === 'ferry' && r.obj.includes('배를 타고'), r);
await B.sleep(200);
r = await B.ev(`lumen.step(2.0); return { st: T.st(), card: document.getElementById('chapter-card').className, objective: document.getElementById('objective').textContent }`);
check('장 제목 카드와 목표 문구', r.objective.includes('배를 타고'), r);
await B.shot('03-ch2-village-dock');
r = await B.ev(`return T.use('boatVillage')`);
check('나룻배에 오르기', r === '나룻배에 오르기', r);
r = await B.ev(`lumen.step(0.3); return { st: T.st(), scene: lumen.dialogue.scene?.id }`);
check('나루 장면이 돈다', r.scene === 'ferry', r);
await B.ev(`T.peek(6); return 1`);
await B.shot('04-ferry-rowing');
r = await B.ev(`const ok = T.until('landing'); return { ok, st: T.st(), scene: lumen.dialogue.scene?.id }`);
check('섬에 닿으면 첫 대면 장면', r.ok, r);
await B.ev(`T.peek(3); return 1`);
await B.shot('05-landing');
r = await B.ev(`T.watch(); return T.st()`);
check('첫 대면 뒤 탐색 목표', r.step === 'search' && r.state === 'play', r);
await B.shot('06-island');
r = await B.ev(`return T.use('spare')`);
check('부두 보관함 열기(순서 자유: 보관함 먼저)', String(r).includes('보관함'), r);
r = await B.ev(`T.settle(); return { st: T.st(), found: lumen.story.isFound('spare') }`);
check('예비 송수신기 종이띠를 수첩에 적음', r.found, r);
r = await B.ev(`return T.use('book')`);
await B.ev(`lumen.step(0.3); return 1`);
await B.shot('07-islandbook');
r = await B.ev(`T.settle(); return T.st()`);
check('두 물건 확인 뒤 교대 요청 목표', r.step === 'call', r);
// 밤: 고정등 아래 돌계단
r = await B.ev(`lumen.env.setHour(20.5); T.goto(lumen.chapters.spot('call').x, lumen.chapters.spot('call').z); lumen.player.flashOn = true; lumen.step(6); return { st: T.st(), lit: !!lumen.ground.lightAt(lumen.player.pos.x, lumen.player.pos.z), shades: lumen.shades.list.filter(s => s.active).length }`);
check('밤에 돌계단은 고정등 불빛 안', r.lit, r);
await B.shot('08-island-night');
r = await B.ev(`return T.use('call')`);
check('교대 요청', String(r).includes('부르기'), r);
r = await B.ev(`lumen.step(0.3); const s = lumen.dialogue.scene?.id; const ok = T.until('bowls'); return { s, ok, st: T.st() }`);
check('대타 장면 뒤 두 그릇 장면', r.s === 'relief' && r.ok, r);
await B.ev(`T.peek(2); return 1`);
await B.shot('09-bowls');
r = await B.ev(`T.watch(); return T.st()`);
check('2장 마무리: 마을로 돌아가기 목표', r.step === 'leave', r);
await B.shot('10-island-leave');

// 재시작 확인: 2장 도중 저장이 이어지는지(처음 화면 → 장 단추)
r = await B.ev(`lumen.backToTitle(); lumen.step(0.2); return document.getElementById('chapter-btn').textContent`);
check('2장 끝낸 뒤 처음 화면 단추는 3장', r.includes('3장'), r);

// ---------------------------------------------------------------- 3장
r = await B.ev(`document.getElementById('chapter-btn').click(); lumen.step(2.0); return T.st()`);
check('3장 시작: 강 건너 구호소 목표', r.ch === 3 && r.step === 'go', r);
await B.shot('11-ch3-start');
r = await B.ev(`const t = lumen.chapters.river.tentMark; T.goto(t.x - 4, t.z + 4); lumen.step(0.5); return { scene: lumen.dialogue.scene?.id }`);
check('구호소에 다가가면 열두 번째 칸 장면', r.scene === 'count', r);
await B.ev(`T.peek(8); return 1`);
await B.shot('12-count-shoes');
r = await B.ev(`T.watch(); return T.st()`);
check('창고 목표', r.step === 'store', r);
r = await B.ev(`return T.use('tag')`);
check('봉투부터 열기(역순)', String(r).includes('봉투'), r);
r = await B.ev(`lumen.step(0.2); return { hand: document.getElementById('doc-hand').textContent, body: document.getElementById('doc-body').textContent }`);
check('봉투만 읽으면 사진 뒷면은 아직 안 보인다', !r.body.includes('뒷면') && !r.hand, r);
await B.ev(`T.settle(); return 1`);
r = await B.ev(`return T.use('manifest')`);
check('두 번째 기록에서 17번 맞춰 보기', String(r).includes('17번'), r);
r = await B.ev(`lumen.step(0.2); return { title: document.getElementById('doc-title').textContent, flip: !document.getElementById('doc-flip').classList.contains('hidden'), body: document.getElementById('doc-body').textContent }`);
check('맞춰 보기 화면과 사진 뒤집기 단추', r.title === '17번' && r.flip, r);
await B.shot('13-compare');
r = await B.ev(`document.getElementById('doc-flip').click(); lumen.step(0.2); return { hand: document.getElementById('doc-hand').textContent, flag: lumen.chapters.flag('flip') }`);
check('사진을 뒤집으면 엄마 글씨', r.hand.includes('윤 여사님') && r.flag, r);
await B.shot('14-flipped');
r = await B.ev(`lumen.dialogue.closeDoc(); lumen.step(0.4); lumen.step(1.6); return { scene: lumen.dialogue.scene?.id, st: T.st() }`);
check('뒤집고 닫으면 엄마의 열쇠 장면', r.scene === 'key' || r.st.q.includes('key'), r);
r = await B.ev(`T.watch(); lumen.step(3.0); const s = lumen.dialogue.scene?.id; return { s, st: T.st() }`);
check('귀로에 문 밖의 아이 무전', r.s === 'knock', r);
r = await B.ev(`T.watch(); return T.st()`);
check('약사에게 반납 목표', r.step === 'back', r);
r = await B.ev(`return T.use('return')`);
r = await B.ev(`lumen.step(0.2); return document.getElementById('doc-title').textContent`);
check('약사의 인계 쪽지', r === '약사의 인계 쪽지', r);
r = await B.ev(`T.settle(); return T.st()`);
check('별관 목표', r.step === 'annex', r);
r = await B.ev(`const t = lumen.chapters.river.stepsMark; T.goto(t.x + 2.5, t.z); lumen.step(0.5); return { scene: lumen.dialogue.scene?.id }`);
check('별관 입구에서 보호자 자리 장면', r.scene === 'chair', r);
await B.ev(`T.peek(2); return 1`);
await B.shot('15-chair-classroom');
r = await B.ev(`T.watch(); lumen.step(2.0); return { st: T.st(), scene: lumen.dialogue.scene?.id }`);
check('4장으로 넘어가 두 사람 장면', r.st.ch === 4 && (r.scene === 'roll' || r.st.q.includes('roll')), r);

// ---------------------------------------------------------------- 4장
r = await B.ev(`T.watch(); return T.st()`);
check('예비등 목표', r.step === 'lamps', r);
r = await B.ev(`return T.use('lampYard')`);
check('운동장 당직실 예비등(먼저)', String(r).includes('당직실'), r);
r = await B.ev(`return T.use('roster')`);
await B.ev(`lumen.step(0.2); return 1`);
await B.shot('16-roster');
await B.ev(`T.settle(); return 1`);
r = await B.ev(`return T.use('lampDoor')`);
r = await B.ev(`lumen.step(2); return T.st()`);
check('두 등을 켜면 밤을 기다리기', r.step === 'wait', r);
await B.shot('17-lamps-day');
r = await B.ev(`return T.use('wait')`);
r = await B.ev(`lumen.step(2.0); return T.st()`);
check('밤이 되고 첫 목표 그림자', r.step === 'night1' && r.hour > 20, r);
// 목표 그림자가 다가오게 두고, 계단 불빛 안에서 비춘다.
r = await B.ev(`
  const P = lumen.player; P.flashOn = true;
  let seen = false, banished = false, t = 0;
  for (; t < 90 && !lumen.chapters.flag('home1'); t += 0.25) {
    const s = lumen.shades.list.find(e => e.active && e.tag === 't1');
    if (s) { seen = true; P.facing = Math.atan2(s.x - P.pos.x, s.z - P.pos.z); P.battery = 100; }
    lumen.step(0.25);
  }
  return { seen, t, home1: lumen.chapters.flag('home1'), st: T.st() }`);
check('첫 목표 그림자를 비춰 돌려보냄', r.home1, r);
await B.shot('18-first-target');
r = await B.ev(`lumen.step(3.0); return { scene: lumen.dialogue.scene?.id, st: T.st() }`);
check('문가 장면', r.scene === 'firsthome' || r.st.q.includes('firsthome'), r);
await B.ev(`T.peek(3); return 1`);
await B.shot('19-firsthome');
r = await B.ev(`T.watch(); return T.st()`);
check('쉬는 시간: 물 받고 다시 비추기', r.step === 'rest', r);
r = await B.ev(`lumen.step(6); return { active: lumen.shades.list.filter(s => s.active).length }`);
check('쉬는 동안 그늘이가 오지 않는다', r.active === 0, r);
r = await B.ev(`return T.use('water')`);
r = await B.ev(`
  const P = lumen.player; P.flashOn = true;
  T.goto(lumen.chapters.river.stepsOut.x, lumen.chapters.river.stepsOut.z);
  let t = 0;
  for (; t < 120 && !lumen.chapters.flag('home2'); t += 0.25) {
    const s = lumen.shades.list.find(e => e.active && e.tag === 't2');
    if (s) { P.facing = Math.atan2(s.x - P.pos.x, s.z - P.pos.z); P.battery = 100; }
    lumen.step(0.25);
  }
  return { t, home2: lumen.chapters.flag('home2'), st: T.st() }`);
check('둘째 목표 그림자를 돌려보냄', r.home2, r);
r = await B.ev(`lumen.step(3.0); return { scene: lumen.dialogue.scene?.id, st: T.st() }`);
check('창가 장면', r.scene === 'secondhome' || r.st.q.includes('secondhome'), r);
await B.ev(`T.peek(8); return 1`);
await B.shot('20-secondhome');
r = await B.ev(`T.watch(); return T.st()`);
check('교실로 돌아가기', r.step === 'class', r);
r = await B.ev(`return T.use('class')`);
r = await B.ev(`lumen.step(0.3); const s = lumen.dialogue.scene?.id; T.peek(6); return s`);
check('세 사람 장면', r === 'truth', r);
await B.shot('21-truth');
r = await B.ev(`T.watch(); lumen.step(2); return T.st()`);
check('아침 방송 목표', r.step === 'broadcast' && r.hour < 8, r);
await B.shot('22-morning');
r = await B.ev(`return T.use('podium')`);
r = await B.ev(`lumen.step(0.3); const s = lumen.dialogue.scene?.id; T.watch(); lumen.step(0.5); return { s, state: lumen.game.state, title: document.getElementById('end-title').textContent, text: document.getElementById('end-text').textContent, journal: !document.getElementById('end-journal-btn').classList.contains('hidden') }`);
check('첫 아침 방송 뒤 끝 화면', r.s === 'broadcast' && r.state === 'end' && r.title === '《돌아갈 자리》' && r.journal, r);
await B.shot('23-end');
r = await B.ev(`document.getElementById('end-journal-btn').click(); lumen.step(0.2); return { prog: document.getElementById('journal-progress').textContent, heads: [...document.querySelectorAll('#journal-scenes .jhead')].map(e => e.textContent) }`);
check('수첩에 1~4장이 모두', r.heads.length === 4, r);
await B.shot('24-journal');

out.errors = B.logs.filter((l) => /error|exception/i.test(l) && !/caches|online|fetch|CORS|ERR_/i.test(l));
check('콘솔 오류 없음', out.errors.length === 0, out.errors);
await B.close();
const bad = out.checks.filter((c) => !c.ok).length;
console.log(`\n${out.checks.length - bad}/${out.checks.length} 통과`);
process.exit(bad ? 1 : 0);
