// UI test: runs the real app.js in jsdom (guest mode, no network) and drives it through the DOM.
import test from 'node:test';
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;
window.scrollTo = () => {};
window.confirm = () => true;
const g = globalThis;
g.__MTT_TEST__ = true;
for (const k of ['window', 'document', 'location', 'localStorage', 'FormData', 'Blob', 'Event', 'HTMLElement']) {
  Object.defineProperty(g, k, { value: k === 'window' ? window : window[k], configurable: true, writable: true });
}
Object.defineProperty(g, 'navigator', { value: window.navigator, configurable: true });
g.confirm = window.confirm;
g.fetch = () => Promise.reject(new TypeError('no network in smoke test'));

const APP = new URL('../public/js/app.js', import.meta.url).href;
const { boot, state } = await import(APP);
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true, cancelable: true }));
const setText = (sel, v) => { const el = $(sel); el.value = v; fire(el, 'input'); };
const choose = (sel, v) => { const el = $(sel); el.value = v; fire(el, 'change'); };
const radio = (name, v) => { const el = $(`input[name="${name}"][value="${v}"]`); el.checked = true; fire(el, 'change'); };
const click = async (sel) => { $(sel).dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await tick(); };
const iso = (d) => d.toISOString().slice(0, 10);
const plus = (n) => iso(new Date(Date.now() + n * 86400000));
const text = () => $('#app').textContent.replace(/\s+/g, ' ');

