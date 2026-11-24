# Growth plan (v1, 2026-11-24)

Owner: Noa (acquisition). The top of our one funnel: **paid heroes per week**.
This is how we get the first ones and which experiments we run, checked against
`../product/OPERATING.md`, `../product/MONEY_MOMENTS.md` and `PMF.md`.

> ## The one unblock
>
> **Payments must be Live on production, or there are zero paid heroes.** The
> Schneider stand and the first class fill the top of the funnel, but a family
> only becomes a *paid* hero when they can buy — and production sells nothing
> today (`../launch/READINESS.md`). Everything below the pilots waits on this.

Targets we chose, not forecasts (`../product/OPERATING.md`): **10 paid
heroes/week by 31 Dec**; 40/week is break-even.

## 1. One promise, everywhere

"**You draw it. We paint it. It comes alive!**" — the same words and the same
reveal at every step: ad → landing → first screen → share video → share page.
Never "animate your drawing": that is a race to free (`PMF.md`). Our pull is the
reveal, a hero the child plays with, a share the family passes around, and a
thing they keep.

Acquisition owns a one-page **message map** — the exact line and image for each
surface — and checks every surface against it before any spend
(`../product/OPERATING.md`, "Message consistency check"; `templates/GROWTH_CAMPAIGN.md`).

## 2. The funnel and where money enters

first visit (`?via=` door) → `make_started` → `signin_done` → **painting seen
(activation)** → `checkout_started` → **`purchase_done`** → `hero_ready`.

- Money moments we aim at (`../product/MONEY_MOMENTS.md`): the reveal (1), the
  child's reaction / share (2), "I want to keep this" (3), the gift (4 — Hanukkah
  is in December), home from class (5).
- The **family is the buyer**. Classes and events are the **way in**, not the
  payer (`PMF.md`, the Artsonia model: free at the top, the parent buys at home).

## 3. Path to the first paid heroes — two funnels, in order

### A. Schneider happening — Thu 10 Dec (`../product/pilots/P-001-schneider.md`)

Non-commercial: no prices, no pitch, **no photos of children**. The take-home QR
card (`?via=schneider`) is the only acquisition asset. It is a **pilot, not a
sale**: paid heroes come **after**, when families open the link at home and buy —
so payments must be Live by then.

Acquisition owns the **take-home → home-buy bridge**: the QR card message = the
one promise; a simple "open it at home, make another" path; concierge
seat-granting so no family is blocked on money mechanics on the day; and counting
the `schneider` door + purchases for 14 days after (to 24 Dec), into the Sunday
review.

### B. The first school class — recruit the first paying parent

Model: **free to the class, the parent buys the keepsake at home** (not schools
paying much — `PMF.md`). Class seats exist and are robot-tested in test mode.
Acquisition recruits **one** teacher for a Dec/Jan class, writes it up as a pilot
(P-002, skill `pilot-notes`), preps concierge seat-granting, and owns the
take-home → parent-purchase path. Target: the first class that yields at least
one paid hero at home.

## 4. Experiments — pilots before A/B

At our traffic, only two experiments run until we sell 20 heroes/week
(`../product/OPERATING.md`):

- **E-006 "pay after the painting"** (`../product/experiments/E-006-free-painting.md`)
  tests our riskiest question (`PMF.md`): *will parents pay for the digital hero
  once they have seen the reveal?* Recommended as the first conversion
  experiment. Needs Raz's yes to give the painting away, and a flagged build.
- **E-002 "campaign doors"** (`../product/experiments/E-002-campaign-doors.md`)
  learns **which audience pays** — four `?via=` doors on equal budget. No code;
  needs payments Live, PostHog on, providers topped up, and Raz's budget + ad
  copy. Run **after** E-006 has a baseline.
- Everything else stays a draft. **Money-check on this plan:** every item serves
  a money moment and the KPI; nothing here is polish or games for their own sake.

## 5. What Raz must unblock (via the PM, one list)

Most-blocking first. Items 1–3 are on `../launch/READINESS.md` §3; restated only
where acquisition is blocked, so the PM can batch them.

1. **Payments Live on production** (Grow identifiers + ILS price table + one real
   purchase + promote staging). Without it: **0 paid heroes.**
2. **Production analytics on** (PostHog key + privacy text in Raz's words) —
   without it the funnel and every door are dark.
3. **Schneider provider top-up** (Meshy + OpenAI, ~$45–90) by 7 Dec.
4. **`?via=schneider` QR card** approved (Maya, before 6 Dec) and the share link
   + WhatsApp preview working (robot, 9 Dec).
5. Later, not now: **E-002 ad budget + ad copy**, and **Raz's yes on E-006**.
   Brought when payments are Live.

**Not acquisition's:** building the app, design pixels, running or paying for ads
before payments are Live and Raz says yes.

## 6. Next moves that need no unblock

- Draft the **message map** (one promise, every surface).
- Draft **P-002** (first-class pilot) with its three questions.
- Draft the **Schneider take-home → home-buy bridge** + concierge plan.
- Bring all of it to the next PM review.
