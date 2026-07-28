# Paystack setup — Sky Team Ife office subscription

**What you are charging:** ₦6,500 per office, every 30 days, after a 30-day free trial.

Read the section "The 30-day problem" first. It changes which of the two paths you take, and everything else follows from that choice.

---

## The 30-day problem (read this before you build anything)

Paystack plans support these intervals only: `daily`, `weekly`, `monthly`, `quarterly`, `biannually`, `annually`. There is no "every 30 days."

And `monthly` is not 30 days — it is the same date each month. Paystack's own documentation spells it out: a subscription created on or before the 28th is billed on that same day every month, and one created between the 29th and 31st is billed on the 28th of every following month. Over a year that is 12 charges instead of the 12.17 you would get from a strict 30-day cycle, and February is 28 days while July is 31.

So you have two paths:

**Path A — use `monthly` and stop worrying.** Simplest by far. Paystack handles renewals, retries and dunning for you. You write far less code. The cost is that "every 30 days" becomes "same day each month." For a ₦6,500 subscription that difference is worth roughly ₦100/office/year. **This is what I would do.**

**Path B — charge every 30 days exactly.** You do not use Paystack subscriptions at all. You take the first payment, store the returned `authorization_code`, and run your own daily cron that charges any office whose `next_charge_date` is today. You gain exact 30-day cycles and full control of retries and trials. You take on the work of writing the retry logic, the dunning emails, and the failure handling that Paystack would otherwise do.

Both are written out below. Path B is longer but not hard.

---

## Step 1 — Account setup (both paths)

1. Create a business account at paystack.com and complete verification. You will need CAC documents, a valid ID and your settlement bank account. Verification usually takes a day or two — start it now, before you write code.
2. Once in the dashboard, go to **Settings → API Keys & Webhooks**. You get four values: a test public key, a test secret key, and the same pair for live.
3. Put them in environment variables. Never in the frontend, never in git:

```
PAYSTACK_SECRET_KEY=sk_test_xxxxxxxx
PAYSTACK_PUBLIC_KEY=pk_test_xxxxxxxx
```

The **public** key is the only one that goes anywhere near the browser. The **secret** key is server-only. If a secret key ever lands in frontend code or a public repo, rotate it from the dashboard immediately.

4. Build and test everything on the test keys. Swap to live keys only at the end.

---

## Step 2 — What to store in your own database

Regardless of path, your `offices` table needs these columns. This is the part people skip and regret.

| Column | Why |
|---|---|
| `paystack_customer_code` | `CUS_xxx` — identifies the office at Paystack |
| `authorization_code` | `AUTH_xxx` — lets you charge the saved card again |
| `card_last4`, `card_brand`, `card_exp` | To show "Visa •••• 4081" without storing the card |
| `subscription_code` | `SUB_xxx` — Path A only |
| `email_token` | Path A only, needed to cancel a subscription |
| `billing_status` | `trial` / `active` / `past_due` / `cancelled` |
| `trial_ends_at` | Set to signup date + 30 days |
| `next_charge_date` | What your cron reads (Path B) or what you display (Path A) |

You never store the card number, CVV, or expiry-with-PAN. Paystack holds those. You hold a token.

---

## Step 3 — The free trial

Do **not** ask for a card at signup. The office signs up, you set:

```
billing_status = 'trial'
trial_ends_at  = signup_date + 30 days
```

and let them work. A daily cron checks for trials expiring in 7, 3 and 1 days and emails the office manager. On the day the trial ends, if there is no `authorization_code`, flip them to `past_due` and show the banner.

If they add a card during the trial, charge ₦50 and immediately refund it to capture the authorization (this is the standard way to tokenise a card without taking money), or simply wait and take the first ₦6,500 on the day the trial ends. The second is cleaner and is what the prototype does.

---

## Path A — Paystack subscriptions (`monthly`)

### A1. Create the plan (once)

```bash
curl https://api.paystack.co/plan \
  -H "Authorization: Bearer $PAYSTACK_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Sky Team Ife — Office plan",
    "interval": "monthly",
    "amount": 650000,
    "currency": "NGN"
  }' \
  -X POST
```

**`amount` is in kobo.** ₦6,500 = `650000`. Getting this wrong by a factor of 100 is the single most common Paystack mistake. Save the returned `plan_code` (`PLN_xxx`) in your config.

### A2. Start the subscription when the trial ends

Initialize a transaction with the plan attached. Paystack takes the first payment and sets up the recurring schedule itself.

```js
// server-side
const res = await fetch('https://api.paystack.co/transaction/initialize', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    email: office.email,
    amount: 650000,
    plan: process.env.PAYSTACK_PLAN_CODE,
    callback_url: 'https://app.skyteamife.com/billing/callback',
    metadata: { office_id: office.id, office_name: office.name }
  })
});
const { data } = await res.json();
// send the office to data.authorization_url
```

Put your `office_id` in `metadata` every single time. When the webhook arrives months later, that is how you know which office it belongs to.

### A3. Confirm the payment

The callback URL is not proof of payment — a user can close the tab, or the redirect can fail. Always verify server-side:

```js
const r = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
  headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
});
const { data } = await r.json();
if (data.status === 'success') {
  // mark active, store data.authorization.authorization_code,
  // data.customer.customer_code, data.authorization.last4 / card_type / exp_month
}
```

Renewals after the first one arrive only as webhooks. There is no redirect to catch. Which brings us to the part that actually matters.

---

