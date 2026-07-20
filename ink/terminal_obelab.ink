// terminal_obelab.ink — brief "you walked up to the terminal" beat.
//
// Two navigation paths:
//   - [Access terminal] choice (or the ACCESS TERMINAL hitbox) routes
//     to the terminal_ui scene via the target on the hitbox.
//   - [Walk away] choice (or the walk-away hitbox) routes to
//     exploration_demo via the same target mechanism.
//
// This scene itself stays atmospheric — short Ink prompt + the BG
// showing the CRT in the lab.

EXTERNAL transition_next()

-> Start

=== Start ===
# speaker:none

The monitor hums to life. Cables thick as your arm run from the back of the CRT into the wall. The screen is dim teal, awaiting input.

* [Access terminal] -> access
* [Walk away] -> exit

-> END

=== access ===
# speaker:none

You lean in. The cursor blinks once.

-> END

=== exit ===
# speaker:none

You step back from the desk.

~ transition_next()

-> END