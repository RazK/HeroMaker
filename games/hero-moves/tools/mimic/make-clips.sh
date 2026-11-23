#!/usr/bin/env bash
# Child clip + hero frames -> the landing's web files (docs/content/README.md).
#   make-clips.sh child.mp4 heroFramesDir fps outDir name
set -euo pipefail
child=$1 frames=$2 fps=$3 out=$4 name=$5
mkdir -p "$out"
cream='0xfff6e9'
# Side by side: the child, an 8px cream gutter, the hero. Both columns 9:13.
pair="[0:v]scale=560:832,setsar=1[a];[1:v]scale=560:832,setsar=1[b];[a]pad=568:832:0:0:color=$cream[a2];[a2][b]hstack"
for cut in desktop:960 phone:640; do
  tag=${cut%%:*} w=${cut##*:}
  ffmpeg -v error -y -i "$child" -framerate "$fps" -i "$frames/%04d.png" -filter_complex "$pair,scale=$w:-2,format=yuv420p" \
    -an -c:v libx264 -profile:v high -crf 26 -preset slow -movflags +faststart "$out/$name-$tag.mp4"
  ffmpeg -v error -y -i "$child" -framerate "$fps" -i "$frames/%04d.png" -filter_complex "$pair,scale=$w:-2,format=yuv420p" \
    -an -c:v libvpx-vp9 -b:v 0 -crf 38 -row-mt 1 "$out/$name-$tag.webm"
done
ffmpeg -v error -y -i "$child" -framerate "$fps" -i "$frames/%04d.png" -filter_complex "$pair,select='eq(n\,40)',scale=960:-2" -frames:v 1 -q:v 3 "$out/$name-poster.jpg"
# The hero alone, for a layout that shows them apart.
ffmpeg -v error -y -framerate "$fps" -i "$frames/%04d.png" -vf "scale=480:-2,format=yuv420p" -an -c:v libx264 -crf 26 -preset slow -movflags +faststart "$out/$name-hero.mp4"
ffmpeg -v error -y -framerate "$fps" -i "$frames/%04d.png" -vf "scale=480:-2,format=yuv420p" -an -c:v libvpx-vp9 -b:v 0 -crf 38 -row-mt 1 "$out/$name-hero.webm"
ls -la "$out" | grep "$name"
