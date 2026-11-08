// 배경 음악(#55): 음원 파일 없이 WebAudio로 즉석 합성한다(라이선스 걱정이 없고 앱 크기도 그대로).
// 분위기(mood)마다 음계·화음 진행·빠르기·음색이 다르다. 마디가 시작되기 조금 전에 그 마디의 화음·저음·선율을 한꺼번에
// 예약하고, 음 하나마다 소스를 만들어 끝나면 버린다. 그래서 음악을 끄면(음량 0·음소거·소리가 멈춘 동안) 도는 소스가 없다.
// 조성은 기존 음악 신호(audio.js의 dusk 사 단조, dawn·power·win 다 장조)와 밤 저음(라·미)에 맞췄다.

const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
// 마디를 예약하는 거리(초). 프레임이 늦게 와도 끊기지 않을 만큼만 앞선다(분위기는 다음 마디부터 바뀐다).
const LOOKAHEAD = 0.25;
// 위험 신호(그늘이 접근 속삭임)가 묻히지 않게, 속삭임 세기만큼 음악을 줄이는 비율
const DANGER_DUCK = 0.7;
// 음악 신호(해질녘·새벽·구역 복구 등)가 울리는 동안 음악 배율과 그 시간(초)
const CUE_DUCK = 0.25;

// 음색. wave: 배음 세기(PeriodicWave, 1번이 바탕음) 또는 기본 파형 이름, attack·len: 초.
const INST = {
  pluck: { wave: 'triangle', attack: 0.01, len: 1.3 },
  bell: { wave: [0, 1, 0.32, 0, 0.1], attack: 0.006, len: 2.6 },
  glass: { wave: [0, 1, 0, 0.14, 0, 0.04], attack: 0.05, len: 3.8 },
  box: { wave: [0, 1, 0, 0, 0.22, 0, 0.05], attack: 0.004, len: 1.5 },
};

// 화음 하나: bass(MIDI, 0이면 없음)와 pad(가운데 음역 화음). 선율은 scale(MIDI) 안에서 고른다.
// beats: 마디당 박, bpc: 화음 하나가 이어지는 마디 수, sub: 박을 나누는 수, density: 선율 음이 나올 확률(나눈 칸마다),
// melody·padGain·bassGain: 음 세기, cutoff: 화음 바탕의 높은음 깎기(Hz).
const ch = (bass, ...pad) => ({ bass, pad });
export const MOODS = {
  // 처음 화면·옷장: 가 단조, 빛을 기다리는 조용한 주제
  title: {
    bpm: 63, beats: 4, bpc: 2, sub: 1, density: 0.42, inst: 'bell', melody: 0.045, padGain: 0.022, bassGain: 0.03, cutoff: 1400,
    chords: [ch(45, 57, 60, 64), ch(41, 57, 60, 65), ch(48, 55, 60, 64), ch(43, 55, 59, 62)],
    scale: [69, 71, 72, 74, 76, 79, 81],
  },
  // 낮: 다 장조 5음 음계, 8분음 뜯는 소리
  day: {
    bpm: 72, beats: 4, bpc: 2, sub: 2, density: 0.2, inst: 'pluck', melody: 0.05, padGain: 0.018, bassGain: 0.028, cutoff: 1800,
    chords: [ch(48, 55, 60, 64), ch(45, 57, 60, 64), ch(41, 57, 60, 65), ch(43, 55, 59, 62)],
    scale: [67, 69, 72, 74, 76, 79, 81, 84],
  },
  // 해질녘: 사 단조(해질녘 음악 신호와 같은 조)
  dusk: {
    bpm: 58, beats: 4, bpc: 2, sub: 1, density: 0.3, inst: 'bell', melody: 0.04, padGain: 0.022, bassGain: 0.03, cutoff: 1200,
    chords: [ch(43, 55, 58, 62), ch(39, 55, 58, 63), ch(36, 55, 60, 63), ch(38, 57, 62, 67)],
    scale: [67, 69, 70, 72, 74, 77, 79],
  },
  // 밤: 가 단조, 밤 저음(라·미) 위에 드문드문 높은 유리 소리. 저음은 밤 저음이 맡는다.
  night: {
    bpm: 50, beats: 4, bpc: 2, sub: 1, density: 0.18, inst: 'glass', melody: 0.03, padGain: 0.016, bassGain: 0, cutoff: 650,
    chords: [ch(0, 57, 60, 64), ch(0, 57, 60, 65), ch(0, 57, 62, 65), ch(0, 56, 59, 64)],
    scale: [76, 77, 79, 81, 83, 84, 88],
  },
  // 새벽: 다 장조(새벽 음악 신호와 같은 조), 따뜻하게 천천히
  dawn: {
    bpm: 60, beats: 4, bpc: 2, sub: 1, density: 0.28, inst: 'bell', melody: 0.04, padGain: 0.022, bassGain: 0.03, cutoff: 1600,
    chords: [ch(41, 57, 60, 65), ch(48, 55, 60, 64), ch(43, 55, 59, 62), ch(45, 57, 60, 64)],
    scale: [72, 74, 76, 77, 79, 81, 84],
  },
  // 무전·대면 장면: 라 단조 쪽으로 기운 오르골. 대사·무전 소리를 덮지 않게 작게.
  radio: {
    bpm: 56, beats: 4, bpc: 2, sub: 1, density: 0.22, inst: 'box', melody: 0.03, padGain: 0.016, bassGain: 0.022, cutoff: 1100,
    chords: [ch(38, 57, 62, 65), ch(34, 58, 62, 65), ch(41, 57, 60, 65), ch(36, 55, 60, 64)],
    scale: [69, 72, 74, 76, 77, 79, 81],
  },
};

