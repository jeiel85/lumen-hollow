// 밤의 변화(#57): 해질녘 사건 고르기와 안내, 안개(화면·손전등 거리·화면 밖 표시), 전압 출렁임, 빛먹이·떼 그늘이 처음 만남 안내,
// 수첩 '밤의 기록', 판 저장·이어하기에 남는 사건, 셰이더를 새로 컴파일하지 않음. 안개 낀 밤·빛먹이를 찍는다.
//   node tests/e2e/nights.mjs [url] [폭 높이]
import { launch } from './cdp.mjs';

const [,, url = 'http://127.0.0.1:8000/?debug', w = '960', h = '540'] = process.argv;
const B = await launch(url, +w, +h);
const ok = [];
const check = (n, c, i) => { ok.push(!!c); console.log(`${c ? 'OK ' : 'NG '} ${n}${i !== undefined ? ` — ${JSON.stringify(i)}` : ''}`); };
// 처음 여는 Chrome은 셰이더 준비가 30초를 넘길 때가 있어 넉넉히 기다린다.
await B.sleep(800);
for (let i = 0; i < 90; i++) { if (await B.ev('return !!(window.lumen && lumen.game.ready)')) break; await B.sleep(500); }

const START = `
  const L = lumen, P = L.player, $ = (id) => document.getElementById(id);
  L.story.scenesFor = () => [];
  const skip = () => { for (let i = 0; i < 30 && (L.dialogue.scene || L.game.state === 'story'); i++) { if (L.dialogue.scene) L.dialogue.skip(); L.step(0.3); } };
  const toasts = () => [...document.querySelectorAll('#toasts > *')].map((t) => t.textContent);
`;

// 해질녘: 첫 밤은 사건 없이, 둘째 밤부터 고른 사건을 알리고 수첩에 남긴다(Math.random 0.5 → 사건 없음 4 · 안개 3 · 출렁임 3 중 안개)
let r = await B.ev(`${START}
  localStorage.removeItem('lumen.nights');
  L.startGame(); L.step(0.3); skip();
  const programs = L.renderer.info.programs.length;
  L.env.setHour(17.7); L.step(0.5); skip();
  const first = L.game.nightEvent;
  L.env.setHour(12); L.game.nights = 1; L.game.prevEvent = null;
  const rnd = Math.random; Math.random = () => 0.5;
  L.env.setHour(17.79); L.step(0.5);
  Math.random = rnd;
  const second = L.game.nightEvent;
  L.step(4); skip();
  return { first, second, toast: toasts().find((t) => /짙은 안개/.test(t)) ?? null, seen: JSON.parse(localStorage.getItem('lumen.nights')), programs };`);
check('첫 밤은 사건 없음, 둘째 밤 해질녘에 사건을 골라 알리고 남긴다', r.first === null && r.second === 'fog' && !!r.toast && r.seen?.seen?.includes('fog'), r);
const programs = r.programs;

// 안개: 밤이 깊어지면 안개가 차고, 손전등 거리·화면 밖 표시 거리가 줄고, 시계 옆에 '안개'
r = await B.ev(`${START}
  L.game.peaceful = true; L.env.setHour(22); L.step(4, 0.05);
  const label = $('phase-label').textContent;
  const out = { fog: +L.game.fog.toFixed(2), reach: +P.reach.toFixed(2), label, programs: L.renderer.info.programs.length };
  // 손전등을 켜고 10m 앞의 그늘이: 안개에서는 닿지 않는다(맑으면 닿는 거리)
  P.flashOn = true; P.battery = 100; P.facing = 0;
  out.beam10 = P.beamStrength(P.pos.x, P.pos.z + 10);
  return out;`);
check('안개 낀 밤: 안개가 차고 손전등이 짧게 닿으며(10m 밖), 시계 옆에 안개', r.fog > 0.85 && r.reach < 0.65 && r.beam10 === 0 && /안개/.test(r.label), r);
check('안개는 셰이더를 새로 컴파일하지 않는다', r.programs === programs, { before: programs, after: r.programs });
await B.sleep(400);
await B.shot(`nights-fog-${w}x${h}`);

// 새벽에 사건이 걷히고 안개도 걷힌다. 맑은 밤의 10m는 닿는다.
r = await B.ev(`${START}
  L.env.setHour(5.98); L.step(0.3); L.step(6, 0.05);
  const out = { event: L.game.nightEvent, fog: +L.game.fog.toFixed(3), reach: +P.reach.toFixed(2) };
  L.env.setHour(22); L.step(1);
  P.flashOn = true; P.battery = 100; P.facing = 0;
  out.beam10 = P.beamStrength(P.pos.x, P.pos.z + 10);
  return out;`);
check('새벽에 사건·안개가 걷히고, 맑은 밤에는 10m 앞까지 손전등이 닿는다', r.event === null && r.fog < 0.05 && r.beam10 > 0, r);

