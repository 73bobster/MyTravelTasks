// All SQL lives here. Every query is scoped by user_id, so one person can never reach another's trips.
import { HttpError } from './http.js';
import { isISODate } from '../public/js/core.js';

export const LIMITS = { trips: 50, tasksPerTrip: 200 };

export const mapTask = (r) => ({
  id: r.id, tripId: r.trip_id, key: r.key, title: r.title, category: r.category, owner: r.owner,
  dueDate: r.due_date, status: r.status, doneAt: r.done_at, dependsOn: r.depends_on || [],
  isKey: r.is_key, notes: r.notes || '', hint: r.hint || '', sort: r.sort, userEdited: r.user_edited,
});
export const mapTrip = (r, tasks = []) => ({
  id: r.id, name: r.name, type: r.trip_type, scope: r.scope, destination: r.destination || '',
  country: r.country || '', startDate: r.start_date, endDate: r.end_date, transport: r.transport || [],
  travellers: r.travellers || [], options: r.options || {}, createdAt: r.created_at, tasks,
});

// ----- users and sessions -----
export async function findUserByEmail(sql, email) {
  const rows = await sql`SELECT id, email, name, password_hash FROM users WHERE lower(email) = ${email}`;
  return rows[0] || null;
}
export async function createUser(sql, { email, name, passwordHash }) {
  try {
    const rows = await sql`INSERT INTO users (email, name, password_hash) VALUES (${email}, ${name || null}, ${passwordHash})
      RETURNING id, email, name`;
    return rows[0];
  } catch (e) {
    if (e?.code === '23505') throw new HttpError(409, 'Could not create that account. Try signing in instead.');
    throw e;
  }
}
export async function createSession(sql, userId, tokenHash, days = 30) {
  await sql`DELETE FROM sessions WHERE user_id = ${userId} AND expires_at < now()`;
  await sql`INSERT INTO sessions (token_hash, user_id, expires_at)
    VALUES (${tokenHash}, ${userId}, now() + make_interval(days => ${days}))`;
}
export async function getSessionUser(sql, tokenHash) {
  const rows = await sql`SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${tokenHash} AND s.expires_at > now()`;
  return rows[0] || null;
}
export async function getRegular(sql, userId) {
  const rows = await sql`SELECT regular FROM users WHERE id = ${userId}`;
  return Array.isArray(rows[0]?.regular) ? rows[0].regular : [];
}
export const setRegular = (sql, userId, list) => sql`UPDATE users SET regular = ${JSON.stringify(list)}::jsonb WHERE id = ${userId}`;
export const deleteSession = (sql, tokenHash) => sql`DELETE FROM sessions WHERE token_hash = ${tokenHash}`;
export const deleteUser = (sql, userId) => sql`DELETE FROM users WHERE id = ${userId}`;
export async function getUserWithHash(sql, userId) {
  const rows = await sql`SELECT id, password_hash FROM users WHERE id = ${userId}`;
  return rows[0] || null;
}

// ----- trips and tasks -----
export async function listTrips(sql, userId) {
  const [tripRows, taskRows] = await sql.transaction([
    sql`SELECT id, name, trip_type, scope, destination, country, start_date::text AS start_date,
          end_date::text AS end_date, transport, travellers, options, created_at
        FROM trips WHERE user_id = ${userId} ORDER BY start_date, created_at`,
    sql`SELECT id, trip_id, key, title, category, owner, due_date::text AS due_date, status, done_at,
          depends_on, is_key, notes, hint, sort, user_edited
        FROM tasks WHERE user_id = ${userId} ORDER BY trip_id, sort`,
  ]);
  const byTrip = new Map();
  for (const t of taskRows) {
    if (!byTrip.has(t.trip_id)) byTrip.set(t.trip_id, []);
    byTrip.get(t.trip_id).push(mapTask(t));
  }
  return tripRows.map((r) => mapTrip(r, byTrip.get(r.id) || []));
}

export async function getTrip(sql, userId, tripId) {
  const [tripRows, taskRows] = await sql.transaction([
    sql`SELECT id, name, trip_type, scope, destination, country, start_date::text AS start_date,
          end_date::text AS end_date, transport, travellers, options, created_at
        FROM trips WHERE id = ${tripId} AND user_id = ${userId}`,
    sql`SELECT id, trip_id, key, title, category, owner, due_date::text AS due_date, status, done_at,
          depends_on, is_key, notes, hint, sort, user_edited
        FROM tasks WHERE trip_id = ${tripId} AND user_id = ${userId} ORDER BY sort`,
  ]);
  if (!tripRows[0]) return null;
  return mapTrip(tripRows[0], taskRows.map(mapTask));
}

function insertTasks(sql, tripId, userId, tasks) {
  const rows = tasks.map((t, i) => ({
    key: t.key, title: t.title, category: t.category, owner: t.owner, due_date: t.dueDate,
    status: t.status, done_at: t.status === 'done' ? t.doneAt || new Date().toISOString() : null,
    depends_on: t.dependsOn, is_key: t.isKey, notes: t.notes, hint: t.hint, sort: i, user_edited: t.userEdited,
  }));
  return sql`INSERT INTO tasks (trip_id, user_id, key, title, category, owner, due_date, status, done_at,
      depends_on, is_key, notes, hint, sort, user_edited)
    SELECT ${tripId}::uuid, ${userId}::uuid, x.key, x.title, x.category, x.owner, x.due_date, x.status, x.done_at,
      ARRAY(SELECT jsonb_array_elements_text(x.depends_on)), x.is_key, x.notes, x.hint, x.sort, x.user_edited
    FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(key text, title text, category text, owner text,
      due_date date, status text, done_at timestamptz, depends_on jsonb, is_key boolean, notes text, hint text,
      sort int, user_edited boolean)`;
}

