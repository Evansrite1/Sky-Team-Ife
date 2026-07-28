# Sky Team Ife

Attendance, weekly reports, office rankings and center analytics.

Static front end on GitHub Pages, Supabase behind it for the database, accounts and the
server-side work. No build step, no npm install, no server to run.

---

## How it fits together

```
GitHub Pages  ──►  index.html      staff app (admins and offices, signed in)
                   scan.html       public attendance page (opened by QR, no login)
                        │
                        ▼
Supabase      ──►  Postgres        every table, protected by row-level security
                   Auth            email + password, hashed, with password reset
                   Edge functions  signup, scan, paystack-init, paystack-webhook, billing-cron
                        │
                        ▼
Paystack      ──►  ₦6,500 every 30 days per office, after a 30-day free trial
```

The browser only ever holds the Supabase **anon key**, which is designed to be public and is
useless without the policies in `supabase/schema.sql`. The service role key and the Paystack
secret key live only in the edge functions.

---

## Deploy in eight steps

### 1. Create the Supabase project

Sign up at supabase.com, create a project, pick a region close to Nigeria (`eu-west-1` is
usually the best of the available options). Save the database password somewhere safe.

### 2. Create the database

Open **SQL Editor** in the Supabase dashboard, paste the whole of `supabase/schema.sql`, run it.
It creates every table, the row-level security policies, and the function that generates the two
weekly trainings. It is safe to run again later.

Then change the two sign-up codes to something only your team knows:

```sql
update join_codes set code = 'YOUR-OFFICE-CODE' where kind = 'office';
update join_codes set code = 'YOUR-ADMIN-CODE'  where kind = 'admin';
```

### 3. Point the front end at your project

In **Project Settings → API**, copy the Project URL and the `anon` `public` key into `config.js`:

```js
supabaseUrl: 'https://abcdefgh.supabase.co',
supabaseAnonKey: 'eyJhbGciOi...',
```

Never put the `service_role` key here.

### 4. Deploy the edge functions

Install the Supabase CLI, then from the repository root:

```bash
supabase login
supabase link --project-ref YOUR-PROJECT-REF

supabase functions deploy signup           --no-verify-jwt
supabase functions deploy scan             --no-verify-jwt
supabase functions deploy paystack-webhook --no-verify-jwt
supabase functions deploy paystack-init
supabase functions deploy billing-cron     --no-verify-jwt
```

`signup`, `scan` and `paystack-webhook` are called by people who are not signed in, so they skip
JWT checking and do their own validation instead — the join code, the signed digit challenge, and
Paystack's HMAC signature. `paystack-init` requires a signed-in user.

Then set the secrets:

```bash
supabase secrets set SCAN_SECRET="$(openssl rand -hex 32)"
supabase secrets set PAYSTACK_SECRET_KEY="sk_test_..."
supabase secrets set CRON_SECRET="$(openssl rand -hex 32)"
supabase secrets set APP_URL="https://yourname.github.io/sky-team-ife"
supabase secrets set PLAN_AMOUNT_KOBO="650000"   # ₦6,500 — kobo, not naira
supabase secrets set PLAN_DAYS="30"
supabase secrets set ALLOWED_ORIGIN="https://yourname.github.io"
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically.

### 5. Publish the site

Push this folder to a GitHub repository, then **Settings → Pages → Deploy from a branch**, pick
`main` and `/ (root)`. A minute later the site is live at
`https://yourname.github.io/your-repo`.

If you use a custom domain instead, set it in the same screen and update `APP_URL` and
`ALLOWED_ORIGIN` above to match.

### 6. Create the first Super Admin

Sign up through the site as a Platform Admin using your admin code, then promote yourself once
in the SQL editor:

```sql
update profiles set role = 'super_admin' where email = 'you@example.com';
```

Sign out and back in. You can now create centers.

### 7. Set up Paystack

Follow `paystack-setup-guide.md`, which is written for this exact setup. The short version:

- Verify the business (CAC, TIN, director's ID and BVN, business bank account).
- Add the webhook URL `https://YOUR-PROJECT-REF.supabase.co/functions/v1/paystack-webhook`.
- Swap `PAYSTACK_SECRET_KEY` to the live key when you are ready.

**One thing worth knowing before you start:** Paystack has no "every 30 days" interval — its
`monthly` plan bills on the same date each month. That is why `billing-cron` exists: it holds the
card authorisation and charges every 30 days itself. If you would rather let Paystack manage
renewals, uncomment the `plan` line in `supabase/functions/paystack-init/index.ts`, create a
monthly plan, and stop scheduling the cron.

### 8. Schedule the daily job

In the Supabase dashboard under **Edge Functions → Schedules** (or any cron service), call
`billing-cron` once a day with the header `x-cron-secret: <your CRON_SECRET>`. It expires trials,
takes the payments that are due, retries failures, and rolls the weekly trainings forward.

---

## Day one, in order

1. Super Admin signs in and creates the first center — its two weekly trainings appear at once.
2. Offices sign up with the office code and pick that center. Their 30-day free trial starts.
3. Each office adds its distributors. **The phone number matters**: scanning in asks for two
   digits of it.
4. Wednesday at 2:45pm, the office opens the SM Training code and projects the QR.
5. Distributors scan, pick their office, find their name, confirm two digits, done.
6. By Tuesday each office files its weekly report.
7. Wednesday, the Platform Admin opens the evaluation list and reads the week.

---

## The rules the server enforces

These are in the database and the edge functions, not the browser, so they hold even if someone
tampers with the page:

- **One phone, one person, per event.** A unique index on `(event_id, device_id)`.
- **One person cannot be recorded twice.** A unique index on `(event_id, distributor_id)`.
- **The server picks which digits to ask for** and signs them. If the browser chose, an attacker
  would just pick the `080` prefix everyone shares.
- **SM Training only accepts Senior Manager and above.** Checked when listing names and again on
  submit.
- **A code only works while its session is open**, and opening a new code in a center closes any
  other live one.
- **Offices can only write their own data**, and only for the current week.
- **Roles cannot be self-assigned.** Accounts are created by the `signup` function, which requires
  the in-house code.

---

## Files

```
index.html            staff app shell
scan.html             public attendance page
config.js             your Supabase URL and anon key — the only file you must edit
css/styles.css        every style rule
js/api.js             Supabase client, session, loading, writes
js/ui.js              formatting, metrics, charts, chrome, tour copy
js/views.js           one function per screen
js/app.js             router and every click handler
js/scan.js            the public attendance flow
js/vendor/            supabase-js and qrcode-generator, vendored so there is no CDN to trust
supabase/schema.sql   tables, policies, triggers, seed codes and niche list
supabase/functions/   the five edge functions
```

## What is not built

Being straight about the gaps, so nothing surprises you in week two:

- **No email beyond password resets.** Trial-ending warnings, failed-payment notices and the
  Tuesday nudge to file the report all still need an email provider wiring in.
- **A past-due office is flagged but not locked out.** The banner appears; enforcing read-only is
  a policy change once you decide how strict to be.
- **Event tokens are readable by any signed-in staff account**, so one center's office could in
  principle open another center's code. Tighten with a view if that matters.
- **No audit log** of who changed what.
- **The edge functions have not been run against a live Supabase project** — they are written to
  the documented APIs, but test them on the test keys before you trust them with real money.
