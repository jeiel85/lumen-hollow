import { phaseName } from './env.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'), day: $('day-label'), time: $('time-label'), phase: $('phase-label'), icon: $('phase-icon'),
      zones: $('zones-label'), hp: $('hp-fill'), bat: $('bat-fill'), fuse: $('inv-fuse'), band: $('inv-band'),
      prompt: $('prompt'), promptText: $('prompt-text'), promptFill: $('prompt-fill'),
      toasts: $('toasts'), pointer: $('pointer'), pointerDist: $('pointer-dist'), batWrap: $('bat-wrap'),
      flashState: $('flash-state'), touch: $('touch'), can: $('inv-can'), fuelWrap: $('fuel-wrap'), fuel: $('fuel-fill'),
      keys: $('key-hints'), useBtn: document.querySelector('[data-act="use"]'), mute: $('mute-btn'), fps: $('fps'),
      flashBtn: document.querySelector('[data-act="flash"]'), power: $('power-label'), powerBtn: $('power-btn'),
      loadWrap: $('load-wrap'), load: $('load-fill'), loadLabel: $('load-label'),
    };
    this._walkKeys = this.el.keys?.textContent ?? '';
    this._last = {};
  }

  show(on) {
    this.el.hud.classList.toggle('hidden', !on);
  }

  showTouch(on) {
    this.el.touch.classList.toggle('hidden', !on);
  }

  // 좁은 화면에서는 아이콘만 보이므로 상태를 aria-label에도 적는다.
  setMuted(muted) {
    const btn = this.el.mute;
    const label = btn.querySelector('.chip-text') ?? btn;
    label.textContent = muted ? '소리 꺼짐' : '소리 켜짐';
    btn.classList.toggle('off', muted);
    btn.setAttribute('aria-label', muted ? '소리 켜기' : '소리 끄기');
  }

  showFps(on) {
    this.el.fps?.classList.toggle('hidden', !on);
  }

  setFps(fps) {
    if (this.el.fps) this._set('fps', this.el.fps, `${Math.round(fps)} fps`);
  }

  _set(key, el, text) {
    if (this._last[key] === text) return;
    this._last[key] = text;
    el.textContent = text;
  }

  update({ day, hour, zonesOn, zonesTotal, hp, battery, fuses, bandages, flashOn, cans, driving, fuel, powerUsed, powerCap, tripped, load }) {
    const hh = Math.floor(hour);
    const mm = Math.floor((hour - hh) * 6) * 10;
    this._set('day', this.el.day, `${day}일차`);
    this._set('time', this.el.time, `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
    const phase = phaseName(hour);
    this._set('phase', this.el.phase, phase);
    const isNight = phase === '밤' || phase === '해질녘';
    this._set('icon', this.el.icon, isNight ? '☾' : '☀');
    this._set('zones', this.el.zones, `${zonesOn} / ${zonesTotal}`);
    this.el.hp.style.transform = `scaleX(${hp / 100})`;
    this.el.bat.style.transform = `scaleX(${battery / 100})`;
    this.el.hp.classList.toggle('low', hp < 30);
    this.el.batWrap.classList.toggle('low', battery < 15);
    this._set('fuse', this.el.fuse, String(fuses));
    this._set('band', this.el.band, String(bandages));
    this._set('flash', this.el.flashState, flashOn ? 'ON' : 'OFF');
    this.el.flashState.classList.toggle('on', flashOn);
    // 배포 직후 캐시된 옛 index.html과 섞이면 새 요소가 없을 수 있다.
    if (this.el.can) this._set('can', this.el.can, String(cans));
    if (this.el.fuelWrap) {
      this.el.fuelWrap.classList.toggle('hidden', !driving);
      this.el.fuel.style.transform = `scaleX(${fuel / 100})`;
      this.el.fuelWrap.classList.toggle('low', fuel < 15);
    }
    // 배전: 변전소 출력 사용량, 차단된 구역이 있으면 버튼을 붉게. 근처 빛의 부하 막대는 밤에 부하가 오를 때만.
    if (this.el.power) {
      this._set('power', this.el.power, `${powerUsed} / ${powerCap}`);
      this.el.powerBtn.classList.toggle('alert', tripped > 0);
    }
    if (this.el.loadWrap) {
      this.el.loadWrap.classList.toggle('hidden', !load);
      if (load) {
        this._set('loadLabel', this.el.loadLabel, load.tripped ? '차단됨' : '가로등 부하');
        this.el.loadWrap.title = load.name;
        this.el.load.style.transform = `scaleX(${load.tripped ? 1 : Math.min(1, load.load)})`;
        this.el.loadWrap.classList.toggle('tripped', load.tripped);
        this.el.loadWrap.classList.toggle('low', !load.tripped && load.load > 0.6);
      }
    }
  }

  // 운전 중에는 조작 안내와 터치 상호작용 버튼 이름을 바꾼다.
  setDriving(on) {
    if (this.el.keys) this.el.keys.textContent = on ? 'W 가속 · S 브레이크·후진 · A/D 핸들 · F 작업등 · E 길게 내리기 · Tab 배전반 · Esc 일시정지' : this._walkKeys;
    if (this.el.useBtn) this.el.useBtn.textContent = on ? '내리기' : '상호작용';
    if (this.el.flashBtn) this.el.flashBtn.textContent = on ? '작업등' : '손전등';
  }

  prompt(text, progress) {
    if (!text) {
      this.el.prompt.classList.add('hidden');
      return;
    }
    this.el.prompt.classList.remove('hidden');
    this._set('prompt', this.el.promptText, text);
    this.el.promptFill.style.transform = `scaleX(${progress})`;
    this.el.prompt.classList.toggle('busy', progress > 0);
  }

  toast(text, kind = '') {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = text;
    this.el.toasts.appendChild(t);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
    setTimeout(() => t.classList.add('out'), 3200);
    setTimeout(() => t.remove(), 3800);
  }

  clearToasts() {
    this.el.toasts.replaceChildren();
  }

  // 화면 밖 목표를 가리키는 화살표. sx, sy는 화면 픽셀 좌표.
  pointer(sx, sy, dist, visible) {
    const p = this.el.pointer;
    if (!visible) {
      p.classList.add('hidden');
      return;
    }
    const w = innerWidth;
    const h = innerHeight;
    const cx = w / 2;
    const cy = h / 2;
    const dx = sx - cx;
    const dy = sy - cy;
    const m = 56;
    const sc = Math.min((cx - m) / Math.abs(dx || 1e-3), (cy - m) / Math.abs(dy || 1e-3));
    const x = cx + dx * sc;
    const y = cy + dy * sc;
    p.classList.remove('hidden');
    p.style.transform = `translate(${x}px, ${y}px)`;
    p.firstElementChild.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
    this._set('pdist', this.el.pointerDist, `${Math.round(dist)}m`);
  }
}
