// 소리(#1·#6·#14): 엔진·타이어 소리 노드는 운전할 때만 돌고 내린 뒤 정리되는지, 멈춘 AudioContext(전화·백그라운드)가
// 화면 복귀·다음 입력에 다시 켜지는지, 환경음을 0으로 줄여도 그늘이 접근 속삭임이 들리는지, 발소리 박자, 음악 신호.
//   node tests/e2e/sound.mjs [url]
// 소리를 실제로 듣지는 않는다. 재생 중인 소스 노드 수와 master 출력의 세기(AnalyserNode)로 본다.
import { launch } from './cdp.mjs';

const [,, url = 'http://127.0.0.1:8000/?debug'] = process.argv;
const B = await launch(url, 960, 540);
// 재생 중인(start 뒤 아직 ended가 오지 않은) 소스 노드를 센다. 페이지 스크립트보다 먼저 심는다.
await B.send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    window.__audio = { live: new Set(), made: 0 };
    // AudioBufferSourceNode는 start를 따로 갖고 있어 둘 다 감싼다.
    for (const P of [AudioScheduledSourceNode.prototype, AudioBufferSourceNode.prototype]) {
      const start = P.start;
      P.start = function (...a) {
        __audio.made++;
        __audio.live.add(this);
        this.addEventListener('ended', () => __audio.live.delete(this));
        return start.apply(this, a);
      };
    }`,
});
await B.send('Page.reload');
await B.sleep(500);
for (let i = 0; i < 60; i++) {
  if (await B.ev('return !!(window.lumen && lumen.game.ready)')) break;
  await B.sleep(500);
}
const ok = [];
const check = (n, c, i) => { ok.push(!!c); console.log(`${c ? 'OK ' : 'NG '} ${n}${i !== undefined ? ` — ${JSON.stringify(i)}` : ''}`); };
const CH1 = ['arrival', 'dusk', 'dawn', 'light1', 'shadows', 'return', 'founders', 'lookout', 'promise', 'line', 'last', 'finale'];

// 실제 시간으로 기다리며 프레임을 돌린다(AudioContext 시계는 실제 시간으로 간다).
const RUN = `
  const L = lumen, S = L.sound;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const run = async (sec, dt = 1 / 60) => { const end = performance.now() + sec * 1000; while (performance.now() < end) { L.step(dt, dt); await wait(dt * 1000); } };
  const live = () => __audio.live.size;
  const noon = () => { L.env.setHour(12); L.player.hp = 100; L.shades.clear(); };
