# Raz's principles

Read this before any UI, UX or copy work, every time. These are the rules Raz has
had to repeat. Breaking one is a bug, not a style choice. `BRANDBOOK.md` holds the
tokens, components and measurements that carry them out; this page says what
they are for.

## How we work

1. **User value first, then UX, then UI.** Start from who uses the screen and what
   they are trying to do (`USER_STORIES.md`). Decide what the screen is for before
   drawing it. "Don't skip the step of thinking what gives value to users."
2. **Design before code.** A new screen or layout is designed for phone AND
   desktop, together, and approved before it is built. No improvising a layout in
   code. "You're just improvising the desktop layout. You don't really have any plan."
3. **Review with a master's eye before showing anything.** Screenshot every size,
   compare phone and desktop side by side, measure the spacing, and fix the
   weakest spot first. If a professional product designer would not ship it, Raz
   does not see it. "Why do you allow yourself to publish things that look ugly?"
4. **Never make Raz repeat himself.** When he states a rule, it goes into this page
   or the brand book in the same change.

## One layout, every size

5. **The same components and the same page structure on every screen size** (the
   holy grail grid). Phone and desktop differ only in CSS: area sizes, spacing,
   scale. No desktop-only components, no second layout. "Reuse the same components
   between mobile and desktop."
6. **Desktop is the phone layout, scaled up.** Everything stays in the same
   container and the same relative place. What is inside the stage on a phone is
   inside the stage on desktop. "On mobile the action items are inside the purple
   area, but here you put them outside. Why?"
7. **Consistent positions across screens.** The same element sits in the same place
   on every screen: back top-start, title centred, primary bottom-most.
   "COHERENCY AND CONSISTENCY IN ELEMENT POSITIONS."

## Space

8. **Spacing is intentional and consistent.** One spacing scale. The same gap for
   the same relationship, everywhere. Never a double gap where one is meant.
   "Spacings … INCONSISTENT!!!", "you need to remove one of the spaces."
9. **No dead whitespace.** Every area earns its place; the hero or the content
   fills what is left. "Why so much dead whitespace", "don't use half the screen
   just for a few buttons."
10. **But breathing room.** Nothing crammed: at least one space between separate
    things, and nothing touching a card's edge. "It's all too dense", "too close
    to the edge."
11. **Nothing overlaps. Nothing floats.** Every element has a reserved place.
    Controls belong to something: a bar, a card, a row. "Elements override each
    other", "floating in the middle of nowhere."
12. **Symmetry and centring.** Titles, indicators and captions are centred on
    what they describe; control rows are centred and balanced. "Should be below
    the character", "centered above the character."

## Less is more

13. **Say less.** One title and at most one short line per screen; buttons of 1–3
    words; no redundant titles, tags or labels. "Less is more", "TOO MUCH TEXT."
14. **No mystery controls.** Every control says what it does. No unlabelled icons
    beyond back, close, more and play; no sliders or icons whose purpose isn't
    obvious. "The slider, what is it? … the expand icon, it does nothing."
15. **No dividers.** Space separates, never a line.

## The hero and the drawing

16. **The hero is the screen.** It is as big as the space allows and dominates its
    stage, on every size. "Most of the area showing the character."
17. **Never crop a drawing or a hero.**
18. **One element, never a duplicate.** The same drawing, name card or hero is one
    element that moves, not two copies. "It needs to be exactly the same element.
    Don't duplicate."
19. **The drawing is a polaroid, the same everywhere:** white frame, slight tilt,
    the name card centred under it, exactly as in the gallery.

## Interaction and tone

20. **Tap = instant.** A move plays the moment it is tapped. No queues.
21. **The primary action is the bottom-most element**, in the same place on every
    screen.
22. **Kind, playful words.** Kids read this. Never violent or clinical: the action
    figure is a toy made of pieces, never cut or split. "It's almost violent."
23. **Decisions belong where they are made.** Choose what to make (a moving hero, a
    toy, or both) when making it, not by a sales button on an unrelated screen.

## Text, images and buttons (Raz, 2026-11-15)

24. **As little text as possible, in one voice.** A screen's text is one font
    per role and one colour per line: never a word picked out in another colour,
    and the logo is one colour (ink). The gallery says one thing, its headline.
    "So much text!! … so many different fonts and forms of text."
25. **Two sentences get a line each.** Never break a sentence across lines when
    each could have its own, and never leave one word alone on a last line
    (`text-wrap: balance`).
26. **A picture fills its space.** A drawing or hero is as large as its area
    allows; a small picture floating in a big empty card is a bug. "Why so
    small, there is so much empty space around it."
27. **One rule for every button.** Icon and words centred; a price follows the
    words ("Make it · 10 credits"), never pushed to the far edge. Phone: full
    width, stacked, primary last. Desktop: 320px each, one centred row, primary
    last. Fields beside buttons take the same width.
28. **Show people only what is theirs.** Visitors see "Run a class" beside
    "Make a hero"; a signed-in user who is not a teacher never sees it, and
    becomes one from their account ("I teach a class").
29. **Nothing scary or broken is ever shown,** even as an example: a toy with
    the wrong colours (a blue face) is not a placeholder.

## Shape (Raz, 2026-11-15)

30. **Equal padding.** A box's inner space is the same at its sides and below
    its last element (add a button's 6px depth back underneath).
31. **Concentric corners.** An enclosing box's radius = the radius of what is
    inside it + the padding between them.
32. **A corner element sits equally in from both edges it is near.**
33. **What you can press looks pressable** (ink outline and depth); flat
    panels are information only.
34. **Hints show once,** the first time, inside the card; never as a standing
    line.
35. **No prev/next arrows** on any size: swipe, drag, the dots and the keys.

36. **Every button is a pill, on one line.** Icon and words sit side by side;
    never a rounded rectangle, never an icon stacked above its label. (Raz, 2026-11-19)

37. **Two sizes of button, never three.** Controls (header buttons and a slide's
    dock) share one height; the bar's buttons share the other. (Raz, 2026-11-19)
38. **A row of buttons lines up.** The buttons in a dock have one width, and the
    dock is exactly as wide as the bar's buttons below it.
39. **"Chosen" looks the same everywhere:** light purple with a grape outline.
    Solid grape is only the one primary action.
40. **Gaps repeat.** Dock to card edge = card to bar; the space below the bar's
    buttons = the side margin.

The full list, every review as a Do and a Don't: `DOS_AND_DONTS.md`.

## Before showing Raz

- Screens at 360x640, 390x844, 844x390, 1280x800, 1440x900 and 1920x1080, phone
  and desktop side by side.
- Every principle above checked, with any measured numbers written down.
- A staging link, and the one question at the top of the message.
