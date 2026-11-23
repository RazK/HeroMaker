# Content strategy: one film, cut everywhere

Owner: Tom (Content). Reviewed by the PM (money, hypotheses) and Maya (look).
Status: **draft for the PM and Maya**, 2026-11-23.

## The idea

**One master film, built from short chapters that each stand alone.** Every
ad, every site loop and every post is a cut of the same chapters, so the
promise, the faces and the look are the same wherever a parent meets us
(`docs/product/OPERATING.md`, "One promise, everywhere").

The spine is the promise, word for word: **You draw it. We paint it. It comes
alive!** Each chapter is one of those beats, or what happens after it.

**Point of view: a parent filming on a phone.** The child is the hero of the
story; the parent is the buyer we talk to. A phone-shot, at-home look reads as
a family's moment, not an advert, and lets us show both: the child's joy and
the parent's "wow".

## The chapters

| # | Chapter | What happens | Money moment | Who feels it |
|---|---|---|---|---|
| 1 | **The drawing** | Maya, 7, draws her hero at the kitchen table, tongue out, crayons everywhere. | (set-up) | the child's pride |
| 2 | **The reveal** | Mom photographs the drawing in the app. A few minutes later the painting appears: Maya gasps. | 1, the reveal | child and parent |
| 3 | **It comes alive** | Violet moves. Maya waves, Violet waves back. She jumps, Violet jumps. Mom walks in and stops. | 2, the reaction | child, then parent |
| 4 | **Play** | Maya plays a game with her own hero (Dance party). | keeps them coming back (H-020) | the child |
| 5 | **Send it** | Maya shows Grandma her hero on a video call; Grandma lights up. | 2 and 4, share and gift | the family |
| 6 | **End card** | The landing's three pictures and Make a hero. | | |

Chapter 5 is the gift and share angle without a December date in it, so it can
run whenever payments are Live. The printable toy (money moment 3) gets its own
chapter only once it is on sale: we never show something a parent cannot buy.

## Cuts

| Where | Length | Chapters | Format |
|---|---|---|---|
| YouTube (pre-roll, channel) | 60 s master | 1–6 | 16:9 |
| YouTube | 30 s | 1, 2, 3, 5, 6 | 16:9 |
| YouTube bumper | 6 s | 3 (the copy) + logo | 16:9 |
| Meta Reels and Stories | 15 s | **3 first** (the hook), then 1, 2, 6 | 9:16 |
| Meta feed | 15 s | the same | 4:5 |
| Meta | 6 s | 3 + end card | 9:16, 4:5 |
| The site | 4–6 s silent loops | each chapter on its own: the landing's three pictures, "how it works" | transparent WebP / MP4 |

**The first second of every Meta cut is the hero copying the child.** That is
the one thing nobody else can show, and it is H-039's bet.

## Hypotheses this content tests

Each is a bet on an existing product hypothesis; the PM owns the numbers.

| Id | We believe | Because it moves | Read it by |
|---|---|---|---|
| C-1 | An ad that **opens on the hero copying the child** gets more clicks than one that opens on the drawing | H-039, H-001 | E-004: the same 15 s, two openings, equal budget |
| C-2 | Showing **the parent's reaction**, not only the child's, makes more parents start a hero | H-001, H-002 | the 15 s with and without chapter 3's Mom shot |
| C-3 | Showing **the real wait honestly** ("a few minutes") in chapter 2 cuts the leavers and the refund requests | H-015, H-016 | leave-the-wait rate for ad visitors, before and after |
| C-4 | The **Grandma chapter** (share and gift) brings more buyers from the gift door than the family cut | H-003, H-022 | the gift door with chapter 5 up front |
| C-5 | **Moving chapters on the landing** start more heroes than still pictures | H-040 | E-005 |

## Rules

- **Nobody real, never a real child.** Maya, Mom and Grandma are AI-generated
  and acted. Nothing in an ad or its caption may suggest they are customers
  (no "real reaction", no "Maya's story").
- **The product is real.** Every painting, hero, game and app screen shown is
  what HeroMaker makes and shows today (Violet Volt, recorded from staging).
- **No ad runs before payments are Live on production** (the PM's rule). We
  make the material now.
- **Maya's gate** (`docs/design/PRINCIPLES.md`) on every keyframe before Raz.

## How it is made

| Piece | How | Limit |
|---|---|---|
| People at home (chapters 1, 2, 3, 5) | a keyframe still (`gpt-image-2`, the same Maya every time), then 5 s of video (Wan 2.2, free quota) | about 2 clips a day free; Hugging Face PRO about 40 a day |
| The app on the phone (chapter 2, 4) | recorded from staging with Playwright, put on the phone's screen | none |
| Violet copying Maya (chapter 3) | `games/hero-moves/tools/mimic` | none |
| The drawing drawing itself | `scripts/content/draw_on.py` | none |
| Titles and end card | `marketing/ad/ad.html`, recorded | none |

About 10 live-action clips: **about 5 days on the free quota, or 1 day with
PRO ($9).** The PM said no PRO for the first ad; with the whole film it is
worth asking again.
