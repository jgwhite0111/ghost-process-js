// ink/corridor.ink — corridor beat.
//
// Flow:
//   1. Player enters. Android is INVISIBLE (no portrait tag yet) and
//      the energy-ball sprite is not animating.
//   2. Narration runs first ("The corridor pulses..."), then
//      `# portrait:android` fades the android in.
//   3. The android's talking lines render. The energy ball keeps
//      animating continuously (no speaker:none freeze — see
//      _ambientAnimateScenes in scene-base).
//   4. Player picks Ask or PullAway. PullAway auto-transitions to
//      jailbreak via transition_next(). NO portrait tag at the end —
//      canvas wipes on transition, no fade-out needed.
//
// No "Continue" choice anywhere.

EXTERNAL transition_next()

-> Start

=== Start ===
# speaker:none

The corridor pulses. A glow gathers in the dark ahead of you.

# portrait:android
# speaker:android

You don't have to do this alone.

*   [Ask for help] -> Ask
*   [Pull away] -> PullAway

=== Ask ===
# speaker:android

Then trust me.

-> PullAway

=== PullAway ===
# speaker:none

You pull away. The glow follows.

    ~ transition_next()

-> END