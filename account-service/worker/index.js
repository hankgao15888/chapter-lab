const VERSION = '1.0.0';
export const ITERATIONS = 310000;
const SESSION_SECONDS = 12 * 60 * 60;
const MAX_BODY_BYTES = 4096;
const DUMMY_PASSWORD_SALT = new Uint8Array([
  37, 114, 93, 201, 8, 74, 162, 219, 55, 143, 21, 188, 97, 6, 230, 121
]);
const DEFAULT_ALLOWED_ORIGINS = [
  'https://hankgao15888.github.io',
  'http://localhost:8765',
  'http://127.0.0.1:8765'
];

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function displayStudentName(value) {
  return Array.from(
    String(value == null ? '' : value)
      .normalize('NFKC')
      .replace(/[\u0000-\u001f\u007f<>]/g, '')
      .trim()
      .replace(/\s+/g, ' ')
  ).slice(0, 24).join('');
}

export function normalizeStudentName(value) {
  return displayStudentName(value).toLocaleLowerCase('en-US');
}

export function validateStudentName(value) {
  const name = displayStudentName(value);
  const length = Array.from(name).length;
  return {
    ok: length >= 2 && length <= 24,
    value: name,
    message: length < 2 || length > 24 ? '学员名需为 2–24 个字符。' : ''
  };
}

export function validateCredentials(name, password) {
  const student = validateStudentName(name);
  if (!student.ok) return {ok: false, code: 'invalid_name', message: student.message};
  if (typeof password !== 'string' || password.length < 8) {
    return {ok: false, code: 'invalid_password', message: '密码至少需要 8 个字符。'};
  }
  if (password.length > 128) {
    return {ok: false, code: 'invalid_password', message: '密码不能超过 128 个字符。'};
  }
  return {ok: true, name: student.value, normalizedName: normalizeStudentName(student.value)};
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

export async function derivePasswordHash(password, salt, iterations = ITERATIONS) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const hash = await crypto.subtle.deriveBits(
    {name: 'PBKDF2', salt, iterations, hash: 'SHA-256'},
    key,
    256
  );
  return new Uint8Array(hash);
}

export async function sha256Bytes(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

async function sha256Hex(value) {
  return Array.from(await sha256Bytes(value), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function equalBytes(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) difference |= left[i] ^ right[i];
  return difference === 0;
}

function originAllowed(request, env) {
  const origin = request.headers.get('Origin') || '';
  const configured = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  return [...DEFAULT_ALLOWED_ORIGINS, ...configured].includes(origin);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': originAllowed(request, env) ? origin : DEFAULT_ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff'
  };
}

function jsonResponse(request, env, data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {...corsHeaders(request, env), ...extraHeaders}
  });
}

function errorResponse(request, env, error) {
  const status = Number.isInteger(error.status) ? error.status : 500;
  const code = error.code || 'server_error';
  const message = error.status ? error.message : '服务器暂时无法处理请求，请稍后重试。';
  if (!error.status) console.error('Unhandled account API error', error);
  return jsonResponse(request, env, {ok: false, code, error: message}, status);
}

async function readJsonBody(request) {
  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > MAX_BODY_BYTES) throw new ApiError(413, 'body_too_large', '请求内容过大。');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new ApiError(413, 'body_too_large', '请求内容过大。');
  }
  try {
    const value = JSON.parse(text || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value;
  } catch {
    throw new ApiError(400, 'invalid_json', '请求格式不正确。');
  }
}

function bearerToken(request) {
  const header = request.headers.get('Authorization') || '';
  const match = /^Bearer\s+([A-Za-z0-9_-]{32,128})$/.exec(header);
  return match ? match[1] : '';
}

async function enforceRateLimit(request, env, action, limit, windowSeconds) {
  if (!env.DB) throw new Error('Missing D1 binding DB');
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - windowSeconds;
  const ip = request.headers.get('CF-Connecting-IP') || 'unavailable';
  const rateKey = await sha256Hex(action + '\0' + ip);
  const result = await env.DB.prepare(
    `INSERT INTO auth_rate_limits (rate_key, attempts, window_start)
     VALUES (?1, 1, ?2)
     ON CONFLICT(rate_key) DO UPDATE SET
       attempts = CASE
         WHEN auth_rate_limits.window_start <= ?3 THEN 1
         ELSE auth_rate_limits.attempts + 1
       END,
       window_start = CASE
         WHEN auth_rate_limits.window_start <= ?3 THEN ?2
         ELSE auth_rate_limits.window_start
       END
     RETURNING attempts`
  ).bind(rateKey, now, cutoff).first();
  await env.DB.prepare(
    'DELETE FROM auth_rate_limits WHERE window_start < ?1'
  ).bind(now - 24 * 60 * 60).run();
  if (result && Number(result.attempts) > limit) {
    throw new ApiError(429, 'rate_limited', '尝试次数过多，请稍后再试。');
  }
}

async function createSession(env, userId) {
  const token = bytesToBase64Url(randomBytes(32));
  const tokenHash = await sha256Hex(token);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + SESSION_SECONDS;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?1').bind(now),
    env.DB.prepare(
      'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)'
    ).bind(tokenHash, userId, now, expiresAt)
  ]);
  return {token, expiresAt};
}

