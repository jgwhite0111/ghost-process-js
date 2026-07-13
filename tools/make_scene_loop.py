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


def schedule_held_pad(cfg: dict) -> list[Event]:
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
    for start_bar, notes in cfg["pad_chords"]:
        t_on = int(start_bar * bar)
        t_off = loop_ticks - 1
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


def schedule_phrase(cfg: dict, channel: int, phrases: list, base_vel: int = 80,
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
        # Compute the per-note base velocity, scaled by vel_ramp if any.
        if vel_ramp is None or vel_ramp[0] == vel_ramp[1]:
            scaled_base = base_vel
        else:
            frac = start / max(1, loop_ticks)
            scaled_base = int(vel_ramp[0] + (vel_ramp[1] - vel_ramp[0]) * frac)
        for note_info in notes:
            if len(note_info) == 2:
                key, dur = note_info
                vdelta = 0
            else:
                key, dur, vdelta = note_info
            v = max(20, min(127, scaled_base + vdelta))
            if key is None:
                # rest — no note_on, but advance the cursor by dur
                continue
            ev.append(note_on(channel, key, v, start))
            ev.append(note_off(channel, key, start + dur - 1))
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
        ev += schedule_held_pad(cfg)
    if cfg.get("bass"):
        ev += schedule_phrase(cfg, CH_BASS, cfg["bass_pattern"],
                              base_vel=cfg["bass"].get("vol", 85),
                              vel_ramp=cfg.get("bass_vel_ramp"))
    if cfg.get("lead"):
        ev += schedule_phrase(cfg, CH_LEAD, cfg["lead_pattern"],
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
    # bars 12-15: HALF-TIME — bass walks single notes (root, 5th, root, octave)
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
    # bars 12-15: HALF-TIME — sparse stabs (only beat 1 of every 2 bars)
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
# SHAPE: bars 0-5 sparse music box arpeggios ONLY (one motif, repeats),
# NO pad chord yet. Bar 6 pad chord Cm enters quietly. Bars 7-11
# arpeggios expand to two voices; pad swells. Bar 12 SILENCE (pad
# breakdown, expression=0; no notes scheduled). Bar 13 chord re-enters
# loudly (single big arpeggio peak). Bars 14-19 arpeggios + pad build
# again (different chord, Ab), climax. Bars 20-23 decay (arpeggios slow,
# pad breakdown drops to 0). Tempo unchanged.
SCENES["corridor"] = {
    "name": "corridor",
    "bars": 24,                              # ~96s at 60 BPM (slow dread)
    "bpm": 60,
    "lead": {"prog": 11, "vol": 75, "pan": 64, "reverb": 70, "mod_init": 0},  # Music Box
    "bass": {"prog": 39, "vol": 70, "reverb": 30},
    "pad":  {"prog": 100, "vol": 30, "pan": 64, "reverb": 100},  # vol=30 = quiet entry
    "drums": {"vol": 0, "reverb": 0},        # no percussion
    "key_intervals": MINOR,
    "root": 0,                               # C minor
    "lead_mod_ramp": (0, 30),                # music box gets breath
    # Pad chords: chord 1 (Cm) enters at bar 4 (was bar 6 — too late for
    # the corridor scene; 16s of silence before first chord felt broken
    # in playtest). chord 2 (Ab) enters at bar 12 for the climax section.
    # pad_breakdowns create the silence at bar 10 (expression=0 mid-bar-10)
    # and the decay at bars 18-23.
    "pad_chords": [
        (4,  [N(0,3), N(3,3), N(7,3), N(10,3)]),       # Cm enters at bar 4
        (12, [N(8,3), N(0,4), N(3,4), N(7,4)]),        # Ab enters at bar 12 (climax)
    ],
    # Pad expression ramp: 0→110 across the loop. At bar 4 (the chord entry
    # point), CC11 ≈ 0 + 110*(4/24) ≈ 18 — very quiet, matches the music-box
    # entry dynamic. Breakdown at bar 10 zeros it for the silence, restores
    # at bar 11 for the re-entry (with single peak arpeggio note), then
    # breakdown at bars 18-23 zeros it for the final decay.
    "pad_vel_ramp": (0, 110, 24),
    "pad_breakdowns": [(10, 11), (18, 23)],
    # Lead: music box arpeggios ONLY for bars 0-5 (one motif, repeats).
    # Then two arpeggiated voices expand bars 7-11. Single peak note
    # at bar 13. Climax arpeggios + Ab chord bars 14-19. Decay
    # bars 20-23 with a final held note fading to the wrap.
    "lead_pattern": [
        # bars 0-3 — single motif every 1 bar so there's no dead air after
        # the first note (was every 2 bars — 8s gaps between motifs
        # still felt "intermittent" in playtest. Every-bar gives a
        # continuous ostinato in the intro.)
        (0, [                                          # bar 0 — motif plays
            (N(0,5), PPQ, 0), (N(3,5), PPQ, 0),
            (N(7,5), PPQ, 0), (N(10,5), PPQ, 0),
        ]),
        (PPQ*4, [                                      # bar 1 — motif repeats
            (N(0,5), PPQ, 0), (N(3,5), PPQ, 0),
            (N(7,5), PPQ, 0), (N(10,5), PPQ, 0),
        ]),
        (PPQ*8, [                                      # bar 2 — motif repeats
            (N(0,5), PPQ, 0), (N(3,5), PPQ, 0),
            (N(7,5), PPQ, 0), (N(10,5), PPQ, 0),
        ]),
        (PPQ*12, [                                     # bar 3 — motif repeats
            (N(0,5), PPQ, 0), (N(3,5), PPQ, 0),
            (N(7,5), PPQ, 0), (N(10,5), PPQ, 0),
        ]),
        # bars 4-9 — pad chord enters; arpeggios expand to TWO voices,
        # every 2 bars (was bars 6-11, shifted earlier so the intro isn't
        # 16 seconds of dead air)
        (PPQ*16, [                                     # bar 4 — voice 1
            (N(0,5), PPQ, 0), (N(3,5), PPQ, 0),
            (N(7,5), PPQ, 0), (N(10,5), PPQ, 0),
        ]),
        (PPQ*20, [                                     # bar 5 — voice 2 joins (octave above)
            (N(0,6), PPQ, 0), (N(3,6), PPQ, 0),
            (N(7,6), PPQ, 0), (N(10,6), PPQ, 0),
        ]),
        (PPQ*24, [                                     # bar 6 — interleave
            (N(0,5), PPQ, 0), (N(3,5), PPQ, 0),
            (N(7,5), PPQ, 0), (N(10,5), PPQ, 0),
            (N(0,6), PPQ, 0), (N(3,6), PPQ, 0),
            (N(7,6), PPQ, 0), (N(10,6), PPQ, 0),
        ]),
        (PPQ*32, [                                     # bar 8 — variation
            (N(10,5), PPQ, 0), (N(7,5), PPQ, 0),
            (N(3,5), PPQ, 0), (N(0,5), PPQ, 0),
            (N(10,6), PPQ, 0), (N(7,6), PPQ, 0),
            (N(3,6), PPQ, 0), (N(0,6), PPQ, 0),
        ]),
        # bar 10 — SILENCE: pad_breakdowns zeros expression; lead has no notes
        # bar 11 — single BIG arpeggio peak note (chord re-enters loud)
        (PPQ*44, [
            (N(3,6), PPQ*4, 15),                       # Eb6 peak, accent +15
        ]),
        # bars 12-17 — climax arpeggios with Ab chord, two voices
        (PPQ*48, [                                     # bar 12
            (N(8,5), PPQ, 0), (N(0,6), PPQ, 0),
            (N(3,6), PPQ, 0), (N(7,6), PPQ, 0),
            (N(8,6), PPQ, 0), (N(0,7), PPQ, 0),
            (N(3,7), PPQ, 0), (N(7,7), PPQ, 0),
        ]),
        (PPQ*56, [                                     # bar 14
            (N(8,5), PPQ, 0), (N(7,5), PPQ, 0),
            (N(3,6), PPQ, 0), (N(0,6), PPQ, 0),
            (N(7,6), PPQ, 0), (N(3,6), PPQ, 0),
            (N(0,6), PPQ, 0), (N(8,5), PPQ, 0),
        ]),
        (PPQ*64, [                                     # bar 16 — peak
            (N(0,7), PPQ, 0), (N(3,7), PPQ, 0),
            (N(7,7), PPQ, 0), (N(3,7), PPQ, 0),
            (N(0,7), PPQ*2, 5), (N(7,7), PPQ*2, 5),
        ]),
        # bars 18-23 — decay: arpeggios slow, final held note fades
        (PPQ*72, [                                     # bar 18 — slowing
            (N(3,6), PPQ*2, -5), (N(0,6), PPQ*2, -8),
            (None, PPQ*8, 0),
        ]),
        (PPQ*88, [                                     # bar 22 — single held note
            (N(0,6), PPQ*8, -10),                      # C6 fading to wrap
        ]),
        # bar 23 — silence
    ],
    "bass_pattern": [
        # Long drone C (bars 0-3) — slow harmonic movement
        # (was bars 0-5 — shrunk to match new earlier chord entry at bar 4)
        (0, [(N(0,2), PPQ*16, 0)]),                    # bars 0-3: C2
        (PPQ*16, [(N(0,2), PPQ*8, 0), (N(7,1), PPQ*8, 0),
                  (N(5,2), PPQ*8, 0), (N(7,2), PPQ*8, 0)]),  # bars 4-11: motion
        (PPQ*48, [(N(8,2), PPQ*8, 0), (N(3,2), PPQ*8, 0),
                  (N(8,2), PPQ*8, 0), (N(3,2), PPQ*8, 0)]),  # bars 12-19: Ab
        (PPQ*80, [(None, PPQ*8, 0)]),                  # bar 20-21: rest
    ],
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
        (N(5,5), PPQ),       # F5 quarter
        (N(8,5), PPQ),       # Ab5
        (N(10,5), PPQ),      # Bb5
        (N(8,5), PPQ),       # Ab5
        (N(10,5), PPQ),      # Bb5
        (N(5,5), eighth),    # F5 8th
        (N(3,5), eighth),    # Eb5
        (N(5,5), PPQ),       # F5 quarter
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
    # B-side lead: low staccato pulse (vs A's high stabs) — fills the
    # midrange during the crossfade so it doesn't fight the A-side melody
    for b in range(cfg["bars"]):
        t = b * bar
        # Pulse on every 8th, low octave
        for i in range(8):
            lead_ev.append((t + i * eighth, [(N(2,4), eighth, -15)]))
        # Accent descending run every 4 bars (low octave)
        if b % 4 == 2:
            for i, nt in enumerate([N(0,4), N(11,3), N(9,3), N(7,3)]):
                lead_ev.append((t + i * eighth, [(nt, eighth, -10)]))
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
# change that drops the brightness). HALF-TIME 88 BPM. The kit becomes
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
# Returns to E minor and the chase energy, but starts at HALF-TIME 88 BPM
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
    "tempo_changes": [(12, 132)],             # HALF-TIME LIFT at bar 12
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

# ---------- 3. corridor_b — second motif, music box becomes detuned -----
SCENES_B["corridor_b"] = {
    "name": "corridor_b",
    "bars": 24,
    "bpm": 60,
    # B-side uses slightly different patch — detuned celesta (Celesta 8)
    # same family as Music Box 11 but with different timbre — adds unease
    "lead": {"prog": 8, "vol": 75, "pan": 64, "reverb": 80, "mod_init": 0},  # Celesta
    "bass": {"prog": 39, "vol": 70, "reverb": 30},   # same
    "pad":  {"prog": 100, "vol": 95, "pan": 64, "reverb": 100},   # same
    "drums": {"vol": 0, "reverb": 0},         # same — no percussion
    "key_intervals": MINOR,
    "root": 0,                               # C minor (same)
    "lead_mod_ramp": (0, 45),                # celesta breath builds
    # B-side chords: Cm → Fm → Ab (descending bass lift — heavier feel)
    "pad_chords": [
        (0,  [N(0,3), N(3,3), N(7,3), N(10,3)]),      # Cm  (bars 0-7)
        (8,  [N(5,3), N(8,3), N(0,4), N(3,4)]),       # Fm  (bars 8-15)
        (16, [N(8,3), N(0,4), N(3,4), N(7,4)]),       # Ab  (bars 16-23)
    ],
    # Pad starts ALREADY AT PEAK (A's quiet intro is over by now, but B is
    # the sustain phase). Gentle droop at end so the loop wrap breathes
    # before A returns. Mostly flat because the music is already cinematic.
    "pad_vel_ramp": (95, 70, 24),
    # Lead energy climbs through the climax bars 16-19, sustains to wrap.
    "lead_vel_ramp": (70, 95),
    "lead_pattern": [],
    "bass_pattern": [],
    "drum_pattern": [],
    "cross_boundary_crash": False,
}
def _build_corridor_b_patterns():
    cfg = SCENES_B["corridor_b"]
    bar = PPQ * BEATS_PER_BAR
    # B-side bass: more active — pulsing 4ths instead of drone
    bass_ev = [
        (0,      [(N(0,2), PPQ*2, 0), (N(5,2), PPQ*2, 0),
                  (N(0,2), PPQ*2, 0), (N(5,2), PPQ*2, 0)]),
        (PPQ*32, [(N(5,2), PPQ*2, 0), (N(0,3), PPQ*2, 0),
                  (N(5,2), PPQ*2, 0), (N(0,3), PPQ*2, 0)]),
        (PPQ*64, [(N(8,2), PPQ*2, 0), (N(0,3), PPQ*2, 0),
                  (N(8,2), PPQ*2, 0), (N(0,3), PPQ*2, 0)]),
    ]
    # B-side lead: celesta motif — short repeated figure (vs A's sparse arpeggios)
    motif_a = [N(3,5), N(7,5), N(10,5), N(7,5)]   # Eb-G-Bb-G (Cm)
    motif_b = [N(8,4), N(0,5), N(3,5), N(0,5)]    # Ab-C-Eb-C (Ab)
    lead_ev = []
    for b in range(0, cfg["bars"], 2):
        t = b * bar
        motif = motif_a if b < 8 else motif_b if b < 16 else motif_a
        for i, n in enumerate(motif):
            lead_ev.append((t + i * (PPQ // 2), [(n, PPQ // 2, 0)]))
    cfg["bass_pattern"] = bass_ev
    cfg["lead_pattern"] = lead_ev
_build_corridor_b_patterns()

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
    lead_ev.append((PPQ * 12, [(N(4,6), PPQ * 20, -5)]))   # C#6 held bars 3-7 (20 quarter notes)
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


# ---------- 9. alley_confrontation_b — tranquil counter-melody at full pad ---
# A-side: 16 bars @ 90 BPM, F#dim7→C7b9→A#dim7→F7b9 walking bass, Pad 4
# Choir on ch0, FX 6 Goblin on ch2 whisper. B-side complements: same BPM,
# same chord cycle (F# Phrygian center, root 30 = F#1), same patches — but
# pad is already at peak from bar 0, bass drone on F# holds the floor, and
# a counter-melody enters UP an octave at bar 4 with a calmer 4th-mode
# Phrygian pull. Result: when crossfade lands ~bar 8 (halfway through A),
# the listener hears the Choir pad swell up and a melodic voice join in
# over the dim7 cycle — the "confrontation" continues but feels held/
# sustained rather than tense.
SCENES_B["alley_confrontation_b"] = {
    "name": "alley_confrontation_b",
    "bars": 16,                                 # same bar count as A (47.7s)
    "bpm": 90,                                  # same BPM as A
    "lead": {"prog": 91, "vol": 85, "pan": 64, "reverb": 80, "mod_init": 30},  # Pad 4 (Choir) — same as A
    "bass": {"prog": 35, "vol": 75, "reverb": 25},  # Fretless Bass — same as A
    "pad":  {"prog": 54, "vol": 90, "pan": 64, "reverb": 95},  # Synth Choir — warmer than A's pad (was 100=SFX)
    "drums": {"vol": 0, "reverb": 0},           # no percussion (matches A)
    # Pad already at peak (no ramp). Chord cycle follows A's diminished
    # walk: F#dim7 (bar 0-3) → C7b9 (bar 4-7) → A#dim7 (bar 8-11) →
    # F7b9 (bar 12-15). B-side holds the same chord for 4 bars each —
    # the "stillness" of confrontation rather than the walking-bass push.
    "pad_chords": [
        (0,   [N(6,3), N(9,3), N(0,4), N(3,4)]),       # F#dim7 (bar 0-3)
        (PPQ*16, [N(0,3), N(4,3), N(10,3), N(1,4)]),   # C7b9   (bar 4-7)
        (PPQ*32, [N(10,2), N(1,3), N(6,3), N(8,3)]),   # A#dim7 (bar 8-11)
        (PPQ*48, [N(5,3), N(9,3), N(2,4), N(4,4)]),    # F7b9   (bar 12-15)
    ],
    "pad_vel_ramp": (85, 95, 16),                # already at peak, gentle swell
    "key_intervals": PHRYGIAN,                   # F# Phrygian (matches A's dim7 center)
    "root": 6,                                   # F# = semitone 6 from C
    # Bass: F# drone on bars 0-3 (matches A's first chord), then gentle
    # 5th motion every 2 bars through the cycle. Higher vel than A's
    # walking bass to keep signal above the -50dB silenceremove threshold
    # during pad decay.
    "bass_pattern": [
        # bars 0-3: F# drone (octave doubling for warmth)
        (0, [(N(6,1), PPQ*16, 0), (N(6,2), PPQ*16, 0)]),
        # bars 4-7: C drone (with low F# 5th color)
        (PPQ*16, [(N(0,1), PPQ*16, 0), (N(0,2), PPQ*16, 0)]),
        # bars 8-11: A# drone
        (PPQ*32, [(N(10,1), PPQ*16, 0), (N(10,2), PPQ*16, 0)]),
        # bars 12-15: F drone (root of F7b9)
        (PPQ*48, [(N(5,1), PPQ*16, 0), (N(5,2), PPQ*16, 0)]),
    ],
    # COUNTER-MELODY: Choir pad sustains a slow melodic arc. Enters at
    # bar 4 (after the F#dim7 opening dissonance resolves to C7b9) so
    # the B-side opens with the drone alone — same shape as cold_open_b
    # but on a tighter dim7 cycle. Climbs Eb5 → F#5 → A5 in 4-bar
    # phrases, descends G5 → F#5 across the last 4 bars for the fade.
    # Vel ramp 75→105 keeps the counter audible over the held bass.
    "lead_vel_ramp": (75, 105),
    "lead_mod_ramp": (30, 60),
    "lead_pattern": [
        # bars 4-7 (tick 16-31): first melodic phrase over C7b9
        (PPQ*16, [
            (N(3,5), PPQ*8, -5),                    # Eb5 (the bII pull)
            (N(5,5), PPQ*8, 0),                     # F#5 (root)
        ]),
        # bars 8-11 (tick 32-47): climb to A5 over A#dim7
        (PPQ*32, [
            (N(3,5), PPQ*8, 0),                     # Eb5
            (N(9,5), PPQ*8, 3),                     # A5 (the 5th, highest point)
            (N(7,5), PPQ*8, 0),                     # G5
        ]),
        # bars 12-15 (tick 48-63): descend back over F7b9, settle on F#
        (PPQ*48, [
            (N(7,5), PPQ*8, -3),                    # G5
            (N(5,5), PPQ*8, -5),                    # F#5
            (N(6,5), PPQ*8, -8),                    # Gb5 (Phrygian b2 ghost note, then resolve)
            (N(5,5), PPQ*8, -10),                   # F#5 held (tail)
        ]),
    ],
    "pad_breakdowns": [],
    "cross_boundary_crash": False,                # no drums
    "drum_pattern": [],
}

# -----------------------------------------------------------------------------
# MEDLEY map — which scenes have a B-side, and where to fade
#
# fadeAt = seconds into scene entry when crossfade from A→B starts.
# Omit fadeAt to default to halfway through A's loop length.
# -----------------------------------------------------------------------------
MEDLEYS: dict[str, list[str]] = {
    "alley":        ["alley_confrontation.mp3", "alley_confrontation_b.mp3"],
    "cold_open":    ["cold_open.mp3",    "cold_open_b.mp3"],
    "chase":        ["chase.mp3",        "chase_b.mp3",
                     "chase_c.mp3",      "chase_d.mp3",      "chase_e.mp3"],
    "corridor":     ["corridor.mp3",     "corridor_b.mp3"],
    "jailbreak":    ["jailbreak.mp3",    "jailbreak_b.mp3"],
    "kabukicho":    ["kabukicho.mp3",    "kabukicho_b.mp3"],
    "corp_office":  ["corp_office.mp3",  "corp_office_b.mp3",  "corp_office_c.mp3",  "corp_office_d.mp3",  "corp_office_e.mp3"],
    "terminal_lab": ["terminal_lab.mp3", "terminal_lab_b.mp3"],
    "ship_engine":  ["ship_engine.mp3",  "ship_engine_b.mp3"],
}


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