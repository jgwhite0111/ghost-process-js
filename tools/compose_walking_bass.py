"""Compose a real walking bassline for ch 1 of terminal_lab.mid and
ship_engine.mid, replacing the existing one-note metronome pattern.

IN-PLACE rewrite: keeps all other channels (ch 0, ch 2, ch 9)
untouched. Only ch 1 events are removed and replaced.

For each bar (4 beats), the bass plays:
  bar 0/4/8/12: root, fifth, seventh, root (with 8th note pickup to next root)
  bar 1/5/9/13: root, third, fifth, octave
  bar 2/6/10/14: root, fifth, seventh, octave
  bar 3/7/11/15: root, third, fifth, seventh, 8th-walk to next chord root

For 2-chord songs (each chord lasts 16 bars), the walking bass
varies in 4-bar phrases. Bar 16 lands on chord 2's root.
"""
import os
from pathlib import Path
from mido import MidiFile, MidiTrack, Message

os.chdir(Path(__file__).resolve().parent.parent)

# Chord progressions from ch 2 analysis
SCENES = {
    'terminal_lab': {
        'chords': [
            {'root': 36, 'third': 40, 'fifth': 43, 'seventh': 46, 'name': 'Cmaj7'},
            {'root': 40, 'third': 43, 'fifth': 47, 'seventh': 50, 'name': 'Em7'},
        ],
        'bars': 32,
    },
    'ship_engine': {
        'chords': [
            {'root': 38, 'third': 41, 'fifth': 45, 'seventh': 48, 'name': 'Dm7'},
            {'root': 45, 'third': 48, 'fifth': 53, 'seventh': 55, 'name': 'Am11'},
        ],
        'bars': 32,
    },
    'alley_confrontation': {
        # F#dim7 (low octave) - F# A C Eb, then C7b9 (C E Bb Db)
        'chords': [
            {'root': 30, 'third': 33, 'fifth': 36, 'seventh': 39, 'name': 'F#dim7'},  # F#1 A1 C2 Eb2
            {'root': 36, 'third': 40, 'fifth': 46, 'seventh': 49, 'name': 'C7b9'},     # C2 E2 Bb2 Db3
            {'root': 34, 'third': 37, 'fifth': 41, 'seventh': 44, 'name': 'A#dim7'},   # A#1 C2 F2 G2
            {'root': 41, 'third': 45, 'fifth': 50, 'seventh': 53, 'name': 'F7b9'},     # F2 A2 D3 F3
        ],
        'bars': 16,
    },
    'clinic_tension': {
        # Am7 (A C E G), F#dim7 (F# A C Eb), A#dim7 (A# C# F G)
        'chords': [
            {'root': 33, 'third': 36, 'fifth': 40, 'seventh': 43, 'name': 'Am7'},      # A1 C2 E2 G2
            {'root': 30, 'third': 33, 'fifth': 36, 'seventh': 39, 'name': 'F#dim7'},   # F#1 A1 C2 Eb2
            {'root': 34, 'third': 37, 'fifth': 41, 'seventh': 44, 'name': 'A#dim7'},   # A#1 C2 F2 G2
        ],
        'bars': 24,
    },
    'cold_open': {
        # Dm7 (D F A C), Dm(maj7) (D F A C#), Gm9 (G Bb D F A), D (D A D)
        'chords': [
            {'root': 38, 'third': 41, 'fifth': 45, 'seventh': 48, 'name': 'Dm7'},     # D2 F2 A2 C3
            {'root': 38, 'third': 41, 'fifth': 45, 'seventh': 49, 'name': 'Dm(maj7)'},# D2 F2 A2 C#3
            {'root': 43, 'third': 46, 'fifth': 50, 'seventh': 53, 'name': 'Gm9'},     # G2 Bb2 D3 F3
            {'root': 50, 'third': 57, 'fifth': 62, 'seventh': 69, 'name': 'D'},       # D3 A3 D4 A4 (power)
        ],
        'bars': 46,
    },
    'ship_engine_b': {
        # Dm7, F#dim7, G#dim7
        'chords': [
            {'root': 38, 'third': 41, 'fifth': 45, 'seventh': 48, 'name': 'Dm7'},     # D2 F2 A2 C3
            {'root': 30, 'third': 33, 'fifth': 36, 'seventh': 39, 'name': 'F#dim7'},  # F#1 A1 C2 Eb2
            {'root': 32, 'third': 35, 'fifth': 39, 'seventh': 44, 'name': 'G#dim7'},  # G#1 C2 F2 G2
        ],
        'bars': 24,
    },
}

PPQ = 96
BAR = PPQ * 4
BARS_PER_CHORD = 16
BASS_CHANNEL = 1
BASS_PROGRAM = 36  # Slap Bass 1