export class Music {
  constructor(sound) {
    this.sound = sound;
    this.level = 0.6; // 설정의 음악 음량(0~1)
    this.lite = false; // 화질 '낮음': 화음 바탕 소스를 절반으로, 메아리 없이
    this.bus = null;
    this.mood = null; // 지금 예약 중인 분위기(꺼져 있으면 null)
    this.want = null; // 마지막으로 받은 분위기
    this.next = 0; // 다음 마디가 시작하는 AudioContext 시각
    this.ci = 0; // 화음 진행 위치
    this.bi = 0; // 화음 안의 마디 위치
    this.bars = 0;
    this.prev = -1; // 직전 선율 음의 음계 위치
    this.duckUntil = 0;
    this.live = 0; // 예약했거나 울리는 중인 음악 소스 수(시험·저사양 확인용)
    this.made = 0;
  }

  _setup() {
    if (this.bus) return;
    const ctx = this.sound.ctx;
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.bus.connect(this.sound.master);
    this.waves = {};
    for (const [name, i] of Object.entries(INST)) {
      if (Array.isArray(i.wave)) this.waves[name] = ctx.createPeriodicWave(new Float32Array(i.wave.length), new Float32Array(i.wave));
    }
    this._echo();
  }

  // 선율에만 거는 메아리(지연 0.45초, 되먹임 0.3). 화질 '낮음'에서는 만들지 않는다.
  _echo() {
    if (this.wet || this.lite || !this.bus) return;
    const ctx = this.sound.ctx;
    const wet = ctx.createGain();
    wet.gain.value = 0.32;
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.45;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1900;
    const fb = ctx.createGain();
    fb.gain.value = 0.3;
    wet.connect(delay).connect(lp).connect(fb).connect(delay);
    lp.connect(this.bus);
    this.wet = wet;
    this.echoNodes = [wet, delay, lp, fb];
  }

  setLite(on) {
    this.lite = on;
    if (on && this.wet) {
      for (const n of this.echoNodes) n.disconnect();
      this.wet = null;
      this.echoNodes = null;
    } else if (!on) {
      this._echo();
    }
  }

  // 음악 신호가 울리는 동안 잠시 줄인다(화음끼리 부딪치지 않게).
  duck(sec) {
    const ctx = this.sound.ctx;
    if (ctx) this.duckUntil = Math.max(this.duckUntil, ctx.currentTime + sec);
  }

  // 매 프레임 부른다. mood: MOODS의 이름(없으면 음악을 쉰다), danger: 0~1(접근 속삭임 세기).
  update(mood, danger = 0) {
    const s = this.sound;
    const ctx = s.ctx;
    this.want = mood;
    if (!ctx) return;
    const t = ctx.currentTime;
    const on = !!MOODS[mood] && this.level > 0 && s._masterLevel() > 0 && ctx.state === 'running';
    if (this.bus) {
      const duck = (t < this.duckUntil ? CUE_DUCK : 1) * (1 - DANGER_DUCK * Math.min(1, Math.max(0, danger)));
      this.bus.gain.setTargetAtTime(on ? this.level * duck : 0, t, t < this.duckUntil ? 0.12 : 0.6);
    }
    if (!on) {
      // 예약해 둔 마디는 그대로 울리고 끝난다. 다시 켜면 새 마디부터 시작한다.
      this.mood = null;
      return;
    }
    this._setup();
    if (this.next < t) this.next = t + 0.08; // 처음, 또는 멈췄다(백그라운드·음소거) 다시 켠 뒤
    if (mood !== this.mood) {
      // 분위기가 바뀌면 다음 마디부터 그 분위기의 첫 화음으로. 이미 예약한 마디의 화음 바탕이 겹쳐 사라진다.
      this.mood = mood;
      this.ci = 0;
      this.bi = 0;
      this.bars = 0;
      this.prev = -1;
    }
    const m = MOODS[this.mood];
    while (this.next < t + LOOKAHEAD) {
      this._bar(m, this.next);
      this.next += (60 / m.bpm) * m.beats;
    }
  }

