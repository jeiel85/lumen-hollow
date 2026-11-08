// 소리(#1·#6·#14·#55): 엔진·타이어 소리 노드는 운전할 때만 돌고 내린 뒤 정리되는지, 멈춘 AudioContext(전화·백그라운드)가
// 화면 복귀·다음 입력에 다시 켜지는지, 환경음을 0으로 줄여도 그늘이 접근 속삭임이 들리는지, 발소리 박자, 음악 신호, 배경 음악.
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

// 엔진·바탕 소리 시험은 도는 소스 수를 세므로 배경 음악을 끄고 한다. 배경 음악은 마지막 묶음에서 따로 본다.
let r = await B.ev(`
  for (const id of ${JSON.stringify(CH1)}) lumen.story.markSeen(id);
  lumen.sound.setMusicVolume(0);
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

// 바탕 소리(#6 후속): 게인 0인 소스를 늘 돌리지 않는다. 낮·맑음·그늘이 없음이면 하나도 돌지 않고, 밤이 되면 밤 저음만 생기며,
// 음소거하거나 다시 낮이 되면 줄어드는 꼬리(시간 상수 × 5) 뒤에 정리된다.
r = await B.ev(`${RUN}
  const clear = () => { L.env.rainLevel = 0; L.env.rainyNight = false; };
  noon(); clear();
  await run(4.5); // 앞 시험에서 남은 소리의 꼬리(밤 저음 0.8초 × 5)가 지나기를 기다린다
  const day = { beds: Object.keys(S.beds), live: live() };
  L.game.peaceful = true; L.env.setHour(23); clear();
  await run(0.5);
  const night = { beds: Object.keys(S.beds), live: live() };
  let downGain = null;
  const release = S._release.bind(S);
  S._release = (b, gains, t) => { downGain = Math.max(...gains.map((g) => g.value)); release(b, gains, t); };
  S.toggleMute(); await run(4.5);
  const muted = { beds: Object.keys(S.beds), live: live(), downGain };
  S.toggleMute(); await run(0.3);
  const unmuted = Object.keys(S.beds);
  S._release = release;
  L.game.peaceful = false; noon(); clear(); await run(4.5);
  const back = { beds: Object.keys(S.beds), live: live() };
  return { day, night, muted, unmuted, back };`);
check('낮·맑음·그늘이 없음: 바탕 소리 소스가 하나도 돌지 않는다', r.day.beds.length === 0, r.day);
check('밤: 밤 저음(톱니파 셋)만 생긴다', r.night.beds.join() === 'night' && r.night.live === r.day.live + 3, r.night);
check('음소거하면 다 줄어든 뒤(-40dB 아래) 정리하고, 풀면 다시 만든다', r.muted.beds.length === 0 && r.muted.live === r.day.live && r.muted.downGain !== null && r.muted.downGain < 0.005 && r.unmuted.includes('night'), { muted: r.muted, unmuted: r.unmuted });
check('다시 낮이 되면 꼬리가 지난 뒤 정리된다', r.back.beds.length === 0 && r.back.live === r.day.live, r.back);

// 멈춘 AudioContext 다시 켜기
r = await B.ev(`${RUN}
  const out = {};
  // 막 만든 AudioContext(아직 돌기 전)에는 소리를 예약해 둔다(곧 나온다).
  const s2 = new S.constructor();
  s2.init();
  let m = __audio.made;
  s2.play('pickup');
  out.firstPlay = { state: s2.ctx.state, made: __audio.made - m };
  await s2.ctx.close();
  await S.ctx.suspend();
  out.suspended = S.ctx.state;
  // 한 번 돈 뒤 멈춘 동안에는 예약하지 않는다(다시 켜질 때 한꺼번에 터지지 않게).
  m = __audio.made;
  S.play('pickup'); S.footstep(1, 0);
  out.madeWhileSuspended = __audio.made - m;
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
check('멈춘 동안 소리를 쌓아 두지 않고, 막 만든 AudioContext에는 첫 소리를 예약한다', r.madeWhileSuspended === 0 && r.firstPlay.made === 2, r);
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

// 배경 음악(#55): 시간대마다 다른 음계·화음, 소스 수 상한(화질 '낮음'은 더 적게), 위험·음악 신호 때 줄이기,
// 음량 0·음소거면 새로 만들지 않고 예약해 둔 음이 끝나면 하나도 남지 않음, 설정의 음악 막대, 처음 화면의 주제.
r = await B.ev(`${RUN}
  const M = S.music;
  const MOODS = (await import('./src/music.js')).MOODS;
  const clear = () => { L.env.rainLevel = 0; L.env.rainyNight = false; };
  const notes = {};
  const tone = M._tone.bind(M), bar = M._bar.bind(M), pad = M._pad.bind(M);
  let cur = null;
  M._bar = (m, t0) => { cur = M.mood; bar(m, t0); };
  M._tone = (midi, ...a) => { (notes[cur] ??= { mel: [], pads: 0 }).mel.push(midi); tone(midi, ...a); };
  M._pad = (n, ...a) => { (notes[cur] ??= { mel: [], pads: 0 }).pads++; pad(n, ...a); };
  const watch = async (sec) => { let peak = 0; const end = performance.now() + sec * 1000; while (performance.now() < end) { L.step(1 / 60, 1 / 60); peak = Math.max(peak, M.live); await wait(16); } return peak; };
  const inMood = (name) => { const m = MOODS[name]; const ok = new Set([...m.scale, ...m.chords.map((c) => c.bass)]); return (notes[name]?.mel ?? []).every((n) => ok.has(n)); };
  const out = {};
  S.setMusicVolume(1);
  L.game.peaceful = true; noon(); clear();
  const dayPeak = await watch(9);
  out.day = { mood: M.mood, notes: notes.day?.mel.length ?? 0, pads: notes.day?.pads ?? 0, inScale: inMood('day'), peak: dayPeak };
  L.env.setHour(23); clear();
  const nightPeak = await watch(12);
  out.night = { mood: M.mood, notes: notes.night?.mel.length ?? 0, pads: notes.night?.pads ?? 0, inScale: inMood('night'), peak: nightPeak };
  // 위험 신호: 접근 속삭임이 셀수록 음악을 줄인다
  const level = () => +M.bus.gain.value.toFixed(3);
  const real = S.setMusic.bind(S);
  let danger = 0;
  S.setMusic = (mood) => real(mood, danger);
  await watch(2.5); const calm = level();
  danger = 1; await watch(2.5); const scared = level();
  danger = 0; S.setMusic = real; await watch(2.5);
  // 음악 신호(해질녘)가 울리는 동안 줄였다가 돌아온다
  S.play('dusk'); await watch(0.6); const cue = level();
  await watch(6); const after = level();
  out.duck = { calm, scared, cue, after };
  // 화질 '낮음': 화음 바탕 소스 절반, 메아리 없음
  M.setLite(true); L.env.setHour(12); clear();
  const litePeak = await watch(10);
  out.lite = { peak: litePeak, echo: !!M.wet };
  M.setLite(false);
  // 음량 0: 새로 예약하지 않고, 예약해 둔 마디가 끝나면 음악 소스가 하나도 없다
  S.setMusicVolume(0);
  let t0 = performance.now(), made0 = M.made;
  while (M.live > 0 && performance.now() - t0 < 14000) await watch(0.5);
  out.off = { live: M.live, sec: +((performance.now() - t0) / 1000).toFixed(1), madeAfterOff: M.made - made0 };
  // 음소거도 같다
  S.setMusicVolume(1); await watch(2); S.toggleMute();
  t0 = performance.now(); made0 = M.made;
  while (M.live > 0 && performance.now() - t0 < 14000) await watch(0.5);
  await watch(1);
  out.mute = { live: M.live, madeWhileMuted: M.made - made0 };
  S.toggleMute();
  // 설정 화면의 음악 막대가 음량을 바꾼다
  const slider = document.querySelector('[data-setting="music"]');
  slider.value = '30'; slider.dispatchEvent(new Event('input'));
  out.slider = { level: M.level, saved: JSON.parse(localStorage.getItem('lumen.settings')).music, label: document.querySelector('[data-out="music"]').textContent };
  // 처음 화면은 주제 음악
  L.game.peaceful = false; L.backToTitle(); await wait(1200);
  for (let i = 0; i < 30; i++) { await wait(100); if (M.mood) break; }
  out.title = M.mood;
  M._tone = tone; M._bar = bar; M._pad = pad;
  return out;`);
check('낮: 다 장조 음계의 낮 음악(화음 바탕 + 선율)', r.day.mood === 'day' && r.day.pads >= 1 && r.day.notes >= 3 && r.day.inScale, r.day);
check('밤: 가 단조 음계의 밤 음악', r.night.mood === 'night' && r.night.pads >= 1 && r.night.notes >= 1 && r.night.inScale, r.night);
check('도는 음악 소스는 많아야 24개', r.day.peak <= 24 && r.night.peak <= 24, { day: r.day.peak, night: r.night.peak });
check("화질 '낮음'은 음악 소스 14개 이하, 메아리 없음", r.lite.peak <= 14 && !r.lite.echo, r.lite);
check('접근 속삭임이 셀수록 음악을 줄인다', r.duck.scared < r.duck.calm * 0.45, r.duck);
check('음악 신호가 울리는 동안 줄였다가 돌아온다', r.duck.cue < r.duck.calm * 0.5 && r.duck.after > r.duck.calm * 0.8, r.duck);
check('음악 음량 0: 새로 만들지 않고, 예약한 마디가 끝나면 음악 소스가 없다', r.off.live === 0 && r.off.madeAfterOff === 0, r.off);
check('음소거: 새로 만들지 않고 음악 소스가 없다', r.mute.live === 0 && r.mute.madeWhileMuted === 0, r.mute);
check('설정의 음악 막대가 음량을 바꾸고 저장한다', r.slider.level === 0.3 && r.slider.saved === 0.3 && r.slider.label === '30%', r.slider);
check('처음 화면에서는 주제 음악', r.title === 'title', r.title);

// 흉내 낸 'interrupted' 거절은 경고로 한 번 남는 것이 정상이다.
const errs = B.logs.filter((l) => /error|exception/i.test(l) && !/caches|online|fetch|CORS|ERR_/i.test(l) && !l.startsWith('warning: [sound]'));
check('콘솔 오류 없음', errs.length === 0, errs);
console.log(`\n${ok.filter(Boolean).length}/${ok.length} 통과`);
B.close();
process.exit(ok.every(Boolean) ? 0 : 1);
