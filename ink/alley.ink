// ink/alley.ink — first playable scene.
//
// Flow:
//   1. Player enters alley. Android is INVISIBLE (no portrait tag yet).
//   2. Ink shows narration only; no choices are presented — the runner
//      hits onComplete and the dialogue box sits on the last line.
//   3. Player MUST click the bins hitbox on the canvas. That click:
//        a) flies the rusty key into the inventory (visual feedback),
//        b) tells scene-base to redirect the Ink runner to FoundKey,
//           where the android fade-in + dialogue beat lives.
//   4. FoundKey fires `# portrait:android` + `# speaker:android` —
//      scene-base fades the android in and starts the talking anim.
//      The android keeps talking through the choice wait (see
//      _keepAnimatingAtChoices in scene-base) and only stops when
//      the scene transitions.
//   5. After android's lines, player picks AskWhy or Run. Run
//      diverts to the next scene via transition_next().
//
// No "Continue" choice anywhere — the only choices are real branches
// (AskWhy vs Run).
//
// SPEAKER STYLE: this file uses no hardcoded speaker prefixes. The
// `# speaker:android` tag drives the yellow "Android" label in the
// dialogue panel — capitalised first letter, set by scene-base.
// Narration lines use `# speaker:none` to clear the label.

EXTERNAL transition_next()

-> Start

=== Start ===
# speaker:none

You round the bins. The alley smells of rust and ozone. Something is off — the silence has weight. Something glints by the bins.

-> END

=== FoundKey ===
# portrait:android
# speaker:android

The android steps from the shadow of the bins.

You shouldn't be here.

*   [Ask why] -> AskWhy
*   [Run] -> Run

=== AskWhy ===
# speaker:android

Because you came back.

-> Run

=== Run ===
# speaker:none

You bolt. The alley blurs. Footsteps — yours and something else.

    ~ transition_next()

-> END