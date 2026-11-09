import { load, save } from './storage.js';
import { Music } from './music.js';

// 운전을 멈춘 뒤 엔진·타이어 소리 노드를 정리하기까지의 시간(초). 소리는 시간 상수 0.3초로 줄어 이때 -40dB 아래다.
const ENGINE_TAIL = 1.5;
// 오디오가 끊겼을 때(전화·백그라운드) 다시 켜 보는 사용자 입력. iOS는 사용자 입력 처리 안에서 부른 resume()만 받는다.
const RESUME_EVENTS = ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click'];
// 음악 신호와 그동안 배경 음악을 줄이는 시간(초). 신호의 화음이 배경 음악과 부딪치지 않게 한다.
const CUES = { power: 3, dawn: 4, dusk: 4.5, win: 3, beacon: 4 };
// 바탕 소리(빗소리·밤 저음·접근 속삭임·전기 웅웅거림). scale: setMix 값 1일 때의 게인, tau: 게인을 따라가는 시간 상수(초),
// amb: 환경음 묶음(설정의 환경음 음량을 따름). 접근 속삭임과 웅웅거림은 위험 신호라 환경음 음량과 상관없이 master로 보낸다.
const BEDS = {
  rain: { scale: 0.22, tau: 0.4, amb: true },
  night: { scale: 0.5, tau: 0.8, amb: true },
  dread: { scale: 0.28, tau: 0.25, amb: false },
  buzz: { scale: 0.05, tau: 0.15, amb: false },
};
// setMix 값이 이 아래면 꺼진 것으로 본다(빗소리는 그친 뒤 0에 다가가기만 하고 닿지 않는다). 빗소리 기준 -67dB.
const BED_SILENT = 0.002;
// 꺼진 뒤 노드를 정리하기까지: 시간 상수의 5배(-43dB)
const BED_TAIL = 5;

