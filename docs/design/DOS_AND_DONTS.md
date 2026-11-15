# Appendix: Dos and don'ts

Every rule Raz has given in a review, as a Do and a Don't, with his own words
and the date. It is the checklist to run before showing him any screen; the
drawn version, with the fifteen that come up most, is on the design canvas
(<https://claude.ai/artifact/SDwYs3N3xQ2ZkC6PXXFLtH>, "Dos and don'ts").

`PRINCIPLES.md` is the short form; this is the long one. When he states a new
rule, add it here and there in the same change.

Hebrew is translated and marked (he). The last column is the matching
PRINCIPLES.md rule, or NEW when only this page (or the brand book) has it.

## 1. Layout: one layout for every size

| # | Do | Don't (what was done) | Raz said | Date | P |
|---|---|---|---|---|---|
| L1 | Use the same components and the same grid (holy grail) on phone and desktop. Only the CSS changes. | Build a separate, improvised desktop layout | "You need to reuse the same components between mobile and desktop… We need the holy gray layout" | 2026-11-15 | 5 |
| L2 | Keep desktop as the phone layout scaled up: what sits inside the stage on a phone sits inside it on desktop too | Put the moves outside the purple stage on desktop | "On mobile, the action items… are inside the purple area, but here you put them outside. Why? What's the reasoning?" | 2026-11-15 | 6 |
| L3 | Design every screen for phone and desktop in the brand book before building it | Improvise the desktop layout in code | "You're just improvising the desktop layout. You don't really have any plan for that" | 2026-11-15 | 2 |
| L4 | Put the desktop page in the phone's cream frame: header, side margins and foot in one colour, with the stage as a plate card inside | Stretch the lavender stage to the screen edges, with no cream frame | "on mobile, you have this cream-white space behind… the purple one, and on desktop, you don't have it… the menu on the side, the top bar, and… the frame around the preview are in the same color" | 2026-11-15 | NEW (BB) |
| L5 | Give the hero most of the screen, with its controls in one row under it | Use two columns: the stage in one half, a few buttons in a mostly empty other half | "don't use half the screen just for a few buttons where most of the space is empty. It's really bad." | 2026-11-13 | 9, 16 |
| L6 | Scale the hero to the size of the screen | Show a small figure on a capped stage with empty screen all round | "Look at how much of the screen is empty. Look at the size of the hero compared to the size of the screen." | 2026-11-13 | 16 |
| L7 | Put the same element in the same place on every screen: back top-start, title centred, primary at the bottom | Let positions drift from screen to screen | "COHERENCY AND CONSISTENCY IN ELEMENT POSITIONS" | ≤2026-10-04 | 7 |
| L8 | Build every screen, including games, from the app's own Toy Box parts | Build a game screen in its own look | "too small, not coherent with the rest of the app's menus"; "inconsistent with rest of the UI… so random and inconsistent!!!" | 2026-10-18, 2026-11-15 | 5, 7 |
| L9 | Reuse the same view wherever the same thing appears (a hero opened from a class looks like the gallery's) | Give the same content a different screen in a different place | "I want the same view from the class."; "Keep it consistent across the app." | 2026-10-18, 2026-10-19 | 5 (partly) |
| L10 | Fit a phone screen without scrolling. Scroll only for significant new information. | A little scroll on the hero screen | "a little bit of scrolling - why? No need!"; "Only scroll if there is significant new information to reveal" | 2026-10-04 | NEW (BB) |
| L11 | Hide legacy screens that are not in the Toy Box look | Leave the old "Every step" card view reachable | (paraphrased) the per-step view is outdated and not Toy Box; don't let people see it | 2026-10-17 | NEW |

## 2. Spacing and alignment

| # | Do | Don't | Raz said | Date | P |
|---|---|---|---|---|---|
| S1 | Use one spacing scale: the same visible gap (16px) around the header, between blocks and around the bar | Different gaps (0, 8, 16, 32) for the same relationship | "Spacings below buttons or above and between header and gallery and bottom section... INCONSISTENT!!!" | 2026-10-02 | 8 |
| S2 | When you remove a separator, keep one gap where there were two | Keep the double gap a removed divider leaves | "The lines caused double spacing above and below them, so… you need to remove one of the spaces" | 2026-11-14 | 8 |
| S3 | Give a container equal inner space at the sides and the bottom | Use uneven padding inside a card or sheet | "spacing here is awful! sides and bottom not same space" | 2026-11-15 | **NEW** |
| S4 | Centre a group vertically in its card, with equal space above and below. Keep a caption close to its picture, but not touching it. | Put the caption against the picture with a tall empty band under it | "too close to the image and more importantly too much space below it why is it so high?!" | 2026-11-15 | **NEW** |
| S5 | Leave no dead whitespace: the content fills its area | Large empty areas around small content | "why so much white space dead space??"; "Why so much dead whitespace" | 2026-11-15 | 9 |
| S6 | Leave breathing room: a full space between separate things, and the dots in a row of their own | Pager dots crammed against the name and the hero | "too close to the name and the character. It's all too dense. You need to have more breathing space." | 2026-11-15 | 10 |
| S7 | Keep everything at least one space in from a card's edge | The drawing card touching the edge; a circle tight to its pill's edges | "too small, too close to the edge"; "Circle is too close to the edges of the white pill." | 2026-10-20, 2026-11-15 | 10 |
| S8 | Keep a caption's own parts calm and spaced | A progress bar 2px from the name and 2px from the status | (paraphrased) the in-progress tile is too dense | 2026-10-19 | 10 |
| S9 | Give every element a place of its own | Elements drawn on top of each other (a tag over the name and the dots) | "layout is horrible man elements override each other its awful" | 2026-11-15 | 11 |
| S10 | Attach every control to something: a bar, a card or a row | Arrows or panels floating in empty space | "They're just floating in the middle of nowhere and don't make sense" | 2026-11-15 | 11 |
| S11 | Centre the name card under its picture | The label pushed to the bottom-left corner | "why is the label so far on the left? should be below the character man" | 2026-11-15 | 12 |
| S12 | Centre the step dots and the name over the hero | Dots and name at top-start, beside Back | "needs to be centered above the character not in the left. same as character name" | 2026-11-15 | 12 |
| S13 | Keep the hero centred in its stage | The hero pushed off to the right | (paraphrased) the hero sat off to the right on the making screen | 2026-10-19 | 12 |
| S14 | Put a game's moves in one centred bar | A moves panel stuck in the bottom-left corner, the hero pushed right | "this layout is horrible" | 2026-10-02 | 12 |
| S15 | Make paired things (the drawing and the hero) equal and side by side | An asymmetric pair | (rejection recorded in the brand book) | ≤2026-10-04 | 12 |

## 3. Radii and shape

| # | Do | Don't | Raz said | Date | P |
|---|---|---|---|---|---|
| R1 | Nest radii: an outer box's radius = the inner element's radius + the padding between them, so the curves run parallel | An enclosing box whose corner radius doesn't fit the pill buttons inside it | "raddi of enclsoing box not fitting that of inner buttins that's horrible" | 2026-11-15 | **NEW** |
| R2 | Keep header controls slim, all one height (40px plus outline) | A fat, tall credits pill | "too fat and tall" | 2026-10-17 | **NEW** (BB) |
| R3 | Let a slider handle run to the very edge, half of it visible there | A handle circle that stops short of the edge | (he) "the circle… should reach the edge, and at the edge show only half of it, not the whole circle" | 2026-11-13 | **NEW** |
| R4 | Frame the drawing in the polaroid: white frame, slight tilt, frame hugging the picture | A flat card, or a frame with empty bands at the sides | "I love how you put the drawing inside a white frame, slightly tilted… This is fantastic"; "you still have like white or empty space on the sides" | 2026-10-17, 2026-11-13 | 19 |

## 4. Text, copy and fonts

| # | Do | Don't | Raz said | Date | P |
|---|---|---|---|---|---|
| T1 | Keep text to one title and at most one short line per screen | A headline, a sub-line, a paragraph and a link | "TOO MUCH TEXT ON THE PAGES"; "so much text!!!!!!!! WHY?!?!?!?!" | ≤2026-10-04, 2026-11-15 | 13 |
| T2 | Use one font per role and one colour per line | Many fonts and many forms of text on one screen | "so many different fonts and forms of text WHY?!?!?" | 2026-11-15 | 24 |
| T3 | Set the logo in one colour (ink) | A wordmark that is part blue, part black | "WHY… YOU MADE IT PART BLUE PART BLACK!!?!? ONLY BLACK" | 2026-11-15 | 24 |
| T4 | Give two sentences a line each, and never leave one word alone on the last line | A sentence broken across lines, ending on a lone word | "start each sentences in its own line instead of breakign a sentence especially on just the last word" | 2026-11-15 | 25 |
| T5 | Leave out redundant labels and tags | "Drawing" and "Hero" tags over obvious content | (he) "it's clear what a drawing is and what a hero is, why more unnecessary information… Less is more." | 2026-11-13 | 13 |
| T6 | Show one label element, which stays put | A copy of the same label on each slide | "Why 2 label elements if it's same label? Keep it there" | 2026-11-14 | 18 |
| T7 | Use kind, toy words: a toy made of pieces | "Cutting it into parts" | "It's almost violent." | 2026-11-15 | 22 |
| T8 | Use Barriecito for the wordmark, titles and buttons, and Nunito for body text. The brand book shows the real font. | Fredoka for the logo; a brand book showing the old font | "use Barriecito in all titles and buttons" (paraphrased); (he) "we're not working with the font you brought anymore… Barriecito" | 2026-10-15, 2026-11-13 | **NEW** (BB) |
| T9 | Set text people copy (URLs, codes) in Nunito 800 | URLs and codes in Barriecito | (paraphrased) Barriecito is not good for URLs | 2026-10-18 | **NEW** (BB) |
| T10 | Keep fonts readable, never tiny | Tiny type | "Fonts not tiny" (summary of his rule) | ≤2026-10-25 | **NEW** |
| T11 | Put a line of text on its own line, and the chips about it together on the next line | Chips wrapping and breaking across lines next to text | "Refunds and terms should be in new line not break line like currently. This is a recurring comment." | 2026-10-20 | **NEW** (BB) |
| T12 | Make every action a button, a chip, a row or a card | Underlined text links | "No underlined links."; "looks like a link in a document. Doesn't give me a good feeling about my school." | 2026-10-19 | **NEW** (BB) |
| T13 | Make an error a calm line in our words, never internals, never blaming the user | "SignatureDoesNotMatch… PutObject"; "[object Object]" | (paraphrased) he saw the raw storage and validation errors | 2026-09-28, 2026-10-22 | **NEW** (BB) |
| T14 | Keep legal pages short: one idea per line, contact info once at the bottom | Repeated contact details and dense paragraphs | "don't repeat the contact, keep it short, new lines for separate ideas" (paraphrased) | 2026-10-18 | **NEW** |
| T15 | Keep the hero's name in its card on the painting slide too | An empty band where the name was | "it looks weird that there's just like an empty space over there… Keep the bubble with the name and the age" | 2026-11-13 | **NEW** (BB) |
| T16 | Keep the creator's name with the drawing | A name that appears on only part of the views | (he) "why is the creator's name only part of the drawing, it should stay there" | 2026-11-13 | 19 (partly) |

## 5. Colour

| # | Do | Don't | Raz said | Date | P |
|---|---|---|---|---|---|
| C1 | Make the frame round the stage (header, sides, foot) one cream | Different colours for the side menu, the top bar and the frame | "the menu on the side, the top bar, and… the frame around the preview are in the same color" | 2026-11-15 | **NEW** (BB) |
| C2 | Colour progress: purple behind the current step, green ahead | Uniform colour with no sense of progress | "fill it with purple, so everything that is behind us is purple and ahead of us is green" | 2026-10-20 | **NEW** |
| C3 | Give each game its own colour, world and pose | Two game posters with the same purple rays, sun and pose | "pretty much look the same" | 2026-10-18 | **NEW** (BB) |
| C4 | Show only the right colours on a hero or toy | A toy with a blue face from a colour mix-up | "omg the doll is so freaking scary with the blue face WTF!?!" | 2026-11-15 | 29 |
| C5 | Make staging visibly different (its own icon, name and tag), but keep the in-app logo's picture and proportions | A staging logo shrunk into a dark tile | "it looks weird, like you have some dark background and proportions are not correct"; "make sure that the app icons for staging and production don't look the same" | 2026-10-20 | **NEW** (BB, CLAUDE.md) |

## 6. Images: the hero and the drawing

| # | Do | Don't | Raz said | Date | P |
|---|---|---|---|---|---|
| I1 | Make a picture as large as its area allows | A small drawing floating in a big empty card | "why so small there is so much empty space around it - can be bigger!!"; "this image can be bigger in its space why so small" | 2026-11-15 | 26 |
| I2 | Never crop a drawing or a hero (`contain`) | Cropped content | "Not good that you crop the content!" | ≤2026-10-04 | 17 |
| I3 | Make the small drawing card big and put it bottom-start, a space in from the edges | A tiny card at top-left, or a desktop card too small and against the edge | "The preview of the drawing is too small on the top left corner… move it to the bottom left and make it bigger"; "the image of the drawing is too small, and it's too close to the edge" | 2026-11-13, 2026-11-15 | **NEW** (BB) |
| I4 | Use one drawing element that flies between the big view and the small card | Two copies of the drawing during a slow swipe back | "It needs to be exactly like the same element… Don't duplicate." | 2026-11-14 | 18 |
| I5 | Make the drawing the gallery's polaroid with its centred name card everywhere: tile, slide, small card, full screen | A flat drawing card with its own name strip on the hero page | "It loses this nice white frame with the slight tilt, and the name is shown differently" | 2026-11-13 | 19 |
| I6 | Make the name card compact and centred, at the gallery's size | A full-width name bubble with too much white space | "It has too much white space. It needs to be more condensed… centered and the same size as it was in the gallery" | 2026-11-14 | 19 |
| I7 | On the full-screen drawing, centre a compact name card a space below the tilted frame | A wide, off-centre card hugging the drawing | (he) "the bubble at the bottom is not centered and it's too wide and there isn't enough space between it and the drawing" | 2026-11-14 | 10, 12, 19 |
| I8 | Scale the name card with the screen on a wide display | A phone-sized chip under a 1000px picture | "or bigger" | 2026-11-15 | **NEW** (BB) |
| I9 | Put the sun disc behind the upper body only, so the figure stays as big as it would be without it | A disc behind the whole figure that shrinks it; no disc at all | "behind the torso and the head… so that the image and the model can actually be a little bit bigger"; "maybe resume the yellow circle we had earlier? it was nice" | 2026-11-13, 2026-11-15 | **NEW** (BB) |
| I10 | Show the drawing, the painting and the live hero. Cut the noise. | Steps strip, polaroid swap, auto-play and 8 moves, with the hero at 25% of the phone | "We just want to see the original drawing, then the amazing rendering, then the fabulous 3D model… the real estate of interesting assets versus noise is not good" | 2026-10-21 | 13, 16 |
| I11 | Keep the drawing in view (the small card) beside the painting and the hero | Losing the original drawing after the first slide | "maintain showing the original drawing on small card next to the render and model" | 2026-10-25 | **NEW** (BB) |
| I12 | Paint only what the drawing shows, and keep the drawn face readable | Anime adds hair; Original loses the eyes; Minecraft adds a letter and an outfit | (paraphrased) the AI painting added things the drawing never had | 2026-10-15, 2026-10-17 | **NEW** |
| I13 | Use one real, consistent hero in example art (Super Girl, the girl in the HeroMaker logo), animated where it shows motion | Static or different heroes per card, or the wrong hero | "take super girl as example here… also same hero"; "I WAS TALKINH SUPER GIRL!!!!! THE ORIGINAL GIRL IN THE LOGO OF HEROMAKER" | 2026-11-15 | **NEW** |
| I14 | Never show anything scary or broken, even as a placeholder | A toy with broken-looking legs, or a scary face | (he) "her legs look broken… the joints don't really connect… very bad"; "the doll thing you showed me looks horrible" | 2026-11-14 | 29 |
| I15 | Show square, uncropped gallery cards, with faces never cut | Cropped faces | (commit: "no cropped faces", his request) | 2026-09-08 | 17 |

## 7. Buttons and controls

| # | Do | Don't | Raz said | Date | P |
|---|---|---|---|---|---|
| B1 | Use one rule for every button: centred icon and words, the price after the words, 320px wide on desktop | A wide button with its text spread to the edges | "why is text so widely spread make the button less wide with centered text and generally have 1 rule for buttons and their alignment" | 2026-11-15 | 27 |
| B2 | Make every control say what it does | An expand icon that does nothing; an unexplained slider; a vague "Move" | "I don't understand the expand icon, it does nothing. The slider, what is it? And the move, I don't get it." | 2026-11-14 | 14 |
| B3 | Label every icon except back, close, more and play | An unlabelled layers icon; bare step icons | "not clear enough" | 2026-10-04, 2026-10-20 | 14 |
| B4 | Show a slide's controls only on the slide they act on (the moves only on the live hero) | Dance, Wave and Flip under the drawing | "Why am I seeing the dance, wave, flip… when I'm looking at the drawing?"; "we can't really make the drawing do a flip or dance" | ≤2026-10-25, 2026-11-13 | **NEW** (BB) |
| B5 | Put swapping controls in exactly the box of the name card they replace, same width and height | Moves in a different box from the name card | "they need to be exactly in the same space as the name bubble… they start and end on the same width and height" | 2026-11-13 | **NEW** (BB) |
| B6 | Style a slide's controls like the moves: bare on the stage or foot, with files sized to fit | A white panel behind the buttons, with a .3mf button too big for it | "Why do we have the white background for the different buttons? And look, the 3MF is too big for this white area." | 2026-11-14 | **NEW** |
| B7 | Navigate the carousel by swipe, drag, dots and arrow keys | Previous and Next arrows, on phone or desktop | "On mobile, we don't need the arrows… The indication above the character is enough"; "the left-right arrows, I don't really like them" | 2026-11-15 | **NEW** (BB) |
| B8 | Play a move the instant it is tapped | Choose a sequence, then press play | "instead of the stupid choose sequence and play... as soon as an animation is clicked just play it" | 2026-10-02 | 20 |
| B9 | Make all header items (girl, wordmark, credits pill, account circle) one height on one line, never wrapping or cropped at 360px | A wordmark shorter than the pill; a circle a different height | "make the circle of the user… the same height as the pill… make the text hero maker taller… without dropping to a new line or getting cropped" | 2026-11-13 | **NEW** (BB) |
| B10 | Show the account's initials in the header circle | An auto-cropped hero picture | (paraphrased) preferred the initials | 2026-10-18 | **NEW** |
| B11 | Put the gallery's search, filter and sort in one row, with search taking the spare width | Three rows of controls | "I want the search, the filtering, and the ordering all in one line. Expand the search as much as you can" | 2026-09-08 | **NEW** |
| B12 | Put a place (Gallery, My classes) on a switch under the header, and use chips only within a place | A place as the fourth chip, cut off at the edge | "I could miss it. It needs a higher level in the hierarchy." | 2026-10-19 | **NEW** (BB) |
| B13 | Show "Run a class" only to visitors and teachers. Others become teachers from their account. | A teacher pitch shown to everyone | "if not teacher dont show it. let user become teachers from user profile interface" | 2026-11-15 | 28 |

## 8. Motion and 3D rendering

| # | Do | Don't | Raz said | Date | P |
|---|---|---|---|---|---|
| M1 | Open a ready hero on how it was made: drawing, then painting, then live hero, each as it loads | Opening straight on the end state | "show the drawing and then animate to the render and then animate to the 3D character when they finished loading" | 2026-10-25 | **NEW** (BB) |
| M2 | Shrink the drawing smoothly into its small card as you swipe, following the finger | A jump or snap to the card | "make it nice so that drawing goes into the small card smoothly when swiped" | 2026-10-25 | 18 (partly) |
| M3 | Keep step animations quick (about 1s a step) and show movement between steps | Lingering on each phase | "you're staying for too long on each one, you need to do it much faster" | 2026-10-20 | **NEW** |
| M4 | Play steps automatically with no labels under the dots | Labels under the step dots with a manual advance | "Remove the labels, but make the transition automatic between the phases" | 2026-10-20 | **NEW** (BB) |
| M5 | Fade gallery tiles from drawing to hero quickly, on one shared clock, as one even wave | Long holds; tiles flipping at random or out of order | (paraphrased) start from the drawing, change sooner; sometimes a wave, sometimes together | 2026-10-17 | **NEW** |
| M6 | Lay out the final frame from the first paint: no flash of different margins as an image loads | White bands above and below, then only below | (he) "there's a glitch… for a moment you see an image with white margin above and below… then suddenly… white only below" | 2026-11-13 | **NEW** |
| M7 | Never show an empty wait: show the dimmed painting under a % ring while the 3D loads | An empty card for 10 seconds | "Empty screen for 10 seconds WTF?!" | 2026-10-04 | **NEW** (BB) |
| M8 | Show the real live 3D, never a faked still | Making the image "float a little" in place of the 3D | "You just took the image and you made it float a little... It's outrageous" | 2026-09-08 | **NEW** |
| M9 | Render toys cleanly, with no outline artifacts on faces | A toon-outline shader drawing lines across the dolls' faces | "weird lines on them, especially on the face of the dolls" | 2026-11-15 | **NEW** |
| M10 | Prove the toy works: animate its pieces assembling and rotating on ball joints | Static parts with unclear joints | "show me like an animation of the parts being assembled and rotated so that I can actually believe you"; "You need to use the sphere joins, ball joins" | 2026-11-13, 2026-11-14 | **NEW** |
| M11 | Mirror the screen in camera games (raise your right arm and the hero raises the arm on the same side of the screen) | A mirrored camera beside an unmirrored hero | (paraphrased) he raised one arm and the hero raised the other | 2026-10-18 | **NEW** |
| M12 | Keep game scenes inside their world (fans in a grandstand behind the court, drawings pinned on the wall) and never let players hit other kids' heroes | A fan standing outside the court; punching kids' heroes | "strained outside the boundaries"; "hitting the other kids' drawings, which is bad" | 2026-10-18, 2026-10-19 | **NEW** |

## 9. Navigation and placement

| # | Do | Don't | Raz said | Date | P |
|---|---|---|---|---|---|
| N1 | Ask what to make (a moving hero, a toy, or both) when the drawing is uploaded | A sales CTA on the toy's slide | (he) "the call to action shouldn't be on this screen… when uploading a drawing you choose what to do with it" | 2026-11-14 | 23 |
| N2 | Make the toy a fourth slide anyone can view once it is made. Making it is the paid, gated action. | Toy view behind the admin panel | "If a model was split, it's just like its fourth view… for viewing, you don't need to be the admin." | 2026-11-14 | **NEW** |
| N3 | Make the carousel a loop you move through by swiping, not auto-play once the intro ends | Auto-advancing or step buttons after the intro | "a cyclic carousel… just swiping, no automatic, nothing" | 2026-10-21 | **NEW** (BB) |
| N4 | Make "How it was made" reachable for every hero, by a labelled way in | Creation steps hidden behind the owner's menu | "where do I see the creation steps? I wanted to show off the drawing to 3D phases" | 2026-10-04 | **NEW** |
| N5 | Make the full-screen drawing part of the app (polaroid, cream) | A dark-scrim viewer with a Drawing/Hero toggle | "It doesn't look like part of the app… this preview of 2 steps. It's confusing" | 2026-10-20 | 5 (partly) |
| N6 | Show each person only what is theirs (the class strip for teachers, the admin rows for admins) | Everyone sees every tool | "if not teacher dont show it" | 2026-11-15 | 28 |

## 10. Process and review

| # | Do | Don't | Raz said | Date | P |
|---|---|---|---|---|---|
| P1 | Start from user value, then UX, then UI | Jumping to visuals | (he) "don't skip the step of thinking what gives value to users" | 2026-11-13 | 1 |
| P2 | Write user stories, then design phone and desktop views for each screen, consistently, with intent behind spacing, alignment and positioning | Making screens up one at a time | "start with user stories then go to ux ui and create desktop and mobile views for each that are consistentttttttt" | 2026-11-15 | 1, 2 |
| P3 | Review every screen with a master designer's eye before showing it | Publishing ugly screens | "Why do you not self-reflect?… Why do you allow yourself to publish things that look ugly?"; "PLEASE look at the screens you create and ENSJURE HARMNY AND SENS" | 2026-11-15 | 3 |
| P4 | Write down every rule he states, in the same change | Making him repeat himself | "you need to write down my principles because i keep repeating them"; "Do you need to explain it every time?" | 2026-11-15 | 4 |
| P5 | Keep one Do and Don't guide built from all his reviews, in the brand book | Scattered rules | "open a guidebook design viusals with dos and donts and principles according to ALL my historical reiews" | 2026-11-15 | **NEW** |
| P6 | Say what you will do and get his view before a big UI change; propose a sketch first | Changing first and explaining later | (he) "tell me what you think, what you're about to do, before you do more damage"; (he) "propose a sketch" | 2026-11-13, 2026-11-14 | **NEW** |
| P7 | Investigate before changing anything | Changing things blindly | "investigate first before changing shit" | ≤2026-10-25 | **NEW** (CLAUDE.md) |
| P8 | Keep messages short: bottom lines, the one ask at the top, a working staging link | Long reports | (he) "that was a bit long-winded, I need it in bottom lines" | 2026-11-14 | Before-showing (partly) |
| P9 | Give exact links and exact names (tokens, payment pages) | Making him search | "send me a link, don't get me searching myself"; "give EXPLICIT TOKEN NAMES ALWAYS DONT SEND ME GUESSING" | 2026-11-14, ≤2026-10-25 | **NEW** (CLAUDE.md) |
| P10 | Drop a direction that looks bad at once | Pursuing a rejected look (a homemade voxel splitter) | "Don't pursue this direction. It looks really, really bad." | 2026-11-14 | **NEW** |
