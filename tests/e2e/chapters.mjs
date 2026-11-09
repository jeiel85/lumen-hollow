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
// 장마다 12장면 보강: 2장 시작에 마을 선착장의 배웅(식당 주인)
r = await B.ev(`const ok = T.until('depart'); lumen.step(0.3); return { ok, scene: lumen.dialogue.scene?.id, owner: lumen.chapters.npcs.owner.mesh.visible }`);
check('2장 시작: 선착장에서 식당 주인이 배웅한다', r.ok && r.scene === 'depart' && r.owner, r);
await B.ev(`T.peek(3); return 1`);
await B.shot('03a-depart');
r = await B.ev(`T.watch(); return T.st()`);
check('배웅을 다 보면 다시 배 타기 차례', r.state === 'play' && r.step === 'ferry', r);
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
check('첫 대면 뒤 등잔 목표(시간이 멈춘 오후)', r.step === 'oil' && r.state === 'play' && r.obj.includes('등잔'), r);
await B.shot('06-island');
// 2장 등잔 넷(#58): 기름 없이는 못 채우고, 기름통·기름병이 둘씩 채운다. 앞의 셋은 당직 일지가 나온다.
r = await B.ev(`const h0 = lumen.env.hour; lumen.step(5); return { blocked: T.use('lampTower'), still: Math.abs(lumen.env.hour - h0) < 0.01 }`);
check('기름 없이는 등잔을 못 채우고, 그동안 시간이 멈춰 있다', String(r.blocked).startsWith('blocked:') && r.still, r);
r = await B.ev(`return [T.use('oilCan'), T.use('oilBottle'), lumen.chapters.oilLeft]`);
check('기름통·기름병을 주우면 등잔 넷 분', r[2] === 4, r);
r = await B.ev(`
  const out = [];
  for (const id of ['lampDock', 'lampTower', 'lampSteps', 'lampHut']) {
    out.push(T.use(id));
    lumen.step(1.2);
    out.push(lumen.dialogue.docOpen ? document.getElementById('doc-title').textContent : '-');
    if (id !== 'lampHut') T.settle();
  }
  return { out, found: ['page1926', 'page1979', 'pagelast'].filter((c) => lumen.story.isFound(c)) }`);
check('등잔 넷을 채우면 깡통 셋에서 당직 일지(부두는 빈 깡통)', r.out[1] === '-' && r.out[3].includes('1926') && r.out[5].includes('1979'), r);
await B.shot('06b-watch-journal');
r = await B.ev(`lumen.dialogue.closeDoc(); lumen.step(0.6); const s = lumen.dialogue.scene?.id; return { s, st: T.st() }`);
check('넷째 일지를 닫으면 당직 수칙 장면', r.s === 'rules' || r.st.q.includes('rules'), r);
await B.ev(`T.until('rules'); T.peek(1); lumen.step(0.3); return 1`);
await B.sleep(900);
await B.shot('06c-rules-art');
r = await B.ev(`T.watch(); return T.st()`);
check('당직 수칙 뒤 해 질 녘 첫 밤 당직', r.step === 'vigil' && r.hour >= 18 && r.hour < 19, r);
// 정시 무전과 빛먹이
r = await B.ev(`
  lumen.env.setHour(21.05); lumen.step(0.3);
  const due = !!lumen.chapters.spot('radio').show();
  const label = T.use('radio');
  return { due, label, after: lumen.chapters.spot('radio').show() }`);
check('정시(21시)에 돌계단 무전기로 부른다', r.due && String(r.label).includes('정시 무전') && !r.after, r);
// 자정 무전은 장면으로(「대답 없음」)
r = await B.ev(`
  lumen.env.setHour(0.05); lumen.player.hp = 100; lumen.step(0.3);
  const due = !!lumen.chapters.spot('radio').show();
  const label = T.use('radio');
  lumen.step(0.3);
  const scene = lumen.dialogue.scene?.id;
  T.watch();
  return { due, label, scene, seen: lumen.story.isSeen('midnight'), st: T.st() }`);
