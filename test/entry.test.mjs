import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findRule, entryFor, ruleStatus, passportCheck, addMonths } from '../public/js/entry.js';
import { generateTasks, normaliseTrip } from '../public/js/core.js';

const rules = JSON.parse(readFileSync(new URL('../public/data/rules/gb.json', import.meta.url)));
const TODAY = '2026-11-11';
const trip = (over = {}) => normaliseTrip({
  name: 'Spain', type: 'work', scope: 'abroad', country: 'Spain', destination: 'Madrid',
  startDate: '2026-11-17', endDate: '2026-11-21', transport: ['flight'],
  travellers: [{ name: 'Rob', role: 'adult', passport: 'yes', isMe: true, passportExpiry: '2030-01-01' }],
  options: { workActivity: 'meetings', stay: 'booked' }, ...over,
});

test('every rule has confidence, date, official links', () => {
  for (const [k, c] of Object.entries(rules.countries)) {
    const r = findRule(rules, c.name);
    assert.ok(r, k);
    assert.ok(['high', 'medium', 'low'].includes(r.confidence.level), k);
    assert.ok(r.confidence.why, k);
    assert.match(r.checked, /^\d{4}-\d{2}-\d{2}$/, k);
    assert.ok(r.sources.length > 0 && r.sources.every((s) => s.url.startsWith('https://')), k);
    assert.ok(r.entry?.summary && r.stay?.summary && r.passport?.summary, k);
  }
});
test('lookup by name, alias and case', () => {
  assert.equal(findRule(rules, 'spain').name, 'Spain');
  assert.equal(findRule(rules, ' USA ').name, 'United States');
  assert.equal(findRule(rules, 'UAE').name, 'United Arab Emirates');
  assert.equal(findRule(rules, 'Narnia'), null);
});
test('group merge: schengen rules plus country additions', () => {
  const fr = findRule(rules, 'France');
  assert.equal(fr.stay.maxDays, 90);
  assert.ok(fr.carry.some((c) => c.id === 'host') && fr.carry.some((c) => c.id === 'return'));
  assert.equal(findRule(rules, 'Spain').business.confidence.level, 'medium');
  assert.ok(findRule(rules, 'Spain').business.allowed.length > 0);
});
test('staleness after review period', () => {
  const r = findRule(rules, 'Spain');
  assert.equal(ruleStatus(r, TODAY).level, 'high');
  const old = ruleStatus(r, '2027-03-01');
  assert.equal(old.level, 'stale'); assert.equal(old.stale, true);
});
test('passport validity: 3 months after departure', () => {
  const r = findRule(rules, 'Spain'); const t = trip();
  assert.equal(addMonths('2026-11-30', 3), '2027-02-28');
  assert.equal(passportCheck(r, t, '2027-02-20').status, 'short');
  assert.equal(passportCheck(r, t, '2027-02-21').status, 'ok');
  assert.equal(passportCheck(r, t, '').status, 'unknown');
  assert.equal(passportCheck(findRule(rules, 'Ireland'), t, '').status, 'none');
});
test('uncovered country falls back with official index link', () => {
  const e = entryFor(trip({ country: 'Narnia' }), rules, TODAY);
  assert.equal(e.covered, false); assert.match(e.fallbackUrl, /gov\.uk/);
  assert.equal(entryFor(normaliseTrip({ scope: 'uk' }), rules, TODAY).applicable, false);
});
test('Spain business trip generates rule-driven tasks', () => {
  const t = trip(); const e = entryFor(t, rules, TODAY);
  const tasks = generateTasks(t, TODAY, e); const keys = tasks.map((x) => x.key);
  assert.ok(keys.includes('entry_rules'));
  assert.ok(keys.includes('carry_invite') && keys.includes('carry_funds'));
  assert.ok(!keys.some((k) => k.startsWith('visa@')));
  assert.ok(!keys.includes('work_permit'));
  assert.match(tasks.find((x) => x.key === 'entry_rules').title, /yourself/);
});
test('hands-on work adds a work-permit check; expiring passport becomes renew task', () => {
  const t = trip({ options: { workActivity: 'handson' }, travellers: [{ name: 'Rob', isMe: true, passportExpiry: '2027-01-01' }] });
  const tasks = generateTasks(t, TODAY, entryFor(t, rules, TODAY));
  assert.ok(tasks.some((x) => x.key === 'work_permit'));
  assert.match(tasks.find((x) => x.key === 'passport@rob').title, /^Renew/);
});
test('ESTA and TDAC create per-traveller tasks; other nationality gets a check task', () => {
  const us = trip({ country: 'USA', type: 'holiday' });
  assert.ok(generateTasks(us, TODAY, entryFor(us, rules, TODAY)).some((x) => x.key === 'visa@rob' && /ESTA/.test(x.title)));
  const th = trip({ country: 'Thailand', type: 'holiday', travellers: [{ name: 'Rob', isMe: true }, { name: 'Ana', nationality: 'other' }] });
  const keys = generateTasks(th, TODAY, entryFor(th, rules, TODAY)).map((x) => x.key);
  assert.ok(keys.includes('form_tdac@rob') && keys.includes('entry_other@ana') && !keys.includes('form_tdac@ana'));
});
test('without entry data, behaviour is unchanged', () => {
  const keys = generateTasks(trip(), TODAY).map((x) => x.key);
  assert.ok(keys.includes('entry_rules') && !keys.includes('carry_invite'));
});
test('warnings tasks exist for abroad and UK trips, with official links', () => {
  const t = trip(); const a = generateTasks(t, TODAY, entryFor(t, rules, TODAY));
  assert.match(a.find((x) => x.key === 'travel_alerts').hint, /foreign-travel-advice\/spain/);
  assert.ok(a.find((x) => x.key === 'travel_alerts_final').dependsOn.includes('travel_alerts'));
  const uk = generateTasks(normaliseTrip({ ...t, scope: 'uk', country: '' }), TODAY);
  assert.match(uk.find((x) => x.key === 'travel_alerts').hint, /metoffice/);
});
test('destination government links are https and marked destination', () => {
  for (const k of ['spain', 'cyprus', 'ireland', 'turkey', 'japan', 'usa']) {
    const r = findRule(rules, k.replace('usa', 'USA'));
    assert.ok(r.sources.some((x) => x.kind === 'destination' && x.url.startsWith('https://')), k);
  }
});
import { findChanged, classify } from '../scripts/check-rules.mjs';
test('checker flags only pages updated after we checked; classifies link statuses', () => {
  const live = { spain: { updated: '2026-11-14T09:00:00Z', change: 'New text' }, france: { updated: '2026-10-22T09:00:00Z' }, italy: { updated: '2026-11-11T08:00:00Z' } };
  const ch = findChanged(rules, live);
  assert.deepEqual(Object.keys(ch), ['spain']);          // italy updated on the checked date: not flagged
  assert.equal(ch.spain.updated, '2026-11-14');
  assert.equal(classify(404), 'broken'); assert.equal(classify(200), 'ok'); assert.equal(classify(403), 'unknown'); assert.equal(classify(0), 'unknown');
});
test('a changed alert overrides confidence in the status', () => {
  const r = findRule(rules, 'Spain');
  const s = ruleStatus(r, TODAY, { updated: '2026-11-14', change: 'x' });
  assert.equal(s.level, 'changed'); assert.equal(s.stale, true);
  assert.equal(entryFor(trip(), rules, TODAY, { changed: { spain: { updated: '2026-11-14', change: '' } } }).status.level, 'changed');
});
test('dog on a train adds a rules task with the guide link', () => {
  const t = trip({ scope: 'uk', country: '', transport: ['train'], options: { pets: 'travelling' } });
  const d = generateTasks(t, TODAY).find((x) => x.key === 'dogs_on_train');
  assert.ok(d && /nationalrail\.co\.uk\/on-the-train\/train-travel-with-pets\//.test(d.hint) && /thetrainline\.com/.test(d.hint) && d.hint.length < 1000);
  assert.ok(!generateTasks(trip({ scope: 'uk', transport: ['car'], options: { pets: 'travelling' } }), TODAY).some((x) => x.key === 'dogs_on_train'));
});
test('packing and work tasks added; parking only when chosen; work tasks only on work trips', () => {
  const keys = (t) => generateTasks(t, TODAY).map((x) => x.key);
  const w = keys(trip({ options: { parking: true, stay: 'booked' } }));
  for (const k of ['work_clothes', 'work_access', 'work_contacts', 'wallet', 'chargers', 'earbuds', 'glasses', 'medicine', 'toothbrush', 'razor', 'deodorant', 'first_day_kit', 'book_parking', 'transfers']) assert.ok(w.includes(k), k);
  const h = keys(trip({ type: 'holiday', options: { stay: 'none' } }));
  assert.ok(!h.includes('work_clothes') && !h.includes('book_parking') && !h.includes('first_day_kit') && h.includes('toothbrush'));
});
