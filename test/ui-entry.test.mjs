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

import { readFileSync } from 'node:fs';
test('UI: entry rules card shows confidence, dates, official links and the check-it-yourself note', async () => {
  await boot(); await tick();
  state.rules = JSON.parse(readFileSync(new URL('../public/data/rules/gb.json', import.meta.url)));
  window.location.hash = '#/new'; await tick();
  setText('[data-d="name"]', 'Madrid conference');
  radio('scope', 'abroad'); await tick();
  choose('[data-d="type"]', 'work'); await tick();
  assert.ok($('[data-d="options.workActivity"]'), 'work activity question for work trips');
  setText('[data-d="country"]', 'Spain'); fire($('[data-d="country"]'), 'change'); await tick();
  assert.ok($('[data-t="0.nationality"]') && $('[data-t="0.passportExpiry"]'), 'nationality and expiry fields');
  assert.match(text(), /reviewed entry rules for this country/);
  setText('[data-d="destination"]', 'Madrid');
  setText('[data-d="startDate"]', plus(30)); setText('[data-d="endDate"]', plus(34));
  const el = $('[data-t="0.passportExpiry"]'); el.value = plus(60); fire(el, 'change');
  const flight = $('input[data-list="transport"][value="flight"]'); flight.checked = true; fire(flight, 'change'); await tick();
  $('form[data-form="trip"]').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await tick(50);
  assert.doesNotMatch(text(), /Entry rules for Spain/, 'detail is behind the task, not on the page');
  const row = $$('.task').find((li) => /official entry rules for Spain/.test(li.textContent));
  assert.ok(row, 'entry rules task exists');
  row.querySelector('[data-action="expand"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await tick();
  assert.ok($$('.task').some((li) => /alerts|warnings for Spain/i.test(li.textContent)), 'warnings task exists');
  const t = text();
  assert.match(t, /Entry rules for Spain/);
  assert.match(t, /UK government \(UK passport\)/);
  assert.match(t, /The country you are visiting: Spain and the EU/);
  assert.ok($$('.entry a[href*="exteriores.gob.es"]').length === 1, 'destination government link');
  assert.match(t, /High confidence/);
  assert.match(t, /Checked 11 Nov 2026/);
  assert.match(t, /GOV\.UK page updated 10 Nov 2026/);
  assert.match(t, /passport expires too soon/, 'short passport flagged');
  assert.match(t, /Please check this yourself/);
  assert.match(t, /not legal or immigration advice/);
  const links = $$('.entry a[href^="https://www.gov.uk/"]');
  assert.ok(links.length >= 2 && links.every((a) => a.rel.includes('noopener') && a.target === '_blank'));
  assert.match(t, /Check the official entry rules for Spain yourself/);
  assert.match(t, /Renew .*passport/);
  assert.equal($$('[style]').length, 0, 'no inline styles');
  console.log('ok  entry card');
});

import { addDoc, allDocs } from '../public/js/docs.js';
test('UI: My documents screen and the trip Documents section', async () => {
  const f = (n, t) => new window.File([new Uint8Array(500)], n, { type: t });
  window.location.hash = '#/'; await tick();
  assert.ok($('a[href="#/docs"]'), 'My documents link on home');
  await addDoc({ owner: 'guest', level: 'person', person: 'Me', kind: 'insurance', label: 'Annual policy', validFrom: plus(-200), expires: plus(31) }, f('p.pdf', 'application/pdf'));
  state.docs = await allDocs();
  window.location.hash = '#/docs'; await tick();
  assert.match(text(), /My documents/); assert.match(text(), /Annual policy/); assert.match(text(), /Saved on this device only, not uploaded/);
  assert.ok($('form[data-form="doc"][data-level="person"] input[type="file"]'), 'add form');
  assert.match($('form[data-form="doc"]').textContent, /If this device is lost, stolen, broken or reset/, 'loss warning beside the save button');
  const tripId = state.trips[0].id;
  window.location.hash = `#/trip/${tripId}`; await tick();
  assert.match(text(), /Reusable, from My documents/); assert.match(text(), /Annual policy/);
  assert.match(text(), /does not cover the whole trip/, 'expiry before trip end is flagged');
  await addDoc({ owner: 'guest', level: 'trip', tripId, kind: 'ticket', label: 'Outbound boarding pass' }, f('bp.png', 'image/png'));
  state.docs = await allDocs(); window.dispatchEvent(new window.Event('hashchange')); await tick();
  assert.match(text(), /For this trip/); assert.match(text(), /Outbound boarding pass/);
  assert.ok($('details form[data-form="doc"][data-level="trip"]'), 'trip add form');
  assert.equal($$('[style]').length, 0);
  console.log('ok  documents');
});

test('UI: adding your own task asks whether to keep it for future trips', async () => {
  window.location.hash = '#/'; await tick();
  assert.ok(!$('a[href="#/regular"]'), 'no Regular tasks button on the home screen');
  const tripId = state.trips[0].id;
  window.location.hash = `#/trip/${tripId}`; await tick();
  assert.doesNotMatch(text(), /to your other trips too/);
  const form = $('form[data-form="add-task"]');
  form.querySelector('[name="title"]').value = 'Take my football scarf';
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await tick(50);
  assert.match(text(), /Add "Take my football scarf" to your other trips too\?/);
  const before = state.trips[0].tasks.filter((t) => t.title === 'Take my football scarf').length;
  assert.equal(before, 1);
  await click('[data-action="repeat-type"]'); await tick(50);
  assert.doesNotMatch(text(), /to your other trips too/, 'prompt closes');
  assert.equal(state.regular.length, 1); assert.deepEqual(state.regular[0].types, ['work']);
  assert.equal(state.trips[0].tasks.filter((t) => t.title === 'Take my football scarf').length, 1, 'no duplicate on this trip');
  assert.ok(state.trips[0].tasks.some((t) => t.key === `mine_${state.regular[0].id}`));
  assert.doesNotMatch(text(), /Regular tasks|#\/regular/, 'no regular tasks page or link');
  assert.ok(!document.body.innerHTML.includes('#/regular'));

  // removing a task asks how far the removal should go
  const row = $$('.task').find((li) => /Take my football scarf/.test(li.textContent));
  if (row.querySelector('[data-action="expand"]').getAttribute('aria-expanded') !== 'true') { row.querySelector('[data-action="expand"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await tick(); }
  const clickIn = async (li, sel) => { li.querySelector(sel).dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await tick(50); };
  await clickIn($$('.task').find((li) => /Take my football scarf/.test(li.textContent)), '[data-action="delete-task"]');
  assert.match(text(), /Remove this task from:/);
  await clickIn($$('.task').find((li) => /Remove this task from/.test(li.textContent)), '[data-action="del-this"]');
  assert.ok(!state.trips[0].tasks.some((t) => t.title === 'Take my football scarf'), 'gone from this trip');
  assert.equal(state.regular.length, 1, 'still kept for future trips when only this trip was chosen');
  assert.ok(state.trips[0].options.dismissed.includes(`mine_${state.regular[0].id}`));

  // standard task, all work trips going forward
  const std = $$('.task').find((li) => /Pack deodorant/.test(li.textContent));
  if (std.querySelector('[data-action="expand"]').getAttribute('aria-expanded') !== 'true') { std.querySelector('[data-action="expand"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await tick(); }
  await clickIn($$('.task').find((li) => /Pack deodorant/.test(li.textContent)), '[data-action="delete-task"]');
  await clickIn($$('.task').find((li) => /Remove this task from/.test(li.textContent)), '[data-action="del-type"]');
  assert.ok(!state.trips[0].tasks.some((t) => t.key === 'deodorant'));
  assert.ok(state.regular.some((r) => r.suppress === 'deodorant' && r.types.includes('work')));
});
