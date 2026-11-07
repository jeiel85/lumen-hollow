// 밤 규칙 화면 확인(#14·#21·#28): 밤에 배전반을 열어도 시간이 흐르고 맞으면 닫힌다(낮에는 멈춘다),
// 화면 밖 그늘이 표시, 돌려보낸 그림자가 닿은 집의 창, 금빛 기둥은 밤에만.
//   node tests/e2e/night.mjs [url]
import { launch } from './cdp.mjs';

const [,, url = 'http://127.0.0.1:8000/?debug', w = '1280', h = '720'] = process.argv;
const B = await launch(url, +w, +h);
const ok = [];
const check = (n, c, i) => { ok.push(!!c); console.log(`${c ? 'OK ' : 'NG '} ${n}${i !== undefined ? ` — ${JSON.stringify(i)}` : ''}`); };
for (let i = 0; i < 60; i++) {
  if (await B.ev('return !!(window.lumen && lumen.game.ready)')) break;
  await B.sleep(500);
}
await B.ev(`
  const L = lumen; L.story.scenesFor = () => [];
  window.T = {
    start() { L.startGame(); L.step(0.3); for (let i = 0; i < 30 && (L.dialogue.scene || L.game.state === 'story'); i++) { if (L.dialogue.scene) L.dialogue.skip(); L.step(0.3); } },
    shade(x, z) { const s = L.shades.list.find((e) => !e.active); Object.assign(s, { active: true, state: 'stalk', x, z, vx: 0, vz: 0, fade: 1, burn: 0, cool: 0, tag: null, tough: 1, path: null }); s.g.visible = true; return s; },
  };
  return 1;`);

let r = await B.ev(`T.start(); lumen.game.peaceful = true; lumen.env.setHour(12); lumen.openGrid(); const h0 = lumen.env.hour; lumen.step(2, 1 / 30);
  const r = { state: lumen.game.state, moved: +(lumen.env.hour - h0).toFixed(3), live: !document.getElementById('grid-live').classList.contains('hidden') }; lumen.closeGrid(); return r;`);
check('낮에 배전반을 열면 시간이 멈춘다', r.state === 'grid' && r.moved === 0 && !r.live, r);
r = await B.ev(`lumen.env.setHour(21); lumen.step(0.5, 1 / 30); lumen.openGrid(); const h0 = lumen.env.hour; lumen.step(2, 1 / 30);
  return { state: lumen.game.state, moved: +(lumen.env.hour - h0).toFixed(3), live: !document.getElementById('grid-live').classList.contains('hidden') };`);
check('밤에 배전반을 열어도 시간이 흐르고 안내가 보인다', r.state === 'grid' && r.moved > 0.2 && r.live, r);
await B.sleep(300);
await B.shot('night-grid');
r = await B.ev(`const P = lumen.player; P.hp = 100; T.shade(P.pos.x + 0.5, P.pos.z); lumen.step(0.6, 1 / 30); return { state: lumen.game.state, hp: Math.round(P.hp) };`);
check('밤에 배전반을 연 채 맞으면 배전반이 닫힌다', r.state === 'play' && r.hp < 100, r);
r = await B.ev(`const C = lumen.car; C.pos.set(lumen.player.pos.x + 2, 0, lumen.player.pos.z); C.fuel = 50; C.lamp = true; lumen.step(0.2, 1 / 30);
  lumen.openGrid(); const f0 = C.fuel; lumen.step(3, 1 / 30); const r = { state: lumen.game.state, used: +(f0 - C.fuel).toFixed(2) }; lumen.closeGrid(); C.lamp = false; return r;`);
check('밤에 배전반을 연 동안에도 작업등이 연료를 쓴다', r.state === 'grid' && r.used > 0.5, r);
r = await B.ev(`lumen.openGrid(); const ext = lumen.renderer.getContext().getExtension('WEBGL_lose_context'); ext.loseContext();
  await new Promise((res) => setTimeout(res, 200)); const t0 = lumen.game.time; await new Promise((res) => setTimeout(res, 600));
  const r = { state: lumen.game.state, lost: lumen.game.contextLost, moved: +(lumen.game.time - t0).toFixed(3) };
  ext.restoreContext(); await new Promise((res) => setTimeout(res, 1500)); return r;`);