  _bar(m, t0) {
    const beat = 60 / m.bpm;
    const bar = beat * m.beats;
    const chord = m.chords[this.ci];
    if (this.bi === 0) {
      // 화음 바탕은 화음이 이어지는 마디 수보다 반 마디 길게 울려 다음 화음과 겹쳐 넘어간다.
      this._pad(chord.pad, t0, bar * (m.bpc + 0.5), m);
      if (chord.bass && m.bassGain) this._tone(chord.bass, t0, bar * m.bpc, m.bassGain, 'sine', 0.08, false);
    }
    // 네 마디마다 마지막 마디는 쉬어 가며 숨을 고른다.
    const breathe = this.bars % 4 === 3 ? 0.35 : 1;
    const steps = m.beats * m.sub;
    const step = beat / m.sub;
    const inst = INST[m.inst];
    let played = 0;
    for (let i = 0; i < steps; i++) {
      const strong = i % (m.sub * 2) === 0;
      // 쉬어 가는 마디가 아니면 한 음은 꼭 낸다(밤처럼 드문 분위기에서 화음 바탕만 길게 남지 않게). 첫 박에 화음 음으로.
      const must = i === steps - 1 && !played && breathe === 1;
      if (!must && Math.random() >= m.density * breathe * (strong ? 1.4 : 0.85)) continue;
      const k = must ? 0 : i;
      const note = this._pick(m, chord, strong || must);
      const vel = (strong || must ? 0.85 : 0.6) + Math.random() * 0.25;
      const at = t0 + k * step + Math.random() * 0.02;
      this._tone(note, at, inst.len * (0.7 + Math.random() * 0.6), m.melody * vel, m.inst, inst.attack, true);
      played++;
    }
    this.bars++;
    if (++this.bi >= m.bpc) {
      this.bi = 0;
      this.ci = (this.ci + 1) % m.chords.length;
    }
  }

  // 직전 음에서 한두 칸 움직이고, 센 박에서는 화음 음으로 내려앉는다. 같은 음을 연달아 내지 않는다.
  _pick(m, chord, strong) {
    const sc = m.scale;
    let i = this.prev < 0 ? Math.floor(sc.length / 2) : this.prev;
    if (strong && Math.random() < 0.6) {
      let best = -1;
      for (let k = 0; k < sc.length; k++) {
        if (k === this.prev || !chord.pad.some((p) => (sc[k] - p) % 12 === 0)) continue;
        if (best < 0 || Math.abs(k - i) < Math.abs(best - i)) best = k;
      }
      if (best >= 0) i = best;
    } else {
      const moves = [-2, -1, -1, 1, 1, 2];
      let k = i;
      for (let n = 0; n < 4 && k === i; n++) k = Math.min(sc.length - 1, Math.max(0, i + moves[(Math.random() * moves.length) | 0]));
      i = k;
    }
    this.prev = i;
    return sc[i];
  }

  // 음 하나: 오실레이터 하나와 게인 하나. 끝나면 연결을 끊는다.
  _tone(midi, t, dur, peak, inst, attack, echo) {
    const ctx = this.sound.ctx;
    const o = ctx.createOscillator();
    const wave = this.waves[inst];
    if (wave) o.setPeriodicWave(wave);
    else o.type = INST[inst]?.wave ?? inst;
    o.frequency.value = mtof(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.bus);
    if (echo && this.wet) g.connect(this.wet);
    this._run(o, t, t + dur + 0.05, [o, g]);
  }

  // 화음 바탕: 음마다 살짝 어긋난 삼각파 둘(화질 '낮음'은 하나)을 높은음을 깎아 천천히 부풀렸다 사라지게 한다.
  _pad(notes, t, dur, m) {
    const ctx = this.sound.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = m.cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(m.padGain, t + dur * 0.3);
    g.gain.setValueAtTime(m.padGain, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    lp.connect(g).connect(this.bus);
    const nodes = [lp, g];
    const detunes = this.lite ? [0] : [-7, 7];
    let first = true;
    for (const n of notes) {
      for (const cents of detunes) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = mtof(n);
        o.detune.value = cents;
        o.connect(lp);
        this._run(o, t, t + dur + 0.05, first ? [o, ...nodes] : [o]);
        first = false;
      }
    }
  }

  _run(o, start, stop, nodes) {
    this.live++;
    this.made++;
    o.onended = () => {
      this.live--;
      for (const n of nodes) n.disconnect();
    };
    o.start(start);
    o.stop(stop);
  }
}
