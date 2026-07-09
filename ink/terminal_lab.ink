// ink/terminal_lab.ink — underground tunnel beat.
//
// Flow:
//   1. Player enters with the android already in tow. Android is
//      INVISIBLE at first (no portrait tag yet) — the descent is
//      narrated first, then the android speaks from the dark.
//   2. The android reveals they came down here looking for something.
//      Player picks a real choice. Each choice branches to a different
//      ending line but both forward-transition.
//   3. NO portrait tag at the end — canvas wipes on transition.
//
// Tone: cables hum, the walls breathe. The android is matter-of-fact,
// almost bored — they've been down here before. The tension is in what
// they ARE looking for, not whether they'll find it.
//
// SPEAKER STYLE: this file uses no hardcoded speaker prefixes.

EXTERNAL transition_next()

-> Start

=== Start ===
# speaker:none

The tunnels descend. Cables thick as your arm hang from the ceiling. A red glow pulses at the far end.

# portrait:android
# speaker:android

I came down here to find what they hid.

*   [What did they hide?] -> WhatHid
*   [Why bring me?] -> WhyMe

=== WhatHid ===
# speaker:android

The list. You were on it.

    ~ transition_next()

-> END

=== WhyMe ===
# speaker:android

Because you're still on it.

    ~ transition_next()

-> END