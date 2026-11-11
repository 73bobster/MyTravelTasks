import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDoc, allDocs, removeDoc, removeWhere, moveOwner, checkFile, docsForTrip, coverCheck, missingInsurance, sizeLabel, MAX_BYTES,
} from '../public/js/docs.js';

const file = (name = 'policy.pdf', type = 'application/pdf', size = 1000) => new File([new Uint8Array(size)], name, { type });
const trip = { id: 't1', scope: 'abroad', startDate: '2026-11-17', endDate: '2026-11-21', travellers: [{ name: 'Rob' }, { name: 'Sam' }] };

test('file checks: type and size', () => {
  assert.equal(checkFile(file()), '');
  assert.equal(checkFile(file('a.jpg', 'image/jpeg')), '');
  assert.match(checkFile(file('a.exe', 'application/octet-stream')), /photos and PDFs/);
  assert.match(checkFile({ size: MAX_BYTES + 1, type: 'application/pdf' }), /15 MB/);
  assert.match(checkFile(null), /Choose/);
  assert.equal(sizeLabel(2 * 1048576), '2.0 MB');
});

test('person docs are reusable across trips; trip docs belong to one trip; owners kept apart', async () => {
  await addDoc({ owner: 'guest', level: 'person', person: 'rob', kind: 'insurance', label: 'Annual policy', validFrom: '2026-01-01', expires: '2026-12-31' }, file());
  await addDoc({ owner: 'guest', level: 'trip', tripId: 't1', kind: 'ticket', label: 'Boarding pass' }, file('bp.png', 'image/png'));
  await addDoc({ owner: 'guest', level: 'trip', tripId: 't2', kind: 'ticket', label: 'Other trip' }, file('x.png', 'image/png'));
  await addDoc({ owner: 'someone-else', level: 'person', person: 'Rob', kind: 'insurance', label: 'Not mine' }, file());
  const all = await allDocs();
  const d = docsForTrip(all, 'guest', trip);
  assert.deepEqual(d.people.map((x) => x.label), ['Annual policy']);   // matched by name, case-insensitive
  assert.deepEqual(d.trip.map((x) => x.label), ['Boarding pass']);
  assert.deepEqual(missingInsurance(all, 'guest', trip), ['Sam']);
  assert.deepEqual(missingInsurance(all, 'guest', { ...trip, scope: 'uk' }), []);
});

test('cover check against trip dates', () => {
  assert.equal(coverCheck({ validFrom: '2026-01-01', expires: '2026-12-31' }, trip), 'ok');
  assert.equal(coverCheck({ validFrom: '2026-01-01', expires: '2026-11-19' }, trip), 'outside');
  assert.equal(coverCheck({ validFrom: '2026-11-18', expires: '2027-01-01' }, trip), 'outside');
  assert.equal(coverCheck({}, trip), 'undated');
});

test('guest files move to the account; unmatched trip files are dropped; removal works', async () => {
  await moveOwner('guest', 'acc1', { t1: 'new1' });
  const all = await allDocs();
  assert.ok(all.some((d) => d.owner === 'acc1' && d.level === 'trip' && d.tripId === 'new1'));
  assert.ok(all.some((d) => d.owner === 'acc1' && d.level === 'person'));
  assert.ok(!all.some((d) => d.owner === 'guest'));
  await removeWhere((d) => d.tripId === 'new1');
  assert.ok(!(await allDocs()).some((d) => d.tripId === 'new1'));
  await removeWhere((d) => d.owner === 'acc1');
  const left = await allDocs(); assert.equal(left.length, 1); await removeDoc(left[0].id); assert.equal((await allDocs()).length, 0);
  await assert.rejects(() => addDoc({ owner: 'guest', level: 'person', person: 'Rob' }, file('a.exe', 'application/zip')), /photos and PDFs/);
});
import { docKindFor, taskDocs } from '../public/js/docs.js';
test('which tasks take documents, and per-task lists', async () => {
  assert.equal(docKindFor('book_transport@flight'), 'ticket');
  assert.equal(docKindFor('stay_confirm'), 'booking');
  assert.equal(docKindFor('form_tdac@rob'), 'approval');
  assert.equal(docKindFor('visa@rob'), 'approval');
  assert.equal(docKindFor('pack'), ''); assert.equal(docKindFor('chargers'), '');
  await addDoc({ owner: 'guest', level: 'trip', tripId: 't1', taskKey: 'book_stay', kind: 'booking', label: 'Hotel' }, file('h.pdf'));
  await addDoc({ owner: 'guest', level: 'trip', tripId: 't1', taskKey: 'book_transport@flight', kind: 'ticket', label: 'Flight' }, file('f.pdf'));
  const all = await allDocs();
  assert.deepEqual(taskDocs(all, 'guest', trip, 'book_stay').map((d) => d.label), ['Hotel']);
  assert.deepEqual(taskDocs(all, 'guest', trip, 'book_transport@flight').map((d) => d.label), ['Flight']);
  assert.deepEqual(taskDocs(all, 'guest', trip, 'pack'), []);
  await removeWhere((d) => d.owner === 'guest');
});
