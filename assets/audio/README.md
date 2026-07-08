# `assets/audio/` — runtime audio + MIDI source files

## What ships to the browser

Three MP3s, plus a soundfont and the source MIDIs.

| File | Size | Role |
|---|---|---|
| `intro_theme.mp3` | 2.0 MB | Intro scene music. No MIDI source — this was synthesized directly from Python (FM, 17 SC-55 channels). |
| `alley_confrontation.mp3` | 1.0 MB | Alley scene music. Pre-rendered from `alley_confrontation.mid`. |
| `alley_confrontation.mid` | 2.4 KB | **Source MIDI** for the alley scene. Re-render with `tools/render-midi.sh` to refresh the MP3. |
| `clinic_tension.mp3` | 1.8 MB | Clinic scene music. Pre-rendered from `clinic_tension.mid`. |
| `clinic_tension.mid` | 2.5 KB | **Source MIDI** for the clinic scene. Re-render with `tools/render-midi.sh` to refresh the MP3. |
| `sc55.sf2` | 307 KB | **VintageDreamsWaves-v2** General MIDI soundfont. Used by FluidSynth for all renders. Not used by the browser at runtime. |

The soundfont is bundled so anyone (any dev machine) can re-render the MIDIs
without needing to download a separate SF2 from the Homebrew fluid-synth formula.

## Why pre-render MIDIs at all?

The MIDI files are the **source of truth** for the compositions, but the
browser can't play them directly — it has no built-in synthesizer. We have
three options:

### Option A (current): Pre-render MIDI → MP3 via FluidSynth

- **Tool:** `tools/render-midi.sh` (calls `fluidsynth` + `ffmpeg`).
- **Runtime cost:** Plain MP3. The runtime's `MusicHandler` plays it via `HTMLAudioElement` with manual volume ramps for crossfading.
- **Pros:** Simple runtime, autoplay-friendly, no extra JS dependency,
  predictable timing, supports `loop` and `seek` natively.
- **Cons:** ~2 MB of audio per scene regardless of length. Loses
  per-channel control (can't mute drums, transpose at runtime, etc).
  Each MIDI edit requires a rebuild.

### Option B (future, runtime MIDI synth in the browser)

- **Tools:** A JS library like [`smplr`](https://github.com/danigb/smplr)
  or [`soundfont-player`](https://github.com/danigb/soundfont-player)
  (~20-50 KB minified) reads the SF2 and synthesizes samples in real-time
  using Web Audio.
- **Runtime cost:** Soundfont (~300 KB SF2 or ~150 KB compressed DLS) + lib.
- **Pros:** Real-time tempo / pitch / channel control. The MIDIs become
  live data, not baked audio. Ink tags like `# midi_play:clinic_tension`
  can mute Ch10 drums on choices, layer effects, duck for SFX, etc.
- **Cons:** MIDI libraries each have their own quirks (sample loading
  latency, missing features). Web Audio still requires a user gesture
  for the first playback. Slightly heavier cold-start.

### Option C (future, Web MIDI + OS synth)

- **Tool:** Browser `navigator.requestMIDIAccess()` + `Web Audio` API.
- **Runtime cost:** Just the JS code; the browser uses whatever soundfont
  the OS has installed.
- **Pros:** Zero audio asset size. Lowest possible payload.
- **Cons:** Requires user-installed synth (e.g. `VirtualMidiSynth`,
  `CoolSoft VirtualMIDISynth` on Windows; `FluidSynth` + `JACK` on Linux;
  nothing built-in on macOS). Almost certainly **not viable** for
  shipping a public web build — too many broken environments. Useful
  only for desktop-specific deployments (Electron, Steam, etc).

## Recommendation

**Stay on Option A for v1.** It matches what the previous attempt
did (cached FluidSynth-rendered MP3s at build time and shipped
the cached audio for runtime playback), the music already sounds
correct in the browser, and we don't yet have Ink scenes that
need live music control.

**Move to Option B when** any of these becomes true:
- A scene needs `loop` with a beat-aligned seam (FluidSynth gets free
  perfect loops; MP3s need a re-encode with `-af aloop`).
- A scene needs to react to dialogue — e.g. duck the music during tense
  lines, mute drums on a choice screen, switch patches for a flashback.
- We want to ship `studio` builds without committing WAV masters (the
  SF2 is smaller than a full MP3 library).

**Move to Option C only if** we ship a desktop-specific build and accept
that macOS users won't hear anything without third-party setup.

## Re-rendering

```bash
./tools/render-midi.sh                # render all *.mid in assets/audio/
./tools/render-midi.sh one/track.mid  # render one file
```

Requires `fluidsynth` (Homebrew: `brew install fluid-synth`) and
`ffmpeg` (`brew install ffmpeg`).

## Provenance

- `alley_confrontation.mid` / `clinic_tension.mid` — sourced from the
  previous attempt's audio assets at `~/ghost-process/audio/`.
  Originally composed with the SC-55-style patch list (channel 10
  drums, CC#91 reverb, CC#1 modulation).
- `sc55.sf2` — `VintageDreamsWaves-v2.sf2` from the Homebrew
  `fluid-synth` formula. General MIDI compatible, free for any use.
  **Not** a true Roland SC-55 ROM; we use it as a stand-in. For
  authentic SC-55/CM-500/CM-64 tone, swap in a licensed SC-55
  SoundFont (e.g. from the SC-55 module's own ROM dump) — the
  render script needs no changes.
- `intro_theme.mp3` — synthesized directly from
  `~/salientdream/scripts/generate_title_theme.py` (FM synthesis, 17
  SC-55 channels, 108 BPM, 40 bars). Rendered to WAV → MP3 via ffmpeg.
  No MIDI exists for this track because it's a continuous FM
  composition, not a discrete-note score.