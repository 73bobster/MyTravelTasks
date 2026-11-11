// entry.js — entry rules by destination and passport. Pure logic apart from loadRules (fetch).
// Rules are reviewed data files (public/data/rules/*.json), each with a confidence level,
// a last-checked date and official source links. This is guidance, never legal advice.
import { addDays, daysBetween, isISODate, slug } from './core.js';

export const CONFIDENCE = {
  high: { label: 'High confidence', means: 'Every core fact (visa, length of stay, passport) is stated plainly on the UK government page, and nothing looks unsettled.' },
  medium: { label: 'Medium confidence', means: 'The core facts are stated, but something is missing, changing or unclear. Check the linked pages for the gaps.' },
  low: { label: 'Low confidence', means: 'A key fact is not clear from the official page. Treat this as a prompt to check, not an answer.' },
  stale: { label: 'Needs re-checking', means: 'We last checked this a while ago. Rules change, so check the official pages before you rely on it.' },
};
export const DISCLAIMER =
  'This is a planning aid, not legal or immigration advice. Entry rules change, and border officers make the final decision. ' +
  'Please check the official government pages linked here, and your airline and the embassy of the country you are visiting, before you travel. ' +
  'Do not rely on this app alone.';
export const FCDO_INDEX = 'https://www.gov.uk/foreign-travel-advice';
export const METOFFICE_WARNINGS = 'https://weather.metoffice.gov.uk/warnings-and-advice/uk-warnings';
export const fcdoAdviceUrl = (slug) => (slug ? `${FCDO_INDEX}/${slug}` : FCDO_INDEX);

export async function loadRules(passport = 'GB') {
  try {
    const res = await fetch(`/data/rules/${passport.toLowerCase()}.json`);
    if (!res.ok) return null;
    const j = await res.json();
    return j && j.countries ? j : null;
  } catch { return null; }
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

export function findRule(rules, country) {
  if (!rules || !country) return null;
  const q = norm(country);
  if (!q) return null;
  for (const [key, c] of Object.entries(rules.countries)) {
    const names = [key.replace(/-/g, ' '), c.name, ...(c.aliases || [])].map(norm);
    if (names.includes(q)) return mergeRule(rules, key);
  }
  return null;
}

const cat = (a, b) => [...(a || []), ...(b || [])];
export function mergeRule(rules, key) {
  const c = rules.countries[key];
  const g = (c.group && rules.groups?.[c.group]) || {};
  const obj = (k) => (g[k] || c[k] ? { ...g[k], ...c[k] } : undefined);
  const seen = new Set();
  const sources = cat(g.sources, c.sources).filter((s) => !seen.has(s.url) && seen.add(s.url));
  return {
    key, name: c.name, group: c.group || null, groupLabel: g.label || null,
    fcdo: c.fcdo, fcdoUpdated: c.fcdoUpdated || null, checked: c.checked,
    confidence: c.confidence,
    entry: obj('entry'), stay: obj('stay'), passport: obj('passport'),
    authorisation: c.authorisation || null,
    forms: c.forms || [],
    business: obj('business'),
    businessSources: c.businessSources || [],
    carry: cat(g.carry, c.carry),
    other: cat(g.other, c.other),
    notices: cat(g.notices, c.notices),
    hostAdvice: c.hostAdvice || [],
    sources,
    reviewAfterDays: rules.reviewAfterDays || 90,
  };
}

export function ruleStatus(rule, today) {
  const ageDays = isISODate(rule.checked) ? daysBetween(rule.checked, today) : 9999;
  const stale = ageDays > rule.reviewAfterDays;
  const level = stale ? 'stale' : rule.confidence?.level || 'low';
  return { level, ageDays, stale, ...CONFIDENCE[level] };
}

export function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}

// Does this traveller's passport expiry meet the rule? status: ok | short | unknown | none
export function passportCheck(rule, trip, expiry) {
  const p = rule.passport;
  if (!p || !p.basis) return { status: 'none' };
  if (!isISODate(expiry)) return { status: 'unknown' };
  const anchor = p.basis === 'arrival' ? trip.startDate : trip.endDate;
  if (!isISODate(anchor)) return { status: 'unknown' };
  let needed = anchor;
  if (p.basis !== 'stay') needed = p.months ? addMonths(anchor, p.months) : addDays(anchor, p.days || 0);
  return { status: expiry >= needed ? 'ok' : 'short', neededBy: needed, expiry };
}

// Everything the app needs to know about entry rules for a trip.
export function entryFor(trip, rules, today) {
  const country = trip.country || '';
  if (trip.scope !== 'abroad' || !country) return { applicable: false };
  const rule = findRule(rules, country);
  if (!rule) return { applicable: true, covered: false, country, fallbackUrl: FCDO_INDEX };
  const work = trip.type === 'work';
  const travellers = trip.travellers.map((t) => {
    const gb = (t.nationality || 'GB') === 'GB';
    return { name: t.name, gb, passport: gb ? passportCheck(rule, trip, t.passportExpiry) : { status: 'none' } };
  });
  const extra = work ? rule.businessSources : [];
  const seen = new Set(rule.sources.map((s) => s.url));
  const sources = [...rule.sources, ...extra.filter((s) => !seen.has(s.url))];
  return {
    applicable: true, covered: true, country, work,
    rule: { ...rule, sources }, status: ruleStatus(rule, today), travellers,
    carry: rule.carry.filter((c) => work || !c.business),
    hasNonGB: travellers.some((t) => !t.gb),
  };
}

export { slug };
