# 7 · Load time, before and after (staging, real speed)

Raw screen recordings of a **cold load** (empty cache) on a phone network
(Chrome throttled to 9 Mbps down, 1.5 up, 150 ms latency), 390x844, real speed,
on staging. Recorded with `rec.js`; numbers from `ttv.js`.

| clip | build | what | this recording | median of 5 runs |
|---|---|---|---|---|
| before-gallery.webm | v2.0.260 · d323ef0 | gallery until its first screen of pictures has loaded | 3.1 s | 3.4 s, 2.56 MB |
| after-gallery.webm | v2.0.262 · 05fbcfa | same | **2.4 s** | **2.9 s, 2.03 MB** |
| before-hero.webm | v2.0.260 · d323ef0 | a hero's page until the live 3D hero has its moves | 8.6 s | 7.9 s, 3.84 MB |
| after-hero.webm | v2.0.262 · 05fbcfa | same | 8.8 s | 7.0 s, **2.80 MB** |

**What changed (2026-11-26):** the header logo was the 537 KB app icon, now a
9 KB picture (#384); the move clips carried channels for bones our heroes don't
have, now 58% smaller (#383).

**The hero clips do not show a speed-up, and must not be captioned as faster.**
On the recording machine the 3D is drawn by the CPU (no graphics chip): that
alone takes ~7.6 s even with no network limit, and it hides the download. The
hero's real win is **1 MB less to download** (3.84 → 2.80 MB, −27%), about
0.9 s less on 4G on a phone that draws 3D on its GPU.
