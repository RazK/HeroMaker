# Hypotheses

What we believe about who HeroMaker is for, and how we will find out. The
method is in [README.md](README.md). Every threshold below is a target we
chose, not a measurement: nothing here has been tested yet.

## The five riskiest: test these first

1. **[H-002](hypotheses/H-002-ad-parents-buy-first-visit.md) Ad parents buy a first pack** (25).
   The whole campaign rests on a stranger paying $5, and no stranger has yet.
2. **[H-003](hypotheses/H-003-gift-door-outbuys-family.md) Gift and birthday visitors buy more often** (20).
   It decides where the campaign's money goes; one link per audience answers it for free.
3. **[H-021](hypotheses/H-021-second-hero-30d.md) Buyers make a second hero and buy again** (20).
   A hero keeps $0.38 to $0.55, so a paid ad only pays back if a family buys twice. The slowest to read: start the clock first.
4. **[H-015](hypotheses/H-015-leavers-come-back.md) People who leave the wait come back for their hero** (20).
   A hero takes about 8 minutes and nobody is told when it is ready; a paid hero nobody sees is a refund request.
5. **[H-027](hypotheses/H-027-teacher-pays-per-seat.md) Teachers pay for seats at $1.25** (20).
   The class is a whole second buyer and the way into households (H-029), and no teacher has paid yet.

The other 20s wait on these or on a decision: H-001 and H-010 are read from
the same funnel as H-002; H-020 alongside H-021; H-029 needs classes to
exist (H-027); H-032 needs a fair; H-034 and H-036 need the toy on sale or a
fake door, which is Raz's call.

Ten experiments are drafted, E-001 to E-010, each tied to the lever it
moves (CAC, conversion, AOV, LTV, time to value). All run only with Raz's yes,
one at a time, in the order at the top of
[`experiments/README.md`](experiments/README.md): the campaign doors
([E-002](experiments/E-002-campaign-doors.md)) first, then the free painting
([E-006](experiments/E-006-free-painting.md)), then the rest by expected
impact on CAC and LTV.

## All hypotheses, by priority

Priority = impact × uncertainty. Segment = who draws · who pays · door.

