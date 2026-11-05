import assert from 'node:assert/strict';
import {
  mergeAccountIndex,
  normalizeAccessControls,
  normalizeRegistryRecord,
  parseRegistryEvents
} from '../scripts/sync-account-index.mjs';

const nameHash = 'a'.repeat(64);
const baseRecord = {
  version: 1,
  nameHash,
  salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
  hash: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=',
  iterations: 310000,
  createdAt: '2026-11-05T10:00:00.000Z'
};

assert.deepEqual(normalizeRegistryRecord(baseRecord), baseRecord);
assert.equal(normalizeRegistryRecord({...baseRecord, nameHash: 'short'}), null);
assert.equal(normalizeRegistryRecord({...baseRecord, iterations: 100}), null);
assert.deepEqual(normalizeAccessControls({
  disabledAccounts: [nameHash, nameHash, 'invalid'],
  revokedCredentials: ['c'.repeat(64), 'c'.repeat(64), 'invalid']
}), {
  disabledAccounts: [nameHash],
  revokedCredentials: ['c'.repeat(64)]
});

const event = JSON.stringify({
  event: 'message',
  message: JSON.stringify(baseRecord)
});
assert.deepEqual(parseRegistryEvents(`{"event":"open"}\n${event}\ninvalid\n`), [baseRecord]);

const access = {
  disabledAccounts: [nameHash],
  revokedCredentials: ['c'.repeat(64)]
};
const first = mergeAccountIndex(
  {version: 1, updatedAt: null, accounts: {}, access},
  [baseRecord, baseRecord],
  '2026-11-05T10:01:00.000Z'
);
assert.equal(first.changed, true);
assert.equal(first.index.accounts[nameHash].length, 1);
assert.equal(first.index.updatedAt, '2026-11-05T10:01:00.000Z');
assert.deepEqual(first.index.access, access);

const secondRecord = {...baseRecord, salt: 'CCCCCCCCCCCCCCCCCCCCCC==', hash: 'D'.repeat(43) + '='};
const second = mergeAccountIndex(first.index, [secondRecord], '2026-11-05T10:02:00.000Z');
assert.equal(second.changed, true);
assert.equal(second.index.accounts[nameHash].length, 2);

const unchanged = mergeAccountIndex(second.index, [baseRecord], '2026-11-05T10:03:00.000Z');
assert.equal(unchanged.changed, false);
assert.equal(unchanged.index.updatedAt, '2026-11-05T10:02:00.000Z');
assert.deepEqual(unchanged.index.access, access);

console.log('Cross-device account index validation, access controls, relay parsing and idempotent merge passed.');
