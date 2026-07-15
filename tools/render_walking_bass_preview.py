"""Render previews of the new walking bass: bass-only stem, and
full-mix render, for both terminal_lab and ship_engine.

Uses the same SoundFont as the production renderer, with the
slap-bass patch already applied.
"""
import os
import subprocess
from pathlib import Path
from mido import MidiFile, MidiTrack, Message

os.chdir(Path(__file__).resolve().parent.parent)
SOUNDFONT = 'assets/audio/sc55.sf2'
OUT_DIR = '/tmp/walking_bass_preview'
os.makedirs(OUT_DIR, exist_ok=True)


def isolate_ch1(midi_path, out_path):
    """Make a copy of the MIDI with only ch 1 audible."""
    src = MidiFile(midi_path)
    out = MidiFile(type=src.type, ticks_per_beat=src.ticks_per_beat)
    for track in src.tracks:
        new_track = MidiTrack()
        for msg in track:
            if hasattr(msg, 'channel') and msg.channel != 1:
                # Zero out notes on other channels
                if msg.type == 'note_on' and msg.velocity > 0:
                    new_track.append(msg.copy(velocity=0))
                else:
                    new_track.append(msg)
            else:
                new_track.append(msg)
        out.tracks.append(new_track)
    out.save(out_path)


def render(midi_path, ogg_path):
    wav_path = ogg_path.replace('.ogg', '.wav')
    subprocess.run(
        ['fluidsynth', '-F', wav_path, '-q', SOUNDFONT, midi_path],
        check=True, capture_output=True,
    )
    subprocess.run(
        ['ffmpeg', '-y', '-loglevel', 'error',
         '-i', wav_path, '-c:a', 'libopus', '-b:a', '64k', ogg_path],
        check=True, capture_output=True,
    )
    os.remove(wav_path)


if __name__ == '__main__':
    for scene in ['terminal_lab', 'ship_engine']:
        src = f'assets/audio/{scene}.mid'

        # Full mix
        full_ogg = f'{OUT_DIR}/{scene}_fullmix.ogg'
        render(src, full_ogg)
        print(f"  {full_ogg} ({os.path.getsize(full_ogg)} bytes)")

        # Bass-isolated
        iso_mid = f'{OUT_DIR}/{scene}_bassonly.mid'
        isolate_ch1(src, iso_mid)
        iso_ogg = f'{OUT_DIR}/{scene}_bassonly.ogg'
        render(iso_mid, iso_ogg)
        print(f"  {iso_ogg} ({os.path.getsize(iso_ogg)} bytes)")

    print("Done.")
