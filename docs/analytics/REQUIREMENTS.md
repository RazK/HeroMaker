# Analytics: requirements (v2)

## Why

We have no users yet. We are about to put HeroMaker in front of small groups
(a class, a birthday, a fair or museum stand, families at home), and then in
front of a paid campaign, to find out **who it catches**. Analytics answers
three questions for each group:

1. **Who came, and through which door?** (class, gift, event, private; kid or adult)
2. **How far did they get?** (the funnel: where they stop, where they opt in, where they pay)
3. **What did they love?** (which heroes, which slides, play, the toy, share, come back)

## What changed in v2

- **The graphs are PostHog's** (EU cloud), not a home-made admin page. Raz:
  high-resolution data, and "don't reinvent the wheel". Funnels, paths, time
  per screen, scroll depth and heatmaps come with it.
- **Our own events table stays.** It is the record we hold ourselves, with a
  closed allow-list, and it is what the backend's own events (a purchase, a
  finished hero) are written to first. An admin can download it as CSV.
- **Every view of every hero is recorded**, to rank heroes and to test gallery
  orders later: which heroes were on screen in the gallery, which was opened
  from which place, which of its slides were seen.
- **No session recording. At all.** Raz: "we don't record their screen."
  There is no switch for it. See "PostHog" below for how that is enforced.
- **The funnel ends at "played a game" or "3D-printed a character".** Nothing
  is measured inside the games.

## Principles

- **Ours first.** Events go to our own backend and database. PostHog gets a
  copy of the same events and is the only third party. No ad pixels, no
  fingerprinting, no session recording.
- **Kids use this.** No personal data in events: no names, emails, photos,
  drawings or free text. An anonymous ID per browser; the account id only once
  someone signs in, and only in our own table. Nobody is ever identified to
  PostHog. Children's privacy law (COPPA, GDPR-K) holds from day one.
- **Staging and production stay separate**, like their databases: two tables,
  two PostHog projects. The staging robot's visits are marked in our table and
  left out of every graph, and it never loads PostHog.
- **Never slows or breaks the app.** Events are batched, sent in the background,
  and dropped silently if the call fails.
- **Off until said otherwise.** Nothing is recorded unless `ANALYTICS_ENABLED`
  is set for the environment, and PostHog loads only where a project key is
  set too. Production stays off until the privacy page says what is collected
  (it says "No analytics" today, and only Raz changes its words).

## Where a visitor came from (the door)

Every link and QR code we hand out carries a source tag, so each group is its
own segment without asking anyone anything:

| Door | Link example |
|---|---|
| A class | the class link or code. Each class is its own door (`class-<id>`) |
| A fair or museum stand | `heromaker.app/?via=fair-telaviv-nov` (a QR on the stand) |
| A birthday or gift | `?via=gift-<name-of-campaign>` |
| A post, a flyer, a friend | `?via=<anything>` (and the usual `utm_*` tags, which PostHog reads) |
| None | "direct" |

The first `via` a browser arrives with is kept as its door for later visits too.
A tag is lowercase letters, digits, `-` and `_`, 40 at most.

One optional question, asked once when someone makes their first hero, two
taps, skippable (**designed first, built only after Raz approves it**; the
backend already accepts the answer as `survey_answered`):

- **What's it for?** Just for fun · A gift · A class · An event
- **Who's drawing?** A kid · A grown-up

## Events

Sent by the browser unless marked *backend*. The allow-list is
`backend/app/services/analytics.py`; `frontend/src/analytics.ts` mirrors it.

| Area | Event | Properties |
|---|---|---|
| Visit | `visit` | new or returning (door and phone/desktop ride on every event) |
| Screens | `screen_viewed` | which screen, seconds on it |
| Gallery | `gallery_seen` | once per visit to a list: the heroes really on screen (ids, in the order seen), each one's place in the grid, the ordering in use, how far it was scrolled |
| | `hero_opened` | the hero, from where (gallery / my heroes / class / link), its place in the grid, the ordering |
| Hero | `hero_slide_viewed` | the hero, which slide (drawing / painting / 3D / toy), from where |
| Make | `make_started` | |
| | `photo_taken` / `photo_chosen` | |
| | `make_choice` | moving hero / toy / both |
| | `survey_answered` | what it's for, who's drawing (or skipped) |
| Account | `signin_shown`, `signin_done` | method |
| Pay | `credits_shown`, `checkout_started` | pack |
| | `purchase_done` *(backend)* | pack, amount, test mode. From the signed webhook, never the browser |
| Hero made | `hero_ready` *(backend)* | provider, minutes taken |
| | `hero_failed` *(backend)* | step, provider, reason code |
| | `wait_left` | the page was hidden or left while the hero was being made; minutes waited |
| Play | `move_tapped` | which move, the hero |
| | `game_started` | which game, the hero. **A funnel end** |
| Toy | `toy_made` *(backend)* | provider, when the print split completes |
| | `take_apart_tapped` | the hero |
| | `print_file_downloaded` | the hero, the format. **The other funnel end** |
| Share | `share_tapped` | the hero |
| Class | `class_created`, `class_joined` *(backend)* | |

