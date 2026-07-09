// ink/chase.ink — running sequence.
//
// Flow:
//   1. Player is fleeing the alley. The android is talking — its
//      dialogue is the chase narration. No portrait "fade-in" needed
//      because the android is already visible at scene start.
//   2. After the android's lines, Ink fires # speaker:none for the
//      final narration so the talking animation stops (last beat is
//      narrator-only). NO portrait tag — the canvas wipes on
//      transition_next() so there's no fade-out needed.
//   3. Player picks a real choice (KeepRunning vs SlowDown).
//   4. SlowDown auto-transitions to corridor via transition_next().
//
// No "Continue" choice anywhere — only real branches.

EXTERNAL transition_next()

-> Start

=== Start ===
# speaker:android
# portrait:android

You won't make it.

# speaker:none

The alley narrows. Your lungs burn.

# speaker:android

I can help you. If you stop.

*   [Keep running] -> Running
*   [Slow down] -> SlowDown

=== Running ===
# speaker:android

You're wasting my time.

-> SlowDown

=== SlowDown ===
# speaker:none

Your legs give out. The android catches your arm.

    ~ transition_next()

-> END