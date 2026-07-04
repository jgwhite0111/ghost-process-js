#!/usr/bin/env bash
# tools/render-midi.sh — render MIDI files to MP3 via FluidSynth + bundled soundfont.
#
# Usage:
#   ./tools/render-midi.sh                    # render all assets/audio/*.mid
#   ./tools/render-midi.sh path/to/track.mid  # render one specific file
#
# Requires:
#   - fluidsynth  (brew install fluid-synth)
#   - ffmpeg      (brew install ffmpeg)
#
# Output: overwrites the .mp3 next to each .mid with a fresh fluidsynth render.
# Default soundfont: assets/audio/sc55.sf2 (VintageDreamsWaves-v2 GM clone).
#
# Why pre-render? Browser autoplay policies + JS MIDI libraries each have
# their own quirks. Pre-rendering through FluidSynth gives us a
# deterministic, retro Roland SC-55-style tone that ships as a plain
# MP3 — Phaser plays it like any other audio asset. The MIDI files stay
# in the repo as source-of-truth for the compositions.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
SOUNDFONT="${ROOT_DIR}/assets/audio/sc55.sf2"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

if [[ ! -f "$SOUNDFONT" ]]; then
    echo "ERROR: soundfont not found at $SOUNDFONT" >&2
    echo "       Copy VintageDreamsWaves-v2.sf2 from the fluid-synth Homebrew formula" >&2
    echo "       or supply your own GM-compatible .sf2 and rerun." >&2
    exit 1
fi

# Trailing-silence trim: stop when output stays under -50dB for at least 1.0s.
# This matches the existing intro_theme.mp3 loop length convention.
SILENCE_FILTER='silenceremove=stop_periods=-1:stop_duration=1.0:stop_threshold=-50dB'

render_one() {
    local mid="$1"
    local stem="${mid%.mid}"
    local wav="${TMP_DIR}/$(basename "$stem").wav"
    local mp3="${stem}.mp3"

    echo "==> ${stem}"
    fluidsynth -F "$wav" -q "$SOUNDFONT" "$mid" >/dev/null
    ffmpeg -y -loglevel error -i "$wav" \
        -af "$SILENCE_FILTER" \
        -codec:a libmp3lame -b:a 192k -ar 44100 \
        "$mp3"
    echo "    wrote $(ls -lh "$mp3" | awk '{print $5}')"
}

if [[ $# -eq 0 ]]; then
    shopt -s nullglob
    mid_files=("${ROOT_DIR}"/assets/audio/*.mid)
    if [[ ${#mid_files[@]} -eq 0 ]]; then
        echo "No .mid files in ${ROOT_DIR}/assets/audio/ — nothing to render."
        exit 0
    fi
    for mid in "${mid_files[@]}"; do
        render_one "$mid"
    done
else
    for mid in "$@"; do
        [[ -f "$mid" ]] || { echo "ERROR: $mid not found" >&2; exit 1; }
        render_one "$mid"
    done
fi

echo "Done. Re-run after editing any .mid source to refresh its .mp3."