check('밤에 배전반을 연 채 그래픽 컨텍스트를 잃으면 일시정지되고 진행하지 않는다', r.lost && r.state === 'pause' && r.moved === 0, r);
await B.ev(`if (lumen.game.state === 'pause') lumen.pauseGame(false); lumen.step(0.3); return 1`);

// 기본 줌의 데스크톱 화면에는 둘레 16m가 다 들어온다. 가장 가깝게 당겨(휠) 화면 밖을 만든다.
r = await B.ev(`for (const s of lumen.shades.list) { s.active = false; s.g.visible = false; }
  const P = lumen.player; P.hp = 100; P.pos.set(16, 0, -16); lumen.game.zoomTarget = 8; lumen.step(1.5, 1 / 30);
  let at = null;
  for (let a = 0; a < Math.PI * 2 && !at; a += 0.1) {
    const x = P.pos.x + Math.cos(a) * 14, z = P.pos.z + Math.sin(a) * 14;
    const v = new lumen.THREE.Vector3(x, 0.8, z).project(lumen.camera);
    if (Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) at = { x, z, ndc: [+v.x.toFixed(2), +v.y.toFixed(2)] };
  }
  if (!at) return { shown: -1 };
  T.shade(at.x, at.z); lumen.step(0.1, 1 / 30);
  return { shown: [...document.querySelectorAll('.threat')].filter((e) => !e.hidden).length, ndc: at.ndc };`);
check('화면 밖 16m 안의 그늘이는 가장자리에 붉은 표시(당겨 본 화면)', r.shown >= 1, r);
r = await B.ev(`const s = lumen.shades.list.find((e) => e.active); s.x = lumen.player.pos.x + 2; s.z = lumen.player.pos.z; lumen.step(0.1, 1 / 30);
  return { shown: [...document.querySelectorAll('.threat')].filter((e) => !e.hidden).length };`);
check('화면 안의 그늘이에는 표시하지 않는다', r.shown === 0, r);
await B.ev(`lumen.game.zoomTarget = 12.5; for (const s of lumen.shades.list) { s.active = false; s.g.visible = false; } lumen.step(1, 1 / 30); return 1`);
await B.sleep(300);
await B.shot('night-threat');

r = await B.ev(`for (const s of lumen.shades.list) { s.active = false; s.g.visible = false; }
  const P = lumen.player; P.hp = 100; P.battery = 100; P.flashOn = true;
  const home = lumen.world.homes[0]; P.pos.set(home.x + 4, 0, home.z + 4);
  lumen.step(0.3, 1 / 30);
  const s = T.shade(P.pos.x + 3, P.pos.z); P.facing = Math.PI / 2;
  for (let i = 0; i < 40 && !lumen.wisps.windows.some((w) => w.home); i++) { P.facing = Math.atan2(s.x - P.pos.x, s.z - P.pos.z); P.battery = 100; lumen.step(0.25, 1 / 30); }
  return { woken: lumen.wisps.windows.filter((w) => w.home && w.m.visible).length };`);
check('흩어 보낸 그림자가 닿은 집 창에 불이 켜진다', r.woken >= 1, r);
await B.sleep(300);
await B.shot('night-window');

r = await B.ev(`const loot = lumen.world.loot.find((l) => l.item === 'fuse' && !l.searched); lumen.wisps.candle(loot, 0.2);
  const c = lumen.wisps.candles.find((q) => q.loot === loot);
  lumen.env.setHour(21.5); lumen.step(0.3, 1 / 30); const night = c.g.children[3].visible;
  lumen.env.setHour(12); lumen.step(0.3, 1 / 30); const day = c.g.children[3].visible;
  return { night, day, candleDay: c.g.visible };`);
check('금빛 기둥은 밤에만, 낮에는 촛불만', r.night && !r.day && r.candleDay, r);

const errs = B.logs.filter((l) => /error|exception/i.test(l) && !/caches|online|fetch|CORS|ERR_/i.test(l));
check('콘솔 오류 없음', errs.length === 0, errs);
console.log(`\n${ok.filter(Boolean).length}/${ok.length} 통과`);
B.close();
process.exit(ok.every(Boolean) ? 0 : 1);
