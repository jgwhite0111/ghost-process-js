# AI-HANDOFF — ghost-process-js

## Stack

Vanilla JavaScript + InkJS + Express. No engine. No Phaser. No Godot.
No Mono. No Yarn Spinner. `~/ghost-process/` is an abandoned Godot
Mono prototype — ignore it. `LEGACY.md` has the full timeline.
`package.json`, `src/`, `index.html` are ground truth.

PC-98 / late-80s cyberpunk horror visual novel, point-and-click,
mature (no moe). See `README.md` and `AGENTS.md` §"Project intent"
+ §"Style bible".

## State (verified 2026-07-13)

```
HEAD:    0bf07b4 handoff: clarify skills constraint without deleting useful refs
Branch:  main, 47 commits ahead of origin/main
Tree:    clean
Server:  http://localhost:8765 (node server.js, pid 67650)
Python:  3.11.6 (no pip module; use `pip→python3.11` or `uv`)
```

## What's running

```
npm start          # Express on :8765
python3 tools/test_full_chain.py   # renders all 18 medleys, smoke test
```

## Music state

`story.json` ships A+B medleys per scene. Long-track experiment
(2026-07-13) was reverted — see `git log` for the 23 dropped
commits (still in reflog ~30 days; `git reset --hard 7aeffa2`
recovers them). User's verdict on the experiment: rejected, try a
different method next time.

Scene → music:
| scene        | music                                                  |
|--------------|--------------------------------------------------------|
| intro        | `intro_theme.mp3`                                      |
| cold_open    | `[cold_open.mp3, cold_open_b.mp3]`                     |
| alley        | `[alley_confrontation.mp3, alley_confrontation_b.mp3]` |
| chase        | `[chase.mp3, chase_b.mp3]`                             |
| corridor     | `[corridor.mp3, corridor_b.mp3]`                       |
| jailbreak    | `[jailbreak.mp3, jailbreak_b.mp3]`                     |
| kabukicho    | `[kabukicho.mp3, kabukicho_b.mp3]`                     |
| corp_office  | `[corp_office.mp3, corp_office_b.mp3]`                 |
| terminal_lab | `[terminal_lab.mp3, terminal_lab_b.mp3]`               |
| ship_engine  | `[ship_engine.mp3, ship_engine_b.mp3]`                 |

## Key files

- `tools/make_scene_loop.py` — 9 SCENES + 9 SCENES_B (medleys)
- `tools/render-midi.sh` — FluidSynth + sc55.sf2
- `tools/test_full_chain.py` — smoke test
- `vendor/sc55.sf2` — SC-55 soundfont
- `story.json` — scene wiring
- `src/runtime/music.js` — loads `music` as string or array
- `LEGACY.md` — abandoned projects timeline
- `SPEC.md` — architecture
- `AGENTS.md` — project rules

## Recent commits (2026-07-13)

```
0bf07b4 handoff: clarify skills constraint without deleting useful refs
ae594b7 Revert "handoff: strip skill references — user doesn't want to deal with skills"
77884c1 handoff: strip skill references — user doesn't want to deal with skills
782290d handoff: long-track music experiment reverted, new direction pending
227a1fc music: drop alf_tv scene (was orphaned, not in story.json)
b109656 music: add alley_confrontation_b medley partner
3ccf405 sprites: drop _deleted/ archives (eidolon_return + corridor scratch v7..v12)
89c6bf9 handoff: update for /new session — corridor animation fix + thug multi-pass keyer
4cb4b6f thug: halo erosion radius 1 -> 2
```

The 23 commits between `7aeffa2` and `227a1fc` were the long-track
music experiment. They're recoverable from reflog if needed.

## Open items

- Walking-bass pass on 14 remaining scenes (user undecided).
- Dialogue box vertical layout / "feet floating" — user marked
  resolved 2026-07-13 but no specific fix cited; symptom may have
  been fixed by v0.2.32 cursor-past-edge restoration.
- terminal_lab A/B duration mismatch (62s vs 81s) — design intent
  but loop boundary audible.
- `~/.hermes/state.db` FTS5 corruption recovery: run
  `sqlite3 ~/.hermes/state.db "REINDEX messages_fts"` then restart.
