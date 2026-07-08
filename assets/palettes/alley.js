// assets/palettes/alley.js
//
// PC-98 16-colour scene palette for the alley chase and backstreet scenes.
// Slot map (matches the canonical slot definitions in SPEC.md / assets/palettes/*.js):
//   [0..5]   LIGHTING — varies per scene
//   [6..10]  IDENTITY — stable across all scenes (sash, hair, gold, skin, scar)
//   [11..13] ACCENT  — varies per scene (neon, warning, alert)
//   [14]     DARK    — near-black, stable
//   [15]     LIGHT   — near-white, stable
//
// The runtime dither post-process in src/runtime/canvas.js snaps every
// background pixel to the nearest colour in this 16-entry table. Keeping
// the IDENTITY slots stable means the android (captain) reads as the same
// character in every scene.

window.PALETTES = window.PALETTES || {};

window.PALETTES.alley = [
    // LIGHTING — cool, dark, wet
    [ 12,  16,  36],   // 0  BG_deep     wet cobblestone in shadow
    [ 28,  44,  72],   // 1  BG_mid      wet cobblestone lit
    [ 52,  72, 108],   // 2  BG_lit      cobblestone hit by neon
    [  8,  10,  22],   // 3  SHADOW      form shadow
    [ 32,  36,  56],   // 4  AMBIENT     navy coat base
    [ 44,  60,  92],   // 5  FOG         rain haze
    // IDENTITY — stable across scenes
    [204,  32,  32],   // 6  sash_red
    [140,  16,  16],   // 7  sash_red_dk
    [236, 232, 224],   // 8  beard_white
    [204, 168,  60],   // 9  gold        epaulettes, medals
    [220, 200, 184],   // 10 skin_pale
    [168,  40,  40],   // 11 scar_red
    // ACCENT — neon
    [220,  60, 200],   // 12 magenta neon
    [ 80, 220, 240],   // 13 cyan neon
    // DARK / LIGHT
    [ 16,  16,  24],   // 14 near_black
    [252, 252, 248],   // 15 near_white
];