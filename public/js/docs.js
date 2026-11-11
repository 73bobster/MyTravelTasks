// docs.js — documents kept on this device only (IndexedDB). Nothing here is uploaded.
// level 'person': reusable across trips (multi-trip insurance, GHIC, railcard...). level 'trip': one trip (tickets, bookings).
// owner: 'guest' or the signed-in account id, so a shared device keeps each person's files apart.
export const MAX_BYTES = 15 * 1024 * 1024;
export const KINDS = [
  { id: 'insurance', label: 'Travel insurance', level: 'person' },
  { id: 'health', label: 'GHIC or health card', level: 'person' },
  { id: 'railcard', label: 'Railcard or membership', level: 'person' },
  { id: 'licence', label: 'Driving licence or permit', level: 'person' },
  { id: 'ticket', label: 'Ticket or boarding pass', level: 'trip' },
  { id: 'booking', label: 'Booking confirmation', level: 'trip' },
  { id: 'approval', label: 'Visa, ESTA or entry approval', level: 'trip' },
  { id: 'carhire', label: 'Car hire or parking', level: 'trip' },
  { id: 'other', label: 'Other', level: 'both' },
];
export const kindLabel = (id) => KINDS.find((k) => k.id === id)?.label || 'Other';

export function checkFile(file) {
  if (!file || !file.size) return 'Choose a photo or PDF first.';
  if (!(/^image\//.test(file.type) || file.type === 'application/pdf')) return 'Only photos and PDFs can be saved.';
  if (file.size > MAX_BYTES) return 'That file is over 15 MB. Try a smaller photo or a compressed PDF.';
  return '';
}

// ---- storage: IndexedDB, with an in-memory fallback (private browsing, old browsers, tests) ----
const mem = new Map();
let dbp = null;
export let persistent = true;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') throw new Error('no indexedDB');
      const req = indexedDB.open('mtt-docs', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('files', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { persistent = false; resolve(null); };
    } catch { persistent = false; resolve(null); }
  });
  return dbp;
}
const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
const newId = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `d${Date.now()}${Math.random().toString(36).slice(2)}`);

export async function allDocs() {
  const d = await db();
  if (!d) return [...mem.values()];
  return wrap(d.transaction('files').objectStore('files').getAll());
}
export async function putDoc(doc) {
  const d = await db();
  if (!d) { mem.set(doc.id, doc); return doc; }
  await wrap(d.transaction('files', 'readwrite').objectStore('files').put(doc));
  return doc;
}
export async function removeDoc(id) {
  const d = await db();
  if (!d) { mem.delete(id); return; }
  await wrap(d.transaction('files', 'readwrite').objectStore('files').delete(id));
}
export async function addDoc(meta, file) {
  const err = checkFile(file);
  if (err) throw new Error(err);
  try { navigator.storage?.persist?.().catch(() => {}); } catch { /* best effort, never waits: some browsers hold this call open behind a prompt */ }
  let data;
  try { data = await file.arrayBuffer(); } catch { throw new Error('Could not read that file. Try choosing it again.'); }
  const doc = {
    id: newId(), owner: meta.owner, level: meta.level === 'trip' ? 'trip' : 'person',
    person: String(meta.person || '').trim().slice(0, 40), tripId: meta.level === 'trip' ? meta.tripId : null,
    kind: KINDS.some((k) => k.id === meta.kind) ? meta.kind : 'other',
    taskKey: meta.level === 'trip' ? String(meta.taskKey || '').slice(0, 80) : '',
    label: String(meta.label || file.name || '').trim().slice(0, 80) || 'Document',
    fileName: file.name || '', type: file.type, size: file.size,
    validFrom: /^\d{4}-\d{2}-\d{2}$/.test(meta.validFrom || '') ? meta.validFrom : '',
    expires: /^\d{4}-\d{2}-\d{2}$/.test(meta.expires || '') ? meta.expires : '',
    addedAt: new Date().toISOString(), data, // stored as bytes: more reliable than a Blob in some mobile browsers
  };
  try { return await putDoc(doc); } catch (e) {
    console.error('Saving a document failed', e);
    throw new Error('This browser would not save the file. Storage may be full or blocked (private mode?). Free some space or try another browser.');
  }
}
// Remove every file belonging to a scope (account deleted) or a trip (trip deleted).
export async function removeWhere(pred) {
  for (const d of await allDocs()) if (pred(d)) await removeDoc(d.id);
}
// Guest trips become account trips with new ids on sign-up: carry the files across.
export async function moveOwner(from, to, tripMap = {}) {
  for (const d of await allDocs()) {
    if (d.owner !== from) continue;
    const next = { ...d, owner: to };
    if (d.level === 'trip') {
      if (!tripMap[d.tripId]) { await removeDoc(d.id); continue; }
      next.tripId = tripMap[d.tripId];
    }
    await putDoc(next);
  }
}

// ---- pure helpers for the views ----
const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
export function docsForTrip(all, owner, trip) {
  const mine = all.filter((d) => d.owner === owner);
  const names = (trip.travellers || []).map((t) => t.name);
  const people = mine.filter((d) => d.level === 'person' && names.some((n) => same(n, d.person)));
  return {
    others: mine.filter((d) => d.level === 'person' && !people.includes(d)),
    trip: mine.filter((d) => d.level === 'trip' && d.tripId === trip.id).sort((a, b) => a.addedAt.localeCompare(b.addedAt)),
    people,
  };
}
// Does this insurance document cover the whole trip? 'ok' | 'outside' | 'undated'
// Tasks that produce a document worth keeping with them, and the kind of document to suggest.
const DOC_TASKS = {
  book_transport: 'ticket', checkin: 'ticket', return_checkin: 'ticket', book_stay: 'booking', stay_confirm: 'booking',
  car_hire: 'carhire', book_parking: 'carhire', transfers: 'booking', visa: 'approval', carry_invite: 'other', work_access: 'other',
};
export function docKindFor(key) {
  const base = String(key || '').split('@')[0];
  if (/^form_/.test(base)) return 'approval';
  return DOC_TASKS[base] || '';
}
export const taskDocs = (all, owner, trip, key) => all.filter((d) => d.owner === owner && d.level === 'trip' && d.tripId === trip.id && d.taskKey === key);

export function coverCheck(doc, trip) {
  if (!doc.validFrom && !doc.expires) return 'undated';
  if (doc.validFrom && doc.validFrom > trip.startDate) return 'outside';
  if (doc.expires && doc.expires < trip.endDate) return 'outside';
  return 'ok';
}
export function missingInsurance(all, owner, trip) {
  if (trip.scope !== 'abroad') return [];
  const mine = all.filter((d) => d.owner === owner && d.level === 'person' && d.kind === 'insurance');
  return (trip.travellers || []).map((t) => t.name).filter((n) => n && !mine.some((d) => same(d.person, n)));
}
export const docBlob = (d) => (d.data ? new Blob([d.data], { type: d.type }) : d.blob);
export const sizeLabel = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
