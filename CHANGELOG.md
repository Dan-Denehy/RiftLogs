# Changelog

## 0.1.0 — 2026-09-30

- RiftAtlas spectator recording, raw capture storage, and match-history display.
- Initial reconstruction of scores, units, equipment, hidden cards, and rune checkpoints.
- Player/card catalogs and normalized match/participant storage.
- Per-match RiftAtlas player ID observations for identity research.
- Separate full-DOM research capture and tools for inspecting captured match data.

This is the baseline before compact board-state capture. Exact action-by-action
visual replay is not yet implemented. Full-DOM research captures remain separate
from normal SQLite match history.

## Planned: 0.2.0

State-context update: compact board observations linked to the action timeline,
including player mapping, scores, resources, and card locations. This supplies the
foundation for stepping forward/backward through a match with card images and
explicit handling of hidden or uncertain information.
