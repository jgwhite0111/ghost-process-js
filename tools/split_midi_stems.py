"""Split a SC-55 multi-channel MIDI into per-channel stems and render
each as a separate OGG clip via FluidSynth.

For each input MIDI:
  - Inspect all channels that have notes
  - Build a stripped MIDI per channel (only events for that channel;
    keep tempo + program changes for the target channel)
  - Render to WAV with FluidSynth using a GM soundfont
  - Encode to OGG (opus) for Telegram voice-bubble delivery
"""
import os
import sys
import subprocess
from pathlib import Path
from mido import MidiFile, MidiTrack, Message

SOUNDFONT = "/opt/homebrew/Cellar/fluid-synth/2.5.5/share/fluid-synth/sf2/VintageDreamsWaves-v2.sf2"
CLIP_SECONDS = 15
OUT_DIR = Path("/tmp/midi_stems")
OUT_DIR.mkdir(parents=True, exist_ok=True)

INPUTS = [
    "assets/audio/terminal_lab.mid",
    "assets/audio/ship_engine.mid",
]


def find_channels_with_notes(mid):
    """Return set of channels that have note_on events with velocity>0."""
    channels = set()
    for track in mid.tracks:
        for msg in track:
            if msg.type == "note_on" and msg.velocity > 0 and hasattr(msg, "channel"):
                channels.add(msg.channel)
    return sorted(channels)


def split_midi_by_channel(src_path: Path, out_dir: Path, target_channel: int) -> Path:
    """Create a new single-track MIDI containing only events for
    target_channel, plus tempo events."""
    mid = MidiFile(str(src_path))
    new_mid = MidiFile(type=mid.type, ticks_per_beat=mid.ticks_per_beat)
    new_track = MidiTrack()
    new_mid.tracks.append(new_track)
    for src_track in mid.tracks:
        for msg in src_track:
            if msg.is_meta or msg.type == "sysex":
                # Copy meta events (tempo, track name, time signature)
                new_track.append(msg.copy(time=msg.time))
                continue
            if not hasattr(msg, "channel"):
                continue
            if msg.channel == target_channel:
                new_track.append(msg.copy())
    out_path = out_dir / f"{src_path.stem}_ch{target_channel}.mid"
    new_mid.save(str(out_path))
    return out_path


def render_midi_to_ogg(midi_path: Path, out_dir: Path) -> Path:
    """Render a MIDI to a 15s opus OGG clip."""
    wav_path = out_dir / f"{midi_path.stem}.wav"
    ogg_path = out_dir / f"{midi_path.stem}.ogg"
    # Render full MIDI to WAV
    subprocess.run(
        [
            "fluidsynth",
            "-ni",
            "-F", str(wav_path),
            SOUNDFONT,
            str(midi_path),
        ],
        check=True,
        capture_output=True,
    )
    # Trim/clip to first CLIP_SECONDS, encode to opus
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i", str(wav_path),
            "-ss", "0",
            "-t", str(CLIP_SECONDS),
            "-c:a", "libopus",
            "-b:a", "64k",
            str(ogg_path),
        ],
        check=True,
        capture_output=True,
    )
    wav_path.unlink()
    return ogg_path


def describe_channel(mid, ch: int) -> str:
    """Return a short description of what channel ch does (program, role hint)."""
    prog = None
    notes = []
    for track in mid.tracks:
        for msg in track:
            if msg.type == "program_change" and msg.channel == ch:
                prog = msg.program
            if msg.type == "note_on" and msg.velocity > 0 and msg.channel == ch:
                notes.append(msg.note)
    # GM melodic program names (subset)
    gm = {
        39: "Synth Bass 1",
        88: "New Age Pad",
        89: "Warm Pad",
        90: "Poly Synth Pad",
        91: "Choir Pad",
        92: "Bowed Pad",
        93: "Metallic Pad",
        94: "Halo Pad",
        95: "Sweep Pad",
        96: "Rain",
        97: "Soundtrack",
        98: "Crystal",
        99: "Atmosphere",
        100: "Brightness",
        101: "Goblins",
    }
    role_hint = "drums (kit)" if ch == 9 else (gm.get(prog, f"prog {prog}") if prog is not None else "(no program)")
    note_summary = ""
    if notes:
        uniq = sorted(set(notes))
        if len(uniq) <= 6:
            note_summary = f" notes={uniq}"
        else:
            note_summary = f" notes={uniq[:3]}...{uniq[-1:]} ({len(uniq)} distinct)"
    return f"ch{ch} {role_hint}{note_summary}"


def main():
    for src in INPUTS:
        src_path = Path(src)
        if not src_path.exists():
            print(f"SKIP {src} (missing)")
            continue
        mid = MidiFile(str(src_path))
        channels = find_channels_with_notes(mid)
        print(f"\n=== {src} (length={mid.length:.1f}s) ===")
        stems = []
        for ch in channels:
            midi_stem = split_midi_by_channel(src_path, OUT_DIR, ch)
            ogg = render_midi_to_ogg(midi_stem, OUT_DIR)
            desc = describe_channel(mid, ch)
            print(f"  ch{ch}: {desc}  →  {ogg}")
            stems.append((ch, desc, ogg))
        # Print for the assistant to embed
        for ch, desc, ogg in stems:
            print(f"  MEDIA:{ogg}  # {desc}")


if __name__ == "__main__":
    main()
