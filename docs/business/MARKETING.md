# Marketing plan: the first campaign (v1, 2026-11-22)

**Goal: learn, not scale.** Find which audience ("door") starts heroes and
pays. Spend small and equal on each door, read the funnel after 7 days, then
decide. This is experiment
[E-002](../product/experiments/E-002-campaign-doors.md).

## Before any money is spent

All must be true (owners in brackets):

- [ ] Payments **Live** on production, not Test (Joe)
- [ ] Staging **promoted** to production, robot green, Raz's yes (PM)
- [ ] **PostHog on** in production, with the new privacy text approved (PM)
- [ ] **Providers topped up:** Meshy and OpenAI (`docs/launch/READINESS.md` §3)
- [ ] **One real purchase** and one real hero made on production (Joe)
- [ ] Landing page built (Iris)

## The four doors

| Door | `?via=` tag | Start on | Why this channel | The ad says |
|---|---|---|---|---|
| Family | `ad-family` | Instagram / Facebook | parents of 4–12s, visual, short video works | Your child drew a hero. / Watch it come alive. |
| Gift, birthday | `ad-gift`, `ad-birthday` | Instagram / Facebook, gift interests | people already looking for a present | A gift made from their own drawing. |
| Teacher | `ad-teacher` | Facebook teacher groups, a short post | teachers trust peers more than ads | One hero for every child in your class. / No accounts. |
| Fair, museum | `via=fair-<place>` QR code | in person, a stand | not an ad: one live event to watch real use | (a printed QR card) |

Every link carries its tag, so each door is its own segment in PostHog with
no question asked (`docs/analytics/REQUIREMENTS.md`).

## Creative we already have

| Asset | Where | Note |
|---|---|---|
| Violet: drawing → painting → dancing 3D | the landing page design | the main ad |
| Raz waving, Violet copies him | `docs/assets/kalidoface_demo.gif` | strongest proof it moves with you; **needs Raz's OK, his face shows** |
| Violet as a toy, taken apart | the toy view | for the gift ad, once the toy is on sale |
| Violet in Robot Rumble | short clip, made 2026-11-22 | for a "play" ad |

## Budget

| Door | Share |
|---|---|
| Family | 25% |
| Gift / birthday | 25% |
| Teacher | 25% |
| Reserve (boost the winner, or the fair) | 25% |
| **Total** | **[YOUR BUDGET]** |

Equal shares, so the doors are compared on the same money.

## After 7 days: what we read

In PostHog, by door: first visits → `make_started` → `signin_done` →
`checkout_started` → `purchase_done`; plus cost per first visit from the ad
dashboards.

| If a door shows… | We… |
|---|---|
| buyers at a cost per buyer under about $15 | **double down:** move the reserve there |
| many heroes started, few buyers | **change the message or offer** (E-003, the one-hero offer) |
| few heroes started | **change the ad**, once; then stop that door |
| `hero_failed` above 5% anywhere | **pause everything** and fix it first |

The $15 line is a starting guess: about what one Maker pack keeps after fees.
We replace it with real numbers after the first week.
