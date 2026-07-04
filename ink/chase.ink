// ink/chase.ink — ported from ghost-process-98.
// Three v0.98 endings kept as real Ink branches with player buttons.
// v1 conflates all three into corridor via transition_next(); v1.5
// can route each branch to a distinct scene.

EXTERNAL transition_next()

-> Start

=== Start ===
# portrait:android

# speaker:none
You round the corner. Your lungs burn. Behind you, footsteps that do not sound like feet.

# speaker:none
NORA: ...Down. Behind the bins. Don’t breathe.

# speaker:none
The alley narrows. Steam hisses from a broken pipe. Ahead, a single door, lit from within.

# speaker:none
And between you and the door: a figure.

# speaker:none
Tall. Too tall. Silver hair down to a breastplate of tarnished medals. Eyes like two red pinpricks in a face that has not blinked in a very long time.

# speaker:none
NORA: ...Jesus.

# speaker:none
It is not looking at you. It is looking at the other one. The kid. Crouched behind the second bin, hands over their ears, shaking.

# speaker:none
NORA: ...Kid. Don’t move. Don’t—

# speaker:none
The figure tilts its head. One slow mechanical degree. Listening.

# speaker:android
ANDROID: You should know better than to think you can hide from me behind a bin.

# speaker:android
ANDROID: Three weeks off the island and you crawl back to the city like it will protect you. The camp made you. The camp owns you.

# speaker:android
ANDROID: The other children learned. You will too.

# speaker:none
The light from the door falls across it. Across the medals. Across the rows of teeth, bared in something that is not a smile.

# speaker:none
You do not remember closing your eyes. When you open them, the alley is empty. The kid is gone. The figure is gone. The door is dark.

# speaker:none
NORA: ...

# speaker:none
NORA: ...I have to get out of here.

* [Run] -> Run
* [Stay] -> Stay
* [Raise hand] -> RaiseHand

=== Run ===
    ~ transition_next()

=== Stay ===
    ~ transition_next()

=== RaiseHand ===
    ~ transition_next()
