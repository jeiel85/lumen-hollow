import { load, save } from './storage.js';

// WebAudio로 즉석 합성하는 소리. 외부 음원 파일 없이 빗소리·밤 저음·효과음을 만든다.
export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = load('lumen.muted') === '1';
  }

  // 브라우저 자동재생 정책 때문에 첫 사용자 입력에서 호출해야 한다.
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      console.warn('[sound] Web Audio API를 지원하지 않는 브라우저라 소리를 끕니다.');
      return;
    }
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;

    // 빗소리
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    const rain = this._noiseSource();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 500;
    rain.connect(hp).connect(lp).connect(this.rainGain).connect(this.master);

    // 밤 저음
    this.nightGain = ctx.createGain();
    this.nightGain.gain.value = 0;
    const dlp = ctx.createBiquadFilter();
    dlp.type = 'lowpass';
    dlp.frequency.value = 260;
    for (const f of [55, 82.4, 110.6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 14;
      const g = ctx.createGain();
      g.gain.value = 0.06;
      o.connect(g).connect(dlp);
      o.start();
    }
    dlp.connect(this.nightGain).connect(this.master);

    // 그늘이가 가까울 때 속삭임
    this.dreadGain = ctx.createGain();
    this.dreadGain.gain.value = 0;
    const whisper = this._noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 3;
    const trem = ctx.createGain();
    trem.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.5;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 0.5;
    lfo.connect(lfoAmt).connect(trem.gain);
    lfo.start();
    whisper.connect(bp).connect(trem).connect(this.dreadGain).connect(this.master);
  }

  _noiseSource() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.start();
    return s;
  }

  setMix({ rain = 0, night = 0, dread = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.rainGain.gain.setTargetAtTime(rain * 0.22, t, 0.4);
    this.nightGain.gain.setTargetAtTime(night * 0.5, t, 0.8);
    this.dreadGain.gain.setTargetAtTime(dread * 0.28, t, 0.25);
  }

  toggleMute() {
    this.muted = !this.muted;
    save('lumen.muted', this.muted ? '1' : '0');
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
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

  play(name) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    switch (name) {
      case 'pickup':
        this._tone(880, t, 0.18, { gain: 0.12 });
        this._tone(1320, t + 0.08, 0.25, { gain: 0.1 });
        break;
      case 'empty':
        this._tone(330, t, 0.2, { gain: 0.08, type: 'triangle', slide: 0.8 });
        break;
      case 'power':
        this._burst(t, 0.25, { freq: 300, q: 0.7, gain: 0.25, type: 'lowpass' });
        [392, 523.3, 659.3, 784].forEach((f, i) => this._tone(f, t + 0.12 + i * 0.09, 1.2, { gain: 0.08, type: 'triangle' }));
        break;
      case 'hurt':
        this._tone(140, t, 0.35, { gain: 0.3, type: 'sine', slide: 0.4 });
        this._burst(t, 0.3, { freq: 500, q: 0.8, gain: 0.25, type: 'lowpass' });
        break;
      case 'banish':
        this._burst(t, 0.6, { freq: 4000, q: 0.6, gain: 0.12, type: 'highpass', sweep: 0.25 });
        break;
      case 'dawn':
        [523.3, 659.3, 784, 1046.5].forEach((f, i) => this._tone(f, t + i * 0.14, 1.6, { gain: 0.06 }));
        break;
      case 'dusk':
        [392, 311.1, 233.1].forEach((f, i) => this._tone(f, t + i * 0.25, 1.8, { gain: 0.06, type: 'triangle' }));
        break;
      case 'click':
        this._burst(t, 0.05, { freq: 2500, q: 2, gain: 0.08 });
        break;
      case 'heal':
        this._tone(587.3, t, 0.3, { gain: 0.08, type: 'triangle' });
        this._tone(880, t + 0.1, 0.4, { gain: 0.07, type: 'triangle' });
        break;
      case 'win':
        [523.3, 659.3, 784, 1046.5, 1318.5].forEach((f, i) => this._tone(f, t + i * 0.12, 2.2, { gain: 0.07, type: 'triangle' }));
        break;
      default:
        break;
    }
  }
}