## Path B — your own 30-day cron

### B1. Take the first payment and keep the authorization

Same `transaction/initialize` call as A2, but **omit the `plan` field**. Verify it the same way, and store `authorization.authorization_code`, plus the card display fields.

Then set `next_charge_date = today + 30 days`.

### B2. Charge on schedule

A cron that runs once a day:

```js
const due = await db.offices.where('next_charge_date <= today')
                           .where('billing_status IN (active, past_due)');

for (const office of due) {
  const r = await fetch('https://api.paystack.co/transaction/charge_authorization', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: office.email,
      amount: 650000,
      authorization_code: office.authorization_code,
      metadata: { office_id: office.id }
    })
  });
  const { data } = await r.json();

  if (data.status === 'success') {
    await markPaid(office, data.reference);
    await setNextCharge(office, addDays(office.next_charge_date, 30));
  } else {
    await markPastDue(office, data.gateway_response);
    await scheduleRetry(office);   // e.g. +3 days, then +3, then suspend
  }
}
```

Two things to get right here. **Idempotency:** if the cron runs twice, or crashes halfway and is restarted, you must not charge twice — pass your own unique `reference` per billing period and check whether one already exists before charging. **Advance `next_charge_date` from the previous due date, not from today**, or every failed retry quietly shifts the office's billing date forward.

### B3. Retry and suspend policy

Write it down and make it the same for everyone. A reasonable one:

- Charge fails → status `past_due`, email the office, retry in 3 days.
- Second failure → retry in 3 more days.
- Third failure → office goes read-only. They can still read everything; they cannot file reports or open QR codes.
- They pay → back to `active` immediately, `next_charge_date` = today + 30.

Never delete data on non-payment. The prototype's cancel copy says exactly this, and it is worth honouring: reports, attendance and rankings survive a lapsed subscription.

---

## Step 4 — Webhooks (both paths, non-negotiable)

Paystack's own guidance is "don't call us, we will call you." Card renewals, delayed successes and failures all arrive here and nowhere else.

Set the URL in **Settings → API Keys & Webhooks**. It must be publicly reachable — localhost will not receive events, so use ngrok while developing.

### Verify every request

Paystack signs each event with an `x-paystack-signature` header, which is an HMAC SHA512 of the payload body signed using your secret key, and verification must happen before you process the event.

```js
const crypto = require('crypto');

app.post('/webhooks/paystack', express.json(), (req, res) => {
  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (hash !== req.headers['x-paystack-signature']) return res.sendStatus(401);

  res.sendStatus(200);        // acknowledge FIRST
  handleEvent(req.body);      // then process, asynchronously
});
```

Respond 200 quickly and do the work afterwards. If you process first and it takes too long, Paystack treats it as a failed delivery and resends — which is also why your handler must be idempotent, keyed on the event reference.

Paystack sends webhooks only from a fixed set of IP addresses, published in their dashboard and docs, and anything from elsewhere should be treated as counterfeit. Whitelist them once you know your production setup.

### Events to handle

| Event | What to do |
|---|---|
| `charge.success` | Mark the period paid, store the reference, advance the next charge date. This is the one that carries renewals. |
| `invoice.payment_failed` | Mark `past_due`, email the office, start your retry clock. (Path A) |
| `invoice.create` | A renewal invoice was raised — useful for "your card will be charged in 3 days" emails. (Path A) |
| `subscription.disable` | Subscription ended or was cancelled. Set `cancelled`. (Path A) |
| `subscription.expiring_cards` | Sent at the start of each month, listing subscriptions whose cards expire that month. Email those offices to update their card before the charge fails. |

---

## Step 5 — Testing

Use the test keys and Paystack's published test cards — get them from the current docs page rather than copying numbers from a blog, since the set changes. They give you a card that succeeds, one that fails, and one that triggers the OTP/3DS flow. Test all three.

Before going live, walk through this list:

- [ ] Amounts are in kobo everywhere (`650000`, not `6500`)
- [ ] A successful payment updates the office, and the same webhook arriving twice does **not** double-charge
- [ ] A failed card lands the office in `past_due` with the banner showing
- [ ] Trial expiry with no card behaves the way you want
- [ ] `metadata.office_id` is present on every transaction
- [ ] Secret key is not in the frontend bundle
- [ ] Webhook verifies the signature and returns 200 before processing
- [ ] You have a record row for every charge, successful or not — this is your audit trail

---

## Step 6 — Going live

1. Complete business verification if you have not.
2. Swap the environment variables to `sk_live_` / `pk_live_`.
3. Set the live webhook URL — it is configured separately from test.
4. Re-create the plan on live. **Plan codes do not carry over from test to live.** Same for customer and authorization codes: every test token is worthless in live mode.
5. Take one real ₦6,500 payment on your own card and confirm it settles.

---

## Fees, briefly

Paystack charges a percentage per local transaction, capped at a fixed amount for larger ones, and the exact numbers change — check their live pricing page. On ₦6,500 the fee is small but not nothing across a dozen offices. Decide whether you absorb it or price it in; ₦6,500 with the fee absorbed is the friendlier choice, and at this scale the difference is a few thousand naira a month.

---

## What the prototype already shows you

The Subscription page (Office) and Subscriptions page (Super Admin / Platform Admin) are built against exactly this model: trial with a countdown, active with a next-charge date, failed payment with a retry date, payment history with references, and a card-entry modal standing in for the Paystack checkout. The states and the copy are what you will wire up — only the network calls are missing.
