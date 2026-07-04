// ink/alley.ink — first playable scene
// Skeletal text for the v1 prototype. The android sprite is positioned "right" and should mouth-animate when speaker is ANDROID.
// Loops to chase (next scene in the v0.98 narrative flow) via EXTERNAL transition_next().

EXTERNAL return_to_alley()
EXTERNAL transition_next()

-> Start

=== Start ===
# portrait:android
# speaker:android

// Placeholder. The player has just entered the alley.

The android steps from the shadow of the bins.

ANDROID: You shouldn't be here.

*   [Ask why] -> AskWhy
*   [Run] -> Run

=== AskWhy ===
# speaker:android

// Player asks why the android is here.

ANDROID: Because you came back.

*   [Continue] -> Run

=== Run ===
# speaker:none

// Player runs. Scene ends. Hands off to chase.

You bolt. The alley blurs. Footsteps — yours and something else.

* [Continue] -> EndRun

=== EndRun ===
    ~ transition_next()
