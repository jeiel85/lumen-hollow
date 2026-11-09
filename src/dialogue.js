import { SPEAKERS, CHAPTERS } from './script.js';
import { tr } from './i18n.js';

// 이야기 화면: 무전·대면 장면(대화 컷신), 기록 읽기(3장의 두 기록 맞춰 보기 포함), 수첩.
// 장면이 도는 동안 게임은 멈추고(main의 'story' 상태), 카메라 이동은 onCam으로 main에 맡긴다.
// 배포 직후 캐시된 옛 index.html과 섞여 요소가 없으면 ok가 false가 되고, main은 이야기를 건너뛴다.

const $ = (id) => document.getElementById(id);
const CPS = 42; // 글자가 찍히는 속도(초당 글자 수)
const FADE = 0.42; // 암전 시간(초). style.css의 .story-fade 전환 시간과 맞춘다.
const ADVANCE_KEYS = new Set(['Space', 'Enter', 'NumpadEnter', 'KeyE']);
// 컷신 그림(대본 줄의 art). 서비스 워커가 미리 받아 두는 목록(sw.js)과 tests/node/sw.test.mjs가 짝을 맞춘다.
// 그림 내용을 바꿀 때는 파일 이름도 바꾼다(같은 주소면 Pages 10분 캐시·서비스 워커 캐시에 옛 그림이 남는다, tools/art/README.md).
const artUrl = (name) => `art/story/${name}.webp`;
// 그림이 아직 오지 않았으면 암전을 이만큼 더 잡아 둔다(초). 그래도 안 오면 그림 자리만 깔고 넘어간다(#45).
const ART_WAIT = 2.5;