check('자정에 무전기로 부르면 대답 없음 장면', r.due && r.scene === 'midnight' && r.seen && r.st.step === 'vigil', r);
r = await B.ev(`
  const C = lumen.chapters, L = C.lanterns.find((l) => l.id === 'lampHut');
  T.goto(C.lakeRefs.stepsOut.x, C.lakeRefs.stepsOut.z);
  lumen.shades.clear();
  lumen.shades.spawnKind(L.x, L.z, lumen.ground, 'eater', 1.7);
  const e = lumen.shades.list.find((s) => s.active && s.kind === 'eater');
  e.x = L.x + 4.5; e.z = L.z; e.state = 'stalk'; e.fade = 1;
  let t = 0;
  for (; t < 40 && !L.out; t += 0.5) lumen.step(0.5);
  return { out: L.out, t, spot: C.spot('lampHut').show(), label: C.nearest(L.x, L.z)?.label }`);
check('빛먹이가 등잔에 붙으면 등잔이 꺼지고, 다시 붙일 수 있다', r.out && r.spot && String(r.label).includes('다시 붙이기'), r);
await B.shot('06d-vigil-eater');
r = await B.ev(`lumen.shades.clear(); T.use('lampHut'); const L = lumen.chapters.lanterns.find((l) => l.id === 'lampHut'); return { out: L.out, on: L.on }`);
check('꺼진 등잔을 다시 붙였다', !r.out && r.on, r);
// 새벽 세 시에는 부르지 않아도 무전기가 지직거린다(「세 시의 잡음」). 그 뒤 세 시 무전은 다른 안내
r = await B.ev(`
  lumen.shades.clear(); lumen.env.setHour(3.05); lumen.player.hp = 100; lumen.step(0.3);
  const scene = lumen.dialogue.scene?.id;
  T.watch();
  const label = T.use('radio');
  return { scene, seen: lumen.story.isSeen('threeam'), label, st: T.st() }`);
check('세 시에 저절로 세 시의 잡음 장면', r.scene === 'threeam' && r.seen && String(r.label).includes('정시 무전'), r);
r = await B.ev(`
  lumen.env.setHour(5.7);
  let t = 0;
  for (; t < 30 && !lumen.chapters.flag('vigil'); t += 0.5) { lumen.player.hp = 100; lumen.step(0.5); }
  lumen.step(0.3);
  const scene = lumen.dialogue.scene?.id;
  return { t, scene, st: T.st() }`);
