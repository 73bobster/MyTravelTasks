import {
  TRIP_TYPES, TRANSPORT, normaliseRegular, generateTasks, mergeTasks, validateTrip, normaliseTrip, tripSummary, keyBlockers,
  taskRag, blockedBy, dueLabel, shortDate, groupByWhen, groupByStage, todayISO, daysBetween,
} from './core.js';
import {
  KINDS, kindLabel, addDoc, allDocs, removeDoc, removeWhere, moveOwner, docsForTrip, coverCheck, missingInsurance, sizeLabel, persistent,
} from './docs.js';
import { loadRules, loadAlerts, entryFor, CONFIDENCE, DISCLAIMER, FCDO_INDEX } from './entry.js';
import {
  GuestStore, ApiStore, getSession, forgetSession, importGuestTrips, guestTrips, api, applyPatch,
  loadRegular, saveRegular, clearGuestRegular, loadGuestRegular,
} from './store.js';

const COUNTRIES = ['Albania', 'Australia', 'Austria', 'Belgium', 'Bulgaria', 'Canada', 'Croatia', 'Cyprus', 'Czechia', 'Denmark',
  'Dominican Republic', 'Egypt', 'Estonia', 'Finland', 'France', 'Germany', 'Greece', 'Hungary', 'Iceland', 'India', 'Ireland',
  'Italy', 'Jamaica', 'Japan', 'Kenya', 'Latvia', 'Lithuania', 'Malta', 'Mexico', 'Morocco', 'Netherlands', 'New Zealand',
  'Norway', 'Poland', 'Portugal', 'Romania', 'Singapore', 'Slovakia', 'Slovenia', 'South Africa', 'Spain', 'Sweden',
  'Switzerland', 'Thailand', 'Turkey', 'United Arab Emirates', 'United States'];

const state = {
  ready: false, user: null, store: null, trips: [], offline: false,
  view: 'when', owner: 'all', open: new Set(),
  draft: null, draftFor: null, formErrors: [], busy: false, authError: '',
  toast: '', installEvent: null, lastKey: '', rules: null, alerts: null, docs: [], regular: [],
};

const $app = () => document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const findTrip = (id) => state.trips.find((t) => t.id === id);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const shortTitle = (s, n = 44) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

const TICK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.8"/></svg>';

// ---------- toast ----------
let toastTimer;
function toast(msg) {
  state.toast = msg;
  render();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { state.toast = ''; render(); }, 3500);
}

