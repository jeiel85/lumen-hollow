import { ZONE_GRID } from './world.js';
import { tr } from './i18n.js';

const $ = (id) => document.getElementById(id);

// 배전반: 고친 구역 가운데 오늘 밤 불을 켤 곳을 고른다. 변전소 출력만큼만 켤 수 있고,
// 은신처는 자체 발전기로 늘 켜져 있어 출력을 쓰지 않는다.
// 마름모 지도는 게임 화면과 같은 방향(북쪽이 오른쪽 위)으로 돌려 그려서 어느 동네인지 바로 맞춰 볼 수 있게 한다.

function stateOf(z) {
  if (!z.powered) return 'dead';
  if (z.tripped && (z.on || z.id === 'H')) return 'tripped';
  if (z.id === 'H') return 'home';
  return z.on ? 'on' : 'off';
}

function describe(z) {
  const pct = Math.round(z.load * 100);
  switch (stateOf(z)) {
    case 'dead': return tr('퓨즈가 필요하다');
    case 'tripped': return z.id === 'H' ? tr('차단됨 · 발전기에서 올리기') : tr('차단됨 · 배전함에서 올리기');
    case 'off': return z.tripped ? tr('꺼 둠 · 차단기 내려감') : tr('꺼 둠');
    case 'home': return pct >= 5 ? tr('자체 발전기 · 부하 {0}%', [pct]) : tr('자체 발전기 · 늘 켜짐');
    case 'on': return pct >= 5 ? tr('켜짐 · 부하 {0}%', [pct]) : tr('켜짐');
    default: return '';
  }
}

export class Switchboard {
  constructor(world, { onToggle } = {}) {
    this.world = world;
    this.onToggle = onToggle;
    this.here = null;
    this.el = { cap: $('grid-cap'), map: $('grid-map'), list: $('grid-list'), msg: $('grid-msg') };
    this.cells = {};
    this.rows = {};
    for (const line of ZONE_GRID) {
      for (const id of line) {
        const cell = document.createElement('div');
        cell.className = 'gcell';
        cell.addEventListener('click', () => this._toggle(id));
        this.el.map.appendChild(cell);
        this.cells[id] = cell;

        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'zone-row';
        const name = document.createElement('span');
        name.className = 'zname';
        name.textContent = world.zones[id].name;
        const state = document.createElement('span');
        state.className = 'zstate';
        row.append(name, state);
        row.addEventListener('click', () => this._toggle(id));
        this.el.list.appendChild(row);
        this.rows[id] = { row, state };
      }
    }
  }

  open(here) {
    this.here = here;
    this.el.msg.textContent = '';
    // 고를 수 있는 구역(고친 곳)을 위로, 은신처, 아직 못 고친 곳 순서로 줄 세운다. 같은 묶음 안에서는 지도 순서.
    const w = this.world;
    const rank = (id) => (id === 'H' ? 1 : w.zones[id].powered ? 0 : 2);
    const order = ZONE_GRID.join('').split('');
    order.sort((a, b) => rank(a) - rank(b) || ZONE_GRID.join('').indexOf(a) - ZONE_GRID.join('').indexOf(b));
    for (const id of order) this.el.list.appendChild(this.rows[id].row);
    this.render();
  }

  render() {
    const w = this.world;
    const full = w.repairedCount >= w.totalZones - 1;
    this.el.cap.textContent = tr('변전소 출력 {0} / {1}곳 사용 중 · {2}', [w.onCount, w.capacity, full ? tr('변전소가 제 출력을 되찾았다') : tr('배전함을 3곳 고칠 때마다 1곳씩 늘어난다')]);
    for (const id of Object.keys(this.cells)) {
      const z = w.zones[id];
      const st = stateOf(z);
      const here = id === this.here;
      this.cells[id].className = `gcell ${st}${here ? ' here' : ''}`;
      const { row, state } = this.rows[id];
      row.className = `zone-row ${st}${here ? ' here' : ''}`;
      state.textContent = describe(z);
      // 은신처와 고치지 않은 구역은 스위치가 아니다.
      const switchable = st === 'on' || st === 'off' || (st === 'tripped' && id !== 'H');
      row.disabled = !switchable;
      if (switchable) row.setAttribute('aria-pressed', String(z.on));
      else row.removeAttribute('aria-pressed');
    }
  }

  _toggle(id) {
    const w = this.world;
    const z = w.zones[id];
    if (!z.powered || id === 'H') return;
    if (!w.setSwitch(id, !z.on)) {
      this.el.msg.textContent = tr('출력이 모자라 {0}까지 켤 수 없다. 켜 둔 구역을 먼저 끄자.', [z.name]);
      return;
    }
    this.el.msg.textContent = '';
    this.onToggle?.(id, z.on);
    this.render();
  }
}