check('새벽이 오면 첫 밤 당직이 끝나고 인계부·보관함 차례', r.st.flags.includes('vigil') && r.st.step === 'search', r);
r = await B.ev(`T.watch(); return { seen: lumen.story.isSeen('morning'), st: T.st() }`);
check('당직이 끝난 새벽에 심지를 내리며 장면', r.seen && r.st.state === 'play', r);
r = await B.ev(`return T.use('spare')`);
check('부두 보관함 열기(순서 자유: 보관함 먼저)', String(r).includes('보관함'), r);
r = await B.ev(`T.settle(); return { st: T.st(), found: lumen.story.isFound('spare') }`);
check('예비 송수신기 종이띠를 수첩에 적음', r.found, r);
r = await B.ev(`return T.use('book')`);
await B.ev(`lumen.step(0.3); return 1`);
await B.shot('07-islandbook');
r = await B.ev(`T.settle(); return { st: T.st(), tally: lumen.story.isSeen('tally') }`);
check('두 물건 확인 뒤 도와 달라는 말 장면과 교대 요청 목표', r.st.step === 'call' && r.tally, r);
r = r.st;
// 밤: 고정등 아래 돌계단
r = await B.ev(`lumen.env.setHour(20.5); T.goto(lumen.chapters.spot('call').x, lumen.chapters.spot('call').z); lumen.player.flashOn = true; lumen.step(6); return { st: T.st(), lit: !!lumen.ground.lightAt(lumen.player.pos.x, lumen.player.pos.z), shades: lumen.shades.list.filter(s => s.active).length }`);
check('밤에 돌계단은 고정등 불빛 안', r.lit, r);
await B.shot('08-island-night');
r = await B.ev(`return T.use('call')`);
check('교대 요청', String(r).includes('부르기'), r);
r = await B.ev(`lumen.step(0.3); const s = lumen.dialogue.scene?.id; T.watch(); return { s, st: T.st(), gran: lumen.chapters.npcs.gran.mesh.visible, owner: lumen.chapters.npcs.owner.mesh.visible }`);
check('대타 장면 뒤 등대 문 앞으로 가는 차례(할머니·식당 주인이 서 있다)', r.s === 'relief' && r.st.step === 'tour' && r.st.obj.includes('등대 문') && r.gran && r.owner, r);
r = await B.ev(`const m = lumen.chapters.lakeRefs.towerMark; T.goto(m.x + 1.5, m.z + 1.5); lumen.step(0.4); const s = lumen.dialogue.scene?.id; T.peek(2); return s`);
check('등대 문 앞에 가면 둘이 정할 것 장면', r === 'switch', r);
await B.shot('08b-switch');
r = await B.ev(`const ok = T.until('bowls'); return { ok, st: T.st() }`);
check('둘이 정할 것 뒤 두 그릇 장면', r.ok, r);
await B.ev(`T.peek(2); return 1`);
await B.shot('09-bowls');
r = await B.ev(`T.watch(); return T.st()`);
check('2장 마무리: 마을로 돌아가기 목표', r.step === 'leave', r);
await B.shot('10-island-leave');
r = await B.ev(`const l = T.use('boatIsland'); lumen.step(0.3); const s = lumen.dialogue.scene?.id; T.peek(3); return { l, s }`);
check('나룻배에 오르면 섬을 등지고 장면', r.s === 'farewell', r);
await B.shot('10b-farewell');
r = await B.ev(`T.watch(); lumen.step(2.0); return { st: T.st(), scene: lumen.dialogue.scene?.id, q: [...lumen.storyQueue] }`);
check('섬을 떠나면 3장: 강 건너 나루의 둑길 위의 자국', r.st.ch === 3 && r.st.step === 'go' && (r.scene === 'riverside' || r.q.includes('riverside')), r);
await B.ev(`T.peek(4); return 1`);
await B.shot('10c-riverside');
r = await B.ev(`T.watch(); return T.st()`);

// 재시작 확인: 3장 도중 저장이 이어지는지(처음 화면 → 장 단추)
r = await B.ev(`lumen.backToTitle(); lumen.step(0.2); return document.getElementById('chapter-btn').textContent`);
check('2장 끝낸 뒤 처음 화면 단추는 3장', r.includes('3장'), r);

// ---------------------------------------------------------------- 3장
r = await B.ev(`document.getElementById('chapter-btn').click(); lumen.step(2.0); return { st: T.st(), scene: lumen.dialogue.scene?.id }`);
check('3장 다시 열기: 강 건너 구호소 목표(본 나루 장면은 다시 안 나온다)', r.st.ch === 3 && r.st.step === 'go' && !r.scene, r);
r = r.st;
await B.shot('11-ch3-start');
r = await B.ev(`const t = lumen.chapters.river.tentMark; T.goto(t.x - 4, t.z + 4); lumen.step(0.5); return { scene: lumen.dialogue.scene?.id }`);
check('구호소에 다가가면 열두 번째 칸 장면', r.scene === 'count', r);
await B.ev(`T.peek(8); return 1`);
await B.shot('12-count-shoes');
r = await B.ev(`T.watch(); return T.st()`);
check('본관 처마 밑 침상 목표(#58)', r.step === 'beds' && r.obj.includes('침상'), r);
r = await B.ev(`return { bed: T.use('bed11'), tag: T.use('tag') }`);
check('봉투 없이는 침상에 놓을 수 없고, 창고 기록은 아직 닫혀 있다', String(r.bed).startsWith('blocked:') && r.tag === 'no-spot' || String(r.tag) === 'nothing-near', r);
r = await B.ev(`
  const C = lumen.chapters;
  T.use('basket');
  const carry = C.carry;
  const wrong = T.use('bed11');
  return { carry, wrong, found: lumen.story.isFound('bed11') || lumen.story.isFound('bed3') }`);
