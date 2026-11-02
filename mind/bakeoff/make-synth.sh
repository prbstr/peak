#!/usr/bin/env bash
# Speak phrases.txt with the macOS voice into bakeoff/clips/synth-NN.wav, padded like hearing.js cuts them (0.3 s lead, 0.7 s tail).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p clips
T=$(mktemp -d)
ffmpeg -loglevel error -y -f lavfi -i anullsrc=r=16000:cl=mono -t 0.3 "$T/pre.wav"
ffmpeg -loglevel error -y -f lavfi -i anullsrc=r=16000:cl=mono -t 0.7 "$T/post.wav"
i=0
while IFS= read -r line; do
  [ -z "$line" ] && continue
  i=$((i + 1))
  say -o "$T/say.aiff" "$line"
  ffmpeg -loglevel error -y -i "$T/say.aiff" -ar 16000 -ac 1 "$T/say.wav"
  ffmpeg -loglevel error -y -i "$T/pre.wav" -i "$T/say.wav" -i "$T/post.wav" -filter_complex '[0][1][2]concat=n=3:v=0:a=1' "$(printf 'clips/synth-%02d.wav' "$i")"
done < phrases.txt
rm -rf "$T"
echo "$i clips in $(pwd)/clips"
