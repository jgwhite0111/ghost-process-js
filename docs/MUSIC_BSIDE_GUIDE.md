# B-side Medley Generation Guide

Purpose: when an A-side has a real musical shape, the B-side should share
the family (key, BPM, patches) but occupy a different **section** of the
same song.

## The complement rule

For each A-side, the B-side should be the **B section** (or A'' return,
or contrast) of the same piece. Practically:

| A-side shape | B-side should be |
|---|---|
| Intro + build + climax + decay (cold_open) | A counter-melody on the climax chord. Drone continues, but a different voice takes the melody up an octave OR keeps the same drone and adds an answering phrase from a different patch. |
| Silent start + arpeggio build (corridor) | The arpeggio at peak intensity, sustained, with a slight key change to neighbor chord (i → bVI swap) for emotional shift. |
| Full-pattern + half-time drop + rebuild (chase) | Drop NEVER returns. B-side stays in the half-time feel throughout, with the lead doing a busy 16th-note line. The "escape" feeling. |
| arpeggio → kick-only → full 4-on-floor + tempo push (jailbreak) | 4-on-floor PATTERN at the higher tempo throughout. Lead is the ascending riff instead of the original descent. Climax chords swap the chord quality (Am → Em for the "resolve to home" feeling). |
| Glitch stutter → full build + tempo lift + cascade → stutter (terminal_lab) | The "cascade never ended." Stays in the cascade + new chord progression (B minor → D minor). Lead goes higher. No return to stutter. |
| A → A' (varied ending) → B (sax solo) → A'' (kabukicho) | The jazz standard's "head out" — sax melody one last time at soft dynamic, piano comp louder, then walk-up fade. |
| EP stabs → chord progression → full band → crescendo (corp_office) | Full band but at LOW dynamic the whole loop; descending bassline; everything ever-so-slightly slower (no actual BPM change, but the lead phrases drop several notes per bar — feels restrained vs. A's cresc). |
| Layer-by-layer engine buildup (ship_engine) | Engine at FULL power throughout — no buildup, just brute pressure. |

## Per-scene concrete specs (mirror after A-sides lock)

These are placeholders — once each A-side is final, mirror as:
- Same key + bpm + patches
- Same bar count
- Different dynamic curve (B-side is "the complement")
- Tune the crossfade `fadeAt` to land at A's peak (around 60-75% through A)

Will be filled in after A-sides commit.

## What NOT to do

- ❌ Don't give B-side a different chord progression than A. Use A's chords but reorder, invert, or extend.
- ❌ Don't give B-side a different tempo than A. Same family means same BPM.
- ❌ Don't make B-side a "weaker" copy of A. Make it a different **phase** of the same musical idea.
