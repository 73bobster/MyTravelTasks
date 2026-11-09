// Cloudflare Pages Function: the whole JSON API under /api/*.
import { neon } from '@neondatabase/serverless';
import { validateTrip, normaliseTask } from '../../public/js/core.js';
import {
  HttpError, json, parseCookies, sessionCookie, clearCookie, checkOrigin, readJson, COOKIE,
} from '../../server/http.js';
import {
  hashPassword, verifyPassword, dummyVerify, newToken, sha256Hex, checkEmail, passwordProblem,
} from '../../server/auth.js';
import * as db from '../../server/data.js';

const THIRTY_DAYS = 60 * 60 * 24 * 30;
const UUID = '[0-9a-fA-F-]{36}';

function cleanTasks(list) {
  if (!Array.isArray(list)) return [];
  return list.map((t, i) => normaliseTask(t, i)).filter(Boolean).slice(0, db.LIMITS.tasksPerTrip);
}

function cleanTrip(body) {
  const { errors, trip } = validateTrip(body?.trip);
  if (errors.length) throw new HttpError(400, errors[0]);
  return { trip, tasks: cleanTasks(body?.tasks) };
}

export async function onRequest({ request, env, params }) {
  const url = new URL(request.url);
  const secure = url.protocol === 'https:';
  const path = '/' + [].concat(params.path || []).join('/');
  const method = request.method;
  const is = (m, re) => (method === m ? path.match(new RegExp(`^${re}$`)) : null);

  try {
    if (!env.DATABASE_URL) throw new HttpError(500, 'The server is not configured yet.');
    checkOrigin(request, url);
    const sql = neon(env.DATABASE_URL);

    const token = parseCookies(request.headers.get('cookie'))[COOKIE];
    const tokenHash = token ? await sha256Hex(token) : null;
    let user;
    const getUser = async () => {
      if (user === undefined) user = tokenHash ? await db.getSessionUser(sql, tokenHash) : null;
      return user;
    };
    const requireUser = async () => {
      const u = await getUser();
      if (!u) throw new HttpError(401, 'Please sign in.');
      return u;
    };
    const startSession = async (u) => {
      const t = newToken();
      await db.createSession(sql, u.id, await sha256Hex(t));
      return { 'set-cookie': sessionCookie(t, secure, THIRTY_DAYS) };
    };
    const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name || '' });

    // ----- auth -----
    if (is('POST', '/auth/register')) {
      const b = await readJson(request);
      const email = checkEmail(b.email);
      if (!email) throw new HttpError(400, 'Enter a valid email address.');
      const bad = passwordProblem(b.password);
      if (bad) throw new HttpError(400, bad);
      const created = await db.createUser(sql, {
        email, name: String(b.name || '').trim().slice(0, 60), passwordHash: await hashPassword(b.password),
      });
      return json({ user: publicUser(created) }, 201, await startSession(created));
    }

    if (is('POST', '/auth/login')) {
      const b = await readJson(request);
      const email = checkEmail(b.email);
      const found = email ? await db.findUserByEmail(sql, email) : null;
      const ok = found ? await verifyPassword(String(b.password || ''), found.password_hash) : await dummyVerify(String(b.password || ''));
      if (!found || !ok) throw new HttpError(401, 'That email and password do not match.');
      return json({ user: publicUser(found) }, 200, await startSession(found));
    }

    if (is('POST', '/auth/logout')) {
      if (tokenHash) await db.deleteSession(sql, tokenHash);
      return json({ ok: true }, 200, { 'set-cookie': clearCookie(secure) });
    }

    if (is('GET', '/me')) {
      const u = await getUser();
      return json({ user: u ? publicUser(u) : null });
    }

    if (is('DELETE', '/me')) {
      const u = await requireUser();
      const b = await readJson(request);
      const row = await db.getUserWithHash(sql, u.id);
      if (!row || !(await verifyPassword(String(b.password || ''), row.password_hash))) {
        throw new HttpError(403, 'That password is not right.');
      }
      await db.deleteUser(sql, u.id);
      return json({ ok: true }, 200, { 'set-cookie': clearCookie(secure) });
    }

    // ----- trips -----
    if (is('GET', '/trips')) {
      const u = await requireUser();
      return json({ trips: await db.listTrips(sql, u.id) });
    }

    if (is('POST', '/trips')) {
      const u = await requireUser();
      if ((await db.countTrips(sql, u.id)) >= db.LIMITS.trips) throw new HttpError(400, 'You have reached the trip limit.');
      const { trip, tasks } = cleanTrip(await readJson(request));
      const id = await db.createTrip(sql, u.id, trip, tasks);
      return json({ trip: await db.getTrip(sql, u.id, id) }, 201);
    }

    if (is('POST', '/import')) {
      const u = await requireUser();
      const b = await readJson(request, 1048576);
      const items = Array.isArray(b.trips) ? b.trips.slice(0, 20) : [];
      let have = await db.countTrips(sql, u.id);
      for (const item of items) {
        if (have >= db.LIMITS.trips) break;
        const { errors, trip } = validateTrip(item?.trip);
        if (errors.length) continue;
        await db.createTrip(sql, u.id, trip, cleanTasks(item?.tasks));
        have++;
      }
      return json({ trips: await db.listTrips(sql, u.id) }, 201);
    }

    let m;
    if ((m = is('PUT', `/trips/(${UUID})`))) {
      const u = await requireUser();
      const { trip, tasks } = cleanTrip(await readJson(request));
      await db.replaceTrip(sql, u.id, m[1], trip, tasks);
      return json({ trip: await db.getTrip(sql, u.id, m[1]) });
    }

    if ((m = is('DELETE', `/trips/(${UUID})`))) {
      const u = await requireUser();
      await db.deleteTrip(sql, u.id, m[1]);
      return json({ ok: true });
    }

    if ((m = is('POST', `/trips/(${UUID})/tasks`))) {
      const u = await requireUser();
      const b = await readJson(request);
      const task = normaliseTask({ ...b.task, key: null, status: 'todo' }, 0);
      if (!task) throw new HttpError(400, 'Give the task a title.');
      return json({ task: await db.addTask(sql, u.id, m[1], task) }, 201);
    }

    // ----- tasks -----
    if ((m = is('PATCH', `/tasks/(${UUID})`))) {
      const u = await requireUser();
      return json({ task: await db.patchTask(sql, u.id, m[1], await readJson(request)) });
    }

    if ((m = is('DELETE', `/tasks/(${UUID})`))) {
      const u = await requireUser();
      await db.deleteTask(sql, u.id, m[1]);
      return json({ ok: true });
    }

    throw new HttpError(404, 'Not found');
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error('API error', e?.message || e);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
}
