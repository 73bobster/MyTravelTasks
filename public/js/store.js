// Two stores with the same interface: GuestStore (this device only) and ApiStore (signed-in, synced via Neon).

const GUEST_KEY = 'mtt.guest.v1';
const CACHE_KEY = 'mtt.cache.v1';
const USER_KEY = 'mtt.user.v1';
const uid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`);

function read(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
function remove(key) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

export const guestTrips = () => read(GUEST_KEY, { trips: [] }).trips;
export const clearGuest = () => remove(GUEST_KEY);

// Shared rules for patching a task (mirrors the server).
export function applyPatch(task, patch) {
  const next = { ...task };
  if (patch.status === 'done' || patch.status === 'todo') {
    next.status = patch.status;
    next.doneAt = patch.status === 'done' ? new Date().toISOString() : null;
  }
  if (typeof patch.owner === 'string' && patch.owner.trim()) { next.owner = patch.owner.trim().slice(0, 60); next.userEdited = true; }
  if (typeof patch.title === 'string' && patch.title.trim()) { next.title = patch.title.trim().slice(0, 200); next.userEdited = true; }
  if ('dueDate' in patch) { next.dueDate = patch.dueDate || null; next.userEdited = true; }
  if ('notes' in patch) next.notes = String(patch.notes ?? '').slice(0, 2000);
  return next;
}

export class GuestStore {
  mode = 'guest';

  #save(trips) {
    if (!write(GUEST_KEY, { trips })) throw new Error('This device could not save your trips. Storage may be full or blocked.');
  }
  #withIds(tasks) { return tasks.map((t, i) => ({ ...t, id: t.id || uid(), sort: i })); }

  async list() { return guestTrips(); }

  async create(trip, tasks) {
    const trips = guestTrips();
    const made = { ...trip, id: uid(), createdAt: new Date().toISOString(), tasks: this.#withIds(tasks) };
    trips.push(made);
    this.#save(trips);
    return made;
  }

  async update(id, trip, tasks) {
    const trips = guestTrips();
    const i = trips.findIndex((t) => t.id === id);
    if (i < 0) throw new Error('Trip not found');
    trips[i] = { ...trips[i], ...trip, id, tasks: this.#withIds(tasks) };
    this.#save(trips);
    return trips[i];
  }

  async remove(id) { this.#save(guestTrips().filter((t) => t.id !== id)); }

  #tripWith(tripId, fn) {
    const trips = guestTrips();
    const trip = trips.find((t) => t.id === tripId);
    if (!trip) throw new Error('Trip not found');
    const result = fn(trip);
    this.#save(trips);
    return result;
  }

  async patchTask(tripId, taskId, patch) {
    return this.#tripWith(tripId, (trip) => {
      const i = trip.tasks.findIndex((t) => t.id === taskId);
      if (i < 0) throw new Error('Task not found');
      trip.tasks[i] = applyPatch(trip.tasks[i], patch);
      return trip.tasks[i];
    });
  }

  async addTask(tripId, task) {
    return this.#tripWith(tripId, (trip) => {
      const made = { ...task, id: uid(), key: null, status: 'todo', doneAt: null, dependsOn: [], isKey: false, hint: '', userEdited: true, sort: trip.tasks.length };
      trip.tasks.push(made);
      return made;
    });
  }

  async removeTask(tripId, taskId) {
    this.#tripWith(tripId, (trip) => { trip.tasks = trip.tasks.filter((t) => t.id !== taskId); });
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error("You're offline. Reconnect to save changes."), { offline: true });
  }
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) throw Object.assign(new Error(data?.error || 'Something went wrong. Please try again.'), { status: res.status });
  return data;
}

export class ApiStore {
  mode = 'account';
  offline = false;

  async list() {
    try {
      const { trips } = await api('/trips');
      write(CACHE_KEY, trips);
      this.offline = false;
      return trips;
    } catch (e) {
      if (!e.offline) throw e;
      this.offline = true;
      return read(CACHE_KEY, []);
    }
  }
  async create(trip, tasks) { return (await api('/trips', { method: 'POST', body: { trip, tasks } })).trip; }
  async update(id, trip, tasks) { return (await api(`/trips/${id}`, { method: 'PUT', body: { trip, tasks } })).trip; }
  async remove(id) { await api(`/trips/${id}`, { method: 'DELETE' }); }
  async patchTask(_tripId, taskId, patch) { return (await api(`/tasks/${taskId}`, { method: 'PATCH', body: patch })).task; }
  async addTask(tripId, task) { return (await api(`/trips/${tripId}/tasks`, { method: 'POST', body: { task } })).task; }
  async removeTask(_tripId, taskId) { await api(`/tasks/${taskId}`, { method: 'DELETE' }); }
}

// ----- session -----
export async function getSession() {
  try {
    const { user } = await api('/me');
    if (user) write(USER_KEY, user); else remove(USER_KEY);
    return { user, offline: false };
  } catch (e) {
    if (e.offline) return { user: read(USER_KEY, null), offline: true }; // keep an account usable (read-only) offline
    return { user: null, offline: false };
  }
}
export const forgetSession = () => { remove(USER_KEY); remove(CACHE_KEY); };

export async function importGuestTrips() {
  const trips = guestTrips().map(({ id, createdAt, tasks, ...trip }) => ({ trip, tasks }));
  if (!trips.length) return [];
  const { trips: all } = await api('/import', { method: 'POST', body: { trips } });
  clearGuest();
  return all;
}
