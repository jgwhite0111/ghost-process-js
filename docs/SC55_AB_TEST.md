# SC-55mkII Soundfont A/B Test — Plan

## Status
**DEFERRED.** The current build uses
[`sc55.sf2`](../../assets/audio/sc55.sf2) (a copy of
`VintageDreamsWaves-v2.sf2`, a generic General MIDI wavetable) as a
stand-in for the SC-55 tone. It sounds "80s/90s-ish" but is **not** a
real SC-55 sound bank — see `assets/audio/README.md` § Provenance.

The user (born 1985, late-PC-98 era nostalgia) is happy with the
current sound and does not want this changed yet. This document is a
recipe for the future A/B test, not a TODO being executed now.

## Why SC-55mkII, not SC-55 or SC-88

- **SC-55** (1991) is the canonical "Sound Canvas" reference. Most
  late-PC-98 games were tested against it.
- **SC-55mkII** (1993) is a modest refresh: more polyphony, more
  drum kits, slightly cleaner samples. Fully backwards-compatible
  with SC-55.
- **SC-88 / SC-88Pro** (1994) is the GS successor with even more
  voices and more detailed samples. Cleanest of the three, but the
  sound moves away from the gritty 1992-1994 PC-98 era aesthetic and
  into the Windows-95 era.

For a game with a late-PC-98 / early-Windows-95 vibe, **SC-55mkII is
the sweet spot** — period-appropriate, widely supported by free
soundfonts, more refined than the original SC-55.

## Soundfont options (no hardware required)

Free SF2 banks that approximate the SC-55 / SC-55mkII. All are
FluidSynth-compatible. Listed roughly small→large.

| # | Source | Size | Notes |
|---|---|---|---|
| 1 | [nitro-shoe/sc-55-soundfont](https://github.com/nitro-shoe/sc-55-soundfont) | ~8 MB | Lightweight, single-pack. Good first try. |
| 2 | [Trevor0402/SC-55-SoundFont](https://archive.org/details/trevor-0402-sc-55-sf2) | ~140 MB | Praised by LGR. The community favourite. |
| 3 | Patch93's SC-55 ([musical-artifacts.com](https://musical-artifacts.com/artifacts/1228)) | ~50 MB | "Lacks GS support" — drum kits may be incomplete. |
| 4 | Kitrinx/SC55_Soundfont | n/a | **Not a soundfont — a converter** that needs real SC-55 ROMs. Not free (you supply the ROM). |

**Recommendation for the A/B test**: start with **#1 (nitro-shoe)** to
verify the workflow works end-to-end, then try **#2 (Trevor0402)** for
the higher-quality comparison.

## The A/B test workflow

1. **Back up the current font** so we can restore the VintageDreams
   baseline if needed:
   ```bash
   cp assets/audio/sc55.sf2 assets/audio/sc55_vintagedreams_baseline.sf2
   ```

2. **Download a real SC-55 soundfont** and place it at
   `assets/audio/sc55.sf2` (same path the render script reads):
   ```bash
   # Option A — nitro-shoe (8MB, quick test)
   curl -L -o assets/audio/sc55.sf2 \
     https://github.com/nitro-shoe/sc-55-soundfont/releases/latest/download/sc-55.sf2

   # Option B — Trevor0402 (140MB, higher quality)
   curl -L -o /tmp/trevor0402-sc55.sf2 \
     https://archive.org/download/trevor-0402-sc-55-sf2/Trevor0402-SC55.sf2
   mv /tmp/trevor0402-sc55.sf2 assets/audio/sc55.sf2
   ```

3. **Re-render all the MP3s** with the new font:
   ```bash
   ./tools/render-midi.sh
   ```
   This overwrites the existing `*.mp3` files. The `*.mid` sources
   are untouched.

4. **Listen in-game** by walking the 10 scenes. Compare against the
   baseline by:
   ```bash
   # Save the new MP3s
   mkdir -p /tmp/sc55_real_renders
   cp assets/audio/*.mp3 /tmp/sc55_real_renders/

   # Restore the baseline MP3s (the pre-A/B versions, if you kept
   # them in git)
   git checkout HEAD -- assets/audio/*.mp3

   # After listening, restore the new renders to continue testing
   cp /tmp/sc55_real_renders/*.mp3 assets/audio/
   ```

5. **Per-scene comparison checklist** — for each scene, note:
   - Does the "monotonous whoosh" (terminal_lab ch2 Goblins, ship_engine
     ch2 Brightness) sound better, worse, or the same?
   - Are the drum kits recognizably SC-55 (specific 90s character) or
     still generic-GM?
   - Does any track now sound *worse* than the VintageDreams baseline?
     (Yes, this happens — some soundfonts are weaker in certain
     patches.)
   - Does the reverb (CC#91) sound natural on the new font?
   - Overall: closer to the era you remember, or further away?

6. **Decide**:
   - **Keep the new font** → commit the new `sc55.sf2` and the
     re-rendered MP3s. Update `assets/audio/README.md` to reflect the
     new provenance.
   - **Mixed** → cherry-pick per scene, or use the new font for some
     scenes and keep the VintageDreams render for others. The
     render script renders ALL files, so this needs script changes
     (per-file font override) — non-trivial.
   - **Revert** → `cp assets/audio/sc55_vintagedreams_baseline.sf2
     assets/audio/sc55.sf2 && git checkout HEAD -- assets/audio/*.mp3`.

## Non-trivial concerns

- **Git size**: a 140MB soundfont added to a repo is significant.
  Options: use Git LFS, or keep the soundfont un-tracked and
  document where to download it (similar to how the font is currently
  bundled in the repo at 307KB).
- **License**: nitro-shoe and Trevor0402 are community-made. Check
  their licenses before committing. Most are CC-BY-SA or similar
  share-alike; if the project has a license that conflicts, don't
  commit the font.
- **Per-file font selection**: the render script picks ONE font for
  all MIDIs. If the A/B shows that some scenes work better with
  VintageDreams and some with SC-55mkII, the script needs a font
  override per file. Add a `font:` field to a per-scene config, or
  a sidecar JSON, or a comment-based font tag in the MIDI filename.

## Related files

- `assets/audio/README.md` § Provenance — current honest description
  of the font stand-in.
- `tools/render-midi.sh` — the render script. One-line change to
  point at a different font path.
- `AI-HANDOFF.md` — project handoff doc. Reference to this file
  added there so future sessions see the plan.
