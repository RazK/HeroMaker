# Creator and group leader: one app, two places

**Summary.** HeroMaker is used two ways: to make heroes at home, and to run a
group (a class, a club, a party) where every child makes one. They are
different jobs, and one adult often does both. So there is one home with
**two places, Gallery and My classes**, and a **switch under the header** to
move between them. The switch appears only for people who run groups. A class
that is live is one tap away from either place.

Builds on [class-sessions.md](class-sessions.md) (what a class is) and the
[brand book](../design/BRANDBOOK.md) (how it looks).

## 1. Who uses it

| | Child creator (4–12) | Parent | Group leader (teacher, club, party host) |
|---|---|---|---|
| **Job** | Turn my drawing into a hero, then play with it | Make it happen: hold the phone, pay, keep the heroes | Give every child in the room one hero, at a known cost, with no accounts |
| **Key moments** | "I just drew this." Watching it come alive. Playing. | Bedtime, a rainy weekend: snap, pay, wait. Opening a link from school. | **The night before:** create the class, pay seats. **In the lesson:** start, project the code, watch heroes arrive. **After:** show the class gallery, start again for kids who were away. |
| **Must see first** | Their own heroes, the Make a hero button | Credits, My heroes | The class that is live now; otherwise their classes |
| **Rarely needs** | Settings, money | Classes, admin | Editors' choice, the sign-up of children (there is none) |
| **Device** | A parent's phone, a class tablet | Their phone | Laptop on a projector in the lesson; phone the night before |

**The dual person** is the common case, not the edge: the teacher who is also
a parent, the party host who keeps making heroes with their own kids. They
need both places, never at once, and must not hunt for either. On a lesson
morning the class matters most; on Saturday their heroes do.

**Shared by all:** one account, one balance of credits, Buy credits, the hero
page, the same tile and look everywhere. A group leader pays for seats from the
same credits a parent buys.

**Where they differ:** a creator's unit is *a hero*, a leader's is *a class*
(a set of seats and the heroes they became). A creator's primary action is
**Make a hero**; a leader's is **New class**, or **Open class** while one is
live. A leader's screen is often projected to 30 children; a creator's never
is.

## 2. Information architecture

### Alternatives considered

| | A. One home, two places (switch under the header) | B. Two homes, role picked from the account | C. Bottom tab bar (Gallery · Classes · Me) |
|---|---|---|---|
| How it works | Gallery and My classes are places of the same home screen. A segmented switch under the header picks the place; chips filter only within Gallery. | The avatar sheet chooses "Creator" or "Group leader"; each has its own home. | Persistent tabs at the bottom. |
| For | One header, one grid, one tap between places. High in the hierarchy, impossible to miss. Nothing changes for people who never run a group. | Each home is pure. | Familiar from native apps. |
| Against | Adds one row under the header for leaders. | Switching is two taps and hidden in a sheet: the "setting, not a switch" Raz rejected. A live class can be a whole role away. | Breaks the brand book's bar (the bottom-most element is the screen's primary button). Three tabs where only two exist; it adds a tab for everyone. |

**Recommendation: A.** It is the only one that keeps the bar rule, keeps
classes one tap from the gallery and adds nothing for a creator.

### The structure

- **Header** (every home): the logo (always home), credits, the account.
- **Switch**, under the header, only when "I run classes" is on:
  `Gallery | My classes`. It is the level above the chips and never scrolls
  away. A class in session puts a live dot on My classes.
- **Gallery** (everyone): chips Editors' choice · My heroes (admins also
  All heroes · Failed). Bar: **Make a hero**.
- **My classes** (leaders): the school card, a live class pinned first with
  **Open class**, then the class cards. Bar: **New class** (secondary while a
  class is live, since Open class is then the one grape action).
- **Live strip.** While a class is live, Gallery shows a sun strip under the
  switch: Live, the class, the time left. One tap opens the class.
- **Class page** (unchanged): the class gallery and Start class; live, the
  code, QR and roster to project. Back goes to My classes.
- **Account sheet:** Buy credits, Redeem a coupon, Edit profile, **I run
  classes** (a toggle), Admin, Sign out, Delete account. It is settings, not
  navigation.

### Content in one place or both

| Both places | Gallery only | My classes only |
|---|---|---|
| Header, credits, account sheet, Buy credits, the hero page, pull to refresh, the live strip or dot | Chips, Editors' choice, My heroes, Make a hero | School card, class cards, New class, class pages |

Class heroes never appear in Gallery (privacy: class-sessions.md section 7).

### Entry points

- **First run, creator:** Gallery, Editors' choice. Nothing about classes.
- **Becoming a leader:** the account sheet's **I run classes**. Turning it on
  shows the switch and lands on My classes, whose empty state asks for the
  first class. A visitor who is signed out taps **Run a class** under the
  intro, signs up, and lands on My classes the same way. The "I'm a teacher"
  toggle leaves the sign-up sheet: parents signing up to keep a hero should not
  meet it.
- **Opening the app during a lesson:** a leader with a live class lands on My
  classes, the live card first. That happens once per visit, never under their
  feet.
- **`?class_paid=<id>`** (back from paying for seats): that class's page,
  watching its seats arrive. Back goes to My classes.
- **`/join`:** the student flow, no app around it.
- **`/claim/<token>`:** the parent page. Keeping a hero lands on Gallery,
  My heroes, whatever place was last used.
- **The logo:** home, in the place last used, scrolled to the top.

### Empty states

| Where | Shows | Action (in the bar) |
|---|---|---|
| My heroes, none | A plate with a brush: "Your heroes live here" | Make a hero |
| My classes, none | A plate with a school: "Your first class", "Pay once for its seats. Every child makes one hero." | New class |
| Class with no heroes | "No heroes yet", "Start the class. Heroes appear here as they're made." | Start class |
| Live, nobody joined | "Students appear here as they join." | End class |
| Could not load | The message and a **Try again** button | (bar unchanged) |

### Turning group mode off

**I run classes**, the same toggle in the account sheet. Off: the switch and
the live strip go, Gallery shows, the classes are kept and come back when it is
turned on again. It is rare, so it is not on the home screen.

## 3. Rules this keeps (Raz)

- No underlined text links: every action is a button, a row, a chip or a
  toggle.
- Classes are high in the hierarchy: on the switch, never a cropped chip.
- The logo always goes home. Pull to refresh everywhere.
- One tile everywhere, two columns on a phone.
- A live class is one tap away: the live strip on Gallery, the live card on
  My classes.
- One title, one short line per screen.

## 4. Implementation

1. **No text links** (`fix/no-text-links`): every `tb-link` becomes a button,
   a chip or a bar button; `.tb-link` is deleted.
2. **Roles and homes** (`feat/roles-home`): the switch, the live strip, the
   school card, the account toggle, the empty states, the signed-out entry,
   and the robot's class step on the new navigation (the same PR, so staging's
   robot never runs the old path against the new app).
