// src/pc98-shader.js — PC-98 visual effects hook
//
// Currently a no-op stub. The two PC-98 visual signatures are:
//   1. Dither + 16-color palette quantization — handled by Phaser's
//      pixelArt mode + pre-baked palette structure in the source PNGs.
//   2. Interlaced scanlines — applied as a DOM overlay in styles.css
//      (.scanline-overlay) so we don't pay the GPU cost of a custom
//      fragment shader.
//
// If we ever need shader-level effects (color-accurate palette quant,
// Bayer dither, CRT curvature), they would live here as a Phaser
// PostFXPipeline class registered as window.PC98Pipeline.
//
// See assets/audio/README.md § "Why pre-render MIDIs at all" for the
// project notes on audio alternatives — same pattern applies here:
// the DOM overlay is the cheap path, the shader is the precise path,
// both are valid depending on the visual fidelity target.

window.PC98Pipeline = null;