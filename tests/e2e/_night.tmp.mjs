import { launch } from './cdp.mjs';
const [,, url] = process.argv;
const B = await launch(url, 960, 540);
for (let i = 0; i < 60; i++) { if (await B.ev('return !!(window.lumen && lumen.game.ready)')) break; await B.sleep(500); }
const out = {};
for (const n of (process.argv[3] ?? '0,3,6').split(',').map(Number)) {
  const runs = [];
  for (let rep = 0; rep < 3; rep++) {
    runs.push(await B.ev(`
      const L = lumen; L.story.scenesFor = () => [];
      L.startGame(); L.step(0.3);
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
        if (P.hp < hp) hits += Math.round((hp - P.hp) / 15);
        hp = P.hp;
        if (L.game.state !== 'play' || !P.alive) break;
      }
      return { first, hits, alive: P.alive, hp: Math.round(P.hp), peak };`));
  }
  out[`night${n + 1}`] = runs;
}
console.log(JSON.stringify(out));
B.close(); process.exit(0);