check('짝이 틀리면 놓이지 않는다(3번 봉투 → 11번 침상)', r.carry === 'bed3' && !r.found, r);
r = await B.ev(`
  const C = lumen.chapters, out = [];
  for (const id of ['bed3', 'bed8', 'bed11', 'bed14', 'bed20']) {
    for (let k = 0; k < 6 && C.carry !== id; k++) T.use('basket');
    out.push(T.use(id));
    lumen.step(0.3);
    out.push(document.getElementById('doc-title').textContent);
    T.settle();
  }
  return { out, st: T.st(), neighbors: lumen.story.isSeen('neighbors') }`);
check('봉투 다섯을 제 침상에 놓으면 표찰 다섯(첫 봉투 뒤 먼저 깬 사람 장면)', r.out.filter((x) => String(x).startsWith('새 표찰')).length === 5 && r.neighbors, r);
await B.shot('12b-beds');
r = await B.ev(`lumen.step(0.6); const s = lumen.dialogue.scene?.id; T.watch(); return { s, seen: lumen.story.isSeen('fivebeds'), st: T.st() }`);
check('다섯 자리 장면 뒤 창고 목표', r.seen && r.st.step === 'store', r);
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
r = await B.ev(`T.watch(); lumen.step(2); return T.st()`);
check('무전 뒤 그날 밤: 둑길 밤길 목표', r.step === 'levee' && r.hour > 19, r);
r = await B.ev(`
  const lamps = lumen.chapters.river.leveeLamps; const off = lamps.map(() => 0), on = lamps.map(() => 0);
  for (let i = 0; i < 48; i++) { lumen.player.hp = 100; lumen.step(0.25); lamps.forEach((L, k) => { if (L.on) on[k]++; else off[k]++; }); }
  return { off, on }`);
