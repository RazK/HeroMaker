#!/usr/bin/env bash
# Turn the robot's raw demo recording into a watchable MP4: the few minutes the
# pipeline spends at OpenAI and Meshy play 12x faster (the captions say so),
# everything a person does plays in real time.
#
#   e2e/cut-demo.sh e2e/out     # reads demo.webm + marks.json, writes demo.mp4
set -euo pipefail
OUT="${1:-e2e/out}"
IN="$OUT/demo.webm"
A=$(jq -r '.pipeline_start // empty' "$OUT/marks.json")
B=$(jq -r '.pipeline_end // empty' "$OUT/marks.json")
ENC=(-c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p -movflags +faststart -an)
if [ -n "$A" ] && [ -n "$B" ]; then
  ffmpeg -y -loglevel error -i "$IN" -filter_complex \
    "[0:v]trim=0:${A},setpts=PTS-STARTPTS[a];\
     [0:v]trim=${A}:${B},setpts=(PTS-STARTPTS)/12[b];\
     [0:v]trim=start=${B},setpts=PTS-STARTPTS[c];\
     [a][b][c]concat=n=3:v=1[v]" -map "[v]" "${ENC[@]}" "$OUT/demo.mp4"
else
  ffmpeg -y -loglevel error -i "$IN" "${ENC[@]}" "$OUT/demo.mp4"
fi
echo "demo.mp4: $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/demo.mp4" | cut -d. -f1)s, $(du -h "$OUT/demo.mp4" | cut -f1)"