`;

let r = await B.ev(`
  for (const id of ${JSON.stringify(CH1)}) lumen.story.markSeen(id);
  lumen.startGame(); lumen.step(0.3);
  ${RUN}
  noon();
  await run(2.5); // 시작 효과음이 끝나기를 기다린다
  const idle = live();
  const state = S.ctx.state;
  // 운전석에 앉혀 2초 달린다
  const C = L.car;
  const s = Math.sin(C.a), c = Math.cos(C.a);
  L.player.pos.set(C.pos.x + 1.6 * c, 0, C.pos.z - 1.6 * s);
  L.input.keys.add('KeyE'); await run(0.8); L.input.keys.delete('KeyE');
  const driving = L.game.driving;
  L.input.keys.add('KeyW'); await run(1.5); L.input.keys.delete('KeyW');
  const drivingLive = live();
  const engine = !!S.engine;
  // 세우고 내린다. 내린 직후에는 소리가 줄어드는 중이라 노드가 남아 있고, 1.5초 뒤 정리된다.
  L.input.keys.add('KeyS'); await run(2.5); L.input.keys.delete('KeyS'); C.vel.set(0, 0, 0); await run(0.1);
  // 정리 순간의 엔진 게인(딸깍 소리가 나지 않으려면 거의 0이어야 한다)
  let downGain = null;
  const down = S._engineDown.bind(S);
  S._engineDown = (t) => { downGain = S.engine.out.gain.value; down(t); };
  L.input.keys.add('KeyE'); await run(0.6); L.input.keys.delete('KeyE');
  const exited = !L.game.driving;
  const tailLive = live();
  await run(2.2);
  return { state, idle, driving, drivingLive, engine, exited, tailLive, afterLive: live(), afterEngine: !!S.engine, downGain };`);
check('AudioContext가 돈다', r.state === 'running', r.state);
check('운전하면 엔진·타이어 소스 3개가 생긴다', r.driving && r.engine && r.drivingLive === r.idle + 3, r);
check('내린 뒤 1.5초가 지나면 엔진 노드를 멈추고 정리한다(운전 전과 같은 수)', r.exited && !r.afterEngine && r.afterLive === r.idle, r);
check('정리할 때 엔진 소리는 이미 거의 0(-40dB 아래)', r.downGain !== null && r.downGain < 0.002, r.downGain);

// 멈춘 AudioContext 다시 켜기
r = await B.ev(`${RUN}
  const out = {};
  await S.ctx.suspend();
  out.suspended = S.ctx.state;
  dispatchEvent(new PointerEvent('pointerdown'));
  await wait(300);
  out.afterPointer = S.ctx.state;
  await S.ctx.suspend();
  document.dispatchEvent(new Event('visibilitychange'));
  await wait(300);
  out.afterVisible = S.ctx.state;
  await S.ctx.suspend();
  dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ' }));
  await wait(300);
  out.afterKey = S.ctx.state;
  // iOS의 'interrupted' 상태(크롬에는 없다)에서도 입력 때 resume()을 부르는지: state를 흉내 낸다.
  let calls = 0;
  const realResume = S.ctx.resume.bind(S.ctx);
  Object.defineProperty(S.ctx, 'state', { configurable: true, get: () => 'interrupted' });
  S.ctx.resume = () => { calls++; return Promise.reject(new DOMException('interrupted', 'InvalidStateError')); };
  dispatchEvent(new Event('touchend'));
  dispatchEvent(new PointerEvent('pointerdown'));
  await wait(100);
  out.interruptedCalls = calls;
  out.fatal = !document.getElementById('error').classList.contains('hidden');
  delete S.ctx.state;
  S.ctx.resume = realResume;
  out.final = S.ctx.state;
  return out;`);
check('suspend → pointerdown에 다시 켜짐', r.suspended === 'suspended' && r.afterPointer === 'running', r);
check('suspend → 화면 복귀(visibilitychange)·keydown에 다시 켜짐', r.afterVisible === 'running' && r.afterKey === 'running', r);
check("'interrupted' 상태에서도 입력마다 resume()을 부르고, 거절돼도 오류 화면 없이 넘어감", r.interruptedCalls === 2 && !r.fatal && r.final === 'running', r);

// 접근 속삭임: 환경음 0에서도 master로 나온다
r = await B.ev(`${RUN}
  noon();
  const an = S.ctx.createAnalyser();
  an.fftSize = 2048;
  S.master.connect(an);
  const buf = new Float32Array(an.fftSize);
  const rms = async () => { let m = 0; for (let i = 0; i < 6; i++) { await run(0.1); an.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v; m = Math.max(m, Math.sqrt(s / buf.length)); } return m; };
  const mix = S.setMix.bind(S);
  let dread = 1;
  S.setMix = (m) => mix({ rain: 0, night: 0, buzz: 0, dread });
  S.setVolume(1, 0);
  await run(1.2);
  const whisperAmb0 = await rms();
  dread = 0;
  await run(1.5);
  const silent = await rms();
  dread = 1;
  S.setVolume(1, 1);
  await run(1.2);
  const whisperAmb1 = await rms();
  S.setMix = mix;
  S.master.disconnect(an);
  return { whisperAmb0: +whisperAmb0.toFixed(4), whisperAmb1: +whisperAmb1.toFixed(4), silent: +silent.toFixed(5) };`);
check('환경음 0%에서도 속삭임이 들린다(환경음 100%와 같은 세기)', r.whisperAmb0 > 0.005 && r.whisperAmb0 > r.silent * 10 && Math.abs(r.whisperAmb0 - r.whisperAmb1) < r.whisperAmb1 * 0.5, r);

// 발소리: 걷는 빠르기를 따라가는 박자, 비 오면 젖은 소리, 운전 중에는 없음
r = await B.ev(`${RUN}
  noon();
  const steps = [];
  const fs = S.footstep.bind(S);
  S.footstep = (speed, wet) => { steps.push({ t: L.game.time, speed, wet, made: __audio.made }); fs(speed, wet); steps[steps.length - 1].nodes = __audio.made - steps[steps.length - 1].made; };
  let stick = { x: 0, y: 0 };
  const ms = L.input.moveScreen.bind(L.input);
  L.input.moveScreen = () => stick;
  const rate = async (sx) => { stick = { x: sx, y: 0 }; await run(0.6); steps.length = 0; const t0 = L.game.time; await run(2); stick = { x: 0, y: 0 }; const n = steps.length; const sec = L.game.time - t0; const r = { perSec: +(n / sec).toFixed(2), speed: steps.length ? +steps[0].speed.toFixed(2) : 0, nodes: steps.length ? steps[0].nodes : 0, wet: steps.length ? +steps[0].wet.toFixed(2) : 0 }; await run(0.5); return r; };
  const full = await rate(1);
  const half = await rate(0.5);
  steps.length = 0; await run(1); const idle = steps.length;
  // 비 오는 밤(그늘이 없이)
  L.game.peaceful = true; L.env.setHour(23); L.env.rainyNight = true; L.env.rainLevel = 1;
  const wet = await rate(1);
  L.game.peaceful = false; noon(); L.env.rainLevel = 0; L.env.rainyNight = false;
  // 운전 중
  const C = L.car; const s = Math.sin(C.a), c = Math.cos(C.a);
  C.vel.set(0, 0, 0);
  L.player.pos.set(C.pos.x + 1.6 * c, 0, C.pos.z - 1.6 * s); await run(0.1);
  L.input.keys.add('KeyE'); await run(0.8); L.input.keys.delete('KeyE');
  steps.length = 0; L.input.keys.add('KeyW'); await run(1.5); L.input.keys.delete('KeyW');
  const driving = { on: L.game.driving, steps: steps.length };
  L.input.keys.add('KeyS'); await run(2.5); L.input.keys.delete('KeyS'); C.vel.set(0, 0, 0); await run(0.1);
  L.input.keys.add('KeyE'); await run(0.6); L.input.keys.delete('KeyE');
  L.input.moveScreen = ms; S.footstep = fs;
  return { full, half, idle, wet, driving };`);
check('발소리: 전속력 약 4걸음/초, 절반 속도 약 2걸음/초, 서 있으면 없음', Math.abs(r.full.perSec - 3.97) < 0.5 && Math.abs(r.half.perSec - 1.99) < 0.4 && r.idle === 0, r);
check('비 오는 길에서는 젖은 소리(물소리 소스가 하나 더)', r.wet.wet > 0.9 && r.wet.nodes === r.full.nodes + 1, { dry: r.full, wet: r.wet });
check('운전 중에는 발소리가 없다', r.driving.on && r.driving.steps === 0, r.driving);

// 음악 신호: 해질녘·새벽·구역 복구가 소리를 내고, 음소거면 아무것도 만들지 않는다
r = await B.ev(`${RUN}
  const out = {};
  for (const name of ['dusk', 'dawn', 'power']) { const m = __audio.made; S.play(name); out[name] = __audio.made - m; }
  S.toggleMute();
  const m = __audio.made; S.play('dusk'); S.footstep(1, 1);
  out.muted = __audio.made - m;
  S.toggleMute();
  return out;`);
check('해질녘·새벽·구역 복구 음악 신호(화음 + 선율)', r.dusk >= 13 && r.dawn >= 13 && r.power >= 13, r);
check('음소거면 음악 신호·발소리를 만들지 않는다', r.muted === 0, r.muted);

// 흉내 낸 'interrupted' 거절은 경고로 한 번 남는 것이 정상이다.
const errs = B.logs.filter((l) => /error|exception/i.test(l) && !/caches|online|fetch|CORS|ERR_/i.test(l) && !l.startsWith('warning: [sound]'));
check('콘솔 오류 없음', errs.length === 0, errs);
console.log(`\n${ok.filter(Boolean).length}/${ok.length} 통과`);
B.close();
process.exit(ok.every(Boolean) ? 0 : 1);