check('둑길 가로등이 저마다 꺼졌다 켜진다(출렁임)', r.off.every((n) => n > 0) && r.on.every((n) => n > 0), r);
await B.shot('13b-levee-night');
r = await B.ev(`const m = lumen.chapters.river.restLamp; T.goto(m.x + 0.5, m.z - 1.2); lumen.step(0.5); const s = lumen.dialogue.scene?.id; T.peek(2); return s`);
check('둑길 가운데 가로등을 지나면 불 밑의 자국 장면', r === 'marks', r);
await B.shot('13b2-marks');
r = await B.ev(`T.watch(); return T.st()`);
r = await B.ev(`const t = lumen.chapters.river.tentMark; T.goto(t.x - 3, t.z + 3); lumen.step(0.5); const s = lumen.dialogue.scene?.id; T.peek(3); return s`);
check('구호소에 닿으면 열둘을 데려온 길 장면', r === 'stretchers', r);
await B.sleep(900);
await B.shot('13c-stretchers');
r = await B.ev(`T.watch(); return T.st()`);
check('약사에게 반납 목표', r.step === 'back', r);
r = await B.ev(`T.use('return'); lumen.step(0.3); const s = lumen.dialogue.scene?.id; T.peek(4); return s`);
check('반납하면 빈 들것 장면(세 시의 목소리가 밝혀진다)', r === 'handback', r);
r = await B.ev(`T.watch(); lumen.step(0.2); return document.getElementById('doc-title').textContent`);
check('약사의 인계 쪽지', r === '약사의 인계 쪽지', r);
r = await B.ev(`T.settle(); return { st: T.st(), gran: lumen.chapters.npcs.gran.mesh.visible }`);
check('별관 목표(할머니는 먼저 갔다)', r.st.step === 'annex' && !r.gran, r);
r = await B.ev(`const t = lumen.chapters.river.stepsMark; T.goto(t.x + 2.5, t.z); lumen.step(0.5); return { scene: lumen.dialogue.scene?.id, gran: lumen.chapters.npcs.gran.mesh.visible }`);
check('별관 계단 앞에서 문 앞에서 장면(할머니가 먼저 와 있다)', r.scene === 'doorstep' && r.gran, r);
await B.ev(`T.peek(2); return 1`);
await B.shot('14b-doorstep');
r = await B.ev(`const ok = T.until('chair'); return { ok }`);
check('이어서 보호자 자리 장면', r.ok, r);
await B.ev(`T.peek(2); return 1`);
await B.shot('15-chair-classroom');
r = await B.ev(`const ok = T.until('outside'); lumen.step(0.3); T.peek(1); return { ok, scene: lumen.dialogue.scene?.id, sit: lumen.chapters.npcs.granSit.mesh.visible }`);
check('보호자 자리 뒤 새벽, 문 밖의 당직(할머니가 계단에 앉아 있다)', r.ok && r.scene === 'outside' && r.sit, r);
await B.sleep(900);
await B.shot('15b-outside');
r = await B.ev(`T.watch(); lumen.step(0.4); const card = document.getElementById('chapter-card-text').textContent; lumen.step(1.6); return { st: T.st(), scene: lumen.dialogue.scene?.id, card }`);
check('4장으로 넘어가 이튿날 오후, 두 사람 장면', r.st.ch === 4 && r.card.includes('이튿날 오후') && (r.scene === 'roll' || r.st.q.includes('roll')), r);

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
r = await B.ev(`lumen.step(0.5); const s = lumen.dialogue.scene?.id; T.peek(2); return { s, st: T.st() }`);
check('두 등을 켜면 문가의 당번 장면, 밤을 기다리기', r.st.step === 'wait' && r.s === 'watchman', r);
await B.shot('16b-watchman');
r = await B.ev(`T.watch(); return T.st()`);
r = await B.ev(`const l = T.use('tag1991'); lumen.step(0.3); const t = document.getElementById('doc-title').textContent; T.settle(); return { l, t, n: lumen.chapters.nameTags }`);
check('이름표 하나를 줍는다(교실 뒤 책상 서랍)', String(r.l).includes('이름표') && r.n.found === 1, r);
await B.shot('17-lamps-day');
r = await B.ev(`T.use('wait'); lumen.step(0.3); const s = lumen.dialogue.scene?.id; T.peek(1); return { s, sit: lumen.chapters.npcs.granSit.mesh.position.x - lumen.chapters.river.granStepsSit.x }`);
check('계단에 앉으면 계단에서 장면(할머니가 곁에 앉는다)', r.s === 'stairs' && Math.abs(r.sit) < 0.01, r);
await B.sleep(600);
await B.shot('17b-stairs');
r = await B.ev(`T.watch(); lumen.step(2.0); return T.st()`);
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
r = await B.ev(`T.use('water'); lumen.step(0.3); const s = lumen.dialogue.scene?.id; T.watch(); return { s, st: T.st() }`);
check('물을 받으면 열셋 장면 뒤 다시 비추기', r.s === 'water' && r.st.step === 'night2', r);
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
r = await B.ev(`const ok = T.until('island'); return { ok, st: T.st() }`);
check('세 사람 뒤 섬에서 온 무전', r.ok, r);
r = await B.ev(`const ok = T.until('third'); return { ok, st: T.st(), island: lumen.story.isSeen('island') }`);
check('섬에서 온 무전 뒤 아직 밤, 남은 창 장면', r.ok && r.island && r.st.hour > 20, r);
r = await B.ev(`T.watch(); lumen.step(2.5); const R = lumen.chapters.river; return { st: T.st(), lamps: Object.fromEntries(Object.entries(R.laneLamps).map(([k, L]) => [k, L.on])), t3: lumen.shades.hasTarget('t3') }`);
check('길 내기 목표: 천막 쪽만 꺼져 있고 세 번째 그림자가 나온다', r.st.step === 'route' && r.lamps.west && r.lamps.mid && !r.lamps.east && r.t3, r);
await B.shot('21b-route');
// 틀린 길(천막 쪽)에서 흩으면 본관에 닿지 못하고 다시 모인다
r = await B.ev(`
  const P = lumen.player; P.flashOn = true;
  let t = 0, seen = false, gone = false;
  for (; t < 90; t += 0.25) {
    const s = lumen.shades.list.find((e) => e.active && e.tag === 't3' && e.state !== 'die');
    if (s) { seen = true; T.goto(s.x - 2.5, s.z - 2.5); P.facing = Math.atan2(s.x - P.pos.x, s.z - P.pos.z); P.battery = 100; P.hp = 100; }
    else if (seen) { gone = true; break; }
    lumen.step(0.25);
  }
  return { t, seen, gone, home3: lumen.chapters.flag('home3'), st: T.st() }`);
