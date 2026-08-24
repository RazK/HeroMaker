# HERO DASH — implementation brief

## Why this game

The HeroMaker pipeline turns a kid's drawing into a **rigged VRM 0.0 humanoid**:
22 human bones (hips → toes, including shoulders and both toe bones), height
normalized to 1.7 m, feet near y=0, T-pose rest, one PBR material, ~30k tris,
**no fingers and no blendshapes**. The showcase therefore has to live entirely
in *full-body motion and silhouette* — never in facial performance or hand detail.

The proportions vary wildly between avatars, because they are drawings: some
heroes are 30% head, some are a star with two legs, one is a cloud. Anything
that relies on realistic proportions (IK chains tuned to human ratios, motion
captured clips retargeted by bone length) will look broken on half the roster.
Anything driven by **normalized-rig local rotations** looks intentional on all
of them. That single fact drives every decision below.

## The pick: a 3-lane endless runner where the rig *is* the mechanic

Endless runners are the most reliably addictive kid-facing genre there is
(Subway Surfers, Temple Run), they generate infinite content procedurally, and
score-chasing maps directly onto a leaderboard. But a plain runner shows you
the back of a character's head, which wastes the asset.

So the hook: **pose gates**. Walls come at you with a hero-shaped hole in them,
and you have to put your hero into that shape to pass — jump, slide, or throw a
star pose. Every core input triggers a distinct whole-body animation, which
means the thing the player is doing *is* the thing that shows off the rig. It
also makes the optional webcam mode a native fit rather than a gimmick bolted
on: in Hero Cam you strike the pose with your actual body.

## Loop

Run forward, speed ramping 9 → 22 m/s. Switch lanes for stars, jump/slide/pose
through obstacles and gates. Stars and clean gates build a Hero Power meter;
full meter triggers **Hero Time** — the avatar goes into a flying superhero pose,
the camera swings around to a heroic front three-quarter angle, everything is
magnetised and invincible for ~6 s. Three crashes ends the run; the hero lands
in a victory pose for the score screen.

## Animation set (all procedural, all normalized-rig local rotations)

`idle`, `run`, `jump`, `fall`, `land`, `slide`, `starPose`, `stumble`, `fly`,
`victory`, plus an additive lane-lean and additive head-stabilisation. Blended
with per-bone weights and cross-faded on state change. Zero animation assets,
so nothing to download and nothing that can retarget badly.

## Art direction: the Crayon Kingdom

The hero came out of a drawing, so the world is a drawing too — paper-grain sky,
crayon-coloured hills, wobbly hand-drawn trees, a paper road with dashed lane
lines. Props get a two-frame "boil" jitter, the trick 2D animators use to make a
drawing look alive. It is cheap, it is charming, and it frames the avatar as the
one *solid* thing in a sketched world.

## Controls

| Action | Keyboard | Touch | Hero Cam |
|---|---|---|---|
| Change lane | ← → / A D | swipe ←/→ | lean left/right |
| Jump | ↑ / W / Space | swipe ↑ | jump / raise both arms |
| Slide | ↓ / S | swipe ↓ | crouch |
| Star pose | Shift / E | tap | arms and legs out |

## Scope decisions

- **Standalone app** at `games/hero-dash`, not wired into the HeroMaker frontend.
- **Single-player + Hall of Fame.** Local board always; posting to the shared
  board is an explicit button, because publishing reloads every open viewer.
- **Avatars are baked in** from the live production gallery, optimized 5.5 MB →
  ~1.1 MB each by dropping the unused VRM meta thumbnail, re-encoding the
  texture as WebP, and packing skin attributes to the smallest core-spec types.
- **Hero Cam** (webcam pose) is the bonus mode and degrades gracefully: it needs
  a pose model from a CDN, which the published-artifact sandbox blocks, so it is
  enabled in the local/dev build and disabled with an explanation in the artifact.
- **No audio assets** — all SFX and music are synthesised in WebAudio at runtime.

## Risks and how they were retired

| Risk | Status |
|---|---|
| Do production VRMs load in three-vrm at all? | Retired — 22/22 normalized bones, spring bones present, renders correctly. |
| Do wild proportions break animation? | Retired by design — normalized-rig rotations only. |
| Are 5 MB avatars shippable in one page? | Retired — optimizer gets them to ~1.1 MB with no visible loss. |
| Do some avatars float or sink? | Real — several have feet above y=0. Fixed by measuring the bounding box at load and grounding each avatar. |
| Mocap in the published sandbox | Accepted — CDN is blocked there; mode degrades with a clear message. |
