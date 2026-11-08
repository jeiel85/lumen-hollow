import { load, save } from './storage.js';
import { isNativeApp } from './native.js';

// 2~4장 한 번 결제(#51). 앱에서는 Play 결제(android/.../BillingPlugin.java)에 묻고, 로컬 개발(?app)에서는 흉내 가게를 쓴다
// (?paywall이면 사지 않은 상태에서 시작, ?paywall=pending·cancel·error로 결과를 고른다). 웹판은 2~4장이 앱에만 있어 쓰지 않는다.
// 결정·상품 id·맛보기 범위는 DECISIONS.md "2~4장 한 번 결제".
export const STORY_PRODUCT = 'story_ch2_4'; // Play Console의 일회성 상품 id. 한 번 만든 id는 지우면 다시 쓸 수 없다.
const KEY = 'lumen.owned'; // { v: 1, story: bool } Play가 마지막으로 알려 준 구매 상태(Play에 닿지 못할 때 이것으로 판단)

function cached() {
  try {
    const raw = JSON.parse(load(KEY));
    return !!raw && raw.v === 1 && raw.story === true;
  } catch {
    return false;
  }
}

export class Store {
  // mode: 'native'(Play) | 'fake'(개발용 흉내) | 'free'(잠그지 않는 테스터용 앱 빌드) | 'none'(웹판).
  // fake: { owned, outcome: 'owned'|'pending'|'canceled'|'error' }
  constructor({ mode = isNativeApp() ? 'native' : 'none', fake = null } = {}) {
    this.mode = mode;
    this.fake = fake ?? { owned: true, outcome: 'owned' };
    this.owned = mode === 'fake' ? this.fake.owned : mode === 'free' || cached();
    this.pending = false;
    this.price = null; // Play가 정한 그 나라 표시 가격(예: ₩3,300)
    this.reachable = null; // 이번 실행에 Play에 닿았는지(null: 아직 안 물어봄)
    this.busy = false;
    this.listeners = new Set();
    if (mode === 'native') this._plugin()?.addListener?.('purchase', (e) => {
      if (e?.product !== STORY_PRODUCT) return;
      this._set(!!e.owned, !!e.pending);
    });
  }

  _plugin() {
    this.plugin ??= globalThis.capacitorExports?.registerPlugin?.('Billing') ?? null;
    return this.plugin;
  }

  // 2~4장을 결제로 잠그는가(웹판·테스터용 빌드는 아니다)
  get available() {
    return this.mode === 'native' || this.mode === 'fake';
  }

  onChange(fn) {
    this.listeners.add(fn);
  }

  _set(owned, pending) {
    const changed = owned !== this.owned || pending !== this.pending;
    this.owned = owned;
    this.pending = pending;
    if (this.mode === 'native') save(KEY, JSON.stringify({ v: 1, story: owned }));
    if (changed) for (const fn of this.listeners) fn(this);
  }

  // Play에 구매 상태를 다시 묻는다(앱을 열 때·결제 화면을 열 때). 닿지 못하면 마지막으로 알던 상태를 그대로 둔다
  // (오프라인에서도 산 사람은 계속 하게). 환불·취소된 구매는 Play가 돌려주지 않아 여기서 다시 잠긴다.
  async refresh() {
    if (this.mode === 'fake') {
      this.price = '₩3,300';
      this.reachable = true;
      return { ok: true };
    }
    if (this.mode !== 'native') return { ok: false, error: 'none' };
    const plugin = this._plugin();
    if (!plugin) return { ok: false, error: 'plugin' };
    try {
      const r = await plugin.status({ product: STORY_PRODUCT });
      this.reachable = true;
      this.price = r.price ?? null;
      this._set(!!r.owned, !!r.pending);
      return { ok: true };
    } catch (err) {
      this.reachable = false;
      console.warn('[store] Play 결제 상태를 받지 못했습니다(마지막 상태를 씁니다).', err);
      return { ok: false, error: err?.code ?? 'error', message: err?.message };
    }
  }

  // 구매 창을 연다. 결과: 'owned' | 'pending' | 'canceled' | 'unavailable' | 'error' | 'busy'
  async buy() {
    if (this.busy) return { result: 'busy' };
    this.busy = true;
    try {
      let r;
      if (this.mode === 'fake') {
        await new Promise((ok) => setTimeout(ok, 120));
        r = { result: this.fake.outcome };
      } else if (this.mode === 'native' && this._plugin()) {
        r = await this._plugin().buy({ product: STORY_PRODUCT });
      } else {
        r = { result: 'error', message: '결제 기능이 없어요' };
      }
      if (r.result === 'owned') this._set(true, false);
      else if (r.result === 'pending') this._set(false, true);
      return r;
    } catch (err) {
      console.warn('[store] 구매 창 오류', err);
      return { result: 'error', message: err?.message };
    } finally {
      this.busy = false;
    }
  }
}
