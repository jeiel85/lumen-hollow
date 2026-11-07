import { SPEAKERS, CHAPTERS } from './script.js';

// 이야기 화면: 무전·대면 장면(대화 컷신), 기록 읽기(3장의 두 기록 맞춰 보기 포함), 수첩.
// 장면이 도는 동안 게임은 멈추고(main의 'story' 상태), 카메라 이동은 onCam으로 main에 맡긴다.
// 배포 직후 캐시된 옛 index.html과 섞여 요소가 없으면 ok가 false가 되고, main은 이야기를 건너뛴다.

const $ = (id) => document.getElementById(id);
const CPS = 42; // 글자가 찍히는 속도(초당 글자 수)
const FADE = 0.42; // 암전 시간(초). style.css의 .story-fade 전환 시간과 맞춘다.
const ADVANCE_KEYS = new Set(['Space', 'Enter', 'NumpadEnter', 'KeyE']);

export class Dialogue {
  constructor({ sound }) {
    this.sound = sound;
    this.el = {
      root: $('story'), box: $('story-box'), who: $('story-who'), name: $('story-name'), text: $('story-text'),
      live: $('story-live'), next: $('story-next'), skip: $('story-skip'), fade: $('story-fade'),
      doc: $('doc'), paper: $('doc-paper'), where: $('doc-where'), title: $('doc-title'), body: $('doc-body'),
      hand: $('doc-hand'), note: $('doc-note'), close: $('doc-close'), flip: $('doc-flip'),
      jProgress: $('journal-progress'), jClues: $('journal-clues'), jScenes: $('journal-scenes'), jReset: $('journal-reset'),
      jResetHint: $('journal-reset-hint'),
    };
    this.ok = Object.values(this.el).every(Boolean);
    this.reduce = matchMedia('(prefers-reduced-motion: reduce)');
    this.scene = null; // 재생 중인 장면
    this.docOpen = null; // 열린 읽기 화면의 닫기 콜백
    this.docFlip = null; // 맞춰 보기 화면에서 아직 뒤집지 않은 면을 뒤집는 함수
    if (!this.ok) return;

    // 게임 입력(src/input.js)은 window의 버블 단계에서 키를 받는다. 장면·읽기 화면이 쓰는 키는
    // 캡처 단계에서 먼저 가로채, 장면을 닫은 직후 같은 Esc가 일시정지로 이어지지 않게 한다.
    addEventListener('keydown', (e) => this._key(e), true);
    this.el.root.addEventListener('pointerdown', (e) => {
      if (e.target.closest('#story-skip')) return;
      e.preventDefault();
      this.advance();
    });
    this.el.skip.addEventListener('click', () => this.skip());
    this.el.close.addEventListener('click', () => this.closeDoc());
    this.el.flip.addEventListener('click', () => this.docFlip?.());
  }

  get busy() {
    return !!(this.scene || this.docOpen);
  }