| Id | Hypothesis | Segment | Status | Priority | Test |
|---|---|---|---|---|---|
| [H-002](hypotheses/H-002-ad-parents-buy-first-visit.md) | Ad parents buy a first pack | kid 4-9 · parent · ad | untested | 25 | funnel observation by door |
| [H-001](hypotheses/H-001-ad-visitors-start-making.md) | Ad visitors start making a hero | any · parent · ad | untested | 20 | funnel observation by door |
| [H-003](hypotheses/H-003-gift-door-outbuys-family.md) | Gift and birthday visitors buy more often | any · grown-up giver · gift/birthday | untested | 20 | funnel observation by door (separate ad sets, equal budget) |
| [H-010](hypotheses/H-010-buy-sheet-to-checkout.md) | The Buy sheet sends parents to checkout | any · parent · any | untested | 20 | funnel observation; interview 5 parents who stopped here |
| [H-015](hypotheses/H-015-leavers-come-back.md) | People who leave the wait come back for their hero | any · parent · any | untested | 20 | funnel observation |
| [H-020](hypotheses/H-020-come-back-to-play.md) | Kids come back to play within a week | kid 4-12 · parent · family | untested | 20 | funnel observation (retention by cohort) |
| [H-021](hypotheses/H-021-second-hero-30d.md) | Buyers make a second hero and buy again | any · parent · family | untested | 20 | funnel observation (cohort) |
| [H-027](hypotheses/H-027-teacher-pays-per-seat.md) | Teachers pay for seats at $1.25 | kid 5-10 (the class) · teacher · class | untested | 20 | funnel observation by door, plus 5 teacher interviews |
| [H-029](hypotheses/H-029-class-heroes-reach-parents.md) | Class heroes bring parents in | kid 5-10 · parent · class | untested | 20 | funnel observation by door |
| [H-032](hypotheses/H-032-fair-visitors-buy-at-home.md) | Fair visitors buy at home later | kid 4-12 · parent · fair/museum | untested | 20 | funnel observation by door |
| [H-034](hypotheses/H-034-parents-add-the-toy.md) | Parents add the printable toy | any · parent · family | untested | 20 | funnel observation once on sale; before that a fake door |
| [H-036](hypotheses/H-036-toy-shipped-wanted.md) | Parents want the toy shipped | any · parent · family | untested | 20 | fake door |
| [H-041](hypotheses/H-041-free-painting-sells-the-hero.md) | A free painting sells the 3D hero | any · parent · ad | untested | 20 | A/B experiment (E-006) |
| [H-008](hypotheses/H-008-grownup-check-keeps-kids.md) | The grown-up check does not lose the kid | kid 7-12 alone · parent · any | untested | 16 | funnel observation |
| [H-013](hypotheses/H-013-single-hero-first-offer.md) | A one-hero offer converts first-timers | any · parent · ad | untested | 16 | A/B experiment (price test) |
| [H-014](hypotheses/H-014-starter-holds-at-7.md) | Starter still sells at $7 | any · parent · any | untested | 16 | price test (one price per week, not side by side), after 5 price interviews |
| [H-023](hypotheses/H-023-shared-link-converts.md) | A shared hero brings a new maker | any · parent · family | untested | 16 | funnel observation by door |
| [H-044](hypotheses/H-044-half-price-second-hero.md) | A half-price second hero brings a second purchase | any · parent · any | untested | 16 | A/B experiment, or one offer per period (E-009) |
| [H-004](hypotheses/H-004-kid-4-6-taps-moves.md) | Kids 4-6 keep tapping moves | kid 4-6 · parent · family | untested | 15 | funnel observation, plus 5 observed sessions |
| [H-026](hypotheses/H-026-party-host-pays.md) | A birthday host pays for every kid at the party | kid 5-10 (the guests) · party host · gift/birthday | untested | 15 | interview, then funnel observation by door |
| [H-033](hypotheses/H-033-venue-pays-flat-fee.md) | A venue pays a flat fee for a stand | kid 4-12 · venue · fair/museum | untested | 15 | interview |
| [H-007](hypotheses/H-007-childlike-drawings-pull.md) | Heroes from young kids' drawings draw people in | kid 4-6 (the hero's), visitor · parent · any | untested | 12 | A/B experiment (rides on E-001) |
| [H-009](hypotheses/H-009-signin-completes.md) | Parents finish signing in | any · parent · any | untested | 12 | funnel observation |
| [H-011](hypotheses/H-011-checkout-completes.md) | Checkout completes | any · parent · any | untested | 12 | funnel observation |
| [H-017](hypotheses/H-017-kid-7-9-plays-first-visit.md) | Kids 7-9 play a game with their new hero | kid 7-9 · parent · family | untested | 12 | funnel observation |
| [H-018](hypotheses/H-018-rounds-last-and-repeat.md) | Game rounds last and get replayed | kid 7-12 · parent · any | untested | 12 | funnel observation |
| [H-024](hypotheses/H-024-gift-is-a-real-reason.md) | A gift is a common reason to make a hero | any · grown-up giver · any | untested | 12 | funnel observation |
| [H-025](hypotheses/H-025-gift-voucher-wanted.md) | Givers want to give a hero, not make one | any · grown-up giver · gift/birthday | untested | 12 | fake door |
| [H-028](hypotheses/H-028-class-finishes-in-lesson.md) | Every kid in a class gets a hero in the lesson | kid 7-9 (the class) · teacher · class | untested | 12 | observed session in a class |
| [H-030](hypotheses/H-030-teacher-runs-again.md) | Teachers run a second class | kid 5-10 (the class) · teacher · class | untested | 12 | funnel observation |
| [H-035](hypotheses/H-035-toy-printed-at-home.md) | Toy buyers print at home | kid 10-12, grown-up · parent · any | untested | 12 | funnel observation |
| [H-038](hypotheses/H-038-grownup-drawers-buy.md) | Grown-ups draw heroes too | grown-up · grown-up · ad | untested | 12 | funnel observation |
| [H-039](hypotheses/H-039-copy-me-ad-gets-clicks.md) | A hero copying a real person outclicks a dancing hero | any · parent · ad | untested | 12 | A/B experiment of two ad creatives (E-004) |
| [H-043](hypotheses/H-043-ready-email-brings-leavers-back.md) | A ready email brings leavers back | any · parent · any | untested | 12 | A/B experiment (E-008) |
| [H-045](hypotheses/H-045-share-credits-bring-makers.md) | Credits for both sides make a share bring new makers | any · parent · family | untested | 12 | A/B experiment, or one offer per period (E-010) |
| [H-005](hypotheses/H-005-kids-show-delight.md) | Kids light up when their hero moves | kid 4-9 · parent · family | untested | 10 | observed session (at home, a class, a stand) |
| [H-006](hypotheses/H-006-gallery-shuffle-no-worse.md) | A shuffled gallery opens as well as today's order | any · nobody yet · any | untested | 9 | A/B experiment |
| [H-012](hypotheses/H-012-first-pack-is-starter.md) | First-time buyers pick the smallest pack | any · parent · family | untested | 9 | funnel observation |
| [H-016](hypotheses/H-016-kids-wait-through.md) | Kids wait the 8 minutes | kid 4-9 · parent · family | untested | 9 | funnel observation, plus observed sessions |
| [H-022](hypotheses/H-022-heroes-get-shared.md) | Families share their hero | any · parent · family | untested | 9 | funnel observation |
| [H-031](hypotheses/H-031-fair-stand-throughput.md) | A staffed stand makes 20 heroes an hour | kid 4-12 · venue · fair/museum | untested | 9 | observed session |
| [H-040](hypotheses/H-040-landing-first-starts-heroes.md) | The landing's promise starts more heroes than the gallery alone | any · parent · any | untested | 9 | A/B experiment (E-005) |
| [H-019](hypotheses/H-019-kid-10-12-picks-dance.md) | Older kids choose Dance party | kid 10-12 · parent · family | untested | 8 | funnel observation |
| [H-037](hypotheses/H-037-older-kids-take-apart.md) | Older kids pull the toy apart | kid 10-12, 13+ · parent · family | untested | 6 | funnel observation |
| [H-042](hypotheses/H-042-badge-moves-buyers-up.md) | A Best value badge on the $40 pack raises the average order | any · parent · any | untested | 6 | A/B experiment (E-007) |

