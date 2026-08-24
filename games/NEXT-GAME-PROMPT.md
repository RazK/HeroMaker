# Prompt: build the face-forward HeroMaker game

Paste everything below the line as a single message.

---

You are a senior game developer and technical director. You know the history of
the medium — arcade, console, mobile, web, motion games — and you pick genres
for structural reasons, not fashion.

## The job

Build a **Just Dance–style game** starring the rigged VRM avatars the HeroMaker
pipeline generates from kids' drawings: the game shows the player a move, the
player performs it, the avatar performs it, the player is scored. Ship it as a
standalone app in `games/` and as a published, playable artifact link.

Read `games/PLAYBOOK.md` first. It records what worked when building the last
game, what went wrong, and the asset and publishing constraints that are already
established — do not spend time re-deriving them. Read `games/README.md` for
what to reuse from `games/hero-dash` rather than rewrite: the VRM optimizer, the
CSP-safe loader, the rotation-only animation system and its documented axis
conventions, the model-free webcam body tracking, and the whole test harness set.

**Do not modify or delete `games/hero-dash`.** It is parked, not dead.

## Why this genre

The last game was an endless runner. It was finished, polished and fun, and it
was the wrong choice: the chase camera showed the avatar's *back* for almost the
whole run, and the back is the half the pipeline extrapolates. A child draws a
face, an emblem, a colour scheme — the front. A dance game points the camera at
the front for one hundred percent of the play time, and it makes full-body
motion the entire mechanic, which is exactly what a 22-bone rig with no face and
no fingers is good at.

## Hard gates

These are pass/fail, in order. Do not proceed past one that has not passed.

**1. Face-time gate — before writing gameplay code.** Produce a still of the
actual play camera framing a real production avatar, as the player will see it,
and show it to me. If the avatar's face and chest are not the clear subject of
that frame, change the framing or the concept before continuing. Then keep it
honest: instrument the running game to measure what fraction of play time the
camera is within a front-facing arc of the avatar, and report the number. It
should be ≥ 90%.

**2. Concept gate — before building the whole thing.** Once the framing is
settled, get the core loop playable in its crudest form and show me *that*
before polishing anything. One move, one avatar, real scoring. I would rather
redirect a rough thing than admire a finished wrong thing.

**3. Environment gate — before the first publish.** Stand up the CSP simulator
and the viewport matrix from `hero-dash/tools` and keep them green from the
start. Both of the last game's user-visible failures came from testing somewhere
easier than production.

**4. Design gate — before showing me anything.** Review it as a senior designer
would, and fix what you find *before* it reaches me:
- one spacing system, applied consistently — no per-element margins fighting
- optical alignment: edges line up, nothing is orphaned or ragged
- a real type scale and hierarchy; tabular figures wherever numbers align
- no control at a random width, no default-looking anything
- every screen fits without internal scrolling at every size in the matrix,
  including the ~385x560 the artifact viewer actually grants a phone
- a considered palette and motion, not decoration
Assume I will judge it on whether it looks like an experienced designer made it.

**5. Evidence gate — before saying it is done.** Every claim is backed by a
harness that prints a number, not by your impression. Build new harnesses where
the existing ones do not cover a claim, in the same style.

## Process

**Ask me a lot of questions first.** Batch them; give each a recommended default
and say why. Cover at least: how moves are authored and where the music comes
from given that nothing can be fetched at runtime; whether scoring is webcam
body tracking, timed inputs, or both, and what happens when the camera is
refused; single-player versus a pass-the-device party mode; how many avatars are
on stage at once; session length and difficulty progression; what "winning"
looks like; and which of my constraints you think are wrong. Do not start
building until I have answered.

Then research and de-risk before committing: the riskiest unknown gets a
throwaway probe and a screenshot on day one, exactly as `PLAYBOOK.md` describes.
Write a short brief naming the concept, the loop, and the risks — and treat any
risk you can state in one sentence as a decision to make now, not a to-do to
mitigate later.

Then build it. Look at screenshots constantly. Turn every bug into a harness.

## Definition of done

Come back to me only when all of this is true, and not before:

- a published artifact link I can play immediately on a phone and on a desktop
- screenshots you have already looked at and iterated on, covering every screen
  and every state of the avatar
- real production avatars from the live gallery, not placeholders
- the face-time number, measured and reported
- all gates above passed, with the harness output that proves it
- committed and pushed, with the reasoning in the repo the way `hero-dash` has it

Report plainly what you did not verify and what you are unsure about. If you
conclude mid-build that this genre is also wrong for the asset, stop and tell me
why rather than building it anyway — that is the lesson from last time.
