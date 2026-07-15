#!/usr/bin/env python3
"""
make_scene_loop.py — parameterized SMF Type-0 composer for Ghost Process
scene loops. Used to generate a unique tune per scene without writing a
one-off script each time.

This is a parameterized rewrite of the canonical `make_alley_confrontation.py`
/ `make_clinic_tension.py` form (see pc98-audio-loop-pipeline skill). It
keeps the same SC-55-style authoring discipline:

  - SMF Type-0, PPQ=96 (SC-55 standard)
  - Always-emitted status bytes (no running status) — eliminates parser
    complaints from picky synths
  - Sort key: meta first, then by status code at each tick
  - Cross-boundary discipline: held voices (pad/lead) get note_off at
    LOOP_TICKS - 1; crash crosses the wrap to smear the boundary
  - CC#91 (reverb) + CC#1 (modulation) set per channel at tick 0

Usage:
    # One-off render (writes assets/audio/<name>.mid and renders to .mp3):
    python3 tools/make_scene_loop.py <name>

    # Just write the .mid (no MP3 render):
    python3 tools/make_scene_loop.py <name> --no-render

The scene composition comes from a SCENES dict below. To add a new
track, append an entry — copy an existing one and tweak tempo, key,
patches, drum pattern.

The runtime path is `tools/render-midi.sh` which is what the
existing `alley_confrontation.mid` and `clinic_tension.mid` were
rendered with — same pipeline, same VintageDreamsWaves-v2 SF2 in
assets/audio/sc55.sf2. No Godot/.import sidecars in this repo —
the runtime plays MP3s via HTMLAudioElement directly.

Zero external deps (stdlib only: struct, io, pathlib).
"""
from __future__ import annotations

import argparse
import io
import struct
import subprocess
import sys
from pathlib import Path

# -----------------------------------------------------------------------------
# Project paths
# -----------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent.parent
AUDIO_DIR = ROOT / "assets" / "audio"
SF2 = AUDIO_DIR / "sc55.sf2"
RENDER_SH = ROOT / "tools" / "render-midi.sh"


# -----------------------------------------------------------------------------
# MIDI constants
# -----------------------------------------------------------------------------
PPQ = 96
BEATS_PER_BAR = 4
QUARTER = PPQ
EIGHTH = PPQ // 2
SIXTEENTH = PPQ // 4
CH_LEAD = 0
CH_BASS = 1
CH_PAD = 2
CH_DRUM = 9


# General MIDI drum notes (channel 10)
KICK = 36
SNARE = 38
HHAT = 42
HHAT_OPEN = 46
TOM_LO = 41
TOM_MID = 47
TOM_HI = 48
CRASH = 49
RIDE = 51


def var_len(n: int) -> bytes:
    """Encode a non-negative int as a MIDI variable-length quantity."""
    if n < 0:
        raise ValueError("var_len requires non-negative")
    buf = bytearray([n & 0x7F])
    n >>= 7
    while n:
        buf.append((n & 0x7F) | 0x80)
        n >>= 7
    buf.reverse()
    return bytes(buf)


class Event:
    __slots__ = ("tick", "status", "data")

    def __init__(self, tick: int, status: int, data: bytes = b"") -> None:
        self.tick = tick
        self.status = status
        self.data = data


def note_on(ch: int, key: int, vel: int, tick: int) -> Event:
    return Event(tick, 0x90 | ch, bytes([key & 0x7F, vel & 0x7F]))


def note_off(ch: int, key: int, tick: int) -> Event:
    return Event(tick, 0x80 | ch, bytes([key & 0x7F, 0]))


def cc(ch: int, ctl: int, val: int, tick: int) -> Event:
    return Event(tick, 0xB0 | ch, bytes([ctl & 0x7F, val & 0x7F]))


def pc(ch: int, prog: int, tick: int) -> Event:
    return Event(tick, 0xC0 | ch, bytes([prog & 0x7F]))


def meta_track_name(name: str, tick: int = 0) -> Event:
    body = name.encode("ascii")
    return Event(tick, 0xFF, bytes([0x03, len(body)]) + body)


def meta_set_tempo(micros_per_quarter: int, tick: int = 0) -> Event:
    return Event(tick, 0xFF, bytes([0x51, 3]) + struct.pack(">I", micros_per_quarter)[1:])


def meta_time_sig(num: int, den_pow2: int, tick: int = 0) -> Event:
    return Event(tick, 0xFF, bytes([0x58, 4, num, den_pow2, 24, 8]))


def meta_end(tick: int = 0) -> Event:
    return Event(tick, 0xFF, bytes([0x2F, 0]))


def write_smf_clean(events: list[Event]) -> bytes:
    """SMF Type-0 with always-emitted status bytes. Meta events sort first
    within each tick (lower status codes first)."""
    def sort_key(e: Event) -> tuple:
        s = e.status
        return (e.tick, 0 if s == 0xFF else s + 1, s)
    events = sorted(events, key=sort_key)
    body = io.BytesIO()
    last_tick = 0
    for e in events:
        delta = e.tick - last_tick
        last_tick = e.tick
        body.write(var_len(delta))
        body.write(bytes([e.status]))
        body.write(e.data)
    data = body.getvalue()
    out = io.BytesIO()
    out.write(b"MThd")
    out.write(struct.pack(">I HHH", 6, 0, 1, PPQ))
    out.write(b"MTrk")
    out.write(struct.pack(">I", len(data)))
    out.write(data)
    return out.getvalue()


# -----------------------------------------------------------------------------
# Pitch helpers — keep composer code readable (F minor 4 = "F4" = MIDI 65).
# -----------------------------------------------------------------------------
def N(semitones_from_c: int, octave: int = 4) -> int:
    """MIDI note number from (semitones from C, octave). C4 = 60."""
    return 12 * (octave + 1) + semitones_from_c


# Scale intervals (semitones from root)
MAJOR = [0, 2, 4, 5, 7, 9, 11]
MINOR = [0, 2, 3, 5, 7, 8, 10]
PHRYGIAN = [0, 1, 3, 5, 7, 8, 10]
DORIAN = [0, 2, 3, 5, 7, 9, 10]


def triad(root: int, intervals: list[int], octave: int = 4) -> list[int]:
    """Build a triad (root, third, fifth) over `root` in `octave`."""
    return [N(root, octave), N(root + intervals[2], octave), N(root + intervals[4], octave)]


def chord(root: int, intervals: list[int], octave: int = 4, ext: int = 0) -> list[int]:
    """Triad + optional 7th. ext=1 adds the 7th (M7 for major, m7 for minor)."""
    out = triad(root, intervals, octave)
    if ext:
        out.append(N(root + intervals[6], octave))
    return out


# -----------------------------------------------------------------------------
# Composition functions
# -----------------------------------------------------------------------------
def setup_channels(cfg: dict) -> list[Event]:
    """Channel setup at tick 0: volume, pan, reverb, modulation, patch."""
    ev: list[Event] = [
        meta_track_name(f"{cfg['name']} (SC-55)"),
        meta_time_sig(4, 2),
    ]
    # Only emit the tick-0 tempo if there are no mid-track tempo_changes
    # (otherwise the first change at bar 0 is redundant with this one).
    if not cfg.get("tempo_changes"):
        ev.append(meta_set_tempo(int(60_000_000 / cfg["bpm"])))
    # Lead
    if cfg.get("lead"):
        l = cfg["lead"]
        ev += [
            cc(CH_LEAD, 7, l.get("vol", 100), 0),
            cc(CH_LEAD, 10, l.get("pan", 64), 0),
            cc(CH_LEAD, 91, l.get("reverb", 50), 0),
            cc(CH_LEAD, 1, l.get("mod_init", 0), 0),
            pc(CH_LEAD, l["prog"], 0),
        ]
    # Bass
    if cfg.get("bass"):
        b = cfg["bass"]
        ev += [
            cc(CH_BASS, 7, b.get("vol", 90), 0),
            cc(CH_BASS, 91, b.get("reverb", 25), 0),
            pc(CH_BASS, b["prog"], 0),
        ]
    # Pad
    if cfg.get("pad"):
        p = cfg["pad"]
        ev += [
            cc(CH_PAD, 7, p.get("vol", 95), 0),
            cc(CH_PAD, 10, p.get("pan", 64), 0),
            cc(CH_PAD, 91, p.get("reverb", 85), 0),
            pc(CH_PAD, p["prog"], 0),
        ]
    # Drums
    if cfg.get("drums"):
        d = cfg["drums"]
        ev += [
            cc(CH_DRUM, 7, d.get("vol", 100), 0),
            cc(CH_DRUM, 91, d.get("reverb", 30), 0),
        ]
    return ev


def schedule_pad_chord_block(cfg: dict) -> list[Event]:
    """Hold pad chord(s) across their bar ranges, release at LOOP_TICKS - 1.

    `cfg["pad_chords"]` is a list of (start_bar, [notes]) tuples. The
    voices ring across bar boundaries so the loop seam is smooth.

    Pad dynamics: cfg["pad_vel_ramp"] (start_vel, end_vel, n_steps) ramps
    CC11 (channel expression) across the loop in N steps so the chord
    swells in or fades out without changing notes. Default = none.
    cfg["pad_breakdowns"] is [(start_bar, end_bar)] where expression drops
    to 0 (full breakdown; just the held chord releases its own note).
    """
    ev: list[Event] = []
    bar = PPQ * BEATS_PER_BAR
    loop_ticks = cfg["bars"] * bar
    chord_starts = [int(start_bar * bar) for start_bar, _ in cfg["pad_chords"]]
    for i, (start_bar, notes) in enumerate(cfg["pad_chords"]):
        t_on = int(start_bar * bar)
        # A chord owns the range up to the next chord.  The old composer held
        # every chord to the end of the loop, so each change merely piled a
        # new harmony on top of all previous ones.
        t_off = chord_starts[i + 1] - 1 if i + 1 < len(chord_starts) else loop_ticks - 1
        for n in notes:
            ev.append(note_on(CH_PAD, n, 70, t_on))
            ev.append(note_off(CH_PAD, n, t_off))
    # Optional expression ramp
    pr = cfg.get("pad_vel_ramp")
    if pr:
        start_v, end_v, n_steps = pr
        for i in range(n_steps):
            t = int(loop_ticks * (i / n_steps))
            v = int(start_v + (end_v - start_v) * (i / n_steps))
            ev.append(cc(CH_PAD, 11, max(0, min(127, v)), t))
    # Optional breakdowns (expression = 0 for the bar range, then restore)
    pb = cfg.get("pad_breakdowns", [])
    default_expr = cfg.get("pad", {}).get("vol", 95)
    for b_start, b_end in pb:
        t_start = b_start * bar
        t_end = b_end * bar
        # Ramp down into the breakdown
        ramp_down = bar  # 1 bar fade-out
        ev.append(cc(CH_PAD, 11, default_expr, max(0, t_start - ramp_down)))
        ev.append(cc(CH_PAD, 11, 0, t_start))
        # Ramp back up at the end of the breakdown
        ramp_up_bars = 1
        t_restore = (b_end - ramp_up_bars) * bar if b_end - ramp_up_bars >= 0 else b_end * bar
        ev.append(cc(CH_PAD, 11, 0, t_restore))
        ev.append(cc(CH_PAD, 11, default_expr, b_end * bar))
    return ev


def schedule_note_sequence(cfg: dict, channel: int, phrases: list, base_vel: int = 80,
                    mod_ramp: tuple = (0, 0), vel_ramp: tuple | None = None) -> list[Event]:
    """Schedule a single-channel melodic phrase.

    `phrases` is a list of (start_tick_offset_from_loop, [notes]) where
    each note is (midi_note, duration_ticks, velocity_delta).
    `mod_ramp` (start_cc1, end_cc1) sweeps CC#1 across the loop for vibrato
    / instability effects.
    `vel_ramp` (start_vel, end_vel) ramps the per-note base_vel across the
    loop — e.g. (40, 100) gives a soft start building to full volume.
    Combined with `base_vel`, actual velocity = base_vel + vdelta, scaled
    by the position in the loop toward vel_ramp target."""
    ev: list[Event] = []
    loop_ticks = cfg["bars"] * PPQ * BEATS_PER_BAR
    if mod_ramp[1] != mod_ramp[0]:
        # 4-point CC ramp across the loop
        for i, frac in enumerate([0.0, 0.33, 0.66, 1.0]):
            t = int(loop_ticks * frac)
            val = int(mod_ramp[0] + (mod_ramp[1] - mod_ramp[0]) * frac)
            ev.append(cc(channel, 1, val, t))
    for start, notes in phrases:
        # Pattern entries are sequential phrases.  Their note durations advance
        # a local cursor; treating every tuple as if it began at `start` stacked
        # the whole phrase into one chord and left the rest of the section bare.
        cursor = start
        for note_info in notes:
            if len(note_info) == 2:
                key, dur = note_info
                vdelta = 0
            else:
                key, dur, vdelta = note_info
            if cursor >= loop_ticks:
                break
            dur = min(dur, loop_ticks - cursor)
            if key is not None:
                if vel_ramp is None or vel_ramp[0] == vel_ramp[1]:
                    scaled_base = base_vel
                else:
                    frac = cursor / max(1, loop_ticks)
                    scaled_base = int(vel_ramp[0] + (vel_ramp[1] - vel_ramp[0]) * frac)
                v = max(20, min(127, scaled_base + vdelta))
                ev.append(note_on(channel, key, v, cursor))
                ev.append(note_off(channel, key, cursor + dur - 1))
            cursor += dur
    return ev


def schedule_drums(cfg: dict) -> list[Event]:
    """Build a drum pattern from `cfg["drum_pattern"]`.

    Pattern is a list of (start_tick, drum_note, velocity). The composer
    also schedules a crash that crosses the wrap (cross-boundary crash).

    Bar-band shaping: cfg["drum_shapes"] is a list of band dicts applied
    across the loop, each like {"bars": (start_bar, end_bar), "kick":
    None|"off", "snare": vol_int|None, "hats": vol_int|None, ...}.
    `None` for the vol means "leave default". Setting a key to `"off"`
    silences that instrument for the bar range. This is how we get a
    real "breakdown" (drums cut, then come back in)."""
    ev: list[Event] = []
    bar = PPQ * BEATS_PER_BAR
    loop_ticks = cfg["bars"] * bar
    pattern = cfg.get("drum_pattern", [])
    # Pass 1: schedule the actual drum hits
    for t, note, vel in pattern:
        for n in range(cfg.get("drum_repeats", 1)):
            tt = t + n * loop_ticks
            ev.append(note_on(CH_DRUM, note, vel, tt))
            ev.append(note_off(CH_DRUM, note, tt + 1))
    # Pass 2: per-bar shaping — emit CC7 (channel volume) and CC9
    # (note-off velocity curves) bursts at the start of each shaped bar
    # band. We use CC7 per note since channel 10 is a drum channel and
    # all GM drums respond to it (most percussion responds to CC7 with
    # attenuation, gives a "fading out" feel for breakdowns). For "off"
    # we set CC7=0 at the start of the band and restore at the end.
    shapes = cfg.get("drum_shapes", [])
    for sh in shapes:
        b_start, b_end = sh.get("bars", (0, cfg["bars"]))
        t_start = b_start * bar
        t_end = b_end * bar
        for inst in ("kick", "snare", "hats", "toms"):
            v = sh.get(inst, None) if isinstance(sh.get(inst, None), int) else None
            # We can't address individual drum instruments via CC on a
            # single drum channel — CC7 mutes the whole kit. For partial
            # shaping we'd need multi-channel drums. As a fallback we use
            # CC7 for whole-band on/off:
            if inst == "_volume" and v is not None:
                ev.append(cc(CH_DRUM, 7, max(0, min(127, v)), t_start))
                if t_end < loop_ticks:
                    # restore on exit (use the default vol if not given)
                    restore = sh.get("_restore", cfg.get("drums", {}).get("vol", 100))
                    ev.append(cc(CH_DRUM, 7, max(0, min(127, restore)), t_end))
    # Cross-boundary crash (last 2 bars of the loop, ring past the wrap)
    if cfg.get("cross_boundary_crash"):
        crash_vel = cfg.get("crash_velocity", 100)
        # crash at bar (N-2) beat 3, note_off well past the wrap
        cb_on = (cfg["bars"] - 2) * bar + 2 * PPQ
        cb_off = loop_ticks + PPQ  # 1 beat past wrap
        ev.append(note_on(CH_DRUM, CRASH, crash_vel, cb_on))
        ev.append(note_off(CH_DRUM, CRASH, cb_off))
    return ev


def compose(cfg: dict) -> list[Event]:
    """Top-level composer — stitches setup + voices together."""
    ev: list[Event] = []
    ev += setup_channels(cfg)
    if cfg.get("pad"):
        ev += schedule_pad_chord_block(cfg)
    if cfg.get("bass"):
        ev += schedule_note_sequence(cfg, CH_BASS, cfg["bass_pattern"],
                              base_vel=cfg["bass"].get("vol", 85),
                              vel_ramp=cfg.get("bass_vel_ramp"))
    if cfg.get("lead"):
        ev += schedule_note_sequence(cfg, CH_LEAD, cfg["lead_pattern"],
                              base_vel=cfg["lead"].get("vol", 90),
                              mod_ramp=cfg.get("lead_mod_ramp", (0, 0)),
                              vel_ramp=cfg.get("lead_vel_ramp"))
    if cfg.get("drums"):
        ev += schedule_drums(cfg)
    # Mid-track tempo changes — emitted via meta_set_tempo events at the
    # start tick of each listed bar. cfg["tempo_changes"] is [(bar, bpm)].
    bar = PPQ * BEATS_PER_BAR
    for ch_bar, ch_bpm in cfg.get("tempo_changes", []):
        t = int(ch_bar * bar)
        # Set meta at this bar; if it's earlier than the setup tempo at
        # tick 0, we need to suppress that initial tempo. Easiest fix is
        # to drop the initial meta_set_tempo from setup if any tempo
        # changes exist; we do that conditionally in setup_channels.
        ev.append(meta_set_tempo(int(60_000_000 / ch_bpm), t))
    ev.append(meta_end(cfg["bars"] * PPQ * BEATS_PER_BAR))
    return ev


# -----------------------------------------------------------------------------
# Scene configurations
#
# Each entry is fully self-contained: tempo, key, patches, pattern, drums.
# To audition a new mood, copy an entry, change values, re-run.
# -----------------------------------------------------------------------------
SCENES: dict[str, dict] = {}
# SCENES_B — medley partner tracks. Merged into SCENES via SCENES.update(SCENES_B)
# at the bottom of the file, so the existing render_midi/render_mp3/--list
# entrypoints Just Work for both A-sides and B-sides.
SCENES_B: dict[str, dict] = {}

# ---------- 1. cold_open — dread reveal, drone → lead → swell → cutoff -----
# SHAPE: bars 0-7 drone (bass+pad, no melody), bar 8 whisper lead enters,
# bars 8-15 lead climbs (vel 50→95), bars 16-19 BIG ambient swell (pad
# expression 30→110 via pad_vel_ramp), bars 20-21 SHARP cutoff (pad
# breakdown), bars 22-23 ONE breath — single high lead note fading.
# 4 distinct chord progressions across the 24 bars (D Phrygian palette).
SCENES["cold_open"] = {
    "name": "cold_open",
    "bars": 24,                              # ~82s at 70 BPM
    "bpm": 70,
    "lead": {"prog": 82, "vol": 95, "pan": 64, "reverb": 55, "mod_init": 0},
    "bass": {"prog": 39, "vol": 80, "reverb": 20},
    "pad":  {"prog": 100, "vol": 90, "pan": 64, "reverb": 95},
    "drums": {"vol": 0, "reverb": 0},        # muted — pure dread, no percussion
    "lead_mod_ramp": (0, 50),                # vibrato climbs into climax then decays
    "lead_vel_ramp": (50, 95),               # whisper at bar 8 → full by bar 15
    "key_intervals": PHRYGIAN,
    "root": 2,                               # D Phrygian
    # 4 distinct chord progressions across 24 bars:
    #   A) bars 0-7:  D, F, A, C   (i, bIII, bVI, bVII — Phrygian stack)
    #   B) bars 8-15: D, F, A, Db  (chromatic pull — different voicing)
    #   C) bars 16-19: D, G, C, F  (modal shift — brighter Phrygian)
    #   D) bars 20-23: D, A, D     (resolution — sparse voicing)
    "pad_chords": [
        (0,  [N(2,3), N(5,3), N(9,3), N(0,4)]),       # A: D, F, A, C  (bars 0-7)
        (8,  [N(2,3), N(5,3), N(9,3), N(1,4)]),       # B: D, F, A, Db (bars 8-15)
        (16, [N(2,3), N(7,3), N(0,4), N(5,4)]),       # C: D, G, C, F  (bars 16-19)
        (20, [N(2,3), N(9,3), N(2,4)]),               # D: D, A, D     (bars 20-23)
    ],
    # pad_vel_ramp ramps expression 30→110 across the full loop for the
    # ambient swell feel. Combined with pad_breakdowns at 20-23 to give
    # the SHARP cutoff (the ramp tries to keep climbing, but breakdown
    # forces expression to 0 — the breakdown overrides the ramp at the
    # last 4 bars, then it restores at end-of-loop for a clean seam).
    "pad_vel_ramp": (30, 110, 20),           # 20 CC steps across 24 bars
    "pad_breakdowns": [(20, 23)],            # expression=0 during bars 20-22
    # Bass: drone on D for bars 0-7, gets more active from bar 8 with
    # octave drops, holds root only through bars 20-23.
    "bass_pattern": [
        # bars 0-7 — pure drone, root + low octave
        (0, [(N(2,1), PPQ*8, 0), (N(2,2), PPQ*8, 0),
             (N(2,1), PPQ*8, 0), (N(2,2), PPQ*8, 0)]),
        (PPQ*32, [(N(2,1), PPQ*8, 0), (N(2,2), PPQ*8, 0),
                  (N(2,1), PPQ*8, 0), (N(2,2), PPQ*8, 0)]),
        # bars 8-15 — more active, octave drops every 2 bars
        (PPQ*64, [(N(2,1), PPQ*2, 0), (N(2,2), PPQ*2, 0),
                  (N(7,1), PPQ*2, 0), (N(7,2), PPQ*2, 0),
                  (N(2,1), PPQ*2, 0), (N(2,2), PPQ*2, 0),
                  (N(0,2), PPQ*2, 0), (N(0,3), PPQ*2, 0)]),
        (PPQ*96, [(N(2,1), PPQ*2, 0), (N(2,2), PPQ*2, 0),
                  (N(7,1), PPQ*2, 0), (N(7,2), PPQ*2, 0),
                  (N(0,2), PPQ*2, 0), (N(0,3), PPQ*2, 0),
                  (N(2,1), PPQ*2, 0), (N(2,2), PPQ*2, 0)]),
        # bars 16-19 — climax: root + 5th on every beat
        (PPQ*128, [(N(2,1), PPQ*2, 0), (N(9,1), PPQ*2, 0),
                   (N(2,1), PPQ*2, 0), (N(9,1), PPQ*2, 0),
                   (N(2,1), PPQ*2, 0), (N(9,1), PPQ*2, 0),
                   (N(2,1), PPQ*2, 0), (N(9,1), PPQ*2, 0)]),
        (PPQ*144, [(N(2,1), PPQ*2, 0), (N(9,1), PPQ*2, 0),
                   (N(2,1), PPQ*2, 0), (N(9,1), PPQ*2, 0),
                   (N(2,1), PPQ*2, 0), (N(9,1), PPQ*2, 0),
                   (N(2,1), PPQ*2, 0), (N(9,1), PPQ*2, 0)]),
        # bars 20-23 — SHARP cutoff: root only, sparse
        (PPQ*160, [(N(2,1), PPQ*8, 0)]),             # bar 20: single D
        (PPQ*168, [(N(2,1), PPQ*8, 0)]),             # bar 21: single D
        (PPQ*176, [(N(2,1), PPQ*8, 0)]),             # bar 22: single D (breath)
        (PPQ*184, [(None, PPQ*8, 0)]),               # bar 23: rest
    ],
    # Lead: whisper at bar 8 (vel ≈ 50), climbs to peak by bar 19, holds,
    # then a single high note fading through the cutoff.
    # vel_ramp does the climb (50→95 across the loop); the phrase still
    # places notes at key dramatic moments.
    "lead_pattern": [
        (PPQ*32, [                                  # bar 8 — whisper entry
            (N(2,5), PPQ*4, -15),                   # D5, very quiet
            (N(0,5), PPQ*4, -10),                   # C5
            (N(9,4), PPQ*8, -5),                    # Bb4 held
            (None, PPQ*16, 0),                      # rest through bars 10-11
        ]),
        (PPQ*64, [                                  # bar 12 — climbing
            (N(2,5), PPQ*4, -5),
            (N(5,5), PPQ*4, -3),
            (N(0,5), PPQ*4, 0),                     # C5
            (N(2,5), PPQ*4, 3),                     # D5
        ]),
        (PPQ*80, [                                  # bar 16 — climax (swell)
            (N(2,5), PPQ*2, 5),
            (N(5,5), PPQ*2, 8),                     # F5
            (N(7,5), PPQ*4, 10),                    # G5 (Phrygian pull, high)
            (N(5,5), PPQ*4, 8),                     # F5
            (N(2,5), PPQ*2, 5),                     # D5
            (N(7,5), PPQ*2, 3),                     # G5
        ]),
        (PPQ*96, [                                  # bar 20 — last gasp before cutoff
            (N(5,5), PPQ*4, 0),
            (N(2,5), PPQ*4, -5),
        ]),
        (PPQ*104, [                                 # bar 22 — single high note (breath)
            (N(7,5), PPQ*8, -10),                   # G5 fading
        ]),
        # bar 23: silence — no notes
    ],
    "cross_boundary_crash": False,           # drums muted, no crash
    "drum_pattern": [],
}