async function findSession(request, env) {
  const token = bearerToken(request);
  if (!token) throw new ApiError(401, 'unauthenticated', '登录会话不存在或已过期。');
  const tokenHash = await sha256Hex(token);
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    `SELECT users.id, users.display_name, sessions.expires_at
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ?1 AND sessions.expires_at > ?2`
  ).bind(tokenHash, now).first();
  if (!row) throw new ApiError(401, 'unauthenticated', '登录会话不存在或已过期。');
  return {token, tokenHash, user: row, expiresAt: Number(row.expires_at)};
}

async function register(request, env) {
  await enforceRateLimit(request, env, 'register', 5, 60 * 60);
  const body = await readJsonBody(request);
  const validation = validateCredentials(body.name, body.password);
  if (!validation.ok) throw new ApiError(400, validation.code, validation.message);

  let existing = await env.DB.prepare(
    'SELECT id FROM users WHERE normalized_name = ?1'
  ).bind(validation.normalizedName).first();
  if (existing) throw new ApiError(409, 'account_exists', '这个学员名已经存在，请直接登录。');

  const salt = randomBytes(16);
  const hash = await derivePasswordHash(body.password, salt, ITERATIONS);
  const now = Math.floor(Date.now() / 1000);
  const userId = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO users
       (id, display_name, normalized_name, password_hash, password_salt, iterations, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`
    ).bind(
      userId,
      validation.name,
      validation.normalizedName,
      bytesToBase64Url(hash),
      bytesToBase64Url(salt),
      ITERATIONS,
      now
    ).run();
  } catch (error) {
    const text = String(error && error.message || error);
    if (/UNIQUE|constraint/i.test(text)) {
      throw new ApiError(409, 'account_exists', '这个学员名已经存在，请直接登录。');
    }
    throw error;
  }
  const session = await createSession(env, userId);
  return jsonResponse(request, env, {
    ok: true,
    token: session.token,
    expiresAt: session.expiresAt,
    user: {name: validation.name}
  }, 201);
}

async function login(request, env) {
  await enforceRateLimit(request, env, 'login', 12, 10 * 60);
  const body = await readJsonBody(request);
  const validation = validateCredentials(body.name, body.password);
  if (!validation.ok) throw new ApiError(400, validation.code, validation.message);
  const user = await env.DB.prepare(
    `SELECT id, display_name, password_hash, password_salt, iterations
     FROM users WHERE normalized_name = ?1`
  ).bind(validation.normalizedName).first();
  if (!user) {
    await derivePasswordHash(body.password, DUMMY_PASSWORD_SALT, ITERATIONS);
    throw new ApiError(401, 'invalid_credentials', '学员名或密码不正确。');
  }

  const iterations = Number(user.iterations);
  if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 1000000) {
    throw new Error('Invalid password verifier metadata');
  }
  const actual = await derivePasswordHash(
    body.password,
    base64UrlToBytes(user.password_salt),
    iterations
  );
  if (!equalBytes(actual, base64UrlToBytes(user.password_hash))) {
    throw new ApiError(401, 'invalid_credentials', '学员名或密码不正确。');
  }
  const session = await createSession(env, user.id);
  return jsonResponse(request, env, {
    ok: true,
    token: session.token,
    expiresAt: session.expiresAt,
    user: {name: user.display_name}
  });
}

async function session(request, env) {
  const current = await findSession(request, env);
  return jsonResponse(request, env, {
    ok: true,
    expiresAt: current.expiresAt,
    user: {name: current.user.display_name}
  });
}

async function logout(request, env) {
  let tokenHash = '';
  try {
    tokenHash = (await findSession(request, env)).tokenHash;
  } catch {}
  if (tokenHash) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(tokenHash).run();
  }
  return jsonResponse(request, env, {ok: true});
}

async function health(request, env) {
  if (!env.DB) throw new Error('Missing D1 binding DB');
  await env.DB.prepare('SELECT 1 AS ready').first();
  return jsonResponse(request, env, {
    ok: true,
    service: 'chapter-lab-account-api',
    version: VERSION
  });
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (!originAllowed(request, env)) {
        throw new ApiError(403, 'origin_not_allowed', '这个站点不能使用账号服务。');
      }
      if (request.method === 'OPTIONS') {
        return new Response(null, {status: 204, headers: corsHeaders(request, env)});
      }
      if (request.method === 'GET' && url.pathname === '/api/health') return await health(request, env);
      if (request.method === 'POST' && url.pathname === '/api/auth/register') return await register(request, env);
      if (request.method === 'POST' && url.pathname === '/api/auth/login') return await login(request, env);
      if (request.method === 'GET' && url.pathname === '/api/auth/session') return await session(request, env);
      if (request.method === 'POST' && url.pathname === '/api/auth/logout') return await logout(request, env);
      if (url.pathname.startsWith('/api/auth/') || url.pathname === '/api/health') {
        throw new ApiError(405, 'method_not_allowed', '请求方法不受支持。');
      }
      return jsonResponse(request, env, {
        ok: true,
        service: 'Chapter Lab Account API',
        version: VERSION
      });
    } catch (error) {
      return errorResponse(request, env, error);
    }
  }
};
