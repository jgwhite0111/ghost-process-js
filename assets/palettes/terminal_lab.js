// assets/palettes/terminal_lab.js
//
// Historical RoomId alias. The Godot-era pipeline shipped terminal_lab
// pointing at lab_clinic; we replicate the alias here so any scene that
// declares `bgPalette: "terminal_lab"` still gets a valid 16-colour
// palette. Without this, the dither post-process would fall back to
// the default palette and the scene would shift hue unexpectedly.

window.PALETTES = window.PALETTES || {};

window.PALETTES.terminal_lab = window.PALETTES.lab_clinic;