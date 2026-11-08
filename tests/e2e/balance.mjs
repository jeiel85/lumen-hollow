// 밤 난이도 측정 도구(통과/실패 시험이 아니다): 완벽 조준 봇이 불 꺼진 길(-48, 48)에 서서 손전등을 가장 가까운 그늘이에
// 겨누고(배터리 무한) 밤마다 60초를 버틴다. 첫 피격 시각·피격 수·생존·동시에 깨어 있던 그늘이 수를 밤마다 3번씩 잰다.
// DECISIONS.md '밤 규칙 다시 맞춤'·'난이도 단계'의 수치가 이것으로 나왔다. 과부하·단서 주기를 사람 손에 맞출 때(#21·#28) 같이 본다.
// 손전등을 끈 채 가로등 아래에 서 있는 '가로등' 측정은 과부하로 차단기가 내려가기까지의 시간(#56)이다.
//   node tests/e2e/balance.mjs [url] [밤 번호(0부터, 쉼표로) 기본 0,3,6] [난이도(쉼표로) 기본 normal]
import { launch } from './cdp.mjs';
const [,, url = 'http://127.0.0.1:8000/?debug'] = process.argv;
const B = await launch(url, 960, 540);
for (let i = 0; i < 60; i++) { if (await B.ev('return !!(window.lumen && lumen.game.ready)')) break; await B.sleep(500); }
const out = {};
for (const level of (process.argv[4] ?? 'normal').split(',')) {
for (const n of (process.argv[3] ?? '0,3,6').split(',').map(Number)) {
  const runs = [];
  for (let rep = 0; rep < 3; rep++) {
    runs.push(await B.ev(`
      const L = lumen; L.story.scenesFor = () => [];
      L.settings.difficulty = '${level}';
      L.startGame(); L.step(0.3);
      const dmg = (await import('./src/difficulty.js')).DIFFICULTY['${level}'].damage;
      for (let i = 0; i < 30 && (L.dialogue.scene || L.game.state === 'story'); i++) { if (L.dialogue.scene) L.dialogue.skip(); L.step(0.3); }
      L.game.nights = ${n}; L.env.setHour(21.2); L.step(0.5, 1/30);
      const P = L.player; P.pos.set(-48, 0, 48); P.hp = 100; P.flashOn = true;
      let hits = 0, banished = 0, hp = 100, peak = 0, first = null;
      for (let t = 0; t < 60; t += 0.2) {
        let best = null, bd = 1e9;
        for (const s of L.shades.list) if (s.active && s.state === 'stalk') { const d = Math.hypot(s.x - P.pos.x, s.z - P.pos.z); if (d < bd) { bd = d; best = s; } }
        if (best) P.facing = Math.atan2(best.x - P.pos.x, best.z - P.pos.z);
        P.battery = 100; P.flashOn = true;
        L.step(0.2, 1/30);
        peak = Math.max(peak, L.shades.list.filter(s => s.active).length);
        if (P.hp < hp && first === null) first = +t.toFixed(1);
        if (P.hp < hp) hits += Math.round((hp - P.hp) / dmg);
        hp = P.hp;
        if (L.game.state !== 'play' || !P.alive) break;
      }
      return { first, hits, alive: P.alive, hp: Math.round(P.hp), peak };`));
  }
  out[`${level}.night${n + 1}`] = runs;
}
// 가로등: 켜진 은신처 가로등 가장자리에 서서 손전등 없이 버틸 때, 몰려든 그늘이가 차단기를 내리기까지(초, 90초 안에 안 내려가면 null)
const lamp = [];
for (let rep = 0; rep < 2; rep++) {
  lamp.push(await B.ev(`
    const L = lumen; L.story.scenesFor = () => [];
    L.settings.difficulty = '${level}';
    L.startGame(); L.step(0.3);
    for (let i = 0; i < 30 && (L.dialogue.scene || L.game.state === 'story'); i++) { if (L.dialogue.scene) L.dialogue.skip(); L.step(0.3); }
    L.game.nights = 3; L.env.setHour(21.2); L.step(0.5, 1/30);
    const H = L.world.lamps.find((l) => l.zone === 'H');
    const P = L.player; P.flashOn = false;
    let trip = null;
    for (let t = 0; t < 90; t += 0.2) {
      P.pos.set(H.x, 0, H.z); P.hp = 100; P.battery = 100;
      L.step(0.2, 1/30);
      if (L.world.zones.H.tripped || L.world.homeBreaker?.tripped) { trip = +t.toFixed(1); break; }
    }
    return trip;`));
}
out[`${level}.lampTrip`] = lamp;
}
console.log(JSON.stringify(out));
B.close(); process.exit(0);
