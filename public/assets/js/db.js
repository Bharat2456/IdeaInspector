// Browser storage for reports, chats and attachments (IndexedDB, with an in-memory fallback).
// Nothing is ever sent to a server for storage.

const DB_NAME = 'ideainspector';
const STORES = ['reports', 'chats', 'files'];
let dbPromise = null;
export const storage = { mode: 'indexeddb' };
const mem = { reports: new Map(), chats: new Map(), files: new Map() };
const keyOf = { reports: 'id', chats: 'id', files: 'reportId' };

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('IndexedDB unavailable'));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore('reports', { keyPath: 'id' });
        d.createObjectStore('chats', { keyPath: 'id' }).createIndex('reportId', 'reportId');
        d.createObjectStore('files', { keyPath: 'reportId' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch(err => { storage.mode = 'memory'; console.warn('Falling back to in-memory storage:', err); return null; });
  }
  return dbPromise;
}

function wrap(req) {
  return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}

async function tx(store, mode, fn) {
  const db = await open();
  if (!db) return null;
  const t = db.transaction(store, mode);
  const result = await fn(t.objectStore(store));
  await new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = () => reject(t.error); t.onabort = () => reject(t.error); });
  return result;
}

export async function getAll(store) {
  const db = await open();
  if (!db) return Array.from(mem[store].values()).map(v => structuredClone(v));
  return tx(store, 'readonly', s => wrap(s.getAll()));
}
export async function get(store, key) {
  const db = await open();
  if (!db) { const v = mem[store].get(key); return v ? structuredClone(v) : undefined; }
  return tx(store, 'readonly', s => wrap(s.get(key)));
}
export async function put(store, value) {
  const db = await open();
  if (!db) { mem[store].set(value[keyOf[store]], structuredClone(value)); return; }
  await tx(store, 'readwrite', s => wrap(s.put(value)));
}
export async function del(store, key) {
  const db = await open();
  if (!db) { mem[store].delete(key); return; }
  await tx(store, 'readwrite', s => wrap(s.delete(key)));
}

export async function chatsForReport(reportId) {
  const all = await getAll('chats');
  return all.filter(c => c.reportId === reportId).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

// Deleting a report removes its chats and stored attachments with it.
export async function deleteReportCascade(reportId) {
  const chats = await chatsForReport(reportId);
  for (const c of chats) await del('chats', c.id);
  await del('files', reportId);
  await del('reports', reportId);
  return chats.length;
}

export async function exportAll() {
  return { app: 'IdeaInspector', version: 2, exportedAt: Date.now(), reports: await getAll('reports'), chats: await getAll('chats') };
}

export async function importAll(obj) {
  if (!obj || obj.app !== 'IdeaInspector' || !Array.isArray(obj.reports) || !Array.isArray(obj.chats)) throw new Error('That file is not an IdeaInspector backup.');
  const reportIds = new Set();
  for (const r of obj.reports) { if (r && r.id && r.data) { await put('reports', r); reportIds.add(r.id); } }
  let chats = 0;
  for (const c of obj.chats) { if (c && c.id && reportIds.has(c.reportId)) { await put('chats', c); chats++; } }
  return { reports: reportIds.size, chats };
}

export async function wipeAll() {
  for (const s of STORES) {
    const items = await getAll(s);
    for (const it of items) await del(s, it[keyOf[s]]);
  }
}
