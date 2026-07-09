"""Mix-minus previews: render terminal_lab + ship_engine with each
"annoying" channel muted, so the user can hear which one is actually
the problem.

For each scene, we produce 3 previews:
  - bass_muted.mid   : ch 1 (Synth Bass 2) silenced
  - fxpad_muted.mid  : ch 2 (Goblins / Brightness) silenced
  - both_muted.mid   : both ch 1 and ch 2 silenced

Plus the original is kept from the prior preview batch.
"""
import os
import subprocess
from mido import MidiFile, MidiTrack

os.chdir('/Users/jwhite/ghost-process-js')
SOUNDFONT = 'assets/audio/sc55.sf2'
OUT_DIR = '/tmp/mix_minus'
os.makedirs(OUT_DIR, exist_ok=True)


def mute_channel(midi_path, out_path, channels_to_mute):
    """Mute the given channels in the MIDI by replacing their note_on
    velocities with 0 (silent note). CC and program_change are kept
    so the channel still "exists" but produces no sound."""
    src = MidiFile(midi_path)
    out = MidiFile(type=src.type, ticks_per_beat=src.ticks_per_beat)
    for track in src.tracks:
        new_track = MidiTrack()
        for msg in track:
            if msg.type == 'note_on' and msg.channel in channels_to_mute:
                if msg.velocity > 0:
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
        for label, muted in [
            ('bass_muted',   {1}),          # drop ch 1 (Synth Bass 2)
            ('fxpad_muted',  {2}),          # drop ch 2 (Goblins/Brightness)
            ('both_muted',   {1, 2}),       # drop both
        ]:
            out = f'{OUT_DIR}/{scene}_{label}.mid'
            mute_channel(src, out, muted)
            ogg = f'{OUT_DIR}/{scene}_{label}.ogg'
            render(out, ogg)
            print(f"  {ogg} ({os.path.getsize(ogg)} bytes)")
    print("Done.")
