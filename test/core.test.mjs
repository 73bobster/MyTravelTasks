import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateTasks, mergeTasks, taskRag, tripSummary, keyBlockers, countdownFor,
  validateTrip, groupByWhen, groupByStage, dueLabel, daysBetween, addDays, blockedBy,
} from '../public/js/core.js';

const TODAY = '2026-11-09';

const abroadTrip = (over = {}) => ({
  name: 'Lisbon',
  type: 'holiday',
  scope: 'abroad',
  country: 'Portugal',
  startDate: '2027-02-10',
  endDate: '2027-02-17',
  transport: ['flight'],
  travellers: [
    { name: 'Rob', role: 'adult', passport: 'no', isMe: true },
    { name: 'Sam', role: 'child', passport: 'yes' },
  ],
  options: { visa: 'no', stay: 'need' },
  ...over,
});
const ukTrip = () => ({
  name: 'Edinburgh',
  type: 'minibreak',
  scope: 'uk',
  startDate: '2026-12-04',
  endDate: '2026-12-06',
  transport: ['train'],
  travellers: [{ name: 'Rob', role: 'adult', isMe: true }],
  options: { stay: 'booked' },
});
const keys = (tasks) => tasks.map((t) => t.key);
const find = (tasks, k) => tasks.find((t) => t.key === k);

test('date helpers', () => {
  assert.equal(daysBetween('2026-11-09', '2026-11-12'), 3);
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(dueLabel('2026-11-08', TODAY), '1 day overdue');
  assert.equal(dueLabel('2026-11-09', TODAY), 'Due today');
  assert.equal(dueLabel('2026-11-12', TODAY), 'Due in 3 days');
  assert.equal(dueLabel('2027-02-01', TODAY), 'Due 1 Feb');
});

test('validateTrip catches bad input', () => {
  assert.ok(validateTrip({}).errors.length >= 3);
  const bad = validateTrip({ ...abroadTrip(), endDate: '2027-02-01' });
  assert.ok(bad.errors.some((e) => /before the start/.test(e)));
  assert.equal(validateTrip(abroadTrip()).errors.length, 0);
});

