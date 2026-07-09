// ink/corp_office.ink — flashback beat.
//
// Flow:
//   1. Player enters the corp office. Android is INVISIBLE.
//   2. The android fades in mid-narration, speaking as if from memory.
//      The dialogue is short on purpose — the visual sells the
//      nostalgia; the words only frame it.
//   3. Player picks a real choice. The choice matters but the scene
//      does not branch the chain — both paths lead forward via
//      transition_next() with different android lines.
//   4. NO portrait tag at the end — canvas wipes on transition.
//
// Tone: the android is tired here, not threatening. This is the
// quietest beat in the game. The cold-open-style moment that hints
// at the world before everything went wrong.
//
// SPEAKER STYLE: this file uses no hardcoded speaker prefixes.

EXTERNAL transition_next()

-> Start

=== Start ===
# speaker:none

The office is empty. The city glows green through the window. A chair, still turned from where someone left.

# portrait:android
# speaker:android

I sat at that desk for nine years.

*   [What went wrong?] -> WhatWrong
*   [Why did you leave?] -> WhyLeft

=== WhatWrong ===
# speaker:android

I filed the wrong report. They came for me at sunrise.

    ~ transition_next()

-> END

=== WhyLeft ===
# speaker:android

I didn't. I was removed.

    ~ transition_next()

-> END