// 전압 출렁임: 플레이어가 선 켜진 구역의 가로등이 깜박인 뒤 꺼졌다 켜진다. 은신처는 흔들리지 않는다.
r = await B.ev(`${START}
  const Z = Object.values(L.world.zones).find((z) => z.id !== 'H');
  Object.assign(Z, { powered: true, on: true, tripped: false, level: 1 });
  const lamp = L.world.lamps.find((q) => q.zone === Z.id);
  P.pos.set(lamp.x + 1, 0, lamp.z + 1);
  L.game.peaceful = false; L.game.nightEvent = 'surge'; L.env.setHour(22); L.step(1); L.shades.clear();
  for (const z of Object.values(L.world.zones)) if (z !== Z && z.id !== 'H') z.on = false;
  const rnd = Math.random; Math.random = () => 0.3;
  L.game.surgeIn = 0; L.step(0.05);
  Math.random = rnd;
  const dip = Z.dip;
  L.shades.clear();
  L.step(1.6); L.shades.clear();
  const dark = L.world.lightAt(lamp.x, lamp.z);
  const label = $('phase-label').textContent;
  L.step(4); L.shades.clear();
  const back = !!L.world.lightAt(lamp.x, lamp.z);
  return { zone: Z.id, dip: +dip.toFixed(2), dark, back, label, home: L.world.zones.H.dip };`);
check('출렁임: 선 구역의 가로등이 깜박인 뒤 꺼졌다가 다시 켜지고, 은신처는 그대로', r.dip > 3.5 && r.dark === null && r.back && !r.home && /출렁임/.test(r.label), r);

// 빛먹이·떼 그늘이를 처음 만나면 무엇인지 알린다(한 번만)
r = await B.ev(`${START}
  L.game.nightEvent = null; L.game.peaceful = true; P.hp = 100;
  L.shades.clear();
  const S = L.shades;
  const near = (kind, dx) => { S._spawn(P.pos.x, P.pos.z, L.world); const s = S._last; s.x = P.pos.x + dx; s.z = P.pos.z + 6; S._become(s, kind, 99); s.state = 'stalk'; s.fade = 1; return s; };
  near('eater', 0);
  L.step(0.3);
  const t1 = toasts().filter((t) => /빛먹이/.test(t)).length;
  L.step(0.3);
  const t2 = toasts().filter((t) => /빛먹이/.test(t)).length;
  near('swarm', 2);
  L.step(0.3);
  const sw = toasts().some((t) => /그늘이 떼/.test(t));
  const seen = JSON.parse(localStorage.getItem('lumen.nights')).seen;
  return { t1, t2, sw, seen };`);
check('빛먹이·떼 그늘이를 처음 만나면 한 번 알리고 남긴다', r.t1 === 1 && r.t2 === 1 && r.sw && ['eater', 'swarm'].every((k) => r.seen.includes(k)), r);
await B.ev(`lumen.player.flashOn = true; lumen.env.setHour(22.5); lumen.step(0.5);`);
await B.sleep(300);
await B.shot(`nights-eater-${w}x${h}`);

// 판 저장·이어하기에 사건이 남는다
r = await B.ev(`${START}
  L.shades.clear(); L.game.peaceful = false; L.game.nightEvent = 'surge'; L.saveRun();
  const saved = JSON.parse(localStorage.getItem('lumen.run')).run.event;
  L.backToTitle(); L.resumeGame(); L.step(0.2);
  const resumed = L.game.nightEvent;
  // 안개 낀 밤이 지나고 낮에 저장·이어해도 어젯밤 사건을 기억한다(다음 해질녘에 안개가 다시 오지 않게, #68 리뷰)
  L.game.nightEvent = null; L.game.prevEvent = 'fog'; L.env.setHour(12); L.saveRun();
  L.backToTitle(); L.resumeGame(); L.step(0.2);
  return { saved, resumed, day: [L.game.nightEvent, L.game.prevEvent] };`);
check('판 저장·이어하기에 오늘 밤 사건과 어젯밤 사건이 남는다', r.saved === 'surge' && r.resumed === 'surge' && r.day[0] === null && r.day[1] === 'fog', r);

// 수첩 '밤의 기록': 만난 것은 설명, 못 만난 것은 ???
r = await B.ev(`${START}
  L.backToTitle();
  localStorage.setItem('lumen.nights', JSON.stringify({ v: 1, seen: ['shade', 'eater'] }));
  // 평가가 돌아온 뒤에 새로고침한다(평가 도중 페이지가 바뀌면 응답이 오지 않아 시험이 멈춘다).
  setTimeout(() => location.reload(), 50);
  return true;`);
await B.sleep(1500);
for (let i = 0; i < 60; i++) { if (await B.ev('return !!(window.lumen && lumen.game.ready)')) break; await B.sleep(500); }
r = await B.ev(`
  document.getElementById('journal-btn').click();
  const rows = [...document.querySelectorAll('#journal-nights li')].map((li) => ({ name: li.querySelector('b').textContent, locked: li.classList.contains('locked') }));
  document.getElementById('journal-close').click();
  return rows;`);
check("수첩 '밤의 기록': 만난 둘은 이름과 설명, 나머지 셋은 가림", r.length === 5 && r[0].name === '그늘이' && r[1].name === '빛먹이' && !r[1].locked && r.slice(2).every((x) => x.locked && x.name === '???'), r);

const errs = B.logs.filter((l) => /error|exception/i.test(l) && !/caches|online|fetch|CORS|ERR_/i.test(l));
check('콘솔 오류 없음', errs.length === 0, errs);
console.log(`\n${ok.filter(Boolean).length}/${ok.length} 통과`);
B.close();
process.exit(ok.every(Boolean) ? 0 : 1);
