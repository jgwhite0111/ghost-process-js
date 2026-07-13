"""
sprite_extractor.py — corridor android strip pipeline.

Pulls 16 evenly-spaced keyframes from `i2v_clip_android_corridor.mp4`,
removes the green-screen background using HSV chroma-keying, then
installs the result as the runtime sprite strip.

Layout (this file lives in `corridor/raw/`):
    corridor/
      raw/                          # INPUTS — source MP4 + this script
        i2v_clip_android_corridor.mp4
        sprite_extractor.py         # (this file)
        frame_001.png .. frame_141.png   # intermediate frames from MP4
        transparent_sprites/        # 16 keyed PNGs (intermediate output)
      processed/                    # OUTPUTS — runtime-loaded sprite strip
        idle_01.png .. idle_16.png  # 180x320 RGBA, what the runtime reads

Run from this directory:
    cd assets/sprites/android/corridor/raw
    python3 sprite_extractor.py

Pipeline contract:
  - Extract 16 frames evenly from source MP4 (frames 1..129, drops first
    black frame and last laser sequence).
  - HSV green-screen key: H in [35,80], S>=40, V>=40. Soft 3x3 Gaussian
    on the alpha to feather edges.
  - Rename: extracted frame_NN.png -> idle_{NN+1:02d}.png
            (frame_00 -> idle_01, frame_15 -> idle_16).
  - Resize to 180x320 with LANCZOS.
  - Backup any existing processed/ strip to /private/tmp/WT_pre_corridor_install_<ts>/
    before overwriting, so a bad install can be reverted with `cp -a`.

Deps: opencv-python (cv2), numpy, Pillow.
"""

import cv2
import numpy as np
import os
from pathlib import Path

def extract_and_key_sprites():
    video_path = "i2v_clip_android_corridor.mp4"
    output_dir = "transparent_sprites"

    # --- Configuration ---
    start_frame = 1  # Skips frame 0 (the initial black frame)
    end_frame = 130  # Stops before frame 130 (Drops the clipped laser sequence)
    desired_keyframes = 16

    # Create the output directory if it doesn't exist
    os.makedirs(output_dir, exist_ok=True)

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"Error: Could not open {video_path}")
        return

    # Calculate exactly which 16 frames to pull from the new defined range
    frame_indices = np.linspace(start_frame, end_frame - 1, desired_keyframes, dtype=int)

    current_frame = 0
    saved_count = 0

    while True:
        ret, frame = cap.read()

        # Stop if we hit the end of the video or our defined end_frame cutoff
        if not ret or current_frame >= end_frame:
            break

        if current_frame in frame_indices:
            # Convert BGR to HSV color space
            hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)

            # Define the green background bounds
            lower_green = np.array([35, 40, 40])
            upper_green = np.array([80, 255, 255])

            # Create a mask covering the green gradient
            green_mask = cv2.inRange(hsv, lower_green, upper_green)

            # Invert the mask
            sprite_mask = cv2.bitwise_not(green_mask)

            # Soften the edges of the mask
            sprite_mask = cv2.GaussianBlur(sprite_mask, (3, 3), 0)

            # Split the original frame into B, G, R channels
            b, g, r = cv2.split(frame)

            # Merge channels back together with the Alpha layer
            rgba_frame = cv2.merge([b, g, r, sprite_mask])

            # Save the final transparent PNG
            out_path = os.path.join(output_dir, f"frame_{saved_count:02d}.png")
            cv2.imwrite(out_path, rgba_frame)

            saved_count += 1

        current_frame += 1

    cap.release()
    print(f"Success. Extracted {saved_count} transparent keyframes to the '{output_dir}' folder.")

    # Install into the corridor sprite strip the runtime expects.
    install_into_corridor(output_dir)


def install_into_corridor(transparent_dir):
    """
    Rename and resize the freshly-extracted transparent_sprites/frame_NN.png
    files into the corridor sprite strip the runtime loads:
        ../corridor/idle_NN.png  (NN = 01..16)
    Pipeline contract: 180x320 RGBA, frame_00 -> idle_01.

    Backs up the existing corridor strip to /private/tmp/WT_pre_corridor_install/
    before overwriting, so a bad install can be reverted with `cp -a` from there.
    """
    from PIL import Image
    import shutil, datetime

    transparent_dir = Path(transparent_dir)
    # Script lives in <sprite>/raw/, runtime strip sits at <sprite>/processed/
    # (i.e. ../processed relative to the transparent_sprites/ folder).
    processed_dir = transparent_dir.parent / "processed"
    processed_dir.mkdir(parents=True, exist_ok=True)
    corridor_dir = processed_dir  # local alias used below

    # Backup current corridor strip (overwriting any prior backup of the same
    # day so we don't fill /tmp; older backups in the same dir are preserved).
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_dir = Path(f"/private/tmp/WT_pre_corridor_install_{ts}")
    if any(corridor_dir.glob("idle_*.png")):
        backup_dir.mkdir(parents=True, exist_ok=True)
        for f in corridor_dir.glob("idle_*.png"):
            shutil.copy2(f, backup_dir / f.name)
        print(f"Backed up existing corridor strip to {backup_dir}")

    target_size = (180, 320)
    installed = 0
    for src_path in sorted(transparent_dir.glob("frame_*.png")):
        idx = int(src_path.stem.split("_")[1])  # frame_00 -> 0
        idle_n = idx + 1                       # 0 -> idle_01
        if not (1 <= idle_n <= 16):
            continue
        dst = corridor_dir / f"idle_{idle_n:02d}.png"
        im = Image.open(src_path).convert("RGBA")
        if im.size != target_size:
            im = im.resize(target_size, Image.Resampling.LANCZOS)
        im.save(dst)
        installed += 1

    print(f"Installed {installed} sprites into {corridor_dir} at {target_size[0]}x{target_size[1]}.")


if __name__ == "__main__":
    extract_and_key_sprites()