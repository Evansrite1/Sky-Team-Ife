# Sky Team Ife

Attendance, weekly reports, office rankings and center analytics.

A static front end on Vercel with Supabase behind it for the database, the accounts and the
row-level security. No build step, no `npm install`, no server to run.

---

## How it fits together

```
Vercel     ──►  index.html     the staff app — admins and offices, signed in
                scan.html      the public attendance page, opened by the QR code, no login
                     │
                     ▼
Supabase   ──►  Postgres       every table, protected by row level security
                Auth           email and password, with password reset
                Functions      claim_office, claim_admin, scan_lookup, record_scan,
                               ensure_week_events — all SECURITY DEFINER
```

The browser only ever holds the Supabase **anon key**, which is designed to be public. Row
level security is what keeps one office out of another office's data. The `service_role`
key must never appear anywhere in this repository.

---

## Getting it running

**1. Create the schema.** Open your Supabase project → SQL editor → paste the whole of
[`supabase/schema.sql`](supabase/schema.sql) → Run. It is safe to run twice.

**2. Point the site at the project.** In [`config.js`](config.js) replace the two
placeholders with the values from Supabase → Project Settings → API:

```js
supabaseUrl: 'https://xxxxxxxxxxxx.supabase.co',
supabaseAnonKey: 'eyJhbGciOi...'
```

Commit and push — Vercel redeploys on its own. Until those are filled in the site shows a
short "not connected yet" page instead of failing silently.

**3. Sign up as the Super Admin.** The bootstrap address is set in the schema:

```sql
insert into app_settings (key, value) values ('bootstrap_admin', 'ademiluaolufemi@gmail.com');
```

Sign up on the live site with that address and you land as Super Admin. Change the row
first if you want a different one.

**4. Create your centers,** then hand the office join code to each office. Both codes live
under *Centers & admins* and can be changed there at any time.

---

## Who can do what

| | Super Admin | Platform Admin | Office |
|---|---|---|---|
| Create centers, add admins, change join codes | yes | – | – |
| Every center, every office, every report | yes | yes | – |
| Wednesday evaluation list, monthly summary, rankings | yes | yes | own center |
| File the weekly report | – | – | own office |
| Manage distributors | – | – | own office |
| Open and close scanning | yes | yes | own center |

Roles are enforced twice: the navigation hides what you cannot reach, and the row level
security policies in the schema refuse it even if you type the URL by hand.

---

## The week

A week runs **Wednesday → Tuesday**. Everything is stamped with `week_start`, the Wednesday
that opens it, so no week table has to be maintained.

- **Senior Manager Training** — every Wednesday, 2:45pm, Senior Managers and above
- **Distributor Training** — every Friday, 2:45pm, everyone
- **Evaluation** — the Wednesday after the week closes, 2:45pm

Both trainings create themselves for every center, once per week, the first time anyone
opens the Trainings page. Anything else — a rally, a launch, a leaders' meeting — is a
center event you create by hand.

---

## Attendance

Each session carries a QR code and a short code. The QR points at
`scan.html?c=<CODE>`. A distributor scans it with a phone camera, picks their office,
finds their name, and they are in. No account needed.

Three rules are enforced in the database, not the browser:

1. Scanning has to be **open** — the office opens it when the session starts.
2. **One accepted scan per person** per session.
3. **One phone, one person** per session. A second attempt from the same handset is
   written down as a rejection with the reason, so it can be audited afterwards.

---

## Layout

```
index.html            the staff app
scan.html             the public attendance page
config.js             your Supabase URL and anon key
css/styles.css        the whole design system
js/ui.js              formatting, week maths, icons, charts, components
js/api.js             every call to Supabase, in one place
js/views.js           one function per page
js/app.js             boot, auth, router, actions
js/scan.js            the public scan page
js/vendor/            supabase-js and the QR encoder, vendored so nothing loads from a CDN
supabase/schema.sql   tables, row level security, functions, triggers
```

---

## Billing

Phase 2. The `subscriptions` and `payments` tables exist and every office starts a 30-day
trial automatically, but nothing is charged: `billingEnabled` is `false` in `config.js` and
the Subscriptions page says so plainly. [`paystack-setup-guide.md`](paystack-setup-guide.md)
covers what still has to be wired up.

---

## Licence

MIT — see [LICENSE](LICENSE).
