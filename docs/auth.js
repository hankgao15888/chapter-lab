/* Chapter Lab cross-device student access gate. Passwords are never stored in plaintext. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }
  root.ChapterLabAuth = api;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', api.start, {once: true});
    } else {
      api.start();
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const VERSION = '1.10.0';
  const ACCOUNTS_KEY = 'chapterlab-device-accounts-v1';
  const SESSION_KEY = 'chapterlab-student-session-v1';
  const ACCESS_CACHE_KEY = 'chapterlab-access-controls-v1';
  const ITERATIONS = 310000;
  const REGISTRY_TIMEOUT_MS = 8000;
  const REGISTRY_INDEX_URL = 'accounts-index.json';
  const REGISTRY_RELAY_BASE = 'https://ntfy.sh';
  const REGISTRY_TOPIC = 'chapterlab-account-registry-83f5c2a7';
  const APP_SCRIPTS = [
    'online.js',
    'data.js',
    'catalog-utils.js',
    'selection.js',
    'question-geometry.js',
    'question-renderer.js',
    'catalog-loader.js',
    'answers.js',
    'study-room.js',
    'app.js'
  ];
  let authenticated = false;
  let currentStudent = '';
  let applicationPromise = null;
  let authMode = 'cloud';

  function normalizeStudentName(value) {
    return displayStudentName(value).toLocaleLowerCase('en-US');
  }

  function displayStudentName(value) {
    return Array.from(
      String(value == null ? '' : value)
        .normalize('NFKC')
        .replace(/[\u0000-\u001f\u007f<>]/g, '')
        .trim()
        .replace(/\s+/g, ' ')
    ).slice(0, 24).join('');
  }

  function validateStudentName(value) {
    const name = displayStudentName(value);
    const length = Array.from(name).length;
    return {
      ok: length >= 2 && length <= 24,
      value: name,
      message: length < 2 || length > 24 ? '学员名需为 2–24 个字符。' : ''
    };
  }

  function validateRegistration(name, password, confirmation) {
    const student = validateStudentName(name);
    if (!student.ok) return {ok: false, message: student.message};
    if (typeof password !== 'string' || password.length < 8) {
      return {ok: false, message: '密码至少需要 8 个字符。'};
    }
    if (password.length > 128) return {ok: false, message: '密码不能超过 128 个字符。'};
    if (password !== confirmation) return {ok: false, message: '两次输入的密码不一致。'};
    return {ok: true, name: student.value};
  }

  function bytesToBase64(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function bytesToHex(bytes) {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function sha256Hex(value) {
    const digest = await root.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return bytesToHex(new Uint8Array(digest));
  }

  function randomBytes(length) {
    const bytes = new Uint8Array(length);
    root.crypto.getRandomValues(bytes);
    return bytes;
  }

  async function derivePasswordHash(password, salt, iterations, subtle) {
    const cryptoApi = subtle || root.crypto.subtle;
    const source = new TextEncoder().encode(password);
    const key = await cryptoApi.importKey('raw', source, 'PBKDF2', false, ['deriveBits']);
    const hash = await cryptoApi.deriveBits(
      {name: 'PBKDF2', salt, iterations, hash: 'SHA-256'},
      key,
      256
    );
    return new Uint8Array(hash);
  }

  async function accountNameHash(name) {
    return sha256Hex('chapterlab-name-v1\0' + normalizeStudentName(name));
  }

  function validRegistryRecord(record) {
    return Boolean(
      record
      && record.version === 1
      && /^[a-f0-9]{64}$/.test(record.nameHash || '')
      && typeof record.salt === 'string'
      && record.salt.length >= 16
      && record.salt.length <= 128
      && typeof record.hash === 'string'
      && record.hash.length >= 32
      && record.hash.length <= 128
      && Number.isInteger(record.iterations)
      && record.iterations >= 100000
      && record.iterations <= 1000000
      && Number.isFinite(Date.parse(record.createdAt || ''))
    );
  }

  function emptyRegistryIndex() {
    return {
      version: 1,
      updatedAt: null,
      accounts: {},
      access: {disabledAccounts: [], revokedCredentials: []}
    };
  }

  function normalizeAccessControls(value) {
    const access = value && typeof value === 'object' ? value : {};
    const uniqueHashes = (items, predicate) => [
      ...new Set(
        (Array.isArray(items) ? items : [])
          .map(item => String(item || '').toLowerCase())
          .filter(item => predicate.test(item))
      )
    ].sort();
    return {
      disabledAccounts: uniqueHashes(access.disabledAccounts, /^[a-f0-9]{64}$/),
      revokedCredentials: uniqueHashes(access.revokedCredentials, /^[a-f0-9]{64}$/)
    };
  }

  function parseRegistryIndex(payload) {
    if (!payload || payload.version !== 1 || !payload.accounts || typeof payload.accounts !== 'object') {
      throw new Error('本地账号索引格式不正确。');
    }
    const accounts = {};
    for (const [nameHash, records] of Object.entries(payload.accounts)) {
      if (!/^[a-f0-9]{64}$/.test(nameHash) || !Array.isArray(records)) continue;
      const valid = records.filter(validRegistryRecord);
      if (valid.length) accounts[nameHash] = valid;
    }
    return {
      version: 1,
      updatedAt: payload.updatedAt || null,
      accounts,
      access: normalizeAccessControls(payload.access)
    };
  }

  async function fetchRegistryIndex() {
    const response = await fetch(REGISTRY_INDEX_URL + '?t=' + Date.now(), {
      headers: {Accept: 'application/json'},
      cache: 'no-store'
    });
    if (response.status === 404) return emptyRegistryIndex();
    if (!response.ok) throw new Error('无法读取跨设备账号索引。');
    return parseRegistryIndex(await response.json());
  }

  async function queryRelayRecords(nameHash) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REGISTRY_TIMEOUT_MS);
    try {
      const response = await fetch(
        REGISTRY_RELAY_BASE + '/' + REGISTRY_TOPIC + '/json?poll=1&since=all',
        {headers: {Accept: 'application/x-ndjson'}, cache: 'no-store', signal: controller.signal}
      );
      if (!response.ok) throw new Error('relay_unavailable');
      const text = await response.text();
      const records = [];
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          const record = event && event.event === 'message' && typeof event.message === 'string'
            ? JSON.parse(event.message)
            : null;
          if (validRegistryRecord(record) && record.nameHash === nameHash) records.push(record);
        } catch {}
      }
      return records;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('relay_timeout');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function publishRegistryRecord(record) {
    if (!validRegistryRecord(record)) throw new Error('账号同步记录格式不正确。');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REGISTRY_TIMEOUT_MS);
    try {
      const response = await fetch(REGISTRY_RELAY_BASE + '/' + REGISTRY_TOPIC, {
        method: 'POST',
        headers: {'Content-Type': 'text/plain;charset=UTF-8', 'Cache': 'yes'},
        body: JSON.stringify(record),
        cache: 'no-store',
        signal: controller.signal
      });
      if (!response.ok) throw new Error('无法发布跨设备账号。请稍后重试。');
      const payload = await response.json();
      if (!payload || payload.event !== 'message' || !payload.id) {
        throw new Error('账号同步服务没有确认保存，请稍后重试。');
      }
      return payload;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('跨设备账号同步超时，请稍后重试。');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function verifyRegistryRecord(record, password) {
    if (!validRegistryRecord(record)) return false;
    const actual = await derivePasswordHash(
      password,
      base64ToBytes(record.salt),
      record.iterations
    );
    return equalBytes(actual, base64ToBytes(record.hash));
  }

  async function makeRegistryRecord(name, password) {
    const salt = randomBytes(16);
    const hash = await derivePasswordHash(password, salt, ITERATIONS);
    return {
      version: 1,
      nameHash: await accountNameHash(name),
      salt: bytesToBase64(salt),
      hash: bytesToBase64(hash),
      iterations: ITERATIONS,
      createdAt: new Date().toISOString()
    };
  }

  async function credentialFingerprint(record) {
    if (!validRegistryRecord(record)) return '';
    return sha256Hex(
      'chapterlab-credential-v1\0' + record.salt + '\0' + record.hash
    );
  }

  function equalBytes(left, right) {
    if (!left || !right || left.length !== right.length) return false;
    let difference = 0;
    for (let i = 0; i < left.length; i += 1) difference |= left[i] ^ right[i];
    return difference === 0;
  }

  function readAccounts(storage) {
    try {
      if (!storage) return {version: 1, accounts: {}};
      const parsed = JSON.parse(storage.getItem(ACCOUNTS_KEY) || '{}');
      if (parsed && parsed.version === 1 && parsed.accounts && typeof parsed.accounts === 'object') return parsed;
    } catch {}
    return {version: 1, accounts: {}};
  }

  function writeAccounts(storage, store) {
    if (!storage) throw new Error('浏览器禁止保存离线验证副本。');
    try {
      storage.setItem(ACCOUNTS_KEY, JSON.stringify(store));
    } catch {
      throw new Error('浏览器无法保存离线验证副本。请检查隐私设置或存储空间。');
    }
  }

  function readAccessCache(storage) {
    try {
      const parsed = JSON.parse(storage?.getItem(ACCESS_CACHE_KEY) || 'null');
      return normalizeAccessControls(parsed);
    } catch {
      return normalizeAccessControls(null);
    }
  }

  function writeAccessCache(storage, access) {
    try {
      if (storage) {
        storage.setItem(ACCESS_CACHE_KEY, JSON.stringify(normalizeAccessControls(access)));
      }
    } catch {}
  }

  function sessionFor(storage, key) {
    try {
      if (!storage) return null;
      const value = JSON.parse(storage.getItem(SESSION_KEY) || 'null');
      const age = Date.now() - Number(value && value.startedAt);
      if (value && value.key === key && age >= 0 && age < 12 * 60 * 60 * 1000) return value;
    } catch {}
    return null;
  }

  function browserStorage(name) {
    try {
      return root[name] || null;
    } catch {
      return null;
    }
  }

  function storeSession(storage, value) {
    if (!storage) throw new Error('浏览器禁止保存登录会话。请允许站点存储后重试。');
    try {
      storage.setItem(SESSION_KEY, JSON.stringify(value));
    } catch {
      throw new Error('浏览器无法保存登录会话。请检查隐私设置后重试。');
    }
  }

  function removeStoredSession(storage) {
    try {
      storage?.removeItem(SESSION_KEY);
    } catch {}
  }

  function setError(element, message) {
    if (element) element.textContent = message || '';
  }

  function setButton(button, busy, busyText, idleText) {
    if (!button) return;
    button.disabled = busy;
    button.textContent = busy ? busyText : idleText;
  }

  function scriptUrl(name) {
    return name + '?v=' + VERSION;
  }

  function loadApplication() {
    if (applicationPromise) return applicationPromise;
    applicationPromise = APP_SCRIPTS.reduce((chain, name) => chain.then(() => new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = scriptUrl(name);
      script.async = false;
      script.onload = resolve;
      script.onerror = () => reject(new Error('无法加载应用模块：' + name));
      document.body.appendChild(script);
    })), Promise.resolve()).catch(error => {
      applicationPromise = null;
      throw error;
    });
    return applicationPromise;
  }

  function updateSessionMode(mode) {
    authMode = mode;
    const element = document.getElementById('sessionMode');
    if (!element) return;
    element.textContent = mode === 'cloud' ? '跨设备' : '离线';
    element.dataset.mode = mode;
    element.title = mode === 'cloud'
      ? '账号已在跨设备索引中匹配，可在其他设备使用同一学员名和密码'
      : '当前设备正在离线使用已保存的账号验证副本';
  }

  function finishUnlock(name, mode) {
    currentStudent = name;
    authenticated = true;
    updateSessionMode(mode);
    const student = document.getElementById('sessionStudent');
    if (student) student.textContent = name;
    const boot = document.getElementById('authBoot');
    if (boot) boot.classList.remove('hidden');
    document.body.classList.remove('auth-locked', 'auth-ready');
    document.body.classList.add('auth-booting');
    const gate = document.getElementById('authGate');
    if (gate) gate.hidden = true;
    document.title = 'Chapter Lab · 分章练习、组卷与聊天自习室';
    return loadApplication().then(() => {
      document.body.classList.remove('auth-booting');
      document.body.classList.add('auth-ready');
      if (boot) boot.classList.add('hidden');
      accountNameHash(name).then(nameHash => {
        const session = JSON.parse(browserStorage('sessionStorage')?.getItem(SESSION_KEY) || 'null');
        return root.ChapterLabLoginActivity?.report(name, nameHash, session);
      }).catch(() => {});
    }).catch(error => {
      document.body.classList.remove('auth-booting');
      document.body.classList.add('auth-locked');
      if (boot) boot.classList.add('hidden');
      if (gate) gate.hidden = false;
      authenticated = false;
      currentStudent = '';
      throw error;
    });
  }

  async function verifyLocalAccount(account, password) {
    const iterations = Number.isInteger(account.iterations)
      && account.iterations >= 100000
      && account.iterations <= 1000000
      ? account.iterations
      : ITERATIONS;
    const hash = await derivePasswordHash(
      password,
      base64ToBytes(account.salt),
      iterations
    );
    return equalBytes(hash, base64ToBytes(account.hash));
  }

  function localRegistryRecord(account, nameHash) {
    return {
      version: 1,
      nameHash,
      salt: account.salt,
      hash: account.hash,
      iterations: Number(account.iterations || ITERATIONS),
      createdAt: account.createdAt || new Date().toISOString()
    };
  }

  function dedupeRegistryRecords(records) {
    const seen = new Set();
    return records.filter(record => {
      if (!validRegistryRecord(record)) return false;
      const key = record.salt + '\0' + record.hash;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async function registryRecordsFor(name) {
    const nameHash = await accountNameHash(name);
    let indexRecords = [];
    let relayRecords = [];
    let access = normalizeAccessControls(null);
    let unavailable = 0;
    try {
      const index = await fetchRegistryIndex();
      indexRecords = index.accounts[nameHash] || [];
      access = index.access;
      writeAccessCache(browserStorage('localStorage'), access);
    } catch {
      unavailable += 1;
      access = readAccessCache(browserStorage('localStorage'));
    }
    try {
      relayRecords = await queryRelayRecords(nameHash);
    } catch {
      unavailable += 1;
    }
    const revokedCredentials = new Set(access.revokedCredentials);
    const candidates = dedupeRegistryRecords([...indexRecords, ...relayRecords]);
    const records = [];
    for (const record of candidates) {
      if (revokedCredentials.has(await credentialFingerprint(record))) continue;
      records.push(record);
    }
    return {
      nameHash,
      records,
      rawRecordCount: candidates.length,
      accountDisabled: access.disabledAccounts.includes(nameHash),
      revokedCredentials,
      access,
      networkError: unavailable === 2
    };
  }

  async function cacheLocalVerifier(localStore, name, password, registryRecord) {
    const key = normalizeStudentName(name);
    const record = registryRecord || await makeRegistryRecord(name, password);
    if (!localStore) return record;
    try {
      const accounts = readAccounts(localStore);
      accounts.accounts[key] = {
        name: displayStudentName(name),
        nameHash: await accountNameHash(name),
        salt: record.salt,
        hash: record.hash,
        iterations: record.iterations,
        createdAt: record.createdAt,
        credentialId: await credentialFingerprint(record),
        cloudVerifiedAt: new Date().toISOString()
      };
      writeAccounts(localStore, accounts);
    } catch {
      /* The cross-device login remains valid if this browser refuses a fallback copy. */
    }
    return record;
  }

  function start() {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    if (!loginForm || !registerForm) return;
    if (!root.crypto || !root.crypto.subtle || typeof root.fetch !== 'function') {
      setError(document.getElementById('loginError'), '当前浏览器不支持安全账号验证，请升级浏览器后重试。');
      return;
    }
    const localStore = browserStorage('localStorage');
    const sessionStore = browserStorage('sessionStorage');
    let accounts = readAccounts(localStore);
    const accountCount = document.getElementById('accountCount');
    const accountHint = document.getElementById('accountHint');
    const cloudStatus = document.getElementById('cloudStatus');
    const updateAccountCount = () => {
      if (accountCount) accountCount.textContent = String(Object.keys(accounts.accounts).length);
    };
    const updateAccountHint = () => {
      if (!accountHint) return;
      const key = normalizeStudentName(document.getElementById('studentName')?.value || '');
      accountHint.textContent = key && accounts.accounts[key]
        ? '检测到本设备验证副本。登录后可离线使用，成功联网验证后可在其他设备继续。'
        : '新设备首次登录需要联网；账号建立后，同一学员名和密码可跨设备使用。';
    };
    updateAccountCount();
    updateAccountHint();
    if (cloudStatus) {
      const online = !root.navigator || root.navigator.onLine;
      cloudStatus.textContent = online ? '跨设备账号已启用' : '等待网络连接';
      cloudStatus.dataset.state = online ? 'ready' : 'offline';
    }
    if (!localStore || !sessionStore) {
      setError(
        document.getElementById('loginError'),
        '当前浏览器禁用了账号或会话存储。请允许本站使用浏览器存储后刷新页面。'
      );
    }

    const setMode = mode => {
      const registering = mode === 'register';
      loginForm.classList.toggle('hidden', registering);
      registerForm.classList.toggle('hidden', !registering);
      const title = document.getElementById('authTitle');
      const subtitle = document.getElementById('authSubtitle');
      if (title) title.textContent = registering ? '建立跨设备学员账号' : '学员登录';
      if (subtitle) {
        subtitle.textContent = registering
          ? '建立一次后，可在其他设备使用同一学员名和密码。'
          : '新设备首次登录需要联网匹配账号，旧账号会自动迁移。';
      }
      document.querySelectorAll('[data-auth-mode]').forEach(button => {
        const selected = button.dataset.authMode === mode;
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-selected', String(selected));
      });
      setError(document.getElementById('loginError'), '');
      setError(document.getElementById('registerError'), '');
      if (!registering) updateAccountHint();
    };

    document.querySelectorAll('[data-auth-mode]').forEach(button => {
      button.addEventListener('click', () => setMode(button.dataset.authMode));
    });
    document.querySelectorAll('[data-password-target]').forEach(button => {
      button.addEventListener('click', () => {
        const input = document.getElementById(button.dataset.passwordTarget);
        if (!input) return;
        const reveal = input.type === 'password';
        input.type = reveal ? 'text' : 'password';
        button.textContent = reveal ? '隐藏' : '显示';
        button.setAttribute('aria-label', reveal ? '隐藏密码' : '显示密码');
      });
    });
    document.getElementById('studentName')?.addEventListener('input', updateAccountHint);

    loginForm.addEventListener('submit', async event => {
      event.preventDefault();
      const nameInput = document.getElementById('studentName');
      const passwordInput = document.getElementById('studentPassword');
      const error = document.getElementById('loginError');
      const button = document.getElementById('loginButton');
      const validation = validateStudentName(nameInput.value);
      const key = normalizeStudentName(validation.value);
      const localAccount = accounts.accounts[key];
      setError(error, '');
      if (!validation.ok) {
        setError(error, validation.message || '请输入学员名和密码。');
        return;
      }
      if (!passwordInput.value) {
        setError(error, '请输入密码。');
        return;
      }
      if (!sessionStore) {
        setError(error, '登录需要浏览器存储权限。请允许本站使用浏览器存储后刷新页面。');
        return;
      }
      setButton(button, true, '正在匹配跨设备账号…', '进入题库 →');
      try {
        let localVerified = false;
        if (localAccount) {
          localVerified = await verifyLocalAccount(localAccount, passwordInput.value);
          if (!localVerified) throw new Error('学员名或密码不正确。');
        }
        const registry = await registryRecordsFor(validation.value);
        if (registry.accountDisabled) {
          throw new Error('这个账号已被管理员停用，请联系管理员恢复。');
        }
        if (localAccount && localVerified) {
          const localRecord = localRegistryRecord(localAccount, registry.nameHash);
          if (registry.revokedCredentials.has(await credentialFingerprint(localRecord))) {
            localVerified = false;
          }
        }
        let matchedRecord = null;
        for (const record of registry.records) {
          if (await verifyRegistryRecord(record, passwordInput.value)) {
            matchedRecord = record;
            break;
          }
        }
        if (registry.networkError && localVerified) {
          storeSession(sessionStore, {
            key,
            name: localAccount.name,
            mode: 'offline',
            startedAt: Date.now()
          });
          passwordInput.value = '';
          await finishUnlock(localAccount.name, 'offline');
          return;
        }
        if (!matchedRecord && localVerified) {
          try {
            matchedRecord = localRegistryRecord(localAccount, registry.nameHash);
            await publishRegistryRecord(matchedRecord);
          } catch {
            storeSession(sessionStore, {
              key,
              name: localAccount.name,
              mode: 'offline',
              startedAt: Date.now()
            });
            passwordInput.value = '';
            await finishUnlock(localAccount.name, 'offline');
            return;
          }
        }
        if (!matchedRecord) {
          if (registry.networkError) {
            throw new Error('无法连接跨设备账号索引。新设备首次登录需要网络，请稍后重试。');
          }
          throw new Error(
            registry.records.length
              ? '学员名或密码不正确。'
              : registry.rawRecordCount
                ? '这个账号的现有密码已被管理员撤销，请向管理员获取新密码。'
                : '没有找到这个跨设备账号。请先在「建立账号」中注册。'
          );
        }
        storeSession(sessionStore, {
          key,
          name: validation.value,
          mode: 'cloud',
          startedAt: Date.now()
        });
        await cacheLocalVerifier(localStore, validation.value, passwordInput.value, matchedRecord);
        accounts = readAccounts(localStore);
        updateAccountCount();
        passwordInput.value = '';
        await finishUnlock(validation.value, 'cloud');
      } catch (failure) {
        setError(error, failure.message || '登录失败，请重试。');
      } finally {
        setButton(button, false, '正在匹配跨设备账号…', '进入题库 →');
      }
    });

    registerForm.addEventListener('submit', async event => {
      event.preventDefault();
      const nameInput = document.getElementById('newStudentName');
      const passwordInput = document.getElementById('newStudentPassword');
      const confirmation = document.getElementById('confirmPassword');
      const error = document.getElementById('registerError');
      const button = document.getElementById('registerButton');
      const validation = validateRegistration(nameInput.value, passwordInput.value, confirmation.value);
      setError(error, '');
      if (!validation.ok) {
        setError(error, validation.message);
        return;
      }
      const key = normalizeStudentName(validation.name);
      if (!sessionStore) {
        setError(error, '建立账号需要浏览器会话存储权限。请允许本站使用浏览器存储后刷新页面。');
        return;
      }
      setButton(button, true, '正在建立跨设备账号…', '建立学员账号 →');
      try {
        const registry = await registryRecordsFor(validation.name);
        if (registry.networkError) {
          throw new Error('无法连接跨设备账号索引，请检查网络后重试。');
        }
        if (registry.accountDisabled) {
          throw new Error('这个学员名已被管理员停用，不能重新注册。');
        }
        if (registry.rawRecordCount) {
          throw new Error('这个学员名已经有跨设备账号，请切换到「学员登录」。');
        }
        const record = await makeRegistryRecord(validation.name, passwordInput.value);
        await publishRegistryRecord(record);
        await cacheLocalVerifier(localStore, validation.name, passwordInput.value, record);
        accounts = readAccounts(localStore);
        updateAccountCount();
        storeSession(sessionStore, {
          key,
          name: validation.name,
          mode: 'cloud',
          startedAt: Date.now()
        });
        passwordInput.value = '';
        confirmation.value = '';
        await finishUnlock(validation.name, 'cloud');
      } catch (failure) {
        setError(error, failure.message || '无法建立账号，请稍后重试。');
      } finally {
        setButton(button, false, '正在建立跨设备账号…', '建立学员账号 →');
      }
    });

    document.getElementById('logoutBtn')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true;
      removeStoredSession(sessionStore);
      authenticated = false;
      currentStudent = '';
      location.reload();
    });

    let storedSession = null;
    try {
      storedSession = JSON.parse(sessionStore?.getItem(SESSION_KEY) || 'null');
    } catch {}
    const restored = storedSession ? sessionFor(sessionStore, storedSession.key) : null;
    if (restored && accounts.accounts[restored.key]) {
      const localAccount = accounts.accounts[restored.key];
      (async () => {
        let access = normalizeAccessControls(null);
        try {
          const index = await fetchRegistryIndex();
          access = index.access;
          writeAccessCache(localStore, access);
        } catch {
          access = readAccessCache(localStore);
        }
        if (access.disabledAccounts.includes(restored.key)) {
          throw new Error('这个账号已被管理员停用，请联系管理员恢复。');
        }
        const record = localRegistryRecord(
          localAccount,
          localAccount.nameHash || await accountNameHash(localAccount.name)
        );
        if (access.revokedCredentials.includes(await credentialFingerprint(record))) {
          throw new Error('这个账号的旧密码已失效，请向管理员获取新密码。');
        }
        await finishUnlock(
          localAccount.name,
          restored.mode === 'cloud' ? 'cloud' : 'offline'
        );
      })().catch(error => {
        removeStoredSession(sessionStore);
        setMode('login');
        setError(document.getElementById('loginError'), error.message || '登录会话已失效。');
      });
    } else {
      removeStoredSession(sessionStore);
      setMode('login');
      document.getElementById('studentName')?.focus();
    }
  }

  return {
    VERSION,
    ACCOUNTS_KEY,
    SESSION_KEY,
    ITERATIONS,
    normalizeStudentName,
    displayStudentName,
    validateStudentName,
    validateRegistration,
    accountNameHash,
    credentialFingerprint,
    validRegistryRecord,
    parseRegistryIndex,
    derivePasswordHash,
    isAuthenticated: () => authenticated,
    currentStudent: () => currentStudent,
    sessionMode: () => authMode,
    start
  };
});
