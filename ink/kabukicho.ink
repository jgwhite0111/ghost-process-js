// ink/kabukicho.ink — neon district beat.
//
// Flow:
//   1. Player arrives in Kabukicho. Android is INVISIBLE (no portrait
//      tag yet). Narration runs first.
//   2. Player must click the vendor hitbox on the canvas to interact
//      with a contact. That click flies a datacard into the inventory
//      and redirects Ink into ContactMade, where the android fades in.
//   3. Android delivers a warning line, then offers a real choice.
//   4. Each choice diverts to the next scene via transition_next().
//      NO portrait tag at the end — canvas wipes on transition.
//
// Tone matches the existing ink files: terse, second-person, the
// android is brief and dangerous, never over-explains.
//
// SPEAKER STYLE: this file uses no hardcoded speaker prefixes. The
// `# speaker:android` tag drives the yellow "Android" label in the
// dialogue panel — capitalised first letter, set by scene-base.

EXTERNAL transition_next()

-> Start

=== Start ===
# speaker:none

The rain picks up. Neon bleeds across the wet asphalt — red, cyan, white. A vendor stall glows ahead. He knows you're coming.

-> END

=== ContactMade ===
# portrait:android
# speaker:android

You weren't followed.

The contact gave me this.

*   [Trust the contact] -> Trust
*   [Question the contact] -> Question

=== Trust ===
# speaker:android

Good. We move.

    ~ transition_next()

-> END

=== Question ===
# speaker:android

They're not the enemy. We're all just trying to leave.

    ~ transition_next()

-> END