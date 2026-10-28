// store.js — the only module that touches storage.
//
// Everything the UI needs goes through these async functions. A future cloud
// adapter implements the same exports (see README → "Adding cloud sync").
//
// Every record carries: id, createdAt, updatedAt, deleted, schemaVersion.
// Deletes are soft: the record stays as a tombstone so a sync can see it.

import { SCHEMA_VERSION, defaultSettings } from './defaults.js';

const DB_NAME = 'trading-journal';
const DB_VERSION = 1;
const TRADES = 'trades';
const SHOTS = 'screenshots';
const SETTINGS = 'settings';

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(TRADES)) {
          const s = db.createObjectStore(TRADES, { keyPath: 'id' });
          s.createIndex('dateTime', 'dateTime');
          s.createIndex('updatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains(SHOTS)) db.createObjectStore(SHOTS, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(SETTINGS)) db.createObjectStore(SETTINGS, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Database is open in another tab. Close it and reload.'));
    });
  }
  return dbPromise;
}

const wrap = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

/** Run fn(stores) in one transaction; resolves with fn's result once committed. */
async function withTx(names, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(names, mode);
    const stores = Object.fromEntries([].concat(names).map((n) => [n, t.objectStore(n)]));
    let result;
    Promise.resolve(fn(stores)).then((r) => { result = r; }, (e) => { t.abort(); reject(e); });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
  });
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const now = () => new Date().toISOString();

function stamp(record) {
  const t = now();
  return {
    ...record,
    id: record.id || uuid(),
    createdAt: record.createdAt || t,
    updatedAt: t,
    deleted: !!record.deleted,
    schemaVersion: SCHEMA_VERSION,
  };
}

// ---------------------------------------------------------------- lifecycle

