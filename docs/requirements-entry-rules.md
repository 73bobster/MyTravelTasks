# Requirement: entry rules by destination and passport nationality

Status: phase 1 built (UK passport, 22 destinations) on 11 Nov 2026. Rules live in `public/data/rules/gb.json`; logic in `public/js/entry.js`. Added 11 Nov 2026 from a real example: a British passport holder going to Spain for a conference, 17 to 21 November.

## Why

What a traveller needs depends on **where they are going**, **which passport each person holds**, and **why they are going**. The same destination can mean a visa for one traveller and nothing for another, and a business visit allows different things from a holiday. Today the app asks about passports and visas in general terms. This feature makes it specific, and turns the answer into tasks.

## The worked example

British citizen, Spain (Schengen), business visit (conference or roadshow), 5 days.

| Rule | What the host's advice said |
| --- | --- |
| Visa | Not needed for a business visitor |
| Allowed | Meetings, conferences, training, visiting facilities |
| Not allowed | Any work or paid activity in Spain |
| Time limit | No more than 90 days in any 180 in the Schengen area |
| Carry, if asked at the border | Passport valid at least 3 months; return ticket or itinerary; proof of accommodation; medical insurance with proof (card or policy); letter from the Spanish host company (purpose, schedule, activities, duration); proof of means (bank statements for 3 to 6 months, or other proof of income) |

Each carry item becomes a task with an owner and a due date, for example:

- *Ask the host for the invitation letter* (waits on the host, due 14 days before)
- *Get insurance that covers medical care in Spain, and keep the proof on your phone*
- *Download 3 to 6 months of bank statements*
- *Print or save the itinerary and hotel booking*

## What the app needs to know

**Per traveller**: nationality of each passport held (some people hold two), passport expiry date, and optionally their recent Schengen days.

**Per trip**: destination country, purpose (holiday, business, visiting family, study, transit), and for business trips what the person will actually do (meetings and events, hands-on or paid work, installing or servicing equipment). The answer is what decides "business visitor" against "needs a work permit".

## What a rule returns

Rules are keyed by **destination, passport nationality and purpose**.

- Entry status: visa-free, visa needed, electronic authorisation needed (for example ESTA, eTA, ETIAS where it applies), or visa on arrival
- Maximum stay and any rolling-window limit, such as 90 in 180
- Passport validity needed on arrival and on departure
- What is allowed and what is not for this purpose
- Documents to carry, split into **always** and **if asked at the border**
- Insurance, health and vaccination requirements
- Lead times, for example how long an authorisation takes
- Link to the official source, date last checked, and who checked it

## How it changes the app

1. **Trip form**: choose the passport(s) for each traveller, and a purpose that includes the work question above.
2. **Task generation**: the rule's carry list and lead times replace the generic passport and visa tasks. Each traveller gets their own tasks, so a family on different passports sees different lists.
3. **Dependencies**: "Book flights" waits on a valid passport and any authorisation. "Get your visa" waits on the invitation letter.
4. **RAG and blockers**: a passport that expires inside the validity window, or an authorisation that needs more lead time than remains, goes red and appears under "What's holding you up".
5. **Rule card on the trip**: a short "Entry rules for this trip" summary with the source link and "last checked" date.
6. **Schengen day counter**: from each traveller's past and planned trips, warn when a plan would exceed 90 in 180.

## Where the rules come from

Do not scrape or guess. Rules change, so each one needs a named source and a date.

- **Start with the UK passport.** UK government travel advice has an entry-requirements section for every country, which suits the first audience.
- **Add other passports gradually**, starting with the most common nationalities for the most visited destinations, using each destination government's own immigration pages.
- **Commercial feeds** (for example IATA Timatic, or a visa-data API) cover every pairing but cost money. Decide later, once the free product has users.
- **Store rules as reviewed data files in the repo**, not in the database, so every change is a visible, reversible commit. Claude can draft a rule from the official page and a person checks it before it goes in.

## Scope

- **Phase 1**: UK passport holders to the 25 or so most visited destinations, for holiday and business purposes. Includes the Schengen counter.
- **Phase 2**: the most common other nationalities for the same destinations.
- **Phase 3**: wider coverage, transit rules, study and work purposes, and rule-change alerts for trips already planned.

## Risks and rules of the road

- This is guidance, not legal or immigration advice. Every rule card says so, links to the official source, and shows when it was last checked.
- A rule older than its review period (for example 6 months) is shown as "needs checking" rather than hidden.
- Known changes on the horizon, such as the EU's electronic entry and travel-authorisation systems, need a named owner so the data is updated when they take effect.
- Stored passport nationality and expiry dates are personal data. Keep them to what the rules need, and cover them in the existing account export and delete.

## Open questions

1. Is Phase 1 (UK passport, top destinations) the right first slice?
2. Should a manual "I've checked this myself" tick be allowed on each rule-driven task, or only on the task as a whole?
3. Do we want a "rules checked on" badge visible to users, or only on the rule card?

## Phase 1 as built

- 22 destinations for UK passports: Spain, France, Italy, Portugal, Greece, Germany, Netherlands, Croatia, Malta, Cyprus, Ireland, USA, Canada, Mexico, Turkey, UAE, Egypt, Morocco, Thailand, Japan, Australia, India.
- Every rule shows a confidence level (high, medium, low, or "needs re-checking" after 90 days), the date last checked, the date the GOV.UK page was last updated, and links to official government pages.
- Confidence means: high = visa, stay and passport are all stated plainly on the UK government page; medium = something is missing, changing or unclear; low = a key fact is unclear.
- Every rule card carries a "please check this yourself" note: planning aid, not legal or immigration advice.
- Tasks: check-the-rules task, per-traveller authorisation (ESTA, eTA, e-visa) and arrival forms, border-document tasks, work-permit check for hands-on work, renew-passport when the expiry is too short.
- Not yet: Schengen day counter, other nationalities, dual passports.
- Items from hosts that are not on GOV.UK (for example 3 to 6 months of bank statements for Spain) are labelled as host advice.
