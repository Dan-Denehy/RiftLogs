# State-context sample

Run `npm.cmd run sample:replay` to print a synthetic three-turn, 31-step replay.
It runs entirely locally without a browser, login or real match and does not change
your database. Card names are illustrative, and no image fields are used.

The viewer can import `createSampleReplay()` from `src/sampleReplay.ts` and use
`getStateAtAction(replay, sequence)` to retrieve an independent state snapshot.
Each step includes the action, predicted state, reconciled state, observation reference,
verified field paths and flags. Render `cards` as rectangles labeled with their names
(or Unknown card); group by owner and zone, and display resource counts beside players.

## Expected checkpoints

- Step 10, turn 1 end: no mismatches; rune payments preceded both card plays.
- Step 11, turn 2 start: full check and both players' turn trackers reset.
- Steps 12–16: Player Two channels, draws, pays, plays Guard and contests a battlefield.
- Step 17: Player One gains a card during Player Two's turn.
- Step 18: Player Two recycles an exhausted rune.
- Step 21, turn 2 end: flags the unit's missed trash move and detached equipment.
- Step 22, turn 3 start: flags a missed point; unavailable rune fields are marked
  unable-to-verify while the prediction remains available.
- Steps 25–27: exhaust 3, recycle 1 exhausted rune, then play Ranger; 1 rune stays ready.
- Step 31, turn 3 end: rune readings return and match the reconstructed values.
  Player One gained 3 cards this turn (including the starting draw) and recycled 1 rune.

Trackers count gains, not net hand-size changes. They reset for both players at each
new turn and retain reaction gains during the other player's turn. Draws and explicit
returns to hand count as gains; normal spending does not decrease the gained total.
Local what-if edits do not alter the recorded action trackers. The hand is displayed
as a count in the header, without an empty hand zone.

## Components

- `src/stateContext.ts`: types, targeted update policy, action reducer, observation
  comparison/reconciliation, unchanged-section detection and immutable replay lookup.
- `src/boardObservation.ts`: pure DOM reader for identity, turn context, scores,
  ready/used runes and main-deck counts, using attributes observed in the research capture.
- `server/boardObservationStore.ts`: append-only snapshot storage with safe identical
  retries and rejection of conflicting replacements.

Turn starts and ends require full-section observations in the replay builder, even
when no values changed. A selected section may contain null fields: unavailable is
different from zero or an empty card list. Card attachment null means known unattached;
unavailable attachment information should be omitted. Missing cards in a complete list
are flagged absent, not automatically declared dead.

## Current limits and next steps

This is a testable foundation and sample, not a live capture integration or complete
Riftbound rules engine. The existing log interpreter remains unchanged. Explicit sample
actions feed a small typed reducer until the normalization adapter is built.
Real DOM card/hand/attachment/readiness extraction remains unvalidated and the current
DOM reader reports cards/hand counts as unknown. The sample supplies known card states.
Observation-to-action association in the sample is explicit; live batches must not
be assigned falsely precise action timing. Unknown/rewrite/rewind handling and full
per-field evidence history require additional integration before real replay use.

## React viewer

Run `npm.cmd run dev:web` (sample needs no API), then open Vite's printed local URL.
The Sample replay view provides previous/next controls, an action selector, named card
rectangles, resources and checkpoint flags. Capture history remains available in the
top navigation; that view requires the normal API (`npm.cmd run dev`).

Enable local edits to select a card and move it with the destination dropdown or drag
it to another zone belonging to the same player. Tap/untap, undo and reset are provided.
Switching actions, leaving the view or disabling edits discards the temporary position.
This sandbox does not write captures, validate legal moves, pay costs or simulate effects.
Moving a unit to hand/trash returns attached equipment to base; a hand move adjusts
the known hand count. Readiness is shown by text and striped styling, not card rotation.

Next: integrate validated live board extraction, boundary timing and persistence
with the normal spectator recorder. The sample viewer remains available for testing.