const tripValues = (t) => ({
  transport: JSON.stringify(t.transport),
  travellers: JSON.stringify(t.travellers),
  options: JSON.stringify(t.options),
});

export async function countTrips(sql, userId) {
  const rows = await sql`SELECT count(*)::int AS n FROM trips WHERE user_id = ${userId}`;
  return rows[0].n;
}

export async function createTrip(sql, userId, trip, tasks) {
  const id = crypto.randomUUID();
  const v = tripValues(trip);
  await sql.transaction([
    sql`INSERT INTO trips (id, user_id, name, trip_type, scope, destination, country, start_date, end_date,
        transport, travellers, options)
      VALUES (${id}, ${userId}, ${trip.name}, ${trip.type}, ${trip.scope}, ${trip.destination || null},
        ${trip.country || null}, ${trip.startDate}, ${trip.endDate},
        ARRAY(SELECT jsonb_array_elements_text(${v.transport}::jsonb)), ${v.travellers}::jsonb, ${v.options}::jsonb)`,
    insertTasks(sql, id, userId, tasks),
  ]);
  return id;
}

export async function replaceTrip(sql, userId, tripId, trip, tasks) {
  const owned = await sql`SELECT id FROM trips WHERE id = ${tripId} AND user_id = ${userId}`;
  if (!owned[0]) throw new HttpError(404, 'Trip not found');
  const v = tripValues(trip);
  await sql.transaction([
    sql`UPDATE trips SET name = ${trip.name}, trip_type = ${trip.type}, scope = ${trip.scope},
        destination = ${trip.destination || null}, country = ${trip.country || null},
        start_date = ${trip.startDate}, end_date = ${trip.endDate},
        transport = ARRAY(SELECT jsonb_array_elements_text(${v.transport}::jsonb)),
        travellers = ${v.travellers}::jsonb, options = ${v.options}::jsonb, updated_at = now()
      WHERE id = ${tripId} AND user_id = ${userId}`,
    sql`DELETE FROM tasks WHERE trip_id = ${tripId} AND user_id = ${userId}`,
    insertTasks(sql, tripId, userId, tasks),
  ]);
}

export async function deleteTrip(sql, userId, tripId) {
  const rows = await sql`DELETE FROM trips WHERE id = ${tripId} AND user_id = ${userId} RETURNING id`;
  if (!rows[0]) throw new HttpError(404, 'Trip not found');
}

export async function addTask(sql, userId, tripId, task) {
  const owned = await sql`SELECT id FROM trips WHERE id = ${tripId} AND user_id = ${userId}`;
  if (!owned[0]) throw new HttpError(404, 'Trip not found');
  const count = await sql`SELECT count(*)::int AS n, COALESCE(max(sort), -1) + 1 AS next FROM tasks WHERE trip_id = ${tripId}`;
  if (count[0].n >= LIMITS.tasksPerTrip) throw new HttpError(400, 'That trip has the maximum number of tasks.');
  const rows = await sql`INSERT INTO tasks (trip_id, user_id, title, category, owner, due_date, notes, sort, user_edited)
    VALUES (${tripId}, ${userId}, ${task.title}, ${task.category}, ${task.owner}, ${task.dueDate}, ${task.notes}, ${count[0].next}, true)
    RETURNING id, trip_id, key, title, category, owner, due_date::text AS due_date, status, done_at,
      depends_on, is_key, notes, hint, sort, user_edited`;
  return mapTask(rows[0]);
}

export async function patchTask(sql, userId, taskId, patch) {
  const has = (k) => Object.prototype.hasOwnProperty.call(patch, k);
  const status = patch.status === 'done' || patch.status === 'todo' ? patch.status : null;
  const owner = typeof patch.owner === 'string' && patch.owner.trim() ? patch.owner.trim().slice(0, 60) : null;
  const title = typeof patch.title === 'string' && patch.title.trim() ? patch.title.trim().slice(0, 200) : null;
  const dueGiven = has('dueDate');
  const due = dueGiven && isISODate(patch.dueDate) ? patch.dueDate : null;
  if (dueGiven && patch.dueDate && !due) throw new HttpError(400, 'That date is not valid.');
  const notesGiven = has('notes');
  const notes = notesGiven ? String(patch.notes ?? '').slice(0, 2000) : null;
  const edited = !!(owner || title || dueGiven);
  const rows = await sql`UPDATE tasks SET
      status = COALESCE(${status}::text, status),
      done_at = CASE WHEN ${status}::text = 'done' THEN now() WHEN ${status}::text = 'todo' THEN NULL ELSE done_at END,
      owner = COALESCE(${owner}::text, owner),
      title = COALESCE(${title}::text, title),
      due_date = CASE WHEN ${dueGiven}::boolean THEN ${due}::date ELSE due_date END,
      notes = CASE WHEN ${notesGiven}::boolean THEN ${notes}::text ELSE notes END,
      user_edited = user_edited OR ${edited}::boolean,
      updated_at = now()
    WHERE id = ${taskId} AND user_id = ${userId}
    RETURNING id, trip_id, key, title, category, owner, due_date::text AS due_date, status, done_at,
      depends_on, is_key, notes, hint, sort, user_edited`;
  if (!rows[0]) throw new HttpError(404, 'Task not found');
  return mapTask(rows[0]);
}

export async function deleteTask(sql, userId, taskId) {
  const rows = await sql`DELETE FROM tasks WHERE id = ${taskId} AND user_id = ${userId} RETURNING id`;
  if (!rows[0]) throw new HttpError(404, 'Task not found');
}