test('abroad trip generates passport, entry, insurance and bookings with owners', () => {
  const t = generateTasks(abroadTrip(), TODAY);
  const k = keys(t);
  for (const want of ['passport@rob', 'passport@sam', 'entry_rules', 'insurance', 'book_transport@flight', 'book_stay', 'checkin', 'pack_child@sam', 'return_checkin']) {
    assert.ok(k.includes(want), `missing ${want}`);
  }
  assert.ok(!k.includes('visa@rob'), 'no visa tasks when visa not needed');
  assert.match(find(t, 'passport@rob').title, /Apply for Rob's passport/);
  assert.equal(find(t, 'pack_child@sam').owner, 'Rob', 'parent owns child tasks');
  assert.equal(new Set(k).size, k.length, 'keys unique');
});

test('visa tasks depend on passport and entry rules', () => {
  const t = generateTasks(abroadTrip({ options: { visa: 'yes', stay: 'need' } }), TODAY);
  const visa = find(t, 'visa@rob');
  assert.ok(visa);
  assert.deepEqual(visa.dependsOn, ['passport@rob', 'entry_rules']);
});

test('UK trip has no passport, insurance or visa tasks', () => {
  const k = keys(generateTasks(ukTrip(), TODAY));
  assert.ok(!k.some((x) => /passport|visa|insurance|entry_rules/.test(x)));
  assert.ok(k.includes('book_transport@train'));
  assert.ok(!k.includes('book_stay'), 'stay already booked');
  assert.ok(k.includes('stay_confirm'));
});

test('work trips need approval before booking', () => {
  const t = generateTasks({ ...ukTrip(), type: 'work' }, TODAY);
  assert.ok(find(t, 'approval'));
  assert.ok(find(t, 'book_transport@train').dependsOn.includes('approval'));
  assert.ok(find(t, 'expenses_claim'));
});

test('late planning clamps due dates to today, never in the past', () => {
  const t = generateTasks({ ...abroadTrip(), startDate: '2026-11-14', endDate: '2026-11-18' }, TODAY);
  assert.ok(t.every((x) => x.dueDate >= TODAY));
  assert.equal(find(t, 'book_transport@flight').dueDate, TODAY);
});

test('far-off trip is all green; the passport check turns amber as it nears', () => {
  const trip = abroadTrip({ startDate: '2027-06-10', endDate: '2027-06-17' });
  const t = generateTasks(trip, TODAY);
  const s = tripSummary(trip, t, TODAY);
  assert.equal(s.overall, 'green');
  assert.equal(s.countdown.days, daysBetween(TODAY, '2027-06-10'));
  // passport check is due 90 days before departure; a key task is amber inside 14 days
  const nearPassport = addDays(trip.startDate, -90 - 10);
  assert.equal(tripSummary(trip, t, nearPassport).overall, 'amber');
});

test('RAG: overdue is red, near is amber, key window is wider', () => {
  const base = { status: 'todo', dependsOn: [], key: 'x' };
  assert.equal(taskRag({ ...base, dueDate: '2026-11-08' }, [], TODAY), 'red');
  assert.equal(taskRag({ ...base, dueDate: '2026-11-15' }, [], TODAY), 'amber');
  assert.equal(taskRag({ ...base, dueDate: '2026-11-20' }, [], TODAY), 'green');
  assert.equal(taskRag({ ...base, dueDate: '2026-11-20', isKey: true }, [], TODAY), 'amber');
  assert.equal(taskRag({ ...base, status: 'done', dueDate: '2026-01-01' }, [], TODAY), 'done');
});

test('RAG: due soon and blocked is red', () => {
  const passport = { key: 'passport@rob', status: 'todo', dueDate: '2026-12-30', dependsOn: [] };
  const book = { key: 'book_transport@flight', status: 'todo', dueDate: '2026-11-12', dependsOn: ['passport'] };
  const all = [passport, book];
  assert.equal(blockedBy(book, all).length, 1);
  assert.equal(taskRag(book, all, TODAY), 'red');
  passport.status = 'done';
  assert.equal(taskRag(book, all, TODAY), 'amber');
});

test('overall RAG goes red with an overdue key task', () => {
  const trip = abroadTrip();
  const t = generateTasks(trip, '2026-12-01');
  // jump forward past the passport check due date without completing it
  const s = tripSummary(trip, t, '2027-01-20');
  assert.equal(s.overall, 'red');
  assert.ok(s.overdue > 0);
});

test('overall RAG is amber for a single overdue non-key task', () => {
  const trip = ukTrip();
  const t = generateTasks(trip, TODAY).filter((x) => x.key === 'hub_transport'); // due 2026-11-24
  assert.equal(t[0].dueDate, '2026-11-24');
  const s = tripSummary(trip, t, '2026-11-25'); // one day late, trip still 9 days away
  assert.equal(s.overall, 'amber');
});

test('overall RAG is red when the trip is days away and little is done', () => {
  const trip = ukTrip();
  const t = generateTasks(trip, TODAY);
  assert.equal(tripSummary(trip, t, '2026-12-02').overall, 'red');
});

test('everything done => all sorted', () => {
  const trip = ukTrip();
  const t = generateTasks(trip, TODAY).map((x) => ({ ...x, status: 'done' }));
  const s = tripSummary(trip, t, TODAY);
  assert.equal(s.complete, true);
  assert.equal(s.overallLabel, 'All sorted');
  assert.equal(s.pct, 100);
});

test('key blockers explain what is holding up what', () => {
  const trip = abroadTrip();
  const t = generateTasks(trip, TODAY);
  const b = keyBlockers(t, TODAY);
  const passport = b.find((x) => x.task.key === 'passport@rob');
  assert.ok(passport, 'passport blocker listed');
  assert.ok(passport.blocks.some((x) => x.key === 'book_transport@flight'));
  assert.match(passport.message, /holding up/);
  find(t, 'passport@rob').status = 'done';
  assert.ok(!keyBlockers(t, TODAY).some((x) => x.task.key === 'passport@rob'));
});

test('blockers list the root cause, not tasks that are themselves blocked, and count what it unlocks', () => {
  const t = generateTasks(abroadTrip(), TODAY);
  const b = keyBlockers(t, TODAY, 10);
  const shown = b.map((x) => x.task.key);
  assert.ok(!shown.includes('book_transport@flight'), 'blocked booking is not listed; its blocker is');
  const passport = b.find((x) => x.task.key === 'passport@rob');
  const unlocked = passport.blocks.map((x) => x.key);
  assert.ok(unlocked.includes('book_transport@flight'), 'direct dependent');
  assert.ok(unlocked.includes('seats_bags'), 'dependent of the booking is counted too');
  assert.ok(b[0].task.key.startsWith('passport@'), 'a passport task (the biggest unlock) leads the list');
  assert.ok(b[0].blocks.length >= 5, 'and it unlocks several tasks');
  // once the passport is done, the booking becomes the thing to do
  find(t, 'passport@rob').status = 'done';
  find(t, 'passport@sam').status = 'done';
  assert.ok(keyBlockers(t, TODAY, 10).some((x) => x.task.key === 'book_transport@flight'));
});

test('countdown states', () => {
  const trip = { startDate: '2026-11-12', endDate: '2026-11-15' };
  assert.equal(countdownFor(trip, TODAY).label, '3 days to go');
  assert.equal(countdownFor(trip, '2026-11-11').label, 'Tomorrow');
  assert.equal(countdownFor(trip, '2026-11-12').label, 'Departure day');
  assert.equal(countdownFor(trip, '2026-11-14').label, 'Day 3 of 4');
  assert.equal(countdownFor(trip, '2026-11-16').state, 'finished');
});

test('mergeTasks keeps progress and edits, adds new, drops stale open tasks', () => {
  const trip = abroadTrip();
  const first = generateTasks(trip, TODAY).map((t, i) => ({ ...t, id: `id${i}` }));
  find(first, 'passport@rob').status = 'done';
  find(first, 'passport@rob').doneAt = '2026-11-10T10:00:00Z';
  Object.assign(find(first, 'insurance'), { owner: 'Sam', userEdited: true, dueDate: '2027-01-01' });
  first.push({ id: 'custom1', key: null, title: 'Buy a guidebook', category: 'My tasks', owner: 'Rob', status: 'todo', dependsOn: [], sort: 99 });

  const next = generateTasks({ ...trip, transport: ['train'], options: { visa: 'no', stay: 'none' } }, TODAY);
  const merged = mergeTasks(first, next);
  const mk = keys(merged);
  assert.equal(find(merged, 'passport@rob').status, 'done');
  assert.equal(find(merged, 'passport@rob').id, 'id' + first.findIndex((t) => t.key === 'passport@rob'));
  assert.equal(find(merged, 'insurance').owner, 'Sam');
  assert.equal(find(merged, 'insurance').dueDate, '2027-01-01');
  assert.ok(!mk.includes('book_transport@flight'), 'stale open task dropped');
  assert.ok(mk.includes('book_transport@train'), 'new task added');
  assert.ok(merged.some((t) => t.title === 'Buy a guidebook'), 'custom task kept');
});

test('grouping', () => {
  const t = generateTasks(abroadTrip(), TODAY);
  const stages = groupByStage(t).map((g) => g.label);
  assert.deepEqual(stages.slice(0, 3), ['Documents', 'Book', 'Prepare']);
  const w = groupByWhen(t.map((x, i) => (i === 0 ? { ...x, status: 'done' } : x)), TODAY);
  assert.ok(w.find((g) => g.id === 'done'));
});
