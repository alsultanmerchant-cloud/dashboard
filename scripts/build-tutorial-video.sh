#!/usr/bin/env bash
# Combine a screen recording with the voiceover track into a final tutorial MP4.
#
# Workflow:
#   1. Record your screen with Cap (or QuickTime). Save as ./recording.mov (or .mp4)
#      Make the recording at LEAST as long as ./tutorial-audio/voiceover.mp3.
#   2. Run scripts/build-voiceover-track.sh first if you haven't already.
#   3. Run this script.
#
# Usage:
#   bash scripts/build-tutorial-video.sh                    # uses ./recording.mov
#   bash scripts/build-tutorial-video.sh path/to/clip.mov   # explicit input
#
# Output: ./tutorial-projects-page.mp4

set -euo pipefail

INPUT="${1:-./recording.mov}"
VOICE="${VOICE:-./tutorial-audio/voiceover.mp3}"
OUT="${OUT:-./tutorial-projects-page.mp4}"
KEEP_ORIGINAL_AUDIO="${KEEP_ORIGINAL_AUDIO:-0}"   # 1 = mix recording audio under voiceover
ORIGINAL_AUDIO_DB="${ORIGINAL_AUDIO_DB:-(-18)}"   # how much to attenuate original audio (dB)

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "✗ ffmpeg not found. Install: brew install ffmpeg" >&2
  exit 1
fi

if [[ ! -f "$INPUT" ]]; then
  # Try common alternate extensions
  for ext in mov mp4 m4v mkv webm; do
    if [[ -f "./recording.$ext" ]]; then INPUT="./recording.$ext"; break; fi
  done
fi

if [[ ! -f "$INPUT" ]]; then
  echo "✗ Screen recording not found at $INPUT" >&2
  echo "  Save your Cap/QuickTime recording as ./recording.mov (or .mp4) at the repo root." >&2
  exit 1
fi

if [[ ! -f "$VOICE" ]]; then
  echo "✗ Voiceover not found at $VOICE" >&2
  echo "  Run: bash scripts/build-voiceover-track.sh" >&2
  exit 1
fi

VIDEO_DUR=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$INPUT")
AUDIO_DUR=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$VOICE")

printf "Input video:    %s (%.1fs)\n" "$INPUT" "$VIDEO_DUR"
printf "Voiceover:      %s (%.1fs)\n" "$VOICE" "$AUDIO_DUR"

# Warn if video is shorter than audio
if awk "BEGIN{exit !($VIDEO_DUR + 0.5 < $AUDIO_DUR)}"; then
  echo
  echo "⚠️  Your screen recording is shorter than the voiceover."
  echo "   Audio will be trimmed to match the video length."
  echo "   For best results, re-record so the video is ≥ ${AUDIO_DUR%.*}s."
  echo
fi

echo "→ Encoding final video…"

if [[ "$KEEP_ORIGINAL_AUDIO" == "1" ]]; then
  # Mix original audio (attenuated) under the voiceover
  ffmpeg -y -loglevel error -stats \
    -i "$INPUT" \
    -i "$VOICE" \
    -filter_complex "[0:a]volume=${ORIGINAL_AUDIO_DB}dB[a0];[a0][1:a]amix=inputs=2:duration=shortest:dropout_transition=0[aout]" \
    -map 0:v -map "[aout]" \
    -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p \
    -c:a aac -b:a 192k \
    -movflags +faststart \
    -shortest \
    "$OUT"
else
  # Replace audio entirely with the voiceover
  ffmpeg -y -loglevel error -stats \
    -i "$INPUT" \
    -i "$VOICE" \
    -map 0:v -map 1:a \
    -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p \
    -c:a aac -b:a 192k \
    -movflags +faststart \
    -shortest \
    "$OUT"
fi

OUT_DUR=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$OUT")
SIZE=$(du -h "$OUT" | cut -f1)
printf "\n✓ %s (%s, %.1fs)\n" "$OUT" "$SIZE" "$OUT_DUR"
echo "  Open it: open \"$OUT\""
