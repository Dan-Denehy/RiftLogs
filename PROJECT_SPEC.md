# RiftLogs Project Specification

## Purpose

RiftLogs captures and analyzes Riftbound matches played through RiftAtlas. RiftAtlas is the primary match-data source for V1. RiftLogs owns its capture format and storage pipeline.

RiftLite replay files are not a V1 dependency. Importing RiftLite `.json.gz` files may be evaluated as an optional feature later, but no current architecture may assume that RiftAtlas produces those files.

## Primary data flow

1. A second Riftbound account joins a RiftAtlas lobby as a spectator.
2. Playwright opens and monitors the RiftAtlas spectator page.
3. RiftLogs reads the rendered match-log DOM.
4. Every captured event is saved in an untouched raw JSON format controlled by RiftLogs.
5. A parser normalizes captured events into matches, turns, players, and ordered actions.
6. The normalized data is stored in SQLite through Drizzle ORM.
7. After the game, the user manually enters private information that a spectator cannot observe: opening hand, mulligans, replacement cards, draws, corrections, and notes.
8. RiftLogs reconstructs turn state and calculates statistics.

The raw capture is the permanent source record. Parsing and normalization must never overwrite it, so captures can be reprocessed when the parser improves or RiftAtlas changes its DOM.

## RiftAtlas retention constraint

RiftAtlas keeps only the most recent 100 rendered match events and purges older events. A completed-match DOM snapshot is therefore not an authoritative source for matches that exceed that limit, even if every currently rendered element is collected.

The spectator capture client must be active while the match is in progress. It must take an initial snapshot, observe newly rendered events, append each event to RiftLogs-owned raw storage before RiftAtlas removes it, and deduplicate events that are re-rendered. Capture should begin before the first game action whenever possible. Capture completeness is determined from retained initiating-phase events such as battlefield or mulligan selection, not merely from the presence of turn 1.

Completed-match extraction remains useful for DOM research, short matches, and recovery of the retained tail of a match, but it cannot reconstruct events that RiftAtlas has already purged.

## Known RiftAtlas DOM metadata

The current capture approach must preserve, when present:

- turn groups selected by `[data-match-log-group="turn"]`;
- non-turn setup log groups and placeholder actions marked with
  `data-log-action-placeholder="true"`, including mulligan and battlefield selection;
- `data-turn-number` and `data-turn-player-id`;
- `data-log-action-kind` and `data-log-action-label`;
- `data-log-card-name`;
- `data-log-card-art`;
- `data-battlefield-marker`;
- card information exposed through `aria-label`;
- rendered text, player-related attributes, DOM order, and relevant element markup.
- the observed green and yellow turn accents used as a supporting player-attribution signal.

Action ownership is independent of the active turn player. Reactions from both players may be interleaved within one turn. For each match, RiftLogs maps normalized RGB palette keys from turn dividers to player identities, then resolves every action from its narrow left-side marker. Alpha differences are ignored. An unrecognized marker remains `unknown`; it must never silently inherit the turn player.

The exact DOM shape still needs to be verified with real completed-match captures. Capture code should retain unknown attributes rather than discard data it does not understand.

## V1 scope

V1 includes:

- capturing RiftAtlas match-log DOM data in a RiftLogs-owned JSON format;
- preserving imported captures unchanged;
- normalizing matches, turns, players, and ordered actions;
- displaying a turn-by-turn event log;
- manually entering private player information after a match;
- reconstructing state and calculating useful match statistics.

V1 does not include RiftLite replay importing or assume `.json.gz` input.

## Released baseline and next milestone

v0.1.0 is the released capture/reconstruction baseline. The next milestone is
v0.2.0 state context and visual replay, described in [STATE_CONTEXT_PLAN.md](STATE_CONTEXT_PLAN.md).
It adds compact board observations alongside raw actions, then reconstructs and displays
state while stepping forward/backward through the timeline with card images.

This checkpoint includes:

1. A diagnostic browser-console script for extracting the retained portion of a completed RiftAtlas match log.
2. Capture of turn groups and ordered actions, including raw text, all attributes, card metadata, battlefield markers, player-related elements, and sequence numbers.
3. Copying and downloading the result as `atlas-match.json`.
4. A manual web import page for selecting that JSON file.
5. Exact raw JSON persistence in SQLite before normalization.
6. A basic turn-by-turn view of the imported capture.
7. A Playwright spectator probe that accepts a room ID and records initial and newly
   rendered raw action events directly to SQLite while the match is live.

A real Atlas capture has now verified the current turn/action structure. Sanitized importer tests cover that observed structure; normalization tests will grow as more action variants become available.

The current client-side state prototype derives a snapshot after every action. It
tracks points with rewind support and confirmed unit locations. Board cards whose
card type cannot be proven from the log remain explicitly unclassified rather than
being guessed as units. Derived state never modifies the preserved raw events.

## Explicitly deferred

- automatic RiftAtlas login;
- complete rules simulation and advanced statistical dashboards;
- private-information entry forms;
- compression;
- optional RiftLite compatibility.

Live action monitoring already exists. Compact board-state monitoring is the next
extension; unknown or hidden state must remain explicit throughout reconstruction.
