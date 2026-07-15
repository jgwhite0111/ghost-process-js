"""Swap the bass patch on all 6 walking-bass scenes to a target program.

Usage:
  python3 tools/apply_bass_patch.py 34    # Picked Bass
  python3 tools/apply_bass_patch.py 35    # Fretless Bass
  python3 tools/apply_bass_patch.py 43    # Contrabass
  python3 tools/apply_bass_patch.py 87    # Lead 6 Voice
"""
import os
import subprocess
import sys
from pathlib import Path
from mido import MidiFile

os.chdir(Path(__file__).resolve().parent.parent)

SCENES = [
    'terminal_lab', 'ship_engine',
    'alley_confrontation', 'clinic_tension',
    'cold_open', 'ship_engine_b',
]
BASS_CHANNEL = 1

PATCH_NAMES = {
    34: 'Picked Bass',
    35: 'Fretless Bass',
    43: 'Contrabass',
    87: 'Lead 6 (Voice)',
}


def apply_patch(midi_path, new_prog):
    mid = MidiFile(midi_path)
    for track in mid.tracks:
        for msg in track:
            if msg.type == 'program_change' and msg.channel == BASS_CHANNEL:
                msg.program = new_prog
    mid.save(midi_path)


if __name__ == '__main__':
    new_prog = int(sys.argv[1])
    name = PATCH_NAMES.get(new_prog, f'prog {new_prog}')
    for scene in SCENES:
        apply_patch(f'assets/audio/{scene}.mid', new_prog)
        print(f"  patched {scene} -> {name} ({new_prog})")
    print(f"Re-rendering {len(SCENES)} MP3s with {name}...")
    for scene in SCENES:
        subprocess.run(
            ['./tools/render-midi.sh', f'assets/audio/{scene}.mid'],
            check=True, capture_output=True,
        )
    print("Done.")