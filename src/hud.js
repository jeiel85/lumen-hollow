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
      keys: $('key-hints'), useBtn: document.querySelector('[data-act="use"]'),
      drop: $('drop-btn'), place: $('place'), placeSub: $('place-sub'), placeNote: $('place-note-text'),
    };
    this._walkKeys = this.el.keys?.textContent ?? '';
    this._driving = false;
    this._online = false;
    this._last = {};
  }

  // 배포 직후 옛 index.html과 섞이면 공유 보급품 요소가 없을 수 있다. 그때는 기능을 숨긴 채로 둔다.
  get hasOnlineUi() {
    return Boolean(this.el.drop && this.el.place);
  }

  _applyKeys() {
    if (!this.el.keys) return;
    this.el.keys.textContent = this._driving
      ? 'W 가속 · S 브레이크·후진 · A/D 핸들 · E 길게 내리기 · 휠 줌 · Esc 일시정지'
      : this._walkKeys + (this._online ? ' · G 보급품 남기기' : '');
  }

  // 다른 생존자와 연결된 판에서만 '보급품 남기기'를 보인다.
  setOnline(on) {
    this._online = on && this.hasOnlineUi;
    this.el.drop?.classList.toggle('hidden', !this._online);
    this._applyKeys();
  }

  // opts: { counts: {kind: 표시 문자열}, can: {kind: bool}, note, sub, busy }
  showPlace({ counts, can, note, sub, busy }) {
    const p = this.el.place;
    if (!p) return;
    p.classList.remove('hidden');
    p.classList.toggle('busy', Boolean(busy));
    for (const btn of p.querySelectorAll('[data-kind]')) btn.disabled = !can[btn.dataset.kind];
    for (const b of p.querySelectorAll('[data-count]')) this._set(`pc_${b.dataset.count}`, b, counts[b.dataset.count]);
    this._set('pnote', this.el.placeNote, note);
    this._set('psub', this.el.placeSub, sub);
  }

  hidePlace() {
    this.el.place?.classList.add('hidden');
  }

  show(on) {
    this.el.hud.classList.toggle('hidden', !on);
  }

  showTouch(on) {
    this.el.touch.classList.toggle('hidden', !on);
  }

  _set(key, el, text) {
    if (this._last[key] === text) return;
    this._last[key] = text;
    el.textContent = text;
  }

  update({ day, hour, zonesOn, zonesTotal, hp, battery, fuses, bandages, flashOn, cans, driving, fuel }) {
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
  }

  // 운전 중에는 조작 안내와 터치 상호작용 버튼 이름을 바꾼다.
  setDriving(on) {
    this._driving = on;
    this._applyKeys();
    if (this.el.useBtn) this.el.useBtn.textContent = on ? '내리기' : '상호작용';
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
