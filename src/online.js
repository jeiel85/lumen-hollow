import { load, save } from './storage.js';
import { SLOT_LAYOUT, SLOT_COUNT } from './slots.js';

// 공유 보급품 API 클라이언트와 이 브라우저의 기록. 설계: docs/online-caches.md 4·8·9·13절.
// 온라인 요소는 부가 기능이다. 요청이 실패해도 예외를 던지지 않고 { ok:false, error }를 돌려주며,
// 호출한 쪽이 플레이어에게 사유를 알린다. 게임 루프는 응답을 기다리지 않는다.

// 배포한 Worker 주소(끝에 / 없이). 비어 있으면 온라인 보급품 전체가 꺼진다: 요청도, 화면 요소도 없다.
// 배포 절차는 server/README.md.
export const ONLINE_API = '';

// 서버 rules.js의 noteCount와 개수를 맞춘다. 번호가 저장되므로 순서를 바꾸지 말고 끝에만 추가한다.
export const NOTES = ['', '같이 버텨요', '여기서 잠깐 쉬어 가요', '밤이 길어요, 조심해요', '곧 불이 켜질 거예요', '먼저 지나간 사람이', '아껴 쓰세요', '트럭에 기름 넣고 가요'];
export const KIND_NAMES = { bandage: '붕대', fuel: '연료통', battery: '배터리 팩' };
export const RUN_TAKE_LIMIT = 3; // 한 판에 남의 보급품을 꺼낼 수 있는 횟수
export const BATTERY_PACK = 30; // 배터리 팩 하나에 담는 손전등 배터리(%)
export const BATTERY_PACK_MIN = 50; // 이만큼은 있어야 배터리 팩을 만들 수 있다
export const MAX_MINE = 3; // 서버 rules.js의 maxActivePerPlayer와 같은 값(안내 문구용)
export const PLACE_RADIUS = 3; // 이 거리 안의 빈 인도 슬롯에 남긴다
export const CACHE_REACH = 1.6; // 보급품을 꺼낼 수 있는 거리

const LIST_TIMEOUT = 3000;
const CALL_TIMEOUT = 5000;
const REUSE_MS = 24 * 60 * 60 * 1000;
const KEEP_MS = 8 * 24 * 60 * 60 * 1000; // 수명 최대 7일 + 여유
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ID_RE = /^c_[a-z2-7]{26}$/;
const K = { pid: 'lumen.pid', pref: 'lumen.online', log: 'lumen.cachelog' };

