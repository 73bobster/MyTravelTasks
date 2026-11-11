// core.js — pure trip logic. No DOM, no network, no storage.
// Used by guest mode, registered mode, the API (validation) and the tests.

export const TRIP_TYPES = [
  { id: 'holiday', label: 'Holiday' },
  { id: 'minibreak', label: 'Mini-break' },
  { id: 'work', label: 'Work trip' },
  { id: 'family', label: 'Visiting family or friends' },
  { id: 'other', label: 'Something else' },
];
export const TRANSPORT = [
  { id: 'flight', label: 'Flight' },
  { id: 'train', label: 'Train' },
  { id: 'ferry', label: 'Ferry' },
  { id: 'coach', label: 'Coach or bus' },
  { id: 'car', label: 'Car' },
];
export const CATEGORY_ORDER = ['Plan', 'Documents', 'Book', 'Prepare', 'Travel day', 'Return', 'Afterwards', 'My tasks'];

const DAY = 86400000;
const ROLES = ['adult', 'child', 'infant'];
const PASSPORT = ['yes', 'no', 'unsure'];
const STAY = ['need', 'booked', 'none', 'notrequired'];
const PETS = ['none', 'sitter', 'travelling'];

// ---------- dates (all calendar-date strings, YYYY-MM-DD) ----------
function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
function fromMs(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
export function isISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return fromMs(parseISO(s)) === s;
}
export function todayISO(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
export function daysBetween(fromISO, toISO) {
  return Math.round((parseISO(toISO) - parseISO(fromISO)) / DAY);
}
export function addDays(iso, n) {
  return fromMs(parseISO(iso) + n * DAY);
}
export function shortDate(iso) {
  return new Date(parseISO(iso)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
export function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
}
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function dueLabel(dueISO, today) {
  if (!dueISO) return 'No date';
  const d = daysBetween(today, dueISO);
  if (d < 0) return `${plural(-d, 'day')} overdue`;
  if (d === 0) return 'Due today';
  if (d === 1) return 'Due tomorrow';
  if (d <= 14) return `Due in ${d} days`;
  return `Due ${shortDate(dueISO)}`;
}

// ---------- normalising and validating ----------
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const pick = (v, allowed, dflt) => (allowed.includes(v) ? v : dflt);

export function normaliseTrip(input = {}) {
  const o = input.options || {};
  const travellers = (Array.isArray(input.travellers) ? input.travellers : [])
    .slice(0, 12)
    .map((t) => ({
      name: str(t?.name, 40),
      role: pick(t?.role, ROLES, 'adult'),
      passport: pick(t?.passport, PASSPORT, 'unsure'),
      nationality: pick(t?.nationality, ['GB', 'other'], 'GB'),
      passportExpiry: isISODate(t?.passportExpiry) ? t.passportExpiry : '',
      isMe: !!t?.isMe,
    }));
  return {
    name: str(input.name, 80),
    type: pick(input.type, TRIP_TYPES.map((t) => t.id), 'holiday'),
    scope: pick(input.scope, ['uk', 'abroad'], 'uk'),
    destination: str(input.destination, 80),
    country: str(input.country, 60),
    startDate: str(input.startDate, 10),
    endDate: str(input.endDate, 10),
    organiser: str(input.organiser, 40),
    transport: [...new Set((Array.isArray(input.transport) ? input.transport : []).filter((x) => TRANSPORT.some((t) => t.id === x)))],
    travellers,
    options: {
      visa: pick(o.visa, PASSPORT, 'unsure'),
      stay: pick(o.stay, STAY, 'need'),
      carHire: !!o.carHire,
      parking: !!o.parking,
      drivingAbroad: !!o.drivingAbroad,
      handLuggageOnly: !!o.handLuggageOnly,
      childConsent: !!o.childConsent,
      pets: pick(o.pets, PETS, 'none'),
      workActivity: pick(o.workActivity, ['meetings', 'handson', 'unsure'], 'unsure'),
      dismissed: [...new Set((Array.isArray(o.dismissed) ? o.dismissed : []).map((k) => str(k, 80)).filter(Boolean))].slice(0, 100),
    },
  };
}

// Standard tasks a person has removed for good. Per-person keys (passport@rob) are matched by their base so it works on every trip.
export const suppressKey = (key) => (/^(passport|visa|pack_child|entry_other|form_[a-z-]+)@/.test(key) ? key.split('@')[0] : key);
const suppressed = (key, set) => set.has(key) || set.has(suppressKey(key));

// Regular tasks: "add this to every <type> trip", and tasks removed for good. Shared by the app and the API.
export const REGULAR_WHEN = ['any', 'uk', 'abroad'];
export function normaliseRegular(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).slice(0, 80).map((r) => {
    const title = str(r?.title, 120);
    if (!title) return null;
    let id = str(r?.id, 40).replace(/[^A-Za-z0-9_-]/g, '');
    if (!id || seen.has(id)) id = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    seen.add(id);
    const suppress = str(r?.suppress, 80);
    const types = [...new Set((Array.isArray(r.types) ? r.types : []).filter((t) => TRIP_TYPES.some((x) => x.id === t)))];
    const days = Math.min(60, Math.max(0, Math.trunc(Number(r.days)) || 0));
    return { id, title, types, when: pick(r.when, REGULAR_WHEN, 'any'), days, ...(suppress ? { suppress } : {}) };
  }).filter(Boolean);
}

export function validateTrip(input) {
  const t = normaliseTrip(input);
  const errors = [];
  if (!t.name) errors.push('Give the trip a name.');
  if (!isISODate(t.startDate)) errors.push('Choose a start date.');
  if (!isISODate(t.endDate)) errors.push('Choose an end date.');
  if (isISODate(t.startDate) && isISODate(t.endDate)) {
    const len = daysBetween(t.startDate, t.endDate);
    if (len < 0) errors.push('The end date is before the start date.');
    if (len > 400) errors.push('Trips can be up to 400 days long.');
  }
  if (t.travellers.length === 0) errors.push('Add at least one traveller.');
  if (t.travellers.some((x) => !x.name)) errors.push('Every traveller needs a name.');
  return { errors, trip: t };
}

export function normaliseTask(t = {}, i = 0) {
  const title = str(t.title, 200);
  if (!title) return null;
  return {
    id: t.id ? String(t.id) : undefined,
    key: t.key ? str(t.key, 80) : null,
    title,
    category: str(t.category, 40) || 'My tasks',
    owner: str(t.owner, 60) || 'Everyone',
    dueDate: isISODate(t.dueDate) ? t.dueDate : null,
    status: t.status === 'done' ? 'done' : 'todo',
    doneAt: t.doneAt || null,
    dependsOn: (Array.isArray(t.dependsOn) ? t.dependsOn : []).slice(0, 10).map((d) => str(d, 80)).filter(Boolean),
    isKey: !!t.isKey,
    notes: str(t.notes, 2000),
    hint: str(t.hint, 1000),
    sort: Number.isFinite(t.sort) ? Math.trunc(t.sort) : i,
    userEdited: !!t.userEdited,
  };
}

// ---------- task generation ----------
export function generateTasks(tripInput, today = todayISO(), entry = null, regular = []) {
  const trip = normaliseTrip(tripInput);
  const { startDate: start, endDate: end } = trip;
  const nights = daysBetween(start, end);
  const abroad = trip.scope === 'abroad';
  const work = trip.type === 'work';
  const o = trip.options;
  const modes = trip.transport;
  const flying = modes.includes('flight');
  const driving = modes.includes('car');
  const me = trip.travellers.find((t) => t.isMe);
  const org = me ? me.name : trip.organiser || 'Me';
  const place = trip.country || trip.destination || 'your destination';
  const hub = flying ? 'airport' : modes.includes('ferry') ? 'port' : 'station';
  const out = [];
  let n = 0;
  const rule = abroad && entry && entry.covered ? entry.rule : null;

  const dueDate = (anchor, offset) => {
    const d = addDays(anchor === 'end' ? end : start, offset);
    return daysBetween(today, d) < 0 ? today : d; // already late when planned: due today
  };
  const add = (key, title, category, offset, x = {}) =>
    out.push({
      key, title, category,
      owner: x.owner || org,
      dueDate: dueDate(x.anchor || 'start', offset),
      dependsOn: x.dependsOn || [],
      isKey: !!x.isKey,
      notes: '',
      hint: x.hint || '',
      sort: n++,
      status: 'todo',
      doneAt: null,
      userEdited: false,
    });
  const ownerFor = (t) => (t.role === 'adult' && !t.isMe ? t.name : org);

  // Plan
  if (work) {
    add('approval', 'Get the trip approved (manager and budget code)', 'Plan', abroad ? -35 : -21, {
      isKey: true, hint: 'Do this before booking anything non-refundable.',
    });
  }

  // Documents (abroad)
  if (abroad) {
    for (const t of trip.travellers) {
      const s = slug(t.name);
      const owner = ownerFor(t);
      const pc = rule ? entry.travellers.find((x) => x.name === t.name)?.passport : null;
      if (pc && pc.status === 'short' && t.passport !== 'no') {
        add(`passport@${s}`, `Renew ${t.name}'s passport: it expires before the ${shortDate(pc.neededBy)} ${place} needs`, 'Documents', -75, {
          owner, isKey: true,
          hint: `${rule.passport.summary} Renew through GOV.UK (https://www.gov.uk/renew-adult-passport) and allow several weeks.`,
        });
      } else if (t.passport === 'no') {
        add(`passport@${s}`, `Apply for ${t.name}'s passport`, 'Documents', -75, {
          owner, isKey: true,
          hint: 'Allow several weeks. Check current processing times on GOV.UK before you book.',
        });
      } else if (t.passport === 'unsure') {
        add(`passport@${s}`, `Find ${t.name}'s passport and check the expiry date`, 'Documents', -90, {
          owner, isKey: true,
          hint: `Many countries need months of validity left after you return. Check ${place}'s rules.`,
        });
      } else {
        add(`passport@${s}`, `Check ${t.name}'s passport is in date for ${place}`, 'Documents', -90, {
          owner, isKey: true,
          hint: 'Check both the expiry date and any minimum validity the destination asks for.',
        });
      }
    }
    if (rule) {
      const links = rule.sources.slice(0, 3).map((x) => x.url).join('  ');
      add('entry_rules', `Check the official entry rules for ${place} yourself`, 'Documents', -90, {
        isKey: true,
        hint: `We summarise the rules, but you should read the official pages and confirm. ${links}`,
      });
      for (const t of trip.travellers) {
        const s = slug(t.name);
        const owner = ownerFor(t);
        if ((t.nationality || 'GB') !== 'GB') {
          add(`entry_other@${s}`, `Check what ${t.name} needs to enter ${place} (we only cover UK passports so far)`, 'Documents', -90, {
            owner, isKey: true, hint: 'Use the destination government\'s official immigration pages and your airline.',
          });
          continue;
        }
        const a = rule.authorisation;
        if (a && a.required) {
          const need = a.required === true;
          add(`visa@${s}`, need ? `Apply for ${t.name}'s ${a.name}` : `Check if ${t.name} needs an ${a.name}, and apply if so`, 'Documents', a.taskOffset || -45, {
            owner, isKey: true, dependsOn: [`passport@${s}`, 'entry_rules'],
            hint: `${a.summary} ${a.applyUrl}`,
          });
        }
        for (const f of rule.forms || []) {
          add(`form_${f.id}@${s}`, `${f.title}${trip.travellers.length > 1 ? ` for ${t.name}` : ''}`, 'Documents', f.offset, {
            owner, isKey: true, hint: [f.hint, f.url].filter(Boolean).join(' '),
          });
        }
      }
      const gbFirst = trip.travellers.find((t) => (t.nationality || 'GB') === 'GB');
      if (gbFirst) {
        for (const c of entry.carry) {
          if (!c.task) continue;
          add(`carry_${c.id}`, c.task.title.replace('{place}', place), 'Documents', c.task.offset, {
            owner: org, isKey: !!c.task.isKey, dependsOn: c.task.dependsOn || [],
            hint: `${c.task.hint || ''} Often asked for at the border.`.trim(),
          });
        }
        if (work && (o.workActivity !== 'meetings' || (rule.business && rule.business.visaNeeded))) {
          add('work_permit', `Check whether your activities in ${place} count as work needing a permit or visa`, 'Documents', -45, {
            isKey: true,
            hint: `${rule.business?.summary || ''} Business meetings are generally allowed; being paid locally, installing or servicing equipment, or hands-on work may not be.`.trim(),
          });
        }
      }
    } else {
    add('entry_rules', `Check entry rules for ${place} (visa or travel authorisation, health, customs)`, 'Documents', -90, {
      isKey: o.visa !== 'no',
      hint: o.visa === 'unsure'
        ? 'You are not sure if you need a visa, so check this first. Start with https://www.gov.uk/foreign-travel-advice'
        : 'Official source: https://www.gov.uk/foreign-travel-advice',
    });
    }
    if (!rule && o.visa === 'yes') {
      for (const t of trip.travellers) {
        const s = slug(t.name);
        add(`visa@${s}`, `Apply for ${t.name}'s visa or travel authorisation`, 'Documents', -45, {
          owner: ownerFor(t), isKey: true, dependsOn: [`passport@${s}`, 'entry_rules'],
          hint: 'Apply only through the official government site. Allow extra time.',
        });
      }
    }
    if (work) {
      add('insurance', 'Check the company travel insurance covers this trip', 'Documents', -21);
    } else {
      add('insurance', 'Buy travel insurance (medical, cancellation, baggage)', 'Documents', -45, {
        hint: 'Buy it soon after booking so cancellation cover starts early.',
      });
    }
    add('health', 'Check health advice and vaccinations for the destination', 'Documents', -56, {
      hint: 'Official source: https://travelhealthpro.org.uk',
    });
    if (o.drivingAbroad) {
      add('licence', `Check driving licence rules for ${place} (permit, licence check code)`, 'Documents', -30);
    }
    if (o.childConsent) {
      add('consent', 'Get consent letters for children travelling without both parents', 'Documents', -21, { isKey: true });
    }
  }

  // Warnings and disruption: strikes, air traffic control, extreme weather
  {
    const adviceUrl = rule ? `https://www.gov.uk/foreign-travel-advice/${rule.fcdo}` : 'https://www.gov.uk/foreign-travel-advice';
    const where = abroad
      ? `Read the UK government's travel advice for ${place} (${adviceUrl}); its "Warnings and insurance" and "Safety and security" sections cover strikes, protests, extreme weather and other risks. If the page offers "Get email alerts", sign up.`
      : 'Check the Met Office weather warnings (https://weather.metoffice.gov.uk/warnings-and-advice/uk-warnings) and the rail, road or ferry operator for disruption and planned strikes.';
    add('travel_alerts', abroad ? `Check warnings for ${place}: strikes, air traffic control disruption, heatwaves and storms` : 'Check for strikes, travel disruption and weather warnings', 'Prepare', -7, {
      hint: `${where} Also check your airline, ferry or rail operator for strike notices.`,
    });
    add('travel_alerts_final', 'Re-check strikes, disruption and weather warnings the day before', 'Prepare', -1, {
      dependsOn: ['travel_alerts'],
      hint: 'Plans can change in the last days. Check your operator\'s app or website and the sources from the earlier check.',
    });
  }

  // Book
  const bookDeps = [...(abroad ? ['passport'] : []), ...(work ? ['approval'] : [])];
  const bookings = {
    flight: ['Book flights (outbound and return)', abroad ? -60 : -30],
    train: ['Book train tickets (outbound and return)', -28],
    ferry: ['Book the ferry crossing', abroad ? -45 : -30],
    coach: ['Book coach or bus tickets', -21],
  };
  const booked = modes.filter((m) => bookings[m]);
  if (booked.length) {
    for (const m of booked) {
      add(`book_transport@${m}`, bookings[m][0], 'Book', bookings[m][1], {
        isKey: true, dependsOn: bookDeps,
        hint: abroad ? 'Names must match the passports exactly.' : '',
      });
    }
  } else if (!driving) {
    add('book_transport', "Decide how you're getting there and book it", 'Book', -42, { isKey: true, dependsOn: bookDeps });
  }
  if (driving) {
    add('car_ready', 'Get the car trip-ready (tyres, oil, fuel, breakdown cover) and plan the route', 'Prepare', -5);
  }
  if (o.stay === 'need') {
    add('book_stay', 'Book accommodation (check the cancellation terms)', 'Book', abroad ? -50 : -28, {
      isKey: true, dependsOn: work ? ['approval'] : [],
    });
    add('stay_confirm', 'Save the accommodation confirmation, address and check-in time', 'Book', -7, { dependsOn: ['book_stay'] });
  } else if (o.stay === 'booked') {
    add('stay_confirm', 'Save the accommodation confirmation, address and check-in time', 'Book', -7);
  }
  if (flying) {
    add('seats_bags', 'Choose seats and add bags or extras if needed', 'Book', -14, { dependsOn: ['book_transport'] });
  }
  if (o.carHire) {
    add('car_hire', 'Book car hire (check excess cover and who can drive)', 'Book', abroad ? -30 : -21, { dependsOn: ['book_transport'] });
  }
  if (o.parking && modes.some((m) => m !== 'car')) {
    add('book_parking', `Book ${hub} parking (cheaper if booked ahead)`, 'Book', -21, {
      dependsOn: ['book_transport'],
      hint: 'Check the car park location and how long it takes to walk or shuttle to the entrance. Save the booking confirmation.',
    });
  }
  if (modes.some((m) => m !== 'car')) {
    add('hub_transport', `Plan how you get to the ${hub} and back (parking, taxi or lift)`, 'Book', -10, { dependsOn: ['book_transport'] });
  }
  if (abroad || flying) {
    add('transfers', 'Arrange how you get from the arrival point to where you are staying (transfer, taxi or car hire pick-up)', 'Book', -14, { dependsOn: ['book_transport'] });
  }

  // Prepare
  if (abroad) {
    add('money', 'Sort money: currency or a travel card, and tell your bank', 'Prepare', -14);
    add('phone', 'Check phone roaming charges or get an eSIM', 'Prepare', -7);
    add('adapter', 'Pack travel adapters and chargers', 'Prepare', -5);
  }
  if (flying) {
    add('bags_rules', 'Check baggage allowance, liquids and battery rules', 'Prepare', -7, { dependsOn: ['book_transport'] });
  }
  if (o.pets === 'sitter') add('pet_care', "Arrange pet care while you're away", 'Prepare', -14);
  if (o.pets === 'travelling' && modes.includes('train')) {
    add('dogs_on_train', 'Check the rules for taking your dog on the train', 'Prepare', -14, {
      hint: 'Up to 2 animals travel free. Dogs must be on a lead or in a carrier at stations and on the train; carry them on escalators. Carriers must be rigid, closed and big enough to stand and lie down in. No animals on seats, and staff can remove one that causes a nuisance. '
        + 'Assistance dogs travel free. Charges for extra animals and sleeper cleaning vary by operator (for example Caledonian Sleeper: 30 pounds cleaning). '
        + (abroad ? 'Eurostar only takes registered guide and assistance dogs. ' : '')
        + 'Official: https://www.nationalrail.co.uk/on-the-train/train-travel-with-pets/ Also check your train company. More detail: https://www.thetrainline.com/trains/great-britain/dogs-on-trains',
    });
  }
  if (o.pets === 'travelling') add('pet_docs', 'Sort pet travel documents and pet-friendly stays', 'Prepare', -45, { isKey: true });
  if (work) {
    add('share_itinerary', 'Share the itinerary with your manager and team', 'Prepare', -3);
  } else if (nights >= 3) {
    add('out_of_office', 'Arrange work cover and set your out-of-office', 'Prepare', -3);
  }
  add('forecast', 'Check the weather and plan your clothes', 'Prepare', -3);
  for (const t of trip.travellers) {
    if (t.role === 'adult') continue;
    add(`pack_child@${slug(t.name)}`,
      t.role === 'infant'
        ? `Pack ${t.name}'s things (nappies, milk or formula, spare clothes, pram or car seat)`
        : `Pack ${t.name}'s things (snacks, entertainment, comforter, spare clothes)`,
      'Prepare', -2);
  }
  if (work) {
    add('work_clothes', 'Pack work clothes: outfits, shoes, socks, belt, tie or lanyard, laundry cover', 'Prepare', -3, {
      hint: 'Check the dress code and the weather. Lay it all out and tick it off before it goes in the bag.',
    });
    add('work_access', 'Sort work door entry: building pass, visitor registration or who meets you at reception', 'Prepare', -7, {
      hint: 'Ask your host for the address, the time to arrive and what ID to bring. Visitor passes often need a name sent ahead.',
    });
    add('work_contacts', 'Save work contact details: who, phone numbers, address and an emergency contact', 'Prepare', -5, {
      hint: 'Save them in your phone and on paper, in case the battery dies.',
    });
  }
  add('wallet', abroad ? 'Check wallet: cards, some local currency, ID and a backup card' : 'Check wallet: cards, cash, ID and railcard or tickets', 'Prepare', -1, {
    hint: abroad ? `Make sure your cards work abroad (tell your bank), carry some local currency for ${place}, and keep a backup card separate from your wallet.` : '',
  });
  add('chargers', 'Pack phone and watch chargers (and a power bank)', 'Prepare', -2);
  add('earbuds', 'Pack earbuds or headphones', 'Prepare', -2);
  add('glasses', 'Pack glasses or contact lenses (and spares or a case)', 'Prepare', -2);
  add('medicine', 'Pack medicine and any prescriptions', 'Prepare', -2, {
    hint: abroad
      ? `Keep medicines in their original packaging, in hand luggage, with a copy of the prescription. Some countries restrict certain medicines, so check the rules for ${place}.`
      : 'Take enough for the trip plus a few spare days.',
  });
  add('toothbrush', 'Pack toothbrush and toothpaste', 'Prepare', -1, {
    hint: o.handLuggageOnly ? 'Toothpaste counts as a liquid in hand luggage: 100ml or less, in a clear bag.' : '',
  });
  add('razor', 'Pack razor and shaving kit', 'Prepare', -1, {
    hint: o.handLuggageOnly ? 'Check the airline rules for razors and blades in hand luggage.' : '',
  });
  add('deodorant', 'Pack deodorant', 'Prepare', -1, {
    hint: o.handLuggageOnly ? 'Aerosols and roll-ons count as liquids in hand luggage: 100ml or less, in a clear bag.' : '',
  });
  if (o.stay === 'need' || o.stay === 'booked') {
    add('first_day_kit', 'Pack first-day essentials for the accommodation: teabags or coffee, sugar, snacks, a mug', 'Prepare', -2, {
      hint: 'So you are not hunting for a shop on arrival. Check what the accommodation already provides.',
    });
  }
  add('docs_offline', 'Save tickets, bookings and key documents to your phone (and print the essentials)', 'Prepare', -2, {
    dependsOn: ['book_transport', 'book_stay'],
  });
  add('pack', o.handLuggageOnly ? 'Pack hand luggage only (within size and liquids limits)' : 'Pack bags (clothes, toiletries, medication, chargers)', 'Prepare', -1);
  if (nights >= 2) add('home', 'Sort the house (post, bins, plants, heating, lock up, tell a neighbour)', 'Prepare', -1);
  if (work) add('expenses_plan', 'Know the expenses policy and keep receipts', 'Prepare', -1);

  // Travel day
  if (flying) {
    add('checkin', 'Check in online and download boarding passes', 'Travel day', -1, { dependsOn: ['book_transport'] });
  }
  add('final_check',
    `Last check before leaving: ${abroad ? 'passports, ' : ''}tickets, wallet, phone, charger, medication, keys`,
    'Travel day', 0);

  // Return
  if (flying) add('return_checkin', 'Check in online for the return journey', 'Return', -1, { anchor: 'end', dependsOn: ['book_transport'] });
  if (modes.some((m) => m !== 'car')) add('return_transport', 'Confirm how you get home from the ' + hub + ' (parking, taxi or lift)', 'Return', -3, { anchor: 'end' });
  if (o.stay === 'need' || o.stay === 'booked') add('checkout', 'Check out, collect belongings and leave in good time', 'Return', 0, { anchor: 'end' });

  // Afterwards
  if (work) add('expenses_claim', 'Submit expenses and receipts', 'Afterwards', 3, { anchor: 'end' });

  // The person's own regular tasks for this kind of trip
  const regularList = normaliseRegular(regular);
  for (const r of regularList) {
    if (r.suppress) continue;
    if (r.types.length && !r.types.includes(trip.type)) continue;
    if (r.when !== 'any' && r.when !== trip.scope) continue;
    add(`mine_${r.id}`, r.title, 'My tasks', -r.days, { hint: 'Added because you asked for it on every trip like this.' });
  }

  // Removed for this trip, or for good
  const gone = new Set(o.dismissed);
  for (const r of regularList) if (r.suppress && (!r.types.length || r.types.includes(trip.type))) gone.add(r.suppress);
  if (gone.size) return out.filter((t) => !suppressed(t.key, gone));

  return out;
}

// Keep progress when answers change: match on key, keep what the person did.
export function mergeTasks(existing, generated) {
  const byKey = new Map(existing.filter((t) => t.key).map((t) => [t.key, t]));
  const seen = new Set();
  const out = generated.map((g) => {
    seen.add(g.key);
    const e = byKey.get(g.key);
    if (!e) return g;
    const keepEdits = e.userEdited;
    return {
      ...g,
      id: e.id,
      status: e.status,
      doneAt: e.doneAt,
      notes: e.notes,
      userEdited: e.userEdited,
      owner: keepEdits ? e.owner : g.owner,
      dueDate: keepEdits ? e.dueDate : g.dueDate,
    };
  });
  let sort = out.length;
  for (const e of existing) {
    const stale = e.key && !seen.has(e.key);
    if (!e.key || (stale && e.status === 'done')) out.push({ ...e, sort: sort++ });
  }
  return out;
}

// ---------- dependencies, RAG, countdown ----------
export function depTasks(task, all) {
  const out = [];
  for (const d of task.dependsOn || []) {
    for (const o of all) {
      if (o !== task && o.key && (o.key === d || o.key.startsWith(d + '@')) && !out.includes(o)) out.push(o);
    }
  }
  return out;
}
export const blockedBy = (task, all) => depTasks(task, all).filter((o) => o.status !== 'done');

// 'done' | 'red' | 'amber' | 'green'
export function taskRag(task, all, today) {
  if (task.status === 'done') return 'done';
  if (!task.dueDate) return 'green';
  const d = daysBetween(today, task.dueDate);
  if (d < 0) return 'red';
  if (d <= 7 && blockedBy(task, all).length) return 'red';
  if (d <= (task.isKey ? 14 : 7)) return 'amber';
  return 'green';
}

export function countdownFor(trip, today) {
  const toStart = daysBetween(today, trip.startDate);
  const toEnd = daysBetween(today, trip.endDate);
  const nights = daysBetween(trip.startDate, trip.endDate);
  if (toStart > 1) return { state: 'upcoming', days: toStart, big: String(toStart), unit: 'days to go', label: `${toStart} days to go`, nights };
  if (toStart === 1) return { state: 'upcoming', days: 1, big: '1', unit: 'day to go', label: 'Tomorrow', nights };
  if (toStart === 0) return { state: 'travelling', days: 0, big: '0', unit: 'Departure day', label: 'Departure day', nights };
  if (toEnd >= 0) {
    const day = -toStart + 1;
    return { state: 'travelling', days: toStart, big: String(day), unit: `of ${nights + 1} days`, label: `Day ${day} of ${nights + 1}`, nights };
  }
  return { state: 'finished', days: toStart, big: '✓', unit: 'Trip finished', label: 'Trip finished', nights };
}

const OVERALL = {
  red: 'Needs attention',
  amber: 'Some catching up',
  green: 'On track',
};

export function tripSummary(trip, tasks, today) {
  const countdown = countdownFor(trip, today);
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'done').length;
  const open = tasks.filter((t) => t.status !== 'done');
  const pct = total ? Math.round((done / total) * 100) : 0;
  const rag = new Map(open.map((t) => [t, taskRag(t, tasks, today)]));
  const overdue = open.filter((t) => t.dueDate && daysBetween(today, t.dueDate) < 0);
  const overdueKey = overdue.filter((t) => t.isKey);
  const reds = open.filter((t) => rag.get(t) === 'red');
  const ambers = open.filter((t) => rag.get(t) === 'amber');
  const openKey = open.filter((t) => t.isKey);

  let overall = 'green';
  if (
    overdueKey.length ||
    overdue.length >= 3 ||
    reds.some((t) => t.isKey) ||
    (countdown.state === 'upcoming' && countdown.days <= 7 && openKey.length) ||
    (countdown.state === 'upcoming' && countdown.days <= 3 && pct < 70)
  ) overall = 'red';
  else if (overdue.length || reds.length || ambers.some((t) => t.isKey) || ambers.length >= 3) overall = 'amber';

  const complete = total > 0 && done === total;
  return {
    countdown, total, done, pct, overall,
    overallLabel: complete ? 'All sorted' : OVERALL[overall],
    complete,
    finished: countdown.state === 'finished',
    overdue: overdue.length,
    open: open.length,
  };
}

