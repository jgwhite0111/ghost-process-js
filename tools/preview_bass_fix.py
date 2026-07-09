"""Preview 'what if we changed the bass' for terminal_lab + ship_engine.

Generates two preview MIDI files (one per scene) with the bass channel
patched, renders them with FluidSynth, encodes to OGG for A/B listen.

Mutations:
  - ship_engine: thin ch 1 — keep accent notes (38) every 8 hits,
    drop the constant 26s that hammer a single D1.
  - terminal_lab: swap ch 1 patch (Synth Bass 2 prog 39) to Fingered
    Bass (prog 33). Pattern is left intact.

The originals are NEVER touched — these are written to /tmp/.
"""
import os
import subprocess
from mido import MidiFile, MidiTrack, Message

os.chdir('/Users/jwhite/ghost-process-js')
SOUNDFONT = 'assets/audio/sc55.sf2'
OUT_DIR = '/tmp/bass_preview'
os.makedirs(OUT_DIR, exist_ok=True)


def thin_ship_engine_bass():
    """ship_engine.mid: keep ONLY the D2 accent notes (38), drop
    every single D1 (26). Result: the bass is silent most of the
    time and only punctuates on the D2 accents. Truly intermittent."""
    src = MidiFile('assets/audio/ship_engine.mid')
    out = MidiFile(type=src.type, ticks_per_beat=src.ticks_per_beat)
    for track in src.tracks:
        new_track = MidiTrack()
        for msg in track:
            if msg.type == 'note_on' and msg.channel == 1 and msg.velocity > 0:
                if msg.note == 38:
                    new_track.append(msg)  # keep accent
                elif msg.note == 26:
                    pass  # drop the constant D1 hammer
                else:
                    new_track.append(msg)
            else:
                new_track.append(msg)
        out.tracks.append(new_track)
    out.save(f'{OUT_DIR}/ship_engine.mid')
    print(f"  wrote {OUT_DIR}/ship_engine.mid")


def swap_terminal_lab_patch():
    """terminal_lab.mid: swap ch 1 from Synth Bass 2 (prog 39) to
    Fingered Bass (prog 33) AND thin the pulse so the B/F# alt
    becomes sparse — only every 4th hit survives. Pattern + patch
    both change."""
    src = MidiFile('assets/audio/terminal_lab.mid')
    out = MidiFile(type=src.type, ticks_per_beat=src.ticks_per_beat)
    for track in src.tracks:
        new_track = MidiTrack()
        kept = 0
        for msg in track:
            if msg.type == 'program_change' and msg.channel == 1:
                # Fingered Bass = MIDI prog 33 (display 34)
                new_track.append(msg.copy(program=33))
            elif msg.type == 'note_on' and msg.channel == 1 and msg.velocity > 0:
                # Keep only every 4th bass hit. Truly intermittent.
                if kept % 4 == 0:
                    new_track.append(msg)
                kept += 1
            else:
                new_track.append(msg)
        out.tracks.append(new_track)
    out.save(f'{OUT_DIR}/terminal_lab.mid')
    print(f"  wrote {OUT_DIR}/terminal_lab.mid")


def render(midi_path, ogg_path):
    wav_path = ogg_path.replace('.ogg', '.wav')
    subprocess.run(
        ['fluidsynth', '-F', wav_path, '-q',(SOUNDFONT), midi_path],
        check=True, capture_output=True,
    )
    subprocess.run(
        ['ffmpeg', '-y', '-loglevel', 'error',
         '-i', wav_path, '-c:a', 'libopus', '-b:a', '64k', ogg_path],
        check=True, capture_output=True,
    )
    os.remove(wav_path)


if __name__ == '__main__':
    print("Thinning ship_engine bass...")
    thin_ship_engine_bass()
    print("Swapping terminal_lab bass patch...")
    swap_terminal_lab_patch()

    print("Rendering previews...")
    for stem in ['ship_engine', 'terminal_lab']:
        render(f'{OUT_DIR}/{stem}.mid', f'{OUT_DIR}/{stem}.ogg')
        size = os.path.getsize(f'{OUT_DIR}/{stem}.ogg')
        print(f"  {OUT_DIR}/{stem}.ogg ({size} bytes)")

    print("Done.")
