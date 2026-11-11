# My Travel Tasks

A [Cobalt Pink Software](https://cobaltpinksoftware.com) progressive web app. Tell it about a trip and it builds a dated checklist: **what** needs doing, **when**, and **who** is doing it. You get a countdown, a red/amber/green view of how ready you are, and a plain list of what is holding you up.

Live at: `https://mytraveltasks.cobaltpinksoftware.com` (once deployed, see below)

## MVP features

- **Guest mode** (no sign-in): trips and checklists live on the device.
- **Accounts** (email and password): trips sync via Neon, so they are available on any device. Guest trips can be brought across when you register or sign in.
- **Multiple trips**, each with its own checklist.
- **Trip questions**: dates, type (holiday, mini-break, work, visiting family, other), for me or others, UK or abroad, destination country, who is travelling (adult, child, infant), passport status per person, visa need, transport, accommodation, car hire, pets and more.
- **Generated tasks** with a due date, an owner and dependencies (see the rules below). Tick them off as you go; add your own; change the owner or the date.
- **Countdown**, **overall RAG**, **per-task RAG** and **"What's holding you up"** (the tasks you can act on now that unlock the most other tasks).
- **Edit a trip** later and the checklist updates while keeping your progress, notes and edits.
- Installable and works offline (guest mode fully; accounts can read their last-synced trips offline).
- Download all your data, and delete your account, from the Account page.

Not in the MVP yet: document upload, live flight/gate updates, push reminders, sharing a trip. See the roadmap.

## How tasks and RAG work

All of this lives in [`public/js/core.js`](public/js/core.js), is pure logic, and is covered by tests.

**Task generation.** Each task has a lead time relative to the first day (or the last day for the return journey). If you plan a trip late, tasks that would already be overdue are set to *due today* rather than shown as failures.

**Dependencies.** Some tasks cannot start until others are done, e.g. *Book flights* depends on every traveller's passport (abroad) and, for work trips, on *Get the trip approved*. A task waiting on something shows **Waiting on: …**.

**Task RAG**

| Status | Rule |
| --- | --- |
| Done | Ticked off |
| Red | Overdue, or due within 7 days and still waiting on another task |
| Amber | Due within 7 days (14 days for key tasks) |
| Green | Anything further out |

**Overall RAG**

| Status | Rule |
| --- | --- |
| Red | Any overdue key task, or 3+ overdue tasks, or a key task that is red, or the trip is within 7 days with key tasks still open, or within 3 days and under 70% done |
| Amber | Anything overdue, any red task, a key task that is amber, or 3+ ambers |
| Green | Everything else. "All sorted" once every task is done |

**What's holding you up.** Open tasks that nothing is waiting on, and that either unlock other tasks (counting indirect ones) or are key and due soon. A task that is itself blocked is not listed. Its blocker is.

## Stack

| Part | Choice |
| --- | --- |
| Front end | Vanilla JS (ES modules), HTML, CSS. No build step |
| Hosting and API | Cloudflare Pages, with Pages Functions under `/api/*` |
| Database | Neon Postgres (`@neondatabase/serverless`) |
| Auth | Email and password (PBKDF2, Web Crypto), `HttpOnly` session cookie, sessions stored hashed in Neon |
| Brand | Sora (self-hosted) and the Cobalt Pink palette, in `public/css/tokens.css` |

```
public/            static site and PWA (index.html, js/, css/, icons/, sw.js, manifest, _headers)
  js/core.js       task generation, dependencies, RAG, countdown, validation
  js/store.js      GuestStore (localStorage) and ApiStore (fetch)
  js/app.js        the UI
functions/api/     Cloudflare Pages Function: the whole JSON API
server/            auth, HTTP helpers, SQL
migrations/        SQL, applied in order
test/              node:test (logic, server helpers, UI via jsdom)
```

## Set up

### 1. Database (done)

A Neon project named `mytraveltasks` (eu-west-2) already exists with migrations `001` and `002` applied. For a fresh database, run the files in `migrations/` in order.

### 2. Cloudflare Pages

1. Cloudflare dashboard, **Workers & Pages**, **Create**, **Pages**, **Connect to Git**, choose this repository.
2. Build settings: framework **None**, build command **(empty)**, build output directory **`public`**.
3. **Settings, Variables and secrets**: add `DATABASE_URL` as a **secret** (Production, and Preview if you want previews to work). Use the Neon connection string. For previews, point at a Neon branch rather than production data.
4. **Custom domains**: add `mytraveltasks.cobaltpinksoftware.com`. If the `cobaltpinksoftware.com` zone is on Cloudflare, the DNS record is created for you.
5. Recommended: add a **rate limiting rule** for `/api/auth/*` (for example 10 requests per minute per IP). The app has no built-in login throttle.

### 3. Local development

```bash
npm install
cp .dev.vars.example .dev.vars   # then put a Neon dev-branch connection string in it
npm run dev                      # wrangler pages dev, http://localhost:8788
npm test
```

`npm run fonts` re-copies the Sora files from `@fontsource/sora` into `public/assets/fonts`.

## Security notes

- Passwords are hashed with PBKDF2-SHA256. **Cloudflare Workers caps PBKDF2 at 100,000 iterations**, which is below current OWASP guidance (600,000). Mitigations: a 10-character minimum and the rate limiting rule above. If you want stronger hashing, the options are Argon2 via WASM or Neon Auth.
- Session tokens are random, stored only as a SHA-256 hash, and sent in an `HttpOnly`, `SameSite=Lax` (and `Secure` on HTTPS) cookie.
- State-changing requests must come from the app's own origin and carry JSON.
- Every query is scoped by `user_id`.
- A strict Content Security Policy is set in `public/_headers` (no inline scripts or styles). Keep it that way: do not add inline `style=""` or `onclick=""`.
- Never commit `.dev.vars`. It is git-ignored.

## Roadmap

1. **Entry rules by destination and passport**: what each traveller needs, and the tasks that follow. See [docs/requirements-entry-rules.md](docs/requirements-entry-rules.md).
2. **Documents**: upload passport, tickets and insurance (Neon storage or R2), with expiry reminders and an offline "needed today" pack.
3. **Travel hub mode**: a "leave by" time and a step-by-step journey through the airport or station.
4. **Live updates** (optional per trip): delays, gates and platforms.
5. **Reminders** by web push and email, and sharing a trip with family or colleagues.
