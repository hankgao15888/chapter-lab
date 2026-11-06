(function(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChapterLabLoginActivity = api;
})(globalThis, function(root) {
  'use strict';
  const TOPIC = 'chapterlab-account-registry-83f5c2a7';
  function validEvent(value) {
    return Boolean(value && value.version === 1 && value.kind === 'encrypted-login'
      && /^[a-f0-9]{64}$/.test(value.keyId || '')
      && /^[a-f0-9-]{36}$/.test(value.id || '')
      && /^[A-Za-z0-9+/]{682,684}={0,2}$/.test(value.ciphertext || '')
      && Number.isFinite(Date.parse(value.at || '')));
  }
  async function encryptEvent(name, nameHash, config, cryptoApi = root.crypto) {
    const id = cryptoApi.randomUUID();
    const at = new Date().toISOString();
    const key = await cryptoApi.subtle.importKey('jwk', config.publicKey,
      {name:'RSA-OAEP', hash:'SHA-256'}, false, ['encrypt']);
    const payload = new TextEncoder().encode(JSON.stringify({version:1, id, name, nameHash, at}));
    const encrypted = new Uint8Array(await cryptoApi.subtle.encrypt({name:'RSA-OAEP'}, key, payload));
    let binary = '';
    for (const byte of encrypted) binary += String.fromCharCode(byte);
    return {version:1, kind:'encrypted-login', keyId:config.keyId, id, at, ciphertext:btoa(binary)};
  }
  async function report(name, nameHash, session) {
    try {
      if (!session || root.navigator?.onLine === false) return;
      const marker = String(session.startedAt) + ':' + nameHash;
      if (root.sessionStorage.getItem('chapterlab-login-reported-v1') === marker) return;
      const response = await fetch('admin-login-key.json', {cache:'no-store', signal:AbortSignal.timeout(5000)});
      if (!response.ok) return;
      const event = await encryptEvent(name, nameHash, await response.json());
      if (!validEvent(event)) return;
      const published = await fetch('https://ntfy.sh/' + TOPIC, {
        method:'POST', headers:{'Content-Type':'text/plain;charset=UTF-8'},
        body:JSON.stringify(event), signal:AbortSignal.timeout(5000)
      });
      if (published.ok) root.sessionStorage.setItem('chapterlab-login-reported-v1', marker);
    } catch { /* A reporting outage must not prevent the student from studying. */ }
  }
  return {validEvent, encryptEvent, report};
});
