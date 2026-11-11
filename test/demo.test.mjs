import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { demoTrips, seedDemo, samplePdf } from '../public/js/demo.js';
import { entryFor } from '../public/js/entry.js';
import { normaliseTrip, taskRag, tripSummary } from '../public/js/core.js';

const rules = JSON.parse(readFileSync(new URL('../public/data/rules/gb.json', import.meta.url)));
const TODAY = '2026-11-11';
const fakeStore = () => { const trips = []; return { trips, async create(trip, tasks) { const t = { ...trip, id: `t${trips.length}`, tasks: tasks.map((x, i) => ({ ...x, id: `${trips.length}-${i}` })) }; trips.push(t); return t; } }; };

test('demo: six trips, relative to today, rules covered, mix of past and future', async () => {
  const s = fakeStore(); await seedDemo(s, rules, TODAY);
  assert.equal(s.trips.length, 6);
  assert.equal(s.trips.filter((t) => t.endDate < TODAY).length, 2);
  assert.equal(s.trips.filter((t) => t.startDate > TODAY).length, 4);
  for (const t of s.trips) assert.ok(t.tasks.length > 10, t.name);
  const names = s.trips.map((t) => t.name);
  assert.ok(names.includes('Madrid sales conference') && names.includes('Edinburgh weekend with Biscuit'));
  for (const t of demoTrips(TODAY).filter((d) => d.trip.scope === 'abroad')) assert.ok(entryFor(normaliseTrip(t.trip), rules, TODAY).covered, t.trip.country);
});

test('demo: finished trips are complete, Madrid has overdue key tasks, Crete shows a short passport', async () => {
  const s = fakeStore(); await seedDemo(s, rules, TODAY);
  const by = (n) => s.trips.find((t) => t.name === n);
  for (const n of ['Lake District weekend', 'Bangkok and Phuket']) assert.ok(by(n).tasks.every((t) => t.status === 'done'), n);
  const mad = by('Madrid sales conference');
  assert.ok(mad.tasks.some((t) => t.status === 'todo' && taskRag(t, mad.tasks, TODAY) === 'red'), 'overdue');
  assert.ok(tripSummary(mad, mad.tasks, TODAY).total > 0);
  assert.ok(by('Family week in Crete').tasks.some((t) => /^Renew Mia/.test(t.title)), 'short passport flagged');
  assert.ok(by('Edinburgh weekend with Biscuit').tasks.some((t) => t.key === 'dogs_on_train'));
});

test('demo: sample PDF is well formed', () => {
  const t = new TextDecoder().decode(samplePdf(['SAMPLE', 'x (y)']));
  assert.match(t, /^%PDF-1\.4/); assert.match(t, /%%EOF$/); assert.match(t, /startxref\n\d+/);
  const xref = Number(t.match(/startxref\n(\d+)/)[1]);
  assert.equal(t.slice(xref, xref + 4), 'xref');
});
