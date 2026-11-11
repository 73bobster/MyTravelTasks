// Weekly rules checker. Run by .github/workflows/check-rules.yml (needs internet), or by hand: node scripts/check-rules.mjs
// It never edits rules. It writes public/data/rules/alerts.json, which the app reads:
//   changed: the GOV.UK travel-advice page was updated AFTER the date we last checked the rule.
//   broken:  a source link did not load (404/410/DNS/etc). 401/403/429/5xx are "unknown": some sites block bots.
// To clear a "changed" alert: read the page, update the rule in gb.json, and set its "checked" date to today.
import { readFileSync, writeFileSync } from 'node:fs';

const RULES = new URL('../public/data/rules/gb.json', import.meta.url);
const OUT = new URL('../public/data/rules/alerts.json', import.meta.url);
const UA = 'MyTravelTasks-rules-checker (+https://mytraveltasks.cobaltpinksoftware.com)';

export function findChanged(rules, live) {
  const out = {};
  for (const [key, c] of Object.entries(rules.countries)) {
    const l = live[c.fcdo];
    if (!l || !l.updated) continue;
    if (l.updated.slice(0, 10) > c.checked) out[key] = { updated: l.updated.slice(0, 10), change: (l.change || '').slice(0, 300), checked: c.checked };
  }
  return out;
}

export function classify(status) {
  if (status === 404 || status === 410) return 'broken';
  if (status >= 200 && status < 400) return 'ok';
  return 'unknown';
}

async function getJson(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function liveAdvice(slug) {
  // GOV.UK Content API for the travel-advice edition. public_updated_at moves whenever the advice is updated.
  const j = await getJson(`https://www.gov.uk/api/content/foreign-travel-advice/${slug}`);
  return { updated: j.public_updated_at || '', change: j.details?.change_description || '' };
}

async function status(url) {
  try {
    let r = await fetch(url, { method: 'HEAD', redirect: 'follow', headers: { 'user-agent': UA } });
    if (r.status === 405 || r.status === 403 || r.status === 501) r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': UA } });
    return r.status;
  } catch { return 0; }
}

async function pool(items, n, fn) {
  const res = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; res[k] = await fn(items[k]); } }));
  return res;
}

async function main() {
  const rules = JSON.parse(readFileSync(RULES, 'utf8'));
  const slugs = [...new Set(Object.values(rules.countries).map((c) => c.fcdo))];
  const live = {}; const errors = [];
  await pool(slugs, 4, async (s) => { try { live[s] = await liveAdvice(s); } catch (e) { errors.push(`advice ${s}: ${e.message}`); } });

  const urls = new Map();
  const note = (src, rule) => { if (!urls.has(src.url)) urls.set(src.url, { url: src.url, label: src.label, rules: [] }); urls.get(src.url).rules.push(rule); };
  for (const g of Object.values(rules.groups || {})) for (const s of g.sources || []) note(s, 'group');
  for (const [k, c] of Object.entries(rules.countries)) {
    for (const s of [...(c.sources || []), ...(c.businessSources || [])]) note(s, k);
    if (c.authorisation?.applyUrl) note({ url: c.authorisation.applyUrl, label: c.authorisation.applyLabel }, k);
    for (const f of c.forms || []) if (f.url) note({ url: f.url, label: f.title }, k);
  }
  const list = [...urls.values()];
  const codes = await pool(list, 6, (u) => status(u.url));
  const broken = list.filter((_, i) => classify(codes[i]) === 'broken').map((u, _i) => ({ url: u.url, label: u.label, rules: u.rules, status: codes[list.indexOf(u)] }));
  const unknown = list.filter((_, i) => classify(codes[i]) === 'unknown').length;

  const alerts = {
    generatedAt: new Date().toISOString().slice(0, 10),
    changed: findChanged(rules, live), broken, unknownLinks: unknown, adviceErrors: errors,
  };
  const prev = (() => { try { return JSON.parse(readFileSync(OUT, 'utf8')); } catch { return {}; } })();
  const same = JSON.stringify({ ...prev, generatedAt: 0 }) === JSON.stringify({ ...alerts, generatedAt: 0 });
  if (!same) writeFileSync(OUT, JSON.stringify(alerts, null, 1) + '\n');
  console.log(`rules ${Object.keys(rules.countries).length}, links ${list.length}, changed ${Object.keys(alerts.changed).length}, broken ${broken.length}, unknown ${unknown}, advice errors ${errors.length}`);
  for (const [k, v] of Object.entries(alerts.changed)) console.log(`CHANGED ${k}: page updated ${v.updated} (we checked ${v.checked}) ${v.change}`);
  for (const b of broken) console.log(`BROKEN ${b.status} ${b.url} (${b.rules.join(', ')})`);
  for (const e of errors) console.log(`ERROR ${e}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
