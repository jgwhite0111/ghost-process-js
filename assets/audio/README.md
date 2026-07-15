# `assets/audio/` — runtime audio + MIDI source files

## What ships to the browser

MP3s, source MIDIs, and a soundfont for re-rendering.

| File | Role |
|---|---|
| `intro_theme.mp3` | Intro scene music. No MIDI source — synthesized directly from FM (17 SC-55 channels). |
| `<stem>.mp3` + `<stem>_{b,c,d,e}.mp3` | Ordered A→B→C→D→E medley tracks for each of the 9 gameplay scenes (`cold_open`, `alley`, `chase`, `corridor`, `jailbreak`, `kabukicho`, `corp_office`, `terminal_lab`, `ship_engine`). Filenames are wired explicitly in `story.json`; the alley stem is `alley_confrontation`. |
| `<stem>.mid` + `<stem>_{b,c,d,e}.mid` | Matching source MIDI for the 45 runtime medley tracks. Re-render with `tools/render-midi.sh`. |
| `clinic_tension.{mp3,mid}` | Orphan pair — not wired into `story.json`. Kept for archival. |
| `smoky_club_intro.{mp3,mid}` | Orphan pair — single-track idea that didn't land. |
| `sc55.sf2` | General MIDI soundfont (VintageDreamsWaves-v2). Used by FluidSynth for re-renders. Not loaded by the browser at runtime. |

48 MP3s + 47 MIDIs on disk total. `story.json` wires 46 MP3s: the solo intro plus 45 gameplay-medley tracks.

## Why pre-render MIDIs

The browser has no built-in MIDI synth. Options:

### Option A (current): pre-render MIDI → MP3 via FluidSynth

- **Tool:** `tools/render-midi.sh` (`fluidsynth` + `ffmpeg`).
- **Runtime:** `MusicHandler` plays MP3 via `HTMLAudioElement` with manual volume ramps for crossfade.
- **Pros:** Simple runtime, autoplay-friendly, no extra JS dep, predictable timing, native `loop`/`seek`.
- **Cons:** ~2 MB per scene, no per-channel control, each edit requires a rebuild.

### Option B (future, runtime MIDI synth in browser)

- **Tool:** A JS lib like [`smplr`](https://github.com/danigb/smplr) or [`soundfont-player`](https://github.com/danigb/soundfont-player) reads the SF2 and synthesizes in real-time via Web Audio.
- **Pros:** Real-time tempo/pitch/channel control. MIDIs become live data. Ink tags like `# midi_play:foo` can mute Ch10 drums on choices, layer FX, duck for SFX.
- **Cons:** Sample-loading latency, browser quirks. Web Audio still needs a user gesture for first playback.

### Option C (future, Web MIDI + OS synth)

- **Tool:** `navigator.requestMIDIAccess()` + Web Audio.
- **Pros:** Zero audio asset size.
- **Cons:** Requires a user-installed synth. Almost certainly **not viable** for a public web build — broken on too many environments.

**Stay on Option A** until a scene needs live music control.

## Re-rendering

```bash
./tools/render-midi.sh                # render all *.mid in assets/audio/
./tools/render-midi.sh one/track.mid  # render one file
```

Requires `fluidsynth` (`brew install fluid-synth`) and `ffmpeg` (`brew install ffmpeg`).

## Provenance

- `sc55.sf2` — `VintageDreamsWaves-v2.sf2` from the Homebrew `fluid-synth` formula. General MIDI compatible, free for any use. **Not** a true Roland SC-55 ROM; we use it as a stand-in. For authentic SC-55/CM-500/CM-64 tone, swap in a licensed SC-55 SoundFont (e.g. from the SC-55 module's own ROM dump) — the render script needs no changes. See `docs/SC55_AB_TEST.md` for the deferred swap plan.
- `intro_theme.mp3` — FM synthesis (17 SC-55 channels, 108 BPM, 40 bars). Rendered to WAV → MP3 via ffmpeg. No MIDI exists because it's a continuous FM composition, not a discrete-note score.