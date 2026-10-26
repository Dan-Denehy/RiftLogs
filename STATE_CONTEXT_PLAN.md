# v0.2.0: State context and match replay

Baseline: released v0.1.0. Replay release branch: `release/replay-v0.2.0`.
The narrowed release scope and approval gates are in [REPLAY_RELEASE.md](REPLAY_RELEASE.md).
The broader roadmap below remains reference material, not a requirement to finish
statistics or full simulation before the replay-only release.
Status: observational replay prototype implemented; release work remains. Keep package version at 0.1.0
until the new milestone passes its release checks.

## Product outcome

Open a recorded game, select an action, and see both players' board context with
card images. Previous/next controls change the selected action and restore its
reconstructed state: cards, locations, resources, scores and known hand information.
Unknown identities remain card backs. Uncertain intermediate states are labeled.
The aim is faithful reconstruction of observable match state, not a rules engine
that can simulate arbitrary future moves.

Full match recreation with card images is the sharing milestone. A dedicated
security review belongs before sharing, after that milestone is reached.

## Existing foundation

- Spectator login/profile, room joining and ordered raw action recording.
- SQLite history, card/player catalogs, matches and match participants.
- Prototype interpreter for points, units, equipment, hidden cards and rune checkpoints.
- Per-match Atlas player ID observations; account-wide identity is unproven.
- Full-DOM research capture and a sampled DOM catalog from a complete Bo3.

Research reference (local, excluded from Git):
`logs/full-log-capture/review-bo3/MATCH-DATA-MAP.md` and `dom-field-catalog.json`.
Copy minimal relevant examples into sanitized fixtures so tests do not depend on
the multi-gigabyte research file or its presence on another developer's machine.

## Data flow

RiftAtlas DOM -> raw actions + compact raw board observations -> SQLite
-> versioned normalization -> state at each timeline step -> React replay.

Raw observations are immutable evidence. Corrections and inferred state are separate.
Every normalized fact should retain a source observation/action reference.

## Phase 1: Validate fields and define the capture format

- Define TypeScript types and runtime validation for a versioned observation format.
- Record capture timestamp, ordered sequence, room/game context, source URL and
  available authoritative sequence/reset metadata.
- Map self/opponent to observed IDs and names per snapshot, never to fixed names/colors.
- Extract scores, phase, active player, turn, ready/used runes and deck counts.
- Extract actual card instances: ID, visible name/artwork, owner and zone.
- Preserve hidden status and raw rotation/counter values without guessing semantics.
- Missing means unknown; missing fields must not become zero or empty zones.

Evidence: room/player/score fields, rune counts, pile counts, card IDs, zone ownership
and chain fields were observed. Hand counting, rotation as exhaustion, equipment
relationships, battlefield control and counter semantics need focused validation.

Acceptance: small fixtures demonstrate both perspectives, duplicate card names,
hidden cards, missing values and changing rooms. Extracted facts match the fixtures.

## Phase 2: Compact live recording

- Add board observation capture to the normal spectator command.
- Save an initial observation, then relevant changes; unchanged state and animation-only
  changes must not produce duplicate board records.
- Coalesce DOM update bursts with a bounded delay so continuous changes cannot starve capture.
- Keep all legitimate ordered actions, including repeated identical draws/passes.
- Attach observation boundaries to action ranges when exact alignment is unavailable.
- Reinstall observation after navigation and retain setup/non-turn phases.
- Flush pending observations on normal stop; report when the browser closes too early.

Acceptance: a local browser fixture covers initial capture, bursts, repeated actions,
perspective change, reload and shutdown. A real-match trial compares selected board
checkpoints and measures bytes/minute, observation count and recording overhead.
Do not promise a storage reduction factor before measuring it.

## Phase 3: Persistence and normalization

- Add raw board-observation storage and normalized turns/actions/card-instance state.
- Introduce explicit, repeatable schema migrations for existing databases; changing
  CREATE TABLE IF NOT EXISTS does not upgrade an existing table.
- Scope a card instance to a game; catalog card identity is separate from physical copies.
- Preserve unknown actor ownership instead of inheriting the turn player.
- Support one capture containing multiple games. The current unique capture-to-match
  relationship must evolve before treating a Bo3 capture as three normalized games.
- Use room/game/setup evidence for boundaries; reset-token changes alone are insufficient.
- Make reprocessing transactional and repeatable without duplicating events or losing corrections.
- Expose ordered timeline/context through the API; load large histories in bounded chunks.

Acceptance: upgrade an existing v0.1.0 database fixture; prove raw bytes and corrections
survive, reruns reuse identities, and repeated events remain distinct. Older captures
without board observations retain their existing history behavior with limited context.

## Phase 4: Reconstruction and reconciliation

- Use board observations as checkpoints alongside the action interpreter.
- Restore previous states for backward navigation rather than reverse every effect.
- Track distinct unit/card instances, locations, resources, score and revealed identities.
- Validate hand counts, readiness and attachments before displaying them as confirmed.
- Use chain ownership/order to separate resolving effects from cards on the board or in trash.
- Handle rewinds and manual corrections without changing raw evidence.
- Label state facts as observed, inferred, corrected or unknown, with source references.
- Do not leak later reveals into an earlier hidden state by default.
- Never infer death from disappearance alone or assign a later snapshot to every preceding action.