function uuid4() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// 개발용: localhost에서만 ?api=http://localhost:8787 로 서버 주소를 바꿀 수 있다(배포 주소에서는 무시).
function resolveBase(params) {
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const override = params.get('api');
  if (local && override && /^https?:\/\//.test(override)) return override.replace(/\/+$/, '');
  return ONLINE_API;
}

export class Online {
  constructor(params) {
    this.base = resolveBase(params);
    this.pid = null;
    this.log = this._loadLog();
  }

  // 서버 주소가 있는가 (없으면 기능 전체를 숨긴다)
  get available() {
    return Boolean(this.base);
  }

  // 플레이어가 끄지 않았는가
  get enabled() {
    return this.available && load(K.pref) !== 'off';
  }

  setEnabled(on) {
    save(K.pref, on ? 'on' : 'off');
  }

  // 저장소를 못 쓰는 환경에서는 이 페이지가 열려 있는 동안만 같은 ID를 쓴다.
  playerId() {
    if (this.pid) return this.pid;
    let id = load(K.pid);
    if (!UUID_RE.test(id ?? '')) {
      id = uuid4();
      save(K.pid, id);
    }
    this.pid = id;
    return id;
  }

  // ---------------------------------------------------------------- 이 브라우저의 기록
  // mine: 내가 둔 보급품 ID, used: 꺼낸 시각, thanked: 고마워요 보낸 ID. 서버가 최종 판정하고, 이것은 화면 안내용이다.

  _loadLog() {
    try {
      const v = JSON.parse(load(K.log));
      if (v && typeof v === 'object') return { mine: v.mine ?? {}, used: v.used ?? {}, thanked: v.thanked ?? {} };
    } catch {
      // 손상된 기록은 버리고 새로 시작한다(서버 판정에는 영향 없음).
    }
    return { mine: {}, used: {}, thanked: {} };
  }

  _saveLog() {
    const cut = Date.now() - KEEP_MS;
    for (const part of Object.values(this.log)) {
      for (const [id, at] of Object.entries(part)) if (!(at > cut)) delete part[id];
    }
    save(K.log, JSON.stringify(this.log));
  }

  isMine(id) {
    return id in this.log.mine;
  }

  usedRecently(id) {
    return Date.now() - (this.log.used[id] ?? 0) < REUSE_MS;
  }

  hasThanked(id) {
    return id in this.log.thanked;
  }

  _mark(part, id) {
    this.log[part][id] = Date.now();
    this._saveLog();
  }

  _unmark(part, id) {
    delete this.log[part][id];
    this._saveLog();
  }

  // ---------------------------------------------------------------- 요청

  async _call(method, path, { body, timeout = CALL_TIMEOUT, player = true } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const headers = {};
      if (player) headers['X-Lumen-Player'] = this.playerId();
      if (body) headers['Content-Type'] = 'application/json';
      const res = await fetch(this.base + path, {
        method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal, cache: 'no-store', credentials: 'omit',
      });
      let data = null;
      if (res.status !== 204) {
        try {
          data = await res.json();
        } catch (err) {
          // 헤더는 왔는데 본문을 다 읽기 전에 시간 제한에 걸렸거나(느린 기기에서 메인 스레드가 막힌 경우), JSON이 아니다.
          // 성공으로 돌려주면 호출한 쪽이 빈 data를 읽게 되므로 실패로 다룬다.
          const error = ctrl.signal.aborted ? 'timeout' : 'bad_response';
          console.warn(`[online] ${method} ${path} → ${res.status} 본문을 읽지 못함(${error})`, err);
          return { ok: false, status: res.status, data: null, error };
        }
      }
      if (!res.ok) console.warn(`[online] ${method} ${path} → ${res.status}`, data);
      return { ok: res.ok, status: res.status, data, error: res.ok ? null : data?.error ?? `http_${res.status}` };
    } catch (err) {
      const error = ctrl.signal.aborted ? 'timeout' : 'network';
      console.warn(`[online] ${method} ${path} 실패(${error})`, err);
      return { ok: false, status: 0, data: null, error };
    } finally {
      clearTimeout(timer);
    }
  }

  // 판을 시작할 때 한 번. 3초 안에 오지 않으면 포기한다(늦게 온 목록이 판 도중 마을을 바꾸지 않게).
  async list() {
    const r = await this._call('GET', `/v1/caches?layout=${SLOT_LAYOUT}`, { timeout: LIST_TIMEOUT, player: false });
    if (!r.ok) return r;
    const enabled = r.data?.enabled !== false;
    const raw = Array.isArray(r.data?.caches) ? r.data.caches : [];
    // 모르는 종류나 이상한 값은 버린다(새 서버와 옛 클라이언트가 섞여도 깨지지 않게).
    const caches = raw.filter((c) => c && ID_RE.test(c.id) && Number.isInteger(c.slot) && c.slot >= 0 && c.slot < SLOT_COUNT
      && c.kind in KIND_NAMES && Number.isInteger(c.note) && c.note >= 0 && c.note < NOTES.length
      && Number.isInteger(c.charges) && c.charges > 0)
      .map((c) => ({ id: c.id, slot: c.slot, kind: c.kind, note: c.note, charges: c.charges, thanks: c.thanks | 0, mine: this.isMine(c.id) }));
    return { ...r, enabled, caches };
  }

  async place(slot, kind, note) {
    const r = await this._call('POST', '/v1/caches', { body: { layout: SLOT_LAYOUT, slot, kind, note } });
    if (r.ok && !ID_RE.test(r.data?.cache?.id ?? '')) return { ...r, ok: false, error: 'bad_response' };
    if (r.ok) this._mark('mine', r.data.cache.id);
    return r;
  }

  async use(id) {
    const r = await this._call('POST', `/v1/caches/${id}/use`);
    if (r.ok || r.error === 'used_today') this._mark('used', id);
    if (r.error === 'own_cache') this._mark('mine', id);
    return r;
  }

  async thank(id) {
    let r = await this._call('POST', `/v1/caches/${id}/thanks`);
    if (r.error === 'network' || r.error === 'timeout') r = await this._call('POST', `/v1/caches/${id}/thanks`);
    if (r.ok || r.error === 'already_thanked') this._mark('thanked', id);
    if (r.error === 'not_used') this._unmark('used', id);
    return r;
  }

  async summary() {
    return this._call('GET', '/v1/me');
  }

  // 서버의 내 기록을 지우고, 성공하면 이 브라우저의 기록과 ID도 새로 만든다.
  async forget() {
    const r = await this._call('DELETE', '/v1/me');
    if (r.ok) {
      this.log = { mine: {}, used: {}, thanked: {} };
      this._saveLog();
      this.pid = uuid4();
      save(K.pid, this.pid);
    }
    return r;
  }
}
