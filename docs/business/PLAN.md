# Business plan (v1, 2026-11-22)

**The product.** A child draws a character; HeroMaker paints it, makes it a 3D
hero that moves and plays games, and can turn it into a printable toy.
**The business.** Grown-ups pay per hero, in credit packs; teachers pay per seat.

Everything below marked *estimate* is a guess until a real month of bills and
sales replaces it. Nothing here is a forecast: we have no paying strangers yet.

## Who pays, for what

| Buyer | Why they would pay | What they buy | Price today |
|---|---|---|---|
| Parent (family) | the child's drawing, alive | a pack of heroes | $5 / 3 · $15 / 10 · $40 / 30 |
| Gift giver, birthday | a present made from the child's own drawing | a pack; later the toy | same packs |
| Teacher | a class activity, one hero per child | class seats | $1.25 a seat (+$0.50 per class) |
| Fair, museum | a stand activity | seats or a pack | not offered yet |

The toy (printable file) is built but not on sale (`ACTION_FIGURE_FOR_SALE` off).

## What one hero earns

From `docs/launch/READINESS.md` §4 (provider list prices, read 2026-11-19):

| | Per hero |
|---|---|
| Cost (painting $0.17 + Meshy model and rig about $0.70) | about **$0.87** |
| We keep after Lemon Squeezy's fee (5% + $0.50) | $1.16 to $1.42, by pack |
| **Profit** | **$0.29 to $0.55** (25% to 39%) |

No pack loses money. All are under the 50% margin the code aims for: a price
decision for Raz (below).

## What it costs to run each month (*estimates*)

| Item | Range | Source / how we confirm |
|---|---|---|
| Railway (3 services, database, file bucket, staging and production) | $20 to $60 | the Railway usage page, after one full month |
| Meshy plan (task slots; Pro 10, Premium 30) | $20 to $60 | <https://www.meshy.ai/settings/subscription> |
| OpenAI, Hi3D, Tripo | per use, inside the per-hero cost | provider billing pages |
| PostHog, Lemon Squeezy | $0 fixed (free tier; fee per sale only) | their pricing pages |
| **Fixed total** | **about $40 to $120** | |

## Break-even

Fixed costs ÷ profit per hero, at the Maker pack ($0.51 a hero):

- **about 80 to 235 heroes a month**, roughly **160 at the middle** (about 16 Maker packs).
- Ad spend is not in this: each campaign is an experiment, judged on what it
  teaches and on cost per buyer (`MARKETING.md`).

## The three biggest risks

1. **Strangers don't pay.** No one outside the team has bought yet (H-002).
2. **One purchase doesn't repay an ad.** At $0.38 to $0.55 a hero, a family
   must buy again for paid ads to work (H-021).
3. **Providers.** Meshy and OpenAI prices or limits change under us; one
   outage stops every hero. Watch: margin per hero, `hero_failed` rate.

## What we must learn first

The five riskiest hypotheses, in `docs/product/HYPOTHESES.md`:
[H-002](../product/hypotheses/H-002-ad-parents-buy-first-visit.md),
[H-003](../product/hypotheses/H-003-gift-door-outbuys-family.md),
[H-021](../product/hypotheses/H-021-second-hero-30d.md),
[H-015](../product/hypotheses/H-015-leavers-come-back.md),
[H-027](../product/hypotheses/H-027-teacher-pays-per-seat.md).
The first campaign (`MARKETING.md`, experiment E-002) answers H-002 and H-003.

## Open decisions for Raz

1. **Margin:** accept 25% to 39%, raise prices, or try a cheaper 3D model.
2. **Campaign budget** for the first test (`MARKETING.md`).
3. **The toy:** put it on sale (5 credits) or keep it hidden for now.
