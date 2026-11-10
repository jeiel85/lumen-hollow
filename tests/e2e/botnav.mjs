// 측정 봇(autoplay.mjs·chapterplay.mjs)이 페이지에 넣어 쓰는 격자 길찾기. 문자열(toString)로 넣으므로 바깥 이름을 쓰지 않는다.
// G: { x0, z0, nx, nz, cell, blocked(Uint8Array, 칸 번호 = i * nz + j) } — 칸 (i, j)의 자리는 (x0 + i·cell, z0 + j·cell).
// 다익스트라(8방향, 막힌 칸 모서리는 자르지 않음)로 출발 칸에서 모든 칸까지 거리를 한 번에 구하고, 길은 보이는 데까지 곧게 편다.
export function navKit(G) {
  const { x0, z0, nx, nz, cell, blocked } = G;
  const N = nx * nz;
  const idxOf = (x, z) => {
    const i = Math.round((x - x0) / cell);
    const j = Math.round((z - z0) / cell);
    return i < 0 || j < 0 || i >= nx || j >= nz ? -1 : i * nz + j;
  };
  const kx = (k) => x0 + Math.floor(k / nz) * cell;
  const kz = (k) => z0 + (k % nz) * cell;
  // (x, z)에서 rad 안의 막히지 않은(ok도 만족하는) 가장 가까운 칸, 없으면 -1
  function freeNear(x, z, rad, ok) {
    let best = -1;
    let bd = rad * rad;
    for (let i = Math.max(0, Math.floor((x - rad - x0) / cell)); i <= Math.min(nx - 1, Math.ceil((x + rad - x0) / cell)); i++) {
      for (let j = Math.max(0, Math.floor((z - rad - z0) / cell)); j <= Math.min(nz - 1, Math.ceil((z + rad - z0) / cell)); j++) {
        const k = i * nz + j;
        if (blocked[k] || (ok && !ok(k))) continue;
        const d = (x0 + i * cell - x) ** 2 + (z0 + j * cell - z) ** 2;
        if (d <= bd) {
          bd = d;
          best = k;
        }
      }
    }
    return best;
  }
  // 거리는 Float64로 둔다(Float32면 반올림 때문에 꺼낸 거리가 저장한 거리보다 커 보여 건너뛰면서 몇 칸에서 멈춘다).
  const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  function dijkstra(sources) {
    const dist = new Float64Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1);
    const hk = [];
    const hp = [];
    const push = (k, p) => {
      let i = hk.length;
      hk.push(k);
      hp.push(p);
      while (i > 0) {
        const q = (i - 1) >> 1;
        if (hp[q] <= p) break;
        hk[i] = hk[q];
        hp[i] = hp[q];
        i = q;
      }
      hk[i] = k;
      hp[i] = p;
    };
    const pop = () => {
      const k = hk[0];
      const p = hp[0];
      const lk = hk.pop();
      const lp = hp.pop();
      if (hk.length) {
        let i = 0;
        for (;;) {
          let c = 2 * i + 1;
          if (c >= hk.length) break;
          if (c + 1 < hk.length && hp[c + 1] < hp[c]) c++;
          if (hp[c] >= lp) break;
          hk[i] = hk[c];
          hp[i] = hp[c];
          i = c;
        }
        hk[i] = lk;
        hp[i] = lp;
      }
      return [k, p];
    };
    for (const s of sources) {
      if (s >= 0 && !blocked[s]) {
        dist[s] = 0;
        push(s, 0);
      }
    }
    while (hk.length) {
      const [k, d] = pop();
      if (d > dist[k]) continue;
      const i = (k / nz) | 0;
      const j = k - i * nz;
      for (const [di, dj, c] of DIRS) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
        const nk = ni * nz + nj;
        if (blocked[nk] || (di && dj && (blocked[i * nz + nj] || blocked[ni * nz + j]))) continue;
        const nd = d + c * cell;
        if (nd < dist[nk]) {
          dist[nk] = nd;
          prev[nk] = k;
          push(nk, nd);
        }
      }
    }
    return { dist, prev };
  }
  function los(ax, az, bx, bz) {
    const s = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (cell * 0.4)));
    for (let t = 0; t <= s; t++) {
      const k = idxOf(ax + ((bx - ax) * t) / s, az + ((bz - az) * t) / s);
      if (k < 0 || blocked[k]) return false;
    }
    return true;
  }
  // 출발 칸에서 퍼진 장(field)으로 goal까지 가는 길을 곧게 편 점들
  function pathTo(field, goal) {
    const cells = [];
    for (let k = goal; k >= 0; k = field.prev[k]) cells.push(k);
    cells.reverse();
    const pts = [];
    for (let i = 0; i < cells.length - 1;) {
      let j = Math.min(cells.length - 1, i + 80);
      while (j > i + 1 && !los(kx(cells[i]), kz(cells[i]), kx(cells[j]), kz(cells[j]))) j--;
      pts.push({ x: kx(cells[j]), z: kz(cells[j]) });
      i = j;
    }
    return pts;
  }
  return { idxOf, kx, kz, freeNear, dijkstra, pathTo };
}
