import assert from 'node:assert/strict';
import {FakeD1} from './fake-d1.mjs';
import {
  ITERATIONS,
  derivePasswordHash,
  displayStudentName,
  equalBytes,
  normalizeStudentName,
  validateCredentials,
  validateStudentName
} from '../worker/index.js';
import worker from '../worker/index.js';

assert.equal(normalizeStudentName('  Alex   Chen  '), 'alex chen');
assert.equal(normalizeStudentName('ＡＬＥＸ'), 'alex');
assert.equal(displayStudentName('  小明 <script>  同学  '), '小明 script 同学');
assert.equal(validateStudentName('A').ok, false);
assert.equal(validateStudentName('Alex Chen').ok, true);
assert.equal(Array.from(validateStudentName('学'.repeat(25)).value).length, 24);

assert.equal(validateCredentials('A', 'long-enough-password').ok, false);
assert.equal(validateCredentials('Alex', 'short').ok, false);
assert.deepEqual(validateCredentials('  Alex Chen  ', 'correct horse battery'), {
  ok: true,
  name: 'Alex Chen',
  normalizedName: 'alex chen'
});

const salt = new Uint8Array(16).fill(7);
const first = await derivePasswordHash('correct horse battery', salt, ITERATIONS);
const second = await derivePasswordHash('correct horse battery', salt, ITERATIONS);
const wrong = await derivePasswordHash('wrong password', salt, ITERATIONS);
assert.equal(first.length, 32);
assert.deepEqual(first, second);
assert.notDeepEqual(first, wrong);
assert.equal(equalBytes(first, second), true);
assert.equal(equalBytes(first, wrong), false);

const db = new FakeD1();
const env = {DB: db};
const allowedOrigin = 'https://hankgao15888.github.io';

async function call(path, options = {}) {
  const headers = {
    Origin: options.origin || allowedOrigin,
    ...(options.body ? {'Content-Type': 'application/json'} : {}),
    ...(options.token ? {Authorization: 'Bearer ' + options.token} : {})
  };
  return worker.fetch(new Request('https://account.example' + path, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  }), env);
}

const health = await call('/api/health');
assert.equal(health.status, 200);
assert.equal((await health.json()).service, 'chapter-lab-account-api');

const blocked = await call('/api/health', {origin: 'https://attacker.example'});
assert.equal(blocked.status, 403);

const invalid = await call('/api/auth/register', {
  method: 'POST',
  body: {name: 'A', password: 'long-enough-password'}
});
assert.equal(invalid.status, 400);

const registered = await call('/api/auth/register', {
  method: 'POST',
  body: {name: 'Test Student', password: 'correct horse battery'}
});
assert.equal(registered.status, 201);
assert.equal(registered.headers.get('Access-Control-Allow-Origin'), allowedOrigin);
const registration = await registered.json();
assert.ok(registration.token);
assert.equal(registration.user.name, 'Test Student');

const duplicate = await call('/api/auth/register', {
  method: 'POST',
  body: {name: ' test   student ', password: 'another secure password'}
});
assert.equal(duplicate.status, 409);

const wrongPassword = await call('/api/auth/login', {
  method: 'POST',
  body: {name: 'TEST STUDENT', password: 'incorrect password'}
});
assert.equal(wrongPassword.status, 401);

const loggedIn = await call('/api/auth/login', {
  method: 'POST',
  body: {name: 'TEST STUDENT', password: 'correct horse battery'}
});
assert.equal(loggedIn.status, 200);
const login = await loggedIn.json();
assert.ok(login.token);

const restored = await call('/api/auth/session', {token: login.token});
assert.equal(restored.status, 200);
assert.equal((await restored.json()).user.name, 'Test Student');

const loggedOut = await call('/api/auth/logout', {method: 'POST', token: login.token});
assert.equal(loggedOut.status, 200);
const expired = await call('/api/auth/session', {token: login.token});
assert.equal(expired.status, 401);

console.log('Account API validation, PBKDF2, routing, CORS, login, session and logout passed.');
