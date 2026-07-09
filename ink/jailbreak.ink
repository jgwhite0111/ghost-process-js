// ink/jailbreak.ink — jail cell beat.
//
// Flow:
//   1. Player enters. Thug is ALREADY visible (no fade-in —
//      _skipFadeInScenes in scene-base handles this). He's standing
//      at the right edge of the viewport so his cut-off is hidden.
//   2. Thug delivers lines.
//   3. Player picks a real choice.
//   4. The prison-break divert auto-transitions via
//      transition_next(). NO portrait tag at the end — canvas
//      wipes on transition, no fade-out needed.
//
// No "Continue" choice anywhere.
//
// SPEAKER STYLE: this file uses no hardcoded speaker prefixes. The
// `# speaker:thug` tag drives the yellow "Thug" label in the
// dialogue panel — capitalised first letter, set by scene-base.

EXTERNAL transition_next()

-> Start

=== Start ===
# speaker:thug
# portrait:thug

Heh. Fresh meat.

*   [What's happening here?] -> Ask
*   [Break the lock] -> BreakLock

=== Ask ===
# speaker:thug

Easiest job of my life. They let you walk right in.

-> BreakLock

=== BreakLock ===
# speaker:none

The cell door clatters open.

    ~ transition_next()

-> END