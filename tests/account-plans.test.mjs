import assert from 'node:assert/strict';
import { loadAccountSubjectPlan, saveAccountSubjectPlan } from '../web/account-plans.js';
const initial = [{ code: 'IMJ47403', section: 'Y4G1' }, { code: 'IMJ21303', section: 'Y2G1' }];
const cache = new Map([['studyhub.subject-plan.v1.alice', JSON.stringify(initial)]]);
const storage = { getItem: (key) => cache.get(key), setItem: (key, value) => cache.set(key, value) };
const rows = new Map(), writes = [];
let failure = null, conflict = false;
const client = { from(table) {
  assert.equal(table, 'subject_plans');
  let uid;
  return {
    select() { return this; }, eq(key, value) { assert.equal(key, 'user_id'); uid = value; return this; },
    async maybeSingle() { return { data: rows.has(uid) ? { subjects: rows.get(uid) } : null, error: failure }; },
    async insert(row) {
      if (conflict) { conflict = false; rows.set(row.user_id, []); return { error: { code: '23505' } }; }
      if (failure) return { error: failure };
      writes.push(row); rows.set(row.user_id, row.subjects); return { error: null };
    },
    async upsert(row) { if (failure) return { error: failure }; writes.push(row); rows.set(row.user_id, row.subjects); return { error: null }; },
  };
} };
assert.deepEqual(await loadAccountSubjectPlan(client, storage, 'alice'), initial, 'imports both legacy subjects');
assert.equal(writes.length, 1);
assert.deepEqual(await loadAccountSubjectPlan(client, null, 'alice'), initial, 'admin can load another account without local storage');
assert.deepEqual(await loadAccountSubjectPlan(client, null, 'bob'), []);
assert.equal(writes.length, 1, 'admin read never writes');
await saveAccountSubjectPlan(client, storage, 'alice', []);
cache.set('studyhub.subject-plan.v1.alice', JSON.stringify(initial));
assert.deepEqual(await loadAccountSubjectPlan(client, storage, 'alice'), [], 'cleared cloud plan does not resurrect stale device subjects');
rows.delete('alice'); conflict = true;
assert.deepEqual(await loadAccountSubjectPlan(client, storage, 'alice'), [], 'concurrent migration keeps the already saved cloud plan');
failure = { message: 'permission denied' };
const priorCache = cache.get('studyhub.subject-plan.v1.alice');
await assert.rejects(saveAccountSubjectPlan(client, storage, 'alice', initial), /permission denied/);
assert.equal(cache.get('studyhub.subject-plan.v1.alice'), priorCache, 'failed writes do not alter the local cache');
await assert.rejects(loadAccountSubjectPlan(client, null, 'alice'), /permission denied/, 'read failures are explicit');
console.log('ALL ACCOUNT PLAN SYNC TESTS PASSED');
