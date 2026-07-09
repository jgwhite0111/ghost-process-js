// ink/ship_engine.ink — engine room beat (climax).
//
// Flow:
//   1. Player enters. The hooded figure (THUG) is ALREADY visible at
//      the right edge — same setup as the jailbreak scene, no fade-in.
//      The android is INVISIBLE.
//   2. The hooded figure speaks first. Then the android appears.
//   3. Player picks a real choice: side with the android, or with
//      the figure. Both choices forward-transition but to DIFFERENT
//      scenes — that's the first real branch in the chain.
//   4. NO portrait tag at the end — canvas wipes on transition.
//
// Tone: two voices, both tired, both have done this before. The
// player is in the middle of something larger than they know.
//
// The hooded figure is the same character as the jailbreak thug —
// same speaker tag, same sprite. Keeping him consistent across
// scenes reinforces that he's been tracking the player the whole time.
//
// SPEAKER STYLE: this file uses no hardcoded speaker prefixes.

EXTERNAL transition_next()

-> Start

=== Start ===
# speaker:thug
# portrait:thug

You brought them here. I didn't expect that.

# speaker:android
# portrait:android

Step away from the console.

*   [Side with the android] -> SideAndroid
*   [Step back from both] -> StepBack

=== SideAndroid ===
# speaker:android

Now close the door behind you.

    ~ transition_next()

-> END

=== StepBack ===
# speaker:none

You don't belong to either of them.

    ~ transition_next()

-> END