check('틀린 길(천막 쪽)에서 흩으면 본관 창으로 가지 않는다', r.seen && r.gone && !r.home3 && r.st.step === 'route', r);
r = await B.ev(`return [T.use('board'), T.use('board')]`);
check('배전반을 두 번 눌러 서쪽 골대 쪽을 끈다', String(r[1]).includes('서쪽 골대 쪽'), r);
r = await B.ev(`
  const C = lumen.chapters, R = C.river, P = lumen.player;
  const lamps = Object.fromEntries(Object.entries(R.laneLamps).map(([k, L]) => [k, L.on]));
  T.goto(R.bedsMark.x, R.bedsMark.z + 2); P.flashOn = true;
  let t = 0, near = 99;
  for (; t < 120 && !C.flag('home3'); t += 0.25) {
    const s = lumen.shades.list.find((e) => e.active && e.tag === 't3' && e.state !== 'die');
    if (s) {
      near = Math.hypot(s.x - R.bedsMark.x, s.z - R.bedsMark.z);
      if (near < 8) { P.facing = Math.atan2(s.x - P.pos.x, s.z - P.pos.z); P.flashOn = true; } else P.flashOn = false;
      P.battery = 100; P.hp = 100;
    }
    lumen.step(0.25);
  }
  return { lamps, t, home3: C.flag('home3') }`);
check('서쪽 길로 온 그림자를 침상 앞에서 비추면 본관 창으로', !r.lamps.west && r.lamps.mid && r.lamps.east && r.home3, r);
await B.shot('21c-third-home');
r = await B.ev(`lumen.step(4); const s = lumen.dialogue.scene?.id; T.peek(3); return { s, st: T.st() }`);
check('이튿날 아침 점호 장면', r.s === 'rollcall' && r.st.step === 'rollcall', r);
await B.shot('21d-rollcall');
r = await B.ev(`T.watch(); return T.st()`);
check('아침 방송 목표', r.step === 'broadcast' && r.hour < 8, r);
await B.shot('22-morning');
r = await B.ev(`return T.use('podium')`);
r = await B.ev(`lumen.step(0.3); const s = lumen.dialogue.scene?.id; const ok = T.until('reports'); T.peek(4); return { s, ok }`);
check('첫 아침 방송 뒤 첫 제보 다음 장면', r.s === 'broadcast' && r.ok, r);
await B.sleep(900);
await B.shot('22b-reports-memo');
r = await B.ev(`T.watch(); lumen.step(0.5); return { state: lumen.game.state, title: document.getElementById('end-title').textContent, text: document.getElementById('end-text').textContent, best: document.getElementById('end-best').textContent, journal: !document.getElementById('end-journal-btn').classList.contains('hidden') }`);
check('끝 화면: 제목·글·찾은 이름표 수', r.state === 'end' && r.title === '《돌아갈 자리》' && r.best.includes('1/5') && r.journal, r);
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
