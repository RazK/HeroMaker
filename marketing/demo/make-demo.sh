#!/usr/bin/env bash
# A team demo video, Raz's format: a full-screen caption slide, then the real
# screen recording of that step at REAL speed (trimmed, never sped up), <=30 s.
#
#   make-demo.sh <robot demo.webm> <cut.json> out.mp4 "<start>:<dur>" ...
#
# The robot's DEMO=1 run (e2e/staging-robot.mjs) leaves demo.webm and
# marks.json in its CI artifact "staging-robot". Find each step's seconds by the
# coloured mark in the video's corner (see docs/content/README.md, "Demo
# videos"), then give one "<start>:<dur>" per clip, in order: c1, c2, ...
# cut.json names those clips (assets/c1 ...) after a slide each.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
video=$1 cut=$2 out=$3; shift 3
work=$(mktemp -d)
cp "$cut" "$work/cut.json"
i=1
for r in "$@"; do
  mkdir -p "$work/c$i"
  ffmpeg -v error -y -ss "${r%%:*}" -t "${r##*:}" -i "$video" -vf fps=24 "$work/c$i/%04d.png"
  i=$((i + 1))
done
cd "$here/../../games/hero-moves"
node tools/film-record.mjs "$work" "$out"
