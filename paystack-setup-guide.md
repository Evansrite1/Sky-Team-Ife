# Turning on payments

Offices pay **₦6,500 every 30 days**, after a **16-day free trial**. Nobody else pays:
directors and the Super Admin have no subscription at all.

Everything below is done once. Budget about half an hour.

---

## Why there are two functions

This site is static files on Vercel. There is no server, and a browser cannot be trusted to
say "I paid" — anyone could type that. So two small functions run inside your Supabase
project:

| | What it does | Who calls it |
|---|---|---|
| `paystack-init` | Works out who the office is and what it owes, asks Paystack to start a checkout, hands back the URL | The app, when an office presses **Pay** |
| `paystack-webhook` | Receives Paystack's "this actually got paid" message, checks the signature, marks the office active | Paystack, on its own |

The amount is decided inside `paystack-init` by reading `app_settings`. The request body is
ignored, so even a hand-crafted request cannot change the price.

---

## 1. Create the plan in Paystack

Paystack → **Plans** → **New Plan**

| Field | Value |
|---|---|
| Name | `Office plan` |
| Amount | `6500` |
| Interval | `Monthly` |
| Currency | NGN |

Copy the **plan code**. It looks like `PLN_xxxxxxxxxxxx`.

> **One thing to know:** Paystack's *Monthly* bills on the same date each month, not every
> 30 days exactly. An office that pays on the 3rd is charged on the 3rd, and February is
> shorter than the 30 days you asked for. If exact 30-day cycles matter more than
> predictable dates, say so and I will drive the charges from the app instead of using a
> Paystack plan.

## 2. Get your secret key

Paystack → **Settings** → **API Keys & Webhooks** → copy the **Secret Key** (`sk_live_…`).

Never put this key in `config.js`, in the repo, or anywhere the browser can reach. It goes
only into Supabase, in step 4.

## 3. Deploy the two functions

Supabase dashboard → **Edge Functions** → **Deploy a new function** → **Via Editor**.

**a. `paystack-init`** — paste the whole of
[`supabase/functions/paystack-init/index.ts`](supabase/functions/paystack-init/index.ts).
Leave *Enforce JWT verification* **on**: only a signed-in office should be able to start a
payment.

**b. `paystack-webhook`** — paste
[`supabase/functions/paystack-webhook/index.ts`](supabase/functions/paystack-webhook/index.ts).
Turn *Enforce JWT verification* **off**. Paystack has no Supabase login; the signature check
inside the function is what proves the request is genuine. Leave JWT on and every webhook is
rejected, so nobody is ever marked as paid.

## 4. Add the secrets

Edge Functions → **Manage secrets** → add three:

| Name | Value |
|---|---|
| `PAYSTACK_SECRET_KEY` | your `sk_live_…` |
| `PAYSTACK_PLAN_CODE` | your `PLN_…` |
| `SITE_URL` | `https://sky-team-ife.vercel.app` |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are already there.

## 5. Point Paystack at the webhook

Paystack → **Settings** → **API Keys & Webhooks** → **Webhook URL**:

```
https://xuxukwrvyduilmxyswik.functions.supabase.co/paystack-webhook
```

## 6. Switch billing on

Two switches, and **both** must be flipped:

- In [`config.js`](config.js), set `billingEnabled: true`, then commit and push.
- In Supabase, run:

```sql
update app_settings set value = 'true' where key = 'billing_enabled';
```

The first shows the pay button. The second is what enforces the lock, in the database, where
it cannot be bypassed. Until the second is `true` nothing is ever locked, however long a
trial has been over.

---

## What an office sees

- **Days 1–11 of the trial** — a quiet line saying how long is left.
- **Last 5 days** — the panel turns dark and the pay button moves up beside it.
- **Trial over, unpaid** — every page redirects to Subscription. They can still sign in, read
  their own history, and reach the Guide and their Account. They cannot file a report or open
  scanning. The database refuses those writes too, so the lock holds even if someone bypasses
  the app.
- **Paid** — everything comes straight back. Nothing was deleted.

---

## Testing before you go live

Use your Paystack **test** keys (`sk_test_…`) and a test plan code first. Paystack sends test
events to the same webhook URL.

Test card: `4084 0840 8408 4081`, any future expiry, any CVV, OTP `123456`.

To check the lock without waiting 16 days, expire a trial by hand:

```sql
update subscriptions set trial_ends = current_date - 1
 where office_id = (select id from offices where name = 'Your Test Office');
```

Sign in as that office. Every page should bounce to Subscription. Pay with the test card, and
within a second or two the webhook should flip it to `active` with a fresh `next_charge`.

If it does not, look at **Edge Functions → paystack-webhook → Logs**. A `401 bad signature`
means the secret key in Supabase does not match the one Paystack signed with — usually test
keys against a live webhook, or the reverse.

---

## What is stored

`subscriptions` holds one row per office: status (`trial` / `active` / `past_due` /
`cancelled`), the trial end, the next charge date, the card brand and last four digits, and
Paystack's own customer and subscription codes so a renewal a year from now can still be
traced back to the office that made it.

`payments` holds one row per attempt, successful or failed, keyed on Paystack's reference so
a retried webhook can never double-count.
