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
  const t = text();
  assert.match(t, /Entry rules for Spain/);
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
