// 키보드·마우스·터치 입력. 터치는 왼쪽 가상 스틱 + 오른쪽 버튼.
const MOVE_KEYS = {
  KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};

export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = { x: 0, y: 0, active: false, moved: 0 };
    this.wheel = 0;
    this.stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.touchUse = false;
    this.usingTouch = false;

    addEventListener('keydown', (e) => {
      // 설정 화면의 슬라이더·스위치는 방향키·스페이스로 조작하므로 막지 않는다.
      const inForm = e.target instanceof Element && e.target.closest('input, select, textarea');
      if (!inForm && (e.code.startsWith('Arrow') || e.code === 'Space')) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear();
      this.touchUse = false;
    });

    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.mouse.x = (e.clientX / innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / innerHeight) * 2 + 1;
      this.mouse.active = true;
      this.mouse.moved = performance.now();
      this.usingTouch = false;
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button === 0) this.pressed.add('MouseLeft');
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.wheel += Math.sign(e.deltaY);
    }, { passive: false });

    this._bindTouch();
  }

  _bindTouch() {
    const zone = document.getElementById('stick-zone');
    const base = document.getElementById('stick');
    const knob = document.getElementById('knob');
    const R = 52;
    const setKnob = () => {
      knob.style.transform = `translate(${this.stick.x * R}px, ${this.stick.y * R}px)`;
    };
    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.usingTouch = true;
      this.stick.id = e.pointerId;
      this.stick.ox = e.clientX;
      this.stick.oy = e.clientY;
      this.stick.x = this.stick.y = 0;
      base.style.left = `${e.clientX}px`;
      base.style.top = `${e.clientY}px`;
      base.classList.add('on');
      zone.setPointerCapture(e.pointerId);
      setKnob();
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stick.id) return;
      let dx = (e.clientX - this.stick.ox) / R;
      let dy = (e.clientY - this.stick.oy) / R;
      const l = Math.hypot(dx, dy);
      if (l > 1) {
        dx /= l;
        dy /= l;
      }
      this.stick.x = dx;
      this.stick.y = dy;
      setKnob();
    });
    const end = (e) => {
      if (e.pointerId !== this.stick.id) return;
      this.stick.id = null;
      this.stick.x = this.stick.y = 0;
      base.classList.remove('on');
      setKnob();
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);

    for (const btn of document.querySelectorAll('[data-act]')) {
      const act = btn.dataset.act;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.usingTouch = true;
        if (act === 'use') this.touchUse = true;
        else this.pressed.add(`Touch_${act}`);
        btn.classList.add('down');
      });
      const up = () => {
        if (act === 'use') this.touchUse = false;
        btn.classList.remove('down');
      };
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('pointerleave', up);
    }
  }

  // 화면 기준 이동 입력 (x: 오른쪽, y: 아래쪽), 길이 ≤ 1
  moveScreen() {
    let x = 0;
    let y = 0;
    for (const [code, [kx, ky]] of Object.entries(MOVE_KEYS)) {
      if (this.keys.has(code)) {
        x += kx;
        y += ky;
      }
    }
    const l = Math.hypot(x, y);
    if (l > 0) return { x: x / l, y: y / l };
    if (this.stick.id !== null) {
      const sl = Math.hypot(this.stick.x, this.stick.y);
      if (sl > 0.15) return { x: this.stick.x, y: this.stick.y };
    }
    return { x: 0, y: 0 };
  }

  // 운전 키 입력: W/↑ 가속, S/↓ 브레이크·후진, A/D·←/→ 핸들(오른쪽 +). 터치 스틱은 main에서 방향 지정 방식으로 처리한다.
  driveKeys() {
    const k = this.keys;
    const thr = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const steer = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    return { thr, steer, any: thr !== 0 || steer !== 0 };
  }

  get interactHeld() {
    return this.keys.has('KeyE') || this.keys.has('Space') || this.touchUse;
  }

  // 데스크톱에서 마우스를 한 번이라도 움직였으면 커서 방향으로 조준 (터치 중이면 이동 방향)
  get aiming() {
    return !this.usingTouch && this.mouse.active;
  }

  consume(code) {
    if (this.pressed.has(code)) {
      this.pressed.delete(code);
      return true;
    }
    return false;
  }

  takeWheel() {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  endFrame() {
    this.pressed.clear();
  }
}
