/* Chapter Lab public study room. Messages are plain text on a temporary ntfy topic. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }
  root.ChapterLabStudyRoom = api;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', api.start, { once: true });
    } else {
      api.start();
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const RELAY = 'https://ntfy.sh';
  const TOPIC = 'chapterlab-study-room-6e2d8c91f4b3';
  const ROOM = 'chapterlab-study-room';
  const HISTORY = '12h';
  const MAX_MESSAGES = 120;
  const SEND_COOLDOWN_MS = 2500;
  const STATUS = {
    focus: '专注中',
    question: '求讨论',
    break: '休息一下'
  };
  const ADJECTIVES = ['专注的', '清醒的', '从容的', '好奇的', '勇敢的', '冷静的'];
  const NOUNS = ['牛顿', '欧拉', '费曼', '居里', '图灵', '达尔文', '玻尔', '凯恩斯'];

  function cleanText(value, maxLength) {
    return String(value == null ? '' : value)
      .replace(/\r\n?/g, '\n')
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .trim()
      .slice(0, maxLength);
  }

  function cleanName(value) {
    return cleanText(value, 16).replace(/\s+/g, ' ');
  }

  function randomId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 14);
  }

  function defaultName() {
    const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    return adjective + noun + '-' + Math.floor(100 + Math.random() * 900);
  }

  function parsePayload(raw, expectedRoom) {
    if (typeof raw !== 'string' || raw.length > 2400) return null;
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!value || value.v !== 1 || value.type !== 'chat' || value.room !== (expectedRoom || ROOM)) return null;
    if (typeof value.id !== 'string' || !/^[a-z0-9-]{8,64}$/i.test(value.id)) return null;
    if (typeof value.session !== 'string' || !/^[a-z0-9-]{8,64}$/i.test(value.session)) return null;
    if (!Object.prototype.hasOwnProperty.call(STATUS, value.status)) return null;
    if (!Number.isFinite(value.sentAt) || value.sentAt < 946684800000) return null;
    const name = cleanName(value.name);
    const text = cleanText(value.text, 500);
    if (!name || !text) return null;
    return {
      id: value.id,
      session: value.session,
      name,
      status: value.status,
      text,
      sentAt: value.sentAt
    };
  }

  function parseServerEvent(value, expectedTopic, expectedRoom) {
    if (!value || typeof value !== 'object' || value.event !== 'message') return null;
    if (typeof value.id !== 'string' || !value.id) return null;
    if (typeof value.topic !== 'string' || !value.topic) return null;
    if (expectedTopic && value.topic !== expectedTopic) return null;
    const payload = parsePayload(value.message, expectedRoom);
    if (!payload) return null;
    const serverTime = Number(value.time) * 1000;
    return {
      serverId: value.id,
      serverTime: Number.isFinite(serverTime) && serverTime > 0 ? serverTime : payload.sentAt,
      payload
    };
  }

  function parseHistory(text, expectedTopic, expectedRoom) {
    return String(text || '')
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap(line => {
        try {
          const event = parseServerEvent(JSON.parse(line), expectedTopic, expectedRoom);
          return event ? [event] : [];
        } catch {
          return [];
        }
      });
  }

  function formatTime(timestamp) {
    try {
      return new Intl.DateTimeFormat('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).format(new Date(timestamp));
    } catch {
      return '--:--';
    }
  }

  function start() {
    const get = selector => document.querySelector(selector);
    const transcript = get('#studyTranscript');
    const form = get('#studyForm');
    const input = get('#studyMessage');
    const sendButton = get('#studySend');
    const chars = get('#studyChars');
    const nameInput = get('#studyName');
    const statusInput = get('#studyStatus');
    const relay = get('#studyRelay');
    const recentCount = get('#studyRecentCount');
    const reconnectButton = get('#studyReconnect');
    const timerDisplay = get('#studyTimer');
    const timerToggle = get('#studyTimerToggle');
    const timerReset = get('#studyTimerReset');
    const timerNote = get('#studyTimerNote');
    if (!transcript || !form || !input || !sendButton || !nameInput || !statusInput || !relay) return;

    let profile;
    try {
      profile = JSON.parse(localStorage.getItem('chapterlab-study-profile-v1') || '{}');
    } catch {
      profile = {};
    }
    if (!profile.session || !/^[a-z0-9-]{8,64}$/i.test(profile.session)) profile.session = randomId();
    profile.name = cleanName(profile.name) || defaultName();
    if (!Object.prototype.hasOwnProperty.call(STATUS, profile.status)) profile.status = 'focus';
    try {
      localStorage.setItem('chapterlab-study-profile-v1', JSON.stringify(profile));
    } catch {}
    nameInput.value = profile.name;
    statusInput.value = profile.status;

    const messages = new Map();
    let stream = null;
    let historyLoaded = false;
    let lastSentAt = 0;
    let isSending = false;

    function saveProfile() {
      profile.name = cleanName(nameInput.value) || defaultName();
      profile.status = Object.prototype.hasOwnProperty.call(STATUS, statusInput.value) ? statusInput.value : 'focus';
      nameInput.value = profile.name;
      try {
        localStorage.setItem('chapterlab-study-profile-v1', JSON.stringify(profile));
      } catch {}
    }

    function setRelay(state, label, detail) {
      relay.dataset.state = state;
      const strong = relay.querySelector('strong');
      const small = relay.querySelector('small');
      if (strong) strong.textContent = label;
      if (small) small.textContent = detail;
    }

    function messageNode(event) {
      const item = event.payload;
      const article = document.createElement('article');
      article.className = 'chat-message' + (item.session === profile.session ? ' own-message' : '');
      article.dataset.serverId = event.serverId;

      const avatar = document.createElement('div');
      avatar.className = 'chat-avatar';
      avatar.setAttribute('aria-hidden', 'true');
      avatar.textContent = item.name.slice(0, 1).toUpperCase();

      const body = document.createElement('div');
      body.className = 'chat-message-body';
      const head = document.createElement('div');
      head.className = 'chat-message-head';
      const name = document.createElement('strong');
      name.textContent = item.session === profile.session ? item.name + '（我）' : item.name;
      const status = document.createElement('span');
      status.className = 'chat-status status-' + item.status;
      status.textContent = STATUS[item.status];
      const time = document.createElement('time');
      time.dateTime = new Date(event.serverTime).toISOString();
      time.textContent = formatTime(event.serverTime);
      head.append(name, status, time);

      const text = document.createElement('p');
      text.textContent = item.text;
      body.append(head, text);
      article.append(avatar, body);
      return article;
    }

    function updateRecentCount() {
      if (!recentCount) return;
      const cutoff = Date.now() - 10 * 60 * 1000;
      const participants = new Set();
      for (const event of messages.values()) {
        if (event.serverTime >= cutoff) participants.add(event.payload.session);
      }
      recentCount.textContent = participants.size ? participants.size + ' 人' : '0 人';
    }

    function renderMessages(forceBottom) {
      const shouldStick = forceBottom ||
        transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 90;
      const fragment = document.createDocumentFragment();
      const ordered = [...messages.values()]
        .sort((a, b) => a.serverTime - b.serverTime || a.serverId.localeCompare(b.serverId))
        .slice(-MAX_MESSAGES);
      if (!ordered.length) {
        const welcome = document.createElement('div');
        welcome.className = 'chat-welcome';
        const symbol = document.createElement('span');
        symbol.textContent = '∿';
        const title = document.createElement('strong');
        title.textContent = historyLoaded ? '还没有人发言，来当第一个吧' : '自习室已就位';
        const note = document.createElement('p');
        note.textContent = historyLoaded
          ? '历史记录为空，或上一条公开消息已经过期。'
          : '正在读取最近的公开消息。';
        welcome.append(symbol, title, note);
        fragment.append(welcome);
      } else {
        ordered.forEach(event => fragment.append(messageNode(event)));
      }
      transcript.replaceChildren(fragment);
      if (shouldStick) transcript.scrollTop = transcript.scrollHeight;
      updateRecentCount();
    }

    function ingest(event) {
      if (!event || messages.has(event.serverId)) return false;
      messages.set(event.serverId, event);
      const overflow = messages.size - MAX_MESSAGES;
      if (overflow > 0) {
        [...messages.entries()]
          .sort((a, b) => a[1].serverTime - b[1].serverTime)
          .slice(0, overflow)
          .forEach(([key]) => messages.delete(key));
      }
      renderMessages(false);
      return true;
    }

    function requestTimeout(ms) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), ms);
      return { signal: controller.signal, done: () => clearTimeout(timeout) };
    }

    async function fetchHistory() {
      const request = requestTimeout(15000);
      try {
        const response = await fetch(
          RELAY + '/' + encodeURIComponent(TOPIC) + '/json?poll=1&since=' + HISTORY,
          { cache: 'no-store', signal: request.signal }
        );
        if (!response.ok) throw new Error('history-' + response.status);
        const events = parseHistory(await response.text(), TOPIC, ROOM);
        events.forEach(ingest);
        historyLoaded = true;
        renderMessages(true);
      } finally {
        request.done();
      }
    }

    function openStream() {
      if (stream) stream.close();
      if (typeof EventSource !== 'function') {
        setRelay('offline', '浏览器不支持实时连接', '请更换现代浏览器');
        return;
      }
      setRelay('connecting', '正在连接', '读取公共消息');
      stream = new EventSource(
        RELAY + '/' + encodeURIComponent(TOPIC) + '/sse?since=' + HISTORY
      );
      stream.onopen = () => setRelay('ready', '中继已连接', '新消息实时送达');
      stream.onmessage = message => {
        try {
          const event = parseServerEvent(JSON.parse(message.data), TOPIC, ROOM);
          if (event) ingest(event);
        } catch {}
      };
      stream.onerror = () => {
        setRelay('reconnecting', '正在重连', '已保留当前消息');
      };
    }

    async function connect() {
      setRelay('connecting', '正在连接', '读取公共消息');
      try {
        await fetchHistory();
      } catch {
        setRelay('offline', '历史暂未加载', '将尝试接收实时消息');
      }
      openStream();
    }

    function showComposerError(message) {
      const hint = get('#studyComposerHint');
      if (!hint) return;
      hint.textContent = message;
      hint.classList.add('composer-error');
      setTimeout(() => {
        hint.textContent = 'Enter 发送 · Shift + Enter 换行 · 公开可见';
        hint.classList.remove('composer-error');
      }, 4000);
    }

    async function sendMessage() {
      if (isSending) return;
      saveProfile();
      const text = cleanText(input.value, 500);
      if (!text) {
        input.focus();
        return;
      }
      const now = Date.now();
      if (now - lastSentAt < SEND_COOLDOWN_MS) {
        showComposerError('请稍等几秒再发送下一条消息。');
        return;
      }

      const payload = {
        v: 1,
        type: 'chat',
        room: ROOM,
        id: randomId(),
        session: profile.session,
        name: profile.name,
        status: profile.status,
        text,
        sentAt: now
      };
      isSending = true;
      sendButton.disabled = true;
      sendButton.textContent = '发送中…';
      try {
        const response = await fetch(RELAY + '/' + encodeURIComponent(TOPIC), {
          method: 'POST',
          cache: 'no-store',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          if (response.status === 429) throw new Error('发言太快，请稍后再试。');
          throw new Error('发送失败，请检查网络后重试。');
        }
        let event = null;
        try {
          event = parseServerEvent(await response.json(), TOPIC, ROOM);
        } catch {}
        if (!event) {
          event = { serverId: payload.id, serverTime: now, payload };
        }
        ingest(event);
        lastSentAt = Date.now();
        input.value = '';
        if (chars) chars.textContent = '0 / 500';
        setRelay('ready', '中继已连接', '新消息实时送达');
      } catch (error) {
        showComposerError(error && error.message ? error.message : '发送失败，请稍后重试。');
      } finally {
        isSending = false;
        sendButton.disabled = false;
        sendButton.textContent = '发送 ↵';
      }
    }

    form.addEventListener('submit', event => {
      event.preventDefault();
      sendMessage();
    });
    input.addEventListener('input', () => {
      if (chars) chars.textContent = input.value.length + ' / 500';
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        sendMessage();
      }
    });
    nameInput.addEventListener('change', saveProfile);
    statusInput.addEventListener('change', saveProfile);
    if (reconnectButton) {
      reconnectButton.addEventListener('click', () => {
        if (stream) stream.close();
        connect();
      });
    }

    let selectedMinutes = 25;
    let remainingSeconds = selectedMinutes * 60;
    let timerEnd = 0;
    let timerId = null;

    function renderTimer() {
      if (!timerDisplay) return;
      const minutes = Math.floor(Math.max(0, remainingSeconds) / 60);
      const seconds = Math.max(0, remainingSeconds) % 60;
      timerDisplay.textContent = String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
    }

    function stopTimer(paused) {
      if (timerId) clearInterval(timerId);
      timerId = null;
      if (paused) timerToggle.textContent = '继续专注';
      else timerToggle.textContent = '开始专注';
    }

    function timerTick() {
      remainingSeconds = Math.max(0, Math.ceil((timerEnd - Date.now()) / 1000));
      renderTimer();
      if (remainingSeconds === 0) {
        stopTimer(false);
        timerNote.textContent = '这一段完成了。休息几分钟，再决定下一段。';
      }
    }

    if (timerToggle) {
      timerToggle.addEventListener('click', () => {
        if (timerId) {
          timerTick();
          stopTimer(true);
          timerNote.textContent = '计时已暂停。';
          return;
        }
        if (remainingSeconds <= 0) remainingSeconds = selectedMinutes * 60;
        timerEnd = Date.now() + remainingSeconds * 1000;
        timerId = setInterval(timerTick, 500);
        timerToggle.textContent = '暂停';
        timerNote.textContent = '保持一段不被打断的时间。';
      });
    }
    if (timerReset) {
      timerReset.addEventListener('click', () => {
        stopTimer(false);
        remainingSeconds = selectedMinutes * 60;
        renderTimer();
        timerNote.textContent = '先定一小段目标，把手机放远一点。';
      });
    }
    document.querySelectorAll('[data-duration]').forEach(button => {
      button.addEventListener('click', () => {
        selectedMinutes = Number(button.dataset.duration);
        document.querySelectorAll('[data-duration]').forEach(item => item.classList.toggle('selected', item === button));
        stopTimer(false);
        remainingSeconds = selectedMinutes * 60;
        renderTimer();
        timerNote.textContent = selectedMinutes + ' 分钟专注时段已准备好。';
      });
    });
    const updateTimerVisibility = () => {
      if (timerId) timerTick();
      updateRecentCount();
    };
    document.addEventListener('visibilitychange', updateTimerVisibility);
    window.addEventListener('pagehide', () => {
      if (stream) stream.close();
    }, { once: true });

    renderTimer();
    connect();
  }

  return {
    RELAY,
    TOPIC,
    ROOM,
    STATUS,
    cleanText,
    cleanName,
    parsePayload,
    parseServerEvent,
    parseHistory,
    formatTime,
    start
  };
});