  _key(e) {
    if (this.docOpen) {
      if (ADVANCE_KEYS.has(e.code) || e.code === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        // 맞춰 보기 화면에서는 넘기는 키가 먼저 사진을 뒤집는다. Esc는 언제나 닫는다.
        if (e.repeat) return;
        if (this.docFlip && e.code !== 'Escape') this.docFlip();
        else this.closeDoc();
      }
      return;
    }
    if (!this.scene) return;
    if (ADVANCE_KEYS.has(e.code)) {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) this.advance();
    } else if (e.code === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) this.skip();
    }
  }

  // ---------------------------------------------------------------- 무전 장면

  // onCam(cam): 카메라 지시를 main에 넘긴다. onEnd(): 장면이 끝났을 때(건너뛴 경우 포함).
  play(scene, { onCam, onEnd }) {
    this.scene = scene;
    this.cbs = { onCam, onEnd };
    this.i = -1;
    this.phase = 'idle';
    this.t = 0;
    this.prevWho = null;
    this.moved = scene.lines.some((l) => l.cam);
    const r = this.el.root;
    r.classList.remove('hidden', 'leaving');
    r.classList.add('on');
    this.el.box.classList.add('hidden');
    this._setFade(false);
    this._line(0);
  }

  _line(i) {
    const line = this.scene.lines[i];
    if (!line) {
      this._finish();
      return;
    }
    this.i = i;
    if (line.cam?.cut) {
      this.phase = 'out';
      this.t = 0;
      this.el.box.classList.add('hidden');
      this._setFade(true);
      return;
    }
    if (line.cam) this.cbs.onCam(line.cam);
    this._type();
  }

  _type() {
    const line = this.scene.lines[this.i];
    const { who, text } = line;
    const el = this.el;
    el.box.classList.remove('hidden');
    // 무전으로 들리는 줄인지: 줄이 정하지 않으면 1장(무전 장면)은 할머니·낯선 목소리가 무전, 대면 장면은 모두 육성.
    const radio = line.radio ?? (!this.scene.inPerson && (who === 'gran' || who === 'other'));
    el.box.dataset.who = who;
    el.box.dataset.radio = radio ? '1' : '';
    el.name.textContent = SPEAKERS[who] ?? '';
    el.who.classList.toggle('hidden', who === 'nar');
    el.live.textContent = `${SPEAKERS[who] ? `${SPEAKERS[who]}${radio ? '(무전)' : ''}: ` : ''}${text}`;
    // 무전 속 목소리가 새로 들릴 때마다 스퀠치 소리(내가 송신하는 줄은 빼고)
    if (radio && who !== 'me' && this.prevWho !== who) this.sound.play('radio');
    this.prevWho = radio ? who : null;
    this.shown = this.reduce.matches ? text.length : 0;
    el.text.textContent = text.slice(0, this.shown);
    this.phase = this.shown >= text.length ? 'wait' : 'typing';
    el.next.classList.toggle('on', this.phase === 'wait');
  }

  // 화면을 누르거나 Space·Enter·E: 찍히는 중이면 줄을 다 보여 주고, 다 보였으면 다음 줄로.
  advance() {
    if (!this.scene) return;
    if (this.phase === 'typing') {
      const text = this.scene.lines[this.i].text;
      this.shown = text.length;
      this.el.text.textContent = text;
      this.phase = 'wait';
      this.el.next.classList.add('on');
    } else if (this.phase === 'wait') {
      this.el.next.classList.remove('on');
      this._line(this.i + 1);
    }
  }

  // 남은 줄을 건너뛴다. 대사는 수첩의 무전 기록에서 다시 볼 수 있다.
  skip() {
    if (!this.scene || this.phase === 'end') return;
    // 암전 중에 건너뛰면 그 줄의 카메라 지시(등대 점등 등)를 먼저 마저 한다.
    if (this.phase === 'out') this.cbs.onCam(this.scene.lines[this.i].cam);
    this._finish();
  }

  _finish() {
    this.el.box.classList.add('hidden');
    this.el.next.classList.remove('on');
    // 카메라가 멀리 갔던 장면은 암전한 뒤 플레이어에게 돌아온다.
    if (this.moved) {
      this.phase = 'end';
      this.t = 0;
      this._setFade(true);
      return;
    }
    this._close();
  }

  _close() {
    const { onEnd } = this.cbs;
    this.scene = null;
    this.phase = 'idle';
    const r = this.el.root;
    r.classList.remove('on');
    if (this.moved) {
      // 화면이 까만 동안 main이 카메라를 되돌리고, 그다음 밝아진다.
      r.classList.add('leaving');
      this._setFade(false);
      setTimeout(() => {
        if (!this.scene) r.classList.add('hidden');
        r.classList.remove('leaving');
      }, FADE * 1000 + 60);
    } else {
      r.classList.add('hidden');
    }
    onEnd();
  }

  _setFade(on) {
    this.el.fade.classList.toggle('on', on);
  }

  // 매 프레임(실제 경과 시간)
  update(dt) {
    if (!this.scene) return;
    if (this.phase === 'typing') {
      const text = this.scene.lines[this.i].text;
      this.shown = Math.min(text.length, this.shown + dt * CPS);
      this.el.text.textContent = text.slice(0, Math.floor(this.shown));
      if (this.shown >= text.length) {
        this.phase = 'wait';
        this.el.next.classList.add('on');
      }
    } else if (this.phase === 'out') {
      this.t += dt;
      if (this.t >= FADE) {
        this.cbs.onCam(this.scene.lines[this.i].cam);
        this.phase = 'in';
        this.t = 0;
        this._setFade(false);
      }
    } else if (this.phase === 'in') {
      this.t += dt;
      if (this.t >= FADE * 0.6) this._type();
    } else if (this.phase === 'end') {
      this.t += dt;
      if (this.t >= FADE) this._close();
    }
  }

  // ---------------------------------------------------------------- 기록 읽기

  // 남은 기록(clue) 또는 장면 기록(scene)을 종이 모양으로 보여 준다. first면 닫기 버튼이 "수첩에 적기".
  // flipped면 뒤집어야 보이는 면(3장 짐표)까지 보여 준다.
  showDoc(item, { first = false, flipped = false, onClose }) {
    const el = this.el;
    const isScene = Array.isArray(item.lines);
    el.paper.className = `paper kind-${isScene ? 'radio' : item.kind}`;
    el.where.textContent = isScene ? (item.inPerson ? '그날의 기록' : '무전 기록') : item.where;
    el.title.textContent = item.title;
    el.body.replaceChildren();
    if (isScene) {
      for (const line of item.lines) {
        const p = document.createElement('p');
        p.className = `line who-${line.who}`;
        if (SPEAKERS[line.who]) {
          const b = document.createElement('b');
          b.textContent = SPEAKERS[line.who];
          p.append(b, ' ');
        }
        p.append(line.text);
        el.body.append(p);
      }
    } else {
      for (const text of item.body) this._para(text);
      if (flipped && item.flip) for (const text of item.flip.body) this._para(text, 'flipped');
    }
    el.hand.textContent = (flipped && item.flip?.hand) || item.hand || '';
    el.note.textContent = item.note ?? '';
    el.close.textContent = first ? '수첩에 적어 두기' : '닫기';
    this._openDoc(onClose);
  }

  _para(text, cls = '') {
    const p = document.createElement('p');
    // '— 할머니가'처럼 서명으로 끝맺는 줄은 오른쪽에 붙인다.
    if (cls || text.startsWith('— ')) p.className = cls || 'sign';
    p.textContent = text;
    this.el.body.append(p);
    return p;
  }

  _openDoc(onClose) {
    const el = this.el;
    el.flip.classList.toggle('hidden', !this.docFlip);
    // 뒤집을 면이 남아 있으면 '사진 뒤집기'가 주 단추, 닫기는 보조 단추다.
    el.close.classList.toggle('ghost', !!this.docFlip);
    el.doc.classList.remove('hidden');
    el.doc.scrollTop = 0;
    this.docOpen = onClose;
    this.sound.play('page');
    (this.docFlip ? el.flip : el.close).focus({ preventScroll: true });
  }

  // 3장: 이송 명부와 소지품 봉투의 17번을 나란히 놓고, 봉투 속 사진을 뒤집어 본다.
  // 뒤집으면 onFlip(), 닫으면 onClose(flipped). 숫자를 맞히는 식의 실패는 없다.
  showCompare(a, b, { onFlip, onClose }) {
    const el = this.el;
    el.paper.className = 'paper kind-clipboard compare';
    el.where.textContent = '둑길 창고 — 명부와 봉투를 나란히';
    el.title.textContent = '17번';
    el.body.replaceChildren();
    this._para(a.title, 'sec');
    this._para(a.body[a.match], 'match');
    this._para(b.title, 'sec');
    b.body.forEach((t, i) => this._para(t, i === b.match ? 'match' : ''));
    el.hand.textContent = '';
    el.note.textContent = '';
    el.close.textContent = '닫기';
    el.flip.textContent = b.flip.label;
    let flipped = false;
    this.docFlip = () => {
      this.docFlip = null;
      flipped = true;
      for (const t of b.flip.body) this._para(t, 'flipped');
      el.hand.textContent = b.flip.hand ?? '';
      el.flip.classList.add('hidden');
      el.close.classList.remove('ghost');
      el.close.textContent = '수첩에 적어 두기';
      el.close.focus({ preventScroll: true });
      this.sound.play('page');
      onFlip?.();
    };
    this._openDoc(() => onClose?.(flipped));
  }

  closeDoc() {
    if (!this.docOpen) return;
    const cb = this.docOpen;
    this.docOpen = null;
    this.docFlip = null;
    this.el.doc.classList.add('hidden');
    cb();
  }

  // ---------------------------------------------------------------- 수첩

  // story: 진행 상태(src/story.js), scenes·docs: 대본, upTo: 다다른 장(그 뒤 장의 항목은 아예 보이지 않는다),
  // canReset: 처음 화면에서 열었는지. onRead(item)은 항목을 눌렀을 때, onReset()은 "이야기 처음부터"를 두 번 눌렀을 때.
  renderJournal({ story, scenes: allScenes, docs: allDocs, upTo = 1, canReset, onRead, onReset }) {
    const el = this.el;
    const chOf = (item) => item.ch ?? 1;
    const scenes = allScenes.filter((s) => chOf(s) <= upTo);
    const docs = allDocs.filter((c) => chOf(c) <= upTo);
    const seen = scenes.filter((s) => story.isSeen(s.id));
    el.jProgress.textContent = `주운 기록 ${story.foundDocs(upTo)} / ${docs.length} · 들은 이야기 ${seen.length} / ${scenes.length}`;
    // 2장에 다다르면 장마다 머리글을 단다.
    const header = (list, ch, prev) => {
      if (upTo < 2 || ch === prev) return;
      const li = document.createElement('li');
      li.className = 'jhead';
      li.textContent = `${ch}장 · ${CHAPTERS[ch - 1]?.title ?? ''}`;
      list.append(li);
    };

    el.jClues.replaceChildren();
    let prevCh = 0;
    for (const c of docs) {
      header(el.jClues, chOf(c), prevCh);
      prevCh = chOf(c);
      const li = document.createElement('li');
      if (story.isFound(c.id)) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'jrow';
        btn.innerHTML = '<span class="jt"></span><small></small>';
        btn.querySelector('.jt').textContent = c.title;
        btn.querySelector('small').textContent = c.where;
        btn.addEventListener('click', () => onRead(c));
        li.append(btn);
      } else {
        li.className = story.isUnlocked(c.id) ? 'jrow open' : 'jrow locked';
        li.innerHTML = '<span class="jt">???</span><small></small>';
        li.querySelector('small').textContent = story.isUnlocked(c.id) ? `${c.where} — 푸른 표시를 따라가자` : '아직 모른다';
      }
      el.jClues.append(li);
    }

    el.jScenes.replaceChildren();
    prevCh = 0;
    for (const s of scenes) {
      if (!story.isSeen(s.id)) continue;
      header(el.jScenes, chOf(s), prevCh);
      prevCh = chOf(s);
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'jrow';
      btn.innerHTML = '<span class="jt"></span>';
      btn.querySelector('.jt').textContent = s.title;
      btn.addEventListener('click', () => onRead(s));
      li.append(btn);
      el.jScenes.append(li);
    }
    if (!seen.length) {
      const li = document.createElement('li');
      li.className = 'jrow locked';
      li.textContent = '아직 들은 이야기가 없다.';
      el.jScenes.append(li);
    }

    // 실수로 지우지 않게 두 번 눌러야 지운다(기록 지우기와 같은 방식).
    const btn = el.jReset;
    btn.disabled = !canReset || !story.hasProgress;
    btn.textContent = '이야기 처음부터';
    el.jResetHint.textContent = canReset ? '' : '처음 화면의 수첩에서 지울 수 있다.';
    let armed = null;
    btn.onclick = () => {
      const now = performance.now();
      if (armed === null || now - armed > 4000) {
        armed = now;
        btn.textContent = '한 번 더 누르면 처음부터';
        return;
      }
      armed = null;
      onReset();
    };
  }
}
