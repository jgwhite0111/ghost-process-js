"""Swap the bass patch on all 6 walking-bass scenes from Slap Bass 1
(prog 36) to Fingered Bass (prog 33), then re-render the MP3s.

Operates on the .mid files in assets/audio/. Idempotent: re-running
is safe.
"""
import os
import subprocess
from mido import MidiFile, MidiTrack, Message

os.chdir('/Users/jwhite/ghost-process-js')

SCENES = [
    'terminal_lab', 'ship_engine',
    'alley_confrontation', 'clinic_tension',
    'cold_open', 'ship_engine_b',
]
OLD_PROG = 36   # Slap Bass 1
NEW_PROG = 33   # Fingered Bass
BASS_CHANNEL = 1


def swap_patch(midi_path):
    mid = MidiFile(midi_path)
    for track in mid.tracks:
        for msg in track:
            if msg.type == 'program_change' and msg.channel == BASS_CHANNEL and msg.program == OLD_PROG:
                msg.program = NEW_PROG
    mid.save(midi_path)
    print(f"  patched ch 1 prog in {midi_path}")


if __name__ == '__main__':
    for scene in SCENES:
        swap_patch(f'assets/audio/{scene}.mid')
    print("Re-rendering MP3s...")
    for scene in SCENES:
        subprocess.run(
            ['./tools/render-midi.sh', f'assets/audio/{scene}.mid'],
            check=True, capture_output=True,
        )
    print("Done.")