Acceptance: fixture timelines cover moves, ambiguous trash, multiple identical units,
equipment, hidden/revealed cards, exhaustion/recycling, reactions, holds, rewinds and
multiple actions between observations. Forward then backward returns the expected state.

## Phase 5: Replay interface

- Two player areas, base and battlefields, scores, runes, deck/hand counts and chain.
- Card images from observed artwork references, with card-back and unavailable-image fallbacks.
- Action list, selected-action indicator and previous/next controls; optional turn jumps.
- Display confidence/missing-context information beside affected facts.
- Preserve the existing event-log view for inspecting the evidence.
- Reveal/correction inputs build on existing support; broader private-information forms
  can follow without blocking replay of observable state.

Acceptance: manually compare representative early/middle/late checkpoints from a real
game against captured evidence. Check both perspectives, hidden cards, image failures,
first/last navigation and a partially captured game. Run a local browser UI check.

## Release checks

- Relevant tests, TypeScript checking and production build pass.
- Existing recordings still open; all schema upgrades are tested.
- A complete new capture can be browsed action by action with card images and context.
- Known gaps are visible, not silently converted into certainty.
- Publish v0.2.0 only after the state-context/replay acceptance criteria are reviewed.

## Following work

- Automatic result detection with evidence and correction support, including concessions.
- Series results and a Bo3/Bo5 interface; game separation is required earlier for correct replay.
- Full card catalog import with rules text/printings and a verified data source.
- Comprehensive post-match private-information entry.
- Statistics: average first-play turn, game win rates when played/by timing,
  sample counts and incomplete-capture filtering; distinguish games from series.

## Current implementation checkpoint

### Next replay improvements

- Implemented: capture names from board marker image alt text keyed by battlefield
  zone. Replay headings, accessible labels and move controls use those names; missing
  or ambiguous names fall back to Battlefield A/B. Older captures need re-extraction
  from their original full DOM to gain names; saved raw observations are not rewritten.
- Keep observations as internal state checkpoints; hide them from normal action
  navigation and expose them in debugging mode without implying exact timing.
- Log public card reveals, including reveals during look actions. Looking alone
  does not reveal private identities; later reveals must not alter earlier states.
- Capture and display Atlas's observed Might total for each player on each battlefield.
  Retain the observation sequence/time and any face-down/unreadable qualifiers;
  missing totals remain unknown, not zero. Keep observed totals separate from any
  future calculations, and do not derive hidden card identities from those totals.
  Implemented on 2026-10-05 from the supplied DOM example: zone and player come from
  `data-battlefield-might-zone` / `data-battlefield-might-player`; the numeric total
  comes from the nested `data-battlefield-might-value`. The collector retains raw
  value, side, aria-label and tooltip alongside the observation sequence/time.
  The viewer shows Observed Might per player/battlefield, with the tooltip's scope:
  face-up units, fixed equipment bonuses unless overridden by a white counter;
  buff markers and red counters are ignored. Local edits do not recalculate it.
  Earlier inspection found Might translation labels
  in bundled page data but no rendered "might" text/attributes in the 2,790 Bo3
  snapshots underlying capture #8 or the 15 snapshots in the newer September 29
  incognito file. Numeric totals without those labels remain unverified. Older
  compact captures have no battlefield Might field and display unknown; originals
  stay unchanged. Verify both players' totals during the next live match.

### Implemented foundation

- Pure DOM extraction now reads visible card IDs, names, owner mapping, zones,
  `data-exhausted` and `data-face-down` alongside scores/runes/deck counts.
  `data-visual-hidden` is animation state, not face-down state.
- Spectator recording persists immutable compact observations. Initial, turn,
  phase and reset boundaries save every section; other writes contain changed sections.
- Full-capture JSONL snapshots can be streamed into a separate recording, with
  source-sequence references. The original files stay untouched.
- Recorded replays use an Atlas-inspired image board: opposing bases, rune areas,
  legend/champion/trash, shared battlefield lanes, score/resource headers and a
  replay sidebar. Flip-board and local move/tap experiments preserve ownership.
  Card/battlefield images use captured HTTPS URLs, with image-error fallbacks and
  hidden-card backs. Older recordings retain text fallbacks. Room/setup segments
  and rewind checkpoints remain separate from visual presentation.
- An action without an aligned snapshot is labelled unverified. Later observations
  are not assigned to all earlier actions. Missing visible cards do not imply deaths.

This is an observational replay, not completion of every v0.2.0 release criterion.
Next: connect the action interpreter to these physical card IDs, validate hand counts
and equipment attachments, compare predicted turn states with observed checkpoints,
add bounded timeline loading, and validate a fresh complete image-enabled match. The legacy `matches` table still has
one capture per match; multi-game segments here are derived replay data, not yet
normalized match rows suitable for statistics. Hidden DOM slot IDs are placeholders,
not stable physical-card identities. Private state and unsupported facts stay unknown.
