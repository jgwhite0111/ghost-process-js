"""Render a single A/B sample of every bass-family GM program on the
same walking bassline, so the user can hear the differences in isolation.

For each program we:
  1. Copy terminal_lab.mid
  2. Replace the ch 1 program_change with the target program
  3. Render to a short OGG clip (20s)
"""
import os
import subprocess
from mido import MidiFile, MidiTrack, Message

os.chdir('/Users/jwhite/ghost-process-js')
SOUNDFONT = 'assets/audio/sc55.sf2'
SRC = 'assets/audio/terminal_lab.mid'
OUT_DIR = '/tmp/bass_patches'
os.makedirs(OUT_DIR, exist_ok=True)

# (program_number, name, short_description)
BASS_FAMILY = [
    (32, 'Acoustic Bass',      'woody, upright, dry'),
    (33, 'Fingered Bass',      'jazz-club upright (current)'),
    (34, 'Picked Bass',        'plucky, more attack than fingered'),
    (35, 'Fretless Bass',      'smooth, vocal-like, no percussive attack'),
    (36, 'Slap Bass 1',        'poppy, twangy (rejected earlier)'),
    (37, 'Slap Bass 2',        'even more percussive than Slap 1'),
    (38, 'Synth Bass 1',       'soft synth, sine-wave-ish'),
    (39, 'Synth Bass 2',       'buzzy synth (original bug)'),
    (43, 'Contrabass',         'big body orchestral bass'),
    (87, 'Lead 6 (Voice)',     'voice synth, eerie'),
    # Drum-style option: the walking bassline replaced with kick drum hits on
    # the same rhythm. To keep this simple, we'll mute ch 1 entirely on a copy
    # and add a kick pattern on ch 9 instead.
]


def swap_program(midi_in, midi_out, new_prog):
    mid = MidiFile(midi_in)
    for track in mid.tracks:
        for msg in track:
            if msg.type == 'program_change' and msg.channel == 1:
                msg.program = new_prog
    mid.save(midi_out)


def render(midi_path, ogg_path):
    wav_path = ogg_path.replace('.ogg', '.wav')
    subprocess.run(
        ['fluidsynth', '-F', wav_path, '-q', SOUNDFONT, midi_path],
        check=True, capture_output=True,
    )
    # Extract first 20s only
    subprocess.run(
        ['ffmpeg', '-y', '-loglevel', 'error',
         '-i', wav_path, '-t', '20',
         '-c:a', 'libopus', '-b:a', '64k', ogg_path],
        check=True, capture_output=True,
    )
    os.remove(wav_path)


def render_kick_pattern(ogg_path):
    """Render a clip of just the terminal_lab drums with a kick emphasis
    pattern: hit on beats 1 and 3 of every bar at the song tempo.
    """
    # Use the terminal_lab MIDI but with ch 1 silent and ch 0/2 quiet;
    # and generate a synthetic kick on ch 9 at every beat.
    src = MidiFile(SRC)
    new = MidiFile(type=src.type, ticks_per_beat=src.ticks_per_beat)

    PPQ = src.ticks_per_beat
    BAR = PPQ * 4

    # Strip ch 1 events from original; keep ch 0/2/9
    track_events = []
    abs_tick = 0
    for track in src.tracks:
        for msg in track:
            if getattr(msg, 'channel', None) == 1:
                abs_tick += msg.time
                continue
            track_events.append((abs_tick, msg))
            abs_tick += msg.time
    track_events.sort(key=lambda e: e[0])

    # Generate kick pattern: hit on beats 1 and 3 of every bar for 20 bars
    # Velocity 100, channel 9, note 36 (GM bass drum)
    kick_events = []
    for bar in range(20):
        bar_start = bar * BAR
        # beat 1
        kick_events.append((bar_start, 0, 100))
        # beat 3 (half-bar in)
        kick_events.append((bar_start + 2 * PPQ, 0, 100))

    # Merge: add kick note_on/note_off around each kick event
    all_events = list(track_events)
    for (abs_t, _, vel) in kick_events:
        all_events.append((abs_t, Message('note_on', channel=9, note=36, velocity=vel)))
        all_events.append((abs_t + PPQ // 2, Message('note_off', channel=9, note=36, velocity=0)))
    all_events.sort(key=lambda e: e[0])

    # Emit with delta times
    new_track = MidiTrack()
    last_tick = 0
    for (abs_t, msg) in all_events:
        msg.time = abs_t - last_tick
        new_track.append(msg)
        last_tick = abs_t
    new.tracks.clear()
    new.tracks.append(new_track)
    new.save('/tmp/_kick_pattern.mid')

    render('/tmp/_kick_pattern.mid', ogg_path)


if __name__ == '__main__':
    for (prog, name, desc) in BASS_FAMILY:
        slug = name.split('(')[0].strip().lower().replace(' ', '_')
        midi_out = f'/tmp/_patch_{slug}.mid'
        ogg_out = f'{OUT_DIR}/{slug}.ogg'
        swap_program(SRC, midi_out, prog)
        render(midi_out, ogg_out)
        size_kb = os.path.getsize(ogg_out) // 1024
        print(f"  {prog:3d}  {name:25s}  ({desc})  -> {ogg_out} ({size_kb} KB)")

    # Kick drum option
    kick_ogg = f'{OUT_DIR}/kick_drum.ogg'
    render_kick_pattern(kick_ogg)
    print(f"  ---  {'Kick Drum':25s}  (kick on 1 & 3)  -> {kick_ogg}")