// WebAudio로 즉석 합성하는 소리. 외부 음원 파일 없이 빗소리·밤 저음·발소리·효과음·음악 신호와 배경 음악(music.js)을 만든다.
export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = load('lumen.muted') === '1';
    this.volume = 1; // 설정 화면의 전체 음량(0~1)
    this.ambience = 1; // 비·밤 저음 같은 환경음 배율(0~1). 그늘이 접근 속삭임은 경고음이라 여기에 묶지 않는다.
    this.engine = null; // 운전하는 동안만 있는 엔진·타이어 소리 노드
    this.beds = {}; // 들리는 동안만 있는 바탕 소리 노드(BEDS의 이름 → 노드 묶음)
    this.started = false; // AudioContext가 한 번이라도 돌기 시작했는지
    this.resumeFailed = false;
    this.music = new Music(this);
  }

  _masterLevel() {
    return this.muted ? 0 : 0.8 * this.volume;
  }

  setVolume(volume, ambience) {
    this.volume = volume;
    this.ambience = ambience;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this._masterLevel(), t, 0.05);
    this.amb.gain.setTargetAtTime(this.ambience, t, 0.05);
  }

  // 설정의 음악 음량(0~1). 0이면 배경 음악을 새로 예약하지 않는다.
  setMusicVolume(v) {
    this.music.level = v;
  }

  // 매 프레임 부른다(처음 화면 포함). mood: music.js MOODS의 이름 또는 null, danger: 0~1(접근 속삭임 세기).
  setMusic(mood, danger = 0) {
    this.music.update(mood, danger);
  }

  // 브라우저 자동재생 정책 때문에 첫 사용자 입력에서 호출해야 한다.
  init() {
    if (this.ctx) {
      this.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      console.warn('[sound] Web Audio API를 지원하지 않는 브라우저라 소리를 끕니다.');
      return;
    }
    const ctx = (this.ctx = new AC());
    this._watchResume();
    this.master = ctx.createGain();
    this.master.gain.value = this._masterLevel();
    this.master.connect(ctx.destination);
    // 환경음 묶음: 효과음과 따로 줄일 수 있게 한 단계 거친다.
    this.amb = ctx.createGain();
    this.amb.gain.value = this.ambience;
    this.amb.connect(this.master);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;

    // 트럭 엔진·타이어 소리(setEngine)와 바탕 소리(setMix)는 들리는 동안만 만든다. 늘 돌려 두면 게인 0이어도
    // 오디오 스레드가 소스를 계속 합성해 CPU를 쓴다(낮에도 소스 8개가 돌았다, #6 후속).
  }

  _filter(type, freq, q) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (q !== undefined) f.Q.value = q;
    return f;
  }

  _osc(type, freq, detune = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    o.start();
    return o;
  }

  // 바탕 소리 하나를 만든다. 출력 게인은 0에서 시작해 setMix가 올린다.
  _bedUp(name) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    const sources = [];
    const nodes = [out];
    const src = (n) => (sources.push(n), nodes.push(n), n);
    const node = (n) => (nodes.push(n), n);
    const gain = (v) => { const g = node(ctx.createGain()); g.gain.value = v; return g; };
    switch (name) {
      case 'rain': // 빗소리: 잡음을 높은음·낮은음 필터로 깎는다
        src(this._noiseSource()).connect(node(this._filter('highpass', 500))).connect(node(this._filter('lowpass', 2400))).connect(out);
        out.connect(this.amb);
        break;
      case 'night': { // 밤 저음: 살짝 어긋난 톱니파 셋을 낮게 뭉갠다
        const lp = node(this._filter('lowpass', 260));
        for (const f of [55, 82.4, 110.6]) src(this._osc('sawtooth', f, (Math.random() - 0.5) * 14)).connect(gain(0.06)).connect(lp);
        lp.connect(out);
        out.connect(this.amb);
        break;
      }
      case 'dread': { // 그늘이가 가까울 때 속삭임: 좁은 대역 잡음을 5.5Hz로 떨게 한다. 화면 밖에서 다가오는 것을 알리는 유일한 경고
        const trem = gain(0.5);
        src(this._osc('sine', 5.5)).connect(gain(0.5)).connect(trem.gain);
        src(this._noiseSource()).connect(node(this._filter('bandpass', 900, 3))).connect(trem).connect(out);
        out.connect(this.master);
        break;
      }
      case 'buzz': { // 과부하 걸린 가로등의 전기 웅웅거림: 차단기가 내려가기 전에 귀로도 알린다
        const bp = node(this._filter('bandpass', 240, 4));
        for (const f of [120, 240.6]) src(this._osc('sawtooth', f)).connect(bp);
        bp.connect(out);
        out.connect(this.master);
        break;
      }
      default:
        throw new Error(`[sound] 모르는 바탕 소리: ${name}`);
    }
    const bed = { out, sources, nodes, offAt: null };
    this.beds[name] = bed;
    return bed;
  }

  // level 쪽으로 게인을 옮긴다. 0이 되면 줄어드는 꼬리(BED_TAIL × tau)가 지난 뒤 노드를 멈추고 정리한다.
  _bed(name, level, tau, t) {
    let b = this.beds[name];
    if (level <= 0) {
      if (!b) return;
      if (b.offAt === null) {
        b.offAt = t;
        b.out.gain.setTargetAtTime(0, t, tau);
      } else if (t - b.offAt >= BED_TAIL * tau) {
        delete this.beds[name];
        this._release(b, [b.out.gain], t);
      }
      return;
    }
    b ??= this._bedUp(name);
    b.offAt = null;
    b.out.gain.setTargetAtTime(level, t, tau);
  }

  // 전화가 오면 AudioContext가 멈춘다. iOS Safari는 'interrupted'(그 밖은 'suspended') 상태로
  // 남아 저절로 돌아오지 않을 수 있어서, 화면으로 돌아올 때와 다음 사용자 입력 때마다 다시 켠다.
  // 화면이 가려지면(다른 앱·화면 끔·다른 탭) 직접 멈춘다. 안드로이드 앱(WebView)과 데스크톱 브라우저는 가려져도 AudioContext를
  // 멈추지 않아서, 판은 일시정지인데 빗소리·밤 저음이 다른 앱 위로 계속 울렸다(#53 에뮬레이터 확인). 가려진 동안에는 다시 켜지 않는다.
  _watchResume() {
    const ctx = this.ctx;
    this.started = ctx.state === 'running';
    ctx.addEventListener('statechange', () => {
      if (ctx.state === 'running') this.started = true;
    });
    const kick = () => {
      if (!document.hidden) this.resume();
    };
    for (const type of RESUME_EVENTS) addEventListener(type, kick, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.suspend();
      else kick();
    });
    addEventListener('pageshow', kick);
    addEventListener('focus', kick);
  }

  // 화면이 가려질 때 소리를 멈춘다. 예약해 둔 소리도 시계와 함께 멈췄다가 다시 켜질 때 이어진다.
  suspend() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    ctx.suspend().catch((err) => console.warn('[sound] 화면이 가려졌는데 오디오를 멈추지 못했습니다.', err));
  }

  // 멈춘 AudioContext를 다시 켠다. 'interrupted' 동안의 resume()은 끊김이 끝날 때까지 기다렸다가 풀리고,
  // 사용자 입력 밖에서 부른 resume()은 iOS가 거절할 수 있어 다음 입력 때 다시 부른다(실패는 한 번만 알린다).
  resume() {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return;
    ctx.resume().then(
      () => {
        this.resumeFailed = false;
      },
      (err) => {
        if (!this.resumeFailed) console.warn('[sound] 오디오를 다시 켜지 못했습니다. 다음 입력 때 다시 시도합니다.', err);
        this.resumeFailed = true;
      },
    );
  }

  _noiseSource() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.start();
    return s;
  }

  // 엔진(낮은 톱니파 두 개를 저역 필터로 뭉갠 소리)과 타이어 끌리는 소리를 만든다. 처음 소리는 0에서 오른다.
  _engineUp() {
    if (this.engine) return this.engine;
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    const nodes = [out, filter];
    const oscs = [];
    for (const [type, mul, amp] of [['sawtooth', 1, 0.5], ['square', 0.5, 0.35]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = 34 * mul;
      const g = ctx.createGain();
      g.gain.value = amp;
      o.connect(g).connect(filter);
      o.start();
      oscs.push({ o, mul });
      nodes.push(o, g);
    }
    filter.connect(out).connect(this.master);
    const skid = ctx.createGain();
    skid.gain.value = 0;
    const squeal = this._noiseSource();
    const sbp = ctx.createBiquadFilter();
    sbp.type = 'bandpass';
    sbp.frequency.value = 1500;
    sbp.Q.value = 6;
    squeal.connect(sbp).connect(skid).connect(this.master);
    nodes.push(skid, squeal, sbp);
    this.engine = { out, filter, oscs, skid, sources: [...oscs.map((x) => x.o), squeal], nodes, offAt: null };
    return this.engine;
  }

  // 다 줄어든 엔진 소리를 0까지 짧게 내린 뒤 멈추고 연결을 끊는다.
  _engineDown(t) {
    const e = this.engine;
    this.engine = null;
    this._release(e, [e.out.gain, e.skid.gain], t);
  }

  // 게인을 0까지 짧게 내린 뒤 소스를 멈추고 연결을 끊는다(게인이 남은 채 멈추면 딸깍 소리가 난다).
  _release({ sources, nodes }, gains, t) {
    for (const p of gains) {
      p.cancelScheduledValues(t);
      p.setValueAtTime(p.value, t);
      p.linearRampToValueAtTime(0, t + 0.03);
    }
    sources[0].onended = () => {
      for (const n of nodes) n.disconnect();
    };
    for (const s of sources) s.stop(t + 0.05);
  }

  // 매 프레임 부른다(처음 화면 제외). 값은 0~1. 음소거·전체 음량 0이면 모두, 환경음 음량 0이면 비·밤 저음을 끈다.
  setMix(mix) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const on = this._masterLevel() > 0;
    for (const name in BEDS) {
      const { scale, tau, amb } = BEDS[name];
      const v = mix[name] ?? 0;
      this._bed(name, on && v > BED_SILENT && !(amb && this.ambience <= 0) ? v * scale : 0, tau, t);
    }
  }

  // 매 프레임 부른다. on: 시동이 걸려 있는지, rpm: 0~1(속도), load: 0~1(가속 페달), skid: 0~1(미끄러짐)
  // 시동이 꺼지면(내리기·연료 바닥·처음 화면) 소리를 줄이고 ENGINE_TAIL 뒤에 노드를 정리한다. 음소거·음량 0도 같다.
  setEngine({ on = false, rpm = 0, load = 0, skid = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (!on || this._masterLevel() <= 0) {
      const e = this.engine;
      if (!e) return;
      if (e.offAt === null) {
        e.offAt = t;
        e.out.gain.setTargetAtTime(0, t, 0.3);
        e.skid.gain.setTargetAtTime(0, t, 0.06);
      } else if (t - e.offAt >= ENGINE_TAIL) {
        this._engineDown(t);
      }
      return;
    }
    const e = this._engineUp();
    e.offAt = null;
    const f = 34 + rpm * 62 + load * 9;
    for (const { o, mul } of e.oscs) o.frequency.setTargetAtTime(f * mul, t, 0.08);
    e.filter.frequency.setTargetAtTime(260 + rpm * 700 + load * 380, t, 0.1);
    e.out.gain.setTargetAtTime(0.05 + load * 0.05 + rpm * 0.03, t, 0.12);
    e.skid.gain.setTargetAtTime(skid * 0.07, t, 0.06);
  }

  // 발소리 한 번(걸음에 맞춰 main.js가 부른다). speed: 0~1(걷는 빠르기), wet: 0~1(빗물).
  // 뒤꿈치가 닿는 둔탁한 저음과 바닥에 끌리는 짧은 소리, 젖은 길에서는 찰박이는 물소리가 섞인다.
  footstep(speed = 1, wet = 0) {
    if (!this._live()) return;
    const t = this.ctx.currentTime;
    const g = 0.05 * (0.5 + 0.5 * speed);
    const dry = 1 - wet * 0.6;
    this._burst(t, 0.08, { freq: 170 + Math.random() * 60, q: 0.8, gain: g, type: 'lowpass' });
    this._burst(t + 0.01, 0.05, { freq: 1300 + Math.random() * 500, q: 1.1, gain: g * 0.3 * dry });
    if (wet > 0.05) this._burst(t + 0.015, 0.14 + wet * 0.1, { freq: 2400 + Math.random() * 900, q: 2, gain: g * 0.8 * wet, sweep: 0.55 });
  }

  toggleMute() {
    this.muted = !this.muted;
    save('lumen.muted', this.muted ? '1' : '0');
    if (this.ctx) this.master.gain.setTargetAtTime(this._masterLevel(), this.ctx.currentTime, 0.05);
    return this.muted;
  }

  _tone(freq, start, dur, { type = 'sine', gain = 0.2, slide = 0 } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), start + dur);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g).connect(this.master);
    o.start(start);
    o.stop(start + dur + 0.05);
  }

  _burst(start, dur, { freq = 1200, q = 1, gain = 0.2, type = 'bandpass', sweep = 0 } = {}) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, start);
    if (sweep) f.frequency.exponentialRampToValueAtTime(freq * sweep, start + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, start);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(start, Math.random());
    s.stop(start + dur + 0.05);
  }

  // 음악 신호의 화음 바탕: 살짝 어긋난 삼각파 둘씩을 천천히 부풀렸다가 사라지게 한다.
  _pad(freqs, start, dur, gain) {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    lp.connect(g).connect(this.master);
    for (const f of freqs) {
      for (const cents of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f;
        o.detune.value = cents;
        o.connect(lp);
        o.start(start);
        o.stop(start + dur + 0.05);
      }
    }
  }

  // 한 번 울리는 소리를 지금 낼 수 있는지. 한 번 돌기 시작한 뒤 멈춘(끊긴) 동안 예약한 소리는 시계가 멈춰 있어
  // 다시 켜질 때 한꺼번에 터지므로 내지 않는다. 막 만들어 아직 돌기 전(처음 시작)에는 예약해 두면 곧 나온다.
  _live() {
    if (!this.ctx || this.muted) return false;
    return this.ctx.state === 'running' || !this.started;
  }

  play(name) {
    if (!this._live()) return;
    const t = this.ctx.currentTime;
    if (CUES[name]) this.music.duck(CUES[name]);
    switch (name) {
      case 'pickup':
        this._tone(880, t, 0.18, { gain: 0.12 });
        this._tone(1320, t + 0.08, 0.25, { gain: 0.1 });
        break;
      case 'empty':
        this._tone(330, t, 0.2, { gain: 0.08, type: 'triangle', slide: 0.8 });
        break;
      case 'power': // 구역 복구: 전기가 붙는 소리, 오르는 아르페지오, 그 위에 밝은 장화음
        this._burst(t, 0.25, { freq: 300, q: 0.7, gain: 0.25, type: 'lowpass' });
        [392, 523.3, 659.3, 784].forEach((f, i) => this._tone(f, t + 0.12 + i * 0.09, 1.2, { gain: 0.08, type: 'triangle' }));
        this._pad([261.6, 392, 523.3, 659.3], t + 0.4, 2.6, 0.03);
        break;
      case 'hurt':
        this._tone(140, t, 0.35, { gain: 0.3, type: 'sine', slide: 0.4 });
        this._burst(t, 0.3, { freq: 500, q: 0.8, gain: 0.25, type: 'lowpass' });
        break;
      case 'banish':
        this._burst(t, 0.6, { freq: 4000, q: 0.6, gain: 0.12, type: 'highpass', sweep: 0.25 });
        break;
      case 'dawn': // 새벽: 다 장조 화음이 천천히 밝아지고 그 위로 선율이 오른다
        this._pad([130.8, 261.6, 329.6, 392], t, 3.6, 0.035);
        [523.3, 659.3, 784, 1046.5].forEach((f, i) => this._tone(f, t + 0.3 + i * 0.16, 1.8, { gain: 0.055 }));
        this._tone(880, t + 1.1, 1.6, { gain: 0.035 });
        break;
      case 'dusk': // 해질녘: 사 단조 화음 위로 선율이 내려앉고, 낮은 음이 남는다
        this._pad([98, 196, 233.1, 293.7], t, 4.0, 0.035);
        [587.3, 466.2, 392, 311.1].forEach((f, i) => this._tone(f, t + 0.2 + i * 0.3, 1.9, { gain: 0.05, type: 'triangle' }));
        this._tone(98, t + 1.2, 2.6, { gain: 0.05, type: 'sine' });
        break;
      case 'click':
        this._burst(t, 0.05, { freq: 2500, q: 2, gain: 0.08 });
        break;
      case 'heal':
        this._tone(587.3, t, 0.3, { gain: 0.08, type: 'triangle' });
        this._tone(880, t + 0.1, 0.4, { gain: 0.07, type: 'triangle' });
        break;
      case 'carstart':
        for (let i = 0; i < 3; i++) this._burst(t + i * 0.11, 0.08, { freq: 260, q: 1.2, gain: 0.18, type: 'lowpass' });
        this._tone(48, t + 0.32, 0.5, { gain: 0.12, type: 'sawtooth', slide: 1.6 });
        break;
      case 'door':
        this._burst(t, 0.09, { freq: 700, q: 1.4, gain: 0.16 });
        this._tone(120, t, 0.12, { gain: 0.1, type: 'triangle', slide: 0.6 });
        break;
      case 'crash':
        this._burst(t, 0.45, { freq: 380, q: 0.7, gain: 0.32, type: 'lowpass', sweep: 0.4 });
        this._tone(92, t, 0.3, { gain: 0.22, type: 'sine', slide: 0.5 });
        break;
      case 'stall':
        this._tone(70, t, 0.9, { gain: 0.12, type: 'sawtooth', slide: 0.35 });
        this._burst(t + 0.2, 0.15, { freq: 300, q: 1, gain: 0.1, type: 'lowpass' });
        break;
      case 'pour':
        this._burst(t, 0.7, { freq: 900, q: 2.5, gain: 0.08, sweep: 0.6 });
        break;
      case 'trip': // 차단기가 내려감: 스파크 두 번과 꺼져 가는 웅 소리
        this._burst(t, 0.16, { freq: 3400, q: 0.8, gain: 0.18, type: 'highpass' });
        this._burst(t + 0.09, 0.1, { freq: 5200, q: 1, gain: 0.12, type: 'highpass' });
        this._tone(118, t + 0.05, 0.7, { gain: 0.2, type: 'sawtooth', slide: 0.3 });
        break;
      case 'breaker': // 차단기를 올림: 철컥, 그리고 다시 도는 웅 소리
        this._burst(t, 0.07, { freq: 900, q: 1.5, gain: 0.22 });
        this._tone(60, t + 0.06, 0.9, { gain: 0.1, type: 'sawtooth', slide: 2 });
        break;
      case 'hint': // 깨어난 누군가가 켠 촛불: 맑은 종소리 두 번
        this._tone(1046.5, t, 0.9, { gain: 0.06, type: 'triangle' });
        this._tone(1568, t + 0.16, 1.2, { gain: 0.05, type: 'triangle' });
        break;
      case 'lamp': // 작업등 스위치
        this._burst(t, 0.05, { freq: 1800, q: 2, gain: 0.1 });
        this._tone(220, t + 0.03, 0.35, { gain: 0.05, type: 'triangle', slide: 1.5 });
        break;
      case 'radio':
        // 무전기 스퀠치: 짧은 잡음과 삑
        this._burst(t, 0.22, { freq: 1800, q: 1.2, gain: 0.1, sweep: 0.7 });
        this._tone(1250, t + 0.02, 0.07, { gain: 0.04, type: 'square' });
        this._burst(t + 0.26, 0.08, { freq: 2400, q: 2, gain: 0.05 });
        break;
      case 'page':
        this._burst(t, 0.28, { freq: 3200, q: 0.8, gain: 0.07, type: 'highpass', sweep: 0.45 });
        break;
      case 'beacon':
        this._burst(t, 1.2, { freq: 120, q: 0.6, gain: 0.18, type: 'lowpass', sweep: 3 });
        [261.6, 392, 523.3, 784].forEach((f, i) => this._tone(f, t + 0.3 + i * 0.22, 3.2, { gain: 0.06, type: 'triangle' }));
        break;
      case 'win':
        [523.3, 659.3, 784, 1046.5, 1318.5].forEach((f, i) => this._tone(f, t + i * 0.12, 2.2, { gain: 0.07, type: 'triangle' }));
        break;
      default:
        break;
    }
  }
}