Waiting for a design Raz approves: `adult_confirmed` ("a grown-up is with me",
before sign-in).

With `gallery_seen`, `hero_opened` and `hero_slide_viewed`: impressions, opens
and click-through per hero and per place in the grid, and per hero how many
saw the drawing, the painting, the 3D hero and the toy.

### What a property may be

An enum (one of a fixed list), a bounded whole number, a boolean, a slug (a
short tag), one of our own ids (a UUID), a capped list of ids or of whole
numbers, or a small slug → slug map. **There is no kind for free text.** What
is not on the list is dropped, never stored. No IP address and no user agent
are read. A test fails if the schema ever admits a name, an email or a
sentence.

A hero's name is never in our table. PostHog's copy of an event carries the
hero's own name only for heroes in the public gallery (Editors' choice), where
that name is public already; never a child's name, never a private hero's.

### The seam for experiments

Every batch may carry `variants` (experiment key → variant, short tags), and
each event keeps it. The gallery's ordering has a name (`default`). Both are
there so a later A/B test (for example, of gallery orders) needs no new
plumbing. There is **no experiment logic** yet: that is separate work.

## The funnel

Visit → gallery seen → open a hero → start making → photo → sign in → buy →
hero ready → **play a game** or **toy made → print file downloaded**; then
share or return.

Every graph can be cut by **door**, **phone or desktop**, **what it's for**
and **who's drawing** (once the question exists), **3D provider**, and date.

## PostHog

- **EU cloud**, one project for staging and one for production.
- **Off unless a project key is configured** for the environment. The app asks
  the backend at runtime (`GET /api/v1/analytics/config`), so the one build
  promoted from staging to production serves both. With no key the PostHog
  library is not even downloaded; a test and a browser check prove it.
- **No session recording, and no way to turn it on from PostHog's side**:
  `disable_session_recording` is set, and external scripts (which the recorder
  is) are refused (`disable_external_dependency_loading`). PostHog's remote
  settings are not read (`advanced_disable_flags`), so a switch in its
  dashboard changes nothing here.
- **No cookies** and nothing in the browser's storage: PostHog keeps its state
  in memory. The id is the same anonymous browser id our own events use.
- **Nobody is identified**: no person profiles, no name, no email, ever.
- **What the page says is not sent**: autocapture masks all text and all
  element attributes. Addresses are scrubbed: a claim link's token, a class's
  PIN and every query parameter except `via` and `utm_*` are removed.
- **On**: autocapture (clicks), a pageview on every screen change and a page
  leave (time per screen, paths, scroll depth), heatmaps, and our named events
  from the one `track()` function.
- **The backend's own events** (`purchase_done`, `hero_ready`, `hero_failed`,
  `toy_made`, `class_*`) go to PostHog with the Python client, under the same
  anonymous id, only when a key is set.
- **Robots**: an automated browser never loads PostHog (ours, and PostHog's
  own bot filter); a robot's backend events are not sent.
- **IP addresses**: PostHog's "Discard client IP data" must be ON in each
  project's settings. It is a project setting, not something the code can set.

### Turning it on

Per environment (Railway), on the backend service:

| Variable | Value |
|---|---|
| `ANALYTICS_ENABLED` | `true` (staging has it; production not yet) |
| shared variable `POSTHOG_PROJECT_KEY` | that environment's project key (`phc_…`: public and write-only, but still kept out of the code) |
| `POSTHOG_HOST` | `https://eu.i.posthog.com` (the default) |

`devops/railway/env/backend.env` already references the shared variable; after
it is created, `./devops/scripts/railway-env.sh sync -e <environment>`.

## The record we hold: CSV

`GET /api/v1/admin/analytics/events.csv` (admins): every event in our own
table, oldest first, with `?from=` and `?to=` days; robots left out unless
`?include_robots=true`. For anything the graphs do not show.

## Out of scope

Session recording (decided: never), a home-made dashboard, experiment logic,
anything measured inside the games, email or push follow-up.

## Done when

- Each event above is recorded on staging, checked by the staging robot's run
  (its own visits marked as robot, and PostHog never loaded for it).
- A visit through `?via=test-fair` is recorded with that door.
- With the staging project key set, the same events arrive in PostHog's
  staging project, and nothing arrives in production's.
- No event payload contains personal data (a test checks the event schema).
- The privacy page says what is collected, with Raz's words, before production
  is turned on.
- It is promoted to production with Raz's yes, like everything else.
