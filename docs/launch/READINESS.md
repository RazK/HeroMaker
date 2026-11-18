# Launch readiness: can a stranger pay and get a hero?

Audit of 2026-11-19, before the first paid marketing campaign. Staging was
v2.0.112; production was v2.0.85 (deployed 2026-11-02).

**Verdict: not yet.** The code path is proven on staging in test mode. What is
not proven is production itself: whether its store takes real money, and
whether its providers still answer. Both need Raz (list 3).

Keep this file current. When an item changes, move it between the lists.

## 1. Ready and proven

| What | Proof |
|---|---|
| Buy a pack: checkout → card → webhook → credits | Staging robot, every run. Run [44383776616](https://github.com/RazK/HeroMaker/actions/runs/44383776616): "paid $5.00; balance 0 -> 30". A real Lemon Squeezy test-mode order through the real webhook. |
| Buy class seats at the teacher price | Same robot run, class step. The seats go to the class, never to the teacher's balance. |
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
| **The eleventh hero in five minutes failed as "out of credits".** Meshy's "all task slots in use" was read as an empty account. A new hero now waits up to 10 minutes for a slot. | [#232](https://github.com/RazK/HeroMaker/pull/232) |
| **A half-configured store could show a price.** Without the API key the button answered 503; without the webhook secret the buyer would have paid and got nothing. Now nothing is listed. | [#233](https://github.com/RazK/HeroMaker/pull/233) |

## 3. Needs Raz

Most blocking first. Each line is one action.

1. **Say whether production's store is live.** `LEMONSQUEEZY_TEST_MODE` is set
   on production but its value is hidden from the agent. Open production →
   Admin → Money → the Lemon Squeezy card (it shows a Test or Live pill), or
   the variable in Railway.
   - If it says **test**: production takes no real money. If a test webhook
     also points at production, anyone who knows the public test card (4242…)
     can make heroes at our cost today. Go to 2.
   - If it says **live**: skip to 3.
2. **Switch production to live mode.** Start today: step one is a review by
   Lemon Squeezy that can take days.
   - Activate the store: <https://app.lemonsqueezy.com/dashboard> → Activate
     store. Lemon Squeezy checks the business and the product before it lets a
     store take real money.
   - When it is approved: on each of the products at
     <https://app.lemonsqueezy.com/products> choose "Copy to Live Mode", turn
     the Test mode switch off, and note the three live variant ids.
   - Make a live API key: <https://app.lemonsqueezy.com/settings/api>
   - Add a live webhook: <https://app.lemonsqueezy.com/settings/webhooks>,
     URL `https://heromaker-backend.up.railway.app/api/payments/webhook`,
     events `order_created` and `order_refunded`, and a new signing secret
     (not the test one).
   - In Railway (the project link in `devops/railway/project.json` →
     production → backend → Variables) set `LEMONSQUEEZY_API_KEY`,
     `LEMONSQUEEZY_WEBHOOK_SECRET`, `LEMONSQUEEZY_VARIANT_STARTER`,
     `_MAKER`, `_STUDIO`, and `LEMONSQUEEZY_TEST_MODE=false`.
3. **Approve one real purchase and one real hero on production** (about $5.90:
   the smallest pack, plus about $0.90 of provider cost; the $5 can be
   refunded). No hero has been made on production since the 2 November deploy,
   and staging's robot reuses a cached model, so nothing recent proves that
   production's OpenAI and Meshy keys still work. This is the only real proof.
4. **Promote staging to production.** Production is more than 25 merges
   behind and has none of the fixes in section 2. Needs a green robot and your yes.
5. **Check the Meshy plan and top it up.** Plan and balance:
   <https://www.meshy.ai/settings/subscription>. A hero uses about 35 Meshy
   credits. For a first campaign of 300 heroes buy about 10,500 credits. If
   you expect more than 10 heroes inside five minutes, the plan needs more
   task slots than Pro's 10 (Premium has 30).
6. **Top up OpenAI and turn on auto-recharge**:
   <https://platform.openai.com/settings/organization/billing/overview>.
   About $50 covers 300 paintings. Your image rate limit is at
   <https://platform.openai.com/settings/organization/limits>.
7. **Decide the margin** (section 4). At Meshy's current prices every pack
   earns 30% to 39%, under the 50% floor the code promises. Choose one: accept
   it, raise prices, or try Meshy's cheaper model. The agent changes no price
   without you.
8. **Password reset is off on both environments** (`RESEND_API_KEY` is not
   set). A buyer who signed up with a password and forgets it is locked out of
   paid credits. Make a key at <https://resend.com/api-keys>, verify a sending
   domain at <https://resend.com/domains>, and set `RESEND_API_KEY` and
   `MAIL_FROM` as shared variables. Sign in with Google works today.
9. **Class seats cannot be bought with money on production**
   (`LEMONSQUEEZY_VARIANT_CLASS_SEATS` is not set there). Needed only if the
   campaign targets teachers. Add the live variant id.
10. **Nobody is told when something breaks.** The backend writes
    `PROVIDER_OUT_OF_CREDITS` and `PROVIDER_QUEUE_FULL` to the log and nothing
    reads them. Until alerts exist, look at Admin → Money once a day during the
    campaign. Say "go" and an agent adds an email alert.

Not needed for launch: the toy is not on sale (`ACTION_FIGURE_FOR_SALE` is
off, and production has no Hi3D keys).

## 4. What a hero costs and earns

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
