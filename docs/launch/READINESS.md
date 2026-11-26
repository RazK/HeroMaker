# Launch readiness: can a stranger pay and get a hero?

Audit of 2026-11-19, before the first paid marketing campaign. Production was
v2.0.85 (deployed 2026-11-02); the fixes below reached staging as v2.0.115.

**Status 2026-11-25 (night):** staging v2.0.248 · 1968462 is green on the
staging robot, money steps included ([run 140](https://github.com/RazK/HeroMaker/actions/runs/45398449540)):
free painting → the pay pop-up → TEST checkout → back to the same hero, which
goes on to 3D by itself → receipt; every pack, a Fail, and class seats.
Production is still v2.0.85 and lists no packs. The moment gates 1 and 2 close,
the remaining work is gate 3 (about a day) and Raz's yeses for gates 5–7.

**Failed payment (2026-11-25, #373):** back from a checkout that did not go
through, the site says "Payment didn't go through" with Try again (home) or
one line above Continue to payment (the hero's pop-up); never "Adding your
credits". Verified on staging v2.0.251 · 6823ce8 by the robot: Fail granted
nothing, the notice showed, Try again reopened the packs; Pay, family, class
seats and the pop-up path all still green.

**Verdict (2026-11-24): not live, and the code is not what blocks it.** The
whole purchase path runs on staging in shekels through our own test mode, and
the robot proves it on every deploy. What stands between us and real money is
Grow: Raz's merchant account is not finished, so Grow has issued no API
identifiers, and without them the real `grow` provider cannot be written
against anything or tested.

## 0. The path to live, gate by gate

| # | Gate | State | Owner |
|---|---|---|---|
| 1 | Grow merchant account active (registration, identity, payout bank, plan: ₪70/month or ₪720/year, 0.75% a transaction) | **Open.** Grow wrote on 23 Nov that registration is unfinished. | **Raz** |
| 2 | Grow API identifiers (`userId`, `pageCode`, API key) for sandbox and production, and how a `notifyUrl` call is authenticated | **Open.** Issued only after gate 1. Their public docs do not say how a callback is verified (read 2026-11-24). | Raz asks Grow (Liav) |
| 3 | Real `grow` provider: create the payment page, receive the server update, verify it, `ApproveTransaction`, credit | **Built (2026-11-25), proven against a Grow stand-in; Grow's own sandbox waits on gate 2.** `PAYMENTS_PROVIDER=grow` (`backend/app/services/grow.py`). The notify is verified by a per-order secret notifyUrl token plus the processId/processToken Grow returned to our server; the stored order decides what is granted. Staging runs it against `grow_standin` until Grow's sandbox userId/pageCode arrive, then only `GROW_*` variables change. Proof: `backend/tests/test_grow.py`. | Gidi |
| 4 | Receipts with a real number | Ours: `/api/v1/receipts` lists every purchase (₪, credits, date). The legal receipt (קבלה) for an exempt dealer is issued by Grow or by Morning connected to Grow. Store Grow's `asmachta`/transaction id as our order number when gate 3 lands. | Raz decides Grow-only or Morning; Gidi stores the number |
| 5 | Production runs today's code | **Open.** Production is v2.0.85 (2 Nov), far behind staging. Needs a green robot on the staging SHA and Raz's yes. | Raz's yes, Gidi promotes |
| 6 | Production variables: `PAYMENTS_PROVIDER=grow`, `GROW_*` keys | **Open**, after gates 2, 3, 5. Set with `skipDeploys`, then redeploy the running deployment by id (see the trap below). `grow_sandbox` refuses to arm on production. | Raz's yes |
| 7 | One real ₪10 purchase and one real hero on production, then refund | **Open**, after gate 6. The only proof that production's Grow, OpenAI and Meshy keys work. | Raz's card and yes |
| 8 | Provider balances (Meshy, OpenAI) and an alert when one runs dry | Open. Admin → Money shows balances; no alert yet. | Raz tops up; Gidi builds the alert on "go" |

**Not a gate any more:** Lemon Squeezy (never approved, dropped 22 Nov) and its
`LEMONSQUEEZY_TEST_MODE` question. Its production variables are emptied, so
production lists no packs and its webhook answers 401.

**The go-live pass itself, step by step, with its rehearsal: [GO_LIVE.md](GO_LIVE.md).**

**Real-Grow checklist: nothing takes real money until every line is green,
plus Raz's credentials and his yes** (from the #375 review, 2026-11-25; owner Gidi):

| # | Blocker | State |
|---|---|---|
| G1 | **How Grow calls `notifyUrl`.** If Grow dropped a query string, every real payment would 401 and the buyer would pay for nothing. | **Fixed in code:** the token is a path segment (`/api/payments/grow/notify/<order>/<token>`), no query. **Still to confirm with Grow:** that it POSTs to the URL exactly as given, and with which content type. |
| G2 | **A multipart notify, end to end.** Grow posts form data the way `createPaymentProcess` is sent; the stand-in sends urlencoded. | **Green:** the Grow stand-in now posts its notify as multipart, so the pay test and the staging robot run that path end to end; plus `test_a_multipart_notify_credits` (credits once, resend credits nothing more). Re-prove against Grow's sandbox once it issues our IDs. |
| G3 | One payment through **Grow's own sandbox** (not the stand-in): page, test card, notify, credits, `approveTransaction` answered 1. | Open: waits on gate 2's IDs. |
| G4 | Production variables and the one real ₪10 purchase + refund. | Open: gates 6 and 7. |
| G5 | Remove the first notify shape (`/grow/notify/<order>?t=`), kept only for staging orders opened before 2026-11-25. | Open: cleanup before production. |

**What Grow's docs say (read 2026-11-24, developers.grow.business):**
`CreatePaymentLink` is `POST /api/light/server/1.1/CreatePaymentLink`,
multipart form, server-side only, with `notifyUrl`, `successUrl`, products,
payment types (card, Bit, Apple Pay, Google Pay) and `cField1..9`.
Production base: `https://secure.meshulam.co.il/api/light/server/1.0`.
`ApproveTransaction` "must be executed after each successful payment"; if it
is not, Grow resends the server update (5 more times, per Grow's own Make
guide). "The transaction will still be processed even if the ApproveTransaction
request is not executed or fails." Not documented: callback signature, secret
or IP list; a transaction lookup; refunds. Until Grow answers, the callback
must be confirmed some other way before credits are granted.

**The sister's class this week does not wait for any of this:** a Grow hosted
payment link (₪10 a child) once gate 1 is done, and Gidi grants the seats by
hand on production after Raz sees the paid receipt (Admin → user → Credits,
then the teacher adds seats). No code.

## What runs today (staging)

**`PAYMENTS_PROVIDER=grow_sandbox`** (2026-11-23), staging only. One hero ₪10,
a family of five ₪39, class seats ₪10 a child from 10. A checkout stores our
order and opens a page marked "TEST — no real money"; Pay makes the backend
sign a Grow-shaped callback and run it through the real handler
(`/api/payments/grow/callback`), which grants from the stored order, never
from the callback's fields. A wrong sum, a duplicate transaction, a forged or
unsigned callback grant nothing. It refuses to arm on production and without
`GROW_SANDBOX_SECRET`. Proof: `backend/tests/test_payments_sandbox.py` and the
staging robot's buy and class steps.

**`FREE_PAINTING=on`** (2026-11-23), staging only: a new account's first
painting is free, the hero pauses at 3D with `not_enough_credits`, the buyer
pays ₪10 and "Try again" finishes it. Proof:
`backend/tests/test_pay_after_reveal.py` and a hand run on staging the same day.

**The Railway trap:** changing a variable redeploys the service from the
latest commit of its branch, not the image already running. On 22 Nov that
put `main` on the production backend for ten minutes. Change production
variables with `skipDeploys`, then redeploy the running deployment by id.

## 1. Ready and proven

| What | Proof |
|---|---|
| Buy a pack: checkout → card → webhook → credits | Staging robot, every run: a real Lemon Squeezy test-mode order through the real webhook. Green on the build with the fixes below: run [44422584044](https://github.com/RazK/HeroMaker/actions/runs/44422584044). |
| Buy class seats at the teacher price | Same run, class step: "5 seats at $6.75 … paid on Lemon Squeezy, seats in 0.8s after returning … balance unchanged". The seats go to the class, never to the teacher's balance. |
| A forged, unsigned or replayed webhook grants nothing | `backend/tests/test_payments.py`, `test_class_seat_purchase.py`; checked against real HTTP on 2026-09-22. Unsigned POST to both backends answers 401 (checked 2026-11-19). |
| A step that fails or times out gives its credits back | `backend/tests/test_step_refunds.py`, `test_restart_refund.py`, on the real `pipeline.execute_step`. |
| The buyer comes back before the webhook lands | The app says "Thanks! Adding your credits…" and re-reads the balance for 30 s; the browser never reports a payment (`App.tsx`). |
| The buyer closes the tab during the wait | The hero is made on the server. It is under My heroes when they come back. |
| A deploy in the middle of a hero | The cut-off step is refunded at startup and can be tried again (`startup_reconcile`). |
| Card declined | Handled on Lemon Squeezy's page; no order, no webhook, no credits. |
| Refund page, terms, privacy | Linked from the Buy credits sheet. |
| Give or take credits by hand; coupons | Admin → a user → Credits; Admin → Coupons. |
| A missed webhook shows | Admin → Money → Lemon Squeezy card compares their orders with our rows. |
| No pack is sold at a loss | Table in section 4. |

## 2. Fixed in this pass

| Fix | PR |
|---|---|
| **$5 could buy 300 credits.** The webhook trusted the pack named in the checkout link. It now credits the pack whose variant was actually sold, and a live deployment ignores test-card orders. | [#230](https://github.com/RazK/HeroMaker/pull/230) |
| **The eleventh hero in five minutes failed as "out of credits".** Meshy's "all task slots in use" was read as an empty account. A new hero now waits up to 10 minutes for a slot. | [#232](https://github.com/RazK/HeroMaker/pull/232), [#236](https://github.com/RazK/HeroMaker/pull/236) |
| **A half-configured store could show a price.** Without the API key the button answered 503; without the webhook secret the buyer would have paid and got nothing. Now nothing is listed. | [#233](https://github.com/RazK/HeroMaker/pull/233) |

## 3. Needs Raz

Gates 1, 2, 5, 6, 7 and 8 in section 0, in that order. Also, not blocking:
password reset is off on both environments until `RESEND_API_KEY` and
`MAIL_FROM` are set (sign in with Google works).

Not needed for launch: the toy is not on sale (`ACTION_FIGURE_FOR_SALE` is
off, and production has no Hi3D keys).

## 4. What a hero costs and earns

**In shekels with Grow (the prices since 2026-11-23):** a hero costs us about
$0.87, about ₪2.75. At ₪10 a hero and Grow's 0.75%, we keep about ₪7.2 a hero
(72%), before Grow's ₪70 a month. The dollar tables below are the Lemon
Squeezy era and are kept for the cost lines.

A hero is 10 credits. Costs per hero, at the providers' current list prices:

| | In our price table | Today's price page |
|---|---|---|
| Painting (OpenAI image) | $0.167 | $0.167 (the retired model's price; the new one is billed per token and is probably lower) |
| 3D model with texture (Meshy) | 20 credits, $0.40 | 30 credits, $0.60 |
| Rig (Meshy) | 0 credits, $0.00 | 5 credits, $0.10 |
| Naming and photo check (OpenAI) | under $0.01 | under $0.01 |
| **One hero** | **$0.57** | **about $0.87** |

Meshy's figures are from <https://docs.meshy.ai/en/api/pricing>, read
2026-11-19, at the $0.02 a credit our table assumes. Confirm both against the
Meshy usage page before trusting either column.

| Pack | Price | Lemon Squeezy fee | We keep | Per hero we keep | Cost per hero | Profit per hero | Margin |
|---|---|---|---|---|---|---|---|
| Starter (3 heroes) | $5.00 | $0.75 | $4.25 | $1.42 | $0.87 | **$0.55** | 39% |
| Maker (10 heroes) | $15.00 | $1.25 | $13.75 | $1.38 | $0.87 | **$0.51** | 37% |
| Studio (30 heroes) | $40.00 | $2.50 | $37.50 | $1.25 | $0.87 | **$0.38** | 30% |
| Class, 30 seats | $38.00 | $2.40 | $35.60 | $1.19 | $0.87 | **$0.32** | 27% |
| Class, 1 seat | $1.75 | $0.59 | $1.16 | $1.16 | $0.87 | **$0.29** | 25% |

No pack loses money. The fee is 5% + $0.50; an international card or PayPal
adds 1.5%, which is not in the table. A step a provider fails is not billed to
us (assumed, not checked against an invoice), and the buyer's credits for it
come back.

The toy, when it goes on sale: 5 credits, $0.40 of Hi3D split, $0.23 to $0.31
profit. A moving hero plus a toy: 15 credits, about $1.27 of cost, $0.61 to
$0.86 profit.

## 5. What a busy hour does

- **Meshy task slots are the limit.** A plan runs a fixed number of tasks at
  once (Pro 10, Premium 30, Studio 60, Ultra 100). A hero holds one slot for
  about six minutes. Pro therefore makes about 100 heroes an hour if they
  arrive evenly.
- **50 buyers in an hour, evenly:** about 5 slots in use. Nothing waits.
- **50 buyers in ten minutes on Pro:** 10 start, the rest wait their turn.
  About 20 to 30 finish; the others have waited 10 minutes, read "Our sculptor
  is busy. Credits returned. Try again in a minute.", and can. Before #232 hero 11
  onward failed at once.
- **The backend is one process.** Each hero in a paid step holds one worker
  thread out of at most 32. Beyond about 25 heroes at once, steps queue
  silently. Not a launch blocker; the first thing to raise if the campaign
  works.
- **A promote during the campaign** cuts off the heroes in flight. They are
  refunded and can be tried again. Promote at a quiet hour.
- **Out of credit at a provider:** every hero fails at that step and reads
  "Our painter (or sculptor) is down on our side. Credits returned. We're
  fixing it." One
  `PROVIDER_OUT_OF_CREDITS` log line is written. Nobody is paged (item 10).

## 6. What the agent could not determine

- Production's `LEMONSQUEEZY_TEST_MODE` value, store id and variant ids: the
  variables are set, their values are hidden, and the only other way to read
  them is to sign in on production.
- Whether a webhook is registered at Lemon Squeezy for the production backend.
  The route exists and rejects unsigned posts; who is configured to call it is
  only visible in the Lemon Squeezy dashboard.
- Provider balances and plans. They are on Admin → Money, which needs an admin
  sign-in.
- The real price of a Meshy credit and of a painting on the new OpenAI model.
