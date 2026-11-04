import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const {
  ITERATIONS,
  normalizeStudentName,
  displayStudentName,
  validateStudentName,
  validateRegistration,
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

console.log('Student name normalization, registration validation and salted PBKDF2 password derivation passed.');