# ---------- 2. chase — kinetic pursuit, driving 4-on-floor ---------------
# SHAPE: bars 0-3 drums build (kick only on beat 1). bars 4-7 fill in
# (kick 1+3, hi-hat low, snare 2+4). bars 8-11 FULL band kickoff
# (all elements full vel, lead stab enters) + TEMPO LIFT 132→144 at
# bar 8. bars 12-15 drop to half-time feel (drum_shapes mutes the kit
# via CC7=0, pad_breakdowns drops pad). bars 16-19 rebuild (kick+snare
# pattern, snare rolls on bar 19, hats return). bars 20-23 FULL BLAST
# (crash, all elements vel 110, lead full phrase; sustained to wrap).
SCENES["chase"] = {
    "name": "chase",
    "bars": 24,                              # ~87s at 132 BPM (lift to 144 at bar 8)
    "bpm": 132,
    "lead": {"prog": 63, "vol": 90, "pan": 64, "reverb": 35, "mod_init": 0},
    "bass": {"prog": 34, "vol": 100, "reverb": 15},
    "pad":  {"prog": 90, "vol": 85, "pan": 64, "reverb": 70},
    "drums": {"vol": 100, "reverb": 20},
    "lead_vel_ramp": (70, 110),              # builds with section intensity
    "key_intervals": MINOR,
    "root": 4,                               # E minor
    # Tempo lift at bar 8: 132 → 144 (urgency on kickoff)
    "tempo_changes": [(8, 144)],
    # Pad chords (i, bVI, bIII, bVII) — driving synthwave.
    # Chord rings from start_bar to LOOP_TICKS-1 (stacked by design).
    "pad_chords": [
        (0, [N(4,3), N(11,3), N(8,3), N(2,4)]),       # E, C, G, D  (bars 0-3)
        (4, [N(9,3), N(4,4), N(2,4), N(7,4)]),       # A, E, D, B  (bars 4-7)
        (8, [N(4,3), N(11,3), N(8,3), N(2,4)]),       # E, C, G, D  (bars 8-11, kickoff)
        (16, [N(9,3), N(4,4), N(2,4), N(7,4)]),       # A, E, D, B  (rebuild)
    ],
    # Pad breakdown at bars 12-15 (the half-time drop section).
    "pad_breakdowns": [(12, 16)],
    # drum_shapes: bars 12-16 whole kit muted (CC7=0) for the half-time
    # drop. Volume restored at t_end=16*bar=6144 (start of rebuild).
    "drum_shapes": [
        {"bars": (12, 16), "_volume": 0, "_restore": 100},
    ],
    "bass_pattern": [],       # built by _build_chase_patterns
    "lead_pattern": [],       # built by _build_chase_patterns
    "drum_pattern": [],       # built by _build_chase_patterns
    "cross_boundary_crash": True,
    "crash_velocity": 110,
}
def _build_chase_patterns():
    """4-on-floor chase — generate the chase section by section.

    Each section is built independently and concatenated into the cfg's
    pattern lists so the helper loop can emit them. We do NOT use a
    `drum_repeats` fill because each section needs different shapes
    (build / fill-in / full / drop / rebuild / blast).
    """
    bar = PPQ * BEATS_PER_BAR
    eighth = PPQ // 2
    cfg = SCENES["chase"]
    bass_ev: list = []
    lead_ev: list = []
    drum_ev: list = []

    # ----- BASS ------------------------------------------------------------
    # bars 0-3: half-built — just root on beat 1 (with the kick)
    for b in range(0, 4):
        t = b * bar
        bass_ev.append((t, [(N(4,1), PPQ, 0), (N(4,2), PPQ*3, 0)]))
    # bars 4-7: pump — root on beat 1 + 5th on beat 3, plus 8th-note decoration
    for b in range(4, 8):
        t = b * bar
        for beat in range(4):
            tt = t + beat * PPQ
            if beat in (0, 2):
                bass_ev.append((tt, [(N(4,1), eighth, 0), (N(9,1), eighth, 0),
                                     (N(4,1), PPQ//2, 0), (N(4,2), PPQ//2, 0)]))
            else:
                bass_ev.append((tt, [(N(9,1), PPQ, 0)]))
    # bars 8-11: FULL 8ths on root (with 5th offbeat)
    for b in range(8, 12):
        root = N(4, 1)
        fifth = N(9, 1)
        for beat in range(4):
            t = b * bar + beat * PPQ
            bass_ev.append((t, [(root, eighth, 0), (fifth, eighth, 0)]))
    # bars 12-15: N(2,4)-TIME — bass walks single notes (root, 5th, root, octave)
    walk = [N(4,1), N(9,1), N(4,1), N(4,2)]
    for b in range(12, 16):
        t = b * bar
        for i, beat in enumerate(range(4)):
            bass_ev.append((t + beat * PPQ, [(walk[i], PPQ, 0)]))
    # bars 16-19: rebuild — 8th-note pulse returns (octave higher)
    for b in range(16, 20):
        root_hi = N(4, 2)
        fifth_hi = N(9, 2)
        for beat in range(4):
            t = b * bar + beat * PPQ
            bass_ev.append((t, [(root_hi, eighth, 0), (fifth_hi, eighth, 0)]))
    # bars 20-23: BLAST — full pulse, lower octave for weight
    for b in range(20, 24):
        root = N(4, 1)
        fifth = N(9, 1)
        root_hi = N(4, 2)
        for beat in range(4):
            t = b * bar + beat * PPQ
            bass_ev.append((t, [(root, eighth, 0), (root_hi, eighth, 0),
                                 (fifth, eighth, 0), (root_hi, eighth, 0)]))
    cfg["bass_pattern"] = bass_ev

    # ----- LEAD ------------------------------------------------------------
    # bars 0-3: SILENT — drums build, no lead yet
    # bars 4-7: sparse stab hints (fills the build)
    for b in range(4, 8):
        if b % 2 == 0:
            lead_ev.append((b * bar + PPQ + eighth, [(N(7,4), eighth, -10)]))
    # bars 8-11: lead stab on every 4th bar + descending run every 4 bars
    for b in range(8, 12):
        t = b * bar
        for off in [PPQ + eighth, 3*PPQ + eighth]:
            bass_stab = 90 if (b % 4) < 2 else 100
            lead_ev.append((t + off, [(N(7,4), eighth, -5)]))
        if b % 4 == 0:
            for i, nt in enumerate([N(4,4), N(2,4), N(0,4), N(11,3)]):
                lead_ev.append((t + i * eighth, [(nt, eighth, 0)]))
    # bars 12-15: N(2,4)-TIME — sparse stabs (only beat 1 of every 2 bars)
    for b in range(12, 16):
        if b % 2 == 0:
            lead_ev.append((b * bar, [(N(7,4), PPQ*2, 0)]))
    # bars 16-19: rebuild — descending run every 2 bars
    for b in range(16, 20):
        t = b * bar
        for i, nt in enumerate([N(4,4), N(2,4), N(0,4), N(11,3), N(9,3)]):
            lead_ev.append((t + i * eighth, [(nt, eighth, 0)]))
    # bars 20-23: BLAST — full descending runs + sustained high note to wrap
    for b in range(20, 24):
        t = b * bar
        for i, nt in enumerate([N(7,4), N(4,4), N(2,4), N(0,4), N(11,3), N(9,3)]):
            lead_ev.append((t + i * eighth, [(nt, eighth, 0)]))
    # sustain a final high note across the last 4 bars for the wrap smear
    lead_ev.append((20 * bar, [(N(7,4), PPQ * 16, 5)]))
    cfg["lead_pattern"] = lead_ev

    # ----- DRUMS -----------------------------------------------------------
    # bars 0-3: BUILD — kick only on beat 1
    for b in range(0, 4):
        drum_ev.append((b * bar, KICK, 70))
    # bars 4-7: FILL IN — kick on 1+3, hi-hat low, snare on 2+4
    for b in range(4, 8):
        for beat in range(4):
            t = b * bar + beat * PPQ
            if beat in (0, 2):
                drum_ev.append((t, KICK, 85 if beat == 0 else 75))
            if beat in (1, 3):
                drum_ev.append((t, SNARE, 75))
            drum_ev.append((t + eighth, HHAT, 35))
    # bars 8-11: FULL KICKOFF — all elements at full velocity
    for b in range(8, 12):
        for beat in range(4):
            t = b * bar + beat * PPQ
            if beat in (0, 2):
                drum_ev.append((t, KICK, 100 if beat == 0 else 95))
            if beat in (1, 3):
                drum_ev.append((t, SNARE, 95))
            for e in range(2):
                hat_v = 65 if (beat % 2 == 0 and e == 0) else 55
                drum_ev.append((t + e * eighth, HHAT, hat_v))
            # ride every 8th
            drum_ev.append((t + eighth, RIDE, 55))
            # Crash on bar 8 beat 1 to mark the kickoff
            if b == 8 and beat == 0:
                drum_ev.append((t, CRASH, 95))
    # bars 12-15: DROP — NO drums scheduled here (drum_shapes silences kit
    # via CC7=0). We schedule nothing so the bar is empty.
    # bars 16-19: REBUILD — kick+snare pattern (no hats yet), then hats
    # gradually return. Snare rolls on bar 19.
    for b in range(16, 20):
        for beat in range(4):
            t = b * bar + beat * PPQ
            if beat in (0, 2):
                drum_ev.append((t, KICK, 95 if beat == 0 else 85))
            if beat in (1, 3):
                drum_ev.append((t, SNARE, 90))
            # Hats return gradually — b17=10%, b18=40%, b19=70%
            if b == 17 and beat >= 2:
                drum_ev.append((t + eighth, HHAT, 30))
            if b == 18:
                for e in range(2):
                    drum_ev.append((t + e * eighth, HHAT, 40))
            if b == 19:
                for e in range(2):
                    drum_ev.append((t + e * eighth, HHAT, 55))
                # ride on every 8th during bar 19 (builds momentum)
                drum_ev.append((t + eighth, RIDE, 60))
    # bar 19: snare roll leading into the blast (16ths)
    for i in range(16):
        drum_ev.append((19 * bar + i * (PPQ // 4), SNARE, 75 + i * 2))
    # bars 20-23: BLAST — full kit at vel 110, crash on bar 20
    drum_ev.append((20 * bar, CRASH, 110))
    for b in range(20, 24):
        for beat in range(4):
            t = b * bar + beat * PPQ
            if beat in (0, 2):
                drum_ev.append((t, KICK, 110))
            if beat in (1, 3):
                drum_ev.append((t, SNARE, 110))
            # Hats + ride every 8th (doubled density for the blast)
            for e in range(2):
                hat_v = 75 if (beat % 2 == 0 and e == 0) else 65
                drum_ev.append((t + e * eighth, HHAT, hat_v))
                drum_ev.append((t + e * eighth, RIDE, 70))
            # Crash on every beat 1 of bars 21-23 (ride for sustain)
            if beat == 0 and b > 20:
                drum_ev.append((t, CRASH, 90))
    cfg["drum_pattern"] = drum_ev
_build_chase_patterns()

# ---------- 3. corridor — empty horror hallway, cinematic music box --------
# REWRITE 2026-07-13: previous version had music box playing one repeated
# 4-note motif every bar for 12 bars — 1 note/sec for the entire first
# half, plus a bar-10 silence. User flagged as "too spartan with not much
# melody at all." Now: bars 0-3 are a proper 4-bar melodic PHRASE (not a
# repeated motif), bars 4-7 add a counter-melody voice an octave below
# for warmth + bass motion, bars 8-11 escalate with a third voice and
# arpeggio motion. Bar-12 silence preserved (the scare beat — works in
# playtests), bar-13 single peak note preserved, bars 14-19 climax
# arpeggios preserved, bars 20-23 decay preserved.
# Instrument selection UNCHANGED: Music Box 11 + Warm Pad 100 + Synth
# Bass 39. Same key (C minor), same dread character — just with a real
# melodic line instead of a stuttering ostinato.
SCENES["corridor"] = {
    "name": "corridor",
    "bars": 16,
    "bpm": 60,
    # NEW A: cut from OLD corridor_b bars 8-23 — the cinematic Fm→Ab section
    # the user liked. Music Box 11 + Warm Pad 100 + Synth Bass 39, no percussion
    # (laid-back scene). 16 bars @ 60 BPM ≈ 64s raw.
    "lead": {"prog": 11, "vol": 75, "pan": 64, "reverb": 90, "mod_init": 0},  # Music Box
    "bass": {"prog": 39, "vol": 70, "reverb": 30},   # Synth Bass
    "pad":  {"prog": 100, "vol": 95, "pan": 64, "reverb": 100},   # Warm Pad
    "drums": {"vol": 0, "reverb": 0},
    "key_intervals": MINOR,
    "root": 0,
    "lead_mod_ramp": (0, 50),
    # A chords: Fm (bars 0-7) → Ab (bars 8-15). The cinematic middle the user liked.
    "pad_chords": [
        (0,  [N(5,3), N(8,3), N(0,4), N(3,4)]),       # Fm  (bars 0-7)
        (8,  [N(8,3), N(0,4), N(3,4), N(7,4)]),       # Ab  (bars 8-15)
    ],
    # Pad climbs slightly through the Ab climax.
    "pad_vel_ramp": (88, 100, 16),
    # Lead vel climbs across the piece — gives it the "instruments coming in" energy.
    "lead_vel_ramp": (75, 95),
    "lead_pattern": [],
    "bass_pattern": [],
    "drum_pattern": [],
    "cross_boundary_crash": False,
}

# ---------- 4. jailbreak — urgent escape, tension synth -------------------
# SHAPE: bars 0-3 arpeggio figure in lead, pad Am, NO bass drum (rest
# before escape). bars 4-7 drum enters kick-only. Lead climbs an octave.
# bars 8-11 FULL 4-on-floor. Lead has main riff. Bass 8th-note pulse.
# TEMPO PUSH at bar 12: 120→132. bars 12-15 rebuild — bass at higher
# octave (refuses drop), lead ascending riff. bars 16-19 CLIMAX — crash,
# all vel 110, lead octave +1. bars 20-23 release — chord E, pad breakdown
# (expression drops), lead walks down, drums decay.
SCENES["jailbreak"] = {
    "name": "jailbreak",
    "bars": 24,                              # ~96s at 120 BPM (push to 132 at bar 12)
    "bpm": 120,
    "lead": {"prog": 81, "vol": 90, "pan": 64, "reverb": 45, "mod_init": 0},  # Lead 2 (sawtooth)
    "bass": {"prog": 34, "vol": 100, "reverb": 15},
    "pad":  {"prog": 101, "vol": 85, "pan": 64, "reverb": 75},
    "drums": {"vol": 100, "reverb": 25},
    "lead_vel_ramp": (75, 110),              # builds toward climax
    "key_intervals": MINOR,
    "root": 9,                               # A minor
    "lead_mod_ramp": (0, 25),
    # Tempo push at bar 12: 120 → 132 (escape picks up speed)
    "tempo_changes": [(12, 132)],
    # Pad chords: A stays the "home" pad. Bars 0-15 ring A. Bars 16-19
    # switch to E for the release after the climax.
    "pad_chords": [
        (0, [N(9,3), N(0,4), N(4,4), N(7,4)]),       # Am  (bars 0-15)
        (16, [N(4,3), N(7,3), N(11,3), N(2,4)]),     # E   (bars 16-19, climax)
        (20, [N(4,3), N(7,3), N(11,3), N(2,4)]),     # E   (bars 20-23, release)
    ],
    # Pad breakdown at bars 20-23 (chord fades during release).
    "pad_breakdowns": [(20, 24)],
    "bass_pattern": [],       # built by _build_jailbreak_patterns
    "lead_pattern": [],       # built by _build_jailbreak_patterns
    "drum_pattern": [],       # built by _build_jailbreak_patterns
    "cross_boundary_crash": True,
    "crash_velocity": 110,
}
def _build_jailbreak_patterns():
    bar = PPQ * BEATS_PER_BAR
    eighth = PPQ // 2
    cfg = SCENES["jailbreak"]

    # ----- BASS ------------------------------------------------------------
    bass_ev = []
    chord_roots = [9, 9, 9, 9, 9, 9]   # all A for bars 0-15 (just the root)
    # bars 0-3: SILENT bass (rest before escape)
    for b in range(0, 4):
        bass_ev.append((b * bar, [(None, PPQ*4, 0)]))
    # bars 4-7: bass enters — root on beat 1 only (kick-driven)
    for b in range(4, 8):
        bass_ev.append((b * bar, [(N(9,1), PPQ, 0), (N(9,2), PPQ*3, 0)]))
    # bars 8-11: 8th-note pulse (full escape)
    for b in range(8, 12):
        root = N(9, 1)
        fifth = N(4, 2)
        for beat in range(4):
            t = b * bar + beat * PPQ
            bass_ev.append((t, [(root, eighth, 0), (fifth, eighth, 0)]))
    # bars 12-15: rebuild — bass pulse at HIGHER octave (refuses drop)
    for b in range(12, 16):
        root_hi = N(9, 2)
        fifth_hi = N(4, 3)
        for beat in range(4):
            t = b * bar + beat * PPQ
            bass_ev.append((t, [(root_hi, eighth, 0), (fifth_hi, eighth, 0)]))
    # bars 16-19: climax — even higher + extra 5th
    for b in range(16, 20):
        root_hi = N(9, 2)
        fifth_hi = N(4, 3)
        for beat in range(4):
            t = b * bar + beat * PPQ
            bass_ev.append((t, [(root_hi, eighth, 0), (fifth_hi, eighth, 0),
                                 (root_hi, eighth, 0), (fifth_hi + 7, eighth, 0)]))
    # bars 20-23: release — bass walks down (A→G→F→E)
    descend = [N(9,1), N(7,1), N(4,1), N(2,1)]
    for b in range(20, 24):
        t = b * bar
        for beat, n in enumerate(descend):
            bass_ev.append((t + beat * PPQ, [(n, PPQ, 0)]))
    cfg["bass_pattern"] = bass_ev

    # ----- LEAD ------------------------------------------------------------
    # bars 0-3: arpeggio figure (Am arpeggio in mid register)
    lead_ev = []
    arp_a = [N(9,4), N(0,5), N(4,5), N(7,5)]
    for b in range(0, 4):
        t = b * bar
        for i, n in enumerate(arp_a):
            lead_ev.append((t + i * PPQ, [(n, PPQ, 0)]))
    # bars 4-7: lead climbs an octave (A arpeggio in high register)
    arp_hi = [N(9,5), N(0,6), N(4,6), N(7,6)]
    for b in range(4, 8):
        t = b * bar
        for i, n in enumerate(arp_hi):
            lead_ev.append((t + i * PPQ, [(n, PPQ, 0)]))
    # bars 8-11: main riff — descending saw pattern
    main_riff = [N(4,5), N(2,5), N(0,5), N(11,4), N(9,4), N(7,4), N(4,5), N(9,4)]
    for b in range(8, 12):
        t = b * bar
        for i, n in enumerate(main_riff):
            lead_ev.append((t + i * eighth, [(n, eighth, 0)]))
    # bars 12-15: ASCENDING riff (vs descent) — refuses drop
    asc_riff = [N(7,4), N(9,4), N(11,4), N(0,5), N(2,5), N(4,5), N(7,5), N(9,5)]
    for b in range(12, 16):
        t = b * bar
        for i, n in enumerate(asc_riff):
            lead_ev.append((t + i * eighth, [(n, eighth, 0)]))
    # bars 16-19: CLIMAX — lead at octave +1, big ascending sweep
    climax = [N(4,6), N(7,6), N(9,6), N(11,6), N(0,7), N(7,6), N(4,6), N(2,6)]
    for b in range(16, 20):
        t = b * bar
        for i, n in enumerate(climax):
            lead_ev.append((t + i * eighth, [(n, eighth, 0)]))
    # bars 20-23: release — lead walks down, sparser
    walk_dn = [N(4,5), N(2,5), N(0,5), N(9,4)]
    for b in range(20, 24):
        t = b * bar
        for beat, n in enumerate(walk_dn):
            lead_ev.append((t + beat * PPQ, [(n, PPQ, -5)]))
    cfg["lead_pattern"] = lead_ev

    # ----- DRUMS -----------------------------------------------------------
    drum_ev = []
    # bars 0-3: NO bass drum — just a hat hint
    for b in range(0, 4):
        for beat in range(4):
            t = b * bar + beat * PPQ
            drum_ev.append((t + eighth, HHAT, 25))   # ghost hats only
    # bars 4-7: kick-only pulse
    for b in range(4, 8):
        drum_ev.append((b * bar, KICK, 85))
    # bars 8-11: FULL 4-on-floor (kick+snare+hats+open hat)
    for b in range(8, 12):
        for beat in range(4):
            t = b * bar + beat * PPQ
            if beat in (0, 2):
                drum_ev.append((t, KICK, 100 if beat == 0 else 95))
            if beat in (1, 3):
                drum_ev.append((t, SNARE, 94))
            for e in range(2):
                hat_note = HHAT_OPEN if (beat == 3 and e == 1) else HHAT
                hat_v = 55 if beat in (1, 3) else 45
                drum_ev.append((t + e * eighth, hat_note, hat_v))
    # bars 12-15: rebuild — kick+snare, hats still there but tighter
    for b in range(12, 16):
        for beat in range(4):
            t = b * bar + beat * PPQ
            if beat in (0, 2):
                drum_ev.append((t, KICK, 100 if beat == 0 else 95))
            if beat in (1, 3):
                drum_ev.append((t, SNARE, 95))
            for e in range(2):
                drum_ev.append((t + e * eighth, HHAT, 50))
    # bars 16-19: CLIMAX — crash, all elements vel 110, plus ride
    drum_ev.append((16 * bar, CRASH, 110))
    for b in range(16, 20):
        for beat in range(4):
            t = b * bar + beat * PPQ
            if beat in (0, 2):
                drum_ev.append((t, KICK, 110))
            if beat in (1, 3):
                drum_ev.append((t, SNARE, 110))
            for e in range(2):
                hat_v = 65 if (beat % 2 == 0 and e == 0) else 55
                drum_ev.append((t + e * eighth, HHAT, hat_v))
                drum_ev.append((t + e * eighth, RIDE, 65))
    # bars 20-23: release — drums decay (kick+snare fade, no hats)
    for b in range(20, 24):
        decay_v = 100 - (b - 20) * 25  # 100, 75, 50, 25
        for beat in range(4):
            t = b * bar + beat * PPQ
            if beat == 0:
                drum_ev.append((t, KICK, decay_v))
            if beat == 2:
                drum_ev.append((t, SNARE, decay_v))
    cfg["drum_pattern"] = drum_ev
_build_jailbreak_patterns()

# ---------- 4c. jailbreak_c — tempo push climax, lead screams ---------
# 24 bars @ 120→132 BPM. The tempo push from A continues; kit becomes
# tom-driven for the peak. Lead climbs an octave. Bass has 8th-note
# urgency. The pursuit peaks here.
SCENES_B["jailbreak_c"] = {
    "name": "jailbreak_c",
    "bars": 24,
    "bpm": 120,
    "lead": {"prog": 81, "vol": 100, "pan": 64, "reverb": 50, "mod_init": 20},
    "bass": {"prog": 38, "vol": 100, "reverb": 15},
    "pad":  {"prog": 89, "vol": 70, "pan": 64, "reverb": 60},
    "drums": {"vol": 90, "reverb": 25},
    "lead_mod_ramp": (20, 80),
    "lead_vel_ramp": (95, 115),
    "key_intervals": MINOR,
    "root": 9,                                 # A minor (same as A)
    "pad_chords": [
        (0,  [N(9,3), N(0,4), N(4,4), N(7,4)]),       # Am
        (8,  [N(9,3), N(0,4), N(4,4), N(9,4)]),       # Am (add 9)
        (16, [N(4,3), N(7,3), N(11,3), N(2,4)]),      # Dm (relative)
    ],
    "pad_vel_ramp": (80, 95, 24),
    "pad_breakdowns": [],
    "lead_pattern": [],
    "bass_pattern": [],
    "drum_pattern": [],
    "tempo_changes": [(12, 132)],               # tempo push at bar 12
}

def _build_jailbreak_c_patterns():
    """Tempo push climax: 16th-note bass, tom-driven kit, lead screams.

    2026-07-15 targeted rewrite: lead was a literal every-2-bars Am
    arpeggio loop (same 4 notes 12x), bass was the same 8-note 16th
    pattern x12. Replaced with 3 distinct lead phrases (bars 0-7,
    8-15, 16-23) and 3 distinct bass patterns. Each phrase has a
    different melodic contour: ascending arpeggio, descending with
    neighbor-tone return, and octave leap + held descent.
    """
    cfg = SCENES_B["jailbreak_c"]
    bar = PPQ * BEATS_PER_BAR
    SIXTEENTH = PPQ // 4
    EIGHTH = PPQ // 2
    QUARTER = PPQ
    bass_ev = []
    lead_ev = []
    drum_ev = []
    # ---- Bass: 3 distinct 16th-note patterns ----
    # Pattern A (bars 0-7): root + 5th pedal with octave pulse
    bass_A = []
    for _ in range(8):
        bass_A += [
            (N(9,1), SIXTEENTH, 0), (N(9,2), SIXTEENTH, 0),
            (N(9,1), SIXTEENTH, 0), (N(4,2), SIXTEENTH, 0),
            (N(9,1), SIXTEENTH, 0), (N(9,2), SIXTEENTH, 0),
            (N(9,1), SIXTEENTH, 0), (N(0,2), SIXTEENTH, 0),
        ]
    bass_ev.append((0, bass_A))
    # Pattern B (bars 8-15): chromatic approach with neighbor tones
    bass_B = []
    for _ in range(8):
        bass_B += [
            (N(9,1), SIXTEENTH, 0), (N(9,2), SIXTEENTH, 0),
            (N(8,1), SIXTEENTH, 0), (N(9,1), SIXTEENTH, 0),
            (N(9,1), SIXTEENTH, 0), (N(4,2), SIXTEENTH, 0),
            (N(2,2), SIXTEENTH, 0), (N(4,2), SIXTEENTH, 0),
        ]
    bass_ev.append((PPQ*32, bass_B))
    # Pattern C (bars 16-23): syncopated, rests on the 1 of every 2nd bar
    bass_C = []
    for i in range(8):
        if i % 2 == 1:
            # Bar starts with a rest (one 8th), then drives
            bass_C += [
                (None, EIGHTH, 0),
                (N(9,2), SIXTEENTH, 0), (N(9,1), SIXTEENTH, 0),
                (N(4,2), SIXTEENTH, 0), (N(9,2), SIXTEENTH, 0),
                (N(9,1), SIXTEENTH, 0), (N(4,2), SIXTEENTH, 0),
                (N(0,2), SIXTEENTH, 0), (N(4,2), SIXTEENTH, 0),
            ]
        else:
            bass_C += [
                (N(9,1), SIXTEENTH, 0), (N(9,2), SIXTEENTH, 0),
                (N(9,1), SIXTEENTH, 0), (N(4,2), SIXTEENTH, 0),
                (N(9,1), SIXTEENTH, 0), (N(9,2), SIXTEENTH, 0),
                (N(4,2), SIXTEENTH, 0), (N(7,2), SIXTEENTH, 0),
            ]
    bass_ev.append((PPQ*64, bass_C))
    cfg["bass_pattern"] = bass_ev
    # ---- Lead: 3 distinct phrases ----
    # Phrase 1 (bars 0-7): ascending A minor arpeggio with chromatic pickup
    for b in range(0, 8, 2):
        t = b * bar
        # Am arpeggio C5-A4-C5-E5 with eighth-rhythm and held descent
        lead_ev.append((t, [
            (N(8,4), EIGHTH, 0), (N(9,4), EIGHTH, 5),
            (N(0,5), EIGHTH, 8), (N(4,5), EIGHTH, 5),
            (N(0,5), EIGHTH, 0), (N(9,4), QUARTER, -3),
        ]))
    # Phrase 2 (bars 8-15): descending with neighbor-tone return + octave leap
    for b in range(8, 16, 2):
        t = b * bar
        # Start high (E5), leap down to A4, climb back with neighbors
        lead_ev.append((t, [
            (N(4,5), EIGHTH, 5), (N(2,5), EIGHTH, 3),
            (N(0,5), EIGHTH, 0), (N(9,4), EIGHTH, -3),
            (N(9,4), EIGHTH, 0), (N(0,5), QUARTER, 3),
            (N(4,5), QUARTER, 5),
        ]))
    # Phrase 3 (bars 16-23): octave leap + held descent (climax)
    for b in range(16, 24, 2):
        t = b * bar
        # A4 (low) → A5 (octave leap up) → stepwise descent
        lead_ev.append((t, [
            (N(9,4), EIGHTH, 0),
            (N(9,5), QUARTER, 10),
            (N(7,5), EIGHTH, 5), (N(4,5), EIGHTH, 3),
            (N(2,5), EIGHTH, 0), (N(0,5), EIGHTH, -3),
            (N(9,4), QUARTER, 0),
        ]))
    cfg["lead_pattern"] = lead_ev
    # Drums: 4-on-floor + tom fills every 4 bars
    KICK = 36; SNARE = 38; TOM_HI = 50; TOM_MID = 47; TOM_LO = 45; HAT = 42; RIDE = 51
    for b in range(24):
        t = b * bar
        for beat in range(4):
            drum_ev.append((t + beat * PPQ, KICK, 100))
        drum_ev.append((t + PPQ, SNARE, 95))
        drum_ev.append((t + PPQ*3, SNARE, 95))
        for e in range(8):
            drum_ev.append((t + e * EIGHTH, HAT, 80))
        if b % 4 == 3:
            drum_ev.append((t + PPQ*2, TOM_HI, 90))
            drum_ev.append((t + PPQ*2 + EIGHTH, TOM_MID, 85))
            drum_ev.append((t + PPQ*3, TOM_LO, 90))
    cfg["drum_pattern"] = list(drum_ev)
_build_jailbreak_c_patterns()

# ---------- 4d. jailbreak_d — caught glimpse, the dread moment ----------
# 16 bars @ 60 BPM (half-time). Kit stripped to heartbeat. Bass drops
# to sub-octave drone. Lead: single held high A5 with heavy vibrato.
# The chase caught a glimpse — the pursuer is closer than we thought.
SCENES_B["jailbreak_d"] = {
    "name": "jailbreak_d",
    "bars": 16,
    "bpm": 60,
    "lead": {"prog": 81, "vol": 90, "pan": 64, "reverb": 80, "mod_init": 0},
    "bass": {"prog": 38, "vol": 70, "reverb": 60},
    "pad":  {"prog": 89, "vol": 60, "pan": 64, "reverb": 90},
    "drums": {"vol": 50, "reverb": 60},         # heartbeat only
    "lead_mod_ramp": (0, 110),                  # HEAVY vibrato
    "lead_vel_ramp": (95, 105),
    "key_intervals": MINOR,
    "root": 9,                                 # A minor
    "pad_chords": [
        (0, [N(9,3), N(2,4), N(5,4), N(9,4)]),        # Am9 (dark color)
        (8, [N(4,3), N(9,3), N(0,4), N(4,4)]),       # Dm9 (relative)
    ],
    "pad_vel_ramp": (50, 40, 16),
    "pad_breakdowns": [],
    "lead_pattern": [],
    "bass_pattern": [],
    "drum_pattern": [],
}

def _build_jailbreak_d_patterns():
    """Caught glimpse: heartbeat kit, sub-octave bass drone, sparse lead motif.

    2026-07-15 targeted rewrite: lead was 7 sparse phrases on A5 with
    tiny ornaments (basically one pitch). Replaced with a real melodic
    arc: A5 → C6 → Bb5 → G5 → F5 (descending fifth across the loop) —
    gives the breath a direction instead of a stutter. Bass replaced
    its 4 literal A1+Bb2 repeats with 4 distinct sub-octave cells that
    vary the rhythm and add C2/G1 movement, so the dread texture moves
    instead of pulsing.
    """
    cfg = SCENES_B["jailbreak_d"]
    bar = PPQ * BEATS_PER_BAR
    EIGHTH = PPQ // 2
    QUARTER = PPQ
    HALF = PPQ * 2
    bass_ev = []
    lead_ev = []
    drum_ev = []
    # ---- Bass: 4 distinct sub-octave cells, not 4 literal copies ----
    bass_pattern = [
        # Cell 1 (bars 0-3): A1 drone + Bb2 ghost on beat 3
        (0, [(N(9,1), PPQ*12, 0), (N(2,2), EIGHTH, -10)]),
        # Cell 2 (bars 4-7): A1 + descending ghost (A1 → G1 → A1)
        (PPQ*16, [
            (N(9,1), PPQ*4, 0),
            (N(7,1), PPQ*2, -5), (N(9,1), PPQ*2, 0),
            (N(7,1), PPQ*2, -5), (N(9,1), PPQ*2, -5),
            (None, PPQ*2, 0),
            (N(9,1), PPQ*2, 0),
        ]),
        # Cell 3 (bars 8-11): A1 + C2 (relative minor third lift)
        (PPQ*32, [
            (N(9,1), PPQ*8, 0),
            (N(0,2), PPQ*4, -3),
            (N(0,2), EIGHTH, -10), (N(9,1), PPQ*4, 0),
        ]),
        # Cell 4 (bars 12-15): A1 + E1 (descending fifth lift) → bend setup
        (PPQ*48, [
            (N(9,1), PPQ*4, 0),
            (N(4,1), PPQ*4, -3),
            (N(9,1), PPQ*4, 0),
            (N(8,1), PPQ*2, -3), (N(9,1), PPQ*2, -8),
        ]),
    ]
    cfg["bass_pattern"] = bass_pattern
    # ---- Lead: real melodic arc (descending fifth), sparse placement ----
    # Each phrase stays short (≤ 2 beats) so FluidSynth's Tenor Sax
    # keeps each note audible (cf. pitfall from prior session).
    lead_phrases = [
        (PPQ*4,   [(N(9,5), QUARTER, 0), (None, EIGHTH, 0), (N(9,5), EIGHTH, -5)]),    # bar 1: A5 stutter (sets root)
        (PPQ*12,  [(N(0,6), QUARTER, 5), (None, EIGHTH, 0), (N(0,6), EIGHTH, 0)]),     # bar 3: C6 leap up (interval of a 3rd)
        (PPQ*20,  [(N(10,5), EIGHTH, 0), (None, QUARTER, 0), (N(10,5), EIGHTH, -3)]),  # bar 5: Bb5
        (PPQ*28,  [(N(9,5), EIGHTH, 0), (N(7,5), QUARTER, 0), (None, EIGHTH, 0)]),     # bar 7: A5 → G5 descent
        (PPQ*36,  [(N(7,5), EIGHTH, 0), (None, EIGHTH, 0), (N(5,5), EIGHTH, 0),
                   (N(5,5), QUARTER, -3)]),                                          # bar 9: G5 → F5 (descent continues)
        (PPQ*44,  [(N(5,5), QUARTER, 0), (None, EIGHTH, 0), (N(5,5), EIGHTH, -5)]),   # bar 11: F5 alone
        (PPQ*52,  [(N(5,5), EIGHTH, 0), (N(4,5), EIGHTH, 0), (N(2,5), QUARTER, -5)]), # bar 13: F5 → E5 → D5 (descending)
        # bars 15-16: bend down a half-step (the voice catches)
        (PPQ*60,  [(N(8,5), PPQ*4, -5)]),                                            # bar 15: Ab5 descent
    ]
    cfg["lead_pattern"] = lead_phrases
    # Drums: heartbeat only — same as before (sparse kit, working as intended)
    KICK = 36; SNARE = 38; RIDE = 51
    for b in range(16):
        t = b * bar
        drum_ev.append((t, KICK, 60))
        drum_ev.append((t + PPQ*2, SNARE, 55))
        drum_ev.append((t + PPQ, RIDE, 65))
        drum_ev.append((t + PPQ*3, RIDE, 65))
    cfg["drum_pattern"] = list(drum_ev)
_build_jailbreak_d_patterns()

# ---------- 4e. jailbreak_e — escape acceleration, loop seam ----------
# 24 bars @ 60→120 BPM (half-time lift to full tempo at bar 12).
# Kit comes back bar-by-bar. Lead climbs back to A's register. Last 4
# bars mirror A's opening for seamless loop seam.
SCENES_B["jailbreak_e"] = {
    "name": "jailbreak_e",
    "bars": 24,
    "bpm": 60,
    "lead": {"prog": 81, "vol": 95, "pan": 64, "reverb": 50, "mod_init": 30},
    "bass": {"prog": 38, "vol": 95, "reverb": 20},
    "pad":  {"prog": 89, "vol": 80, "pan": 64, "reverb": 70},
    "drums": {"vol": 85, "reverb": 30},
    "lead_mod_ramp": (110, 30),                 # vibrato decays as we recover
    "lead_vel_ramp": (90, 110),
    "key_intervals": MINOR,
    "root": 9,                                 # A minor
    "pad_chords": [
        (0,  [N(9,3), N(0,4), N(4,4), N(7,4)]),       # Am
        (12, [N(9,3), N(0,4), N(4,4), N(9,4)]),       # Am (add 9)
        (20, [N(9,3), N(0,4), N(4,4), N(7,4)]),       # Am (seam to A)
    ],
    "pad_vel_ramp": (60, 95, 24),
    "pad_breakdowns": [],
    "lead_pattern": [],
    "bass_pattern": [],
    "drum_pattern": [],
    "tempo_changes": [(12, 120)],               # half-time lift to full tempo
}

def _build_jailbreak_e_patterns():
    """Escape: kit returns bar-by-bar, tempo lifts at bar 12, loop seam."""
    cfg = SCENES_B["jailbreak_e"]
    bar = PPQ * BEATS_PER_BAR
    EIGHTH = PPQ // 2
    bass_ev = []
    lead_ev = []
    drum_ev = []
    KICK = 36; SNARE = 38; HAT = 42; RIDE = 51; CRASH = 49
    # Bass: 8th-note pulse, A1 alternates with A2
    for b in range(24):
        t = b * bar
        for beat in range(4):
            bass_ev.append((t + beat * PPQ, [
                (N(9,1), EIGHTH, 0), (N(9,2), EIGHTH, 0),
            ]))
    cfg["bass_pattern"] = bass_ev
    # Lead: climbing back — low at first, then up to A's register
    # bars 0-7: low register (post-scare)
    lead_ev.append((0, [
        (N(9,4), PPQ*2, -10), (N(7,4), PPQ*2, -10),
        (N(4,4), PPQ*2, -10), (N(0,4), PPQ*2, -10),
    ]))
    lead_ev.append((PPQ*16, [
        (N(9,4), PPQ*2, -5), (N(0,5), PPQ*2, -3),
        (N(4,4), PPQ*2, -5), (N(7,4), PPQ*2, -5),
    ]))
    # bars 8-15: mid register, climbing
    lead_ev.append((PPQ*32, [
        (N(9,4), PPQ*2, 0), (N(0,5), PPQ*2, 3),
        (N(4,5), PPQ*2, 5), (N(7,5), PPQ*2, 5),
    ]))
    lead_ev.append((PPQ*48, [
        (N(9,5), PPQ*2, 5), (N(7,5), PPQ*2, 5),
        (N(4,5), PPQ*2, 3), (N(0,5), PPQ*2, 0),
    ]))
    # bars 16-23: high register, A's opening shape
    for b in range(16, 24, 2):
        t = b * bar
        motif = [N(9,4), N(0,5), N(4,5), N(0,5)]
        for i, n in enumerate(motif):
            vel = 3 + i
            lead_ev.append((t + i * EIGHTH, [(n, EIGHTH, vel)]))
    cfg["lead_pattern"] = lead_ev
    # Drums: kit returns bar-by-bar
    # 2026-07-14 bug: previous version used vdelta=0 which produced
    # velocity 0 (silent note_on) for KICK/SNARE/RIDE — only HAT
    # played audibly (vdelta=-10 against base 128 = 118). Now using
    # direct absolute velocities like chase does.
    # bars 0-3: heartbeat (kick on 1, ride ghosts)
    for b in range(4):
        t = b * bar
        drum_ev.append((t, KICK, 95))
        drum_ev.append((t + PPQ*2, RIDE, 55))
    # bars 4-7: add snare on 3 + hats
    for b in range(4, 8):
        t = b * bar
        drum_ev.append((t, KICK, 95))
        drum_ev.append((t + PPQ*2, SNARE, 85))
        for e in range(8):
            drum_ev.append((t + e * (PPQ//2), HAT, 95))
        drum_ev.append((t + PPQ, RIDE, 60))
        drum_ev.append((t + PPQ*3, RIDE, 60))
    # bars 8-11: half-time 4-on-floor
    for b in range(8, 12):
        t = b * bar
        for beat in range(4):
            drum_ev.append((t + beat * PPQ, KICK, 95))
        drum_ev.append((t + PPQ, SNARE, 85))
        drum_ev.append((t + PPQ*3, SNARE, 85))
        for e in range(8):
            drum_ev.append((t + e * (PPQ//2), HAT, 100))
    # bar 12: tempo lift crash + full 4-on-floor (CRASH = 49)
    drum_ev.append((PPQ*48, CRASH, 110))
    drum_ev.append((PPQ*48, KICK, 110))
    drum_ev.append((PPQ*48, SNARE, 110))
    # bars 12-23: full 4-on-floor + ride
    for b in range(12, 24):
        t = b * bar
        for beat in range(4):
            drum_ev.append((t + beat * PPQ, KICK, 100))
        drum_ev.append((t + PPQ, SNARE, 90))
        drum_ev.append((t + PPQ*3, SNARE, 90))
        for e in range(8):
            drum_ev.append((t + e * (PPQ//2), HAT, 90))
        drum_ev.append((t + PPQ*2, RIDE, 70))
    cfg["drum_pattern"] = list(drum_ev)
_build_jailbreak_e_patterns()

# ---------- 5. kabukicho — neon jazz noir, smoky bar, F minor -------------
# SHAPE: A A' B A'' — 16-bar jazz form.
# bars 0-3 (A): tenor sax melody + walking bass + brushed kit.
# bars 4-7 (A'): sax continues with variation (different ending),
#   piano-pad enters softly.
# bars 8-11 (B): sax "solo" — different pattern, more notes; bass walks
#   higher. This is the B-section swell.
# bars 12-15 (A''): sax returns to opening theme (jump-cut feel);
#   piano-pad louder.
# KEEP at 88 BPM (no tempo change).
# bass_vel_ramp (60→100) climbs across loop for the B-section swell.
# pad_vel_ramp climbs expression 0→110 across loop, peaking around bar 11.
SCENES["kabukicho"] = {
    "name": "kabukicho",
    "bars": 16,                              # ~70s at 88 BPM
    "bpm": 88,
    "lead": {"prog": 66, "vol": 95, "pan": 64, "reverb": 50, "mod_init": 30},  # Tenor Sax
    "bass": {"prog": 32, "vol": 90, "reverb": 25},   # Upright Bass (acoustic)
    "pad":  {"prog": 89, "vol": 75, "pan": 64, "reverb": 80},   # New Age / Warm Pad
    "drums": {"vol": 85, "reverb": 30},      # brushed, lower volume
    "lead_vel_ramp": (75, 105),              # softer A, louder B (sax "solo")
    "key_intervals": MINOR,
    "root": 5,                               # F minor (jazz noir)
    "lead_mod_ramp": (30, 50),               # sax vibrato throughout
    # bass_vel_ramp: 60→100 across loop (B-section peak around bar 11)
    "bass_vel_ramp": (60, 100),
    # pad_vel_ramp: 0→110 climbing across loop, hits 110 around bar 10
    "pad_vel_ramp": (0, 110, 11),
    # Pad chords: pad enters at bar 4 (so bars 0-3 are sax+bass+brushes
    # only — A section is solo-trio). New Age warm pad rings long.
    "pad_chords": [
        (4,  [N(5,3), N(8,3), N(0,4), N(3,4)]),       # Fm7 (A' onwards)
        (8,  [N(8,3), N(0,4), N(3,4), N(7,4)]),       # Abmaj7 (B)
        (12, [N(5,3), N(8,3), N(0,4), N(3,4)]),       # Fm7 (A'' return)
    ],
    "lead_pattern": [],       # built by _build_kabukicho_patterns
    "bass_pattern": [],       # built by _build_kabukicho_patterns
    "drum_pattern": [],       # built by _build_kabukicho_patterns
    "cross_boundary_crash": False,           # jazz doesn't crash
    "crash_velocity": 70,
}
def _build_kabukicho_patterns():
    bar = PPQ * BEATS_PER_BAR
    eighth = PPQ // 2
    cfg = SCENES["kabukicho"]

    # ----- BASS (walking, climbs in B section) ----------------------------
    # Bars 0-3 (A): walking on Fm — root, 5th, approach, root
    # Bars 4-7 (A'): walking with Fm7 colour — slight variation
    # Bars 8-11 (B): walking HIGHER (octave up) for the bridge — bass swells
    # Bars 12-15 (A''): return to low F walking — jump-cut feel
    bass_ev = []
    walk_a = [
        (N(5,1), PPQ), (N(8,1), PPQ), (N(10,1), PPQ), (N(3,2), PPQ),
    ]
    walk_a2 = [
        (N(5,1), PPQ), (N(8,1), PPQ), (N(3,2), PPQ),  (N(10,1), PPQ),
    ]
    walk_a3 = [
        (N(5,1), PPQ), (N(3,2), PPQ), (N(10,1), PPQ), (N(8,1), PPQ),
    ]
    walk_a4 = [
        (N(5,1), PPQ), (N(8,1), PPQ), (N(10,1), PPQ), (N(0,2), PPQ),
    ]
    walk_b = [
        (N(5,2), PPQ), (N(8,2), PPQ), (N(10,2), PPQ), (N(3,3), PPQ),
    ]
    walk_b2 = [
        (N(5,2), PPQ), (N(8,2), PPQ), (N(3,3), PPQ),  (N(10,2), PPQ),
    ]
    walk_b3 = [
        (N(5,2), PPQ), (N(3,3), PPQ), (N(10,2), PPQ), (N(8,2), PPQ),
    ]
    walk_b4 = [
        (N(5,2), PPQ), (N(8,2), PPQ), (N(10,2), PPQ), (N(0,3), PPQ),
    ]
    walks_low = [walk_a, walk_a2, walk_a3, walk_a4]
    walks_high = [walk_b, walk_b2, walk_b3, walk_b4]
    for b in range(0, 16):
        walk = walks_low[b % 4] if b < 8 else walks_high[b % 4]
        cursor = b * bar
        for n, d in walk:
            bass_ev.append((cursor, [(n, d, 0)]))
            cursor += d
    cfg["bass_pattern"] = bass_ev

    # ----- LEAD (sax) ------------------------------------------------------
    lead_ev = []
    # A (bars 0-3): opening theme — lyrical tenor melody on Fm
    theme_a = [
        (N(5,5), PPQ),       # F5 QUARTER
        (N(8,5), PPQ),       # Ab5
        (N(10,5), PPQ),      # Bb5
        (N(8,5), PPQ),       # Ab5
        (N(10,5), PPQ),      # Bb5
        (N(5,5), eighth),    # F5 8th
        (N(3,5), eighth),    # Eb5
        (N(5,5), PPQ),       # F5 QUARTER
    ]
    cursor = 0
    for n, d in theme_a:
        lead_ev.append((cursor, [(n, d, 0)]))
        cursor += d
    # bar 1
    cursor = bar
    cont_a = [(N(8,5), PPQ*2), (N(5,5), PPQ*2)]
    for n, d in cont_a:
        lead_ev.append((cursor, [(n, d, 0)]))
        cursor += d
    # bar 2
    lead_ev.append((2 * bar, [(N(8,5), PPQ*2, 0), (N(5,5), PPQ*2, 0)]))
    # bar 3 — end of phrase, held note
    lead_ev.append((3 * bar, [(N(3,5), PPQ*4, 0)]))

    # A' (bars 4-7): variation — different ending
    var_a = [
        (N(5,5), PPQ),
        (N(8,5), PPQ),
        (N(10,5), PPQ),
        (N(5,6), PPQ),       # high F6 leap up
        (N(10,5), PPQ),
        (N(8,5), eighth),
        (N(5,5), eighth),
        (N(3,5), PPQ),
    ]
    cursor = 4 * bar
    for n, d in var_a:
        lead_ev.append((cursor, [(n, d, 0)]))
        cursor += d
    cursor = 5 * bar
    lead_ev.append((cursor, [(N(8,5), PPQ*2, 0), (N(5,5), PPQ*2, 0)]))
    cursor = 6 * bar
    lead_ev.append((cursor, [(N(10,5), PPQ, 0), (N(8,5), PPQ, 0),
                              (N(5,5), PPQ*2, 0)]))
    cursor = 7 * bar
    lead_ev.append((cursor, [(N(8,5), PPQ*4, 0)]))

    # B (bars 8-11): SAX SOLO — runs of 8ths, climbs higher (more notes)
    solo = [
        N(5,5), N(8,5), N(10,5), N(0,6), N(3,6), N(5,6), N(3,6), N(0,6),
        N(10,5), N(8,5), N(5,5), N(3,5), N(5,5), N(8,5), N(10,5), N(8,5),
        N(5,5), N(8,5), N(10,5), N(0,6), N(5,6), N(3,6), N(0,6), N(10,5),
        N(8,5), N(10,5), N(5,5), N(8,5), N(3,5), N(5,5), N(8,5), N(10,5),
    ]
    for b in range(8, 12):
        cursor = b * bar
        for n in solo:
            lead_ev.append((cursor, [(n, eighth, 0)]))
            cursor += eighth

    # A'' (bars 12-15): RETURN to opening theme (jump-cut)
    for n, d in theme_a:
        lead_ev.append((12 * bar, [(n, d, 0)]))
    cursor = 13 * bar
    for n, d in cont_a:
        lead_ev.append((cursor, [(n, d, 0)]))
        cursor += d
    lead_ev.append((14 * bar, [(N(8,5), PPQ*2, 0), (N(5,5), PPQ*2, 0)]))
    lead_ev.append((15 * bar, [(N(3,5), PPQ*4, 0)]))
    cfg["lead_pattern"] = lead_ev

    # ----- DRUMS (brushed kit) ---------------------------------------------
    drum_ev = []
    # Bars 0-15: brushed kit — kick soft, brush snare on 2+4, ride swing
    for b in range(0, 16):
        for beat in range(4):
            t = b * bar + beat * PPQ
            if beat == 0:
                drum_ev.append((t, KICK, 55))
            if beat in (1, 3):
                drum_ev.append((t, SNARE, 50))         # brushed snare — low vel
            # ride on every 8th with slight swing feel
            for e in range(2):
                drum_ev.append((t + e * eighth, RIDE, 45))
        # subtle hi-hat accent on bars 2 & 4 of each section
        if b % 4 == 1 or b % 4 == 3:
            drum_ev.append((b * bar, HHAT, 35))
    # Soft tom hits on bars 2 & 4 of each section for texture
    for b in range(0, 16, 2):
        for sub in (PPQ // 4, 3 * PPQ // 4):
            drum_ev.append((b * bar + sub, TOM_LO, 30))
    cfg["drum_pattern"] = drum_ev
_build_kabukicho_patterns()

# ---------- 5c. kabukicho_c — darker harmony, chromatic passing tones --
# 24 bars @ 90 BPM. Sax climbs into higher register with chromatic b2
# approach on bass — the bar gets smokier. Brush kit adds ghost hits.
# Pad has sharp-11th colors (Fm7#11 → Bbm7 → Db7 → Cm7).
SCENES_B["kabukicho_c"] = {
    "name": "kabukicho_c",
    "bars": 24,
    "bpm": 90,
    "lead": {"prog": 65, "vol": 95, "pan": 64, "reverb": 70, "mod_init": 30},   # Tenor Sax
    "bass": {"prog": 33, "vol": 90, "reverb": 30},                              # Fingered Bass
    "pad":  {"prog": 89, "vol": 70, "pan": 64, "reverb": 80},                   # Fantasia Pad
    "drums": {"vol": 60, "reverb": 40},                                          # Brush kit
    "lead_mod_ramp": (30, 70),
    "lead_vel_ramp": (85, 105),
    "key_intervals": MINOR,
    "root": 5,                                 # F minor
    "pad_chords": [
        (0,  [N(5,3), N(8,3), N(0,4), N(6,4)]),       # Fm7#11
        (8,  [N(10,3), N(1,4), N(5,4), N(10,4)]),     # Bbm7
        (16, [N(1,3), N(5,3), N(10,3), N(3,4)]),      # Db7
    ],
    "pad_vel_ramp": (70, 90, 24),
    "pad_breakdowns": [],
    "lead_pattern": [],
    "bass_pattern": [],
    "drum_pattern": [],
}

def _build_kabukicho_c_patterns():
    """Darker: chromatic b2 on bass, sax climbs, brush ghosts.

    2026-07-15 targeted rewrite: bass used the same 8-note F-minor
    walking frame 7 times across 24 bars. Replaced with 4 distinct
    walking patterns (ascending arpeggio, chromatic approach, dominant
    descent, pedal tone with neighbor). Lead climbs were also a literal
    every-4-bars repeat of one of two motifs — replaced with 4 distinct
    sax phrases (chromatic b2 bend, inverted descent, register leap,
    lyrical high phrase) that don't reuse earlier contours.
    """
    cfg = SCENES_B["kabukicho_c"]
    bar = PPQ * BEATS_PER_BAR
    EIGHTH = PPQ // 2
    QUARTER = PPQ
    bass_ev = []
    lead_ev = []
    drum_ev = []
    # ---- Bass: 4 distinct walking patterns ----
    # Walk A (bars 0-3): F arpeggio ascending
    bass_ev.append((0, [
        (N(5,1), EIGHTH, 0), (N(8,1), EIGHTH, 0),
        (N(0,2), EIGHTH, 0), (N(3,2), EIGHTH, 0),
        (N(5,2), EIGHTH, 0), (N(8,2), EIGHTH, 0),
        (N(5,2), EIGHTH, 0), (N(3,2), EIGHTH, 0),
    ]))
    # Walk B (bars 4-7): Bb walking with chromatic neighbor tones
    bass_ev.append((PPQ*16, [
        (N(10,1), EIGHTH, 0), (N(11,1), EIGHTH, -3),
        (N(0,2), EIGHTH, 0), (N(1,2), EIGHTH, -3),
        (N(5,2), EIGHTH, 0), (N(8,2), EIGHTH, 0),
        (N(5,2), EIGHTH, 0), (N(3,2), EIGHTH, 0),
    ]))
    # Walk C (bar 8): chromatic b2 approach (E natural → F)
    bass_ev.append((PPQ*32, [
        (N(5,1), EIGHTH, 0), (N(4,1), EIGHTH, 0),
        (N(5,2), EIGHTH, 0), (N(8,2), EIGHTH, 0),
        (N(5,2), EIGHTH, 0), (N(3,2), EIGHTH, 0),
        (N(0,2), EIGHTH, 0), (N(5,1), EIGHTH, 0),
    ]))
    # Walk D (bars 9-15): dominant descent (Bb → Ab → G → F) with pedal
    bass_ev.append((PPQ*36, [
        (N(10,1), EIGHTH, 0), (N(8,1), EIGHTH, 0),
        (N(7,1), EIGHTH, 0), (N(5,1), EIGHTH, 0),
        (N(10,1), EIGHTH, 0), (N(8,2), EIGHTH, 0),
        (N(5,2), EIGHTH, 0), (N(3,2), EIGHTH, 0),
    ]))
    bass_ev.append((PPQ*44, [
        (N(5,1), EIGHTH, 0), (N(8,1), EIGHTH, 0),
        (N(5,2), EIGHTH, 0), (N(3,2), EIGHTH, 0),
        (N(5,2), EIGHTH, 0), (N(8,2), EIGHTH, 0),
        (N(5,2), EIGHTH, 0), (N(3,2), EIGHTH, 0),
    ]))
    # Walk E (bars 16-23): Db7 walking (dominant of F minor) back to root
    bass_ev.append((PPQ*64, [
        (N(1,1), EIGHTH, 0), (N(5,1), EIGHTH, 0),
        (N(10,1), EIGHTH, 0), (N(1,2), EIGHTH, 0),
        (N(5,2), EIGHTH, 0), (N(10,2), EIGHTH, 0),
        (N(5,2), EIGHTH, 0), (N(1,2), EIGHTH, 0),
    ]))
    bass_ev.append((PPQ*72, [
        (N(1,2), EIGHTH, 0), (N(5,2), EIGHTH, 0),
        (N(8,2), EIGHTH, 0), (N(5,2), EIGHTH, 0),
        (N(3,2), EIGHTH, 0), (N(0,2), EIGHTH, 0),
        (N(5,1), EIGHTH, 0), (N(5,1), EIGHTH, 0),
    ]))
    cfg["bass_pattern"] = bass_ev
    # ---- Lead: 4 distinct sax phrases (different contours) ----
    # Phrase 1 (bars 0-3): rising arpeggio with bluesy bend on top
    lead_ev.append((0, [
        (N(5,4), EIGHTH, -5), (N(8,4), EIGHTH, -3),
        (N(0,5), EIGHTH, 0), (N(3,5), EIGHTH, 0),
        (N(5,5), QUARTER, 3),
    ]))
    # Phrase 2 (bars 4-7): inverted descent (high → low with neighbor)
    lead_ev.append((PPQ*16, [
        (N(8,5), EIGHTH, 5), (N(7,5), EIGHTH, 3),
        (N(5,5), EIGHTH, 0), (N(4,5), EIGHTH, -3),
        (N(5,5), QUARTER, 0),
    ]))
    # Phrase 3 (bar 8): chromatic b2 bend over Fm (kept as anchor moment)
    lead_ev.append((PPQ*32, [
        (N(5,5), EIGHTH, 3), (N(4,5), EIGHTH, 5),
        (N(5,5), EIGHTH, 3), (N(8,5), EIGHTH, 0),
        (N(5,5), QUARTER, 0),
    ]))
    # Phrase 4 (bars 12-15): register leap (low C5 → high C6 → descent)
    lead_ev.append((PPQ*48, [
        (N(0,5), EIGHTH, -5), (None, EIGHTH, 0),
        (N(0,6), EIGHTH, 8), (N(8,5), EIGHTH, 5),
        (N(5,5), QUARTER, 0),
    ]))
    # Phrase 5 (bars 16-19): lyrical high phrase (Bb5 → Ab5 → F5)
    lead_ev.append((PPQ*64, [
        (N(10,5), EIGHTH, 5), (N(8,5), EIGHTH, 3),
        (N(5,5), EIGHTH, 0), (N(8,5), EIGHTH, 3),
        (N(5,5), QUARTER, 0),
    ]))
    # Phrase 6 (bars 20-23): held root + small ornament
    lead_ev.append((PPQ*80, [
        (N(5,5), QUARTER, 0),
        (N(8,5), EIGHTH, -3), (N(5,5), QUARTER, 0),
        (N(5,5), PPQ*2, 0),
    ]))
    cfg["lead_pattern"] = lead_ev
    # Drums: brush kit — same as before (working as intended)
    KICK = 36; BRUSH = 39; HAT = 42
    for b in range(24):
        t = b * bar
        drum_ev.append((t, [(KICK, EIGHTH, -5)]))
        drum_ev.append((t + PPQ, [(BRUSH, PPQ*2, -10)]))
        drum_ev.append((t + PPQ*3, [(BRUSH, PPQ*2, -10)]))
        for e in range(8):
            drum_ev.append((t + e * EIGHTH, [(HAT, PPQ//4, -15)]))
    cfg["drum_pattern"] = [(t, n, v) for t, notes in drum_ev for n, _, v in notes]
_build_kabukicho_c_patterns()

# ---------- 5d. kabukicho_d — single note ring-out, the sax is haunted -
# 16 bars @ 90 BPM. Forced-silence: 1-2 dim7 stabs then COMPLETE PAD
# SILENCE. ONE held sax note (C5) with heavy vibrato rings out alone.
# The smoky bar has gone quiet. The sax player isn't there anymore.
SCENES_B["kabukicho_d"] = {
    "name": "kabukicho_d",
    "bars": 20,
    "bpm": 90,
    # 2026-07-14 fix: the original "one held C5 sax for 15 bars" produced
    # an audibly empty track (RMS -44dB, sax at 0.3% of spectral peak).
    # Two problems: (a) a single continuous note_on in FluidSynth's Tenor
    # Sax patch attenuates over time (long-held notes fade to silence),
    # and (b) the bass drowned out the sax anyway. Replaced with a sparse
    # 4-bar sax phrase that breathes — D5 → F5 → E5 → G5 → F5 → D5 motif
    # with rests, layered over the breathing pad. The held-note feel is
    # preserved by overlapping the next phrase before the previous ends.
    "lead": {"prog": 65, "vol": 105, "pan": 64, "reverb": 70, "mod_init": 0},   # Tenor Sax
    "bass": {"prog": 33, "vol": 50, "reverb": 30},                               # quiet, in background
    "pad":  {"prog": 89, "vol": 40, "pan": 64, "reverb": 90},                    # low swell bed
    "drums": {"vol": 0, "reverb": 0},                                          # no kit
    "lead_mod_ramp": (0, 110),
    "lead_vel_ramp": (95, 105),
    "key_intervals": MINOR,
    "root": 5,                                 # F minor (anchor)
    # Pad swells: gentle breathing pattern with rests to keep it sparse
    "pad_chords": [
        (0,  [N(4,3), N(7,3), N(10,3), N(1,4)]),    # F# dim7 (bar 0 stab)
        (1,  [N(5,3), N(9,3), N(0,4), N(4,4)]),     # Gdim7  (bars 1-3)
        (4,  [N(5,3), N(9,3), N(0,4), N(4,4)]),     # Gdim7  (bars 4-7)
        (8,  [N(3,3), N(7,3), N(10,3), N(2,4)]),    # Ebdim7 (bars 8-11)
        (12, [N(4,3), N(7,3), N(10,3), N(1,4)]),    # F#dim7 (bars 12-15)
        (16, [N(5,3), N(8,3), N(0,4), N(3,4)]),     # Gm7    (bars 16-19)
    ],
    "pad_breakdowns": [],                            # never go fully silent
    "pad_vel_ramp": (45, 35, 20),
    "lead_pattern": [],
    "bass_pattern": [],
    "drum_pattern": [],
}

def _build_kabukicho_d_patterns():
    """Ghost-scene sparse sax melody + breathing pad + quiet bass.

    2026-07-15 targeted rewrite: the 4-bar sax motif was repeated
    LITERALLY 4 times via `for i in range(0,16,4): lead_ev.append(...)`.
    Replaced with 4 distinct variations: original, inversion, retrograde,
    and ornamented. Bass was a half-note descent F → E → Eb → D → Db →
    C held for the entire 20 bars (the "tepid" complaint) — replaced
    with 4 distinct sub-bass cells that vary register and rhythm.
    """
    cfg = SCENES_B["kabukicho_d"]
    bar = PPQ * BEATS_PER_BAR
    eighth = PPQ // 2
    quarter = PPQ
    half = PPQ * 2
    bass_ev = []
    lead_ev = []
    # Bar 0: F# dim7 stab (F#-A-C-Eb) — kept as opening marker
    lead_ev.append((0, [
        (N(6,5), quarter, 0), (N(9,5), quarter, 0),
        (N(0,6), quarter, 0), (N(3,6), quarter, 0),
    ]))
    # Variation A (bars 1-4): original motif D5/F5/E5/G5
    motif_A = [
        (N(2,5), half),     # D5
        (None,   eighth),   # rest
        (N(5,5), half),     # F5
        (None,   eighth),   # rest
        (N(4,5), half),     # E5
        (None,   eighth),   # rest
        (N(7,5), half),     # G5
        (None,   quarter),  # rest
    ]
    lead_ev.append((bar * 1, motif_A))
    # Variation B (bars 5-8): inversion (G5/E5/F5/D5)
    motif_B = [
        (N(7,5), half),     # G5
        (None,   eighth),
        (N(4,5), half),     # E5
        (None,   eighth),
        (N(5,5), half),     # F5
        (None,   eighth),
        (N(2,5), half),     # D5
        (None,   quarter),
    ]
    lead_ev.append((bar * 5, motif_B))
    # Variation C (bars 9-12): retrograde (G5/E5/F5/D5 → D5/F5/E5/G5 reversed)
    # i.e. same notes in reverse order with rhythmic variation
    motif_C = [
        (N(7,5), quarter),
        (N(4,5), quarter),
        (None,   eighth),
        (N(5,5), half),
        (N(2,5), half),
        (None,   eighth),
        (N(2,5), quarter),
    ]
    lead_ev.append((bar * 9, motif_C))
    # Variation D (bars 13-15): ornamented (D5 with neighbor E5/Eb5 + held F5)
    motif_D = [
        (N(2,5), eighth), (N(4,5), eighth), (N(2,5), eighth), (N(3,5), eighth),
        (None,   quarter),
        (N(5,5), PPQ * 3, 0),
        (None,   quarter),
    ]
    lead_ev.append((bar * 13, motif_D))
    # Bars 16-19 (final): lyrical descent (D5 → F5 → G5 → E5)
    final_motif = [
        (N(2,5), half), (N(5,5), half),
        (None,   eighth),
        (N(7,5), half), (N(4,5), half),
        (None,   quarter),
    ]
    lead_ev.append((bar * 16, final_motif))
    cfg["lead_pattern"] = lead_ev
    # ---- Bass: 4 distinct sub-bass cells instead of the literal descent ----
    # Cell 1 (bar 0): F#2 stab (matches the F#dim7 opening chord)
    bass_ev.append((0, [(N(6,1), quarter, 0), (None, PPQ*3, 0)]))
    # Cell 2 (bars 1-4): F drone + Eb2 ghost (descending semitone)
    bass_ev.append((bar * 1, [
        (N(5,1), PPQ*12, 0), (N(3,1), eighth, -10),
    ]))
    # Cell 3 (bars 5-8): Ab2 pedal (contrasts Gdim7) + C2 ghost
    bass_ev.append((bar * 5, [
        (N(8,1), PPQ*8, 0),
        (N(0,2), quarter, -8),
        (N(8,1), PPQ*4, 0),
    ]))
    # Cell 4 (bars 9-12): Bb2 walk (resolves Gdim7 motion) → F2
    bass_ev.append((bar * 9, [
        (N(10,1), half, 0),
        (N(8,1), half, -3),
        (N(5,1), PPQ*6, 0),
    ]))
    # Cell 5 (bars 13-15): F drone + neighbor G2 (returns to root in motion)
    bass_ev.append((bar * 13, [
        (N(5,1), PPQ*8, 0),
        (N(7,1), quarter, -5),
        (N(5,1), PPQ*4, 0),
    ]))
    # Bars 16-19: return to root F2 (held for 4 bars — sets up loop seam)
    bass_ev.append((bar * 16, [(N(5,1), PPQ * 16, 0)]))
    cfg["bass_pattern"] = bass_ev
_build_kabukicho_d_patterns()

# ---------- 5e. kabukicho_e — recovery, sax returns, loop seam ---------
# 24 bars @ 90 BPM. Held C5 continues from D for bars 0-1, then sax
# returns at bar 2 with A's opening shape. Walking bass returns. Last 4
# bars mirror A's opening for seamless loop.
SCENES_B["kabukicho_e"] = {
    "name": "kabukicho_e",
    "bars": 24,
    "bpm": 90,
    "lead": {"prog": 65, "vol": 95, "pan": 64, "reverb": 70, "mod_init": 30},   # Tenor Sax
    "bass": {"prog": 33, "vol": 90, "reverb": 30},                              # Fingered Bass
    "pad":  {"prog": 89, "vol": 75, "pan": 64, "reverb": 80},                   # Fantasia Pad
    "drums": {"vol": 60, "reverb": 40},                                          # Brush kit
    "lead_mod_ramp": (110, 30),                  # vibrato decays as sax recovers
    "lead_vel_ramp": (85, 100),
    "key_intervals": MINOR,
    "root": 5,                                 # F minor
    "pad_chords": [
        (0,  [N(5,3), N(8,3), N(0,4), N(5,4)]),       # Fm (return to A's chord)
        (8,  [N(8,3), N(0,4), N(3,4), N(8,4)]),       # Ab
        (16, [N(5,3), N(8,3), N(0,4), N(5,4)]),       # Fm (seam)
        (20, [N(5,3), N(8,3), N(0,4), N(5,4)]),       # Fm (seam)
    ],
    "pad_vel_ramp": (60, 85, 24),
    "pad_breakdowns": [],
    "lead_pattern": [],
    "bass_pattern": [],
    "drum_pattern": [],
}

def _build_kabukicho_e_patterns():
    """Recovery: sax returns to A's register, walking bass.

    2026-07-15 targeted rewrite: lead bars 0-3 were a held C5 for 8
    beats (FluidSynth attenuates long-held Tenor Sax to silence, same
    pitfall as kabukicho_d 2026-07-14). Replaced with breathing sax
    that fades gradually. Lead bars 8-15 used the same climbing shape
    as kabukicho_c — replaced with a distinct contour (Bb5 → Ab5 →
    G5 → F5 descent, mirroring kabukicho_d's final motif so the scene
    arc resolves). Bass bars 4-23 reused kabukicho_c's F walking frame
    — replaced with 4 distinct cells (F walk, Bb dominant, Ab pedal,
    F arpeggio climax).
    """
    cfg = SCENES_B["kabukicho_e"]
    bar = PPQ * BEATS_PER_BAR
    EIGHTH = PPQ // 2
    QUARTER = PPQ
    bass_ev = []
    lead_ev = []
    drum_ev = []
    # ---- Bass: 4 distinct cells ----
    # bars 0-1: F drone (carries over from D's final held F2)
    bass_ev.append((0, [(N(5,1), PPQ*8, -10)]))
    # bars 2-7: F walking with neighbor tones (return of the breath)
    bass_ev.append((PPQ*8, [
        (N(5,1), EIGHTH, -5), (N(6,1), EIGHTH, -8),
        (N(8,1), EIGHTH, 0), (N(0,2), EIGHTH, 0),
        (N(5,2), EIGHTH, 0), (N(3,2), EIGHTH, 0),
        (N(0,2), EIGHTH, -3), (N(5,2), EIGHTH, 0),
    ]))
    bass_ev.append((PPQ*16, [
        (N(5,2), EIGHTH, 0), (N(8,2), EIGHTH, 0),
        (N(5,2), EIGHTH, 0), (N(3,2), EIGHTH, 0),
        (N(0,2), EIGHTH, 0), (N(3,2), EIGHTH, 0),
        (N(5,2), EIGHTH, 0), (N(3,2), EIGHTH, 0),
    ]))
    # bars 8-15: Bb dominant walking (contrasts Ab from chord set; adds tension)
    bass_ev.append((PPQ*32, [
        (N(10,1), EIGHTH, 0), (N(1,2), EIGHTH, 0),
        (N(5,2), EIGHTH, 0), (N(8,2), EIGHTH, 0),
        (N(10,2), EIGHTH, 0), (N(8,2), EIGHTH, 0),
        (N(5,2), EIGHTH, 0), (N(3,2), EIGHTH, 0),
    ]))
    bass_ev.append((PPQ*40, [
        (N(10,1), EIGHTH, 0), (N(8,2), EIGHTH, 0),
        (N(5,2), EIGHTH, 0), (N(3,2), EIGHTH, 0),
        (N(5,2), EIGHTH, 0), (N(8,2), EIGHTH, 0),
        (N(5,2), EIGHTH, 0), (N(3,2), EIGHTH, 0),
    ]))
    # bars 16-23: Ab pedal (anchors Ab chord) → Fm arpeggio (seam to A)
    bass_ev.append((PPQ*64, [
        (N(8,1), PPQ*4, 0),
        (N(5,1), EIGHTH, 0), (N(8,1), EIGHTH, 0),
        (N(0,2), EIGHTH, 0), (N(3,2), EIGHTH, 0),
        (N(5,2), EIGHTH, 0), (N(8,2), EIGHTH, 0),
        (N(5,2), EIGHTH, 0), (N(3,2), EIGHTH, 0),
    ]))
    bass_ev.append((PPQ*72, [
        (N(5,2), EIGHTH, 0), (N(8,2), EIGHTH, 0),
        (N(5,2), EIGHTH, 0), (N(3,2), EIGHTH, 0),
        (N(0,2), EIGHTH, 0), (N(3,2), EIGHTH, 0),
        (N(5,2), PPQ*2, 0),
    ]))
    cfg["bass_pattern"] = bass_ev
    # ---- Lead: 5 distinct phrases, no held C5 (FluidSynth attenuation pitfall) ----
    # bars 0-1: 2 short sax stabs (fades in, doesn't hold)
    lead_ev.append((0, [
        (N(0,5), QUARTER, -8), (None, QUARTER, 0),
        (N(0,5), EIGHTH, -12), (None, QUARTER, 0),
        (None, QUARTER, 0),
    ]))
    # bars 2-3: whisper sax, low register
    lead_ev.append((PPQ*8, [
        (N(5,4), EIGHTH, -15), (None, EIGHTH, 0),
        (N(8,4), EIGHTH, -10), (None, QUARTER, 0),
        (N(0,5), EIGHTH, -8), (None, EIGHTH, 0),
        (N(5,4), QUARTER, -10),
    ]))
    # bars 4-7: ascending whisper (4-note climb)
    lead_ev.append((PPQ*16, [
        (N(5,4), EIGHTH, -10), (N(8,4), EIGHTH, -8),
        (N(0,5), EIGHTH, -5), (N(3,5), EIGHTH, -3),
        (N(5,5), QUARTER, 0),
    ]))
    # bars 8-15: NEW contour (descending fifth — mirrors kabukicho_d's final
    # motif so the scene arc resolves). NOT a repeat of kabukicho_c's climb.
    lead_ev.append((PPQ*32, [
        (N(10,5), EIGHTH, 0), (None, EIGHTH, 0),
        (N(8,5), QUARTER, 3),
        (N(5,5), QUARTER, 0), (None, EIGHTH, 0),
        (N(3,5), QUARTER, 0),
    ]))
    lead_ev.append((PPQ*48, [
        (N(5,5), EIGHTH, 3), (N(3,5), EIGHTH, 0),
        (N(5,5), EIGHTH, 3), (N(8,5), EIGHTH, 5),
        (N(5,5), QUARTER, 0),
    ]))
    # bars 16-23: A's opening shape (matches kabukicho_a for seamless loop)
    lead_ev.append((PPQ*64, [
        (N(5,4), EIGHTH, 0), (N(8,4), EIGHTH, 0),
        (N(0,5), EIGHTH, 3), (N(3,5), EIGHTH, 5),
        (N(5,5), QUARTER, 5),
    ]))
    lead_ev.append((PPQ*80, [
        (N(8,5), EIGHTH, 5), (N(5,5), EIGHTH, 3),
        (N(3,5), PPQ*2, 0),
    ]))
    cfg["lead_pattern"] = lead_ev
    # Drums: brush kit, heartbeat returns (unchanged)
    KICK = 36; BRUSH = 39; HAT = 42
    for b in range(4, 24):
        t = b * bar
        drum_ev.append((t, [(KICK, EIGHTH, -5)]))
        drum_ev.append((t + PPQ, [(BRUSH, PPQ*2, -10)]))
        drum_ev.append((t + PPQ*3, [(BRUSH, PPQ*2, -10)]))
        for e in range(8):
            drum_ev.append((t + e * EIGHTH, [(HAT, PPQ//4, -15)]))
    cfg["drum_pattern"] = [(t, n, v) for t, notes in drum_ev for n, _, v in notes]
_build_kabukicho_e_patterns()

# ---------- 6. corp_office — cold corporate, F# minor 92 BPM --------------
# SHAPE: bars 0-3 EP keyboard stabs ONLY (chord stabs on beats 1+3),
# nothing else. bars 4-7 EP chord progression (4 chords × 1 bar each),
# bass enters with mechanical 8ths, drum kit enters kick+brush snare.
# bars 8-11 FULL BAND — pad enters softly, lead plays arpeggio layer
# over EP stabs. bars 12-15 BUILD — bass 8th-note pulse w/ 5th added,
# drum_shapes adds snare rolls on bar 15. bars 16-19 SUBTLE CRESCENDO —
# pad_vel_ramp climbs 60→120 across these bars. Lead vel 70→110.
# bar 19 (last bar): crash, all elements at 120 vel.
# TEMPO unchanged. Keep corporate calm — no tempo change.
SCENES["corp_office"] = {
    "name": "corp_office",
    "bars": 20,                              # ~104s at 92 BPM
    "bpm": 92,
    "lead": {"prog": 5, "vol": 85, "pan": 64, "reverb": 40, "mod_init": 0},  # Electric Piano
    "bass": {"prog": 33, "vol": 85, "reverb": 15},   # Fingered Bass
    "pad":  {"prog": 94, "vol": 80, "pan": 64, "reverb": 75},   # Halo Pad
    "drums": {"vol": 70, "reverb": 20},      # minimal click, low volume
    "lead_vel_ramp": (70, 110),              # crescendo to bar 19
    "key_intervals": MINOR,
    "root": 6,                               # F# minor
    "lead_mod_ramp": (0, 15),
    # Pad vel ramp: expression climbs 60→120 across the loop (the
    # "subtle crescendo" of bars 16-19). Starts low so pad enters softly
    # at bar 8.
    "pad_vel_ramp": (30, 120, 16),
    # Pad chords: pad enters at bar 8 (so bars 0-7 are stabs+bass only).
    # 4 chords per 4-bar phrase, cycling through F#m cycle.
    "pad_chords": [
        (8,  [N(6,3), N(9,3), N(1,4), N(4,4)]),       # F#m   (bars 8-11)
        (12, [N(1,3), N(4,3), N(8,3), N(11,3)]),      # Bm    (bars 12-15)
        (16, [N(4,3), N(8,3), N(11,3), N(3,4)]),      # C#m   (bars 16-19)
    ],
    # drum_shapes: snare rolls on bar 15 (the build section peak)
    "drum_shapes": [
        {"bars": (15, 16), "_volume": 0, "_restore": 100},  # bar 15 snare roll
    ],
    "lead_pattern": [],       # built by _build_corp_office_patterns
    "bass_pattern": [],       # built by _build_corp_office_patterns
    "drum_pattern": [],       # built by _build_corp_office_patterns
    "cross_boundary_crash": True,            # crash on bar 19 marks climax
    "crash_velocity": 120,
}
def _build_corp_office_patterns():
    bar = PPQ * BEATS_PER_BAR
    eighth = PPQ // 2
    cfg = SCENES["corp_office"]

    # ----- BASS ------------------------------------------------------------
    bass_ev = []
    # 4-chord progression per 4-bar phrase: F#m, Bm, C#m, F#m
    chord_roots = [6, 1, 4, 6]
    # bars 0-3: SILENT (EP stabs only)
    for b in range(0, 4):
        bass_ev.append((b * bar, [(None, PPQ*4, 0)]))
    # bars 4-7: bass enters with mechanical 8ths on root (no 5th yet)
    for b in range(4, 8):
        root_idx = chord_roots[(b - 4) % 4]
        root = N(root_idx, 1)
        for beat in range(4):
            t = b * bar + beat * PPQ
            bass_ev.append((t, [(root, PPQ, 0)]))
    # bars 8-11: 8th-note pulse on root
    for b in range(8, 12):
        root_idx = chord_roots[(b - 8) % 4]
        root = N(root_idx, 1)
        for beat in range(4):
            t = b * bar + beat * PPQ
            bass_ev.append((t, [(root, eighth, 0), (root, eighth, 0)]))
    # bars 12-15: BUILD — 8th-note pulse with 5th added
    for b in range(12, 16):
        root_idx = chord_roots[(b - 12) % 4]
        root = N(root_idx, 1)
        fifth = root + 7
        for beat in range(4):
            t = b * bar + beat * PPQ
            bass_ev.append((t, [(root, eighth, 0), (fifth, eighth, 0)]))
    # bars 16-19: CRESCENDO — more notes, climbing slightly (walking feel)
    for b in range(16, 20):
        root_idx = chord_roots[(b - 16) % 4]
        root = N(root_idx, 1)
        fifth = root + 7
        octave = N(root_idx, 2)
        for beat in range(4):
            t = b * bar + beat * PPQ
            if beat in (0, 2):
                bass_ev.append((t, [(root, eighth, 0), (fifth, eighth, 0),
                                     (root, eighth, 0), (octave, eighth, 0)]))
            else:
                bass_ev.append((t, [(fifth, eighth, 0), (octave, eighth, 0)]))
    cfg["bass_pattern"] = bass_ev

    # ----- LEAD (EP) -------------------------------------------------------
    lead_ev = []
    # bars 0-3: EP stabs ONLY on beats 1+3 — chord stabs
    for b in range(0, 4):
        root_idx = chord_roots[b % 4]
        # stab = root + 3rd + 5th, voiced close
        chord_notes = [N(root_idx, 4), N(root_idx + 3, 4), N(root_idx + 7, 4)]
        # beat 1
        lead_ev.append((b * bar, [(n, PPQ // 2, -5) for n in chord_notes]))
        # beat 3
        lead_ev.append((b * bar + 2 * PPQ, [(n, PPQ // 2, -5) for n in chord_notes]))
    # bars 4-7: EP chord progression (4 chords × 1 bar each) — stabs continue
    for b in range(4, 8):
        root_idx = chord_roots[(b - 4) % 4]
        chord_notes = [N(root_idx, 4), N(root_idx + 3, 4), N(root_idx + 7, 4)]
        # stabs on beats 1+3 as before, with higher velocity now (full band)
        lead_ev.append((b * bar, [(n, PPQ // 2, 0) for n in chord_notes]))
        lead_ev.append((b * bar + 2 * PPQ, [(n, PPQ // 2, 0) for n in chord_notes]))
        # bar-end melodic tag (one high note on bar 7)
        if b == 7:
            lead_ev.append((b * bar + 3 * PPQ, [(N(root_idx, 5), PPQ, 0)]))
    # bars 8-11: FULL BAND — lead plays arpeggio layer over EP stabs
    for b in range(8, 12):
        root_idx = chord_roots[(b - 8) % 4]
        # arpeggio on beats 1+3 in higher octave (over the stabs)
        arp = [N(root_idx, 5), N(root_idx + 3, 5), N(root_idx + 7, 5), N(root_idx + 10, 5)]
        for i, n in enumerate(arp):
            lead_ev.append((b * bar + i * eighth, [(n, eighth, 0)]))
        # second half: chord stabs (the EP "pulse")
        chord_notes = [N(root_idx, 4), N(root_idx + 3, 4), N(root_idx + 7, 4)]
        for off in [2 * PPQ + PPQ // 2, 3 * PPQ + PPQ // 2]:
            lead_ev.append((b * bar + off, [(n, PPQ // 2, 0) for n in chord_notes]))
    # bars 12-15: BUILD — lead plays more arpeggios, fuller
    for b in range(12, 16):
        root_idx = chord_roots[(b - 12) % 4]
        # 16th-note arpeggios across the bar
        arp = [N(root_idx, 5), N(root_idx + 3, 5), N(root_idx + 7, 5), N(root_idx + 10, 5),
               N(root_idx + 12, 5), N(root_idx + 10, 5), N(root_idx + 7, 5), N(root_idx + 3, 5)]
        for i, n in enumerate(arp):
            lead_ev.append((b * bar + i * (PPQ // 4), [(n, PPQ // 4, 0)]))
        # chord stabs on beats 2.5 and 4 (for stability)
        chord_notes = [N(root_idx, 4), N(root_idx + 3, 4), N(root_idx + 7, 4)]
        for off in [PPQ + PPQ // 2, 3 * PPQ + PPQ // 2]:
            lead_ev.append((b * bar + off, [(n, PPQ // 2, 0) for n in chord_notes]))
    # bars 16-19: CRESCENDO — 16th-note lead runs, climbing
    for b in range(16, 20):
        root_idx = chord_roots[(b - 16) % 4]
        # Lead climbs an octave over the 4-bar phrase
        climb = b - 16   # 0, 1, 2, 3
        octave_shift = climb * 2  # 0, 2, 4, 6 semitones
        arp = [N(root_idx, 5), N(root_idx + 3, 5), N(root_idx + 7, 5), N(root_idx + 10, 5),
               N(root_idx + 12, 5 + octave_shift), N(root_idx + 10, 5 + octave_shift),
               N(root_idx + 7, 5 + octave_shift), N(root_idx + 3, 5 + octave_shift)]
        for i, n in enumerate(arp):
            lead_ev.append((b * bar + i * (PPQ // 4), [(n, PPQ // 4, 0)]))
        # chord stabs on beats 2.5 and 4
        chord_notes = [N(root_idx, 4), N(root_idx + 3, 4), N(root_idx + 7, 4)]
        for off in [PPQ + PPQ // 2, 3 * PPQ + PPQ // 2]:
            lead_ev.append((b * bar + off, [(n, PPQ // 2, 0) for n in chord_notes]))
    cfg["lead_pattern"] = lead_ev

    # ----- DRUMS -----------------------------------------------------------
    drum_ev = []
    # bars 0-3: SILENT — only EP stabs
    # bars 4-7: drum kit enters — kick + brush snare (rim click)
    for b in range(4, 8):
        drum_ev.append((b * bar, KICK, 60))
        for beat in (1, 3):
            drum_ev.append((b * bar + beat * PPQ, SNARE, 45))   # rim-click
    # bars 8-11: full kit — kick + snare + soft hats
    for b in range(8, 12):
        for beat in range(4):
            t = b * bar + beat * PPQ
            if beat in (0, 2):
                drum_ev.append((t, KICK, 65 if beat == 0 else 55))
            if beat in (1, 3):
                drum_ev.append((t, SNARE, 55))   # rim still soft
            # soft hat
            drum_ev.append((t + eighth, HHAT, 30))
    # bars 12-15: build — fuller kit, snare rolls on bar 15
    for b in range(12, 15):
        for beat in range(4):
            t = b * bar + beat * PPQ
            if beat in (0, 2):
                drum_ev.append((t, KICK, 75 if beat == 0 else 65))
            if beat in (1, 3):
                drum_ev.append((t, SNARE, 70))
            for e in range(2):
                drum_ev.append((t + e * eighth, HHAT, 40))
    # bar 15: SNARE ROLL leading into the crescendo
    for i in range(16):
        drum_ev.append((15 * bar + i * (PPQ // 4), SNARE, 60 + i * 2))
    # bars 16-19: CRESCENDO — drums build
    for b in range(16, 20):
        # crescendo: drum velocity climbs 75→120 across 4 bars
        cresc_v = 75 + (b - 16) * 15   # 75, 90, 105, 120
        for beat in range(4):
            t = b * bar + beat * PPQ
            if beat in (0, 2):
                drum_ev.append((t, KICK, cresc_v))
            if beat in (1, 3):
                drum_ev.append((t, SNARE, cresc_v))
            for e in range(2):
                drum_ev.append((t + e * eighth, HHAT, cresc_v - 25))
    # bar 19: CRASH on beat 1, all elements at 120
    drum_ev.append((19 * bar, CRASH, 120))
    cfg["drum_pattern"] = drum_ev
_build_corp_office_patterns()

# ---------- 7. terminal_lab — sterile sci-fi, eerie glitch ---------------
# SHAPE: bars 0-3 glitch stutter ONLY (random kick/snare hits; bass+pad
# ABSENT). bars 4-7 build glitch — bass pulsing 8ths, pad enters C-Chord;
# mod wheel climbs. bars 8-11 full glitch pattern at 76 BPM, lead enters
# Fantasia motif. TEMPO LIFT bar 12: 76→88 (the system "speeds up").
# bars 12-15 cascade — drum vel peaks 110, lead descends, pad chord
# changes to Em. bars 16-19 cascade continued, lead goes UP an octave
# over the descent. bars 20-23 stutter returns (random hits, bass+pad
# absent), no crash. End = start → loops cleanly.
SCENES["terminal_lab"] = {
    "name": "terminal_lab",
    "bars": 24,                              # ~76s at 76 BPM (lift to 88 at bar 12)
    "bpm": 76,
    "lead": {"prog": 88, "vol": 80, "pan": 64, "reverb": 60, "mod_init": 10},  # Fantasia
    "bass": {"prog": 39, "vol": 75, "reverb": 35},
    "pad":  {"prog": 101, "vol": 90, "pan": 64, "reverb": 90},   # Sweep Pad
    "drums": {"vol": 60, "reverb": 40},      # glitch percussion
    "lead_vel_ramp": (50, 100),              # whisper entry → climax → fade
    "key_intervals": MINOR,
    "root": 11,                              # B minor
    "lead_mod_ramp": (10, 60),               # instability — climbs to peak
    # Tempo lift at bar 12: 76 → 88 (system "speeds up")
    "tempo_changes": [(12, 88)],
    # Pad: chord rings from bar 4 (so bars 0-3 are silent). Two chord
    # entries — bars 4-11 C-Chord (bars 4-11), bars 12-19 Em (cascade).
    # Pad breakdown at bars 20-23 zeros expression for the loop seam.
    "pad_chords": [
        (4,  [N(0,3), N(4,3), N(7,3), N(11,3)]),       # C-Chord enters bar 4
        (12, [N(4,3), N(7,3), N(11,3), N(2,4)]),       # Em at bar 12 (cascade)
    ],
    "pad_breakdowns": [(20, 24)],
    "lead_pattern": [],       # built by _build_terminal_lab_patterns
    "bass_pattern": [],       # built by _build_terminal_lab_patterns
    "drum_pattern": [],       # built by _build_terminal_lab_patterns
    "cross_boundary_crash": False,           # no crash (loops clean)
    "crash_velocity": 80,
}
def _build_terminal_lab_patterns():
    import random
    bar = PPQ * BEATS_PER_BAR
    eighth = PPQ // 2
    cfg = SCENES["terminal_lab"]

    # ----- BASS ------------------------------------------------------------
    bass_ev = []
    # bars 0-3: ABSENT (rest)
    for b in range(0, 4):
        bass_ev.append((b * bar, [(None, PPQ*4, 0)]))
    # bars 4-7: pulsing 8ths on B (build glitch)
    for b in range(4, 8):
        root = N(11, 1)
        fifth = N(6, 2)
        for beat in range(4):
            t = b * bar + beat * PPQ
            bass_ev.append((t, [(root, eighth, 0), (fifth, eighth, 0)]))
    # bars 8-11: same (full glitch at 76 BPM)
    for b in range(8, 12):
        root = N(11, 1)
        fifth = N(6, 2)
        for beat in range(4):
            t = b * bar + beat * PPQ
            bass_ev.append((t, [(root, eighth, 0), (fifth, eighth, 0)]))
    # bars 12-15: bass descends (cascade) — B → A → G → F# over 4 bars
    cascade = [N(11,1), N(9,1), N(7,1), N(6,1)]
    for b in range(12, 16):
        root = cascade[b - 12]
        fifth = root + 7
        for beat in range(4):
            t = b * bar + beat * PPQ
            bass_ev.append((t, [(root, eighth, 0), (fifth, eighth, 0)]))
    # bars 16-19: cascade continues at higher octave (E, D, C#, B)
    cascade2 = [N(4,2), N(2,2), N(1,2), N(11,2)]
    for b in range(16, 20):
        root = cascade2[b - 16]
        fifth = root + 7
        for beat in range(4):
            t = b * bar + beat * PPQ
            bass_ev.append((t, [(root, eighth, 0), (fifth, eighth, 0)]))
    # bars 20-23: ABSENT (matches bars 0-3 — clean loop seam)
    for b in range(20, 24):
        bass_ev.append((b * bar, [(None, PPQ*4, 0)]))
    cfg["bass_pattern"] = bass_ev

    # ----- LEAD ------------------------------------------------------------
    lead_ev = []
    # bars 0-7: SILENT (no lead)
    # bars 8-11: Fantasia motif enters — eerie sparse with octave leaps
    motif = [
        (N(11,5), PPQ*2),    # B5
        (N(6,4), PPQ),      # G4 (leap down)
        (N(2,5), PPQ),      # D5
        (N(11,4), PPQ*2),   # B4
        (N(6,4), PPQ*2),    # G4
        (N(2,4), PPQ*2),    # D4
        (N(11,4), PPQ*2),   # B4
        (N(6,4), PPQ),      # G4
    ]
    for b in range(8, 12):
        t = b * bar
        cursor = 0
        for n, d in motif:
            lead_ev.append((t + cursor, [(n, d, 0)]))
            cursor += d
    # bars 12-15: cascade — lead descends (B5 → A5 → G5 → F#5 → E5 → ...)
    descend = [N(11,5), N(9,5), N(7,5), N(6,5), N(4,5), N(2,5), N(11,4), N(9,4)]
    for b in range(12, 16):
        t = b * bar
        for i, n in enumerate(descend):
            lead_ev.append((t + i * eighth, [(n, eighth, 0)]))
    # bars 16-19: cascade continued but lead goes UP an octave over descent
    ascend_over = [N(11,6), N(9,6), N(7,6), N(6,6), N(4,6), N(2,6), N(11,5), N(9,5)]
    for b in range(16, 20):
        t = b * bar
        for i, n in enumerate(ascend_over):
            lead_ev.append((t + i * eighth, [(n, eighth, 0)]))
    # bars 20-23: lead fades to silence
    fade_ev = [N(7,5), N(4,5), None, None]
    for b in range(20, 24):
        t = b * bar
        for beat, n in enumerate(fade_ev):
            lead_ev.append((t + beat * PPQ, [(n, PPQ, 0)]))
    cfg["lead_pattern"] = lead_ev

    # ----- DRUMS (GLITCH) --------------------------------------------------
    drum_ev = []
    random.seed(42)
    # bars 0-3: STUTTER — random kick+snare hits at irregular times
    for b in range(0, 4):
        for beat in range(4):
            t = b * bar + beat * PPQ
            if random.random() < 0.55:
                drum_ev.append((t, KICK, 50 + random.randint(-10, 10)))
            if random.random() < 0.35:
                drum_ev.append((t, HHAT, 40 + random.randint(-5, 10)))
            if beat in (1, 3) and random.random() < 0.5:
                drum_ev.append((t + PPQ // 2, TOM_HI, 45))
    # bars 4-7: BUILD glitch — denser hits, kick on every beat
    for b in range(4, 8):
        for beat in range(4):
            t = b * bar + beat * PPQ
            drum_ev.append((t, KICK, 55 + random.randint(-5, 10)))
            if random.random() < 0.6:
                drum_ev.append((t, HHAT, 45 + random.randint(-5, 10)))
            if beat in (1, 3):
                drum_ev.append((t + PPQ // 2, TOM_HI, 50))
    # bars 8-11: full glitch pattern at 76 BPM — kick every beat, snare 2/4
    for b in range(8, 12):
        for beat in range(4):
            t = b * bar + beat * PPQ
            drum_ev.append((t, KICK, 65 if beat == 0 else 55))
            if beat in (1, 3):
                drum_ev.append((t, SNARE, 60))
            if random.random() < 0.7:
                drum_ev.append((t + eighth, HHAT, 50))
            if random.random() < 0.4:
                drum_ev.append((t + PPQ // 4, TOM_HI, 55))
                drum_ev.append((t + 3 * PPQ // 4, TOM_LO, 55))
    # bars 12-15: cascade — drum vel peaks 110, busy glitch
    for b in range(12, 16):
        for beat in range(4):
            t = b * bar + beat * PPQ
            drum_ev.append((t, KICK, 110))
            if beat in (1, 3):
                drum_ev.append((t, SNARE, 100))
            for e in range(2):
                drum_ev.append((t + e * eighth, HHAT, 75 + random.randint(-5, 5)))
            drum_ev.append((t + PPQ // 4, TOM_HI, 80))
            drum_ev.append((t + 3 * PPQ // 4, TOM_LO, 80))
    # bars 16-19: cascade continued — full glitch with all elements
    for b in range(16, 20):
        for beat in range(4):
            t = b * bar + beat * PPQ
            drum_ev.append((t, KICK, 105))
            if beat in (1, 3):
                drum_ev.append((t, SNARE, 95))
            for e in range(2):
                drum_ev.append((t + e * eighth, HHAT, 70))
            drum_ev.append((t + PPQ // 2, TOM_MID, 75))
            drum_ev.append((t + PPQ // 4, TOM_HI, 80))
    # bars 20-23: STUTTER returns (random hits, bass+pad absent)
    for b in range(20, 24):
        for beat in range(4):
            t = b * bar + beat * PPQ
            if random.random() < 0.55:
                drum_ev.append((t, KICK, 50 + random.randint(-10, 10)))
            if random.random() < 0.35:
                drum_ev.append((t, HHAT, 40 + random.randint(-5, 10)))
            if beat in (1, 3) and random.random() < 0.5:
                drum_ev.append((t + PPQ // 2, TOM_HI, 45))
    cfg["drum_pattern"] = drum_ev
_build_terminal_lab_patterns()

# ---------- 7c. terminal_lab_c — glitching chaos, kit drops hits -----
# 24 bars @ 100 BPM. The system breaks down. Kit deliberately drops
# beats (the "skip"). Bass has chromatic b2 approach. Pad shifts to
# sharp-11th / dim7 colors. Lead plays wrong notes. KICK MISSING on
# bar 16 = the glitch event.
SCENES_B["terminal_lab_c"] = {
    "name": "terminal_lab_c",
    "bars": 24,
    "bpm": 100,
    "lead": {"prog": 88, "vol": 95, "pan": 64, "reverb": 70, "mod_init": 30},   # Fantasia
    "bass": {"prog": 39, "vol": 95, "reverb": 30},                              # Synth Bass
    "pad":  {"prog": 89, "vol": 70, "pan": 64, "reverb": 90},                   # Fantasia Pad
    "drums": {"vol": 75, "reverb": 30},
    "lead_mod_ramp": (30, 70),
    "lead_vel_ramp": (85, 105),
    "key_intervals": MINOR,
    "root": 11,                                # B minor
    "pad_chords": [
        (0,  [N(11,3), N(3,4), N(6,4), N(10,4)]),      # Bm7#11
        (8,  [N(4,3), N(7,3), N(11,3), N(4,4)]),       # Em
        (16, [N(6,3), N(9,3), N(1,4), N(6,4)]),        # G (relative major)
    ],
    "pad_vel_ramp": (70, 90, 24),
    "pad_breakdowns": [],
    "lead_pattern": [],
    "bass_pattern": [],
    "drum_pattern": [],
}

def _build_terminal_lab_c_patterns():
    """Glitching chaos: kit skips, chromatic b2, wrong notes in lead."""
    cfg = SCENES_B["terminal_lab_c"]
    bar = PPQ * BEATS_PER_BAR
    EIGHTH = PPQ // 2
    bass_ev = []
    lead_ev = []
    drum_ev = []
    # Bass: B1 pulse with chromatic b2 approach on bar 8
    bass_ev.append((0, [
        (N(11,1), EIGHTH, 0), (N(11,2), EIGHTH, 0),
        (N(11,1), EIGHTH, 0), (N(3,2), EIGHTH, 0),
        (N(11,1), EIGHTH, 0), (N(11,2), EIGHTH, 0),
        (N(11,1), EIGHTH, 0), (N(3,2), EIGHTH, 0),
    ] * 2))   # bars 0-3
    bass_ev.append((PPQ*16, [
        (N(11,1), EIGHTH, 0), (N(11,2), EIGHTH, 0),
        (N(11,1), EIGHTH, 0), (N(3,2), EIGHTH, 0),
        (N(11,1), EIGHTH, 0), (N(10,1), EIGHTH, 0),    # chromatic b2
        (N(11,1), EIGHTH, 0), (N(3,2), EIGHTH, 0),
    ]))
    # bars 8-15: Em with chromatic motion
    bass_ev.append((PPQ*32, [
        (N(4,1), EIGHTH, 0), (N(4,2), EIGHTH, 0),
        (N(4,1), EIGHTH, 0), (N(7,2), EIGHTH, 0),
        (N(4,1), EIGHTH, 0), (N(4,2), EIGHTH, 0),
        (N(4,1), EIGHTH, 0), (N(3,2), EIGHTH, 0),     # chromatic pull
    ]))
    bass_ev.append((PPQ*40, [
        (N(4,1), EIGHTH, 0), (N(4,2), EIGHTH, 0),
        (N(4,1), EIGHTH, 0), (N(7,2), EIGHTH, 0),
        (N(11,1), EIGHTH, 0), (N(4,2), EIGHTH, 0),   # pivot back
        (N(11,1), EIGHTH, 0), (N(7,2), EIGHTH, 0),
    ]))
    # bars 16-23: G major walking back
    bass_ev.append((PPQ*64, [
        (N(6,1), EIGHTH, 0), (N(6,2), EIGHTH, 0),
        (N(6,1), EIGHTH, 0), (N(9,2), EIGHTH, 0),
        (N(6,1), EIGHTH, 0), (N(6,2), EIGHTH, 0),
        (N(6,1), EIGHTH, 0), (N(1,2), EIGHTH, 0),
    ]))
    bass_ev.append((PPQ*72, [
        (N(6,1), EIGHTH, 0), (N(6,2), EIGHTH, 0),
        (N(6,1), EIGHTH, 0), (N(9,2), EIGHTH, 0),
        (N(11,1), EIGHTH, 0), (N(6,2), EIGHTH, 0),
        (N(11,1), EIGHTH, 0), (N(9,2), EIGHTH, 0),
    ]))
    cfg["bass_pattern"] = bass_ev
    # Lead: Bm arpeggios with "wrong" notes (chromatic b2, E natural over Bm).
    # This is intentionally sparse — "glitching chaos with kit skips + wrong
    # notes" — so the lead plays at bars 0, 4, 8, 12, 16, 20 with 4-bar gaps
    # between. Drums fill all 24 bars (except bar 16 KICK-MISSING, the glitch
    # event). The 4-bar gap is part of the design: the listener notices
    # phrases disappearing, then re-appearing with wrong notes. Don't fill.
    lead_ev.append((0, [
        (N(11,4), EIGHTH, -5), (N(3,5), EIGHTH, 0),
        (N(6,5), EIGHTH, 3), (N(3,5), EIGHTH, 0),
        (N(11,4), EIGHTH, -3), (N(3,5), EIGHTH, 0),
        (N(6,5), EIGHTH, 3), (N(3,5), EIGHTH, 0),
    ]))
    lead_ev.append((PPQ*16, [
        (N(11,4), EIGHTH, 0), (N(4,5), EIGHTH, 5),    # E natural = wrong note
        (N(3,5), EIGHTH, 0), (N(4,5), EIGHTH, 3),
        (N(6,5), EIGHTH, 5), (N(3,5), EIGHTH, 0),
        (N(11,4), EIGHTH, 0), (N(3,5), EIGHTH, 0),
    ]))
    # bars 8-15: Em with chromatic passing tones
    lead_ev.append((PPQ*32, [
        (N(4,5), EIGHTH, 0), (N(7,5), EIGHTH, 3),
        (N(11,5), EIGHTH, 5), (N(7,5), EIGHTH, 3),
        (N(4,5), EIGHTH, 0), (N(7,5), EIGHTH, 3),
        (N(11,5), EIGHTH, 5), (N(7,5), EIGHTH, 3),
    ]))
    lead_ev.append((PPQ*48, [
        (N(4,5), EIGHTH, 0), (N(7,5), EIGHTH, 3),
        (N(11,5), EIGHTH, 5), (N(7,5), EIGHTH, 3),
        (N(4,5), EIGHTH, 0), (N(7,5), EIGHTH, 3),
        (N(11,5), EIGHTH, 5), (N(6,5), EIGHTH, 3),
    ]))
    # bars 16-23: G major — climb back
    lead_ev.append((PPQ*64, [
        (N(6,5), EIGHTH, 5), (N(9,5), EIGHTH, 8),
        (N(1,6), EIGHTH, 10), (N(9,5), EIGHTH, 5),
        (N(6,5), EIGHTH, 3), (N(9,5), EIGHTH, 5),
        (N(1,6), EIGHTH, 8), (N(9,5), EIGHTH, 5),
    ]))
    lead_ev.append((PPQ*80, [
        (N(6,5), EIGHTH, 3), (N(9,5), EIGHTH, 5),
        (N(6,5), PPQ*2, 0),
    ]))
    cfg["lead_pattern"] = lead_ev
    # Drums: deliberate drops — KICK MISSING on bar 16 (the glitch event)
    # 2026-07-14 bug: previous version used vdelta=0 which produced
    # velocity 0 (silent note_on) for KICK/SNARE/CRASH — only HAT
    # played (vdelta=-10 + base 128 = 118). Now using direct absolute
    # velocities like chase does.
    KICK = 36; SNARE = 38; HAT = 42; RIDE = 51
    for b in range(24):
        t = b * bar
        # Kick on every beat — except bar 16 (no kicks at all)
        if b != 16:
            for beat in range(4):
                drum_ev.append((t + beat * PPQ, KICK, 95))
        # Snare on 2 and 4 — except bar 16 (skipped, the glitch)
        if b != 16:
            drum_ev.append((t + PPQ, SNARE, 85))
            drum_ev.append((t + PPQ*3, SNARE, 85))
        # Hats on every 8th
        for e in range(8):
            drum_ev.append((t + e * EIGHTH, HAT, 85))
    # Crash on bar 8 (transition) — CRASH = 49
    drum_ev.append((PPQ*32, 49, 100))
    cfg["drum_pattern"] = list(drum_ev)
_build_terminal_lab_c_patterns()

# ---------- 7d. terminal_lab_d — glitching-stutter scare, kit skips -----
# 16 bars @ 100 BPM. Kit "skips" — hits on wrong beats. Bass pedal
# with chromatic b2 approach on beat 4 of odd bars. Pad shifts to
# sharp 11ths / dim7 colors. The system is corrupted.
SCENES_B["terminal_lab_d"] = {
    "name": "terminal_lab_d",
    "bars": 24,
    "bpm": 100,
    "lead": {"prog": 88, "vol": 85, "pan": 64, "reverb": 90, "mod_init": 0},
    "bass": {"prog": 39, "vol": 85, "reverb": 50},
    "pad":  {"prog": 89, "vol": 60, "pan": 64, "reverb": 100},
    "drums": {"vol": 50, "reverb": 50},                # quieter, glitchy
    "lead_mod_ramp": (0, 110),                        # HEAVY vibrato
    "lead_vel_ramp": (90, 100),
    "key_intervals": MINOR,
    "root": 11,                                # B minor
    "pad_chords": [
        (0, [N(10,3), N(1,4), N(5,4), N(8,4)]),        # Am7#11 (dark color)
        (8, [N(0,3), N(3,3), N(6,3), N(10,3)]),        # Cdim7 (glitch)
    ],
    "pad_vel_ramp": (50, 40, 16),
    "pad_breakdowns": [],
    "lead_pattern": [],
    "bass_pattern": [],
    "drum_pattern": [],
}

def _build_terminal_lab_d_patterns():
    """Glitching stutter: kit on wrong beats, chromatic b2 on bass."""
    cfg = SCENES_B["terminal_lab_d"]
    bar = PPQ * BEATS_PER_BAR
    EIGHTH = PPQ // 2
    bass_ev = []
    lead_ev = []
    drum_ev = []
    # Bass: B1 pedal with chromatic b2 approach on beat 4 of odd bars
    for b in range(24):
        t = b * bar
        bass_ev.append((t, [(N(11,1), PPQ, 0)]))
        bass_ev.append((t + PPQ, [(N(11,1), PPQ, 0)]))
        bass_ev.append((t + PPQ*2, [(N(11,1), PPQ, 0)]))
        # Beat 4: chromatic b2 (A natural = b2 of B)
        if b % 2 == 1:
            bass_ev.append((t + PPQ*3, [
                (N(10,1), EIGHTH, 0),    # chromatic approach
                (N(11,1), EIGHTH, 0),    # resolve
            ]))
        else:
            bass_ev.append((t + PPQ*3, [(N(11,1), PPQ, 0)]))
    cfg["bass_pattern"] = bass_ev
    # Lead: stuttered D5 with glitching arpeggio bursts. Held note is too
    # monotonous for 23 bars — "single held D5 with vibrato" actually
    # fades in FluidSynth (patch #81 attenuates continuous notes). Replace
    # with a stuttering pattern: bursts of D5/F5/B5 (Bm chord tones) at
    # irregular intervals, with random gaps that feel like the system
    # is losing sync.
    import random
    rng = random.Random(20260714)  # deterministic
    # bars 0-3: slow D5 pulse with breath
    # bars 4-7: B5 enters, gives the chord a top
    # bars 8-15: F5 climbs in (Bm add9)
    # bars 16-22: descending glitch stutters
    # bars 23: pitch bend down (kept)
    PPQ2 = PPQ * 2
    lead_bursts = [
        # (start_bar, [(relative_pos, note, dur, vdelta), ...])
        (0, [(0, N(3,5), QUARTER, 0), (QUARTER+EIGHTH, N(3,5), EIGHTH, -3), (PPQ2, N(3,5), QUARTER, 0)]),
        (1, [(0, N(3,5), QUARTER, 0), (PPQ2+QUARTER, N(7,5), EIGHTH, 5)]),
        (2, [(0, N(3,5), PPQ2, 0)]),
        (3, [(0, N(3,5), EIGHTH, 0), (EIGHTH, N(7,5), EIGHTH, 5), (QUARTER, N(3,5), QUARTER, 0)]),
        # bars 4-7: full chord stabs
        (4, [(0, N(3,5), EIGHTH, 0), (0, N(7,5), EIGHTH, 5), (PPQ2+EIGHTH, N(3,5), EIGHTH, 0), (PPQ2+EIGHTH, N(7,5), EIGHTH, 3)]),
        (5, [(0, N(7,5), QUARTER, 5), (PPQ2, N(3,5), EIGHTH, 0), (PPQ2+EIGHTH, N(7,5), EIGHTH, 3)]),
        (6, [(0, N(3,5), EIGHTH, 0), (EIGHTH, N(7,5), QUARTER, 5), (QUARTER+EIGHTH, N(3,5), QUARTER, 0)]),
        (7, [(0, N(7,5), EIGHTH, 5), (EIGHTH, N(3,5), EIGHTH, 0), (PPQ2, N(7,5), QUARTER, 5)]),
        # bars 8-15: add F5 climb (Bm add9)
        (8,  [(0, N(5,5), EIGHTH, 3), (EIGHTH, N(3,5), EIGHTH, 0), (QUARTER, N(7,5), QUARTER, 5), (PPQ2, N(5,5), PPQ2, 5)]),
        (9,  [(0, N(7,5), EIGHTH, 5), (EIGHTH, N(5,5), QUARTER, 3), (PPQ2+EIGHTH, N(3,5), QUARTER, 0)]),
        (10, [(0, N(5,5), QUARTER, 3), (PPQ2, N(7,5), PPQ2, 5)]),
        (11, [(0, N(3,5), EIGHTH, 0), (EIGHTH, N(5,5), EIGHTH, 3), (QUARTER, N(7,5), QUARTER, 5), (PPQ2, N(5,5), EIGHTH, 3), (PPQ2+EIGHTH, N(3,5), EIGHTH, 0)]),
        # bars 12-15: descending stutter figures
        (12, [(0, N(7,5), EIGHTH, 5), (EIGHTH, N(5,5), EIGHTH, 3), (QUARTER, N(3,5), QUARTER, 0)]),
        (13, [(0, N(5,5), EIGHTH, 3), (EIGHTH, N(7,5), EIGHTH, 5), (QUARTER+EIGHTH, N(5,5), EIGHTH, 3), (PPQ2+EIGHTH, N(3,5), EIGHTH, 0)]),
        (14, [(0, N(7,5), QUARTER, 5), (QUARTER+EIGHTH, N(5,5), QUARTER, 3), (PPQ2+EIGHTH, N(3,5), QUARTER, 0)]),
        (15, [(0, N(5,5), EIGHTH, 3), (EIGHTH, N(3,5), EIGHTH, 0), (QUARTER, N(3,5), QUARTER, 0), (PPQ2+EIGHTH, N(5,5), EIGHTH, 3)]),
        # bars 16-22: chaos — repeat figures randomly
        (16, [(0, N(3,5), EIGHTH, 0), (EIGHTH, N(7,5), EIGHTH, 5), (QUARTER, N(5,5), QUARTER, 3), (PPQ2+EIGHTH, N(3,5), QUARTER, 0)]),
        (17, [(0, N(7,5), PPQ2, 5), (PPQ2+EIGHTH, N(3,5), PPQ2, 0)]),
        (18, [(0, N(5,5), EIGHTH, 3), (EIGHTH, N(7,5), QUARTER, 5), (PPQ2, N(5,5), PPQ2, 3)]),
        (19, [(0, N(3,5), PPQ2, 0), (PPQ2, N(7,5), PPQ2, 5)]),
        (20, [(0, N(7,5), EIGHTH, 5), (EIGHTH, N(5,5), QUARTER, 3), (PPQ2, N(3,5), PPQ2, 0)]),
        (21, [(0, N(3,5), QUARTER, 0), (QUARTER, N(5,5), QUARTER, 3), (PPQ2, N(7,5), PPQ2, 5)]),
        (22, [(0, N(7,5), QUARTER, 5), (PPQ2, N(3,5), PPQ2, 0)]),
    ]    # placeholder kept
    for start_bar, bursts in lead_bursts:
        for rel_t, note, dur, vdelta in bursts:
            abs_t = start_bar * bar + rel_t
            if abs_t < cfg["bars"] * bar:
                lead_ev.append((abs_t, [(note, dur, vdelta)]))
    # bar 23: glitch pitch bend down (kept)
    lead_ev.append((PPQ*92, [(N(2,5), PPQ*4, -5)]))
    cfg["lead_pattern"] = lead_ev
    # Drums: kit on WRONG beats (the glitch)
    KICK = 36; SNARE = 38; HAT = 42
    for b in range(16):
        t = b * bar
        # Kick on beat 3 instead of 1 (the glitch)
        drum_ev.append((t + PPQ*2, [(KICK, EIGHTH, -10)]))
        # Snare on beat 1 instead of 2
        drum_ev.append((t, [(SNARE, EIGHTH, -10)]))
        # Hat on every 8th — but random velocity (very quiet)
        for e in range(8):
            drum_ev.append((t + e * EIGHTH, [(HAT, PPQ//4, -25)]))
    cfg["drum_pattern"] = [(t, n, v) for t, notes in drum_ev for n, _, v in notes]
_build_terminal_lab_d_patterns()

# ---------- 7e. terminal_lab_e — reboot recovery, loop seam ----------
# 24 bars @ 100 BPM. Held D5 continues from D for bars 0-1, then lead
# climbs back to A's register. Kit returns bar-by-bar. Last 4 bars
# mirror A's opening for seamless loop.
SCENES_B["terminal_lab_e"] = {
    "name": "terminal_lab_e",
    "bars": 24,
    "bpm": 100,
    "lead": {"prog": 88, "vol": 90, "pan": 64, "reverb": 70, "mod_init": 30},
    "bass": {"prog": 39, "vol": 90, "reverb": 25},
    "pad":  {"prog": 89, "vol": 75, "pan": 64, "reverb": 85},
    "drums": {"vol": 75, "reverb": 30},
    "lead_mod_ramp": (110, 30),                  # vibrato decays as system recovers
    "lead_vel_ramp": (85, 100),
    "key_intervals": MINOR,
    "root": 11,                                # B minor
    "pad_chords": [
        (0,  [N(11,3), N(3,4), N(6,4), N(10,4)]),      # Bm7#11 (return to A)
        (12, [N(11,3), N(3,4), N(6,4), N(10,4)]),      # Bm7#11
        (20, [N(11,3), N(3,4), N(6,4), N(10,4)]),      # Bm7#11 (seam)
    ],
    "pad_vel_ramp": (50, 85, 24),
    "pad_breakdowns": [],
    "lead_pattern": [],
    "bass_pattern": [],
    "drum_pattern": [],
}

def _build_terminal_lab_e_patterns():
    """Reboot recovery: held D5 fades, lead returns to A's shape."""
    cfg = SCENES_B["terminal_lab_e"]
    bar = PPQ * BEATS_PER_BAR
    EIGHTH = PPQ // 2
    bass_ev = []
    lead_ev = []
    drum_ev = []
    # Bass: B1 pedal fades, then walking returns at bar 4
    bass_ev.append((0, [(N(11,1), PPQ*8, -10)]))           # bars 0-1: B1 fading
    bass_ev.append((PPQ*8, [(N(11,1), PPQ*8, -5)]))         # bars 2-3: B1 continues
    # bars 4-7: Bm walking
    bass_ev.append((PPQ*16, [
        (N(11,1), EIGHTH, 0), (N(11,2), EIGHTH, 0),
        (N(11,1), EIGHTH, 0), (N(3,2), EIGHTH, 0),
        (N(11,1), EIGHTH, 0), (N(11,2), EIGHTH, 0),
        (N(11,1), EIGHTH, 0), (N(3,2), EIGHTH, 0),
    ]))
    bass_ev.append((PPQ*24, [
        (N(11,1), EIGHTH, 0), (N(11,2), EIGHTH, 0),
        (N(11,1), EIGHTH, 0), (N(3,2), EIGHTH, 0),
        (N(11,1), EIGHTH, 0), (N(11,2), EIGHTH, 0),
        (N(11,1), EIGHTH, 0), (N(6,2), EIGHTH, 0),
    ]))
    # bars 8-15: continue walking
    bass_ev.append((PPQ*32, [
        (N(11,1), EIGHTH, 0), (N(11,2), EIGHTH, 0),
        (N(11,1), EIGHTH, 0), (N(3,2), EIGHTH, 0),
        (N(11,1), EIGHTH, 0), (N(11,2), EIGHTH, 0),
        (N(11,1), EIGHTH, 0), (N(3,2), EIGHTH, 0),
    ] * 2))
    # bars 16-23: Bm walking (seam to A)
    bass_ev.append((PPQ*64, [
        (N(11,1), EIGHTH, 0), (N(11,2), EIGHTH, 0),
        (N(11,1), EIGHTH, 0), (N(3,2), EIGHTH, 0),
        (N(11,1), EIGHTH, 0), (N(11,2), EIGHTH, 0),
        (N(11,1), EIGHTH, 0), (N(3,2), EIGHTH, 0),
    ] * 2))
    cfg["bass_pattern"] = bass_ev
    # Lead: held D5 fades, then Bm arpeggios
    lead_ev.append((0, [(N(3,5), PPQ*8, -5)]))             # bars 0-1: D5 fading
    lead_ev.append((PPQ*8, [(N(3,5), PPQ*8, -10)]))         # bars 2-3: continues fading
    # bars 4-7: Bm arpeggios whisper
    lead_ev.append((PPQ*16, [
        (N(11,4), EIGHTH, -10), (N(3,5), EIGHTH, -5),
        (N(6,5), EIGHTH, 0), (N(3,5), EIGHTH, -3),
        (N(11,4), EIGHTH, -5), (N(3,5), EIGHTH, 0),
        (N(6,5), EIGHTH, 3), (N(3,5), EIGHTH, 0),
    ]))
    # bars 8-15: climbing
    lead_ev.append((PPQ*32, [
        (N(11,4), EIGHTH, 0), (N(3,5), EIGHTH, 3),
        (N(6,5), EIGHTH, 5), (N(3,5), EIGHTH, 3),
        (N(11,4), EIGHTH, 0), (N(3,5), EIGHTH, 3),
        (N(6,5), EIGHTH, 5), (N(3,5), EIGHTH, 3),
    ]))
    lead_ev.append((PPQ*48, [
        (N(11,4), EIGHTH, 0), (N(3,5), EIGHTH, 3),
        (N(6,5), EIGHTH, 5), (N(3,5), EIGHTH, 3),
        (N(11,4), EIGHTH, 0), (N(3,5), EIGHTH, 3),
        (N(6,5), EIGHTH, 5), (N(3,5), EIGHTH, 3),
    ]))
    # bars 16-23: A's opening shape
    lead_ev.append((PPQ*64, [
        (N(11,4), EIGHTH, 0), (N(3,5), EIGHTH, 0),
        (N(6,5), EIGHTH, 3), (N(3,5), EIGHTH, 0),
        (N(11,4), EIGHTH, -3), (N(3,5), EIGHTH, 0),
        (N(6,5), EIGHTH, 3), (N(3,5), EIGHTH, 0),
    ]))
    lead_ev.append((PPQ*80, [
        (N(11,4), EIGHTH, -3), (N(3,5), EIGHTH, 0),
        (N(6,5), PPQ*2, 3),
    ]))
    cfg["lead_pattern"] = lead_ev
    # Drums: kit returns bar-by-bar
    KICK = 36; SNARE = 38; HAT = 42; RIDE = 51
    # Drums: kit returns bar-by-bar.
    # 2026-07-14 bug: terminal_lab_e drum builder used vdelta in
    # `drum_ev.append((t, [(NOTE, dur, vdelta)]))` but `schedule_drums`
    # interprets the third element as RAW velocity (not a delta).
    # Bars 4-7 KICK vel=-10, SNARE vel=-10 → silent; bars 8-11 KICK
    # vel=-5 (mostly silent), SNARE vel=-5 (mostly silent); HAT in
    # bars 12-23 vel=-10 against base 128 = 118 (audible, masked the
    # bug). Fix: rewrote each entry to use the flat `(t, NOTE, abs_vel)`
    # shape that chase already used, with absolute velocity values.
    KICK = 36; SNARE = 38; HAT = 42; RIDE = 51
    # bars 0-3: silence (post-scare)
    # bars 4-7: kick on 1 only (recovery heartbeat) — vel 65 (quiet)
    for b in range(4, 8):
        t = b * bar
        drum_ev.append((t, KICK, 65))
    # bars 8-11: kick on 1 + snare on 3 — vel 75/70
    for b in range(8, 12):
        t = b * bar
        drum_ev.append((t, KICK, 75))
        drum_ev.append((t + PPQ*2, SNARE, 70))
    # bars 12-23: full 4-on-floor (KICK vel 95, SNARE 85, HAT 75)
    for b in range(12, 24):
        t = b * bar
        for beat in range(4):
            drum_ev.append((t + beat * PPQ, KICK, 95))
        drum_ev.append((t + PPQ, SNARE, 85))
        drum_ev.append((t + PPQ*3, SNARE, 85))
        for e in range(8):
            drum_ev.append((t + e * EIGHTH, HAT, 75))
    cfg["drum_pattern"] = list(drum_ev)
_build_terminal_lab_e_patterns()

# ---------- 8. ship_engine — mechanical space-station, low pulse ---------
# ---------- 8. ship_engine — industrial, layer-by-layer mechanical pressure ----------
# Shape: BARR-PULSE → ADD KICK → ADD HATS → ADD SNARE+LEAD → SNARE-ROLL +
#        ASCENDING LEAD → REV-OCTAVE (loop seam matches the quiet start).
# Engine doesn't race — it grinds. Drums build by element, pad absent in the
# quiet intro for a "powering up" feel, then the bass revs to octave 3 at the
# end. We deliberately close on a quieter band-state so the loop wrap is clean.
SCENES["ship_engine"] = {
    "name": "ship_engine",
    "bars": 24,                              # ~72s at 80 BPM
    "bpm": 80,
    "lead": {"prog": 91, "vol": 75, "pan": 64, "reverb": 50, "mod_init": 20},
    "bass": {"prog": 39, "vol": 100, "reverb": 25},
    "pad":  {"prog": 100, "vol": 90, "pan": 64, "reverb": 95},
    "drums": {"vol": 85, "reverb": 40},
    "key_intervals": MINOR,
    "root": 2,                               # D minor
    "lead_mod_ramp": (20, 60),
    # Lead dynamic arc: whisper sustained pads in the intro → builds mid-loop
    # → climaxes at bar 19 with the dense ascending phrase. Matches the
    # "engine spinning up" feel of the bass.
    "lead_vel_ramp": (50, 105),
    # Pad sustains through the loop (it's the "presence" voice, not the
    # dynamic one) but quietly ducks during the brief intro so the layered
    # entry has impact.
    "pad_chords": [
        (0, [N(2,3), N(5,3), N(9,3), N(0,4)]),       # Dm
        (8, [N(9,3), N(0,4), N(5,4), N(7,4)]),       # A (V) at half-way
    ],
    # Drum muting band: bars 0-3 the kit is muted entirely so the listener
    # perceives "bass pulse alone" before kicks enter. Restored to the
    # default vol (from cfg["drums.vol"]) when kicks come in.
    "drum_shapes": [
        {"bars": (0, 4),  "_volume": 0,    "_restore": 85},  # quiet intro
        {"bars": (20, 24), "_volume": 65},                  # last 4 bars softer (loop seam)
    ],
    "lead_pattern": [],
    "bass_pattern": [],
    "drum_pattern": [],
    "cross_boundary_crash": True,
    "crash_velocity": 95,
}


def _build_ship_engine_patterns():
    bar = PPQ * BEATS_PER_BAR
    eighth = PPQ // 2
    cfg = SCENES["ship_engine"]
    # Bass: layer-by-layer mechanical pressure.
    #   bars 0-3  → bass pulse alone, single octave, every beat (rhythmic pulse)
    #   bars 4-7  → bass pulse with octave-drop on beat 3
    #   bars 8-15 → bass pulse with hi-octave ghost on the upbeats
    #   bars 16-23 → bass SWITCHES to octave 3 with extra 5th below on beats 1+3
    # The end (bars 20-23) is the "engine still grinding but quieter" state —
    # we drop back to single-octave pulse so the loop wrap is a soft landing.
    bass_ev = []
    for b in range(cfg["bars"]):
        # Build section uses low octave; rev-up uses mid+low; landing uses low.
        if b < 16:
            root = N(2, 1)            # D2 — bass pulse range
            octave_ghost = N(2, 2)    # D3 — beat-3 octave drop
        else:
            root = N(2, 2)            # D3 — engine revved up an octave
            octave_ghost = N(7, 2)    # A3 — the 5th below the 3rd beat
        for beat in range(4):
            t = b * bar + beat * PPQ
            if beat == 2 and b >= 4:  # octave drop starts at bar 4 (kicks enter)
                bass_ev.append((t, [(octave_ghost, PPQ // 2, 0), (root, PPQ // 2, 0)]))
            else:
                bass_ev.append((t, [(root, PPQ // 2, 0), (root, PPQ // 2, 0)]))
    cfg["bass_pattern"] = bass_ev
    # Lead: long sustained "engine siren" through the first 12 bars, then
    # a 4-bar ascending phrase at bars 16-19 (climax), then sustained again
    # at lower velocity bars 20-23 to land softly.
    lead_ev = []
    long_notes_low = [N(2,4), N(0,4), N(9,3), N(2,4), N(5,4), N(9,3), N(7,3), N(2,4)]
    for i, n in enumerate(long_notes_low):
        t = i * 2 * bar
        # bars 0-15: sustain at low velocity (the whisper layer); bars 16-19:
        # compressed into 2-bar sustained notes at HIGHER velocity via the
        # vel_ramp; bars 20-23: tail back to whisper dynamics. The bass
        # dictates actual velocity scaling.
        lead_ev.append((t, [(n, PPQ * 8, 0)]))
    # Climax ascending phrase over bars 16-19 (replaces the boring sustain)
    ascent = [N(2,4), N(5,4), N(7,4), N(9,4), N(0,5), N(2,5), N(5,5), N(7,5)]
    for i, n in enumerate(ascent):
        t = 16 * bar + i * (bar // 2)     # 8 notes over 4 bars, eighth-notes
        lead_ev.append((t, [(n, PPQ // 2, 6)]))   # +6 vel delta on top of ramp
    cfg["lead_pattern"] = lead_ev
    # Industrial kit with bar-gated layering — drum_shapes handles the
    # intro/outro muting for us (CC7 mutes whole kit at bars 0-3, softer
    # at bars 20-23). Inside bars 4-19, we layer kicks/hats/snare/toms in.
    drum_ev = []
    for b in range(cfg["bars"]):
        if b < 4:
            # bars 0-3 silent — bass pulse alone is the "intro"
            continue
        for beat in range(4):
            t = b * bar + beat * PPQ
            if b < 8:
                # bars 4-7: kick on beat 1 only
                if beat == 0:
                    drum_ev.append((t, KICK, 85))
            else:
                # bars 8-15: kick on 1+3, hats enter on offbeats
                if beat in (0, 2):
                    drum_ev.append((t, KICK, 85 if beat == 0 else 75))
                drum_ev.append((t + PPQ // 2, HHAT, 45 if b < 12 else 55))
                # bars 12+: snare on 2/4 with snare-roll on bar 19
                if b >= 12 and beat in (1, 3):
                    drum_ev.append((t, SNARE, 80))
                # bars 16-19: full kit, snare-roll on bar 19
                if b == 19:
                    for frac in (0, PPQ // 4, PPQ // 2, 3 * PPQ // 4):
                        drum_ev.append((t + frac, SNARE, 85 + int(frac / PPQ * 20)))
            # industrial tom every 4 bars (starting bar 12)
            if b >= 12 and b % 4 == 2:
                drum_ev.append((b * bar + 3 * PPQ, TOM_LO, 75 if b < 20 else 85))
    cfg["drum_pattern"] = drum_ev
_build_ship_engine_patterns()



# =============================================================================
# MEDLEY PARTNERS (SCENES_B)
#
# Each entry is the "B-side" of a scene's medley — the track the runtime
# crossfades into partway through the A-side so the scene doesn't feel
# repetitive during long puzzle sessions.
#
# Design rules (per ELI5: each medley partner is the "same song, different
# verse" — same band, same key, but the singer takes a different role):
#   1. Same BPM (so the crossfade doesn't tempo-shift audibly)
#   2. Same key root (so the harmony still rings when both play together)
#   3. Same patches (same band — sax stays sax, drum kit stays kit)
#   4. Same drum pattern (groove continues unbroken through the fade)
#   5. Different bass pattern (different walking line — the BASS is the
#      "hook change" — verse bass vs chorus bass)
#   6. Different lead pattern (A has main melody, B has harmony fill or
#      call-and-response — so when B fades in you hear a NEW melody
#      coming in over the existing groove)
#   7. Different chord progression (i→bVI→bIII in A becomes i→iv→V in B,
#      still in-key but emotionally different — "going home" vs "leaving")
#
# Crossfade mechanics are runtime-side (MusicHandler.playMedley). The
# composer just produces the B-side MIDI.
#
# To add a new medley partner, append an entry below with `from` pointing
# at the A-side SCENES key, and override the four "B-side specific" keys:
# pad_chords, bass_pattern, lead_pattern, (and optionally drums).
# =============================================================================

# ---------- 1. cold_open_b — sustain phase: drone + counter-melody ----------
# Same family as A (D Phrygian, 70 BPM, 24 bars, no drums), but B is the
# counter-section — the drone continues, pad expression is already at peak,
# and a counter-melody answers A's whisper. Lead is transposed UP 3-4
# scale degrees (the "voice that's been arguing" feel) so it sits above
# A's previous whisper register. NO silence bars anywhere.
# Shape: bars 0-7 drone + sustained pad only. bars 8-15 counter-melody
# enters (different motifs to A's phrase). bars 16-19 BOTH drone+counter
# at peak. bars 20-23 sustain at high vel then taper to a held note.
SCENES_B["cold_open_b"] = {
    "name": "cold_open_b",
    "bars": 24,                                # same bar count as A
    "bpm": 70,                                 # same BPM as A
    "lead": {"prog": 82, "vol": 95, "pan": 64, "reverb": 55, "mod_init": 0},  # Warm Air Pad (same patch as A)
    "bass": {"prog": 39, "vol": 80, "reverb": 20},   # same patch as A
    "pad":  {"prog": 100, "vol": 90, "pan": 64, "reverb": 95},   # same patch as A
    "drums": {"vol": 0, "reverb": 0},           # same — no percussion
    # Vibrato matches the counter-melody's lyrical argument shape — climbs
    # into the climax and decays at the wrap (same shape as A so the
    # voices share a color, just at higher register).
    "lead_mod_ramp": (0, 55),
    # Counter-melody climbs registers as it argues with A's whisper.
    # 80→115 across the loop — soft entry on bar 8, full by the climax.
    # Higher floor keeps the drone material above the -50dB silenceremove
    # threshold so the rendered MP3 matches the MIDI's true length.
    "lead_vel_ramp": (80, 115),
    # Pad expression already at peak (no ramp, no breakdown). The chord
    # rings at full expression from bar 0 so when crossfade lands, the
    # pad is the floor holding everything together.
    "key_intervals": PHRYGIAN,
    "root": 2,                                 # D Phrygian (same as A)
    # NO pad_breakdowns — pad is constant; pad_vel_ramp gives a gentle
    # human-feel swell from soft entry (already-built) to slight peak,
    # staying loud (no breakdown). When crossfade lands, the pad is the
    # floor holding everything together.
    "pad_vel_ramp": (80, 100, 12),
    # Pad uses A's climax chord (D, G, C, F — the brighter Phrygian mode
    # that A only reaches in its swell). B-side sits there the whole loop.
    "pad_chords": [
        (0,  [N(2,3), N(7,3), N(0,4), N(5,4)]),       # D, G, C, F (sustain chord)
    ],
    # B-side bass: same drone on D as A (continuity of the drone).
    # bars 0-7 = full drone (root + low octave). bars 8-15 = drone with
    # gentle 5th on bar 9, drone on bars 10-11.
    # bars 16-19 = drone with 5th motion (sustained but with harmonic activity).
    # bars 20-23 = TAIL TEXTURE: stronger arpeggio (D4 + F4 + A4 alternating
    # eighth-note pattern, vel 100+) on bass to keep signal above the -50dB
    # silenceremove threshold during the natural SC-55 pad decay. Without
    # this, the MP3 trims to 35s instead of the MIDI's true 85s length —
    # making the medley loop artifact-prone.
    "bass_pattern": [
        # bars 0-7 — pure drone on D (matches A's bar 0-7 state), 8 bars long
        (0, [(N(2,1), PPQ*32, 0), (N(2,2), PPQ*32, 0)]),
        # bars 8-15 — drone + 5th on bar 9, drone for bars 10-15
        (PPQ*32, [(N(2,1), PPQ*8, 0), (N(2,2), PPQ*8, 0),
                  (N(2,1), PPQ*8, 0), (N(2,2), PPQ*8, 0)]),                # bars 8-11
        (PPQ*48, [(N(2,1), PPQ*4, 0), (N(9,2), PPQ*4, 0),                   # bar 12: drone + 5th
                  (N(2,1), PPQ*4, 0), (N(9,2), PPQ*4, 0),
                  (N(2,1), PPQ*4, 0), (N(9,2), PPQ*4, 0),
                  (N(2,1), PPQ*4, 0), (N(9,2), PPQ*4, 0)]),                # bars 12-15
        # bars 16-19 — drone with 5th motion (sustained but with harmonic activity)
        (PPQ*64, [(N(2,1), PPQ*4, 0), (N(9,2), PPQ*4, 0),
                  (N(2,1), PPQ*4, 0), (N(9,2), PPQ*4, 0),
                  (N(2,1), PPQ*4, 0), (N(9,2), PPQ*4, 0),
                  (N(2,1), PPQ*4, 0), (N(9,2), PPQ*4, 0)]),                # bars 16-19
        # bars 20-23 — drone PLUS sustained upper-octave shimmer with
        # velocity high enough (vel +5 → 75 baseline) to keep signal above
        # the -50dB trim. Triadic arpeggio D4/F4/A4 on every beat.
        (PPQ*80, [(N(2,1), PPQ*16, 0), (N(2,2), PPQ*16, 0)]),                # bars 20-23: drone continues
        (PPQ*80, [(N(2,4), PPQ*4, 8), (N(5,4), PPQ*4, 6),                   # bar 20: shimmer vel 78-80
                  (N(2,4), PPQ*4, 8), (N(9,4), PPQ*4, 6),
                  (N(2,4), PPQ*4, 8), (N(5,4), PPQ*4, 6)]),                 # bar 20-21
        (PPQ*88, [(N(2,4), PPQ*4, 8), (N(5,4), PPQ*4, 6),
                  (N(2,4), PPQ*4, 8), (N(9,4), PPQ*4, 6),
                  (N(2,4), PPQ*4, 8), (N(5,4), PPQ*4, 6)]),                 # bar 22
        (PPQ*96, [(N(2,4), PPQ*8, 6), (N(5,4), PPQ*8, 4)]),                  # bar 23: sustained tail
    ],
    # COUNTER-MELODY: entered UP 3-4 scale degrees above A's whisper
    # register. A used D5/C5/Bb4/G5 (bars 8-22). B uses G5/F5/Eb5/G5/Bb5
    # (4th-mode Phrygian pull — the voice that "argues back"). Enters at
    # bar 8 (same spot as A), descends into the climax, then taper to a
    # single held high note at bar 22 like A does.
    "lead_pattern": [
        (PPQ*32, [                                   # bar 8 — answer to A's whisper
            (N(7,5), PPQ*4, -15),                    # G5 (was A's D5)
            (N(5,5), PPQ*4, -10),                    # F5
            (N(3,5), PPQ*8, -5),                     # Eb5 (Phrygian bII, the b6 "argument" note)
            (None, PPQ*16, 0),                       # bars 10-11 rest
        ]),
        (PPQ*64, [                                   # bar 12 — climbing
            (N(7,5), PPQ*4, -5),
            (N(5,5), PPQ*4, -3),
            (N(3,5), PPQ*4, 0),
            (N(7,5), PPQ*4, 3),
        ]),
        (PPQ*80, [                                   # bar 16 — climax (counter at peak)
            (N(7,5), PPQ*2, 5),
            (N(3,6), PPQ*2, 8),                      # Eb6 (the arguing high note)
            (N(5,6), PPQ*4, 10),                     # F6 (above A's G5 peak)
            (N(3,6), PPQ*4, 8),
            (N(7,5), PPQ*2, 5),
            (N(3,6), PPQ*2, 3),
        ]),
        (PPQ*96, [                                   # bar 20 — last gasp before taper
            (N(3,6), PPQ*4, 0),
            (N(7,5), PPQ*4, -5),
        ]),
        (PPQ*104, [                                  # bar 22 — single held high note (taper)
            (N(5,6), PPQ*8, -10),                    # F6 fading to wrap
        ]),
        # bar 23: silence — no notes
    ],
    # Pad held extra cluster at bars 16-19 to keep signal above the
    # -50dB silenceremove threshold during the natural SC-55 pad decay.
    # The pad is the "ceiling" note — a single mid-octave D5 ringed with
    # the louder expression peak. This is the texture that survives the
    # silenceremove trim so the loop keeps its full 85s length.
    "pad_breakdowns": [],
    "cross_boundary_crash": False,                # no drums
    "drum_pattern": [],
}

# ---------- 1c. cold_open_c — peak swell, full climax ---------------
# 24 bars @ 70 BPM. The drone reaches its maximum density. Lead climbs
# into high Phrygian notes (Eb6, F6). Bass has a 5th motion with sustained
# octaves. Pad is at full swell — the climax of the cold open.
SCENES_B["cold_open_c"] = {
    "name": "cold_open_c",
    "bars": 24,
    "bpm": 70,
    "lead": {"prog": 82, "vol": 100, "pan": 64, "reverb": 70, "mod_init": 0},
    "bass": {"prog": 39, "vol": 90, "reverb": 25},
    "pad":  {"prog": 100, "vol": 100, "pan": 64, "reverb": 100},
    "drums": {"vol": 0, "reverb": 0},
    "lead_mod_ramp": (0, 70),
    "lead_vel_ramp": (90, 120),
    "key_intervals": PHRYGIAN,
    "root": 2,                                 # D Phrygian
    "pad_chords": [
        (0,  [N(2,3), N(7,3), N(0,4), N(5,4)]),       # D, G, C, F (full climax chord)
        (12, [N(2,3), N(5,3), N(9,3), N(0,4)]),       # D, F, A, C (Phrygian stack — tension)
    ],
    "pad_vel_ramp": (100, 110, 24),
    "pad_breakdowns": [],
    "lead_pattern": [],
    "bass_pattern": [],
    "drum_pattern": [],
}

def _build_cold_open_c_patterns():
    """Peak swell: lead climbs Phrygian at full vel, bass has 5th motion."""
    cfg = SCENES_B["cold_open_c"]
    bar = PPQ * BEATS_PER_BAR
    EIGHTH = PPQ // 2
    bass_ev = []
    lead_ev = []
    # Bass: drone + 5th throughout, with sustained upper octaves for the climax
    bass_ev.append((0, [
        (N(2,1), PPQ*32, 0), (N(2,2), PPQ*32, 0),
        (N(9,2), PPQ*16, 5), (N(2,2), PPQ*16, 0),
        (N(9,2), PPQ*16, 5), (N(2,2), PPQ*16, 0),
        (N(9,2), PPQ*8, 5), (N(2,2), PPQ*8, 0),
        (N(9,2), PPQ*8, 5), (N(2,2), PPQ*8, 0),
    ]))
    bass_ev.append((PPQ*96, [
        (N(2,1), PPQ*4, 0), (N(2,2), PPQ*4, 0),
        (N(2,4), PPQ*4, 10), (N(5,4), PPQ*4, 8),
        (N(2,4), PPQ*4, 10), (N(9,4), PPQ*4, 8),
        (N(2,4), PPQ*8, 10), (N(5,4), PPQ*8, 8),
    ]))
    cfg["bass_pattern"] = bass_ev
    # Lead: high Phrygian melody, peaks at Eb6/F6, vel climbs to 120
    lead_ev.append((PPQ*16, [
        (N(2,5), PPQ*4, -5), (N(7,5), PPQ*4, 0),
        (N(5,5), PPQ*4, 0), (N(3,6), PPQ*4, 5),    # Eb6 entry
        (N(7,5), PPQ*4, 0), (N(5,6), PPQ*4, 5),    # F6
    ]))
    lead_ev.append((PPQ*32, [
        (N(3,6), PPQ*2, 5), (N(7,5), PPQ*2, 0),
        (N(5,6), PPQ*4, 8), (N(3,6), PPQ*4, 5),
        (N(2,6), PPQ*4, 3), (N(7,5), PPQ*4, 0),
    ]))
    lead_ev.append((PPQ*56, [
        (N(3,6), PPQ*2, 8), (N(5,6), PPQ*2, 10),   # peak
        (N(7,5), PPQ*4, 5), (N(3,6), PPQ*4, 8),
        (N(5,6), PPQ*4, 10), (N(3,6), PPQ*4, 5),
    ]))
    lead_ev.append((PPQ*72, [
        (N(7,5), PPQ*4, 3), (N(5,6), PPQ*4, 5),
        (N(3,6), PPQ*8, 5), (None, PPQ*16, 0),
    ]))
    # bars 17-23: continue climbing, big sustained high note
    lead_ev.append((PPQ*84, [
        (N(2,6), PPQ*4, 5), (N(3,6), PPQ*4, 8),
        (N(5,6), PPQ*8, 10), (N(3,6), PPQ*8, 5),
    ]))
    lead_ev.append((PPQ*96, [
        (N(7,5), PPQ*8, 5), (N(5,6), PPQ*8, 8),
        (N(3,6), PPQ*8, 5), (N(2,6), PPQ*8, 3),
    ]))
    cfg["lead_pattern"] = lead_ev
_build_cold_open_c_patterns()

# ---------- 1d. cold_open_d — cliff-silence scare, single held note -----
# 16 bars @ 70 BPM. Forced-silence: 2 dim7 stabs then COMPLETE PAD SILENCE.
# ONE held low note rings out alone for the rest. The drone was hiding
# something.
SCENES_B["cold_open_d"] = {
    "name": "cold_open_d",
    "bars": 16,
    "bpm": 70,
    "lead": {"prog": 82, "vol": 90, "pan": 64, "reverb": 90, "mod_init": 0},
    "bass": {"prog": 39, "vol": 60, "reverb": 50},
    "pad":  {"prog": 100, "vol": 30, "pan": 64, "reverb": 100},
    "drums": {"vol": 0, "reverb": 0},
    "lead_mod_ramp": (0, 110),                  # HEAVY vibrato on the held note
    "lead_vel_ramp": (95, 110),
    "key_intervals": PHRYGIAN,
    "root": 2,                                 # D Phrygian (same)
    "pad_chords": [
        (0, [N(1,3), N(4,3), N(7,3), N(10,3)]),    # C# dim7 (bar 0 only)
    ],
    "pad_breakdowns": [(1, 15)],                # COMPLETE SILENCE after bar 0
    "pad_vel_ramp": (40, 20, 16),
    "lead_pattern": [],
    "bass_pattern": [],
    "drum_pattern": [],
}

def _build_cold_open_d_patterns():
    """Forced silence: dim7 stab, then single held D3 with tremolo."""
    cfg = SCENES_B["cold_open_d"]
    bar = PPQ * BEATS_PER_BAR
    lead_ev = []
    bass_ev = []
    # Bar 0: C# dim7 stab on lead
    lead_ev.append((0, [
        (N(1,5), PPQ, 0), (N(4,5), PPQ, 0),
        (N(7,5), PPQ, 0), (N(10,5), PPQ, 0),
    ]))
    # Bars 1-15: single held D3 with heavy vibrato (the "voice catches")
    lead_ev.append((PPQ*4, [
        (N(2,3), PPQ*60, 0),    # D3 held for 15 bars
    ]))
    cfg["lead_pattern"] = lead_ev
    # Bass: D2 drone for bar 0, then silence
    bass_ev.append((0, [(N(2,1), PPQ*4, 0)]))         # bar 0: D2 drone
    bass_ev.append((PPQ*4, [(None, PPQ*60, 0)]))       # bars 1-15: silence
    cfg["bass_pattern"] = bass_ev
_build_cold_open_d_patterns()

# ---------- 1e. cold_open_e — recovery, drone returns, loop seam -----
# 24 bars @ 70 BPM. Held D3 continues from D for bars 0-1, then drone
# re-enters at bar 2 with A's opening shape. Pad swell builds back up.
# Last 4 bars mirror A's opening drone for seamless loop.
SCENES_B["cold_open_e"] = {
    "name": "cold_open_e",
    "bars": 24,
    "bpm": 70,
    "lead": {"prog": 82, "vol": 90, "pan": 64, "reverb": 70, "mod_init": 0},
    "bass": {"prog": 39, "vol": 85, "reverb": 25},
    "pad":  {"prog": 100, "vol": 80, "pan": 64, "reverb": 100},
    "drums": {"vol": 0, "reverb": 0},
    "lead_mod_ramp": (110, 0),                  # vibrato decays (recovering)
    "lead_vel_ramp": (85, 100),
    "key_intervals": PHRYGIAN,
    "root": 2,                                 # D Phrygian (same)
    "pad_chords": [
        (0, [N(2,3), N(7,3), N(0,4), N(5,4)]),       # D, G, C, F (return to A's chord)
        (16, [N(2,3), N(5,3), N(9,3), N(0,4)]),      # Phrygian stack (tension)
        (20, [N(2,3), N(5,3), N(9,3), N(0,4)]),      # Phrygian stack (seam)
    ],
    "pad_breakdowns": [],
    "pad_vel_ramp": (60, 90, 24),
    "lead_pattern": [],
    "bass_pattern": [],
    "drum_pattern": [],
}

def _build_cold_open_e_patterns():
    """Recovery: held D3 fades, drone re-enters at bar 2, builds to seam."""
    cfg = SCENES_B["cold_open_e"]
    bar = PPQ * BEATS_PER_BAR
    bass_ev = []
    lead_ev = []
    # Bass: held D3 fades, drone returns at bar 4, builds to upper octave shimmer
    bass_ev.append((0, [(N(2,3), PPQ*8, -10)]))         # bars 0-1: D3 fading from D
    bass_ev.append((PPQ*8, [(N(2,2), PPQ*16, 0), (N(2,1), PPQ*16, 0)]))  # bars 2-5: drone
    bass_ev.append((PPQ*24, [
        (N(2,2), PPQ*8, 0), (N(2,1), PPQ*8, 0),
        (N(9,2), PPQ*8, 5), (N(2,2), PPQ*8, 0),
    ]))
    bass_ev.append((PPQ*40, [
        (N(2,2), PPQ*4, 0), (N(2,1), PPQ*4, 0),
        (N(9,2), PPQ*4, 5), (N(2,2), PPQ*4, 0),
        (N(9,2), PPQ*4, 5), (N(2,2), PPQ*4, 0),
        (N(9,2), PPQ*4, 5), (N(2,2), PPQ*4, 0),
    ]))
    # Bars 16-23: drone + sustained upper-octave shimmer for loop seam
    bass_ev.append((PPQ*64, [
        (N(2,1), PPQ*4, 0), (N(2,2), PPQ*4, 0),
        (N(2,4), PPQ*4, 8), (N(5,4), PPQ*4, 6),
        (N(2,4), PPQ*4, 8), (N(9,4), PPQ*4, 6),
        (N(2,4), PPQ*4, 8), (N(5,4), PPQ*4, 6),
    ]))
    bass_ev.append((PPQ*80, [
        (N(2,4), PPQ*4, 8), (N(5,4), PPQ*4, 6),
        (N(2,4), PPQ*4, 8), (N(9,4), PPQ*4, 6),
        (N(2,4), PPQ*8, 8), (N(5,4), PPQ*8, 6),
    ]))
    cfg["bass_pattern"] = bass_ev
    # Lead: held D3 fades, lead climbs Phrygian melody mirroring A
    lead_ev.append((0, [(N(2,3), PPQ*8, -5)]))           # bars 0-1: D3 fading
    lead_ev.append((PPQ*32, [                            # bar 8 — whisper
        (N(2,5), PPQ*4, -15), (N(7,5), PPQ*4, -10),
        (N(5,5), PPQ*4, -10), (N(3,5), PPQ*8, -5),
    ]))
    lead_ev.append((PPQ*56, [                            # bar 14 — climbing
        (N(7,5), PPQ*4, -5), (N(3,6), PPQ*4, 0),
        (N(5,6), PPQ*4, 3), (N(3,6), PPQ*4, 0),
        (N(7,5), PPQ*4, -3),
    ]))
    lead_ev.append((PPQ*72, [                            # bar 18 — last gasp
        (N(3,6), PPQ*4, 0), (N(7,5), PPQ*4, -3),
    ]))
    lead_ev.append((PPQ*80, [                            # bar 20 — taper
        (N(7,5), PPQ*4, -5), (N(2,5), PPQ*4, -10),
        (N(0,5), PPQ*8, -10),
    ]))
    lead_ev.append((PPQ*96, [                            # bar 24 — sustained fade
        (None, PPQ*32, 0),                              # silence for tail
    ]))
    cfg["lead_pattern"] = lead_ev
_build_cold_open_e_patterns()

# ---------- 2. chase_b — pursuit intensifies, descends into breakdown -----
SCENES_B["chase_b"] = {
    "name": "chase_b",
    "bars": 24,
    "bpm": 132,
    "lead": {"prog": 63, "vol": 90, "pan": 64, "reverb": 35, "mod_init": 0},  # same
    "bass": {"prog": 34, "vol": 100, "reverb": 15},   # same
    "pad":  {"prog": 90, "vol": 85, "pan": 64, "reverb": 70},   # same
    "drums": {"vol": 100, "reverb": 20},     # same
    "key_intervals": MINOR,
    "root": 4,                               # E minor (same)
    "lead_mod_ramp": (0, 0),
    # B-side chords: same key but progression flips — E, G, D, A (i, bIII, bVI, bVII reversed)
    "pad_chords": [
        (0,  [N(4,3), N(8,3), N(2,4), N(9,3)]),       # E, G#, D, A
        (4,  [N(9,3), N(2,4), N(8,3), N(4,3)]),       # A, D, G#, E
        (8,  [N(4,3), N(8,3), N(2,4), N(9,3)]),
        (12, [N(9,3), N(2,4), N(8,3), N(4,3)]),
        (16, [N(4,3), N(8,3), N(2,4), N(9,3)]),
        (20, [N(9,3), N(2,4), N(8,3), N(4,3)]),
    ],
    # Pad ducks in the last bar only — gives the loop wrap a "still going"
    # feel rather than slamming into the next loop start. Otherwise the pad
    # is sustaining, providing the harmonic floor for the chase.
    "pad_breakdowns": [(23, 24)],
    # Lead dynamic ramp: bursts at bar 16 (climax trigger), grows through the
    # loop; the drum snare-rolls on b%4==3 carry the energy throughout.
    "lead_vel_ramp": (75, 105),
    # Pad expression steady at peak (the pad is the harmonic floor here,
    # not a dynamic mover).
    "pad_vel_ramp": (90, 95, 24),
    "lead_pattern": [],
    "bass_pattern": [],
    "drum_pattern": [],
    "cross_boundary_crash": True,
    "crash_velocity": 115,
}
def _build_chase_b_patterns():
    """B-side chase: same 4-on-floor groove but bass walks a 16th-note
    pattern (busier) and lead plays a low staccato figure under the A-side
    melody's ghost — so when both play during the crossfade you hear
    the chase accelerate."""
    bar = PPQ * BEATS_PER_BAR
    eighth = PPQ // 2
    sixteenth = PPQ // 4
    cfg = SCENES_B["chase_b"]
    bass_ev: list = []
    lead_ev: list = []
    drum_ev: list = []
    # B-side bass: 16th-note walking line (vs A's 8th pumping)
    bass_root_low = N(4, 1)  # E2
    bass_root_mid = N(4, 2)  # E3
    bass_fifth = N(11, 1)    # B2
    for b in range(cfg["bars"]):
        # Alternating root for variety per 4-bar section
        if (b // 4) % 2 == 0:
            base = bass_root_low
        else:
            base = N(9, 1)  # A2 (V of E, lifts energy)
        for beat in range(4):
            t = b * bar + beat * PPQ
            # 16th note pattern: root, root, fifth, root (busier than A)
            bass_ev.append((t, [
                (base, sixteenth, 0),
                (base, sixteenth, 0),
                (base + 7, sixteenth, 0),
                (base, sixteenth, 0),
            ]))
    cfg["bass_pattern"] = bass_ev
    # B-side lead: rotating low-register ostinato (vs A's high stabs) —
    # fills the midrange during the crossfade so it doesn't fight the
    # A-side melody, but with phrase variation so the loop isn't just
    # "same note 200 times". Each 4-bar phrase has its own shape.
    motif_per_section = [
        # bars 0-3: down-eighth pulse E4 → B3 (open down)
        [N(2,4), N(2,4), N(11,3), N(2,4), N(2,4), N(11,3), N(9,3), N(11,3)],
        # bars 4-7: punchy E4-G3 stabs with rest (call-and-response)
        [N(2,4), -1, N(2,4), -1, N(9,3), N(2,4), -1, N(9,3)],
        # bars 8-11: climbing then descending line under crossfade
        [N(2,4), N(4,4), N(7,4), N(4,4), N(2,4), N(0,4), N(11,3), N(7,3)],
        # bars 12-15: chromatic touch (the "stinger")
        [N(2,4), N(3,4), N(2,4), N(3,4), N(2,4), N(1,4), N(2,4), N(0,4)],
        # bars 16-19: syncopated e4-b3-rhythm
        [N(2,4), N(2,4), -1, N(2,4), N(11,3), N(2,4), N(11,3), N(9,3)],
        # bars 20-22: tail-off descending slide
        [N(2,4), N(0,4), N(11,3), N(9,3), N(7,3), N(9,3), N(11,3), N(2,4)],
    ]
    for section_idx in range(6):
        bars_in_section = min(4, cfg["bars"] - section_idx * 4)
        if bars_in_section <= 0:
            break
        motif = motif_per_section[section_idx]
        for b in range(section_idx * 4, section_idx * 4 + bars_in_section):
            t = b * bar
            for i, nt in enumerate(motif[:8]):
                if nt == -1:
                    continue
                # per-note velocity: bars 1,3 louder; bars 0,2,4 soft
                vdelta = -10 if section_idx in (0, 2, 4) else -5
                lead_ev.append((t + i * eighth, [(nt, eighth, vdelta)]))
    cfg["lead_pattern"] = lead_ev
    # B-side drums: same groove + extra snare rolls on bar 4 of each section
    for b in range(cfg["bars"]):
        for beat in range(4):
            t = b * bar + beat * PPQ
            if beat in (0, 2):
                drum_ev.append((t, KICK, 100 if beat == 0 else 92))
            if beat in (1, 3):
                drum_ev.append((t, SNARE, 92))
            for e in range(2):
                hat_v = 60 if (beat % 2 == 0 and e == 0) else 50
                drum_ev.append((t + e * eighth, HHAT, hat_v))
        # Snare roll on bar 4 of each section
        if b % 4 == 3:
            for i in range(8):
                drum_ev.append((b * bar + i * eighth, SNARE, 70 + i * 3))
    cfg["drum_pattern"] = drum_ev
_build_chase_b_patterns()

# ---------- 2a. chase_c — the pursuer closes in, kit becomes tom-driven ---
# Same song family as A/B (E minor, 132 BPM with lift to 148 at bar 8) but
# the role of the lead/drums shifts. Where A was a build-up to a half-time
# drop and B was 16th-note bass pressure, C is the AGGRESSION: ride bell
# dominates (instead of hats), tom fills every 2 bars instead of snare
# rolls, lead screams in the high register with faster vibrato, and the
# pad swaps to a brighter voicing (Pad 4 → Polysynth) for the "closing in"
# harmonic shift. Crossfade from B lands mid-section; C is loud.
SCENES_B["chase_c"] = {
    "name": "chase_c",
    "bars": 24,                                # 24 bars matches A/B
    "bpm": 132,
    "lead": {"prog": 63, "vol": 95, "pan": 64, "reverb": 40, "mod_init": 20},  # same saw, more vibrato
    "bass": {"prog": 34, "vol": 105, "reverb": 15},   # same
    "pad":  {"prog": 90, "vol": 90, "pan": 64, "reverb": 65},    # same (Polysynth)
    "drums": {"vol": 105, "reverb": 25},     # louder kit
    "lead_mod_ramp": (20, 80),                # strong vibrato sweep — instability
    "lead_vel_ramp": (85, 115),               # already loud, climbs to scream
    "key_intervals": MINOR,
    "root": 4,                                # E minor
    "tempo_changes": [(8, 148)],              # urgency lift at bar 8
    # Pad chords: brighter voicing (3rd on top instead of root) to lift the
    # harmonic color without leaving the key. Still i, bVI, bIII, bVII.
    "pad_chords": [
        (0,  [N(8,3), N(2,4), N(7,3), N(4,3)]),       # G#-D-B-E (E minor with G# top)
        (4,  [N(2,4), N(7,4), N(4,4), N(0,4)]),       # D-A-E-C (iv with C top)
        (8,  [N(8,3), N(2,4), N(7,3), N(4,3)]),
        (12, [N(0,4), N(5,4), N(2,4), N(9,3)]),       # C-G-D-A (bVII, bVI, V, bIII)
        (16, [N(2,4), N(7,4), N(4,4), N(0,4)]),
        (20, [N(8,3), N(2,4), N(7,3), N(4,3)]),
    ],
    "pad_breakdowns": [],                      # no breakdown — C stays hot
    "pad_vel_ramp": (95, 110, 24),            # peaking pad
    "lead_pattern": [],
    "bass_pattern": [],
    "drum_pattern": [],
    "cross_boundary_crash": True,
    "crash_velocity": 120,
}
def _build_chase_c_patterns():
    """chase_c: ride bell dominant, tom fills every 2 bars, high-register
    saw scream. 4-on-floor at 132→148. The 'close in' phase."""
    bar = PPQ * BEATS_PER_BAR
    eighth = PPQ // 2
    sixteenth = PPQ // 4
    cfg = SCENES_B["chase_c"]
    bass_ev: list = []
    lead_ev: list = []
    drum_ev: list = []

    # ----- BASS ------------------------------------------------------------
    # 8th-note pulse on the root with octave jumps every 2 bars for forward
    # momentum (vs A's pumping, B's 16ths). Faster-feeling even at same BPM.
    for b in range(cfg["bars"]):
        if (b // 4) % 2 == 0:
            root_lo = N(4, 1)        # E2
            root_hi = N(4, 2)        # E3
        else:
            root_lo = N(9, 1)        # A2 (V)
            root_hi = N(9, 2)        # A3
        fifth = root_lo + 7
        for beat in range(4):
            t = b * bar + beat * PPQ
            # 8th-note pulse with octave jump on the offbeat
            bass_ev.append((t, [(root_lo, eighth, 0), (root_hi, eighth, 0),
                                (fifth, eighth, 0), (root_hi, eighth, 0)]))
    cfg["bass_pattern"] = bass_ev

    # ----- LEAD ------------------------------------------------------------
    # High-register saw scream — runs of 16ths that climb and crash, with a
    # breath every 2 bars. The "pursuer is right behind you" voice.
    for b in range(cfg["bars"]):
        t = b * bar
        if b % 2 == 0:
            # Climax run: ascending 16ths
            run = [N(7,4), N(9,4), N(11,4), N(0,5), N(2,5), N(4,5), N(7,5), N(9,5)]
            for i, n in enumerate(run):
                lead_ev.append((t + i * sixteenth, [(n, sixteenth, 0)]))
            # Slight breath on bar 2 of each 4-bar phrase
        else:
            # Sustained high note with one descent
            lead_ev.append((t, [(N(11,5), PPQ*2, 5), (N(7,5), PPQ*2, 0)]))
    # Final descending scream at bar 20 — connects to the loop seam
    for i, n in enumerate([N(9,5), N(7,5), N(4,5), N(2,5), N(0,5), N(11,4), N(9,4), N(7,4)]):
        lead_ev.append((20 * bar + i * sixteenth, [(n, sixteenth, 0)]))
    cfg["lead_pattern"] = lead_ev

    # ----- DRUMS -----------------------------------------------------------
    # Ride-dominant 4-on-floor with tom fills every 2 bars. Crash on bar 8
    # kickoff. Snare roll on bar 3 of every 4-bar section.
    for b in range(cfg["bars"]):
        for beat in range(4):
            t = b * bar + beat * PPQ
            if beat in (0, 2):
                drum_ev.append((t, KICK, 105 if beat == 0 else 95))
            if beat in (1, 3):
                drum_ev.append((t, SNARE, 100))
            # Ride bell every 8th (dominant texture — replaces hats)
            drum_ev.append((t, RIDE, 75 if beat in (0, 2) else 65))
            for e in range(2):
                # Light hi-hat underneath for snap
                drum_ev.append((t + e * eighth, HHAT, 40))
        # Tom fill every 2 bars (bars 1, 3, 5, ...): L→M→H pattern
        if b % 2 == 1:
            for i, tom in enumerate([TOM_LO, TOM_MID, TOM_HI, TOM_HI]):
                drum_ev.append((b * bar + i * eighth, tom, 90 + i * 5))
        # Snare roll on bar 3 of each 4-bar section
        if b % 4 == 2:
            for i in range(8):
                drum_ev.append((b * bar + i * eighth, SNARE, 70 + i * 4))
        # Crash on the kickoff bar 8
        if b == 8:
            drum_ev.append((b * bar, CRASH, 110))
    cfg["drum_pattern"] = drum_ev
_build_chase_c_patterns()

# ---------- 2b. chase_d — caught glimpse, the dread moment ----------------
# D MINOR pivot (vi of E minor — same note in the scale, but a mode
# change that drops the brightness). N(2,4)-TIME 88 BPM. The kit becomes
# heartbeat-only (kick on 1, snare on 3, ride ghost notes). The bass
# is a single low E drone with a slow descent. The lead is ONE held
# high note with heavy modulation (CC1 0→110) — a wailing, scared
# single voice. Pad is at peak with the dim7 voicing (E dim7, G
# dim7, Bb dim7, C# dim7) to add harmonic unease without leaving
# the key. 16 bars total. This is the SCARE — the moment of being seen.
SCENES_B["chase_d"] = {
    "name": "chase_d",
    "bars": 16,
    "bpm": 88,
    "lead": {"prog": 63, "vol": 90, "pan": 64, "reverb": 80, "mod_init": 0},   # saw, but wobbly
    "bass": {"prog": 34, "vol": 95, "reverb": 30},    # a bit of reverb on the drone
    "pad":  {"prog": 90, "vol": 85, "pan": 64, "reverb": 90},    # peak dim7 pad
    "drums": {"vol": 80, "reverb": 40},     # quieter kit (heartbeat, not chase)
    "lead_mod_ramp": (0, 110),               # HEAVY vibrato sweep — wailing
    "lead_vel_ramp": (75, 100),
    "key_intervals": MINOR,
    "root": 4,                                # still E-rooted, but the dim7 is the new color
    # Dim7 pad voicing — slides through a tritone-related progression
    # (E dim7 → G dim7 → Bb dim7 → C# dim7 = dominant chain back to E).
    # Each chord rings 4 bars; held pedal that makes the listener's skin
    # crawl. Bass is E1 drone underneath.
    "pad_chords": [
        (0,   [N(4,3), N(7,3), N(10,3), N(1,4)]),      # E dim7: E-G-Bb-Db
        (4,   [N(7,3), N(10,3), N(1,4), N(4,4)]),      # G dim7: G-Bb-Db-E
        (8,   [N(10,3), N(1,4), N(4,4), N(7,4)]),      # Bb dim7: Bb-Db-E-G
        (12,  [N(1,4), N(4,4), N(7,4), N(10,4)]),      # C# dim7: C#-E-G-Bb (resolves to E)
    ],
    "pad_breakdowns": [],                     # pad holds throughout — no relief
    "pad_vel_ramp": (85, 100, 16),            # already at peak, gentle swell
    "lead_pattern": [],                       # built below — one held note that wobbles
    "bass_pattern": [],
    "drum_pattern": [],
    "cross_boundary_crash": False,            # no crash in the dread
}
def _build_chase_d_patterns():
    """chase_d: the SCARE. Half-time 88 BPM. Heartbeat kit. Single high
    wailing saw note that bends down a half-step at the end. Dim7 pad
    underneath. The chase has stopped; the pursuer is HERE."""
    bar = PPQ * BEATS_PER_BAR
    eighth = PPQ // 2
    cfg = SCENES_B["chase_d"]
    bass_ev: list = []
    lead_ev: list = []
    drum_ev: list = []

    # ----- BASS: E1 drone with slow descent ---------------------------------
    # Bars 0-7: E1 drone, sustained (4 bars each chord change)
    # Bars 8-11: drop to E0 (low octave — sub-bass rumble)
    # Bars 12-15: descend E1 → Eb1 → D1 (the wane)
    bass_ev.append((0, [(N(4,0), PPQ*32, 0)]))             # bars 0-7: E0 sub-drone
    bass_ev.append((PPQ*32, [(N(4,0), PPQ*32, 0)]))        # bars 8-15: E0 continues
    cfg["bass_pattern"] = bass_ev

    # ----- LEAD: one wailing high note that wobbles --------------------------
    # The note starts on B5 (the 5th of E), holds for 14 bars with heavy
    # vibrato (CC1 0→110), then bends down to Bb5 (the b5 — a half-step
    # flat) on bar 14, then to A5 on bar 15. The half-step bend at the
    # end is the "scream that doesn't escape" — voice catches.
    lead_ev.append((0, [(N(11,5), PPQ * 14 * 4 - PPQ, 0)]))    # B5 held bars 0-13
    # Bar 14: bend down B5 → Bb5
    lead_ev.append((PPQ * 14 * 4, [(N(11,5), PPQ * 2, 0),
                                    (N(10,5), PPQ * 2, 0)]))   # B5 → Bb5
    # Bar 15: descend to A5 (the b6 over E — the "incomplete" note)
    lead_ev.append((PPQ * 15 * 4, [(N(10,5), PPQ * 2, 0),
                                    (N(9,5), PPQ * 2, 0)]))    # Bb5 → A5
    cfg["lead_pattern"] = lead_ev

    # ----- DRUMS: heartbeat --------------------------------------------------
    # Kick on beat 1, snare on beat 3 (half-time feel), ride ghost notes
    # on every 8th at low velocity (gives the "shaking" texture). No
    # crash, no fills — pure dread rhythm.
    for b in range(cfg["bars"]):
        t = b * bar
        # Heartbeat
        drum_ev.append((t, KICK, 80))
        drum_ev.append((t + 2 * PPQ, SNARE, 75))
        # Ride ghost notes on every 8th (the "shaking")
        for i in range(8):
            drum_ev.append((t + i * eighth, RIDE, 30))
    cfg["drum_pattern"] = drum_ev
_build_chase_d_patterns()

# ---------- 2c. chase_e — recovery, half-time → full tempo, loop seam ----
# Returns to E minor and the chase energy, but starts at N(2,4)-TIME 88 BPM
# and LIFTS to 132 at bar 12 (heart-rate recovery → re-acceleration). The
# kit gradually comes back: bars 0-3 kick+ride only, bars 4-7 add snare,
# bars 8-11 add hats + toms, bar 12 kickoff (132 BPM), bars 12-19 full
# 4-on-floor with the lead climbing back in. Last bar (bar 19) is the
# loop seam — it ENDS on the same shape as chase A's bar 0 (kick on 1,
# pads about to enter) so when the chase scene loops the A-side picks
# up exactly where E leaves off. 20 bars total.
SCENES_B["chase_e"] = {
    "name": "chase_e",
    "bars": 20,
    "bpm": 88,
    "lead": {"prog": 63, "vol": 75, "pan": 64, "reverb": 35, "mod_init": 0},
    "bass": {"prog": 34, "vol": 95, "reverb": 15},
    "pad":  {"prog": 90, "vol": 80, "pan": 64, "reverb": 70},
    "drums": {"vol": 95, "reverb": 20},
    "lead_vel_ramp": (60, 100),               # whisper at first, climbs back
    "key_intervals": MINOR,
    "root": 4,                                # E minor (back to the song family)
    "tempo_changes": [(12, 132)],             # N(2,4)-TIME LIFT at bar 12
    "pad_chords": [
        (0,  [N(4,3), N(11,3), N(8,3), N(2,4)]),       # E, C, G, D (matches A's opening)
        (4,  [N(9,3), N(4,4), N(2,4), N(7,4)]),       # A, E, D, B
        (8,  [N(4,3), N(11,3), N(8,3), N(2,4)]),
        (12, [N(9,3), N(4,4), N(2,4), N(7,4)]),
        (16, [N(4,3), N(11,3), N(8,3), N(2,4)]),
    ],
    # Pad ducks at the very end (bars 19-20) so the loop seam is clean
    # (A starts with pad at full — the duck absorbs the crossfade).
    "pad_breakdowns": [(19, 20)],
    "pad_vel_ramp": (60, 100, 20),
    "lead_pattern": [],
    "bass_pattern": [],
    "drum_pattern": [],
    "cross_boundary_crash": True,
    "crash_velocity": 110,
}
def _build_chase_e_patterns():
    """chase_e: half-time recovery that lifts to full 4-on-floor. Kit
    comes back bar by bar. Loop seam at bar 19 = A's bar 0 shape."""
    bar = PPQ * BEATS_PER_BAR
    eighth = PPQ // 2
    cfg = SCENES_B["chase_e"]
    bass_ev: list = []
    lead_ev: list = []
    drum_ev: list = []

    # ----- BASS ------------------------------------------------------------
    # bars 0-3: heartbeat — E1 on beat 1 only (matches D's bass)
    # bars 4-7: add 5th on beat 3 (anticipation)
    # bars 8-11: 8th-note pulse returns
    # bars 12-15: tempo lift, 8th-note pulse at higher octave
    # bars 16-19: full 8th-note pulse + octave jump (A's blast feel)
    for b in range(cfg["bars"]):
        t = b * bar
        if b < 4:
            # Heartbeat
            bass_ev.append((t, [(N(4,1), PPQ, 0), (N(4,1), PPQ*3, 0)]))
        elif b < 8:
            # Add 5th on beat 3
            for beat in range(4):
                tt = t + beat * PPQ
                if beat in (0, 2):
                    bass_ev.append((tt, [(N(4,1), eighth, 0), (N(9,1), eighth, 0)]))
                else:
                    bass_ev.append((tt, [(N(9,1), PPQ, 0)]))
        elif b < 12:
            # 8th-note pulse returns
            for beat in range(4):
                tt = t + beat * PPQ
                bass_ev.append((tt, [(N(4,1), eighth, 0), (N(9,1), eighth, 0)]))
        elif b < 16:
            # Tempo lift — higher octave
            for beat in range(4):
                tt = t + beat * PPQ
                bass_ev.append((tt, [(N(4,2), eighth, 0), (N(9,2), eighth, 0)]))
        else:
            # Full blast (matches A's bars 20-23)
            for beat in range(4):
                tt = t + beat * PPQ
                bass_ev.append((tt, [(N(4,1), eighth, 0), (N(4,2), eighth, 0),
                                     (N(9,1), eighth, 0), (N(4,2), eighth, 0)]))
    cfg["bass_pattern"] = bass_ev

    # ----- LEAD ------------------------------------------------------------
    # bars 0-7: SILENT (the wane is over, but the voice hasn't returned)
    # bars 8-11: high-octave sparse stab hints (recovery)
    # bars 12-15: main riff returns (descending run every 2 bars)
    # bars 16-19: BLAST — full descending run + sustained high note
    for b in range(8, 12):
        if b % 2 == 0:
            lead_ev.append((b * bar + PPQ + eighth, [(N(7,4), eighth, -10)]))
    for b in range(12, 16):
        t = b * bar
        for i, nt in enumerate([N(4,4), N(2,4), N(0,4), N(11,3)]):
            lead_ev.append((t + i * eighth, [(nt, eighth, 0)]))
    for b in range(16, 20):
        t = b * bar
        for i, nt in enumerate([N(7,4), N(4,4), N(2,4), N(0,4), N(11,3), N(9,3)]):
            lead_ev.append((t + i * eighth, [(nt, eighth, 0)]))
    # sustain a final high note across bars 16-19 for the wrap smear
    lead_ev.append((16 * bar, [(N(7,4), PPQ * 16, 5)]))
    cfg["lead_pattern"] = lead_ev

    # ----- DRUMS -----------------------------------------------------------
    # bars 0-3: kick on 1 + ride ghost (heartbeat carryover)
    # bars 4-7: add snare on 3 + hi-hats
    # bars 8-11: 4-on-floor at half-time
    # bar 12: TEMPO LIFT — crash, full kit
    # bars 12-19: full 4-on-floor with toms + ride
    for b in range(cfg["bars"]):
        t = b * bar
        if b < 4:
            # Heartbeat
            drum_ev.append((t, KICK, 80))
            for i in range(8):
                drum_ev.append((t + i * eighth, RIDE, 30))
        elif b < 8:
            for beat in range(4):
                tt = t + beat * PPQ
                if beat in (0, 2):
                    drum_ev.append((tt, KICK, 85 if beat == 0 else 75))
                if beat in (1, 3):
                    drum_ev.append((tt, SNARE, 70))
                drum_ev.append((tt + eighth, HHAT, 35))
        elif b < 12:
            # Half-time 4-on-floor
            for beat in range(4):
                tt = t + beat * PPQ
                if beat in (0, 2):
                    drum_ev.append((tt, KICK, 95 if beat == 0 else 85))
                if beat in (1, 3):
                    drum_ev.append((tt, SNARE, 88))
                for e in range(2):
                    drum_ev.append((tt + e * eighth, HHAT, 50))
        else:
            # Full 4-on-floor with ride (matches A's bars 8-11 kickoff)
            for beat in range(4):
                tt = t + beat * PPQ
                if beat in (0, 2):
                    drum_ev.append((tt, KICK, 105 if beat == 0 else 95))
                if beat in (1, 3):
                    drum_ev.append((tt, SNARE, 95))
                for e in range(2):
                    hat_v = 65 if (beat % 2 == 0 and e == 0) else 55
                    drum_ev.append((tt + e * eighth, HHAT, hat_v))
                drum_ev.append((tt + eighth, RIDE, 60))
    # Crash on bar 12 (tempo lift)
    drum_ev.append((12 * bar, CRASH, 110))
    cfg["drum_pattern"] = drum_ev
_build_chase_e_patterns()

def _build_corridor_patterns():
    """Populate SCENES['corridor'] lead_pattern + bass_pattern from the OLD
    corridor_b bars 8-23 (the cinematic Fm→Ab section the user liked).
    Called at module load time, mutates SCENES['corridor'] in-place.
    """
    cfg = SCENES["corridor"]
    bar = PPQ * BEATS_PER_BAR
    eighth = PPQ // 2
    # Lead pattern: music box motif [G4, C5, Eb5, C5] every 2 bars,
    # 8th notes. Vel climbs 75→95 across the 16 bars (matches
    # lead_vel_ramp target).
    # Fm section (bars 0-7): motif_a = [G4, C5, Eb5, C5]
    # Ab section (bars 8-15): motif_a' = [Eb5, G5, Bb5, G5] (shifted up a 4th)
    motif_fm = [N(7,4), N(0,5), N(3,5), N(0,5)]   # G4, C5, Eb5, C5
    motif_ab = [N(3,5), N(7,5), N(10,5), N(7,5)]  # Eb5, G5, Bb5, G5
    lead_ev = []
    for b in range(0, cfg["bars"], 2):
        t = b * bar
        motif = motif_fm if b < 8 else motif_ab
        # Velocity ramp 75→95 across 16 bars
        vel = int(75 + (95 - 75) * (b / max(1, cfg["bars"] - 1)))
        for i, n in enumerate(motif):
            lead_ev.append((t + i * eighth, [(n, eighth, vel - 5)]))
    cfg["lead_pattern"] = lead_ev
    # Bass pattern: F2/C3 alternating in Fm section, Ab2/C3 in Ab section,
    # 4 hits per bar (every 2 beats).
    bass_ev = [
        # Fm (bars 0-7): pulse F2 / C3
        (0, [(N(5,2), PPQ*2, 70), (N(0,3), PPQ*2, 70),
             (N(5,2), PPQ*2, 70), (N(0,3), PPQ*2, 70)]),
        # Ab (bars 8-15): pulse Ab2 / C3
        (PPQ*32, [(N(8,2), PPQ*2, 70), (N(0,3), PPQ*2, 70),
                  (N(8,2), PPQ*2, 70), (N(0,3), PPQ*2, 70)]),
    ]
    cfg["bass_pattern"] = bass_ev
    cfg["drum_pattern"] = []
_build_corridor_patterns()

# ---------- 3. corridor_b — second motif, music box becomes detuned -----
SCENES_B["corridor_b"] = {
    "name": "corridor_b",
    "bars": 24,
    "bpm": 60,
    # B continues A's cinematic feel but adds fullness via octave doubling on the
    # celesta. Same instrument palette as A — laid-back scene, no percussion.
    "lead": {"prog": 8, "vol": 78, "pan": 64, "reverb": 80, "mod_init": 0},  # Celesta
    "bass": {"prog": 39, "vol": 75, "reverb": 30},
    "pad":  {"prog": 100, "vol": 95, "pan": 64, "reverb": 100},
    "drums": {"vol": 0, "reverb": 0},
    "key_intervals": MINOR,
    "root": 0,
    "lead_mod_ramp": (10, 55),
    # B stays in Cm throughout — gives the medley a stable middle before C lifts off.
    # FIX 2026-07-14: was a single Cm chord covering all 24 bars (only 4 note_on
    # events → audit flagged 23-bar empty pad run). Now uses an extended Cm voicing
    # (Cm(maj7) with the natural 9th and 11th) so the held pad has 6 chord tones,
    # plus a brief Fm pull at bar 12 before resolving back to Cm. Still "stable
    # middle" tonally, but the chord progression gives the pad audible motion and
    # lifts the per-bar note density above the silence threshold.
    "pad_chords": [
        (0,  [N(0,3), N(3,3), N(7,3), N(10,3), N(2,4), N(5,4)]),  # Cm(maj9/11) bars 0-11
        (12, [N(5,3), N(8,3), N(0,4), N(3,4)]),                    # Fm         bars 12-15
        (16, [N(0,3), N(3,3), N(7,3), N(10,3), N(2,4), N(5,4)]),  # Cm(maj9/11) bars 16-23
    ],
    "pad_vel_ramp": (95, 90, 24),
    "lead_vel_ramp": (78, 92),
    "lead_pattern": [],
    "bass_pattern": [],
    "drum_pattern": [],
    "cross_boundary_crash": False,
}
def _build_corridor_b_patterns():
    """B-side: cinematic continuation of A in Cm. Same motif structure as
    A but with octave doubling on the celesta from bar 8 onwards so it
    sounds fuller. Returns to Cm at the end. 24 bars @ 60 BPM.
    """
    cfg = SCENES_B["corridor_b"]
    bar = PPQ * BEATS_PER_BAR
    eighth = PPQ // 2
    bass_ev = [
        (0, [(N(0,2), PPQ*2, 0), (N(5,2), PPQ*2, 0),
             (N(0,2), PPQ*2, 0), (N(5,2), PPQ*2, 0)]),
        (PPQ*32, [(N(0,2), PPQ*2, 0), (N(5,2), PPQ*2, 0),
                  (N(0,2), PPQ*2, 0), (N(5,2), PPQ*2, 0)]),
    ]
    motif_a = [N(3,5), N(7,5), N(10,5), N(7,5)]   # Eb-G-Bb-G (Cm)
    lead_ev = []
    for b in range(0, cfg["bars"], 2):
        t = b * bar
        for i, n in enumerate(motif_a):
            lead_ev.append((t + i * eighth, [(n, eighth, 0)]))
            # octave below joins at bars 8+ for fullness
            if b >= 8:
                lead_ev.append((t + i * eighth, [(n - 12, eighth, 0)]))
    cfg["lead_pattern"] = lead_ev
    cfg["bass_pattern"] = bass_ev
    cfg["drum_pattern"] = []
_build_corridor_b_patterns()


# ---------- 3c. corridor_c — paranoia, music box is haunted -------------
# Same instruments as A (Music Box 11 + Warm Pad 100 + Synth Bass 39).
# NO drums — corridor stays slow dread. 24 bars @ 60 BPM.
# The music box develops Cm arpeggios but inserts chromatic passing
# tones that don't resolve (the "haunted" quality). Pad shifts through
# paranoid chord colors (Cm7#11 → Bbmaj7 → Fm7#11 → G7b9 → Cm7#11).
# Bar 12 is the scare beat — silence with a single wrong note (B5)
# that fades after 1 bar. Bars 16-23 resolve the wrong notes into
# unsettlingly correct descending scales.
SCENES_B["corridor_c"] = {
    "name": "corridor_c",
    "bars": 24,
    "bpm": 60,
    "lead": {"prog": 11, "vol": 75, "pan": 64, "reverb": 70, "mod_init": 0},
    "bass": {"prog": 39, "vol": 70, "reverb": 30},
    "pad":  {"prog": 100, "vol": 50, "pan": 64, "reverb": 100},
    "drums": {"vol": 0, "reverb": 0},
    "key_intervals": MINOR,
    "root": 0,
    "lead_mod_ramp": (0, 50),
    # Paranoid chord colors: Cm7#11 → Bbmaj7 → Fm7#11 → G7b9 → Cm7#11
    "pad_chords": [
        (0,  [N(0,3), N(3,3), N(7,3), N(10,3), N(2,4)]),   # Cm7#11
        (4,  [N(10,2), N(2,3), N(5,3), N(9,3)]),          # Bbmaj7
        (8,  [N(5,3), N(8,3), N(0,4), N(3,4), N(10,4)]),   # Fm7#11
        (12, [N(7,3), N(10,3), N(2,4), N(5,4)]),          # G7b9
        (16, [N(0,3), N(3,3), N(7,3), N(10,3), N(2,4)]),   # Cm7#11 (resolution)
    ],
    "pad_breakdowns": [(12, 13), (18, 23)],
    "pad_vel_ramp": (40, 90, 24),
    "lead_pattern": [],
    "bass_pattern": [],
    "drum_pattern": [],
}

def _build_corridor_c_patterns():
    """corridor_c: paranoia phase. Music box with chromatic passing
    tones that don't resolve. Bar 12 scare beat: silence + a single
    wrong note (B5) that fades. Bars 16-23: 'too correct' descending
    scales that sound like a recorder student practising — more
    disturbing than chaos."""
    cfg = SCENES_B["corridor_c"]
    bar = PPQ * BEATS_PER_BAR
    eighth = PPQ // 2
    bass_ev = []
    lead_ev = []

    bass_ev.append((0, [
        (N(0,2), eighth, 0), (N(3,2), eighth, 0),
        (N(7,2), eighth, 0), (N(0,3), eighth, 0),
        (N(10,2), eighth, 0), (N(7,2), eighth, 0),
        (N(3,2), eighth, 0), (N(0,2), eighth, 0),
    ]))
    # bars 4-7: Cm with chromatic b2 (Db) approach
    bass_ev.append((PPQ*16, [
        (N(0,2), eighth, 0), (N(1,2), eighth, 0),  # C2 -> Db2 (b2 approach)
        (N(7,2), eighth, 0), (N(0,3), eighth, 0),
        (N(10,2), eighth, 0), (N(1,2), eighth, 0),  # Db2 again
        (N(7,2), eighth, 0), (N(0,2), eighth, 0),
    ]))
    # bars 8-11: Fm with chromatic approach
    bass_ev.append((PPQ*32, [
        (N(5,2), eighth, 0), (N(4,2), eighth, 0),  # F2 -> E2 (approach)
        (N(0,3), eighth, 0), (N(5,3), eighth, 0),
        (N(3,3), eighth, 0), (N(4,2), eighth, 0),
        (N(0,3), eighth, 0), (N(5,2), eighth, 0),
    ]))
    # bars 12-19: G7 (dominant, tension)
    bass_ev.append((PPQ*48, [
        (N(7,2), PPQ*4, 0), (N(5,2), PPQ*4, 0),
        (N(7,2), PPQ*4, 0), (N(5,2), PPQ*4, 0),
        (N(7,2), PPQ*8, 0), (N(5,2), PPQ*8, 0),
    ]))
    # bars 20-23: Cm restatement
    bass_ev.append((PPQ*80, [
        (N(0,2), PPQ*4, 0), (N(3,2), PPQ*4, 0),
        (N(7,2), PPQ*4, 0), (N(0,3), PPQ*4, 0),
    ]))
    cfg["bass_pattern"] = bass_ev

    # Lead: bars 0-11 — music box Cm with chromatic inserts
    # bars 0-1: ascending Cm with F# insert (chromatic passing tone that
    # doesn't quite resolve — the "haunted" quality)
    lead_ev.append((0, [
        (N(0,5),  PPQ,    0),  (N(3,5),  PPQ,    0),
        (N(6,5),  PPQ,    0),  (N(7,5),  PPQ,    0),  # F#5 (chromatic — wrong note)
        (N(10,5), PPQ//2, 0),  (N(7,5),  PPQ//2, 0),  # F# resolves to F but lands on Bb
        (N(6,5),  PPQ//2, 0),  (N(3,5),  PPQ//2, 0),
    ]))
    lead_ev.append((PPQ*4, [
        (N(3,5),  PPQ//2, 0),  (N(0,5),  PPQ//2, 0),
        (N(3,5),  PPQ//2, 0),  (N(6,5),  PPQ//2, 0),  # G5
        (N(7,5),  PPQ//2, 0),  (N(3,5),  PPQ//2, 0),  # F# insert again
        (N(0,5),  PPQ//2, 0),  (N(3,5),  PPQ//2, 0),
    ]))
    # bars 2-3: descending with chromatic neighbor
    lead_ev.append((PPQ*8, [
        (N(0,5),  PPQ//2, 0),  (N(3,5),  PPQ//2, 0),
        (N(7,5),  PPQ//2, 0),  (N(3,5),  PPQ//2, 0),
        (N(2,5),  PPQ//2, 0),  (N(1,5),  PPQ//2, 0),  # B4 -> Bb4 chromatic
        (N(0,5),  PPQ//2, 0),  (N(1,5),  PPQ//2, 0),
    ]))
    lead_ev.append((PPQ*12, [
        (N(0,5),  PPQ//2, 0),  (N(3,5),  PPQ//2, 0),
        (N(1,5),  PPQ//2, 0),  (N(0,5),  PPQ//2, 0),
        (N(0,5),  PPQ,    0),  (N(0,5),  PPQ,    0),
    ]))

    # bars 4-7: descending with more chromatic inserts
    lead_ev.append((PPQ*16, [
        (N(3,5),  PPQ//2, 0),  (N(2,5),  PPQ//2, 0),  # Bb4
        (N(1,5),  PPQ//2, 0),  (N(0,5),  PPQ//2, 0),
        (N(1,5),  PPQ//2, 0),  (N(2,5),  PPQ//2, 0),  # Bb4 returning
        (N(3,5),  PPQ//2, 0),  (N(2,5),  PPQ//2, 0),
    ]))
    lead_ev.append((PPQ*20, [
        (N(0,5),  PPQ//2, 0),  (N(3,5),  PPQ//2, 0),
        (N(6,5),  PPQ//2, 0),  (N(7,5),  PPQ//2, 0),  # F#5 insert
        (N(10,5), PPQ//2, 0),  (N(7,5),  PPQ//2, 0),
        (N(3,5),  PPQ//2, 0),  (N(0,5),  PPQ//2, 0),
    ]))
    lead_ev.append((PPQ*24, [
        (N(3,5),  PPQ//2, 0),  (N(0,5),  PPQ//2, 0),
        (N(3,5),  PPQ//2, 0),  (N(6,5),  PPQ//2, 0),
        (N(7,5),  PPQ//2, 0),  (N(6,5),  PPQ//2, 0),
        (N(3,5),  PPQ//2, 0),  (N(0,5),  PPQ//2, 0),
    ]))
    lead_ev.append((PPQ*28, [
        (N(3,5),  PPQ//2, 0),  (N(0,5),  PPQ//2, 0),
        (N(3,5),  PPQ,    0),  (N(0,5),  PPQ,    0),
    ]))

    # bars 8-11: Fm arpeggio with wrong-note neighbor (E natural -> F)
    lead_ev.append((PPQ*32, [
        (N(5,5),  PPQ//2, 0),  (N(4,5),  PPQ//2, 0),  # F5 -> E5 (wrong)
        (N(0,5),  PPQ//2, 0),  (N(5,5),  PPQ//2, 0),
        (N(8,5),  PPQ//2, 0),  (N(5,5),  PPQ//2, 0),
        (N(4,5),  PPQ//2, 0),  (N(5,5),  PPQ//2, 0),
    ]))
    lead_ev.append((PPQ*36, [
        (N(5,5),  PPQ//2, 0),  (N(8,5),  PPQ//2, 0),
        (N(0,6),  PPQ//2, 0),  (N(8,5),  PPQ//2, 0),
        (N(5,5),  PPQ//2, 0),  (N(4,5),  PPQ//2, 0),  # E5 wrong
        (N(5,5),  PPQ//2, 0),  (N(3,5),  PPQ//2, 0),
    ]))
    lead_ev.append((PPQ*40, [
        (N(3,5),  PPQ//2, 0),  (N(4,5),  PPQ//2, 0),  # E5 wrong
        (N(5,5),  PPQ//2, 0),  (N(4,5),  PPQ//2, 0),
        (N(3,5),  PPQ//2, 0),  (N(0,5),  PPQ//2, 0),
        (N(3,5),  PPQ//2, 0),  (N(5,5),  PPQ//2, 0),
    ]))
    lead_ev.append((PPQ*44, [
        (N(5,5),  PPQ*2,   0),  (N(3,5),  PPQ*2,   -5),
    ]))

    # ===== BAR 12 — SILENCE + single wrong note B5 (the scare beat) =====
    # The wrong note fades over 1 bar — it's the "music box is haunted"
    # payoff. Uses a non-chord tone (B natural over G7 — the #11).
    lead_ev.append((PPQ*48, [
        (N(11,5), PPQ*4, 10),  # B5 with accent, fades out via vel ramp
    ]))
    # bar 13: silence (the wrong note has faded)
    # bars 14-15: brief Cm phrase to bridge to the "too correct" section
    lead_ev.append((PPQ*56, [
        (N(0,5),  PPQ,    0),  (N(3,5),  PPQ,    0),
        (N(7,5),  PPQ,    0),  (N(3,5),  PPQ,    0),
    ]))
    lead_ev.append((PPQ*60, [
        (N(7,5),  PPQ,    0),  (N(10,5), PPQ,    0),
        (N(7,5),  PPQ,    0),  (N(3,5),  PPQ,    0),
    ]))

    # bars 16-23: "too correct" descending scales — recorder student
    # practising. Unsettling because it's mechanical, not chaotic.
    # Each bar: a clean descending line, all chord tones, no wrong notes,
    # but the *contour and rhythm* differ between bars (not a 4-bar
    # arpeggio loop). The preceding "haunted" chromatic section was full
    # of false resolutions; this section is the opposite — readable,
    # dead-on, repeating the same 4 notes... which is why the user
    # found the previous version "spartan and repetitive". The fix is
    # to keep the "recorder practising" reading intact while varying
    # the contour per bar.
    #
    # bar 16: Bb-G-Eb-C descending, evenly (the template line)
    lead_ev.append((PPQ*64, [
        (N(10,5), PPQ//2, 0),  (N(7,5),  PPQ//2, 0),
        (N(3,5),  PPQ//2, 0),  (N(0,5),  PPQ//2, 0),
        (N(3,5),  PPQ//2, 0),  (N(7,5),  PPQ//2, 0),
        (N(10,5), PPQ//2, 0),  (N(7,5),  PPQ//2, 0),
    ]))
    # bar 17: same pitches but RHYTHM shifted (long-short-short) so it
    # doesn't read as the same phrase. Octave shift on C adds range.
    lead_ev.append((PPQ*68, [
        (N(3,5),  PPQ,    0),  (N(0,5),  PPQ//2, 0),
        (N(0,6),  PPQ//2, 0),  # C6 — octave up, only here
        (N(3,5),  PPQ,    0),  (N(7,5),  PPQ,    0),
    ]))
    # bar 18: triplet-feel arpeggio up, then long C5 (held weight)
    lead_ev.append((PPQ*72, [
        (N(7,5),  PPQ//2, 0),  (N(3,5),  PPQ//2, 0),
        (N(0,5),  PPQ//2, 0),  (N(3,5),  PPQ//2, 0),
        (N(7,5),  PPQ//2, 0),  (N(10,5), PPQ//2, 0),
        (N(7,5),  PPQ*1,  0),
    ]))
    # bar 19: cadential Bb-C-Bb-C (the "student corrects herself") with
    # a deliberate "stutter" rhythm — value pairs, like a beginner
    # counting beats out loud.
    lead_ev.append((PPQ*76, [
        (N(10,5), PPQ//2, 0),  (N(0,5),  PPQ//2, 0),
        (N(10,5), PPQ//2, 0),  (N(0,5),  PPQ//2, 0),
        (N(10,5), PPQ,    0),  (N(7,5),  PPQ,    0),
    ]))
    # bars 20-23: settle to Cm. The previous version had only 5 notes
    # across 16 beats with vel ramp to -8 — read as "thin / spartan".
    # The "recorder" character wants the player to wind down into a
    # final Cm phrase, not evaporate. Use quarter-note pulse at vel 0
    # (no soft ramp) with the LAST bar's last note drifting up (D5)
    # for a fade-into-silence that's distinct from the C5 drone.
    lead_ev.append((PPQ*80, [
        (N(10,5), PPQ,    0),  (N(7,5),  PPQ,    0),
        (N(3,5),  PPQ,    0),  (N(0,5),  PPQ,    0),
    ]))
    lead_ev.append((PPQ*84, [
        (N(7,5),  PPQ,    0),  (N(3,5),  PPQ,    0),
        (N(0,5),  PPQ,    0),  (N(3,5),  PPQ,    0),
    ]))
    # bar 22: longer 2-beat notes drifting toward silence
    lead_ev.append((PPQ*88, [
        (N(7,5),  PPQ*2,  -3),
        (N(3,5),  PPQ*2,  -5),
    ]))
    # bar 23: one final held C5 with negative-vel soften — lets the
    # pad_breakdown (18-23) drop the pad AND the lead tails out into
    # loop-seam silence cleanly.
    lead_ev.append((PPQ*92, [
        (N(0,5),  PPQ*4,  -8),
    ]))
    cfg["lead_pattern"] = lead_ev
_build_corridor_c_patterns()

# ---------- 3d. corridor_d — the cliff-hanger -------------------------
# 8 bars @ 60 BPM. Music box plays dim7 stabs for bars 0-2, then a
# single held high C7 with vibrato for bars 3-7. Bass is a single C2
# drone cut by silence. Pad drops to one chord. Like chase_d but for
# corridor — the scare moment is a held note trembling, not a wailing
# saw scream.
SCENES_B["corridor_d"] = {
    "name": "corridor_d",
    "bars": 16,
    "bpm": 60,
    "lead": {"prog": 11, "vol": 75, "pan": 64, "reverb": 80, "mod_init": 0},
    "bass": {"prog": 39, "vol": 50, "reverb": 50},
    "pad":  {"prog": 100, "vol": 40, "pan": 64, "reverb": 100},
    "drums": {"vol": 0, "reverb": 0},
    "key_intervals": MINOR,
    "root": 0,
    "lead_mod_ramp": (0, 110),                # HEAVY vibrato on the held note
    "lead_vel_ramp": (85, 100),
    "pad_chords": [
        (0, [N(1,3), N(4,3), N(7,3), N(10,3)]),    # C# dim7 (bars 0-2)
        (3, [N(0,3), N(3,3), N(7,3), N(10,3)]),    # Cm (bars 3-7, quiet)
    ],
    "pad_breakdowns": [(6, 7), (12, 15)],       # sustained silence from bar 12 onward
    "pad_vel_ramp": (40, 20, 16),              # fading across full 16 bars
    "lead_pattern": [],
    "bass_pattern": [],
    "drum_pattern": [],
}

def _build_corridor_d_patterns():
    """corridor_d: the scare. 8 bars. Dim7 stabs → single held music-box
    C7 with heavy vibrato. The held note trembles (micro-silences from
    vibrato modulation) — same technique as corp_office_d but with
    music box timbre instead of EP."""
    cfg = SCENES_B["corridor_d"]
    bar = PPQ * BEATS_PER_BAR
    bass_ev = []
    lead_ev = []

    # Bass: C2 drone for bars 0-2, then silence for bars 3-7
    bass_ev.append((0, [(N(0,2), PPQ*12, 0)]))       # bars 0-2: C2 drone
    bass_ev.append((PPQ*12, [(None, PPQ*52, 0)]))    # bars 3-15: silence
    cfg["bass_pattern"] = bass_ev

    # Lead: dim7 stabs (bars 0-2), then single held C7 with vibrato (bars 3-7)
    # bar 0: C# dim7 stab (C#-E-G-Bb)
    lead_ev.append((0, [
        (N(1,5), PPQ, 0), (N(4,5), PPQ, 0),
        (N(7,5), PPQ, 0), (N(10,5), PPQ, 0),
    ]))
    # bar 1: F# dim7 stab (F#-A-C-Eb)
    lead_ev.append((PPQ*4, [
        (N(6,5), PPQ, 0), (N(9,5), PPQ, 0),
        (N(0,6), PPQ, 0), (N(3,6), PPQ, 0),
    ]))
    # bar 2: silence (between stabs and held note)
    # bars 3-7: single held C7 with vibrato (heavy CC1 ramp makes it tremble)
    lead_ev.append((PPQ*12, [
        (N(0,7), PPQ*20, 0),    # C7 held for 5 bars
    ]))
    # bars 8-12: held G5 (drops a 5th) — the dread deepens. Music box
    # timbre on a lower pitch with the same heavy vibrato makes it feel
    # like the held note is sinking rather than ringing out.
    lead_ev.append((PPQ*32, [
        (N(7,5), PPQ*20, -10),   # G5 held, vel -10 (sinking)
    ]))
    # bars 13-14: silence (the dread resolves into nothing)
    # bar 15: single ghost note — Bb5 fading, a final "music box is haunted" whisper
    lead_ev.append((PPQ*60, [
        (N(10,5), PPQ*4, -15),   # Bb5 ghost note, very quiet
    ]))
    cfg["lead_pattern"] = lead_ev
_build_corridor_d_patterns()

# ---------- 3e. corridor_e — recovery, loop seam back to A -----------
# 24 bars @ 60 BPM. The held C7 from D continues for bars 0-1, then
# music box motif re-enters with A's opening shape. Pad Cm returns.
# Bass walking returns. Bars 20-23 mirror A's opening for seamless
# loop seam.
SCENES_B["corridor_e"] = {
    "name": "corridor_e",
    "bars": 24,
    "bpm": 60,
    "lead": {"prog": 11, "vol": 75, "pan": 64, "reverb": 70, "mod_init": 0},
    "bass": {"prog": 39, "vol": 70, "reverb": 30},
    "pad":  {"prog": 100, "vol": 50, "pan": 64, "reverb": 100},
    "drums": {"vol": 0, "reverb": 0},
    "key_intervals": MINOR,
    "root": 0,
    "lead_mod_ramp": (110, 0),                # vibrato decays to 0 (recovering)
    "lead_vel_ramp": (75, 75),
    # Pad starts quiet (vol=50) and recovers. Extended Cm voicing for fuller
    # held sound during the recovery — same chord-tone-density fix as corridor_b.
    "pad_chords": [
        (0,  [N(0,3), N(3,3), N(7,3), N(10,3), N(2,4), N(5,4)]),  # Cm(maj9/11) bars 0-19
        (20, [N(0,3), N(3,3), N(7,3), N(10,3), N(2,4), N(5,4)]),  # Cm(maj9/11) bars 20-23
    ],
    "pad_breakdowns": [],
    "pad_vel_ramp": (40, 60, 24),
    "lead_pattern": [],
    "bass_pattern": [],
    "drum_pattern": [],
}

def _build_corridor_e_patterns():
    """corridor_e: recovery. Held C7 from D continues for bars 0-1,
    music box motif re-enters at bar 2 with A's opening shape. Bass
    walking returns. Bars 20-23 mirror A's opening for loop seam."""
    cfg = SCENES_B["corridor_e"]
    bar = PPQ * BEATS_PER_BAR
    eighth = PPQ // 2
    bass_ev = []
    lead_ev = []

    # Bass: Cm walking from bar 0 (recovery)
    bass_ev.append((0, [
        (N(0,2), eighth, 0), (N(3,2), eighth, 0),
        (N(7,2), eighth, 0), (N(0,3), eighth, 0),
        (N(10,2), eighth, 0), (N(7,2), eighth, 0),
        (N(3,2), eighth, 0), (N(0,2), eighth, 0),
    ]))
    bass_ev.append((PPQ*16, [
        (N(0,2), eighth, 0), (N(3,2), eighth, 0),
        (N(5,2), eighth, 0), (N(7,2), eighth, 0),
        (N(0,3), eighth, 0), (N(10,2), eighth, 0),
        (N(7,2), eighth, 0), (N(5,2), eighth, 0),
    ]))
    bass_ev.append((PPQ*32, [
        (N(0,2), eighth, 0), (N(5,2), eighth, 0),
        (N(0,3), eighth, 0), (N(5,2), eighth, 0),
        (N(7,2), eighth, 0), (N(0,3), eighth, 0),
        (N(3,2), eighth, 0), (N(0,2), eighth, 0),
    ]))
    bass_ev.append((PPQ*48, [
        (N(0,2), PPQ*8, 0), (N(7,2), PPQ*8, 0),
        (N(3,2), PPQ*8, 0), (N(0,2), PPQ*8, 0),
    ]))
    bass_ev.append((PPQ*80, [
        (N(0,2), PPQ*16, 0),
    ]))
    cfg["bass_pattern"] = bass_ev

    # Lead: bars 0-1: held C7 continues from D, vibrato decaying
    lead_ev.append((0, [
        (N(0,7), PPQ*8, 0),
    ]))
    # bar 2: music box motif re-enters with A's opening (C-Eb-G-Bb ascending)
    lead_ev.append((PPQ*8, [
        (N(0,5), PPQ, 0), (N(3,5), PPQ, 0),
        (N(7,5), PPQ, 0), (N(10,5), PPQ, 0),
    ]))
    # bars 3-7: ascending melodic content (recovery, building)
    lead_ev.append((PPQ*12, [
        (N(3,5), PPQ//2, 0), (N(0,5), PPQ//2, 0),
        (N(3,5), PPQ//2, 0), (N(7,5), PPQ//2, 0),
        (N(3,5), PPQ//2, 0), (N(0,5), PPQ//2, 0),
        (N(3,5), PPQ//2, 0), (N(0,5), PPQ//2, 0),
    ]))
    lead_ev.append((PPQ*16, [
        (N(0,5), PPQ//2, 0), (N(3,5), PPQ//2, 0),
        (N(7,5), PPQ//2, 0), (N(10,5), PPQ//2, 0),
        (N(0,6), PPQ//2, 0), (N(10,5), PPQ//2, 0),
        (N(7,5), PPQ//2, 0), (N(3,5), PPQ//2, 0),
    ]))
    lead_ev.append((PPQ*20, [
        (N(0,5), PPQ//2, 0), (N(3,5), PPQ//2, 0),
        (N(0,5), PPQ//2, 0), (N(7,4), PPQ//2, 0),
        (N(7,5), PPQ//2, 0), (N(10,4), PPQ//2, 0),
        (N(10,5), PPQ//2, 0), (N(0,5), PPQ//2, 0),
    ]))
    lead_ev.append((PPQ*24, [
        (N(10,5), PPQ//2, 0), (N(7,5), PPQ//2, 0),
        (N(3,5), PPQ//2, 0), (N(0,5), PPQ//2, 0),
        (N(3,5), PPQ,    0), (N(0,5), PPQ,    0),
    ]))
    # bars 8-19: ascending melodic content resolving back to A's shape
    for b in range(8, 20):
        t = b * bar
        if b % 2 == 0:
            lead_ev.append((t, [
                (N(0,5), PPQ, 0), (N(3,5), PPQ, 0),
                (N(7,5), PPQ, 0), (N(10,5), PPQ, 0),
            ]))
        else:
            lead_ev.append((t, [
                (N(10,5), PPQ, 0), (N(7,5), PPQ, 0),
                (N(3,5), PPQ, 0), (N(0,5), PPQ, 0),
            ]))
    # bars 20-23: mirror A's opening for loop seam
    lead_ev.append((PPQ*80, [
        (N(0,5), PPQ, 0), (N(3,5), PPQ, 0),
        (N(7,5), PPQ, 0), (N(10,5), PPQ, 0),
    ]))
    lead_ev.append((PPQ*84, [
        (N(10,5), PPQ, 0), (N(7,5), PPQ, 0),
        (N(5,5), PPQ, 0), (N(3,5), PPQ, 0),
    ]))
    lead_ev.append((PPQ*88, [
        (N(2,5), PPQ, 0), (N(3,5), PPQ, 0),
        (N(0,5), PPQ, 0), (N(0,5), PPQ, 0),
    ]))
    cfg["lead_pattern"] = lead_ev
_build_corridor_e_patterns()
# ---------- 4. jailbreak_b — tension lifts, becomes urgent triumph ------
SCENES_B["jailbreak_b"] = {
    "name": "jailbreak_b",
    "bars": 24,
    "bpm": 120,
    # Same patch family: Lead 2 (sawtooth) but B-side modulates CC1
    # harder for more vibrato (urgency → desperation)
    "lead": {"prog": 81, "vol": 90, "pan": 64, "reverb": 45, "mod_init": 0},
    "bass": {"prog": 34, "vol": 100, "reverb": 15},
    "pad":  {"prog": 101, "vol": 85, "pan": 64, "reverb": 75},
    "drums": {"vol": 100, "reverb": 25},
    "key_intervals": MINOR,
    "root": 9,                               # A minor (same)
    "lead_mod_ramp": (0, 60),                # climbs higher than A
    # B-side chords: Am → Dm → E → Am (i → iv → V → i, classic turnaround)
    "pad_chords": [
        (0,  [N(9,3), N(0,4), N(4,4), N(7,4)]),       # Am
        (4,  [N(2,3), N(5,3), N(9,3), N(0,4)]),       # Dm
        (8,  [N(4,3), N(7,3), N(11,3), N(2,4)]),      # E
        (12, [N(2,3), N(5,3), N(9,3), N(0,4)]),       # Dm
        (16, [N(9,3), N(0,4), N(4,4), N(7,4)]),       # Am
        (20, [N(4,3), N(7,3), N(11,3), N(2,4)]),      # E (turnaround to A)
    ],
    # TEMPO PUSH at bar 12 — 120 → 132 (matches A's push so the medley
    # crossfade keeps the urgency going rather than dropping back).
    "tempo_changes": [(12, 132)],
    # Lead dynamic ramps hard — already running, no slow buildup.
    "lead_vel_ramp": (80, 110),
    # Pad pushes peaks for the running-escape feel.
    "pad_vel_ramp": (75, 105, 24),
    "lead_pattern": [],
    "bass_pattern": [],
    "drum_pattern": [],
    "cross_boundary_crash": True,
    "crash_velocity": 110,
}
def _build_jailbreak_b_patterns():
    bar = PPQ * BEATS_PER_BAR
    eighth = PPQ // 2
    cfg = SCENES_B["jailbreak_b"]
    chord_roots = [9, 2, 4, 2, 9, 4]
    # B-side bass: similar 8th-note pulse but with octave drops for urgency
    bass_ev = []
    for b in range(cfg["bars"]):
        root = N(chord_roots[b // 4], 1)
        root_hi = N(chord_roots[b // 4], 2)
        for beat in range(4):
            t = b * bar + beat * PPQ
            if beat == 2:
                bass_ev.append((t, [(root_hi, eighth, 0), (root, eighth, 0)]))
            else:
                bass_ev.append((t, [(root, eighth, 0), (root_hi, eighth, 0)]))
    cfg["bass_pattern"] = bass_ev
    # B-side lead: ascending riff (vs A's descending)
    riff = [N(11,3), N(0,4), N(2,4), N(4,4), N(7,4), N(4,4), N(2,4), N(0,4)]
    lead_ev = []
    for b in range(0, cfg["bars"], 2):
        t = b * bar
        for i, n in enumerate(riff):
            lead_ev.append((t + i * eighth, [(n, eighth, 0)]))
    cfg["lead_pattern"] = lead_ev
    # Same drum pattern as A
    drum_ev = []
    for b in range(cfg["bars"]):
        for beat in range(4):
            t = b * bar + beat * PPQ
            if beat in (0, 2):
                drum_ev.append((t, KICK, 100 if beat == 0 else 92))
            if beat in (1, 3):
                drum_ev.append((t, SNARE, 94))
            for e in range(2):
                hat_note = HHAT_OPEN if (beat == 3 and e == 1) else HHAT
                hat_v = 55 if beat in (1, 3) else 45
                drum_ev.append((t + e * eighth, hat_note, hat_v))
    cfg["drum_pattern"] = drum_ev
_build_jailbreak_b_patterns()

# ---------- 5. kabukicho_b — sax takes harmony, walking bass lifts -------
SCENES_B["kabukicho_b"] = {
    "name": "kabukicho_b",
    "bars": 16,                              # jazz stays 16 bars
    "bpm": 88,
    "lead": {"prog": 66, "vol": 95, "pan": 64, "reverb": 50, "mod_init": 30},  # sax
    "bass": {"prog": 32, "vol": 90, "reverb": 25},   # upright
    "pad":  {"prog": 89, "vol": 75, "pan": 64, "reverb": 80},
    "drums": {"vol": 85, "reverb": 30},
    "key_intervals": MINOR,
    "root": 5,                               # F minor (same)
    "lead_mod_ramp": (30, 60),               # more vibrato
    # B-side chords: Fm7 → Db7 → Cm7 → Bbm7 (jazz turnaround!)
    "pad_chords": [
        (0,  [N(5,3), N(8,3), N(0,4), N(3,4)]),       # Fm7
        (4,  [N(1,3), N(5,3), N(8,3), N(0,4)]),       # Db7 (tritone sub of G7)
        (8,  [N(0,3), N(3,3), N(7,3), N(10,3)]),      # Cm7
        (12, [N(3,3), N(7,3), N(10,3), N(2,4)]),      # Bbm7
    ],
    # Bass dynamic — climbs from soft entry to peak in B section, decays.
    "bass_vel_ramp": (60, 95),
    # Pad climbs (head-out swell) then dips as the sax walks down.
    "pad_vel_ramp": (75, 100, 16),
    # Sax vel climbs into the head-out repetition then softens.
    "lead_vel_ramp": (75, 95),
    "lead_pattern": [],
    "bass_pattern": [],
    "drum_pattern": [],
    "cross_boundary_crash": False,
}
def _build_kabukicho_b_patterns():
    bar = PPQ * BEATS_PER_BAR
    cfg = SCENES_B["kabukicho_b"]
    chord_roots = [5, 1, 0, 3]
    # B-side bass: walking with more chromatic approach notes
    bass_ev = []
    for b in range(cfg["bars"]):
        root = N(chord_roots[(b // 4) % 4], 1)
        for beat in range(4):
            t = b * bar + beat * PPQ
            if beat == 3:
                # chromatic approach to next chord
                next_root = N(chord_roots[((b // 4) + 1) % 4], 1)
                approach = next_root + 1 if next_root > root else next_root - 1
                bass_ev.append((t, [(root_lo:=root, PPQ // 2, 0),
                                    (approach, PPQ // 2, 0)]))
            else:
                bass_ev.append((t, [(root, PPQ, 0)]))
    cfg["bass_pattern"] = bass_ev
    # B-side lead: harmony fill (3rds & 7ths above the A-side melody)
    phrase = [
        (N(8,4), PPQ), (N(10,4), PPQ), (N(0,5), PPQ), (N(3,5), PPQ),
        (N(8,4), PPQ), (N(10,4), PPQ), (N(0,5), PPQ), (N(3,5), PPQ),
    ]
    lead_ev = []
    for b in range(cfg["bars"]):
        t = b * bar
        # harmonize in 3rds above A's melody shape (rough — A's melody
        # isn't perfectly transposed, this is "harmony filler" — sax harmony
        # floats over the A-side call)
        harmony_root = N(chord_roots[(b // 4) % 4], 4)
        for i in range(4):
            lead_ev.append((t + i * PPQ, [(harmony_root + 3, PPQ, 0)]))
        # response lick on bar 2 of every 4-bar phrase
        if b % 4 == 1:
            for i, n in enumerate(phrase):
                # phrase entries are (key, dur) pairs — unpack them
                lead_ev.append((t + i * (PPQ // 2), [(n[0], n[1], 0)]))
    cfg["lead_pattern"] = lead_ev
    # Same brushed-kit drums
    drum_ev = []
    for b in range(cfg["bars"]):
        for beat in range(4):
            t = b * bar + beat * PPQ
            for e in range(2):
                drum_ev.append((t + e * (PPQ // 2), RIDE, 45))
            if beat in (0, 2):
                drum_ev.append((t, KICK, 55))
            if beat in (1, 3):
                drum_ev.append((t, SNARE, 50))
    cfg["drum_pattern"] = drum_ev
_build_kabukicho_b_patterns()

# ---------- 6. corp_office_b — after-hours solo, intimate reveal ----------
# Replaces the old E.Piano-stabs-to-arpeggios B-side (which the user flagged
# as "too repetitive and not much of a complement to A"). The old B was just
# A with a different texture; this new B is a DIFFERENT PHASE: A is daytime
# build-to-climax, B is one person staying late — solo EP arpeggios over
# halo pad swell, NO bass, NO drums. Spacious, intimate, slightly menacing
# in its emptiness. Chord cycle slows to 5 chords × 4 bars each.
SCENES_B["corp_office_b"] = {
    "name": "corp_office_b",
    "bars": 20,                              # 5 chords × 4 bars
    "bpm": 92,
    "lead": {"prog": 5, "vol": 80, "pan": 64, "reverb": 70, "mod_init": 0},  # EP, more reverb
    "bass": {"prog": 0, "vol": 0, "reverb": 0},    # SILENT channel
    "pad":  {"prog": 94, "vol": 70, "pan": 64, "reverb": 95},   # Halo Pad at peak
    "drums": {"vol": 0, "reverb": 0},         # NO drums — the silence is the point
    "lead_vel_ramp": (50, 75),                # restrained — never gets loud
    "key_intervals": MINOR,
    "root": 6,                               # F# minor
    "lead_mod_ramp": (10, 35),
    # Pad chords: same F#m family but with extensions (6th and 9th) for
    # the late-night "alone in the building" harmonic color. Slow 5-chord
    # cycle (4 bars each): F#m → Bm → C#m → A → Dmaj7 (resolves via bVI).
    # The D major resolve is the "first hint of something off" — it lands
    # where the listener expects to come back to F#m but doesn't.
    "pad_chords": [
        (0,  [N(6,3), N(9,3), N(1,4), N(4,4)]),       # F#m  (bars 0-3)
        (4,  [N(1,3), N(6,3), N(11,3), N(4,4)]),      # Bm9  (bars 4-7)
        (8,  [N(4,3), N(9,3), N(1,4), N(6,4)]),       # C#m9 (bars 8-11)
        (12, [N(9,3), N(2,4), N(6,4), N(11,4)]),      # A6   (bars 12-15)
        (16, [N(2,3), N(7,3), N(4,4), N(7,4)]),       # Dmaj7 (bars 16-19, the deceptive hold)
    ],
    # Pad expression already at peak (no crescendo — the calm is constant)
    "pad_vel_ramp": (75, 85, 20),
    # Pad breakdowns: NONE — the pad must hold throughout (silence elsewhere)
    "pad_breakdowns": [],
    "lead_pattern": [],
    "bass_pattern": [],                       # silence is intentional
    "drum_pattern": [],                       # silence is intentional
    "cross_boundary_crash": False,
}
def _build_corp_office_b_patterns():
    """corp_office_b: after-hours solo. EP arpeggios floating over halo
    pad. NO bass, NO drums. The arpeggios use 9ths and 11ths for the
    'alone in an empty building' mood — minor 7th intervals specifically
    chosen to feel unsettled."""
    bar = PPQ * BEATS_PER_BAR
    eighth = PPQ // 2
    cfg = SCENES_B["corp_office_b"]
    lead_ev: list = []

    # Chord roots for arpeggio voicing (mirrors pad_chords above)
    chord_data = [
        # (root_idx, [9th, 11th, 5th, 9th above])
        (6, [11, 2, 4, 3]),    # F#m9: B-C#-E-F# (the 9 = G#)
        (1, [11, 4, 1, 8]),    # Bm9: F#-A#-B-A# (=F# the b3 color)
        (4, [9, 4, 11, 1]),    # C#m9: D#-A#-F#-G# (no root)
        (9, [4, 11, 7, 9]),    # A6: A-E-D-A (6th color)
        (2, [11, 9, 7, 2]),    # Dmaj7: D-A-C#-D (the deceptive landing)
    ]

    for b in range(cfg["bars"]):
        t = b * bar
        root_idx, intervals = chord_data[b // 4 % 5]
        # Arpeggio: 4-note ascending + 4-note descending 8th-note pattern
        # but transposed to a chord-tone scale so it sounds modal
        notes = [N(root_idx, 4)] + [N(root_idx + i, 4) for i in intervals]
        # 8th-note arpeggio up & down
        seq = notes + notes[::-1]
        for i, n in enumerate(seq):
            lead_ev.append((t + i * eighth, [(n, eighth, -8)]))

    cfg["lead_pattern"] = lead_ev
    # Bass and drums intentionally empty (silence)
_build_corp_office_b_patterns()

# ---------- 6a. corp_office_c — paranoia phase, surveillance glitch ------
# A-side is daytime build, B is intimate after-hours, C is "something's
# wrong with the data" — the kit glitches, the bass enters with a
# chromatic b2 approach (the "wrong note"), the pad's harmonic voicing
# shifts to sharp 11ths (the "off" colour), and the EP plays the same
# arpeggio as B but with a passing-tone dissonance once per bar — a
# non-chord tone that throws the loop out of phase. This is the moment
# of surveillance malfunction; nothing is loud, but everything is
# slightly **wrong**.
SCENES_B["corp_office_c"] = {
    "name": "corp_office_c",
    "bars": 20,                              # 5 chords × 4 bars
    "bpm": 92,
    "lead": {"prog": 5, "vol": 85, "pan": 64, "reverb": 45, "mod_init": 15},
    "bass": {"prog": 33, "vol": 80, "reverb": 20},   # bass returns — but uneasy
    "pad":  {"prog": 94, "vol": 85, "pan": 64, "reverb": 80},
    "drums": {"vol": 50, "reverb": 25},      # quiet kit, glitches
    "lead_vel_ramp": (60, 90),
    "key_intervals": MINOR,
    "root": 6,                               # F# minor
    "lead_mod_ramp": (15, 40),
    # Pad chords: same family but with sharp 11ths (the "off" colour).
    # F#m7#11 → Bm7#11 → D7#11 → G7b9 → Cmaj7 (resolve to tonic brightness
    # with a dim7 b9 colouring — the "surveillance glitch" harmonic).
    "pad_chords": [
        (0,  [N(6,3), N(9,3), N(1,4), N(3,4), N(10,3)]),  # F#m7#11 (added #11)
        (4,  [N(1,3), N(4,3), N(8,3), N(10,3), N(2,4)]),  # Bm7#11
        (8,  [N(2,3), N(6,3), N(9,3), N(0,4), N(3,4)]),   # D7#11
        (12, [N(7,3), N(10,3), N(2,4), N(5,4), N(8,4)]),  # G7b9
        (16, [N(0,3), N(4,3), N(7,3), N(11,3), N(2,4)]),  # Cmaj7 (weird rest)
    ],
    # Pad expression climbs through the paranoia — peaks at the G7b9
    "pad_vel_ramp": (70, 105, 20),
    # Pad breakdown on bars 18-20 — sweeps it down so D's silence lands clean
    "pad_breakdowns": [(18, 20)],
    "lead_pattern": [],
    "bass_pattern": [],
    "drum_pattern": [],
    "cross_boundary_crash": False,
}
def _build_corp_office_c_patterns():
    """corp_office_c: surveillance glitch. Bass pedal with chromatic b2
    approach, kit drops hits on 'wrong' beats, EP arpeggio with one
    passing-tone dissonance per bar."""
    import random
    random.seed(7)
    bar = PPQ * BEATS_PER_BAR
    eighth = PPQ // 2
    cfg = SCENES_B["corp_office_c"]
    bass_ev: list = []
    lead_ev: list = []
    drum_ev: list = []

    chord_data = [
        # (root_idx, [9th, 11th, 5th, root])
        (6, [11, 2, 4, 6]),
        (1, [11, 4, 1, 8]),
        (2, [11, 4, 9, 2]),   # D7
        (7, [10, 5, 2, 7]),   # G7b9 (the b9 color)
        (0, [4, 7, 0, 11]),   # Cmaj7 (the strange landing)
    ]

    # ----- BASS ------------------------------------------------------------
    # bass pedal on root with chromatic b2 approach on beat 4 of every
    # other bar (the "wrong note")
    for b in range(cfg["bars"]):
        root_idx = chord_data[b // 4 % 5][0]
        root = N(root_idx, 1)
        # b2 approach = chromatic half-step below the NEXT chord's root
        next_root_idx = chord_data[(b // 4 + 1) % 5][0]
        approach = N(next_root_idx, 1) - 1 if next_root_idx > root_idx else N(next_root_idx, 1) + 1
        t = b * bar
        # 8th-note pulses on root
        for beat in range(4):
            tt = t + beat * PPQ
            if beat == 3 and (b % 2 == 1):
                # Half-time chromatic approach on beat 4 of odd bars
                bass_ev.append((tt, [(root, eighth, 0), (approach, eighth, 0)]))
            else:
                bass_ev.append((tt, [(root, eighth, 0), (root, eighth, 0)]))
    cfg["bass_pattern"] = bass_ev

    # ----- LEAD ------------------------------------------------------------
    # Same arpeggio shape as B but with one passing-tone dissonance per bar
    # (a non-chord tone on beat 3+ that resolves downward)
    for b in range(cfg["bars"]):
        t = b * bar
        root_idx, intervals = chord_data[b // 4 % 5]
        notes = [N(root_idx, 4)] + [N(root_idx + i, 4) for i in intervals]
        seq = notes + notes[::-1]
        for i, n in enumerate(seq):
            lead_ev.append((t + i * eighth, [(n, eighth, -8)]))
        # Passing dissonance: a b6 above root, lands on bar 4 of every 4 bars
        if b % 4 == 3:
            lead_ev.append((b * bar + 3 * PPQ + eighth, [(N(root_idx + 8, 4), eighth, -3)]))
    cfg["lead_pattern"] = lead_ev

    # ----- DRUMS -----------------------------------------------------------
    # Minimal kit with GLITCHES — kick missing on bar 16, brush snare on
    # offbeats (beats 2+ of every bar, low velocity), NO hi-hats.
    for b in range(cfg["bars"]):
        t = b * bar
        # Kick on bar 0 + every 4th bar (the "heartbeat" that drops out)
        if b % 4 == 0:
            drum_ev.append((t, KICK, 55))
        # Brush snare on beats 2+4 (low velocity, the "static")
        for beat in (1, 3):
            drum_ev.append((t + beat * PPQ, SNARE, 38))
        # Glitch ghost hits — random brush on 16th-note offbeats
        for e in range(2):
            if random.random() < 0.4:
                drum_ev.append((t + e * eighth + PPQ // 2, SNARE, 25))
        # KICK MISSING on bar 16 — the silence = glitch event
    cfg["drum_pattern"] = drum_ev
_build_corp_office_c_patterns()

# ---------- 6b. corp_office_d — cliff-hanger, the silence ----------------
# A is build, B is intimacy, C is paranoia, D is the moment the lights go
# out. 8 bars total: a single sharp dim7 stab (F# dim7 → B dim7), 1 bar
# COMPLETE SILENCE (no bass, no lead, no pad, no kit), then a single EP
# note rings out alone for 6 bars — the alert tone that nobody answers.
# This is the SCARE equivalent for corp_office: not a held chord, but the
# AUDIENCE FORCED INTO SILENCE, then left with one held note and dread.
SCENES_B["corp_office_d"] = {
    "name": "corp_office_d",
    "bars": 8,                               # 8 bars total but mostly sparse
    "bpm": 92,
    "lead": {"prog": 5, "vol": 75, "pan": 64, "reverb": 90, "mod_init": 0},  # EP alone
    "bass": {"prog": 33, "vol": 70, "reverb": 30},   # brief bass only at start
    "pad":  {"prog": 94, "vol": 85, "pan": 64, "reverb": 85},   # pad stabs at start only
    "drums": {"vol": 0, "reverb": 0},         # NO kit — silence is the kit
    "lead_vel_ramp": (70, 95),
    "key_intervals": MINOR,
    "root": 6,                               # F# minor
    "lead_mod_ramp": (5, 25),                # gentle vibrato on the held note
    # Pad chords: TWO dim7 stabs (F# dim7 → B dim7), then NOTHING.
    # The bar-2 pad silence is the cliffhanger — listener hears ONLY the
    # bass drone and the EP note.
    "pad_chords": [
        (0, [N(6,3), N(9,3), N(0,4), N(3,4)]),   # F# dim7: F#-A-C-Eb (bars 0-1)
        (2, [N(1,3), N(4,3), N(7,3), N(10,3)]),  # B dim7: B-D-F-Ab (bar 2)
        # bars 3-7: NO pad — silence
    ],
    "pad_breakdowns": [],                    # pad is intentionally cut at bar 3
    "pad_vel_ramp": (90, 90, 2),             # flat at 90 then SILENCE
    "lead_pattern": [],
    "bass_pattern": [],
    "drum_pattern": [],
    "cross_boundary_crash": False,
}
def _build_corp_office_d_patterns():
    """corp_office_d: cliff-hanger. Dim7 stabs cut to silence, then one
    EP note rings out alone. Bass is a single drone that gets cut by the
    silence. The held note rises slightly in pitch (mod 0→25) so it feels
    like it's straining to be heard."""
    bar = PPQ * BEATS_PER_BAR
    eighth = PPQ // 2
    cfg = SCENES_B["corp_office_d"]
    bass_ev: list = []
    lead_ev: list = []

    # ----- BASS ------------------------------------------------------------
    # Brief F#1 drone on bars 0-1, dies at bar 2, silence thereafter
    bass_ev.append((0, [(N(6,1), PPQ * 4, 0), (N(6,0), PPQ * 4, 0)]))  # F#1 + F#0 (octave)
    bass_ev.append((PPQ * 8, [(N(6,0), PPQ * 4, 0)]))                   # bar 2: dim7 bass
    # bars 3-7: SILENCE
    cfg["bass_pattern"] = bass_ev

    # ----- LEAD ------------------------------------------------------------
    # bars 0-2: EP joins the dim7 stabs (one stab per bar)
    # bar 0: F# dim7 chord tones on beat 1
    lead_ev.append((0, [(N(6,5), eighth, 0), (N(9,5), eighth, 0),
                        (N(0,5), eighth, 0), (N(3,5), eighth, 0)]))
    # bar 1: B dim7 chord tones on beat 1
    lead_ev.append((PPQ * 4, [(N(1,5), eighth, 0), (N(4,5), eighth, 0),
                              (N(7,5), eighth, 0), (N(10,5), eighth, 0)]))
    # bar 2: dim7 pad stab, no lead (bass + pad only)
    # bars 3-7: SINGLE held note — C#6 (the b3 of F# minor, the unbinding
    # note). Held for 5 bars with rising CC1 modulation. The note trembles
    # but doesn't resolve — the listener is left holding their breath.
    lead_ev.append((PPQ * 12, [(N(4,6), PPQ * 20, -5)]))   # C#6 held bars 3-7 (20 QUARTER notes)
    cfg["lead_pattern"] = lead_ev

    # Drums deliberately empty (silence is the kit)
_build_corp_office_d_patterns()

# ---------- 6c. corp_office_e — recovery, loop seam ----------------------
# Like chase_e: gradual recovery, then loop seam into A. Starts with the
# C#6 held note that D ended on, held for 2 more bars as anchor, then
# the kit comes back bar-by-bar (heartbeat kick → snare → brushes), bass
# returns as 8ths at half volume, pad climbs. Last 4 bars (16-19) = A's
# exact opening (stabs only, no bass, no drums) so the chase scene's
# corp_office loop returns to A cleanly. 20 bars total, slight tempo
# lift 92→96 to give a sense of "end of shift, locking up."
SCENES_B["corp_office_e"] = {
    "name": "corp_office_e",
    "bars": 20,
    "bpm": 92,
    "lead": {"prog": 5, "vol": 75, "pan": 64, "reverb": 50, "mod_init": 0},
    "bass": {"prog": 33, "vol": 80, "reverb": 15},
    "pad":  {"prog": 94, "vol": 75, "pan": 64, "reverb": 80},
    "drums": {"vol": 65, "reverb": 20},
    "lead_vel_ramp": (60, 90),
    "key_intervals": MINOR,
    "root": 6,                               # F# minor
    "tempo_changes": [(16, 96)],             # end of shift lift
    "lead_mod_ramp": (0, 20),
    # Pad chords: F#m family, SAME chord cycle as A — looping seam prep
    "pad_chords": [
        (0,  [N(6,3), N(9,3), N(1,4), N(4,4)]),       # F#m
        (4,  [N(1,3), N(4,3), N(8,3), N(11,3)]),      # Bm
        (8,  [N(4,3), N(8,3), N(11,3), N(3,4)]),      # C#m
        (12, [N(6,3), N(9,3), N(1,4), N(4,4)]),       # F#m (back to A's home)
        (16, [N(6,3), N(9,3), N(1,4), N(4,4)]),       # F#m (held for loop seam)
    ],
    # Pad ducks at bar 19 only — gives A's pad entry a clean start
    "pad_breakdowns": [(19, 20)],
    "pad_vel_ramp": (50, 100, 20),
    "lead_pattern": [],
    "bass_pattern": [],
    "drum_pattern": [],
    "cross_boundary_crash": True,            # crash on bar 19 = A's crash opening
    "crash_velocity": 100,
}
def _build_corp_office_e_patterns():
    """corp_office_e: gradual recovery to A's opening shape. bars 0-3
    hold C#6 (the D-end note); bars 4-7 add pad swell; bars 8-11 add
    bass; bars 12-15 add brush snare; bars 16-19 = A's opening (stabs
    only with kick+snare). Loop seam back to A is invisible."""
    import random
    random.seed(13)
    bar = PPQ * BEATS_PER_BAR
    eighth = PPQ // 2
    cfg = SCENES_B["corp_office_e"]
    lead_ev: list = []
    bass_ev: list = []
    drum_ev: list = []

    chord_roots = [6, 1, 4, 6, 6]    # same as A

    # ----- LEAD ------------------------------------------------------------
    # bars 0-3: hold C#6 (anchor from D)
    lead_ev.append((0, [(N(4,6), PPQ * 16, -5)]))          # C#6 held bars 0-3
    # bars 4-7: EP arpeggio returns (quieter version of B's arpeggio)
    for b in range(4, 8):
        t = b * bar
        root_idx = chord_roots[(b - 4) % 5]
        arp = [N(root_idx, 4), N(root_idx + 4, 4),
               N(root_idx + 7, 4), N(root_idx + 4, 4)]
        for i in range(8):
            lead_ev.append((t + i * eighth, [(arp[i % 4], eighth, -5)]))
    # bars 8-11: same arpeggio + chord stabs
    for b in range(8, 12):
        t = b * bar
        root_idx = chord_roots[(b - 8) % 4]
        arp = [N(root_idx, 5), N(root_idx + 3, 5), N(root_idx + 7, 5), N(root_idx + 10, 5)]
        for i, n in enumerate(arp):
            lead_ev.append((t + i * eighth, [(n, eighth, 0)]))
        # stabs on 3+
        chord_notes = [N(root_idx, 4), N(root_idx + 3, 4), N(root_idx + 7, 4)]
        lead_ev.append((t + 2 * PPQ, [(n, eighth, 0) for n in chord_notes]))
    # bars 12-15: arpeggio + stabs (matches A's bars 8-11)
    for b in range(12, 16):
        t = b * bar
        root_idx = chord_roots[(b - 12) % 4]
        arp = [N(root_idx, 5), N(root_idx + 3, 5), N(root_idx + 7, 5), N(root_idx + 10, 5)]
        for i, n in enumerate(arp):
            lead_ev.append((t + i * eighth, [(n, eighth, 0)]))
        chord_notes = [N(root_idx, 4), N(root_idx + 3, 4), N(root_idx + 7, 4)]
        lead_ev.append((t + 2 * PPQ, [(n, eighth, 0) for n in chord_notes]))
    # bars 16-19: A's exact opening — STABS ONLY on beats 1+3, no arpeggio
    for b in range(16, 20):
        t = b * bar
        root_idx = chord_roots[(b - 16) % 4]
        chord_notes = [N(root_idx, 4), N(root_idx + 3, 4), N(root_idx + 7, 4)]
        lead_ev.append((t, [(n, PPQ // 2, -5) for n in chord_notes]))
        lead_ev.append((t + 2 * PPQ, [(n, PPQ // 2, -5) for n in chord_notes]))
    cfg["lead_pattern"] = lead_ev

    # ----- BASS ------------------------------------------------------------
    # bars 0-3: silence (anchor holds alone)
    # bars 4-7: bass enters on half-time (heartbeat — beat 1 only)
    # bars 8-11: 8ths on root
    # bars 12-15: 8ths + 5th (matches A's bars 12-15)
    # bars 16-19: SILENT (matches A's bars 0-3 — stabs only)
    for b in range(4, 8):
        root_idx = chord_roots[(b - 4) % 5]
        root = N(root_idx, 1)
        bass_ev.append((b * bar, [(root, PPQ, 0), (root, PPQ * 3, 0)]))
    for b in range(8, 12):
        root_idx = chord_roots[(b - 8) % 4]
        root = N(root_idx, 1)
        for beat in range(4):
            t = b * bar + beat * PPQ
            bass_ev.append((t, [(root, eighth, 0), (root, eighth, 0)]))
    for b in range(12, 16):
        root_idx = chord_roots[(b - 12) % 4]
        root = N(root_idx, 1)
        fifth = root + 7
        for beat in range(4):
            t = b * bar + beat * PPQ
            bass_ev.append((t, [(root, eighth, 0), (fifth, eighth, 0)]))
    cfg["bass_pattern"] = bass_ev

    # ----- DRUMS -----------------------------------------------------------
    # bars 0-7: silent
    # bars 8-11: kick on 1 only
    # bars 12-15: kick + snare on 3
    # bars 16-19: A's exact opening — kick 1+3, snare 2+4, NO hats
    for b in range(8, 12):
        drum_ev.append((b * bar, KICK, 60))
    for b in range(12, 16):
        drum_ev.append((b * bar, KICK, 65))
        drum_ev.append((b * bar + 2 * PPQ, SNARE, 50))
    for b in range(16, 20):
        for beat in range(4):
            t = b * bar + beat * PPQ
            if beat in (0, 2):
                drum_ev.append((t, KICK, 70 if beat == 0 else 60))
            if beat in (1, 3):
                drum_ev.append((t, SNARE, 55))
    cfg["drum_pattern"] = drum_ev
_build_corp_office_e_patterns()

# ---------- 7. terminal_lab_b — Fantasia becomes aggressive, glitch erupt -
SCENES_B["terminal_lab_b"] = {
    "name": "terminal_lab_b",
    "bars": 24,
    "bpm": 76,
    "lead": {"prog": 88, "vol": 80, "pan": 64, "reverb": 60, "mod_init": 10},
    "bass": {"prog": 39, "vol": 75, "reverb": 35},
    "pad":  {"prog": 101, "vol": 90, "pan": 64, "reverb": 90},
    "drums": {"vol": 60, "reverb": 40},
    "key_intervals": MINOR,
    "root": 11,                              # B minor (same)
    "lead_mod_ramp": (10, 70),               # max instability
    # B-side chords: Bm → G → Em → Bm (descending cycle)
    "pad_chords": [
        (0,  [N(11,3), N(2,4), N(6,4), N(9,4)]),
        (6,  [N(6,3), N(9,3), N(1,4), N(4,4)]),
        (12, [N(4,3), N(7,3), N(11,3), N(2,4)]),
        (18, [N(11,3), N(2,4), N(6,4), N(9,4)]),
    ],
    # Cascade state in B is sustained — no tempo lift here (already lifted
    # in A; B is "the system is now accelerating"). Lead ramps hard.
    "lead_vel_ramp": (85, 115),
    # Pad pushes presence for sustained cascade.
    "pad_vel_ramp": (80, 105, 24),
    # NO drum_shapes — kit stays at full volume throughout (cascade).
    "lead_pattern": [],
    "bass_pattern": [],
    "drum_pattern": [],
    "cross_boundary_crash": True,
    "crash_velocity": 85,
}
def _build_terminal_lab_b_patterns():
    import random
    random.seed(101)
    bar = PPQ * BEATS_PER_BAR
    cfg = SCENES_B["terminal_lab_b"]
    # B-side bass: pulsing 8ths instead of long drones — more chaotic
    bass_ev = []
    chord_roots = [11, 6, 4, 11]
    for b in range(cfg["bars"]):
        root = N(chord_roots[(b // 6) % 4], 1)
        for beat in range(4):
            t = b * bar + beat * PPQ
            bass_ev.append((t, [(root, PPQ // 2, 0), (root + 7, PPQ // 2, 0)]))
    cfg["bass_pattern"] = bass_ev
    # B-side lead: aggressive Fantasia run — descending chromatic-ish
    lead_ev = []
    for b in range(0, cfg["bars"], 2):
        t = b * bar
        run = [N(11,5), N(9,5), N(7,5), N(6,5), N(4,5), N(2,5), N(11,4), N(9,4)]
        for i, n in enumerate(run):
            lead_ev.append((t + i * (PPQ // 2), [(n, PPQ // 2, 0)]))
    cfg["lead_pattern"] = lead_ev
    # B-side drums: glitch with MORE density than A
    drum_ev = []
    for b in range(cfg["bars"]):
        for beat in range(4):
            t = b * bar + beat * PPQ
            if random.random() < 0.8:
                drum_ev.append((t, KICK, 55 + random.randint(-10, 10)))
            if random.random() < 0.7:
                drum_ev.append((t, HHAT, 45 + random.randint(-5, 10)))
            if beat in (1, 3) and random.random() < 0.7:
                drum_ev.append((t + PPQ // 2, TOM_HI, 50))
    cfg["drum_pattern"] = drum_ev
_build_terminal_lab_b_patterns()

# ---------- 8. ship_engine_b — engine revs higher, melody climbs --------
SCENES_B["ship_engine_b"] = {
    "name": "ship_engine_b",
    "bars": 24,
    "bpm": 80,
    "lead": {"prog": 91, "vol": 75, "pan": 64, "reverb": 50, "mod_init": 20},  # synth voice
    "bass": {"prog": 39, "vol": 100, "reverb": 25},
    "pad":  {"prog": 100, "vol": 90, "pan": 64, "reverb": 95},
    "drums": {"vol": 85, "reverb": 40},
    "key_intervals": MINOR,
    "root": 2,                               # D minor (same)
    "lead_mod_ramp": (20, 80),               # max breath
    # B-side chords: Dm → F → Bb → Dm (i, bIII, bVI, i — epilogue cycle)
    "pad_chords": [
        (0,  [N(2,3), N(5,3), N(9,3), N(0,4)]),       # Dm
        (8,  [N(5,3), N(8,3), N(0,4), N(3,4)]),       # F
        (16, [N(10,3), N(1,4), N(5,4), N(8,4)]),      # Bb
    ],
    # B is "engine revved and sustaining" — full power throughout. Drum
    # kit drops slightly in last 4 bars so the loop wrap is a soft landing
    # (matches A's quiet start for loop seam).
    "drum_shapes": [
        {"bars": (20, 24), "_volume": 60},
    ],
    # Lead vel at full power throughout.
    "lead_vel_ramp": (90, 110),
    # Pad sustained presence.
    "pad_vel_ramp": (90, 100, 24),
    "lead_pattern": [],
    "bass_pattern": [],
    "drum_pattern": [],
    "cross_boundary_crash": True,
    "crash_velocity": 95,
}
def _build_ship_engine_b_patterns():
    bar = PPQ * BEATS_PER_BAR
    eighth = PPQ // 2
    cfg = SCENES_B["ship_engine_b"]
    # B-side bass: higher octave pulse (engine "revs" up)
    bass_ev = []
    for b in range(cfg["bars"]):
        root = N(2, 2)  # D3 instead of D2
        root_hi = N(2, 3)  # D4
        for beat in range(4):
            t = b * bar + beat * PPQ
            bass_ev.append((t, [(root, eighth, 0), (root_hi, eighth, 0)]))
    cfg["bass_pattern"] = bass_ev
    # B-side lead: ascending long notes (vs A's static repeated notes)
    ascending = [N(2,4), N(5,4), N(7,4), N(9,4), N(0,5), N(2,5), N(5,5), N(7,5),
                  N(9,5), N(7,5), N(5,5), N(2,5)]
    lead_ev = []
    for i, n in enumerate(ascending):
        t = i * 2 * bar
        lead_ev.append((t, [(n, PPQ * 8, 0)]))
    cfg["lead_pattern"] = lead_ev
    # B-side drums: more aggressive industrial — adds snare rolls
    drum_ev = []
    for b in range(cfg["bars"]):
        for beat in range(4):
            t = b * bar + beat * PPQ
            drum_ev.append((t, KICK, 90 if beat == 0 else 80))
            if beat in (1, 3):
                drum_ev.append((t, SNARE, 85))
            drum_ev.append((t + PPQ // 2, HHAT, 55))
        if b % 4 == 1:
            # snare roll leading into bar 2
            for i in range(8):
                drum_ev.append((b * bar + i * eighth, SNARE, 70 + i * 4))
        if b % 4 == 2:
            drum_ev.append((b * bar + 3 * PPQ, TOM_LO, 75))
    cfg["drum_pattern"] = drum_ev
_build_ship_engine_b_patterns()


# ---------- 8c. ship_engine_c — engine strain, peak intensity ---------
# 24 bars @ 80 BPM. The engine reaches max strain. Lead climbs into
# high register. Kit adds ride bell and tom fills. Bass drops to sub-
# octave. Pad has dim7 colors for the dissonance.
SCENES_B["ship_engine_c"] = {
    "name": "ship_engine_c",
    "bars": 24,
    "bpm": 80,
    "lead": {"prog": 82, "vol": 100, "pan": 64, "reverb": 70, "mod_init": 30},
    "bass": {"prog": 39, "vol": 100, "reverb": 30},
    "pad":  {"prog": 100, "vol": 75, "pan": 64, "reverb": 90},
    "drums": {"vol": 85, "reverb": 30},
    "lead_mod_ramp": (30, 80),
    "lead_vel_ramp": (90, 115),
    "key_intervals": MINOR,
    "root": 2,                                 # D minor
    "pad_chords": [
        (0,  [N(2,3), N(5,3), N(9,3), N(0,4)]),       # Dm
        (8,  [N(5,3), N(8,3), N(0,4), N(3,4)]),       # Fm (relative)
        (16, [N(11,2), N(2,3), N(5,3), N(9,3)]),      # Cm (descending fifth)
    ],
    "pad_vel_ramp": (75, 95, 24),
    "pad_breakdowns": [],
    "lead_pattern": [],
    "bass_pattern": [],
    "drum_pattern": [],
}

def _build_ship_engine_c_patterns():
    """Engine strain: dense kit, lead climbs, sub-octave bass."""
    cfg = SCENES_B["ship_engine_c"]
    bar = PPQ * BEATS_PER_BAR
    EIGHTH = PPQ // 2
    bass_ev = []
    lead_ev = []
    drum_ev = []
    # Bass: D1 sub-octave pulse with 5th motion
    bass_ev.append((0, [
        (N(2,1), EIGHTH, 0), (N(2,2), EIGHTH, 0),
        (N(2,1), EIGHTH, 0), (N(9,1), EIGHTH, 0),
        (N(2,1), EIGHTH, 0), (N(2,2), EIGHTH, 0),
        (N(2,1), EIGHTH, 0), (N(9,1), EIGHTH, 0),
    ] * 8))
    bass_ev.append((PPQ*32, [
        (N(2,1), EIGHTH, 0), (N(2,2), EIGHTH, 0),
        (N(2,1), EIGHTH, 0), (N(9,1), EIGHTH, 0),
        (N(2,1), EIGHTH, 0), (N(2,2), EIGHTH, 0),
        (N(2,1), EIGHTH, 0), (N(0,2), EIGHTH, 0),
    ] * 8))
    bass_ev.append((PPQ*64, [
        (N(2,1), EIGHTH, 0), (N(2,2), EIGHTH, 0),
        (N(2,1), EIGHTH, 0), (N(9,1), EIGHTH, 0),
        (N(2,1), EIGHTH, 0), (N(2,2), EIGHTH, 0),
        (N(2,1), EIGHTH, 0), (N(5,2), EIGHTH, 0),
    ] * 8))
    cfg["bass_pattern"] = bass_ev
    # Lead: Dm arpeggio climbs to high register
    lead_ev.append((0, [
        (N(2,4), EIGHTH, -5), (N(5,4), EIGHTH, 0),
        (N(9,4), EIGHTH, 3), (N(0,5), EIGHTH, 5),
        (N(2,5), EIGHTH, 8), (N(0,5), EIGHTH, 5),
        (N(9,4), EIGHTH, 3), (N(0,5), EIGHTH, 5),
    ] * 2))
    # bars 8-15: Fm arpeggio higher
    lead_ev.append((PPQ*32, [
        (N(5,5), EIGHTH, 5), (N(8,5), EIGHTH, 8),
        (N(0,6), EIGHTH, 10), (N(3,6), EIGHTH, 12),
        (N(5,6), EIGHTH, 15), (N(3,6), EIGHTH, 12),
        (N(0,6), EIGHTH, 10), (N(8,5), EIGHTH, 8),
    ] * 2))
    lead_ev.append((PPQ*48, [
        (N(5,5), EIGHTH, 8), (N(8,5), EIGHTH, 10),
        (N(0,6), EIGHTH, 12), (N(3,6), EIGHTH, 15),
        (N(5,6), EIGHTH, 18), (N(3,6), EIGHTH, 15),
        (N(0,6), EIGHTH, 12), (N(8,5), EIGHTH, 10),
    ] * 2))
    # bars 16-23: Cm descent back
    lead_ev.append((PPQ*64, [
        (N(11,5), EIGHTH, 12), (N(2,6), EIGHTH, 15),
        (N(5,6), EIGHTH, 18), (N(2,6), EIGHTH, 15),
        (N(11,5), EIGHTH, 12), (N(2,6), EIGHTH, 15),
        (N(5,6), EIGHTH, 18), (N(2,6), EIGHTH, 15),
    ] * 2))
    lead_ev.append((PPQ*80, [
        (N(11,5), EIGHTH, 10), (N(2,6), EIGHTH, 12),
        (N(5,6), PPQ*2, 15),
    ]))
    cfg["lead_pattern"] = lead_ev
    # Drums: 4-on-floor + ride bell + tom fills.
    # 2026-07-14 bug: previous version used vdelta=0 which produced
    # velocity 0 (silent note_on) for KICK/SNARE/TOM/RIDE — only HAT
    # played because its vdelta=-10 against base 128 = 118. Now using
    # direct absolute velocities like chase does.
    KICK = 36; SNARE = 38; TOM_HI = 50; TOM_MID = 47; TOM_LO = 45; HAT = 42; RIDE = 51
    for b in range(24):
        t = b * bar
        for beat in range(4):
            drum_ev.append((t + beat * PPQ, KICK, 100))    # 4-on-floor
        drum_ev.append((t + PPQ, SNARE, 90))                # backbeat 2
        drum_ev.append((t + PPQ*3, SNARE, 90))               # backbeat 4
        for e in range(8):
            drum_ev.append((t + e * EIGHTH, HAT, 70))        # eighth-note hats
        # Ride bell every 2 bars (denser texture)
        if b % 2 == 1:
            drum_ev.append((t + PPQ*2, RIDE, 75))
        # Tom fill every 4 bars — descending fill into bar 0 next
        if b % 4 == 3:
            drum_ev.append((t + PPQ*2, TOM_HI, 80))
            drum_ev.append((t + PPQ*2 + EIGHTH, TOM_MID, 75))
            drum_ev.append((t + PPQ*3, TOM_LO, 80))
    cfg["drum_pattern"] = list(drum_ev)
_build_ship_engine_c_patterns()

# ---------- 8d. ship_engine_d — engine stall with decay details ---------
# 16 bars @ 80 BPM. The engine dies — but the death isn't a single
# held note ringing out for 48 seconds. Real engine stalls have:
#   - cough/sputter glitches at irregular intervals
#   - bass resonance that drops in pitch as the engine loses RPM
#   - pad tone fading in for tension then back out
#   - ONE sustained high note, but with a slow chromatic descent
#     underneath suggesting the engine winding down
# Replaces the 2026-07-14 design (10 notes / 48s, monotony score 8
# but RMS-flat -19.5dB for 30 seconds — user feedback: "repetitive
# chords just play through a whole part with no variation").
SCENES_B["ship_engine_d"] = {
    "name": "ship_engine_d",
    "bars": 16,
    "bpm": 80,
    "lead": {"prog": 82, "vol": 85, "pan": 64, "reverb": 85, "mod_init": 0},
    "bass": {"prog": 39, "vol": 75, "reverb": 50},
    "pad":  {"prog": 100, "vol": 38, "pan": 64, "reverb": 100},
    "drums": {"vol": 0, "reverb": 0},            # no kit — engine died
    "lead_mod_ramp": (0, 110),                  # HEAVY vibrato on lead
    "lead_vel_ramp": (95, 100),
    "key_intervals": MINOR,
    "root": 2,                                 # D minor
    # Pad: swell at bar 0 (the dim7 stab), small swell at bar 4 (tension),
    # breath at bar 8 (release), final swell at bar 12 (the engine tries
    # to restart and fails). NEVER full silence — always some texture.
    "pad_chords": [
        (0,  [N(1,3), N(4,3), N(7,3), N(10,3)]),     # C# dim7 (bar 0 stab)
        (4,  [N(2,3), N(5,3), N(8,3), N(0,4)]),      # Dm (tension, bar 4)
        (8,  [N(0,3), N(3,3), N(7,3), N(10,3)]),     # C dim7 (release, bar 8)
        (12, [N(2,3), N(5,3), N(9,3), N(0,4)]),      # Dm (final attempt, bar 12)
    ],
    "pad_breakdowns": [],                            # no full silence
    "pad_vel_ramp": (45, 35, 25),
    "lead_pattern": [],
    "bass_pattern": [],
    "drum_pattern": [],
}

def _build_ship_engine_d_patterns():
    """Engine stall with decay: dim7 stab, descending bass drone,
    sustained high note with vibrato, sputter glitches at irregular
    bars (3, 6, 10, 14), pad swells at bars 0/4/8/12. Still sparse
    (the engine IS dead) but every bar has SOMETHING happening."""
    cfg = SCENES_B["ship_engine_d"]
    bar = PPQ * BEATS_PER_BAR
    bass_ev = []
    lead_ev = []
    # Bar 0: C# dim7 stab (F#-A-C-Eb)
    lead_ev.append((0, [
        (N(1,4), PPQ, 0), (N(4,4), PPQ, 0),
        (N(7,4), PPQ, 0), (N(10,4), PPQ, 0),
    ]))
    # Bar 1 onwards: SUSTAINED D5 (high, the engine whine) with vibrato.
    # But ALSO an irregular descent: drops by a half-step every 4 bars
    # so by bar 12 the held note is D5 -> C#5 -> C5 -> B4, suggesting
    # the engine losing pitch as it loses RPM.
    # Each held note is its own phrase at the same start tick — see
    # the schedule_note_sequence cursor+=dur note in kabukicho_d fix.
    for i, drop in enumerate([0, -1, -2, -3]):  # D5, C#5, C5, B4
        start = bar * (1 + i * 4)  # bars 1, 5, 9, 13
        if start >= cfg["bars"] * bar:
            break
        note = N(2,5) + drop   # D5 = N(2,5), drop by semitones
        # 4 bars each
        lead_ev.append((start, [(note, bar * 4, 0)]))
    # Sputter glitches: short staccato bursts at irregular bars
    # (3, 6, 10, 14) — random pitches from the dim7 stack. Keeps
    # the texture from being pure drone.
    for bar_idx in (3, 6, 10, 14):
        start = bar * bar_idx
        # Quick chord cluster, 1 beat long
        lead_ev.append((start, [
            (N(1,4), PPQ, 0),
            (N(4,4), PPQ, 0),
        ]))
    cfg["lead_pattern"] = lead_ev
    # Bass: descending D2 -> C#2 -> C2 -> B1 over 16 bars, with rests
    # between descending notes to keep it from being a constant drone.
    # Each note held 2 bars, 2 bars rest = 4-bar cell.
    bass_pitches = [(2,1), (1,1), (0,1), (-1,1)]  # D2, C#2, C2, B1
    for cell, (semi, octv) in enumerate(bass_pitches):
        start = bar * cell * 4
        # First 2 bars: held note
        bass_ev.append((start, [(N(semi, octv), bar * 2, 0)]))
        # Next 2 bars: silence (rest)
        bass_ev.append((start + bar * 2, [(None, bar * 2, 0)]))
    cfg["bass_pattern"] = bass_ev
_build_ship_engine_d_patterns()

# ---------- 8e. ship_engine_e — restart recovery, loop seam ----------
# 24 bars @ 80 BPM. Held D2 continues from D for bars 0-1, then bass
# pulse re-enters at bar 2 with A's opening shape. Lead climbs back.
# Last 4 bars mirror A's opening for seamless loop.
SCENES_B["ship_engine_e"] = {
    "name": "ship_engine_e",
    "bars": 24,
    "bpm": 80,
    "lead": {"prog": 82, "vol": 90, "pan": 64, "reverb": 70, "mod_init": 30},
    "bass": {"prog": 39, "vol": 95, "reverb": 25},
    "pad":  {"prog": 100, "vol": 80, "pan": 64, "reverb": 90},
    "drums": {"vol": 75, "reverb": 30},
    "lead_mod_ramp": (110, 30),                  # vibrato decays as engine recovers
    "lead_vel_ramp": (85, 100),
    "key_intervals": MINOR,
    "root": 2,                                 # D minor
    "pad_chords": [
        (0,  [N(2,3), N(5,3), N(9,3), N(0,4)]),       # Dm (return to A's chord)
        (12, [N(2,3), N(5,3), N(9,3), N(0,4)]),       # Dm
        (20, [N(2,3), N(5,3), N(9,3), N(0,4)]),       # Dm (seam)
    ],
    "pad_vel_ramp": (50, 90, 24),
    "pad_breakdowns": [],
    "lead_pattern": [],
    "bass_pattern": [],
    "drum_pattern": [],
}

def _build_ship_engine_e_patterns():
    """Restart: held D2 fades, bass pulse returns, kit rebuilds."""
    cfg = SCENES_B["ship_engine_e"]
    bar = PPQ * BEATS_PER_BAR
    EIGHTH = PPQ // 2
    bass_ev = []
    lead_ev = []
    drum_ev = []
    # Bass: held D2 fades, then pulse returns at bar 2
    bass_ev.append((0, [(N(2,2), PPQ*8, -10)]))          # bars 0-1: D2 fading
    bass_ev.append((PPQ*8, [(N(2,2), PPQ*8, -5)]))        # bars 2-3: continues fading
    # bars 4-7: D1 pulse
    bass_ev.append((PPQ*16, [
        (N(2,1), EIGHTH, -5), (N(2,2), EIGHTH, -3),
        (N(2,1), EIGHTH, -5), (N(9,1), EIGHTH, -3),
        (N(2,1), EIGHTH, -5), (N(2,2), EIGHTH, -3),
        (N(2,1), EIGHTH, -5), (N(9,1), EIGHTH, -3),
    ]))
    bass_ev.append((PPQ*24, [
        (N(2,1), EIGHTH, 0), (N(2,2), EIGHTH, 0),
        (N(2,1), EIGHTH, 0), (N(9,1), EIGHTH, 0),
        (N(2,1), EIGHTH, 0), (N(2,2), EIGHTH, 0),
        (N(2,1), EIGHTH, 0), (N(9,1), EIGHTH, 0),
    ]))
    # bars 8-23: full pulse (seam to A)
    for b in range(8, 24):
        t = b * bar
        bass_ev.append((t, [
            (N(2,1), EIGHTH, 0), (N(2,2), EIGHTH, 0),
            (N(2,1), EIGHTH, 0), (N(9,1), EIGHTH, 0),
            (N(2,1), EIGHTH, 0), (N(2,2), EIGHTH, 0),
            (N(2,1), EIGHTH, 0), (N(9,1), EIGHTH, 0),
        ]))
    cfg["bass_pattern"] = bass_ev
    # Lead: held D2 fades, then climbs back to A's register
    lead_ev.append((0, [(N(2,2), PPQ*8, -10)]))           # bars 0-1: D2 fading
    lead_ev.append((PPQ*8, [(N(2,3), PPQ*8, -10)]))        # bars 2-3: D3 fading
    # bars 4-7: low register
    lead_ev.append((PPQ*16, [
        (N(2,4), EIGHTH, -5), (N(5,4), EIGHTH, -3),
        (N(9,4), EIGHTH, 0), (N(0,5), EIGHTH, 3),
        (N(2,4), EIGHTH, -3), (N(5,4), EIGHTH, 0),
        (N(9,4), EIGHTH, 3), (N(0,5), EIGHTH, 5),
    ]))
    # bars 8-15: climbing
    lead_ev.append((PPQ*32, [
        (N(2,4), EIGHTH, 0), (N(5,4), EIGHTH, 3),
        (N(9,4), EIGHTH, 5), (N(0,5), EIGHTH, 8),
        (N(2,5), EIGHTH, 10), (N(0,5), EIGHTH, 8),
        (N(9,4), EIGHTH, 5), (N(0,5), EIGHTH, 8),
    ]))
    lead_ev.append((PPQ*48, [
        (N(2,4), EIGHTH, 5), (N(5,4), EIGHTH, 8),
        (N(9,4), EIGHTH, 10), (N(0,5), EIGHTH, 12),
        (N(2,5), EIGHTH, 15), (N(0,5), EIGHTH, 12),
        (N(9,4), EIGHTH, 10), (N(0,5), EIGHTH, 12),
    ]))
    # bars 16-23: A's opening shape
    lead_ev.append((PPQ*64, [
        (N(2,4), EIGHTH, 0), (N(5,4), EIGHTH, 0),
        (N(9,4), EIGHTH, 3), (N(0,5), EIGHTH, 5),
        (N(2,4), EIGHTH, -3), (N(5,4), EIGHTH, 0),
        (N(9,4), EIGHTH, 3), (N(0,5), EIGHTH, 5),
    ]))
    lead_ev.append((PPQ*80, [
        (N(2,4), EIGHTH, -3), (N(5,4), EIGHTH, 0),
        (N(9,4), PPQ*2, 3),
    ]))
    cfg["lead_pattern"] = lead_ev
    # Drums: kit returns bar-by-bar
    KICK = 36; SNARE = 38; HAT = 42
    # bars 0-7: silence (engine offline)
    # bars 8-11: kick only
    for b in range(8, 12):
        t = b * bar
        drum_ev.append((t, [(KICK, QUARTER, -10)]))
    # bars 12-15: add snare
    for b in range(12, 16):
        t = b * bar
        drum_ev.append((t, [(KICK, QUARTER, -5)]))
        drum_ev.append((t + PPQ*2, [(SNARE, QUARTER, -5)]))
    # bars 16-23: full 4-on-floor (seam)
    for b in range(16, 24):
        t = b * bar
        for beat in range(4):
            drum_ev.append((t + beat * PPQ, [(KICK, EIGHTH, 0)]))
        drum_ev.append((t + PPQ, [(SNARE, EIGHTH, 0)]))
        drum_ev.append((t + PPQ*3, [(SNARE, EIGHTH, 0)]))
        for e in range(8):
            drum_ev.append((t + e * EIGHTH, [(HAT, PPQ//4, -10)]))
    cfg["drum_pattern"] = [(t, n, v) for t, notes in drum_ev for n, _, v in notes]
_build_ship_engine_e_patterns()

# ---------- 9. alley_confrontation_b — the confrontation, ACTUALLY a tune -
# A-side: 16 bars @ 90 BPM, F#dim7→C7b9→A#dim7→F7b9 walking bass, Pad 4
# Choir on ch0. The lead is a connected F#-Phrygian melody that runs
# through ALL 16 bars — no empty 4-bar gaps. Bass drone holds the floor
# while a counter-melody enters at bar 4 with a calmer Phrygian pull and
# builds to A5 across the cycle. REWRITE 2026-07-14: the previous
# version had only 3 explicit lead entries at bars 4/8/12, leaving bars
# 0-3, 5-7, 9-11, 13-15 silent because the composer used to stack all
# phrase notes at `start`. Even after fixing the composer, the explicit
# entries covered only 12 of 16 bars. Now the lead is a continuous
# 8th-note melodic line throughout the entire 16-bar loop.
SCENES_B["alley_confrontation_b"] = {
    "name": "alley_confrontation_b",
    "bars": 16,
    "bpm": 90,
    "lead": {"prog": 91, "vol": 88, "pan": 64, "reverb": 80, "mod_init": 30},
    "bass": {"prog": 35, "vol": 78, "reverb": 25},
    "pad":  {"prog": 54, "vol": 82, "pan": 64, "reverb": 90},
    "drums": {"vol": 36, "reverb": 38},
    "lead_vel_ramp": (82, 102),
    "lead_mod_ramp": (30, 56),
    "key_intervals": PHRYGIAN,
    "root": 6,
    "pad_chords": [
        (0,  [N(6,3), N(9,3), N(0,4), N(3,4)]),       # F#dim7 (bar 0-3)
        (4,  [N(0,3), N(4,3), N(10,3), N(1,4)]),      # C7b9   (bar 4-7)
        (8,  [N(10,2), N(1,3), N(6,3), N(8,3)]),      # A#dim7 (bar 8-11)
        (12, [N(5,3), N(9,3), N(2,4), N(4,4)]),       # F7b9   (bar 12-15)
    ],
    "pad_vel_ramp": (76, 92, 16),
    "bass_pattern": [], "lead_pattern": [], "drum_pattern": [],
}

def _build_alley_confrontation_b_patterns():
    """Connected Choir pad melody over the F# Phrygian dim7 cycle.

    Each of the 16 bars gets a full 4-note melodic phrase (4 quarters
    or 8 eighths), so every bar carries a recognisable tune — no
    empty 4-bar windows like the old 3-entry pattern."""
    cfg = SCENES_B["alley_confrontation_b"]
    bar = PPQ * BEATS_PER_BAR
    eighth = PPQ // 2
    lead_ev, bass_ev, drum_ev = [], [], []
    # Phrygian-friendly melody that walks the dim7 cycle.  Each row
    # is 16 notes (one bar of 8th notes).  Climbs in bars 0-7, peaks
    # in bars 8-11, descends in bars 12-15.
    melody = [
        # bars 0-3 over F#dim7 (lower register, drone-set)
        [N(6,4),N(8,4),N(9,4),N(8,4), N(6,4),N(8,4),N(9,4),N(11,4),
         N(9,4),N(6,4),N(3,5),N(1,5), N(0,5),N(3,5),N(1,5),N(0,5)],
        [N(1,5),N(0,5),N(10,4),N(8,4), N(9,4),N(11,4),N(0,5),N(3,5),
         N(1,5),N(3,5),N(5,5),N(3,5), N(1,5),N(0,5),N(10,4),N(8,4)],
        # bars 4-7 over C7b9 (climbing register, counter-melody starts)
        [N(8,4),N(9,4),N(11,4),N(0,5), N(3,5),N(1,5),N(0,5),N(10,4),
         N(8,4),N(10,4),N(0,5),N(1,5), N(3,5),N(5,5),N(3,5),N(1,5)],
        [N(0,5),N(3,5),N(5,5),N(3,5), N(1,5),N(0,5),N(10,4),N(8,4),
         N(6,4),N(8,4),N(9,4),N(8,4), N(6,4),N(8,4),N(9,4),N(11,4)],
        # bars 8-11 over A#dim7 (high register, climax build)
        [N(10,4),N(1,5),N(3,5),N(6,5), N(8,5),N(6,5),N(3,5),N(1,5),
         N(10,4),N(1,5),N(6,5),N(8,5), N(6,5),N(3,5),N(1,5),N(10,4)],
        [N(1,5),N(3,5),N(6,5),N(8,5), N(6,5),N(3,5),N(1,5),N(10,4),
         N(8,4),N(6,4),N(5,4),N(3,4), N(5,4),N(6,4),N(8,4),N(6,4)],
        # bars 12-15 over F7b9 (descend back toward F#5 anchor)
        [N(5,5),N(4,5),N(2,5),N(0,5), N(9,4),N(0,5),N(2,5),N(4,5),
         N(5,5),N(4,5),N(2,5),N(0,5), N(9,4),N(8,4),N(6,4),N(5,4)],
        [N(3,5),N(5,5),N(6,5),N(8,5), N(6,5),N(5,5),N(3,5),N(1,5),
         N(0,5),N(1,5),N(3,5),N(1,5), N(0,5),N(10,4),N(8,4),N(6,4)],
    ]
    bass_roots = [N(6,1), N(6,1), N(6,1), N(6,1),
                  N(0,2), N(0,2), N(0,2), N(0,2),
                  N(10,1), N(10,1), N(10,1), N(10,1),
                  N(5,1),  N(5,1),  N(5,1),  N(5,1)]
    bass_fifths = [N(0,2)]*4 + [N(6,2)]*4 + [N(3,2)]*4 + [N(10,2)]*4
    # Pad_vel ramp rolls over 16 bars (4 reps of 4-bar dim7 cycle)
    for b in range(16):
        lead_ev.append((b*bar, [(n, eighth, 3 if i in (0,4,8,12) else 0)
                                for i,n in enumerate(melody[b % 8])]))
        r = bass_roots[b]; f = bass_fifths[b]
        bass_line = [r, f, r+12, f, r, f, r+12, f]
        bass_ev.append((b*bar, [(n, eighth, -3 if i % 2 else 0)
                                for i,n in enumerate(bass_line)]))
        # Restrained pulse: kick on 1+3, brush-snare on 2+4
        drum_ev += [(b*bar, 36, 36), (b*bar+PPQ*2, 36, 30),
                    (b*bar+PPQ, 38, 28), (b*bar+PPQ*3, 38, 30)]
    cfg["lead_pattern"] = lead_ev
    cfg["bass_pattern"] = bass_ev
    cfg["drum_pattern"] = drum_ev
_build_alley_confrontation_b_patterns()

# -----------------------------------------------------------------------------
# MEDLEY map — which scenes have a B-side, and where to fade
#
# fadeAt = seconds into scene entry when crossfade from A→B starts.
# Omit fadeAt to default to halfway through A's loop length.
# -----------------------------------------------------------------------------
# ---------- 9c. alley_confrontation_c — gathering menace ---------------
# 16 bars @ 90 BPM. A connected F#-Phrygian choir melody runs through all
# four chord regions while the bass moves on every beat. This is the tense
# escalation of the alley family, not an arrangement of isolated stabs.
SCENES_B["alley_confrontation_c"] = {
    "name": "alley_confrontation_c",
    "bars": 16,
    "bpm": 90,
    "lead": {"prog": 91, "vol": 94, "pan": 64, "reverb": 76, "mod_init": 24},
    "bass": {"prog": 35, "vol": 82, "reverb": 25},
    "pad":  {"prog": 54, "vol": 76, "pan": 64, "reverb": 88},
    "drums": {"vol": 42, "reverb": 45},
    "lead_vel_ramp": (84, 106),
    "lead_mod_ramp": (24, 54),
    "key_intervals": PHRYGIAN,
    "root": 6,
    "pad_chords": [
        (0,  [N(6,3), N(9,3), N(0,4), N(3,4)]),
        (4,  [N(0,3), N(4,3), N(10,3), N(1,4)]),
        (8,  [N(10,2), N(1,3), N(6,3), N(8,3)]),
        (12, [N(5,3), N(9,3), N(2,4), N(4,4)]),
    ],
    "pad_vel_ramp": (72, 88, 16),
    "lead_pattern": [], "bass_pattern": [], "drum_pattern": [],
}

def _build_alley_confrontation_c_patterns():
    """Connected melodic escalation over the alley diminished cycle."""
    cfg = SCENES_B["alley_confrontation_c"]
    bar = PPQ * BEATS_PER_BAR
    eighth = PPQ // 2
    lead_ev, bass_ev, drum_ev = [], [], []
    phrases = [
        [N(6,4),N(8,4),N(9,4),N(0,5), N(11,4),N(9,4),N(8,4),N(6,4),
         N(3,5),N(1,5),N(0,5),N(8,4), N(6,4),N(8,4),N(9,4),N(11,4)],
        [N(0,5),N(1,5),N(4,5),N(3,5), N(1,5),N(0,5),N(10,4),N(8,4),
         N(6,4),N(8,4),N(10,4),N(1,5), N(0,5),N(10,4),N(8,4),N(6,4)],
        [N(10,4),N(1,5),N(3,5),N(6,5), N(8,5),N(6,5),N(3,5),N(1,5),
         N(10,4),N(1,5),N(6,5),N(8,5), N(6,5),N(3,5),N(1,5),N(10,4)],
        [N(5,5),N(4,5),N(2,5),N(0,5), N(9,4),N(0,5),N(2,5),N(4,5),
         N(5,5),N(4,5),N(2,5),N(0,5), N(9,4),N(8,4),N(6,4),N(5,4)],
    ]
    roots = [(N(6,1),N(0,2)), (N(0,2),N(6,2)),
             (N(10,1),N(5,2)), (N(5,1),N(0,2))]
    for section in range(4):
        for local_bar in range(4):
            b = section * 4 + local_bar
            notes = phrases[section][local_bar*4:(local_bar+1)*4]
            lead_ev.append((b*bar, [(n, PPQ, (i in (0,3))*4) for i,n in enumerate(notes)]))
            r, fifth = roots[section]
            bass_line = [r, fifth, r+12, fifth, r, fifth, r+12, fifth]
            bass_ev.append((b*bar, [(n, eighth, -4 if i%2 else 0) for i,n in enumerate(bass_line)]))
            drum_ev += [(b*bar,36,38),(b*bar+PPQ*2,36,32),
                        (b*bar+PPQ,38,30),(b*bar+PPQ*3,38,32)]
    cfg["lead_pattern"], cfg["bass_pattern"], cfg["drum_pattern"] = lead_ev, bass_ev, drum_ev
_build_alley_confrontation_c_patterns()

# ---------- 9d. alley_confrontation_d — pursuit pulse ------------------
# The former 20-bar single drone is replaced by an 8-bar tense pursuit cue:
# a low ostinato and a complete, repeating choir melody with no empty bars.
SCENES_B["alley_confrontation_d"] = {
    "name": "alley_confrontation_d", "bars": 8, "bpm": 96,
    "lead": {"prog": 91, "vol": 96, "pan": 68, "reverb": 70, "mod_init": 18},
    "bass": {"prog": 35, "vol": 88, "reverb": 20},
    "pad": {"prog": 54, "vol": 72, "pan": 58, "reverb": 82},
    "drums": {"vol": 52, "reverb": 38},
    "lead_vel_ramp": (88,108), "lead_mod_ramp": (18,42),
    "key_intervals": PHRYGIAN, "root": 6,
    "pad_chords": [
        (0,[N(6,3),N(9,3),N(0,4),N(3,4)]),
        (2,[N(5,3),N(8,3),N(11,3),N(2,4)]),
        (4,[N(1,3),N(4,3),N(7,3),N(10,3)]),
        (6,[N(0,3),N(4,3),N(10,3),N(1,4)]),
    ],
    "pad_vel_ramp": (68,84,8),
    "lead_pattern": [], "bass_pattern": [], "drum_pattern": [],
}

def _build_alley_confrontation_d_patterns():
    """Eight bars of connected pursuit melody and heartbeat ostinato."""
    cfg=SCENES_B["alley_confrontation_d"]; bar=PPQ*BEATS_PER_BAR; eighth=PPQ//2
    lead_ev=[]; bass_ev=[]; drum_ev=[]
    melody=[
      [N(6,4),N(8,4),N(9,4),N(8,4),N(6,4),N(3,5),N(1,5),N(0,5)],
      [N(8,4),N(9,4),N(11,4),N(0,5),N(3,5),N(1,5),N(0,5),N(8,4)],
      [N(5,4),N(8,4),N(11,4),N(2,5),N(5,5),N(2,5),N(11,4),N(8,4)],
      [N(5,4),N(4,4),N(2,4),N(4,4),N(5,4),N(8,4),N(11,4),N(2,5)],
      [N(1,5),N(4,5),N(7,5),N(10,5),N(7,5),N(4,5),N(1,5),N(10,4)],
      [N(7,4),N(10,4),N(1,5),N(4,5),N(7,5),N(4,5),N(1,5),N(10,4)],
      [N(0,5),N(1,5),N(4,5),N(10,4),N(8,4),N(6,4),N(5,4),N(4,4)],
      [N(3,5),N(1,5),N(0,5),N(10,4),N(8,4),N(6,4),N(5,4),N(6,4)],
    ]
    bass_roots=[N(6,1),N(6,1),N(5,1),N(5,1),N(1,1),N(1,1),N(0,2),N(0,2)]
    for b in range(8):
        lead_ev.append((b*bar,[(n,eighth,5 if i in (0,4) else 0) for i,n in enumerate(melody[b])]))
        r=bass_roots[b]; bass_ev.append((b*bar,[(n,eighth,0) for n in [r,r+12,r,r+7,r,r+12,r+7,r]]))
        drum_ev += [(b*bar,36,48),(b*bar+PPQ*2,36,42),(b*bar+PPQ,38,36),(b*bar+PPQ*3,38,38)]
        for i in range(8): drum_ev.append((b*bar+i*eighth,42,25 if i%2 else 32))
    cfg["lead_pattern"],cfg["bass_pattern"],cfg["drum_pattern"]=lead_ev,bass_ev,drum_ev
_build_alley_confrontation_d_patterns()

# ---------- 9e. alley_confrontation_e — release and loop seam ----------
# A 16-bar answer to C/D. The melody descends and resolves but remains active
# in every bar; walking bass and a restrained pulse lead cleanly back to A.
SCENES_B["alley_confrontation_e"] = {
    "name":"alley_confrontation_e","bars":16,"bpm":90,
    "lead":{"prog":91,"vol":92,"pan":64,"reverb":78,"mod_init":30},
    "bass":{"prog":35,"vol":82,"reverb":25},
    "pad":{"prog":54,"vol":78,"pan":64,"reverb":90},
    "drums":{"vol":42,"reverb":42},
    "lead_vel_ramp":(100,82),"lead_mod_ramp":(48,24),
    "key_intervals":PHRYGIAN,"root":6,
    "pad_chords":[
      (0,[N(10,2),N(1,3),N(6,3),N(8,3)]),
      (4,[N(5,3),N(9,3),N(2,4),N(4,4)]),
      (8,[N(0,3),N(4,3),N(10,3),N(1,4)]),
      (12,[N(6,3),N(9,3),N(0,4),N(3,4)]),
    ],
    "pad_vel_ramp":(82,72,16),
    "lead_pattern":[],"bass_pattern":[],"drum_pattern":[],
}

def _build_alley_confrontation_e_patterns():
    """Descending answer phrase; continuous through the A-loop seam."""
    cfg=SCENES_B["alley_confrontation_e"]; bar=PPQ*BEATS_PER_BAR; eighth=PPQ//2
    lead_ev=[]; bass_ev=[]; drum_ev=[]
    phrase=[N(8,5),N(6,5),N(3,5),N(1,5),N(10,4),N(1,5),N(3,5),N(6,5),
            N(5,5),N(4,5),N(2,5),N(0,5),N(9,4),N(0,5),N(2,5),N(4,5),
            N(3,5),N(1,5),N(0,5),N(10,4),N(8,4),N(10,4),N(1,5),N(0,5),
            N(9,4),N(8,4),N(6,4),N(5,4),N(6,4),N(8,4),N(9,4),N(6,4)]
    roots=[N(10,1),N(5,1),N(0,2),N(6,1)]
    for b in range(16):
        p=phrase[(b%8)*4:(b%8+1)*4]
        if b>=8: p=[n-12 if n>84 else n for n in p]
        lead_ev.append((b*bar,[(n,PPQ,3 if i==0 else 0) for i,n in enumerate(p)]))
        r=roots[b//4]; bass_ev.append((b*bar,[(n,eighth,-3 if i%2 else 0) for i,n in enumerate([r,r+7,r+12,r+7,r,r+7,r+12,r+7])]))
        drum_ev += [(b*bar,36,36),(b*bar+PPQ*2,36,30),(b*bar+PPQ,38,28),(b*bar+PPQ*3,38,30)]
    cfg["lead_pattern"],cfg["bass_pattern"],cfg["drum_pattern"]=lead_ev,bass_ev,drum_ev
_build_alley_confrontation_e_patterns()

# Build the lookup the runtime + CLI uses — merges SCENES + SCENES_B so
# `--list` and the render_midi/render_mp3 functions Just Work.
SCENES.update(SCENES_B)


# -----------------------------------------------------------------------------
# Render entrypoints
# -----------------------------------------------------------------------------
def render_midi(name: str) -> Path:
    """Compose and write <name>.mid. Returns the output path."""
    if name not in SCENES:
        print(f"ERROR: scene '{name}' not in SCENES. Available: {sorted(SCENES)}", file=sys.stderr)
        sys.exit(1)
    cfg = SCENES[name]
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    out = AUDIO_DIR / f"{name}.mid"
    raw = write_smf_clean(compose(cfg))
    out.write_bytes(raw)
    loop_ticks = cfg["bars"] * PPQ * BEATS_PER_BAR
    loop_seconds = loop_ticks / PPQ * 60 / cfg["bpm"]
    print(f"[make_scene_loop] wrote {out} ({len(raw)} bytes, "
          f"{cfg['bars']} bars @ {cfg['bpm']} BPM, "
          f"loop ≈ {loop_seconds:.1f}s)")
    # Post-write per-bar density check (catches sparse regressions early).
    # Counts note_on events on each non-drum channel per bar. Prints one
    # line per channel with min/max bars hit so a single glance shows
    # whether any channel has empty bars. The COMBINED line sums lead
    # + bass + pad note-ons per bar — any bar with 0 across all three
    # is genuinely silent (no melody, no bass, no pad). Drum hits are
    # NOT counted here (they're on ch=9 and excluded).
    try:
        import mido
        mid = mido.MidiFile(str(out))
        bar_ticks = PPQ * BEATS_PER_BAR
        ch_events = {0: [], 1: [], 2: []}  # lead, bass, pad
        for tr in mid.tracks:
            t = 0
            for msg in tr:
                t += msg.time
                if msg.type == 'note_on' and msg.channel in ch_events and msg.velocity > 0:
                    ch_events[msg.channel].append(t)
        role = {0: 'lead', 1: 'bass', 2: 'pad'}
        per_channel_counts = {}
        for ch, events in ch_events.items():
            if not events:
                continue
            counts = [0] * cfg["bars"]
            for t in events:
                b = int(t // bar_ticks)
                if 0 <= b < cfg["bars"]:
                    counts[b] += 1
            per_channel_counts[ch] = counts
            non_zero = sum(1 for c in counts if c > 0)
            empty = [i for i, c in enumerate(counts) if c == 0]
            msg = f"  ch={ch} ({role[ch]:<4}) bars hit: {non_zero}/{cfg['bars']} min={min(counts)} max={max(counts)}"
            if empty:
                msg += f" EMPTY: {empty}"
            print(msg)
        # Combined: any melody/bass/pad activity per bar
        if per_channel_counts:
            combined = [sum(per_channel_counts[ch][b] if b < len(per_channel_counts[ch]) else 0
                            for ch in per_channel_counts)
                        for b in range(cfg["bars"])]
            non_zero = sum(1 for c in combined if c > 0)
            empty = [i for i, c in enumerate(combined) if c == 0]
            longest = 0; cur = 0
            for c in combined:
                if c == 0:
                    cur += 1
                    if cur > longest: longest = cur
                else:
                    cur = 0
            msg = f"  COMBINED (lead+bass+pad) bars hit: {non_zero}/{cfg['bars']} longest_empty_run={longest}"
            if empty:
                msg += f" EMPTY: {empty}"
            print(msg)
    except ImportError:
        pass  # mido is dev-only; not a render dependency
    return out


def render_mp3(name: str) -> Path:
    """Render the MIDI to MP3 via the project's documented pipeline
    (tools/render-midi.sh). Same path the existing alley_confrontation.mp3
    and clinic_tension.mp3 were rendered with."""
    if not RENDER_SH.exists():
        print(f"ERROR: {RENDER_SH} not found", file=sys.stderr)
        sys.exit(1)
    if not SF2.exists():
        print(f"ERROR: soundfont not found at {SF2}", file=sys.stderr)
        sys.exit(1)
    mid = AUDIO_DIR / f"{name}.mid"
    if not mid.exists():
        print(f"ERROR: {mid} not found — render MIDI first", file=sys.stderr)
        sys.exit(1)
    print(f"[make_scene_loop] rendering {name}.mid → {name}.mp3 via render-midi.sh")
    result = subprocess.run(
        [str(RENDER_SH), str(mid)],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(f"ERROR: render-midi.sh failed:\n{result.stderr}", file=sys.stderr)
        sys.exit(result.returncode)
    print(result.stdout, end="")
    mp3 = AUDIO_DIR / f"{name}.mp3"
    if not mp3.exists():
        print(f"ERROR: render-midi.sh reported success but {mp3} not found", file=sys.stderr)
        sys.exit(1)
    return mp3


def main() -> None:
    p = argparse.ArgumentParser(description="Compose + render a Ghost Process scene loop")
    p.add_argument("name", nargs="?", default=None,
                   help="Scene name (must match a key in SCENES)")
    p.add_argument("--no-render", action="store_true",
                   help="Only write the .mid, don't run fluidsynth")
    p.add_argument("--list", action="store_true",
                   help="List available scene configs and exit")
    args = p.parse_args()

    if args.list:
        print("Available scenes:")
        for k, cfg in SCENES.items():
            loop_sec = (cfg['bars']*PPQ*BEATS_PER_BAR)/PPQ*60/cfg['bpm']
            print(f"  {k:14} bars={cfg['bars']:2} bpm={cfg['bpm']:3} loop≈{loop_sec:.1f}s")
        return

    if not args.name:
        p.error("scene name required (or use --list)")

    render_midi(args.name)
    if not args.no_render:
        render_mp3(args.name)


if __name__ == "__main__":
    main()