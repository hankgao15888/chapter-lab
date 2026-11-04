/* Chapter Lab device-level student access gate. Passwords are never stored in plaintext. */
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

  const VERSION = '1.6.0';
  const ACCOUNTS_KEY = 'chapterlab-device-accounts-v1';
  const SESSION_KEY = 'chapterlab-student-session-v1';
  const ITERATIONS = 310000;
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

  function normalizeStudentName(value) {
    return String(value == null ? '' : value)
      .normalize('NFKC')
      .trim()
      .replace(/\s+/g, ' ')
      .toLocaleLowerCase('en-US');
  }

  function displayStudentName(value) {
    return String(value == null ? '' : value)
      .normalize('NFKC')
      .replace(/[\u0000-\u001f\u007f<>]/g, '')
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 24);
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
    if (!storage) throw new Error('浏览器禁止保存本地账号。请允许站点使用本地存储后重试。');
    try {
      storage.setItem(ACCOUNTS_KEY, JSON.stringify(store));
    } catch {
      throw new Error('浏览器无法保存本地账号。请检查隐私设置或存储空间。');
    }
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

  function finishUnlock(name) {
    currentStudent = name;
    authenticated = true;
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

  function start() {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    if (!loginForm || !registerForm) return;
    if (!root.crypto || !root.crypto.subtle) {
      setError(document.getElementById('loginError'), '当前浏览器不支持安全密码验证，请升级浏览器后重试。');
      return;
    }
    const localStore = browserStorage('localStorage');
    const sessionStore = browserStorage('sessionStorage');
    let accounts = readAccounts(localStore);
    const accountCount = document.getElementById('accountCount');
    const updateAccountCount = () => {
      if (accountCount) accountCount.textContent = String(Object.keys(accounts.accounts).length);
    };
    updateAccountCount();
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
      if (title) title.textContent = registering ? '建立学员账号' : '学员登录';
      if (subtitle) subtitle.textContent = registering ? '首次使用请创建本设备账号。' : '使用你的学员名和密码继续。';
      document.querySelectorAll('[data-auth-mode]').forEach(button => {
        const selected = button.dataset.authMode === mode;
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-selected', String(selected));
      });
      setError(document.getElementById('loginError'), '');
      setError(document.getElementById('registerError'), '');
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

    loginForm.addEventListener('submit', async event => {
      event.preventDefault();
      const nameInput = document.getElementById('studentName');
      const passwordInput = document.getElementById('studentPassword');
      const error = document.getElementById('loginError');
      const button = document.getElementById('loginButton');
      const key = normalizeStudentName(nameInput.value);
      const account = accounts.accounts[key];
      setError(error, '');
      if (!key || !passwordInput.value) {
        setError(error, '请输入学员名和密码。');
        return;
      }
      if (!account) {
        setMode('register');
        const newNameInput = document.getElementById('newStudentName');
        if (newNameInput) newNameInput.value = nameInput.value.trim();
        setError(document.getElementById('registerError'), '没有找到这个本设备账号，请确认学员名并建立账号。');
        document.getElementById('newStudentPassword')?.focus();
        return;
      }
      if (!localStore || !sessionStore) {
        setError(error, '登录需要浏览器存储权限。请允许本站使用浏览器存储后刷新页面。');
        return;
      }
      setButton(button, true, '正在验证…', '进入题库 →');
      try {
        await new Promise(resolve => setTimeout(resolve, 250));
        const iterations = Number.isInteger(account.iterations) && account.iterations >= 100000 && account.iterations <= 1000000
          ? account.iterations
          : ITERATIONS;
        const hash = await derivePasswordHash(
          passwordInput.value,
          base64ToBytes(account.salt),
          iterations
        );
        if (!equalBytes(hash, base64ToBytes(account.hash))) throw new Error('学员名或密码不正确。');
        storeSession(sessionStore, {
          key,
          name: account.name,
          startedAt: Date.now()
        });
        passwordInput.value = '';
        await finishUnlock(account.name);
      } catch (failure) {
        setError(error, failure.message || '登录失败，请重试。');
      } finally {
        setButton(button, false, '正在验证…', '进入题库 →');
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
      if (!localStore || !sessionStore) {
        setError(error, '建立账号需要浏览器存储权限。请允许本站使用浏览器存储后刷新页面。');
        return;
      }
      const key = normalizeStudentName(validation.name);
      if (accounts.accounts[key]) {
        setError(error, '这个学员名已经存在，请直接登录。');
        return;
      }
      setButton(button, true, '正在建立…', '建立学员账号 →');
      try {
        const salt = randomBytes(16);
        const hash = await derivePasswordHash(passwordInput.value, salt, ITERATIONS);
        accounts = readAccounts(localStore);
        if (accounts.accounts[key]) throw new Error('这个学员名已经存在，请直接登录。');
        accounts.accounts[key] = {
          name: validation.name,
          salt: bytesToBase64(salt),
          hash: bytesToBase64(hash),
          iterations: ITERATIONS,
          createdAt: new Date().toISOString()
        };
        writeAccounts(localStore, accounts);
        updateAccountCount();
        storeSession(sessionStore, {
          key,
          name: validation.name,
          startedAt: Date.now()
        });
        passwordInput.value = '';
        confirmation.value = '';
        await finishUnlock(validation.name);
      } catch (failure) {
        setError(error, failure.message || '无法建立账号，请检查浏览器设置。');
      } finally {
        setButton(button, false, '正在建立…', '建立学员账号 →');
      }
    });

    document.getElementById('logoutBtn')?.addEventListener('click', () => {
      try {
        sessionStore?.removeItem(SESSION_KEY);
      } catch {}
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
      finishUnlock(accounts.accounts[restored.key].name).catch(() => setMode('login'));
    } else {
      try {
        sessionStore?.removeItem(SESSION_KEY);
      } catch {}
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
    derivePasswordHash,
    isAuthenticated: () => authenticated,
    currentStudent: () => currentStudent,
    start
  };
});
