"""Replace Synth Bass 2 (prog 39) with Slap Bass 1 (prog 36) on
channel 1 of terminal_lab.mid and ship_engine.mid.

Operates on the real .mid files in assets/audio/, then triggers
tools/render-midi.sh to regenerate the .mp3s.
"""
import os
import subprocess
from mido import MidiFile, MidiTrack

os.chdir('/Users/jwhite/ghost-process-js')
TARGETS = ['terminal_lab', 'ship_engine']
OLD_PROG = 39   # Synth Bass 2
NEW_PROG = 36   # Slap Bass 1


def swap_bass(midi_path):
    mid = MidiFile(midi_path)
    for track in mid.tracks:
        for msg in track:
            if msg.type == 'program_change' and msg.channel == 1 and msg.program == OLD_PROG:
                msg.program = NEW_PROG
    mid.save(midi_path)
    print(f"  patched ch 1 prog in {midi_path}")


if __name__ == '__main__':
    for scene in TARGETS:
        swap_bass(f'assets/audio/{scene}.mid')
    print("Re-rendering MP3s...")
    subprocess.run(['./tools/render-midi.sh'], check=True)
    print("Done.")
