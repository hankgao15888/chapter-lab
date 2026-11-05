import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const {
  ITERATIONS,
  normalizeStudentName,
  displayStudentName,
  validateStudentName,
  validateRegistration,
  accountNameHash,
  validRegistryRecord,
  parseRegistryIndex,
  derivePasswordHash
} = createRequire(import.meta.url)('../docs/auth.js');

assert.equal(normalizeStudentName('  Alex   Chen  '), 'alex chen');
assert.equal(normalizeStudentName('ＡＬＥＸ'), 'alex');
assert.equal(displayStudentName('  小明 <script>  同学  '), '小明 script 同学');
assert.equal(validateStudentName('A').ok, false);
assert.equal(validateStudentName('Alex Chen').ok, true);
assert.equal(Array.from(validateStudentName('学'.repeat(25)).value).length, 24);

assert.equal(validateRegistration('Alex', 'short', 'short').ok, false);
assert.equal(validateRegistration('Alex', 'long-enough-password', 'different').ok, false);
assert.deepEqual(validateRegistration('  Alex Chen  ', 'correct horse battery', 'correct horse battery'), {
  ok: true,
  name: 'Alex Chen'
});

const salt = new Uint8Array(16).fill(7);
const first = await derivePasswordHash('correct horse battery', salt, ITERATIONS);
const second = await derivePasswordHash('correct horse battery', salt, ITERATIONS);
const wrong = await derivePasswordHash('wrong password', salt, ITERATIONS);
assert.equal(first.length, 32);
assert.deepEqual(first, second);
assert.notDeepEqual(first, wrong);
assert.notDeepEqual(first, new Uint8Array(32).fill(7));

const nameHash = await accountNameHash('  Alex   Chen  ');
assert.match(nameHash, /^[a-f0-9]{64}$/);
assert.equal(nameHash, await accountNameHash('alex chen'));
assert.notEqual(nameHash, await accountNameHash('Alex Chen 2'));

const record = {
  version: 1,
  nameHash,
  salt: bytesToBase64ForTest(salt),
  hash: bytesToBase64ForTest(first),
  iterations: ITERATIONS,
  createdAt: '2026-11-05T10:00:00.000Z'
};
assert.equal(validRegistryRecord(record), true);
assert.equal(validRegistryRecord({...record, nameHash: 'short'}), false);
const parsedIndex = parseRegistryIndex({version: 1, updatedAt: null, accounts: {[nameHash]: [record]}});
assert.deepEqual(parsedIndex.accounts[nameHash], [record]);

function bytesToBase64ForTest(bytes) {
  return Buffer.from(bytes).toString('base64');
}

console.log('Student-name validation, PBKDF2 derivation and cross-device index parsing passed.');
