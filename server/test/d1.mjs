// 테스트용 D1 대역: Node 내장 SQLite(node:sqlite)로 D1 API 중 app.js가 쓰는 부분만 흉내 낸다.
// prepare().bind().first()/all()/run(), batch()(한 트랜잭션). 외래 키는 켠다.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const SCHEMA = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');

// latency: 실제 D1처럼 각 호출이 다음 틱에 응답하게 한다(동시 요청이 서로 끼어드는 상황을 재현할 때).
export function createD1({ latency = false } = {}) {
  const tick = () => (latency ? new Promise((r) => setImmediate(r)) : null);
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);

  class Stmt {
    constructor(sql, params = []) {
      this.sql = sql;
      this.params = params;
    }

    bind(...params) {
      return new Stmt(this.sql, params);
    }

    // ?1, ?2 … 번호 매개변수는 같은 번호를 여러 번 써도 하나의 값으로 묶인다.
    _exec() {
      const s = db.prepare(this.sql);
      if (s.columns().length > 0) return { results: s.all(...this.params), success: true, meta: {} };
      const r = s.run(...this.params);
      return { results: [], success: true, meta: { changes: Number(r.changes) } };
    }

    async first() {
      await tick();
      return this._exec().results[0] ?? null;
    }

    async all() {
      await tick();
      return this._exec();
    }

    async run() {
      await tick();
      return this._exec();
    }
  }

  return {
    raw: db,
    prepare: (sql) => new Stmt(sql),
    async batch(stmts) {
      await tick();
      db.exec('BEGIN');
      try {
        const out = stmts.map((s) => s._exec());
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  };
}