def walking_pattern_for_bar(bar_in_phrase, chord, next_chord):
    root = chord['root']
    third = chord['third']
    fifth = chord['fifth']
    seventh = chord['seventh']
    octave = root + 12
    Q = PPQ
    E = PPQ // 2

    if bar_in_phrase == 0:
        return [
            (0,  root,    Q),
            (Q,  fifth,   Q),
            (2*Q, seventh, Q),
            (3*Q, root,   Q),
        ]
    elif bar_in_phrase == 1:
        return [
            (0,  root,   Q),
            (Q,  third,  Q),
            (2*Q, fifth,  Q),
            (3*Q, octave, Q),
        ]
    elif bar_in_phrase == 2:
        return [
            (0,  root,    Q),
            (Q,  fifth,   Q),
            (2*Q, seventh, Q),
            (3*Q, octave,  Q),
        ]
    else:
        # bar 3: walking up to next chord root
        next_root = next_chord['root']
        return [
            (0,   root,    Q),
            (Q,   third,   Q),
            (2*Q, fifth,   Q),
            (3*Q, seventh, Q),
            (3*Q + E, next_root, E),
        ]


def build_bass_messages(chords, total_bars):
    """Build a flat list of (abs_tick, msg) for the bass track.

    abs_tick is the absolute time, converted to deltas when emitted.
    """
    events = []  # (abs_tick, msg) sorted by abs_tick
    for bar_index in range(total_bars):
        chord_index = min(bar_index // BARS_PER_CHORD, len(chords) - 1)
        chord = chords[chord_index]
        next_chord = chords[min(chord_index + 1, len(chords) - 1)]
        bar_in_phrase = bar_index % 4
        notes = walking_pattern_for_bar(bar_in_phrase, chord, next_chord)
        bar_start = bar_index * BAR
        for (offset, note, dur) in notes:
            on_tick = bar_start + offset
            off_tick = on_tick + dur
            events.append((on_tick, Message('note_on', channel=BASS_CHANNEL, note=note, velocity=75)))
            events.append((off_tick, Message('note_off', channel=BASS_CHANNEL, note=note, velocity=0)))
    events.sort(key=lambda e: e[0])
    return events


def emit_with_deltas(events):
    """Convert (abs_tick, msg) into MidiTrack with delta times.
    Also inject a program_change for the bass patch at t=0."""
    track = MidiTrack()
    # Add program change at the start
    track.append(Message('program_change', channel=BASS_CHANNEL, program=BASS_PROGRAM, time=0))
    last_tick = 0
    for (abs_tick, msg) in events:
        delta = abs_tick - last_tick
        msg.time = delta
        track.append(msg)
        last_tick = abs_tick
    return track


def rewrite_bass_in_place(midi_path, chords, total_bars):
    """Read MIDI, strip ch 1 events from the (single) track, then merge
    in the new walking bassline events with correct delta times.

    Type 0 MIDI = single track with all channels. We can't append a
    second track, so we interleave the new ch 1 events into the
    existing track."""
    mid = MidiFile(midi_path)
    if len(mid.tracks) != 1:
        raise RuntimeError(f"Expected type 0 MIDI with 1 track, got {len(mid.tracks)}")
    original_track = mid.tracks[0]

    # Collect original events that are NOT ch 1, as (abs_tick, msg).
    # The first event's time is a delta; for abs_tick purposes, the
    # first event is at tick=0 (since the file starts at 0).
    other_events = []  # (abs_tick, msg)
    abs_tick = 0
    for msg in original_track:
        is_ch1 = getattr(msg, 'channel', None) == BASS_CHANNEL
        if not is_ch1:
            other_events.append((abs_tick, msg))
        abs_tick += msg.time

    # Build new bass events
    bass_events = build_bass_messages(chords, total_bars)

    # Add program_change at tick 0 (or update the existing one if there is one)
    has_pc = any(
        getattr(m, 'channel', None) == BASS_CHANNEL and m.type == 'program_change'
        for _, m in other_events
    )
    if not has_pc:
        bass_events.insert(0, (0, Message('program_change', channel=BASS_CHANNEL, program=BASS_PROGRAM)))

    # Merge: combine other_events and bass_events, sort by tick
    all_events = other_events + bass_events
    all_events.sort(key=lambda e: (e[0], 0 if 'note_on' in str(e[1].type) or e[1].type == 'program_change' else 1))

    # Emit with delta times
    new_track = MidiTrack()
    last_tick = 0
    for (abs_t, msg) in all_events:
        msg.time = abs_t - last_tick
        new_track.append(msg)
        last_tick = abs_t

    mid.tracks.clear()
    mid.tracks.append(new_track)
    mid.save(midi_path)
    print(f"  wrote {midi_path} ({total_bars} bars walking bass, ch 0/2/9 preserved)")


if __name__ == '__main__':
    for scene, cfg in SCENES.items():
        path = f'assets/audio/{scene}.mid'
        rewrite_bass_in_place(path, cfg['chords'], total_bars=cfg['bars'])
    print("Done. Re-render with tools/render-midi.sh to regenerate MP3s.")
