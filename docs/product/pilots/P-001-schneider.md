# P-001: Schneider Hanukkah happening

An observed pilot (D-001, `../OPERATING.md`). It must answer the three
questions below; anything else we see is a bonus.

| | |
|---|---|
| **When** | Thu 10 Dec 2026, 9:00-14:00 (set up from 7:00) |
| **Where** | Schneider Children's Medical Center, the glass building's lobby, Kaplan 14, Petah Tikva |
| **Who** | 50-100 children, with parents and staff. Many may be patients. |
| **Runs it** | Raz, with whoever he brings. The app runs in class mode on production. |
| **Door** | `?via=schneider` on the take-home QR card (Maya's A6 card, before 6 Dec) |
| **Rules** | Non-commercial: no prices, no sales pitch. The QR to the site is allowed. **No photos of children at all**, not even for us. |
| **Cost** | Provider cost about $0.87 a hero: about $45-90 for 50-100 heroes. Top-up by 7 Dec (Raz's yes). |

## What this validates

The **home-from-class money moment** (`../MONEY_MOMENTS.md` #5): a child brings a
hero home → the family keeps it → the family buys more. **The day itself is
non-commercial** — no prices, no pitch, seats concierge-granted. The paid signal
comes **after**, from the take-home `?via=schneider` QR → purchases in the 14
days.

## Privacy & consent — the first rule

- **In our notes, the repo, or any message:** never a child's name, face, photo
  or drawing. Ages as a **band only** (4-6, 7-9, 10-12).
- **On the day:** **no photos of children at all**, not even for us. Observers
  tally on **paper**.
- **In the app:** a child joins with a **code** and gives only a **first name +
  age** — no account, no email, no surname, no face (`../class-sessions.md` §7;
  COPPA / GDPR-K / Israel's law). The teacher (Raz) acts for the parents under
  the school-activity exception. **Nothing leaves the class until a parent claims
  a hero** at home. The only thing that leaves with the family is the QR card.

## The three questions

1. **Can one stand give every child a hero while they are there?** (H-031,
   H-028) Count heroes started and finished per hour, and how long each child
   waited from drawing to seeing it move. Supported: 20 an hour and nobody
   leaves without their hero. Rejected: under 10 an hour, or children leaving
   before the painting.
2. **Do children light up when their hero moves, and stay for it?** (H-005,
   H-016) Count, out of the children who finished: how many smiled, called
   someone over, or asked to see it again. Supported: most. Write the words
   they used, without who said them.
3. **Do parents want to keep it?** (H-032, money moment "I want to keep
   this") Count: QR cards taken, parents who asked how to keep or print the
   hero, parents who asked the price (answer: "it's on the site"). After the
   day, from the app: visits with door `schneider`, heroes made and purchases
   in the 14 days after. Supported: 1 in 5 families visit again, and at least
   one buys. Rejected: almost no visits.

## The class/teacher flow (validated on staging 2026-11-27, v2.0.265)

The stand runs the app's class mode: the teacher turns on **"I run classes"** →
creates the class → **Start class** → projects a **6-digit code + QR** → each
child **joins with the code** (first name + age, no account) → **makes one hero**
→ the teacher sees it on the live board. One hero per child (a server-side seat
counter). The whole flow was walked end to end on staging, through the
pay-for-seats step (**₪10 a seat, min 10 = ₪100**). **For Schneider the seats are
concierge-granted** (non-commercial), so the day needs no payment.

## Count by hand on the day

A sheet of tally marks, one row per hour: heroes started, heroes finished,
children who left before the painting, QR cards taken, "how do I keep it",
"how much", "can I print it".

The toy table (display only: two Violets, one-piece and jointed, no price):
"can I get one like that?", which toy a child picks up first (jointed or
statue), and that child's age band (4-6, 7-9, 10-12). This reads H-046 and
gives a first look at H-037.

## Before (do-list, with owners — **Raz-only flagged**)

| By | Item | Owner |
|---|---|---|
| **30 Nov** | Hebrew decision for the children's screens | **Raz** |
| 3 Dec | Class-mode test on production, start to finish | Dev + Growth |
| 6 Dec | Equipment (tablets/phones, camera stand, power, Wi-Fi/hotspot) + printed A6 QR card (Maya) + A4 table sign | Design + ops |
| **7 Dec** | Provider top-up for 100 heroes (~$45–90) | **Raz** (yes) |
| 9 Dec | Pre-create the class(es) on production + **concierge-grant seats** (no payment on the day) | Growth + PM (**Raz's yes** to spend provider credits) |
| 9 Dec | Robot green on production's version; the share link + its WhatsApp preview work | Dev |

**Raz-only asks (via the PM):**

1. Hebrew children's screens decision — by 30 Nov.
2. Provider top-up yes (~$45–90) — by 7 Dec.
3. Payments Live on production before Dec 10? — it opens the take-home → buy
   path during the 14-day `?via=schneider` window. If not, the pilot still runs;
   we read revisits, not purchases, until live.

## During

Notes on what people **do and say**. Never a child's name, face, photo or
drawing in the notes. Ages as a band only (4-6, 7-9, 10-12).

## After (by 13 Dec)

One line per question: what we now believe, and from how many people.
Update H-005, H-016, H-028, H-031 and H-032. Count the `schneider` door on
24 Dec (14 days). Into the Sunday review.

## Result

Not run.