## What we cannot measure yet

Every measurement the hypotheses need that the app does not collect today,
with the smallest change that would. **Marked ⚑: it touches children's data,
or what we collect at all, so Raz decides.** Nothing here is built without
his yes.

| | Missing | Needed by | Smallest change | ⚑ |
|---|---|---|---|---|
| G-1 | **Production collects nothing.** `ANALYTICS_ENABLED` is off there and the privacy page says "No analytics". | every hypothesis, E-001 to E-003 | Raz writes the privacy page's words; then `ANALYTICS_ENABLED=true` and the production PostHog key, with "Discard client IP data" on (`docs/analytics/REQUIREMENTS.md`). | ⚑ |
| G-2 | **The drawer's age band.** "Who drew it?" is only kid or grown-up. | H-004, H-017, H-019, H-037; the age segment of every other | The same question with bands: A kid 4-6 · 7-9 · 10-12 · 13+ · A grown-up. `survey_answered.who` gains four values. No new screen, no birth date, no name. It becomes a PostHog person property of an anonymous visitor. | ⚑ |
| G-3 | **Who and why before payment.** The two questions are asked after the first hero is paid for, so everyone who leaves earlier has no drawer or purpose. | the segment of H-001, H-002, H-008 to H-011 | None recommended: asking earlier puts a question in front of a child before the magic. Read the early funnel by door and device. If Raz wants it earlier, it is a design question first. | ⚑ |
| G-4 | **A class's age band in its events.** The teacher already picks one (`classes.ages`: 3-4, 5-6, 7-8, 9-10, 11+) but `class_created` and `class_joined` carry nothing. | H-027 to H-030 | Add `ages` (that enum) to both events. It describes a group, set by an adult, not a child. The class bands and G-2's bands should become one set; which one is Raz's call. | ⚑ |
| G-5 | **What kind of group a class is** (school, club, party, event). | H-026 | One choice on New class, sent as `class_created.kind`. The adult's own answer. Needs a design approved by Raz. | |
| G-6 | **Visits from a shared hero.** A shared link arrives as "direct". | H-023 | The shared link carries `?via=share` (one line where the share builds its URL, `heroLink` in `HeroScreen.tsx`'s share). The door machinery does the rest. **Built 2026-11-23.** | |
| G-7 | **A parent keeping a class hero** ("Show your parents"). | H-029 | A backend event `hero_claimed`, no properties, when the claim completes. No new data, but it ties a class child's hero to a parent's account in our own events table (the claim already does so in the database). | ⚑ |
| G-8 | **The two fake doors.** | H-025 (`gift_tapped`), H-036 (`toy_ship_tapped`) | A button and an event each, answering "Not yet. Thanks for telling us." and collecting nothing. Each needs a design approved by Raz. | |
| G-9 | **Experiment plumbing.** `variants` is always empty, PostHog flags are off on purpose, and `variants` never reaches PostHog. | E-001, E-003, every A/B | Assign the arm locally from a hash of the anonymous visitor id; register `variants` with PostHog as well. One small PR with the first approved experiment. | |
| G-10 | **Which hero a game was played with.** `game_ended` has game, seconds and score, no hero. | H-018 | Add `hero_id` to `game_ended` (`games/hero-moves/src/core/track.ts` and the allow-list); the game already knows the hero. | |
| G-11 | **The toy cannot be bought.** `ACTION_FIGURE_FOR_SALE` is off and production has no Hi3D keys, so `make_choice` only ever says moving. | H-034, H-035, H-037 | Not a measurement change: Raz decides when the toy goes on sale. Until then H-034 can only be a fake door. | |
| G-12 | **Ad spend per door.** | E-002, cost per visit | None in the app: copied by hand from the ad dashboards into E-002. | |
| G-13 | **What a child does in front of the screen.** | H-005, H-028, H-031 | None in the app: observed sessions, written into the experiment file with no name, photo or drawing. | |
| G-14 | **Whether a ready email was sent.** | E-008, H-043 | A backend event `ready_email_sent`, no properties, when the email goes. The email's link carries `?via=ready-email`, so a return through it is its own door. Emailing the account for a new purpose is Raz's call. | ⚑ |
| G-15 | **A painting finished on its own.** `hero_ready` fires only for a whole hero. | E-006 (the cost of free paintings) | A backend event `painting_ready` (`provider`), like `hero_ready`. Until then, read from our own table: `openai_render` done, no `meshy_3d` started. | |
| G-16 | **An offer was shown.** | E-009, H-044 | A browser event `offer_shown`, no properties, when the half-price offer is on screen. | |
| G-17 | **A referral was credited.** | E-010, H-045 | A backend event `referral_credited` (`side`: sharer or friend). It ties two accounts in our own table; PostHog still identifies no one. Needs G-6 first. | ⚑ |
| G-18 | **Which button started a hero** (the landing's or the bar's). Optional. | E-005 | `make_started.from`: `landing` or `bar`, one enum on an existing event. | |

Per-account questions (H-021, H-027, H-030) are read from our own table's
CSV, which knows the account after sign-in. PostHog never identifies anyone,
so there a parent on a second device is a new visitor. No change proposed.
