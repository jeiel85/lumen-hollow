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
      storyPointer: $('story-pointer'), storyPointerDist: $('story-pointer-dist'),
      drop: $('drop-btn'), place: $('place'), placeSub: $('place-sub'), placeNote: $('place-note-text'),
      objective: $('objective'), tags: $('npc-tags'),
    };
    this._chapter = false;
    this._tagEls = [];
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
    if (this._chapter) {
      this.el.keys.textContent = 'WASD 이동 · 마우스 조준 · F/클릭 손전등 · E 길게 상호작용 · Q 붕대 · V 지도 · 휠 줌 · Esc 일시정지';
      return;
    }
    this.el.keys.textContent = this._driving
      ? 'W 가속 · S 브레이크·후진 · A/D 핸들 · F 작업등 · E 길게 내리기 · Tab 배전반 · V 지도 · Esc 일시정지'
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

  // 2~4장: 구역·배전반·퓨즈·연료 대신 지금의 목표를 보인다. info가 null이면 1장 화면으로 돌아간다.
  setChapter(info) {
    this._chapter = Boolean(info);
    document.body.classList.toggle('chapter-mode', this._chapter);
    this.el.objective?.classList.toggle('hidden', !this._chapter);
    if (!this._chapter) this.tags([]);
    this._applyKeys();
  }

  setObjective(text) {
    if (this.el.objective) this._set('objective', this.el.objective, text ? `목표 · ${text}` : '');
  }

  // 가까운 인물 위의 이름표. list: [{ text, x, y }] 화면 픽셀 좌표
  tags(list) {
    const box = this.el.tags;
    if (!box) return;
    while (this._tagEls.length < list.length) {
      const el = document.createElement('span');
      el.className = 'npc-tag';
      box.append(el);
      this._tagEls.push(el);
    }
    this._tagEls.forEach((el, i) => {
      const t = list[i];
      el.classList.toggle('hidden', !t);
      if (!t) return;
      if (el.textContent !== t.text) el.textContent = t.text;
      el.style.transform = `translate(${Math.round(t.x)}px, ${Math.round(t.y)}px) translate(-50%, -100%)`;
    });
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

  update({ day, dayLabel, hour, zonesOn, zonesTotal, hp, battery, fuses, bandages, flashOn, cans, driving, fuel, powerUsed, powerCap, tripped, load }) {
    const hh = Math.floor(hour);
    const mm = Math.floor((hour - hh) * 6) * 10;
    this._set('day', this.el.day, dayLabel ?? `${day}일차`);
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
    this._driving = on;
    this._applyKeys();
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

  // 안내는 게임 시간(tickToasts)으로 사라진다: 일시정지·탭 전환·장면 동안에는 그대로 남는다(#14).
  // 지나간 안내는 log에 8개까지 남겨 일시정지 화면에서 다시 볼 수 있다.
  toast(text, kind = '') {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = text;
    this.el.toasts.appendChild(t);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
    (this._toasts ??= []).push({ el: t, left: 3.2 });
    this.log = [{ text, kind }, ...(this.log ?? [])].slice(0, 8);
  }

  tickToasts(dt) {
    if (!this._toasts?.length) return;
    for (const it of this._toasts) {
      it.left -= dt;
      if (it.left <= 0) it.el.classList.add('out');
      if (it.left <= -0.6) it.el.remove();
    }
    this._toasts = this._toasts.filter((it) => it.el.isConnected);
  }

  clearToasts() {
    this.el.toasts.replaceChildren();
    this._toasts = [];
  }

  // 일시정지 화면의 '최근 안내'
  renderLog(list) {
    if (!list) return;
    const rows = this.log ?? [];
    list.replaceChildren(...rows.map(({ text, kind }) => {
      const li = document.createElement('li');
      li.textContent = text;
      if (kind) li.className = kind;
      return li;
    }));
    list.closest('details')?.classList.toggle('hidden', rows.length === 0);
  }

  // 화면 밖 목표를 가리키는 화살표. sx, sy는 화면 픽셀 좌표.
  pointer(sx, sy, dist, visible) {
    this._pointer(this.el.pointer, this.el.pointerDist, 'pdist', sx, sy, dist, visible);
  }

  // 아직 안 읽은 이야기 기록을 가리키는 푸른 화살표. 배포 직후 옛 index.html과 섞이면 요소가 없을 수 있다.
  storyPointer(sx, sy, dist, visible) {
    if (this.el.storyPointer) this._pointer(this.el.storyPointer, this.el.storyPointerDist, 'sdist', sx, sy, dist, visible);
  }

  // 화면 밖에서 다가오는 그늘이(#14 '어둠 속 그늘이가 거의 안 보인다'): 가장자리에 붉은 표시. list: [{ sx, sy, k }],
  // sx, sy는 화면 좌표(밖일 수 있다), k는 가까울수록 1에 가까운 세기.
  threats(list) {
    const host = this.el.hud;
    if (!host) return;
    this._threatEls ??= [];
    while (this._threatEls.length < list.length) {
      const e = document.createElement('div');
      e.className = 'threat';
      e.setAttribute('aria-hidden', 'true');
      host.appendChild(e);
      this._threatEls.push(e);
    }
    const w = innerWidth;
    const h = innerHeight;
    const cx = w / 2;
    const cy = h / 2;
    const m = 22;
    for (let i = 0; i < this._threatEls.length; i++) {
      const e = this._threatEls[i];
      const t = list[i];
      if (!t) {
        if (!e.hidden) e.hidden = true;
        continue;
      }
      const dx = t.sx - cx;
      const dy = t.sy - cy;
      const sc = Math.min((cx - m) / Math.abs(dx || 1e-3), (cy - m) / Math.abs(dy || 1e-3));
      e.hidden = false;
      e.style.transform = `translate(${cx + dx * sc}px, ${cy + dy * sc}px) rotate(${Math.atan2(dy, dx)}rad)`;
      e.style.opacity = (0.35 + 0.65 * t.k).toFixed(2);
    }
  }

  _pointer(p, distEl, key, sx, sy, dist, visible) {
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
    this._set(key, distEl, `${Math.round(dist)}m`);
  }
}