// Everything that is (directly or indirectly) waiting on this task.
function dependentsOf(task, open, all) {
  const out = new Set();
  const queue = [task];
  while (queue.length) {
    const cur = queue.pop();
    for (const o of open) {
      if (o !== task && !out.has(o) && depTasks(o, all).includes(cur)) {
        out.add(o);
        queue.push(o);
      }
    }
  }
  return [...out];
}

// What to sort out first: open tasks you can act on now (nothing waiting on them) that either unlock other tasks
// or are key and due soon. A task that is itself blocked is not listed; its blocker is.
export function keyBlockers(tasks, today, limit = 5) {
  const open = tasks.filter((t) => t.status !== 'done');
  const items = [];
  for (const t of open) {
    if (blockedBy(t, tasks).length) continue;
    const blocks = dependentsOf(t, open, tasks);
    const days = t.dueDate ? daysBetween(today, t.dueDate) : null;
    if (!(blocks.length || (t.isKey && (days === null || days <= 21)))) continue;
    let message = days !== null && days < 0
      ? `${t.title} is ${plural(-days, 'day')} overdue`
      : `${t.title} (${dueLabel(t.dueDate, today).toLowerCase()})`;
    if (blocks.length) {
      const names = blocks.slice(0, 3).map((b) => b.title);
      message += ` — it is holding up: ${names.join('; ')}${blocks.length > 3 ? ` and ${blocks.length - 3} more` : ''}`;
    }
    items.push({ task: t, blocks, days, rag: taskRag(t, tasks, today), message });
  }
  const late = (x) => (x.days !== null && x.days < 0 ? 0 : 1);
  items.sort((a, b) => late(a) - late(b) || b.blocks.length - a.blocks.length || (a.days ?? 9999) - (b.days ?? 9999));
  return items.slice(0, limit);
}