// ---------- routing ----------
function route() {
  const parts = (location.hash.replace(/^#/, '') || '/').split('/').filter(Boolean);
  if (!parts.length) return { name: 'home' };
  if (parts[0] === 'new') return { name: 'new' };
  if (parts[0] === 'trip' && parts[1]) return parts[2] === 'edit' ? { name: 'edit', id: parts[1] } : { name: 'trip', id: parts[1] };
  if (parts[0] === 'signin') return { name: 'auth', mode: 'login' };
  if (parts[0] === 'register') return { name: 'auth', mode: 'register' };
  if (parts[0] === 'account') return { name: 'account' };
  if (parts[0] === 'docs') return { name: 'docs' };
  if (parts[0] === 'regular') return { name: 'regular' };
  return { name: 'home' };
}

// ---------- shared view bits ----------
function tripDates(trip) {
  const nights = daysBetween(trip.startDate, trip.endDate);
  return `${shortDate(trip.startDate)} – ${shortDate(trip.endDate)} ${trip.endDate.slice(0, 4)} · ${plural(nights, 'night')}`;
}
const where = (trip) => [trip.destination, trip.scope === 'abroad' ? trip.country : ''].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', ') || (trip.scope === 'abroad' ? 'Abroad' : 'UK');
function overallPill(sum) {
  if (sum.finished) return '<span class="pill neutral">Finished</span>';
  return `<span class="pill rag-${sum.overall}">${esc(sum.overallLabel)}</span>`;
}

function layout(inner) {
  const nav = [
    state.installEvent ? '<button type="button" data-action="install">Install app</button>' : '',
    state.user ? '<a href="#/account">Account</a>' : '<a href="#/signin">Sign in</a>',
  ].join('');
  return `
    ${state.offline ? '<div class="offline-bar" role="status">You are offline. You can read your trips; changes need a connection.</div>' : ''}
    <header class="app-header"><div class="container">
      <a class="brand" href="#/"><img src="/icons/icon-192.png" alt="" width="30" height="30"> My Travel Tasks</a>
      <nav class="nav" aria-label="Main">${nav}</nav>
    </div></header>
    <main class="container" id="main" tabindex="-1">${inner}</main>
    <footer class="app-footer">A <a href="https://cobaltpinksoftware.com">Cobalt Pink Software</a> app</footer>
    ${state.toast ? `<div class="toast" role="status">${esc(state.toast)}</div>` : ''}`;
}

// ---------- home ----------
function viewHome() {
  const today = todayISO();
  const rows = state.trips
    .map((t) => ({ t, s: tripSummary(t, t.tasks, today) }))
    .sort((a, b) => (a.s.finished - b.s.finished) || a.t.startDate.localeCompare(b.t.startDate));

  const banner = state.user ? '' : `
    <section class="card tint" aria-label="Guest mode">
      <h2>You're using My Travel Tasks as a guest</h2>
      <p class="small">Your trips are saved on this device only. Create a free account to keep them safe and open them on any device.</p>
      <div class="actions"><a class="btn btn-primary btn-small" href="#/register">Create free account</a><a class="btn btn-secondary btn-small" href="#/signin">Sign in</a></div>
    </section>`;

  if (!rows.length) {
    return `<div class="stack">${banner}
      <section class="card empty">
        <h2>Where are you off to?</h2>
        <p class="muted">Answer a few questions about your trip and get a dated checklist, a countdown and a clear view of what is still holding you up.</p>
        <a class="btn btn-primary" href="#/new">Plan your first trip</a>
      </section></div>`;
  }

  return `<div class="stack">
    <div class="row between"><h1>Your trips</h1><span class="row"><a class="btn btn-secondary" href="#/regular">Regular tasks</a><a class="btn btn-secondary" href="#/docs">My documents</a><a class="btn btn-primary" href="#/new">Plan a trip</a></span></div>
    ${banner}
    ${rows.map(({ t, s }) => `
      <a class="card trip-card" href="#/trip/${esc(t.id)}">
        <div class="row between"><h2>${esc(t.name)}</h2>${overallPill(s)}</div>
        <div class="meta">${esc(where(t))} · ${esc(tripDates(t))}</div>
        <div class="row between small">
          <strong>${esc(s.countdown.label)}</strong>
          <span class="muted">${s.done} of ${s.total} done</span>
        </div>
        <progress max="100" value="${s.pct}" aria-label="${s.pct}% of tasks done"></progress>
      </a>`).join('')}
  </div>`;
}

// ---------- trip dashboard ----------
function ownerList(trip) {
  const names = new Set();
  for (const t of trip.tasks) names.add(t.owner);
  for (const t of trip.travellers) if (t.name) names.add(t.name);
  names.add('Everyone');
  return [...names];
}

function linkify(text) {
  return esc(text).replace(/https?:\/\/[^\s<]+/g, (u) => {
    const m = u.match(/[.,;:)]+$/); const tail = m ? m[0] : ''; const url = tail ? u.slice(0, -tail.length) : u;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>${tail}`;
  });
}

function taskRow(trip, task, today) {
  const all = trip.tasks;
  const done = task.status === 'done';
  const rag = taskRag(task, all, today);
  const waiting = done ? [] : blockedBy(task, all);
  const open = state.open.has(task.id);
  const dueCls = rag === 'red' || rag === 'amber' ? `rag-${rag}` : '';
  const owners = ownerList(trip);
  if (!owners.includes(task.owner)) owners.push(task.owner);

  return `
  <li class="task ${done ? 'done' : `rag-${rag}`}" data-task="${esc(task.id)}">
    <button type="button" class="check" role="checkbox" aria-checked="${done}" aria-label="${done ? 'Mark not done' : 'Mark done'}: ${esc(task.title)}" data-action="toggle" data-id="${esc(task.id)}">${TICK}</button>
    <div class="task-main">
      <button type="button" class="task-title" aria-expanded="${open}" data-action="expand" data-id="${esc(task.id)}">${esc(task.title)}</button>
      <div class="task-meta">
        <span class="chip">${esc(task.owner)}</span>
        ${done ? '<span>Done</span>' : `<span class="due ${dueCls}">${esc(dueLabel(task.dueDate, today))}</span>`}
        ${task.isKey && !done ? '<span class="chip key">Key</span>' : ''}
        ${waiting.length ? `<span class="chip waiting">Waiting on: ${esc(waiting.slice(0, 2).map((w) => w.title.replace(/^(Apply for|Check|Find|Book|Get)\s+/i, '')).join(', '))}${waiting.length > 2 ? '…' : ''}</span>` : ''}
      </div>
      ${open ? `
      <div class="task-detail">
        ${task.hint ? `<p class="hint">${linkify(task.hint)}</p>` : ''}
        ${task.key === 'entry_rules' ? viewEntryCard(trip) : ''}
        <div class="two">
          <label class="field">Who
            <select data-field="owner" data-id="${esc(task.id)}">${owners.map((o) => `<option ${o === task.owner ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>
          </label>
          <label class="field">Due
            <input type="date" data-field="dueDate" data-id="${esc(task.id)}" value="${esc(task.dueDate || '')}">
          </label>
        </div>
        <label class="field">Notes
          <textarea data-field="notes" data-id="${esc(task.id)}" placeholder="Booking reference, links, who to call…">${esc(task.notes)}</textarea>
        </label>
        <div><button type="button" class="btn btn-ghost btn-small" data-action="delete-task" data-id="${esc(task.id)}">Remove task</button></div>
      </div>` : ''}
    </div>
  </li>`;
}

const tripEntry = (trip) => entryFor(normaliseTrip(trip), state.rules, todayISO(), state.alerts);
const fmtDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const sourceGroups = (e, r) => {
  const uk = r.sources.filter((x) => x.kind !== 'destination');
  const dest = r.sources.filter((x) => x.kind === 'destination');
  return `<h4 class="small-h">Your passport's government: UK government (UK passport)</h4>${linkList(uk)}
    <h4 class="small-h">The country you are visiting: ${esc(r.name)}${r.group ? ' and the EU' : ''}</h4>
    ${dest.length ? linkList(dest) : `<p class="small muted">We haven't added an official ${esc(r.name)} government page for this yet. Search for ${esc(r.name)}'s official immigration or foreign ministry site and compare it with the UK page.</p>`}
    ${e.hasNonGB ? '<h4 class="small-h">Travellers with another passport</h4><p class="small muted">Use your own government\'s foreign travel advice for ' + esc(r.name) + ', as well as the destination pages above.</p>' : ''}`;
};
const linkList = (sources) => `<ul class="source-list">${sources.map((x) =>
  `<li><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.label)}</a></li>`).join('')}</ul>`;

function viewEntryCard(trip) {
  const e = tripEntry(trip);
  if (!e.applicable) return '';
  const checkNote = `<p class="check-note"><strong>Please check this yourself.</strong> ${esc(DISCLAIMER)}</p>`;
  if (!e.covered) {
    return `<section class="entry" aria-label="Entry rules">
      <h2>Entry rules for ${esc(e.country)}</h2>
      <p><span class="conf conf-none">Not covered yet</span></p>
      <p class="small">We don't have reviewed rules for ${esc(e.country)} yet. Start with the UK government's travel advice for the country, and read its "Entry requirements" section.</p>
      <h4 class="small-h">Your passport's government</h4>${linkList([{ label: 'GOV.UK: Foreign travel advice for UK passport holders (find your destination)', url: FCDO_INDEX }])}
      <h4 class="small-h">The country you are visiting</h4><p class="small muted">Search for ${esc(e.country)}'s official immigration or foreign ministry site and compare it with the UK page.</p>
      ${checkNote}</section>`;
  }
  const r = e.rule, st = e.status;
  const lines = [['Visa or entry', r.entry?.summary], ['How long you can stay', r.stay?.summary], ['Passport', r.passport?.summary]]
    .filter(([, v]) => v).map(([k, v]) => `<div class="rule-line"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
  const auth = r.authorisation && r.authorisation.required
    ? `<div class="rule-line"><dt>${esc(r.authorisation.name)}</dt><dd>${esc(r.authorisation.summary)} <a href="${esc(r.authorisation.applyUrl)}" target="_blank" rel="noopener noreferrer">${esc(r.authorisation.applyLabel)}</a></dd></div>` : '';
  const biz = e.work && r.business
    ? `<div class="rule-line"><dt>Business visit <span class="conf conf-${esc(r.business.confidence?.level || 'medium')} small-conf">${esc(CONFIDENCE[r.business.confidence?.level || 'medium'].label)}</span></dt><dd>${esc(r.business.summary)}${r.business.confidence?.why ? ` <span class="muted">${esc(r.business.confidence.why)}</span>` : ''}</dd></div>` : '';
  const pass = e.travellers.filter((t) => t.gb && t.passport.status !== 'none').map((t) => {
    const p = t.passport;
    const msg = p.status === 'ok' ? `passport expiry meets the rule (needs to run to ${fmtDate(p.neededBy)} or later)`
      : p.status === 'short' ? `passport expires too soon: it needs to run to ${fmtDate(p.neededBy)} or later`
      : 'add a passport expiry date when editing the trip to check this';
    return `<li class="pp-${p.status}">${esc(t.name || 'Traveller')}: ${esc(msg)}</li>`;
  }).join('');
  return `<section class="entry" aria-label="Entry rules">
    <h2>Entry rules for ${esc(r.name)} <span class="small muted">UK passport</span></h2>
    <p class="conf-row"><span class="conf conf-${st.level}">${esc(st.label)}</span>
      <span class="small">Checked ${esc(fmtDate(r.checked))}${r.fcdoUpdated ? ` · GOV.UK page updated ${esc(fmtDate(r.fcdoUpdated))}` : ''}</span></p>
    <p class="small">${esc(st.means)}${r.confidence?.why ? ` ${esc(r.confidence.why)}` : ''}</p>
    ${st.level === 'changed' ? `<p class="warn small"><strong>GOV.UK updated this advice on ${esc(fmtDate(st.changedOn))}, after we checked it.</strong>${st.change ? ` Its note says: ${esc(st.change)}` : ''} Read the official page below before relying on this summary.</p>` : st.stale ? '<p class="warn small"><strong>This is more than 90 days old.</strong> Check the official pages below.</p>' : ''}
    ${e.hasNonGB ? '<p class="warn small">Rules shown are for UK passports only. Check other travellers\' passports separately.</p>' : ''}
    <dl class="rules">${lines}${auth}${biz}</dl>
    ${pass ? `<ul class="pp-list">${pass}</ul>` : ''}
    ${e.carry.length ? `<details><summary>What you may be asked for at the border (${e.carry.length})</summary><ul>${e.carry.map((c) => `<li>${esc(c.text)}</li>`).join('')}</ul>${r.hostAdvice.map((h) => `<p class="small muted">${esc(h)}</p>`).join('')}</details>` : ''}
    ${r.other.length || r.notices.length ? `<details><summary>Other things to know (${r.other.length + r.notices.length})</summary><ul>${[...r.notices.map((n) => n.text), ...r.other].map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}
    <h3 class="small-h">Official sources: check these yourself</h3>
    ${sourceGroups(e, r)}
    ${checkNote}
  </section>`;
}

// ---------- documents (kept on this device) ----------
const docOwner = () => (state.user ? String(state.user.id ?? state.user.email ?? 'account') : 'guest');
async function refreshDocs() { try { state.docs = await allDocs(); } catch { state.docs = []; } }
const NOTE_PRIVATE = 'Saved on this device only, not uploaded. Please don\'t save passport or ID scans: officers need the real passport, and a lost phone would expose them.';

const NOTE_LOSS = 'If this device is lost, stolen, broken or reset, or you clear your browser data, these files are lost with it. Keep the originals somewhere else too, such as your email, cloud storage or paper.';

function docList(docs, { person = false } = {}) {
  if (!docs.length) return '';
  return `<ul class="doc-list">${docs.map((d) => `<li>
    <div class="doc-main"><strong>${esc(d.label)}</strong>
      <span class="small muted">${esc(kindLabel(d.kind))}${person && d.person ? ` · ${esc(d.person)}` : ''} · ${esc(sizeLabel(d.size))}${d.expires ? ` · valid to ${esc(fmtDate(d.expires))}` : ''}</span></div>
    <div class="doc-actions"><button type="button" class="btn btn-secondary btn-small" data-action="open-doc" data-id="${esc(d.id)}">Open</button>
      <button type="button" class="btn btn-ghost btn-small" data-action="remove-doc" data-id="${esc(d.id)}" aria-label="Remove ${esc(d.label)}">Remove</button></div></li>`).join('')}</ul>`;
}

function peopleNames() {
  const set = new Map();
  const add = (n) => { const k = String(n || '').trim(); if (k) set.set(k.toLowerCase(), k); };
  add(myName());
  for (const t of state.trips) for (const x of t.travellers || []) add(x.name);
  for (const d of state.docs) if (d.person) add(d.person);
  return [...set.values()];
}

function docForm(level, tripId = '') {
  const kinds = KINDS.filter((k) => k.level === level || k.level === 'both');
  return `<form data-form="doc" data-level="${level}" data-trip="${esc(tripId)}" class="stack doc-form" novalidate>
    ${level === 'person' ? `<label class="field">Whose is it?<input type="text" name="person" maxlength="40" list="people" value="${esc(myName())}" autocomplete="off">
      <datalist id="people">${peopleNames().map((n) => `<option value="${esc(n)}">`).join('')}</datalist></label>` : ''}
    <div class="grid">
      <label class="field">What is it?<select name="kind">${kinds.map((k) => `<option value="${k.id}">${esc(k.label)}</option>`).join('')}</select></label>
      <label class="field">Name it<input type="text" name="label" maxlength="80" placeholder="${level === 'person' ? 'e.g. Annual multi-trip policy' : 'e.g. Outbound boarding pass'}" autocomplete="off"></label>
    </div>
    ${level === 'person' ? `<div class="grid">
      <label class="field">Valid from<input type="date" name="validFrom"><span class="help">Optional. Lets us check it covers a trip.</span></label>
      <label class="field">Valid to<input type="date" name="expires"></label></div>` : ''}
    <label class="field">Photo or PDF<input type="file" name="file" accept="image/*,application/pdf"><span class="help">Take a photo or choose a file, up to 15 MB.</span></label>
    <p class="warn small"><strong>Saved on this device only.</strong> ${esc(NOTE_LOSS)}</p>
    <div><button class="btn btn-primary btn-small" type="submit">Save on this device</button></div>
  </form>`;
}

function viewTripDocs(trip) {
  const { trip: tdocs, people } = docsForTrip(state.docs, docOwner(), trip);
  const noIns = missingInsurance(state.docs, docOwner(), trip);
  const warns = people.filter((d) => d.kind === 'insurance').map((d) => ({ d, c: coverCheck(d, trip) })).filter((x) => x.c === 'outside');
  return `<section class="card docs" aria-label="Documents">
    <h2>Documents</h2>
    <p class="small muted">${esc(NOTE_PRIVATE)}</p>
    <p class="warn small">${esc(NOTE_LOSS)}</p>
    ${persistent ? '' : '<p class="warn small">This browser is not keeping files between visits (private mode?), so they will be lost when you close it.</p>'}
    ${noIns.length ? `<p class="notice small">No travel insurance saved for ${esc(noIns.join(', '))}. A policy saved once under <a href="#/docs">My documents</a> is used for every trip.</p>` : ''}
    ${warns.map(({ d }) => `<p class="warn small"><strong>${esc(d.person)}'s ${esc(d.label)} does not cover the whole trip</strong> (${esc(shortDate(trip.startDate))} to ${esc(shortDate(trip.endDate))}). Check its dates.</p>`).join('')}
    ${people.length ? `<h3 class="small-h">Reusable, from My documents</h3>${docList(people, { person: true })}` : ''}
    ${tdocs.length ? `<h3 class="small-h">For this trip</h3>${docList(tdocs)}` : ''}
    <details><summary>Add a ticket, boarding pass or booking</summary>${docForm('trip', trip.id)}</details>
  </section>`;
}

function viewDocs() {
  const mine = state.docs.filter((d) => d.owner === docOwner());
  const people = mine.filter((d) => d.level === 'person');
  const tripDocs = mine.filter((d) => d.level === 'trip');
  const byPerson = [...new Set(people.map((d) => d.person || 'Unnamed'))];
  return `<div class="stack">
    <div><a href="#/" class="small">← All trips</a></div>
    <h1>My documents</h1>
    <p class="warn"><strong>Saved on this device only.</strong> ${esc(NOTE_LOSS)}</p>
    <p class="notice">${esc(NOTE_PRIVATE)} Save a document here once, such as annual travel insurance, and every trip with that person on it can use it. Tickets and bookings are added from the trip itself.</p>
    ${persistent ? '' : '<p class="warn small">This browser is not keeping files between visits (private mode?), so they will be lost when you close it.</p>'}
    ${byPerson.length ? byPerson.map((n) => `<section class="card"><h2>${esc(n)}</h2>${docList(people.filter((d) => (d.person || 'Unnamed') === n))}</section>`).join('') : '<div class="card empty"><p class="muted">Nothing saved yet.</p></div>'}
    <section class="card"><h2>Add a document</h2>${docForm('person')}</section>
    ${tripDocs.length ? `<section class="card"><h2>Trip documents</h2>${[...new Set(tripDocs.map((d) => d.tripId))].map((id) => `<h3 class="small-h">${esc(findTrip(id)?.name || 'Trip')}</h3>${docList(tripDocs.filter((d) => d.tripId === id))}`).join('')}</section>` : ''}
  </div>`;
}

async function saveDoc(form) {
  const fd = new FormData(form);
  const level = form.dataset.level;
  const person = String(fd.get('person') || '').trim();
  if (level === 'person' && !person) { toast('Say whose document it is.'); return; }
  try {
    await addDoc({
      owner: docOwner(), level, person, tripId: form.dataset.trip, kind: fd.get('kind'), label: fd.get('label'),
      validFrom: fd.get('validFrom'), expires: fd.get('expires'),
    }, fd.get('file'));
    await refreshDocs();
    toast('Saved on this device');
    render();
  } catch (e) { toast(e.message || 'Could not save that file.'); }
}

function openDoc(id) {
  const d = state.docs.find((x) => x.id === id);
  if (!d || typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(d.blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}

function viewTrip(id) {
  const trip = findTrip(id);
  if (!trip) return `<div class="card empty"><h2>We can't find that trip</h2><p class="muted">It may have been deleted, or it lives in a different account.</p><a class="btn btn-primary" href="#/">Back to your trips</a></div>`;

  const today = todayISO();
  const sum = tripSummary(trip, trip.tasks, today);
  const blockers = sum.finished ? [] : keyBlockers(trip.tasks, today, 4);
  const owners = ownerList(trip).filter((o) => trip.tasks.some((t) => t.owner === o));
  const filtered = state.owner === 'all' ? trip.tasks : trip.tasks.filter((t) => t.owner === state.owner);
  const groups = state.view === 'stage' ? groupByStage(filtered) : groupByWhen(filtered, today);
  const openCount = (o) => trip.tasks.filter((t) => t.owner === o && t.status !== 'done').length;

  const list = groups.map((g) => {
    const rows = `<ul class="tasks">${g.tasks.map((t) => taskRow(trip, t, today)).join('')}</ul>`;
    if (state.view === 'when' && g.id === 'done') return `<details class="done-group"><summary>Done (${g.tasks.length})</summary>${rows}</details>`;
    return `<section class="group"><h3>${esc(g.label)} <span class="count">${g.tasks.length}</span></h3>${rows}</section>`;
  }).join('');

  return `<div class="stack">
    <div><a href="#/" class="small">← All trips</a></div>

    <section class="hero on-dark" aria-label="Trip status">
      <div class="count"><div class="big">${esc(sum.countdown.big)}</div><div class="unit">${esc(sum.countdown.unit)}</div></div>
      <div>
        <h1>${esc(trip.name)}</h1>
        <div class="meta">${esc(where(trip))} · ${esc(tripDates(trip))}</div>
        ${overallPill(sum)}
        <div class="progress-line"><progress max="100" value="${sum.pct}" aria-label="${sum.pct}% of tasks done"></progress>
          ${sum.done} of ${sum.total} done${sum.overdue ? ` · ${plural(sum.overdue, 'task')} overdue` : ''}</div>
      </div>
    </section>

    ${blockers.length ? `
    <section class="card blockers" aria-label="Key dependencies">
      <h2>What's holding you up</h2>
      <p class="small muted">Sort these first. They unlock other tasks or are due soon.</p>
      <ul>${blockers.map((b) => {
        const names = b.blocks.slice(0, 1).map((x) => shortTitle(x.title, 36)).join('; ');
        const more = b.blocks.length - 1;
        const sub = [dueLabel(b.task.dueDate, today), b.blocks.length ? `holding up ${plural(b.blocks.length, 'task')}` : ''].filter(Boolean).join(' · ');
        return `
        <li><span class="dot rag-${b.rag}" aria-hidden="true"></span>
          <div class="msg"><strong>${esc(b.task.title)}</strong>
            <span class="sub">${esc(sub)}</span>
            ${names ? `<span class="sub">Unlocks: ${esc(names)}${more > 0 ? ` +${more} more` : ''}</span>` : ''}</div>
          <button type="button" class="btn btn-secondary btn-small" data-action="toggle" data-id="${esc(b.task.id)}" aria-label="Mark done: ${esc(b.task.title)}">Done</button></li>`;
      }).join('')}
      </ul>
    </section>` : ''}

    ${viewTripDocs(trip)}

    <div class="row between">
      <div class="chips" role="group" aria-label="Filter by person">
        <button type="button" class="chip" aria-pressed="${state.owner === 'all'}" data-action="owner" data-value="all">Everyone's tasks</button>
        ${owners.map((o) => `<button type="button" class="chip" aria-pressed="${state.owner === o}" data-action="owner" data-value="${esc(o)}">${esc(o)} (${openCount(o)})</button>`).join('')}
      </div>
      <div class="segmented" role="group" aria-label="Group tasks">
        <button type="button" aria-pressed="${state.view === 'when'}" data-action="view" data-value="when">By date</button>
        <button type="button" aria-pressed="${state.view === 'stage'}" data-action="view" data-value="stage">By stage</button>
      </div>
    </div>

    ${list || '<p class="muted">No tasks for this person.</p>'}

    <details class="card add-task">
      <summary>Add your own task</summary>
      <form data-form="add-task" data-id="${esc(trip.id)}">
        <label class="field">Task<input type="text" name="title" required maxlength="200" placeholder="e.g. Buy a guidebook"></label>
        <div class="two">
          <label class="field">Who<select name="owner">${ownerList(trip).map((o) => `<option>${esc(o)}</option>`).join('')}</select></label>
          <label class="field">Due<input type="date" name="dueDate"></label>
        </div>
        <label class="field">Repeat
          <select name="repeat">
            <option value="trip">This trip only</option>
            <option value="type">Every ${esc((TRIP_TYPES.find((t) => t.id === trip.type)?.label || 'trip').toLowerCase())} I plan</option>
            <option value="all">Every trip I plan</option>
          </select>
          <span class="help">Repeating tasks are kept in <a href="#/regular">Regular tasks</a> and added whenever you plan or edit a matching trip.</span></label>
        <div><button class="btn btn-primary btn-small" type="submit">Add task</button></div>
      </form>
    </details>

    <div class="actions">
      <a class="btn btn-secondary btn-small" href="#/trip/${esc(trip.id)}/edit">Edit trip details</a>
      <button type="button" class="btn btn-danger btn-small" data-action="delete-trip" data-id="${esc(trip.id)}">Delete trip</button>
    </div>
  </div>`;
}

// ---------- trip form ----------
function myName() { return (state.user?.name || '').split(' ')[0] || 'Me'; }

function newDraft() {
  return {
    name: '', type: 'holiday', who: 'me', scope: 'uk', destination: '', country: '', startDate: '', endDate: '',
    organiser: myName(), transport: [],
    travellers: [{ name: myName(), role: 'adult', passport: 'yes', isMe: true }],
    options: { visa: 'unsure', stay: 'need', carHire: false, parking: false, drivingAbroad: false, handLuggageOnly: false, childConsent: false, pets: 'none' },
  };
}
function draftFromTrip(trip) {
  const n = normaliseTrip(trip);
  const hasMe = n.travellers.some((t) => t.isMe);
  return { ...n, who: !hasMe ? 'others' : n.travellers.length > 1 ? 'group' : 'me' };
}
function setWho(who) {
  const d = state.draft;
  const blank = () => ({ name: '', role: 'adult', passport: 'unsure' });
  d.who = who;
  if (who === 'me') {
    const me = d.travellers.find((t) => t.isMe) || { name: myName(), role: 'adult', passport: 'yes' };
    d.travellers = [{ ...me, isMe: true }];
  } else if (who === 'group') {
    if (!d.travellers.some((t) => t.isMe)) d.travellers.unshift({ name: myName(), role: 'adult', passport: 'yes', isMe: true });
    if (d.travellers.length < 2) d.travellers.push(blank());
  } else {
    d.travellers = d.travellers.filter((t) => !t.isMe);
    if (!d.travellers.length) d.travellers.push(blank());
    d.organiser = myName();
  }
}

const radio = (path, value, label, help, current) =>
  `<label class="choice"><input type="radio" name="${path}" data-d="${path}" value="${esc(value)}" ${String(current) === String(value) ? 'checked' : ''}><span>${esc(label)}${help ? `<span class="help">${esc(help)}</span>` : ''}</span></label>`;
const option = (value, label, current) => `<option value="${esc(value)}" ${value === current ? 'selected' : ''}>${esc(label)}</option>`;

const draftCovered = (d) => { const e = tripEntry(d); return !!e.covered; };

function viewForm(editingId) {
  const d = state.draft;
  const abroad = d.scope === 'abroad';
  const flying = d.transport.includes('flight');
  const driving = d.transport.includes('car') || d.options.carHire;
  const anyChild = d.travellers.some((t) => t.role !== 'adult');
  const today = todayISO();
  const o = d.options;

  return `
  <form data-form="trip" class="stack" novalidate>
    <div><a href="${editingId ? `#/trip/${esc(editingId)}` : '#/'}" class="small">← Cancel</a></div>
    <h1>${editingId ? 'Edit trip' : 'Plan a trip'}</h1>
    ${editingId ? '<p class="notice">Your progress, notes and any changes you made to tasks are kept. Tasks that no longer apply are removed and new ones are added.</p>' : ''}
    ${state.formErrors.length ? `<div class="error" role="alert"><ul>${state.formErrors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}

    <fieldset class="card">
      <legend>The trip</legend>
      <label class="field">What shall we call it?<input type="text" data-d="name" value="${esc(d.name)}" maxlength="80" placeholder="e.g. Lisbon with the kids" autocomplete="off"></label>
      <label class="field">What kind of trip is it?
        <select data-d="type">${TRIP_TYPES.map((t) => option(t.id, t.label, d.type)).join('')}</select></label>
      <div>
        <div class="field" id="who-label">Who is it for?</div>
        <div class="choices cols" role="radiogroup" aria-labelledby="who-label">
          ${radio('who', 'me', 'Just me', '', d.who)}
          ${radio('who', 'group', 'Me and others', 'Family, friends, colleagues', d.who)}
          ${radio('who', 'others', "Someone else", "I'm organising it for them", d.who)}
        </div>
      </div>
    </fieldset>

    <fieldset class="card">
      <legend>When and where</legend>
      <div class="two">
        <label class="field">First day<input type="date" data-d="startDate" value="${esc(d.startDate)}" ${editingId ? '' : `min="${today}"`}></label>
        <label class="field">Last day<input type="date" data-d="endDate" value="${esc(d.endDate)}" min="${esc(d.startDate)}"></label>
      </div>
      <div class="choices cols" role="radiogroup" aria-label="Where to">
        ${radio('scope', 'uk', 'In the UK', '', d.scope)}
        ${radio('scope', 'abroad', 'Abroad', 'Passports, entry rules, insurance', d.scope)}
      </div>
      <label class="field">Where are you going?<input type="text" data-d="destination" value="${esc(d.destination)}" maxlength="80" placeholder="e.g. Lisbon" autocomplete="off"></label>
      ${abroad ? `
      <label class="field">Country<input type="text" data-d="country" value="${esc(d.country)}" maxlength="60" list="countries" placeholder="e.g. Portugal" autocomplete="off">
        <datalist id="countries">${COUNTRIES.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
      ${draftCovered(d) ? '<p class="notice">We have reviewed entry rules for this country for UK passports. They appear on your trip with their source links.</p>' : ''}
      ${abroad && d.type === 'work' ? `<label class="field">What will you actually do there?
        <span class="help">Meetings and events are normally allowed on a visit. Being paid locally or hands-on work may need a permit.</span>
        <select data-d="options.workActivity">${option('meetings', 'Meetings, conferences or training only', o.workActivity)}${option('handson', 'Hands-on or paid work, installing or servicing', o.workActivity)}${option('unsure', 'Not sure', o.workActivity)}</select></label>` : ''}
      ${draftCovered(d) ? '' : `<label class="field">Do you need a visa or travel authorisation?
        <span class="help">Rules differ by nationality. If you're not sure, we'll add a task to check first.</span>
        <select data-d="options.visa">${option('unsure', "Not sure yet", o.visa)}${option('no', 'No', o.visa)}${option('yes', 'Yes', o.visa)}</select></label>`}` : ''}
    </fieldset>

    <fieldset class="card">
      <legend>Who's going</legend>
      ${d.travellers.map((t, i) => `
      <div class="traveller">
        <div class="grid">
          <label class="field">Name<input type="text" data-t="${i}.name" value="${esc(t.name)}" maxlength="40" placeholder="Name" autocomplete="off"></label>
          <label class="field">Age group<select data-t="${i}.role">${option('adult', 'Adult', t.role)}${option('child', 'Child', t.role)}${option('infant', 'Infant (under 2)', t.role)}</select></label>
        </div>
        ${abroad ? `<div class="grid"><label class="field">Passport country<select data-t="${i}.nationality">${option('GB', 'United Kingdom (British)', t.nationality || 'GB')}${option('other', 'Another country', t.nationality)}</select></label>
        <label class="field">Passport expiry date<input type="date" data-t="${i}.passportExpiry" value="${esc(t.passportExpiry || '')}"><span class="help">Optional. Lets us check the destination's validity rule.</span></label></div>
        <label class="field">Passport<select data-t="${i}.passport">${option('yes', 'Has a passport', t.passport)}${option('no', "Doesn't have one yet", t.passport)}${option('unsure', 'Not sure', t.passport)}</select></label>` : ''}
        ${t.isMe ? '<span class="small muted">This is you</span>' : (d.travellers.length > 1 ? `<div><button type="button" class="btn btn-ghost btn-small" data-action="rm-traveller" data-i="${i}">Remove</button></div>` : '')}
      </div>`).join('')}
      <div><button type="button" class="btn btn-secondary btn-small" data-action="add-traveller">+ Add a traveller</button></div>
    </fieldset>

    <fieldset class="card">
      <legend>How you're getting there</legend>
      <div class="choices cols compact">
        ${TRANSPORT.map((t) => `<label class="choice"><input type="checkbox" data-list="transport" value="${t.id}" ${d.transport.includes(t.id) ? 'checked' : ''}><span>${t.label}</span></label>`).join('')}
      </div>
      <div>
        <div class="field" id="stay-label">Where are you staying?</div>
        <div class="choices cols" role="radiogroup" aria-labelledby="stay-label">
          ${radio('options.stay', 'need', 'Still to book', '', o.stay)}
          ${radio('options.stay', 'booked', 'Already booked', '', o.stay)}
          ${radio('options.stay', 'none', 'Staying with friends or family', '', o.stay)}
          ${radio('options.stay', 'notrequired', 'Not required', 'For example a day trip', o.stay)}
        </div>
      </div>
      <div class="choices">
        <label class="choice"><input type="checkbox" data-d="options.carHire" ${o.carHire ? 'checked' : ''}><span>I'll hire a car</span></label>
        ${abroad && driving ? `<label class="choice"><input type="checkbox" data-d="options.drivingAbroad" ${o.drivingAbroad ? 'checked' : ''}><span>I'll be driving abroad</span></label>` : ''}
        ${d.transport.some((m) => m !== 'car') ? `<label class="choice"><input type="checkbox" data-d="options.parking" ${o.parking ? 'checked' : ''}><span>I'll park at the ${flying ? 'airport' : 'station or port'}<span class="help">Adds a parking booking task</span></span></label>` : ''}
        ${flying ? `<label class="choice"><input type="checkbox" data-d="options.handLuggageOnly" ${o.handLuggageOnly ? 'checked' : ''}><span>Hand luggage only</span></label>` : ''}
        ${abroad && anyChild ? `<label class="choice"><input type="checkbox" data-d="options.childConsent" ${o.childConsent ? 'checked' : ''}><span>Children travelling without both parents<span class="help">Adds a consent letter task</span></span></label>` : ''}
      </div>
      <label class="field">Pets
        <select data-d="options.pets">${option('none', 'No pets to sort', o.pets)}${option('sitter', 'Pets staying home (need care)', o.pets)}${option('travelling', 'Pets are coming too', o.pets)}</select></label>
    </fieldset>

    <div class="actions">
      <button class="btn btn-primary" type="submit" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Saving…' : editingId ? 'Save changes' : 'Create my checklist'}</button>
    </div>
  </form>`;
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => o[k], obj);
  target[last] = value;
}

// ---------- auth + account ----------
function viewAuth(mode) {
  const register = mode === 'register';
  const hasGuest = guestTrips().length > 0;
  return `<div class="stack">
    <h1>${register ? 'Create your free account' : 'Sign in'}</h1>
    <p class="muted">${register ? 'Keep your trips safe and open them on any device.' : 'Welcome back.'}</p>
    ${state.authError ? `<div class="error" role="alert">${esc(state.authError)}</div>` : ''}
    <form class="card" data-form="auth" data-mode="${mode}">
      ${register ? '<label class="field">Your name <span class="help">Optional. Used to label your own tasks.</span><input type="text" name="name" autocomplete="given-name" maxlength="60"></label>' : ''}
      <label class="field">Email<input type="email" name="email" required autocomplete="email"></label>
      <label class="field">Password${register ? '<span class="help">At least 10 characters.</span>' : ''}<input type="password" name="password" required minlength="${register ? 10 : 1}" autocomplete="${register ? 'new-password' : 'current-password'}"></label>
      ${hasGuest ? `<label class="choice"><input type="checkbox" name="bring" checked><span>Bring my ${plural(guestTrips().length, 'guest trip')} with me</span></label>` : ''}
      <div class="actions"><button class="btn btn-primary" type="submit" ${state.busy ? 'disabled' : ''}>${state.busy ? 'One moment…' : register ? 'Create account' : 'Sign in'}</button></div>
    </form>
    <p class="small">${register ? 'Already have an account? <a href="#/signin">Sign in</a>' : 'New here? <a href="#/register">Create a free account</a>'}</p>
  </div>`;
}

function viewAccount() {
  if (!state.user) return `<div class="card empty"><h2>You're not signed in</h2><a class="btn btn-primary" href="#/signin">Sign in</a></div>`;
  return `<div class="stack">
    <h1>Your account</h1>
    <section class="card"><p><strong>${esc(state.user.name || 'Signed in')}</strong><br><span class="muted">${esc(state.user.email)}</span></p>
      <p class="small muted">${plural(state.trips.length, 'trip')} saved to your account.</p>
      <div class="actions"><button class="btn btn-secondary btn-small" data-action="export">Download my data</button><button class="btn btn-secondary btn-small" data-action="signout">Sign out</button></div>
    </section>
    <section class="card">
      <h2>Delete my account</h2>
      <p class="small muted">This permanently deletes your account and all your trips. It can't be undone.</p>
      ${state.authError ? `<div class="error" role="alert">${esc(state.authError)}</div>` : ''}
      <form data-form="delete-account">
        <label class="field">Confirm with your password<input type="password" name="password" required autocomplete="current-password"></label>
        <div><button class="btn btn-danger btn-small" type="submit">Delete account and trips</button></div>
      </form>
    </section>
  </div>`;
}

// ---------- render ----------
export function render() {
  const el = $app();
  if (!el) return;
  const r = route();
  if (r.name !== 'new' && r.name !== 'edit') { state.draft = null; state.draftFor = null; state.formErrors = []; }
  if (r.name !== 'auth' && r.name !== 'account') state.authError = '';

  let html;
  let title = 'My Travel Tasks';
  if (!state.ready) html = '<p class="muted">Loading…</p>';
  else if (r.name === 'new') {
    if (!state.draft || state.draftFor !== 'new') { state.draft = newDraft(); state.draftFor = 'new'; state.formErrors = []; }
    html = viewForm(null); title = 'Plan a trip · My Travel Tasks';
  } else if (r.name === 'edit') {
    const trip = findTrip(r.id);
    if (!trip) html = viewTrip(r.id);
    else {
      if (!state.draft || state.draftFor !== r.id) { state.draft = draftFromTrip(trip); state.draftFor = r.id; state.formErrors = []; }
      html = viewForm(r.id); title = 'Edit trip · My Travel Tasks';
    }
  } else if (r.name === 'trip') { html = viewTrip(r.id); title = `${findTrip(r.id)?.name || 'Trip'} · My Travel Tasks`; }
  else if (r.name === 'auth') { html = viewAuth(r.mode); title = (r.mode === 'register' ? 'Create account' : 'Sign in') + ' · My Travel Tasks'; }
  else if (r.name === 'account') { html = viewAccount(); title = 'Account · My Travel Tasks'; }
  else if (r.name === 'regular') { html = viewRegular(); title = 'Regular tasks · My Travel Tasks'; }
  else if (r.name === 'docs') { html = viewDocs(); title = 'My documents · My Travel Tasks'; }
  else html = viewHome();

  el.innerHTML = layout(html);
  document.title = title;

  const key = JSON.stringify(r);
  if (key !== state.lastKey) {
    state.lastKey = key;
    window.scrollTo?.(0, 0);
    document.getElementById('main')?.focus?.({ preventScroll: true });
  }
}

// ---------- actions ----------
async function loadTrips() {
  try {
    state.trips = await state.store.list();
    state.offline = !!state.store.offline;
  } catch (e) {
    state.trips = [];
    toast(e.message);
  }
}

async function patchTask(tripId, taskId, patch, { quiet = false } = {}) {
  const trip = findTrip(tripId);
  const i = trip?.tasks.findIndex((t) => t.id === taskId);
  if (!trip || i < 0) return;
  const before = trip.tasks[i];
  trip.tasks[i] = applyPatch(before, patch);
  if (!quiet) render();
  try {
    const saved = await state.store.patchTask(tripId, taskId, patch);
    const j = trip.tasks.findIndex((t) => t.id === taskId);
    if (j >= 0 && saved) trip.tasks[j] = { ...trip.tasks[j], ...saved };
    if (!quiet) render();
  } catch (e) {
    const j = trip.tasks.findIndex((t) => t.id === taskId);
    if (j >= 0) trip.tasks[j] = before;
    toast(e.message);
  }
}

async function submitTrip() {
  const d = state.draft;
  const { errors, trip } = validateTrip(d);
  if (errors.length) { state.formErrors = errors; render(); window.scrollTo?.(0, 0); return; }
  state.busy = true; state.formErrors = []; render();
  try {
    const generated = generateTasks(trip, todayISO(), tripEntry(trip), state.regular);
    let saved;
    if (state.draftFor !== 'new') {
      const existing = findTrip(state.draftFor);
      saved = await state.store.update(state.draftFor, trip, mergeTasks(existing.tasks, generated));
      state.trips = state.trips.map((t) => (t.id === saved.id ? saved : t));
    } else {
      saved = await state.store.create(trip, generated);
      state.trips.push(saved);
    }
    state.busy = false; state.draft = null; state.draftFor = null;
    state.owner = 'all';
    location.hash = `#/trip/${saved.id}`;
    render();
  } catch (e) {
    state.busy = false; state.formErrors = [e.message]; render(); window.scrollTo?.(0, 0);
  }
}

async function submitAuth(form) {
  const mode = form.dataset.mode;
  const fd = new FormData(form);
  state.busy = true; state.authError = ''; render();
  try {
    const { user } = await api(mode === 'register' ? '/auth/register' : '/auth/login', {
      method: 'POST', body: { email: fd.get('email'), password: fd.get('password'), name: fd.get('name') || '' },
    });
    state.user = user;
    state.store = new ApiStore();
    let note = mode === 'register' ? 'Account created' : 'Signed in';
    if (fd.get('bring') === 'on') {
      try {
        const before = guestTrips();
        const all = await importGuestTrips();
        const map = {};
        for (const g of before) { const m = all.find((t) => t.name === g.name && t.startDate === g.startDate); if (m) map[g.id] = m.id; }
        await moveOwner('guest', docOwner(), map); await refreshDocs();
        note += ', and your guest trips are saved';
      }
      catch (e) { note += `, but your guest trips could not be moved (${e.message})`; }
    }
    try {
      const server = await loadRegular(state.user);
      const mine = loadGuestRegular();
      state.regular = mine.length && fd.get('bring') === 'on'
        ? await saveRegular(state.user, normaliseRegular([...server, ...mine.filter((m) => !server.some((x) => x.title === m.title))]))
        : server;
      if (mine.length && fd.get('bring') === 'on') clearGuestRegular();
    } catch { state.regular = []; }
    await loadTrips();
    state.busy = false;
    location.hash = '#/';
    toast(note);
  } catch (e) {
    state.busy = false; state.authError = e.message; render();
  }
}

async function signOut() {
  try { await api('/auth/logout', { method: 'POST' }); } catch { /* cookie is cleared server side when online */ }
  forgetSession();
  state.user = null; state.store = new GuestStore(); state.offline = false;
  state.regular = await loadRegular(null);
  await loadTrips();
  location.hash = '#/';
  toast('Signed out');
}

async function deleteAccount(form) {
  const password = new FormData(form).get('password');
  state.authError = '';
  try {
    const scope = docOwner();
    await api('/me', { method: 'DELETE', body: { password } });
    await removeWhere((d) => d.owner === scope); await refreshDocs();
    forgetSession();
    state.user = null; state.store = new GuestStore();
    state.regular = await loadRegular(null);
    await loadTrips();
    location.hash = '#/';
    toast('Your account has been deleted');
  } catch (e) {
    state.authError = e.message; render();
  }
}

function exportData() {
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), trips: state.trips, regularTasks: state.regular }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'my-travel-tasks.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function addTask(form) {
  const tripId = form.dataset.id;
  const fd = new FormData(form);
  const title = String(fd.get('title') || '').trim();
  if (!title) return;
  const repeat = String(fd.get('repeat') || 'trip');
  const trip0 = findTrip(tripId);
  if (repeat !== 'trip' && trip0) {
    try {
      const due = fd.get('dueDate');
      const days = due ? Math.max(0, daysBetween(due, trip0.startDate)) : 1;
      await saveRegularList([...state.regular, { title, types: repeat === 'type' ? [trip0.type] : [], when: 'any', days }]);
      await regenerateTrip(tripId);
      render();
      toast('Added, and kept for future trips');
    } catch (e) { toast(e.message); }
    return;
  }
  try {
    const task = await state.store.addTask(tripId, {
      title, category: 'My tasks', owner: fd.get('owner') || 'Everyone', dueDate: fd.get('dueDate') || null, notes: '',
    });
    findTrip(tripId).tasks.push(task);
    render();
    toast('Task added');
  } catch (e) { toast(e.message); }
}

// ---------- regular tasks ----------
async function saveRegularList(list) {
  state.regular = await saveRegular(state.user, normaliseRegular(list));
}

async function regenerateTrip(tripId) {
  const existing = findTrip(tripId);
  const t = normaliseTrip(existing);
  const saved = await state.store.update(tripId, t, mergeTasks(existing.tasks, generateTasks(t, todayISO(), tripEntry(t), state.regular)));
  state.trips = state.trips.map((x) => (x.id === saved.id ? saved : x));
}

function viewRegular() {
  const label = (r) => (r.types.length ? r.types.map((id) => TRIP_TYPES.find((t) => t.id === id)?.label || id).join(', ') : 'Every trip');
  const when = { any: 'UK or abroad', uk: 'UK trips', abroad: 'Trips abroad' };
  return `<div class="stack">
    <div><a href="#/" class="small">← All trips</a></div>
    <h1>Regular tasks</h1>
    <p class="notice">Tasks that are yours, such as "take my football scarf". They are added to every trip of the kind you choose, when you plan or edit it. They are private to you and don't change anyone else's checklist. ${state.user ? 'They are saved to your account.' : 'They are saved on this device. Create an account to keep them across devices.'}</p>
    ${state.regular.length ? `<ul class="doc-list">${state.regular.map((r) => `<li>
      <div class="doc-main"><strong>${esc(r.title)}</strong><span class="small muted">${esc(label(r))} · ${esc(when[r.when])} · ${r.days === 0 ? 'on the day' : `${plural(r.days, 'day')} before`}</span></div>
      <div class="doc-actions"><button type="button" class="btn btn-ghost btn-small" data-action="remove-regular" data-id="${esc(r.id)}" aria-label="Remove ${esc(r.title)}">Remove</button></div></li>`).join('')}</ul>` : '<div class="card empty"><p class="muted">No regular tasks yet.</p></div>'}
    <section class="card"><h2>Add a regular task</h2>
      <form data-form="regular" class="stack" novalidate>
        <label class="field">Task<input type="text" name="title" maxlength="120" placeholder="e.g. Take my football scarf" autocomplete="off"></label>
        <div class="grid">
          <label class="field">Add it to<select name="type"><option value="">Every trip</option>${TRIP_TYPES.map((t) => `<option value="${t.id}">${esc(t.label)}</option>`).join('')}</select></label>
          <label class="field">Where<select name="when"><option value="any">UK or abroad</option><option value="uk">UK trips only</option><option value="abroad">Trips abroad only</option></select></label>
        </div>
        <label class="field">Due<select name="days"><option value="0">On the day</option><option value="1" selected>1 day before</option><option value="2">2 days before</option><option value="7">A week before</option><option value="14">2 weeks before</option></select></label>
        <div><button class="btn btn-primary btn-small" type="submit">Add regular task</button></div>
      </form></section>
    <p class="small muted">New regular tasks reach a trip you have already planned when you open it, choose "Edit trip details" and save.</p>
  </div>`;
}

async function addRegular(form) {
  const fd = new FormData(form);
  const title = String(fd.get('title') || '').trim();
  if (!title) { toast('Type the task first.'); return; }
  try {
    await saveRegularList([...state.regular, { title, types: fd.get('type') ? [fd.get('type')] : [], when: fd.get('when'), days: Number(fd.get('days')) }]);
    render(); toast('Added');
  } catch (e) { toast(e.message); }
}

// ---------- events ----------
const REDRAW_PATHS = new Set(['scope', 'who', 'options.carHire', 'type']);

function onClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, id, value } = el.dataset;
  const r = route();
  switch (action) {
    case 'toggle': patchTask(r.id, id, { status: findTrip(r.id)?.tasks.find((t) => t.id === id)?.status === 'done' ? 'todo' : 'done' }); break;
    case 'expand': state.open.has(id) ? state.open.delete(id) : state.open.add(id); render(); break;
    case 'owner': state.owner = value; render(); break;
    case 'view': state.view = value; render(); break;
    case 'delete-task':
      if (confirm('Remove this task?')) {
        const trip = findTrip(r.id);
        state.store.removeTask(r.id, id).then(() => { trip.tasks = trip.tasks.filter((t) => t.id !== id); render(); }).catch((err) => toast(err.message));
      }
      break;
    case 'remove-regular':
      saveRegularList(state.regular.filter((x) => x.id !== id)).then(render).catch((err) => toast(err.message));
      break;
    case 'open-doc': openDoc(id); break;
    case 'remove-doc':
      if (confirm('Remove this document from this device?')) removeDoc(id).then(refreshDocs).then(render);
      break;
    case 'delete-trip':
      if (confirm('Delete this trip and all its tasks? This cannot be undone.')) {
        state.store.remove(id).then(() => removeWhere((d) => d.tripId === id)).then(refreshDocs).then(() => { state.trips = state.trips.filter((t) => t.id !== id); location.hash = '#/'; render(); toast('Trip deleted'); }).catch((err) => toast(err.message));
      }
      break;
    case 'add-traveller':
      state.draft.travellers.push({ name: '', role: 'adult', passport: 'unsure' });
      if (state.draft.who === 'me') state.draft.who = 'group';
      render();
      [...document.querySelectorAll('[data-t$=".name"]')].pop()?.focus();
      break;
    case 'rm-traveller': {
      const i = Number(el.dataset.i);
      state.draft.travellers.splice(i, 1);
      render();
      break;
    }
    case 'signout': signOut(); break;
    case 'export': exportData(); break;
    case 'install': state.installEvent?.prompt(); state.installEvent = null; render(); break;
    default: break;
  }
}

function onInput(e) {
  const el = e.target;
  if (!state.draft) return;
  if (el.matches('[data-d]') && (el.type === 'text' || el.type === 'date')) setPath(state.draft, el.dataset.d, el.value);
  if (el.matches('[data-t]') && el.type === 'text') {
    const [i, field] = el.dataset.t.split('.');
    state.draft.travellers[Number(i)][field] = el.value;
  }
}

function onChange(e) {
  const el = e.target;
  // task detail fields
  if (el.matches('[data-field]')) {
    const { field, id } = el.dataset;
    const patch = field === 'dueDate' ? { dueDate: el.value || null } : { [field]: el.value };
    patchTask(route().id, id, patch, { quiet: field === 'notes' });
    return;
  }
  if (!state.draft) return;
  if (el.matches('[data-list]')) {
    const list = state.draft[el.dataset.list];
    const at = list.indexOf(el.value);
    if (el.checked && at < 0) list.push(el.value);
    if (!el.checked && at >= 0) list.splice(at, 1);
    render();
    return;
  }
  if (el.matches('[data-t]')) {
    const [i, field] = el.dataset.t.split('.');
    state.draft.travellers[Number(i)][field] = el.value;
    if (field === 'role') render();
    return;
  }
  if (el.matches('[data-d="country"]')) { setPath(state.draft, 'country', el.value); render(); return; }
  if (el.matches('[data-d]') && el.type !== 'text' && el.type !== 'date') {
    const path = el.dataset.d;
    const value = el.type === 'checkbox' ? el.checked : el.value;
    if (path === 'who') setWho(value); else setPath(state.draft, path, value);
    if (REDRAW_PATHS.has(path)) render();
  }
}

function onSubmit(e) {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  switch (form.dataset.form) {
    case 'trip': submitTrip(); break;
    case 'auth': submitAuth(form); break;
    case 'add-task': addTask(form); break;
    case 'doc': saveDoc(form); break;
    case 'regular': addRegular(form); break;
    case 'delete-account': deleteAccount(form); break;
    default: break;
  }
}

// ---------- boot ----------
export async function boot() {
  const { user, offline } = await getSession();
  state.user = user;
  state.store = user ? new ApiStore() : new GuestStore();
  loadAlerts().then((a) => { state.alerts = a; if (state.ready) render(); });
  loadRules('GB').then((r) => { state.rules = r; if (state.ready) render(); });
  await refreshDocs();
  state.regular = await loadRegular(user);
  await loadTrips();
  state.offline = user ? offline || state.offline : false; // guests work fully offline, so no warning for them
  state.ready = true;

  const root = $app();
  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  root.addEventListener('submit', onSubmit);
  window.addEventListener('hashchange', render);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
  window.addEventListener('beforeinstallprompt', (ev) => { ev.preventDefault(); state.installEvent = ev; render(); });
  window.addEventListener('online', async () => { if (state.offline) { await loadTrips(); render(); } });

  render();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('/sw.js').catch(() => {});
}

export { state };
if (typeof document !== 'undefined' && !globalThis.__MTT_TEST__) boot();
