# Analytics: requirements (v1, start simple)

## Why

We have no users yet. We are about to put HeroMaker in front of small groups
(a class, a birthday, a fair or museum stand, families at home) to find out
**who it catches**. Analytics answers three questions for each group:

1. **Who came, and through which door?** (class, gift, event, private; kid or adult)
2. **How far did they get?** (the funnel: where they stop, where they opt in, where they pay)
3. **What did they love?** (play, share, come back)

With tens of people, not thousands, a single visitor's story matters as much
as a percentage. So v1 is two things: a funnel per group, and each visitor's
timeline.

## Principles

- **Simple and ours.** Events go to our own backend and database. No third-party
  trackers, ad pixels, fingerprinting or session recording.
- **Kids use this.** No personal data in events: no names, emails, photos,
  drawings or free text. An anonymous ID per browser; the account id only once
  someone signs in. Children's privacy law (COPPA, GDPR-K) holds from day one.
- **Staging and production stay separate**, like their databases. The staging
  robot's visits are marked and left out of every graph.
- **Never slows or breaks the app.** Events are batched, sent in the background,
  and dropped silently if the call fails.

## Where a visitor came from (the door)

Every link and QR code we hand out carries a source tag, so each group is its
own segment without asking anyone anything:

| Door | Link example |
|---|---|
| A class | the class link or code (already exists) |
| A fair or museum stand | `heromaker.app/?via=fair-telaviv-nov` (a QR on the stand) |
| A birthday or gift | `?via=gift-<name-of-campaign>` |
| A post, a flyer, a friend | `?via=<anything>` |
| None | "direct" |

The first `via` a browser arrives with is kept as its door for later visits too.

One optional question, asked once when someone makes their first hero, two
taps, skippable:

- **What's it for?** Just for fun · A gift · A class · An event
- **Who's drawing?** A kid · A grown-up

## Events (about 20, no more in v1)

| Area | Event | Properties |
|---|---|---|
| Visit | `visit` | door, device (phone/desktop), new or returning |
| Gallery | `hero_opened` | from (gallery/class/share link) |
| Make | `make_started` | |
| | `photo_taken` / `photo_chosen` | |
| | `make_choice` | moving hero / toy / both |
| | `survey_answered` | what it's for, who's drawing (or skipped) |
| Account | `signin_shown`, `signin_done` | method |
| Pay | `credits_shown`, `checkout_started` | pack |
| | `purchase_done` | pack, amount (sent by the backend from the webhook, never the browser) |
| Hero | `hero_ready` | provider, minutes taken |
| | `hero_failed` | step, provider |
| | `wait_left` | the visitor closed the page while the hero was being made |
| Play | `move_tapped` | which move |
| | `game_started`, `game_ended` | game, seconds, score |
| Share | `share_tapped` | |
| Class | `class_created`, `class_joined` | |

## The funnel

Visit → open a hero → start making → photo → sign in → buy → hero ready → play → share or return

For each step: how many reached it, and how many left there. Every graph can be
filtered by **door**, **what it's for**, **who's drawing**, **phone or desktop**,
**3D provider**, and **date range**.

## The admin page (v1)

One page in the existing admin console:

1. **Funnel**: the bars above, one filter row.
2. **Doors**: a table with one row per door, showing visitors, heroes made,
   buyers and players, so you can see at a glance who it catches.
3. **Visitors**: the most recent 100 anonymous visitors, each as a one-line
   timeline (`fair-telaviv · phone · visit → hero → make → photo → left while waiting (6 min)`).
   This is the research view for small groups.
4. **Export**: CSV of the raw events, for anything the page doesn't show.

## Out of scope for v1

Session replay, heatmaps, A/B testing, a third-party analytics tool,
email or push follow-up, and real-time dashboards.

## Done when

- Each event above is recorded on staging, checked by the staging robot's run
  (its own visits marked as robot).
- A visit through `?via=test-fair` shows up as its own door, with its funnel and
  timelines, on the admin page.
- No event payload contains personal data (a test checks the event schema).
- It is promoted to production with Raz's yes, like everything else.
