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
                Functions      submit_access_request, approve_access_request,
                               decline_access_request, scan_lookup, record_scan,
                               center_lookup, ensure_week_events — SECURITY DEFINER
```

The browser only ever holds the Supabase **anon key**, which is designed to be public. Row
level security is what keeps one office out of another office's data. The `service_role`
key must never appear anywhere in this repository.

---

## Getting it running

**1. Create the schema.** Open your Supabase project → SQL editor → paste the whole of
[`supabase/schema.sql`](supabase/schema.sql) → Run. It is safe to run twice.

**2. Point the site at the project.** Already done — [`config.js`](config.js) carries the
project URL and the publishable (anon) key. If you ever move projects, swap the two values
there, commit and push; Vercel redeploys on its own.

**3. Sign up as the Super Admin.** The bootstrap address is set in the schema:

```sql
insert into app_settings (key, value) values ('bootstrap_admin', 'ademiluaolufemi@gmail.com');
```

Sign up on the live site with that address and you land as Super Admin. Change the row
first if you want a different one.

**4. Create your centers,** then send people the site address. That is the whole
invitation — there are no codes to hand out.

---

## Joining

Sign-up is open, and approval is the gate.

1. **They pick first.** An office, or a leader/director. The two need different things,
   so the choice comes before anything is typed and only the right fields are ever shown.
2. **They create the account** — an email and a password, nothing else on that screen.
3. **They fill in their details,** which depend on the choice:

   | | An office | A leader / director |
   |---|---|---|
   | Full name, phone | yes | yes |
   | Which center it reports to | yes | – |
   | Office name | yes | – |
   | Office address | yes | – |

   An office is asked to sign up with its **office email address**, since the account
   belongs to the office rather than to whoever runs it today. There is no short code and
   no area. An office is its name, its address and the person who runs it, and two offices
   in the same center may not share a name.

4. **The Super Admin approves.** It shows under *Centers & leaders* with a count in the
   sidebar. Approving an office is what creates it; nothing exists before that.
5. Declining sends a reason back, and the form comes back pre-filled so they can fix it
   and ask again.

Until approval the account is `pending`. It has no navigation, no dashboard, and the row
level security policies return nothing to it: not a report, not a distributor, not even
the list of offices. A pending account can read the names of your centers, because the
sign-up form has to offer them, and nothing else.

---

## Who can do what

| | Super Admin | Leader | Office |
|---|---|---|---|
| Approve or decline new accounts | yes | – | – |
| Create centers, add leaders | yes | – | – |
| Every center, every office, every report | yes | yes | – |
| Wednesday evaluation list, monthly summary, rankings | yes | yes | own center |
| File the weekly report | – | – | own office |
| Manage distributors | – | – | own office |
| Open and close scanning | yes | yes | own center |

Roles are enforced twice: the navigation hides what you cannot reach, and the row level
security policies in the schema refuse it even if you type the URL by hand.

---

## The week

A week runs **Thursday → Wednesday**: 30 Jul – 5 Aug is one week, 6 – 12 Aug the next.
Everything is stamped with `week_start`, the Thursday that opens it, so no week table has
to be maintained.

It ends on the Wednesday the evaluation is held, which is the point of the shape — an
evaluation always reads the seven days ending that day, never a week still running.

| | When | Where in the week |
|---|---|---|
| **Distributor Training** | Friday, 2:45pm, everyone | day 2 |
| **Senior Manager Training** | Wednesday, 2:45pm, Senior Managers and above | day 7 |
| **Evaluation** | Wednesday, 2:45pm | the day it closes |

Both trainings create themselves for every zone, once per week, the first time anyone
opens the Trainings page. Anything else — a rally, a launch, a directors' meeting — is a
zone event you create by hand.

**Weeks are numbered from when the record began, not from the calendar.** Week 1 is the
Thursday the app started tracking — 30 Jul 2026 — regardless of what the ISO calendar
would call that week; Week 2 follows it, and so on, counting up forever. Nothing before
Week 1 is part of the tracked history.

**A month is four of those weeks**, not a calendar month. Month 1 is called August
because that is the month the record began in, Month 2 is September, and so on — the
tracking calendar and the real calendar drift in step but do not have to agree on where
a week starts. This is what the Monthly summary, Office rankings and an office's own
Performance list are all scoped to.

---

## Attendance

`scan.html` itself is unchanged and still works exactly as below — but the zone page's
own "download the permanent QR as a poster" button is off for now, showing *Coming soon*
in its place while attendance is reworked. The permanent URL still functions
(`scan.html?center=<id>`) even without a button that prints it; a per-session QR points
at `scan.html?c=<CODE>`. No account is needed at any point. The walk through is:

1. **Scan** the poster with a phone camera.
2. **Pick the session** happening now — the page lists this week's for that center.
3. **Pick your office** from the ones in that center.
4. **Find your name** in the list, typing to narrow it.
5. **Complete your number.** The page shows the network prefix the office has on file —
   `0803 ••• ••••` — and asks for the last four digits. Get it right and you are in.

Five rules are enforced in the database, never in the browser:

1. Scanning has to be **open** — the office opens it when the session starts.
2. **One accepted scan per person** per session.
3. **One phone, one person** per session. A second attempt from the same handset is
   written down as a rejection with the reason, so it can be audited afterwards.
4. **The number has to match.** Picking a name off a list is not proof; completing the
   number the office already holds is. Wrong guesses are recorded, and after five from
   the same handset that session is closed to it.
5. **The full number never reaches the browser.** `scan_lookup` returns only the first
   four digits as a hint; the comparison happens inside `record_scan`.

Where the office has no number on file, the page asks for the whole one and saves it for
next time — so the check tightens itself as people use it.

The device id is written to `localStorage`, `sessionStorage` and a cookie at once. Clearing
any one of them leaves the other two to put it back.

---

## Layout

```
index.html            the staff app
scan.html             the public attendance page
config.js             your Supabase URL and anon key
manifest.webmanifest  name, icons and display mode for installing
sw.js                 service worker — caches the shell, never the data
icons/                the app icons, 192 and 512, plus a maskable one
css/styles.css        the whole design system
js/ui.js              formatting, week maths, icons, charts, the logo, components
js/api.js             every call to Supabase, in one place
js/views.js           one function per page
js/app.js             boot, auth, router, actions
js/scan.js            the public scan page
js/vendor/            supabase-js and the QR encoder, vendored so nothing loads from a CDN
supabase/schema.sql   tables, row level security, functions, triggers
```

---

## On a phone

It is a real installable app, not a page that happens to fit. Open it on a phone and it
offers to add itself to the home screen; from there it launches full screen with no
browser bar at all.

- **A bottom tab bar** replaces the sidebar under 860px — the four places that role
  actually goes, plus *More* for everything else. The approval count rides on the tab.
- **Safe areas** are respected, so nothing hides under a notch or a home indicator.
- **Inputs are 16px**, which is the only way to stop iOS zooming when one is focused.
- **The shell is cached** by [`sw.js`](sw.js), so a cold start is instant and a dropped
  signal does not blank the page. Supabase calls always go to the network — attendance and
  reports are never served from a cache.

Bump `CACHE` in [`sw.js`](sw.js) when you change the shell, or installed phones will keep
the old files until they happen to refetch.

---

## Billing

Phase 2. The `subscriptions` and `payments` tables exist and every office starts a 30-day
trial automatically, but nothing is charged: `billingEnabled` is `false` in `config.js` and
the Subscriptions page says so plainly. [`paystack-setup-guide.md`](paystack-setup-guide.md)
covers what still has to be wired up.

---

## Licence

MIT — see [LICENSE](LICENSE).
