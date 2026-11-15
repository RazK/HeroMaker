# User stories and screens

Every screen exists to serve one of these stories. Design a screen from its
story: what the person came to do, the one primary action, and what they need to
see to do it. Phone and desktop are the same screen at two sizes
(`PRINCIPLES.md` 5–7).

## Who uses HeroMaker

- **The kid (4–11).** Draws, wants to see the drawing come alive, play with it, show it off. Reads little; taps a lot.
- **The parent.** Pays, signs in, worries about privacy and cost. Reads carefully, decides once.
- **The visitor.** Arrives from a shared link or the gallery. Decides in seconds whether this is magic.
- **The teacher.** Runs a class: many kids, one code, no accounts for kids.
- **The collector (later).** Wants the hero as a real toy to print.

## Stories

| # | As a … | I want to … | So that … | Screens |
|---|---|---|---|---|
| S1 | visitor | see what HeroMaker makes, at a glance | I believe it and want my own | Landing / gallery |
| S2 | visitor | open a hero and watch it move | I feel the magic | Hero page |
| S3 | kid | photograph my drawing | it becomes my hero | New hero sheet → camera / photos |
| S4 | parent | choose what to make (a moving hero, a toy, or both) and see the price | I decide once, knowingly | What should we make? |
| S5 | parent | sign in only when it's needed | the kid isn't blocked by forms | Sign in sheet |
| S6 | parent | buy credits safely | the hero can be made | Buy credits sheet → checkout |
| S7 | kid | watch my hero being made, without an empty wait | I stay excited | Hero page, being made |
| S8 | kid | see my drawing, its painting and my 3D hero, and make it move | it's mine and alive | Hero page: drawing, painting, 3D |
| S9 | kid | play a game with my hero | I have fun with it | Game chooser → game |
| S10 | kid | show my hero to family | they see what I made | Share |
| S11 | kid/parent | find all my heroes | I can go back to them | Gallery: My heroes |
| S12 | parent | rename, remake or delete a hero | I stay in control | ⋯ menu, dialogs |
| S13 | collector | see my hero as a toy made of pieces and get the print file | I can print it | Hero page: toy view; ⋯ Make it a toy |
| S14 | teacher | run a class with a code | every kid makes a hero without an account | Class screens |
| S15 | parent | manage my account and purchases | I trust the product | Profile / account sheet |
| S16 | anyone | understand what went wrong, calmly | I'm not blamed and know what to do | Errors, failed hero |

## Screen inventory

Every screen below needs a phone (390x844) and a desktop (1440x900) design in the
same layout before it changes in code. One primary action each (P), at most one
secondary (S).

| Screen | Story | P | S | States |
|---|---|---|---|---|
| Gallery (signed out = landing) | S1, S11 | Make a hero | Sign in | signed out, signed in, My heroes, empty, loading |
| Hero page | S2, S7, S8, S13 | Play | Make your own / Share | drawing, painting, 3D, toy; being made; failed; not mine |
| Full-screen drawing | S8 | Close | — | — |
| New hero sheet | S3 | Take a photo | Choose from photos | — |
| What should we make? | S4 | Make it (price) | — | one or both chosen |
| Sign in / sign up sheet | S5 | Continue | Google | sign in, sign up, error |
| Buy credits sheet | S6 | Buy (pack) | — | packs, unavailable |
| ⋯ menu | S10, S12, S13 | — | — | mine, not mine, admin |
| Confirm dialogs (delete, spend) | S12, S13 | Confirm | Cancel | — |
| Game chooser | S9 | Play (game) | — | — |
| Games (Robot Rumble, Dance party) | S9 | Start | Back | intro, playing, end |
| Profile / account | S15 | — | Sign out | — |
| Class screens | S14 | Join / Start | — | teacher, kid |
| Error and failed states | S16 | Try again | — | per error code |

## The shell every screen shares

Header (back or logo at the start, title centred, one action at the end), body,
and bar (primary bottom-most). On a phone they stack. On desktop the same areas
get more room, never a different arrangement of what goes inside them. A game's
own screen follows the same shell: the game's stage is the body's card, and its
intro panel is a sheet or the bar, never a half-empty column.
