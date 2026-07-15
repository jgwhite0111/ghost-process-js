# Music Grid

Per-scene music map, checked against the live `story.json` `music` field. The runtime accepts either one MP3 string or a generic ordered medley array. Only `intro` is solo; all 9 gameplay scenes currently use five-track A→B→C→D→E medleys.

For the table below, B–E filenames append `_b` through `_e` to the listed A-file stem. `fadeAt` is stored on the destination entry: B's value controls the transition after A has played that many seconds, C's after B, and so on.

| Scene | A file | Track order | Destination-entry `fadeAt` values (B / C / D / E, seconds) |
|---|---|---|---|
| intro | `intro_theme.mp3` | solo | — |
| cold_open | `cold_open.mp3` | A→B→C→D→E | 51.1 / 82.3 / 52.8 / 82.3 |
| alley | `alley_confrontation.mp3` | A→B→C→D→E | 23.8 / 41.7 / 50.5 / 41.7 |
| chase | `chase.mp3` | A→B→C→D→E | 31.6 / 45 / 36 / 36 |
| corridor | `corridor.mp3` | A→B→C→D→E | 93 / 95 / 63 / 95 |
| jailbreak | `jailbreak.mp3` | A→B→C→D→E | 35.1 / 42.9 / 62 / 45.1 |
| kabukicho | `kabukicho.mp3` | A→B→C→D→E | 31.4 / 61.1 / 50.4 / 61.1 |
| corp_office | `corp_office.mp3` | A→B→C→D→E | 37.3 / 42 / 50 / 22 |
| terminal_lab | `terminal_lab.mp3` | A→B→C→D→E | 50.6 / 54.7 / 57.6 / 54.7 |
| ship_engine | `ship_engine.mp3` | A→B→C→D→E | 51.7 / 72 / 46 / 72 |

## Scene Shapes — what each track sounds like

The original A tracks documented below each have a real *song shape* — intro → build → peak → break → rebuild → release. They are not flat loops.

### `cold_open` (D Phrygian, 70 BPM, 24 bars)
**Shape:** *drone sits → whisper lead climbs → big swell → sharp cutoff → one fading note*
The first 7 bars are pure dread — bass drone + pad swell, no melody. At bar 8 a whisper lead enters at vel 50 and climbs to 95 by bar 15. Bars 16-19 are the **big ambient swell** (pad expression climbs 30 → 110), and then bars 20-21 cut to silence. Bars 22-23 leave one breath + a single high note fading into the loop wrap.
**Tempo:** unchanged.
**Why:** dread shouldn't race. The silence-cut makes the next loop's whisper feel earned.

### `corridor` (C minor, 60 BPM, 24 bars)
**Shape:** *sparse music box → arpeggios expand → silence → re-entry → decay*
Cinematic. Music-box arpeggios alone for 6 bars, then a pad chord C minor enters quietly. Bars 7-11 the arpeggios double. Bar 12 is **silence** — all channels held off, just the held chord ringing empty. Bar 13 the chord re-enters loudly with a big motif, builds to Ab chord climax, then fades.
**Tempo:** unchanged.
**Why:** the silence bar is what makes it feel cinematic instead of "music for a menu."

### `chase` (E minor, 132 BPM, 24 bars)
**Shape:** *kick-only build → fill in → full band kickoff → half-time drop → rebuild → full blast*
The most active. Bars 0-3 drums build up (kick on beat 1 only), bars 4-7 fill in, bars 8-11 full band kickoff. **Drop to half-time at bar 12** — pad drops out, bass walks single notes. Bars 16-19 rebuild with snare rolls on bar 19. Bars 20-23 full blast with crash, all elements at vel 110. **Tempo lift at bar 8: 132 → 144**.
**Why:** the half-time drop is what makes action music feel like action music, not a metronome.

### `jailbreak` (A minor, 120 BPM, 24 bars)
**Shape:** *arpeggio figure → kick-only pulse → full 4-on-floor → tempo push → climax → release*
The escape-the-prison moment. Lead arpeggios with pad chord, then drums enter kick-only, then full kit. **Tempo push at bar 12: 120 → 132** — the adrenaline kicks in. Bass refuses to drop (stays high-octave). Climax at 16-19 with crash. Bars 20-23 are the *release* — chord changes to E, pad expression drops to 0, lead walks down.
**Why:** the tempo push is the "this is starting to work" feeling.