test('UI: plan, track, edit and delete a trip as a guest', async () => {
  await boot();
  await tick();
  assert.match(text(), /Where are you off to\?/, 'empty home');
  assert.match(text(), /as a guest/, 'guest banner');
  assert.doesNotMatch(text(), /offline/i, 'no offline bar for a guest');
  console.log('ok  home (empty, guest)');

  // ----- plan an abroad trip with a child, passport not yet obtained -----
  window.location.hash = '#/new';
  await tick();
  assert.ok($('form[data-form="trip"]'), 'form renders');
  setText('[data-d="name"]', 'Lisbon with the kids');
  radio('who', 'group');
  await tick();
  assert.equal($$('[data-t$=".name"]').length, 2, 'group adds a second traveller row');
  setText('[data-t="1.name"]', 'Sam');
  choose('[data-t="1.role"]', 'child');
  await tick();
  radio('scope', 'abroad');
  await tick();
  assert.ok($('[data-d="country"]'), 'country appears when abroad');
  setText('[data-d="country"]', 'Portugal');
  setText('[data-d="destination"]', 'Lisbon');
  choose('[data-t="0.passport"]', 'no');
  setText('[data-d="startDate"]', plus(40));
  setText('[data-d="endDate"]', plus(47));
  const flight = $('input[data-list="transport"][value="flight"]'); flight.checked = true; fire(flight, 'change');
  await tick();
  assert.ok($('[data-d="options.handLuggageOnly"]'), 'hand luggage option appears when flying');
  assert.ok($('[data-d="options.childConsent"]'), 'child consent option appears with a child abroad');
  $('form[data-form="trip"]').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await tick(50);

  assert.match(window.location.hash, /^#\/trip\//, 'navigated to the trip');
  const t = text();
  assert.match(t, /Lisbon with the kids/);
  assert.match(t, /40\s*days to go/, 'countdown');
  assert.match(t, /holding you up/i, 'dependencies panel');
  assert.match(t, /Apply for .*passport/i, 'passport task present');
  assert.match(t, /Rob|Me/, 'organiser chip present');
  assert.equal(state.trips.length, 1);
  const saved = JSON.parse(window.localStorage.getItem('mtt.guest.v1')).trips;
  assert.equal(saved.length, 1, 'persisted to localStorage');
  assert.ok(saved[0].tasks.length > 15, 'tasks generated and saved');
  console.log('ok  create trip ->', saved[0].tasks.length, 'tasks; overall:', $('.hero .pill').textContent.trim());

  // ----- the passport blocker is explained, and clearing it removes it -----
  const trip = state.trips[0];
  const passport = trip.tasks.find((x) => x.key?.startsWith('passport@') && x.title.includes('Apply for'));
  assert.ok(passport, 'passport application task exists');
  const blockerText = () => $('.blockers')?.textContent.replace(/\s+/g, ' ') || '';
  assert.match(blockerText(), /passport/i, 'passport shown as a blocker');
  assert.match(blockerText(), /holding up \d+ tasks/i, 'says how much it is holding up');
  assert.match(blockerText(), /Unlocks: .*Book flights/i, 'names what it unlocks');
  assert.doesNotMatch(blockerText(), /Book flights \(outbound and return\) · /, 'blocked booking is not listed as its own blocker');
  $(`.blockers [data-action="toggle"][data-id="${passport.id}"]`).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick();
  assert.equal(state.trips[0].tasks.find((x) => x.id === passport.id).status, 'done');
  assert.doesNotMatch(blockerText(), /Apply for .*passport/i, 'passport blocker cleared');
  console.log('ok  blocker explained and cleared');

  // ----- tick a task off, progress responds and persists -----
  const before = state.trips[0].tasks.filter((x) => x.status === 'done').length;
  const target = state.trips[0].tasks.find((x) => x.status === 'todo' && x.key === 'forecast');
  await click(`.tasks [data-action="toggle"][data-id="${target.id}"]`);
  const after = state.trips[0].tasks.filter((x) => x.status === 'done').length;
  assert.equal(after, before + 1, 'task completed');
  assert.equal(JSON.parse(window.localStorage.getItem('mtt.guest.v1')).trips[0].tasks.filter((x) => x.status === 'done').length, after, 'completion persisted');
  assert.match(text(), /Done \(2\)/, 'done group appears');
  console.log('ok  toggle task');

  // ----- filters, view toggle, expand, edit owner, add task -----
  await click('[data-action="view"][data-value="stage"]');
  assert.ok($$('.group h3').some((h) => /Documents/.test(h.textContent)), 'stage view has Documents');
  const owners = $$('[data-action="owner"]');
  assert.ok(owners.length >= 2, 'owner filter chips');
  owners[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await tick();
  assert.equal($$('[data-action="owner"][aria-pressed="true"]').length, 1);
  await click('[data-action="owner"][data-value="all"]');

  const firstTitle = $('.task-title');
  firstTitle.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await tick();
  assert.ok($('.task-detail'), 'task expands');
  const ownerSel = $('select[data-field="owner"]');
  ownerSel.value = 'Everyone'; fire(ownerSel, 'change'); await tick();
  const edited = state.trips[0].tasks.find((x) => x.id === ownerSel.dataset.id);
  assert.equal(edited.owner, 'Everyone'); assert.equal(edited.userEdited, true);

  setText('form[data-form="add-task"] input[name="title"]', 'Buy a guidebook');
  $('form[data-form="add-task"]').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await tick(50);
  assert.ok(state.trips[0].tasks.some((x) => x.title === 'Buy a guidebook'), 'custom task added');
  console.log('ok  filter, view, expand, edit owner, add task');

  // ----- edit trip keeps progress, regenerates -----
  const doneBefore = state.trips[0].tasks.filter((x) => x.status === 'done').map((x) => x.key).filter(Boolean);
  window.location.hash = `#/trip/${state.trips[0].id}/edit`;
  await tick();
  assert.equal($('[data-d="name"]').value, 'Lisbon with the kids', 'form prefilled');
  const train = $('input[data-list="transport"][value="train"]'); train.checked = true; fire(train, 'change'); await tick();
  $('form[data-form="trip"]').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await tick(50);
  const afterEdit = state.trips[0].tasks;
  assert.ok(afterEdit.some((x) => x.key === 'book_transport@train'), 'train booking added');
  for (const k of doneBefore) assert.equal(afterEdit.find((x) => x.key === k)?.status, 'done', `kept done: ${k}`);
  assert.ok(afterEdit.some((x) => x.title === 'Buy a guidebook'), 'custom task kept');
  console.log('ok  edit trip keeps progress');

  // ----- home list, then delete -----
  window.location.hash = '#/'; await tick();
  assert.match(text(), /Your trips/); assert.match(text(), /Lisbon with the kids/); assert.match(text(), /of \d+ done/);
  window.location.hash = `#/trip/${state.trips[0].id}`; await tick();
  await click('[data-action="delete-trip"]');
  await tick(30);
  assert.equal(state.trips.length, 0, 'trip deleted');
  assert.match(text(), /Where are you off to\?/);
  console.log('ok  home list + delete');

  // ----- auth screens render and validate client side -----
  window.location.hash = '#/register'; await tick();
  assert.ok($('form[data-form="auth"][data-mode="register"]'));
  assert.match($('input[name="password"]').getAttribute('minlength'), /10/);
  window.location.hash = '#/signin'; await tick();
  assert.ok($('form[data-form="auth"][data-mode="login"]'));
  console.log('ok  auth screens');

  // ----- no inline styles / handlers anywhere (strict CSP) -----
  window.location.hash = '#/new'; await tick();
  const html = $('#app').innerHTML;
  assert.doesNotMatch(html, /\sstyle="/, 'no inline style attributes');
  assert.doesNotMatch(html, /\son[a-z]+="/, 'no inline handlers');
  console.log('ok  CSP-clean markup');

  window.close();
});
