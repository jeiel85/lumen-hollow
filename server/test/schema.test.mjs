// 스키마와 마이그레이션이 어긋나지 않는지, 대시보드 조회가 표를 통째로 훑지 않는지 확인한다(이슈 #30).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createApp } from '../src/app.js';
import { createAdmin } from '../src/admin.js';
import { createD1 } from './d1.mjs';

const dir = new URL('../migrations/', import.meta.url);
const migrations = readdirSync(dir).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
const read = (name) => readFileSync(new URL(name, dir), 'utf8');
const SCHEMA = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');

// 표·색인 이름과 정의. 공백·주석 차이는 무시한다(SQLite가 저장하는 원문에는 주석도 남으므로 지우고 비교).
function shape(db) {
  const norm = (sql) => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').trim();
  return db.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type, name").all()
    .map((r) => `${r.type} ${r.name}: ${norm(r.sql)}`);
}

test('마이그레이션 파일 이름은 0000부터 빈 번호 없이 이어진다', () => {
  assert.deepEqual(migrations.map((f) => Number(f.slice(0, 4))), migrations.map((_, i) => i));
});

test('migrations/를 차례로 적용한 결과가 schema.sql과 같다', () => {
  const fresh = new DatabaseSync(':memory:');
  fresh.exec(SCHEMA);
  const migrated = new DatabaseSync(':memory:');
  for (const f of migrations) migrated.exec(read(f));
  assert.deepEqual(shape(migrated), shape(fresh));
});

test('마이그레이션은 다시 적용해도(이미 schema.sql로 만든 D1 포함) 오류 없이 바뀌는 것이 없다', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.exec("UPDATE settings SET value = 'false' WHERE key = 'enabled'");
  const before = shape(db);
  for (const f of migrations) db.exec(read(f));
  for (const f of migrations) db.exec(read(f));
  assert.deepEqual(shape(db), before);
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'enabled'").get().value, 'false', '킬 스위치 값을 덮어쓰지 않는다');
});

// 대시보드 조회 한 번에 보낸 문장을 모두 모아 실행 계획을 본다. 'SCAN <표>'는 표(또는 색인) 전체를 읽는다는 뜻이다.
// cron_runs는 30행으로 묶여 있어 훑어도 된다. 'SCAN (subquery-N)'은 이미 색인으로 거른 중간 결과를 읽는 것이라 뺀다.
test('대시보드 조회와 게임 목록 조회는 기록 표를 통째로 훑지 않는다(색인을 쓴다)', async () => {
  const db = createD1();
  const sent = [];
  const spy = { ...db, batch: (stmts) => { for (const s of stmts) sent.push(s); return db.batch(stmts); } };
  const now = Date.UTC(2026, 10, 8, 12);
  const admin = createAdmin({ now: () => now });
  const res = await admin.fetch(new Request('https://admin.test/api/summary?range=7d', { headers: { Authorization: `Bearer ${'t'.repeat(40)}` } }),
    { DB: spy, ADMIN_TOKEN: 't'.repeat(40), LAUNCH_AT: '2026-11-06T05:35:17Z' });
  assert.equal(res.status, 200);
  assert.ok(sent.length >= 16);

  const game = createApp({ now: () => now });
  const listed = [];
  const spyPrepare = { ...db, prepare: (sql) => { const s = db.prepare(sql); listed.push(sql); return s; } };
  const rl = { limit: async () => ({ success: true }) };
  await game.fetch(new Request('https://api.test/v1/caches?layout=1'), { DB: spyPrepare, IP_HASH_SECRET: 'x', RL_READ: rl, RL_WRITE: rl });
  const listSql = listed.find((sql) => sql.includes('FROM caches'));
  assert.ok(listSql);

  const plans = [...sent.map((s) => [s.sql, s.params]), [listSql, [1, now, 400]]].map(([sql, params]) => ({
    sql: sql.replace(/\s+/g, ' ').slice(0, 120),
    plan: db.raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map((r) => r.detail),
  }));
  const scans = plans.flatMap((p) => p.plan.filter((d) => /^SCAN (?!cron_runs\b|CONSTANT ROW|\(subquery-)/.test(d)).map((d) => `${d}  ← ${p.sql}`));
  assert.deepEqual(scans, []);
  // 색인이 실제로 쓰이는지(이름으로)도 본다. 마이그레이션 0001에서 빠지면 여기서 드러난다.
  const used = plans.flatMap((p) => p.plan).join('\n');
  for (const index of ['caches_created', 'caches_live_expiry', 'thanks_at', 'uses_time']) assert.match(used, new RegExp(`INDEX ${index}\\b`), index);
});
