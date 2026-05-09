#!/usr/bin/env bash
# Concatenate the 11 scene MP3s into one voiceover.mp3 with small silence gaps.
#
# Usage:  bash scripts/build-voiceover-track.sh
# Output: ./tutorial-audio/voiceover.mp3
#
# Tunables:
#   GAP_SECONDS  silence between scenes (default 0.8)
#   INTRO_SILENCE  silence before scene 1 (default 1.0, gives the visual a moment to land)
#   OUTRO_SILENCE  silence after scene 11 (default 1.5)

set -euo pipefail

AUDIO_DIR="${AUDIO_DIR:-./tutorial-audio}"
OUT="$AUDIO_DIR/voiceover.mp3"
GAP_SECONDS="${GAP_SECONDS:-0.8}"
INTRO_SILENCE="${INTRO_SILENCE:-1.0}"
OUTRO_SILENCE="${OUTRO_SILENCE:-1.5}"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "✗ ffmpeg not found. Install: brew install ffmpeg" >&2
  exit 1
fi

# Generate silence files at correct sample rate
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

ffmpeg -y -loglevel error -f lavfi -i "anullsrc=r=44100:cl=mono" -t "$GAP_SECONDS"   -c:a libmp3lame -b:a 128k "$TMPDIR/gap.mp3"
ffmpeg -y -loglevel error -f lavfi -i "anullsrc=r=44100:cl=mono" -t "$INTRO_SILENCE" -c:a libmp3lame -b:a 128k "$TMPDIR/intro.mp3"
ffmpeg -y -loglevel error -f lavfi -i "anullsrc=r=44100:cl=mono" -t "$OUTRO_SILENCE" -c:a libmp3lame -b:a 128k "$TMPDIR/outro.mp3"

# Build the concat list
LIST="$TMPDIR/list.txt"
{
  echo "file '$TMPDIR/intro.mp3'"
  for i in $(seq -w 01 11); do
    f="$AUDIO_DIR/scene-$i.mp3"
    if [[ ! -f "$f" ]]; then
      echo "✗ missing $f — run scripts/generate-tutorial-audio.sh first" >&2
      exit 1
    fi
    abs=$(cd "$(dirname "$f")" && pwd)/$(basename "$f")
    echo "file '$abs'"
    if [[ "$i" != "11" ]]; then
      echo "file '$TMPDIR/gap.mp3'"
    fi
  done
  echo "file '$TMPDIR/outro.mp3'"
} > "$LIST"

ffmpeg -y -loglevel error -f concat -safe 0 -i "$LIST" -c:a libmp3lame -b:a 192k "$OUT"

DURATION=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$OUT")
SIZE=$(du -h "$OUT" | cut -f1)
printf "\n✓ %s built (%s, %.1fs)\n" "$OUT" "$SIZE" "$DURATION"
echo "  Aim for your screen recording to be ≥ ${DURATION%.*}s"
