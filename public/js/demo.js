// demo.js — sample trips for "Try the demo". Dates are relative to today so it always looks live.
// Everything lives in this browser tab's session; nothing is sent to the server. Names are made up.
import { normaliseTrip, generateTasks, addDays } from './core.js';
import { entryFor } from './entry.js';

const rel = (today, n) => addDays(today, n);

// A tiny valid PDF so the sample documents can really be opened.
export function samplePdf(lines) {
  const esc = (s) => s.replace(/[\\()]/g, '\\$&');
  const text = lines.map((l, i) => `BT /F1 ${i ? 14 : 22} Tf 60 ${740 - i * 30} Td (${esc(l)}) Tj ET`).join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n'; const off = [];
  objs.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${off.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(out);
}

// How far through each sample trip's checklist the person "is".
function progress(tasks, today, mode, leave = []) {
  let n = 0;
  return tasks.map((t, i) => {
    // generateTasks never dates a task before today, so "due by now" means due on or before today
    const done = mode === 'all' ? !leave.includes(t.key)
      : mode === 'past' ? !!t.dueDate && t.dueDate <= today && !leave.includes(t.key)
      : mode === 'first' ? i < 4
      : false;
    if (done) return { ...t, status: 'done', doneAt: new Date().toISOString() };
    if (leave.includes(t.key)) return { ...t, dueDate: addDays(today, -(2 + 3 * n++)) }; // behind: shows as overdue
    return t;
  });
}

export function demoTrips(today) {
  const me = { name: 'Alex', role: 'adult', isMe: true, passport: 'yes', nationality: 'GB', passportExpiry: rel(today, 900) };
  return [
    { // days away, a few things overdue
      trip: { name: 'Madrid sales conference', type: 'work', scope: 'abroad', country: 'Spain', destination: 'Madrid', startDate: rel(today, 6), endDate: rel(today, 10), transport: ['flight'],
        travellers: [me], options: { workActivity: 'meetings', stay: 'booked', handLuggageOnly: true } },
      mode: 'past', leave: ['carry_invite', 'carry_funds', 'work_contacts'] },
    { // family abroad, one child's passport too short
      trip: { name: 'Family week in Crete', type: 'holiday', scope: 'abroad', country: 'Greece', destination: 'Chania', startDate: rel(today, 45), endDate: rel(today, 52), transport: ['flight'],
        travellers: [me, { name: 'Sam', role: 'adult', passport: 'yes', nationality: 'GB', passportExpiry: rel(today, 800) },
          { name: 'Mia', role: 'child', passport: 'yes', nationality: 'GB', passportExpiry: rel(today, 100) }],
        options: { stay: 'booked', carHire: true, parking: true } },
      mode: 'first' },
    { // far off, nothing started
      trip: { name: 'New York city break', type: 'holiday', scope: 'abroad', country: 'USA', destination: 'New York', startDate: rel(today, 90), endDate: rel(today, 95), transport: ['flight'],
        travellers: [me], options: { stay: 'need' } },
      mode: 'none' },
    { // by train, with the dog
      trip: { name: 'Edinburgh weekend with Biscuit', type: 'minibreak', scope: 'uk', country: '', destination: 'Edinburgh', startDate: rel(today, 14), endDate: rel(today, 16), transport: ['train'],
        travellers: [me], options: { stay: 'booked', pets: 'travelling' } },
      mode: 'past', docs: true },
    { // finished
      trip: { name: 'Lake District weekend', type: 'family', scope: 'uk', country: '', destination: 'Keswick', startDate: rel(today, -35), endDate: rel(today, -33), transport: ['car'],
        travellers: [me, { name: 'Sam', role: 'adult', passport: 'yes' }], options: { stay: 'none' } },
      mode: 'all' },
    { // finished
      trip: { name: 'Bangkok and Phuket', type: 'holiday', scope: 'abroad', country: 'Thailand', destination: 'Bangkok', startDate: rel(today, -100), endDate: rel(today, -86), transport: ['flight'],
        travellers: [me], options: { stay: 'booked' } },
      mode: 'all' },
  ];
}

// Build the sample trips into the (demo) store.
export async function seedDemo(store, rules, today) {
  const made = [];
  for (const d of demoTrips(today)) {
    const trip = normaliseTrip(d.trip);
    const tasks = progress(generateTasks(trip, today, entryFor(trip, rules, today), []), today, d.mode, d.leave);
    const saved = await store.create(trip, tasks);
    made.push({ saved, docs: d.docs });
  }
  return made;
}
