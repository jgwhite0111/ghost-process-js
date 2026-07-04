// ink/alley.ink — first playable scene
// Skeletal text for the v1 prototype. The android sprite is positioned "right" and should mouth-animate when speaker is ANDROID.

EXTERNAL return_to_alley()

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

// Player runs. Scene ends.

You bolt. The alley blurs. Footsteps — yours and something else.

~ return_to_alley()