// 컷신 그림의 짧은 설명(#45). 그림은 aria-hidden이라, 그림이 깔리거나 바뀐 줄에서 화면 낭독기에 대사 앞에 읽어 준다.
// 대본 줄의 art 이름마다 하나씩 둔다(빠지면 tests/node/story.test.mjs가 잡는다). 대사로 전하지 않는 것만 보이게 짧게.
export const ART_ALT = {
  'prologue-hand': tr('어두운 방, 엄마의 두 손이 켜진 손전등을 내 손에 쥐여 준다.'),
  'prologue-road': tr('비 오는 밤, 노란 우비를 입은 내가 버려진 차와 꺼진 전봇대를 지나 골짜기로 난 빈 길을 걷는다.'),
  'confession-switch': tr('등대 꼭대기 등실, 할머니가 큰 렌즈 옆에서 쇠 스위치를 내린다. 호수 건너 마을에는 아직 불이 켜져 있다.'),
  'finale-firstlight': tr('비 그친 밤, 섬 등대가 다시 켜져 호수 위로 빛줄기를 보낸다. 선착장에 선 나는 무전기를 들고 있다.'),
  'ferry-row': tr('안개 낀 호수, 나는 나룻배를 저어 등대섬으로 간다. 섬 선착장에서 할머니가 손을 흔든다.'),
  'landing-hands': tr('빗속의 돌 선착장, 엄지에 반창고를 감은 할머니 손이 배에 탄 내 손을 끌어 올린다.'),
  'watch-hands': tr('밤의 돌계단, 할머니 손이 내 손을 등잔 불빛 안으로 끌어 넣는다. 뒤로 꺼진 등대와 호수 건너 마을 불빛.'),
  'bowls-riceballs': tr('빗속 처마 밑 탁자에 밥그릇 둘과 라디오. 할머니가 주먹밥을 뭉쳐 내 손에 하나 올려 준다.'),
  'count-shoes': tr('운동장의 구호 천막, 간이침대 한 줄 앞에 신발 열한 켤레가 가지런하다. 마지막 침대에서 한 사람이 아직 잔다.'),
  'key-photo': tr('창고 선반에서 손수건을 펼치니 열쇠와 17번 짐표, 뒷면에 글씨가 적힌 사진 한 장이 나온다.'),
  'stretchers-levee': tr('밤의 둑길, 우비 입은 사람들이 손전등을 비추며 들것 여섯을 줄지어 나른다.'),
  'chair-hands': tr('등잔을 켠 교실 병상, 나는 잠든 엄마의 손을 잡고 있다. 옆에는 빈 나무 의자.'),
  'mom-wakes': tr('비 오는 밤 교실 병상, 할머니가 무전기를 깨어난 엄마의 손에 대 준다. 창밖 운동장에 작은 불빛 하나.'),
  'three-riceball': tr('할머니, 담요를 두른 엄마, 내가 침대 끝에 나란히 앉아 주먹밥 조각을 하나씩 들고 있다.'),
  'broadcast-morning': tr('해 뜨는 학교 운동장, 구령대 탁자에서 나는 무전기 송신 단추를 누른다.'),
  'reports-memo': tr('아침 햇살 속 탁자, 내가 무전기를 들고 엄마가 운동화 그림이 그려진 제보를 받아 적는다.'),
};

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
    // 컷신 그림(줄의 art). 옛 index.html과 섞여 없으면 그림 없이 3D 장면으로만 튼다(ok에 넣지 않는다).
    this.artEl = $('story-art');
    this.artImg = this.artEl?.querySelector('img') ?? null;
    this.art = null; // 지금 깔린 그림 이름(받지 못한 그림이면 이름만 두고 화면에는 깔지 않는다)
    this.artState = new Map(); // 그림 이름 → 'loading' | 'ok' | 'fail'
    this.artSaid = null; // 다음 줄에서 화면 낭독기에 읽어 줄 그림 설명
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
    // 읽기 화면·장면이 열려 있는 동안 Tab은 그 안에서만 돈다(뒤 화면으로 빠지지 않게, #20).
    if (e.code === 'Tab' && (this.docOpen || this.scene)) {
      const root = this.docOpen ? this.el.doc : this.el.root;
      const f = [...root.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])')]
        .filter((el) => !el.disabled && !el.classList.contains('hidden') && el.offsetParent !== null);
      e.preventDefault();
      e.stopPropagation();
      if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      f[e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i + 1) % f.length].focus({ preventScroll: true });
      return;
    }
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
  // 새 판·처음 화면으로 갈 때: 재생 중인 장면과 열린 읽기 화면을 콜백 없이 닫는다.
  // 지금은 화면 구조상 그 순서로 누를 수 없지만, 경로가 생겨도 장면 상태가 다음 판으로 새지 않게(#20).
  reset() {
    if (!this.ok) return;
    this.scene = null;
    this.phase = 'idle';
    this.moved = false;
    this.docOpen = null;
    this.docFlip = null;
    this.el.root.classList.remove('on', 'leaving');
    this.el.root.classList.add('hidden');
    this.el.box.classList.add('hidden');
    this.el.next.classList.remove('on');
    this._setFade(false);
    this._setArt(null);
    this.el.doc.classList.add('hidden');
  }

  play(scene, { onCam, onEnd }) {
    this.scene = scene;
    this.skipped = false;
    this.cbs = { onCam, onEnd };
    this.i = -1;
    this.phase = 'idle';
    this.t = 0;
    this.prevWho = null;
    // 카메라가 움직이거나 그림을 깐 장면은 끝날 때 암전한 뒤 게임 화면으로 돌아온다.
    this.moved = scene.lines.some((l) => l.cam || l.art);
    // 그림은 암전 중에 바꾸므로 미리 받아 둔다(서비스 워커가 받아 둔 뒤라면 바로 나온다).
    this.preload(scene);
    const r = this.el.root;
    r.classList.remove('hidden', 'leaving');
    r.classList.add('on');
    this.el.box.classList.add('hidden');
    this._setFade(false);
    // 키보드 포커스를 장면 안(건너뛰기 단추)으로 옮긴다. 넘기기는 Space·Enter·E가 그대로 한다.
    this.el.skip.focus({ preventScroll: true });
    this._line(0);
  }

  _line(i) {
    const line = this.scene.lines[i];
    if (!line) {
      this._finish();
      return;
    }
    this.i = i;
    // 화면을 자르는 카메라 이동, 그림을 깔거나 바꾸거나 걷는 줄은 암전한 사이에 바꾼다.
    if (line.cam?.cut || this._artChanges(line)) {
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
    // 이 줄에서 그림이 깔렸으면 그림 설명을 먼저 읽는다(한 번에 바꿔야 낭독기가 앞 글을 건너뛰지 않는다).
    const pic = this.artSaid ? `${tr('그림: {0}', [this.artSaid])} ` : '';
    this.artSaid = null;
    el.live.textContent = `${pic}${SPEAKERS[who] ? `${SPEAKERS[who]}${radio ? tr('(무전)') : ''}: ` : ''}${text}`;
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
    this.skipped = true; // 이야기 진행 집계용(끝까지 봤는지·건너뛰었는지)
    // 암전 중에 건너뛰면 그 줄의 카메라 지시(등대 점등 등)를 먼저 마저 한다.
    if (this.phase === 'out') this.cbs.onCam(this.scene.lines[this.i].cam);
    this._finish();
  }

  _artChanges(line) {
    return !!this.artImg && line.art !== undefined && (line.art ?? null) !== this.art;
  }

  // 장면의 그림을 미리 받는다. 처음 화면에서 첫 장면 그림을 받아 둘 때도 부른다(느린 회선의 첫 판, #45).
  // 지난번에 받지 못한 그림(오프라인이었다 등)은 다시 시도한다.
  preload(scene) {
    if (!this.artImg || !scene) return;
    for (const l of scene.lines) {
      const name = l.art;
      if (!name || (this.artState.has(name) && this.artState.get(name) !== 'fail')) continue;
      this.artState.set(name, 'loading');
      const img = new Image();
      img.decoding = 'async';
      img.src = artUrl(name);
      // decode()는 받기와 풀기가 끝나야 이루어진다. 받았는데 풀기만 거절되는 브라우저도 있어 크기로 한 번 더 본다.
      img.decode().then(
        () => this.artState.set(name, 'ok'),
        () => this.artState.set(name, img.complete && img.naturalWidth > 0 ? 'ok' : 'fail'),
      );
    }
  }

  // 그림을 기다리는 중인지: 깔 그림이 아직 오는 중이고, 암전을 잡아 둔 시간이 ART_WAIT를 넘지 않았다.
  _artPending(line, waited) {
    return this._artChanges(line) && !!line.art && this.artState.get(line.art) === 'loading' && waited < ART_WAIT;
  }

  // 컷신 그림을 깔거나(name) 걷는다(null). 바꿀 때마다 천천히 다가가는 움직임을 처음부터 다시 튼다.
  // 받지 못한 그림(404·오프라인에 캐시 없음)은 깔지 않는다: 검은 바탕 대신 3D 장면이 보인다(#45).
  _setArt(name) {
    if (!this.artImg) return;
    this.art = name ?? null;
    const show = !!this.art && this.artState.get(this.art) !== 'fail';
    this.artEl.classList.toggle('on', show);
    this.artSaid = show ? ART_ALT[this.art] ?? null : null;
    if (!show) return;
    this.artImg.src = artUrl(this.art);
    // 세로 화면에서 그림 띠 위아래를 채우는 흐린 바탕(style.css .story-art::before)
    this.artEl.style.setProperty('--art', `url("${artUrl(this.art)}")`);
    this.artImg.style.animation = 'none';
    void this.artImg.offsetWidth; // 애니메이션 다시 시작
    this.artImg.style.animation = '';
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
    this._setArt(null); // 그림을 깐 장면은 moved라 화면이 까만 동안 걷힌다
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
        const line = this.scene.lines[this.i];
        // 느린 회선의 첫 방문: 그림이 오기 전에 밝아지면 검은 화면에 자막만 보인다. 그림이 올 때까지 암전을 잡아 둔다.
        if (this._artPending(line, this.t - FADE)) return;
        this.cbs.onCam(line.cam);
        if (this._artChanges(line)) this._setArt(line.art);
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
    el.where.textContent = isScene ? (item.inPerson ? tr('그날의 기록') : tr('무전 기록')) : item.where;
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
    el.close.textContent = first ? tr('수첩에 적어 두기') : tr('닫기');
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
    el.where.textContent = tr('둑길 창고 — 명부와 봉투를 나란히');
    el.title.textContent = tr('17번');
    el.body.replaceChildren();
    this._para(a.title, 'sec');
    this._para(a.body[a.match], 'match');
    this._para(b.title, 'sec');
    b.body.forEach((t, i) => this._para(t, i === b.match ? 'match' : ''));
    el.hand.textContent = '';
    el.note.textContent = '';
    el.close.textContent = tr('닫기');
    el.flip.textContent = b.flip.label;
    let flipped = false;
    this.docFlip = () => {
      this.docFlip = null;
      flipped = true;
      for (const t of b.flip.body) this._para(t, 'flipped');
      el.hand.textContent = b.flip.hand ?? '';
      el.flip.classList.add('hidden');
      el.close.classList.remove('ghost');
      el.close.textContent = tr('수첩에 적어 두기');
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
    el.jProgress.textContent = tr('주운 기록 {0} / {1} · 들은 이야기 {2} / {3}', [story.foundDocs(upTo), docs.length, seen.length, scenes.length]);
    // 2장에 다다르면 장마다 머리글을 단다.
    const header = (list, ch, prev) => {
      if (upTo < 2 || ch === prev) return;
      const li = document.createElement('li');
      li.className = 'jhead';
      li.textContent = tr('{0}장 · {1}', [ch, CHAPTERS[ch - 1]?.title ?? '']);
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
        li.querySelector('small').textContent = story.isUnlocked(c.id) ? tr('{0} — 푸른 표시를 따라가자', [c.where]) : tr('아직 모른다');
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
      li.textContent = tr('아직 들은 이야기가 없다.');
      el.jScenes.append(li);
    }

    // 실수로 지우지 않게 두 번 눌러야 지운다(기록 지우기와 같은 방식).
    const btn = el.jReset;
    btn.disabled = !canReset || !story.hasProgress;
    btn.textContent = tr('이야기 처음부터');
    el.jResetHint.textContent = canReset ? '' : tr('처음 화면의 수첩에서 지울 수 있다.');
    let armed = null;
    btn.onclick = () => {
      const now = performance.now();
      if (armed === null || now - armed > 4000) {
        armed = now;
        btn.textContent = tr('한 번 더 누르면 처음부터');
        return;
      }
      armed = null;
      onReset();
    };
  }
}