/** Open the database and ask the browser not to evict our data. */
export async function init() {
  await openDb();
  try {
    if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch { /* not supported: data still works, just not protected */ }
}

export async function storageInfo() {
  const info = { persisted: null, usage: null, quota: null };
  try {
    if (navigator.storage?.persisted) info.persisted = await navigator.storage.persisted();
    if (navigator.storage?.estimate) Object.assign(info, await navigator.storage.estimate());
  } catch { /* ignore */ }
  return info;
}

// ------------------------------------------------------------------- trades

/**
 * filter: { from?: Date|ISO, to?: Date|ISO (exclusive), includeDeleted?: bool }
 * Returns trades newest first.
 */
export async function listTrades(filter = {}) {
  const all = await withTx(TRADES, 'readonly', (s) => wrap(s[TRADES].getAll()));
  const from = filter.from ? new Date(filter.from).toISOString() : null;
  const to = filter.to ? new Date(filter.to).toISOString() : null;
  return all
    .filter((t) => (filter.includeDeleted || !t.deleted)
      && (!from || t.dateTime >= from)
      && (!to || t.dateTime < to))
    .sort((a, b) => (a.dateTime < b.dateTime ? 1 : a.dateTime > b.dateTime ? -1 : 0));
}

export async function getTrade(id) {
  const t = await withTx(TRADES, 'readonly', (s) => wrap(s[TRADES].get(id)));
  return t && !t.deleted ? t : null;
}

export async function saveTrade(trade) {
  const record = stamp(trade);
  await withTx(TRADES, 'readwrite', (s) => wrap(s[TRADES].put(record)));
  return record;
}

/**
 * Soft delete the trade and its screenshots. Resolves with what was removed
 * ({trade, shots}) so the caller can offer Undo via restoreTrade().
 */
export async function deleteTrade(id) {
  return withTx([TRADES, SHOTS], 'readwrite', async (s) => {
    const t = await wrap(s[TRADES].get(id));
    if (!t) return null;
    const shots = [];
    for (const sid of t.screenshotIds || []) {
      const shot = await wrap(s[SHOTS].get(sid));
      if (!shot) continue;
      if (!shot.deleted) shots.push(shot);
      await wrap(s[SHOTS].put(stamp({ ...shot, blob: null, deleted: true })));
    }
    await wrap(s[TRADES].put(stamp({ ...t, deleted: true })));
    return { trade: t, shots };
  });
}

/** Undo a deleteTrade(): bring back the trade and its screenshots. */
export async function restoreTrade(removed) {
  if (!removed) return;
  await withTx([TRADES, SHOTS], 'readwrite', async (s) => {
    for (const shot of removed.shots) await wrap(s[SHOTS].put(stamp({ ...shot, deleted: false })));
    await wrap(s[TRADES].put(stamp({ ...removed.trade, deleted: false })));
  });
}

// -------------------------------------------------------------- screenshots

export async function saveScreenshot(blob, id) {
  const record = stamp({ id, blob, type: blob.type });
  await withTx(SHOTS, 'readwrite', (s) => wrap(s[SHOTS].put(record)));
  return record.id;
}

export async function getScreenshot(id) {
  const r = await withTx(SHOTS, 'readonly', (s) => wrap(s[SHOTS].get(id)));
  return r && !r.deleted ? r.blob : null;
}

/** Soft delete: keeps a tombstone but drops the image bytes. */
export async function deleteScreenshot(id) {
  await withTx(SHOTS, 'readwrite', async (s) => {
    const r = await wrap(s[SHOTS].get(id));
    if (r) await wrap(s[SHOTS].put(stamp({ ...r, blob: null, deleted: true })));
  });
}

// ----------------------------------------------------------------- settings

/** Saved settings merged over defaults (so new default keys show up). */
export async function getSettings() {
  const saved = await withTx(SETTINGS, 'readonly', (s) => wrap(s[SETTINGS].get('settings')));
  return { ...defaultSettings(), ...(saved || {}) };
}

export async function saveSettings(settings) {
  const record = stamp({ ...settings, id: 'settings' });
  await withTx(SETTINGS, 'readwrite', (s) => wrap(s[SETTINGS].put(record)));
  return record;
}

// ------------------------------------------------------------ export/import

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function base64ToBlob(b64, type) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** Everything, including tombstones, as plain JSON (screenshots in base64). */
export async function exportAll() {
  const [trades, shots, settings] = await withTx([TRADES, SHOTS, SETTINGS], 'readonly', (s) => Promise.all([
    wrap(s[TRADES].getAll()), wrap(s[SHOTS].getAll()), wrap(s[SETTINGS].get('settings')),
  ]));
  const screenshots = [];
  for (const { blob, ...rest } of shots) {
    screenshots.push({ ...rest, data: blob ? await blobToBase64(blob) : null });
  }
  return {
    app: 'trading-journal',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now(),
    settings: settings || null,
    trades,
    screenshots,
  };
}

const newer = (incoming, existing) => !existing || (incoming.updatedAt || '') > (existing.updatedAt || '');

/**
 * Merge a backup by id: the record with the newer updatedAt wins.
 * Timestamps are kept as they are in the backup (not re-stamped).
 */
export async function importAll(data) {
  if (!data || data.app !== 'trading-journal' || !Array.isArray(data.trades)) {
    throw new Error('This file is not a Trading Journal backup.');
  }
  if ((data.schemaVersion || 1) > SCHEMA_VERSION) {
    throw new Error('This backup is from a newer version of the app. Update the app first.');
  }
  // Decode images before opening the transaction (it must not wait on non-DB work).
  const shots = (data.screenshots || []).map(({ data: b64, ...rest }) => ({
    ...rest,
    blob: b64 ? base64ToBlob(b64, rest.type || 'image/jpeg') : null,
  }));
  const counts = { added: 0, updated: 0, unchanged: 0 };
  await withTx([TRADES, SHOTS, SETTINGS], 'readwrite', async (s) => {
    for (const t of data.trades) {
      if (!t.id) continue;
      const existing = await wrap(s[TRADES].get(t.id));
      if (newer(t, existing)) {
        await wrap(s[TRADES].put({ ...t, schemaVersion: SCHEMA_VERSION }));
        if (existing) counts.updated++; else counts.added++;
      } else counts.unchanged++;
    }
    for (const shot of shots) {
      if (!shot.id) continue;
      const existing = await wrap(s[SHOTS].get(shot.id));
      if (newer(shot, existing)) await wrap(s[SHOTS].put(shot));
    }
    if (data.settings) {
      const existing = await wrap(s[SETTINGS].get('settings'));
      if (newer(data.settings, existing)) await wrap(s[SETTINGS].put({ ...data.settings, id: 'settings' }));
    }
  });
  return counts;
}