export function groupByWhen(tasks, today) {
  const buckets = [
    { id: 'overdue', label: 'Overdue', tasks: [] },
    { id: 'week', label: 'This week', tasks: [] },
    { id: 'month', label: 'Next few weeks', tasks: [] },
    { id: 'later', label: 'Later', tasks: [] },
    { id: 'done', label: 'Done', tasks: [] },
  ];
  const by = Object.fromEntries(buckets.map((b) => [b.id, b]));
  for (const t of tasks) {
    if (t.status === 'done') { by.done.tasks.push(t); continue; }
    const d = t.dueDate ? daysBetween(today, t.dueDate) : 9999;
    (d < 0 ? by.overdue : d <= 7 ? by.week : d <= 30 ? by.month : by.later).tasks.push(t);
  }
  const cmp = (a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.sort - b.sort;
  for (const b of buckets) b.tasks.sort(b.id === 'done' ? (x, y) => String(y.doneAt || '').localeCompare(String(x.doneAt || '')) : cmp);
  return buckets.filter((b) => b.tasks.length);
}

export function groupByStage(tasks) {
  const map = new Map();
  for (const t of tasks) {
    if (!map.has(t.category)) map.set(t.category, []);
    map.get(t.category).push(t);
  }
  const rank = (c) => (CATEGORY_ORDER.includes(c) ? CATEGORY_ORDER.indexOf(c) : CATEGORY_ORDER.length);
  return [...map.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([label, ts]) => ({ id: slug(label), label, tasks: ts.sort((a, b) => a.sort - b.sort) }));
}