### `terminal_lab` (B minor, 76 BPM, 24 bars)
**Shape:** *glitch stutter → bass+pad build → full glitch → tempo lift → cascade → stutter again*
Glitch-only for bars 0-3 (random hits, no bass+pad). Build bars 4-7. Full pattern at 76 BPM bars 8-11. **Tempo lift at bar 12: 76 → 88** — the system "speeds up." Bars 12-19 are a cascade with lead desc­ending while going up an octave. **Bars 20-23 return to stutter**, matching the start state, so the loop is seam-free.
**Why:** the tempospeed-then-return is the "system overload / we exited" arc. Looping glitch→glitch means it's structurally circular.

### `kabukicho` (F minor, 88 BPM, 16 bars)
**Shape:** *A (sax melody) → A' (varied ending, piano comp enters) → B (sax solo, walking bass higher) → A'' (return to opening theme)*
Jazz-specific. Not intro/verse/chorus — instead AABA'. The B section is louder (bass vel ramp 60→100→90), and the return to A'' has a "jump-cut" feel — same melody line but shifted in dynamics.
**Tempo:** unchanged. **Pad swell across all 16 bars** (0 → 110 → 70).
**Why:** all-modal-jazz-on-one-chord tracks are boring. The AABA' gives the ear something to navigate.

### `corp_office` (F# minor, 92 BPM, 20 bars)
**Shape:** *EP stabs only → EP chord progression begins → full band → build → subtle crescendo → crash*
Corporate. Bars 0-3 EP keyboard stabs on beats 1+3 ONLY (nothing else plays). Bars 4-7 EP chord progression begins + bass mechanical 8ths + kick+brush. Bars 8-11 full band — pad enters softly. Build bars 12-15. **Bars 16-19 subtle crescendo via pad_vel_ramp 60→120** + lead vel 70→110. Bar 19 final crash.
**Tempo:** unchanged. **Why:** corporate horror should build without ever racing — the evil is patient.

### `ship_engine` (D minor, 80 BPM, 24 bars)
**Shape:** *bass pulse only → add kick → add hats → add snare+hats+lead → snare rolls → engine revs higher*
Industrial. **No chorus hit** — instead instrument-by-instrument layering. The "rev up" at bars 20-23 (bass shifts to octave 3, tom fills) loops back to the quiet bass-pulse start. Engine doesn't race; it grinds.
**Tempo:** unchanged. **Why:** matches the mood — patient mechanical pressure.

## Composer infrastructure

These song shapes are powered by 4 composer extensions in `tools/make_scene_loop.py`:

| Field | Effect | Used in |
|---|---|---|
| `lead_vel_ramp=(start, end)` | Per-note velocity scales by position in loop | cold_open, all scenes with builds |
| `pad_vel_ramp=(start, end, n_steps)` | CC11 (expression) ramps across loop | corridor, cold_open, kabukicho, corp_office, terminal_lab |
| `pad_breakdowns=[(bar_a, bar_b)]` | Pad expression drops to 0 for the listed bar range, then ramps back | chase (12-15), jailbreak (20-23) |
| `tempo_changes=[(bar, bpm)]` | Mid-track `meta_set_tempo` for tempo push/drop | chase (12→144), jailbreak (12→132), terminal_lab (12→88) |
| `drum_shapes=[{bars, _volume, _restore}]` | Whole-kit CC7 volume dropouts (limited — CC7 only addresses full kit on drum channel) | terminal_lab (stutter→full), corporate (build), chase (drop) |

## Adding a new scene

The composer keeps `schedule_note_sequence`, `schedule_drums`, `schedule_pad_chord_block`, `compose` as the only places that emit MIDI events. To give a new scene a real shape:

1. Pick a 4-bar-chunk song arc and lay it out in bar-band terms: `intro (0-3)`, `build (4-7)`, `peak (8-11)`, `break (12-15)`, `rebuild (16-19)`, `release (20-23)`.
2. Add `lead_vel_ramp` / `bass_vel_ramp` if the line should change volume across the loop.
3. Add `pad_vel_ramp` (CC11 swell) or `pad_breakdowns` (CC11 dropouts) for chords.
4. Add `tempo_changes` for any push/drop — only on bars where it MATTERS.
5. Add `drum_shapes` for breakdowns — keep in mind CC7 only mutes the whole kit on a single drum channel.
6. Render via `python3 tools/make_scene_loop.py your_scene` and confirm the duration is in 40-100s range.
