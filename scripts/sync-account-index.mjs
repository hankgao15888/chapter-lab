import {readFile, rename, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export const REGISTRY_TOPIC = 'chapterlab-account-registry-83f5c2a7';
export const INDEX_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'docs',
  'accounts-index.json'
);

export function normalizeRegistryRecord(value) {
  if (!value || typeof value !== 'object') return null;
  const record = {
    version: Number(value.version),
    nameHash: String(value.nameHash || ''),
    salt: String(value.salt || ''),
    hash: String(value.hash || ''),
    iterations: Number(value.iterations),
    createdAt: String(value.createdAt || '')
  };
  if (record.version !== 1) return null;
  if (!/^[a-f0-9]{64}$/.test(record.nameHash)) return null;
  if (!/^[A-Za-z0-9+/]{16,128}={0,2}$/.test(record.salt)) return null;
  if (!/^[A-Za-z0-9+/]{32,128}={0,2}$/.test(record.hash)) return null;
  if (!Number.isInteger(record.iterations) || record.iterations < 100000 || record.iterations > 1000000) {
    return null;
  }
  if (!Number.isFinite(Date.parse(record.createdAt))) return null;
  return record;
}

export function parseRegistryEvents(text) {
  const records = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (!event || event.event !== 'message' || typeof event.message !== 'string') continue;
      const record = normalizeRegistryRecord(JSON.parse(event.message));
      if (record) records.push(record);
    } catch {}
  }
  return records;
}

function emptyIndex() {
  return {version: 1, updatedAt: null, accounts: {}};
}

export function mergeAccountIndex(existing, incoming, now = new Date().toISOString()) {
  const index = existing && existing.version === 1 && existing.accounts
    ? existing
    : emptyIndex();
  const next = {version: 1, updatedAt: index.updatedAt || null, accounts: {}};
  let changed = false;

  for (const [nameHash, records] of Object.entries(index.accounts)) {
    if (!/^[a-f0-9]{64}$/.test(nameHash) || !Array.isArray(records)) continue;
    const valid = records.map(normalizeRegistryRecord).filter(Boolean);
    if (valid.length) next.accounts[nameHash] = valid;
  }

  for (const rawRecord of incoming) {
    const record = normalizeRegistryRecord(rawRecord);
    if (!record) continue;
    const records = next.accounts[record.nameHash] || (next.accounts[record.nameHash] = []);
    const duplicate = records.some(item => item.salt === record.salt && item.hash === record.hash);
    if (!duplicate && records.length < 32) {
      records.push(record);
      changed = true;
    }
  }

  if (changed) {
    next.updatedAt = now;
    for (const records of Object.values(next.accounts)) {
      records.sort((left, right) => {
        const time = Date.parse(left.createdAt) - Date.parse(right.createdAt);
        return time || left.salt.localeCompare(right.salt);
      });
    }
  }
  return {index: next, changed};
}

async function readExistingIndex() {
  try {
    return JSON.parse(await readFile(INDEX_PATH, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return emptyIndex();
    throw error;
  }
}

export async function syncAccountIndex({
  fetchImpl = globalThis.fetch,
  indexPath = INDEX_PATH,
  now = new Date().toISOString()
} = {}) {
  const response = await fetchImpl(
    `https://ntfy.sh/${REGISTRY_TOPIC}/json?poll=1&since=all`,
    {headers: {Accept: 'application/x-ndjson'}}
  );
  if (!response.ok) throw new Error(`Account relay returned HTTP ${response.status}`);
  const incoming = parseRegistryEvents(await response.text());
  const existing = await readExistingIndex();
  const result = mergeAccountIndex(existing, incoming, now);
  if (result.changed) {
    const temporary = indexPath + '.tmp';
    await writeFile(temporary, JSON.stringify(result.index, null, 2) + '\n', 'utf8');
    await rename(temporary, indexPath);
  }
  return {...result, incoming: incoming.length};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await syncAccountIndex();
  console.log(JSON.stringify({
    changed: result.changed,
    incoming: result.incoming,
    accounts: Object.keys(result.index.accounts).length
  }));
}
