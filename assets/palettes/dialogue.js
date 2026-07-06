// assets/palettes/dialogue.js
//
// Default UI palette for dialogue box and HUD. Stable across all scenes
// so text is always readable. NOT used for backgrounds — backgrounds
// use the per-scene palette. This one is reserved if a future scene
// needs an at-rest UI plate.

window.PALETTES = window.PALETTES || {};

window.PALETTES.dialogue = [
    // LIGHTING — UI
    [ 20,  16,  28],   // 0  BG_deep     dialogue box border
    [ 36,  28,  48],   // 1  BG_mid      dialogue box fill
    [ 56,  44,  72],   // 2  BG_lit      dialogue highlight
    [  8,   4,  12],   // 3  SHADOW      text shadow
    [ 28,  20,  40],   // 4  AMBIENT     form shadow
    [ 44,  32,  60],   // 5  FOG         dim
    // IDENTITY
    [204,  32,  32],   // 6  sash_red
    [140,  16,  16],   // 7  sash_red_dk
    [236, 232, 224],   // 8  beard_white
    [204, 168,  60],   // 9  gold
    [220, 200, 184],   // 10 skin_pale
    [168,  40,  40],   // 11 scar_red
    // ACCENT — UI
    [240, 220, 100],   // 12 cursor / selection
    [180, 100, 220],   // 13 hover / link
    [ 16,  16,  24],   // 14 near_black
    [252, 252, 248],   // 15 near_white
];