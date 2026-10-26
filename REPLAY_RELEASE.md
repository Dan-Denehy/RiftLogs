# Replay-only release: v0.2.0

Working branch: `release/replay-v0.2.0`, based on `feature/state-context-v0.2.0`.
Status: local preparation, not a published release. Package version stays at 0.1.0
until the release gates pass. Existing work and recordings are preserved.

## Scope

Record a RiftAtlas spectator match, reopen it, and review observable board state
with card images, ordered actions, forward/backward navigation, and board flipping.
Keep uncertainty visible: this is currently observational replay, not an exact
rules simulation at every action. Local what-if edits must not change recordings.

Include portable replay export/import so friends can view a shared match without
a spectator login. Each person who records uses their own dedicated login profile.
Do not distribute personal databases, browser profiles, cookies, or full-DOM research logs.

Defer statistics, full card-catalog work, rules simulation, comprehensive private-hand
entry, and series analytics. Correct separation of games remains required for replay.
Existing tools are not deleted merely because they are outside this release scope.

## Gate 1: User confirms replay works

- [ ] Validate a fresh complete match, including early/middle/late checkpoints.
- [ ] Verify ownership, zones, readiness, runes, scores, reveals, and attachments;
      unsupported facts must remain unknown rather than guessed.
- [ ] Verify both perspectives, repeated actions, multiple games, and incomplete captures.
- [ ] Keep observation checkpoints out of ordinary action navigation, with debugging access.
- [ ] Confirm backward/forward navigation restores the same state and resets local edits.
- [ ] Test images, missing artwork, and no future hidden-card identity leakage.
- [ ] Validate portable replay export/import without altering the original capture.
- [ ] Run tests, TypeScript checks, production build, and browser replay checks.
- [ ] Obtain the user's explicit replay approval before fresh-install testing.

## Gate 2: Security, packaging, and fresh installation

Implemented for local preview: `start.cmd` bootstrap/menu and `stop` + Enter with
final action/board flush, interrupted status on early browser close, and startup
failure guidance. See README's Start here section. Manual real-match verification
and clean-install testing are still pending; this is not production packaging.

- [ ] Validate untrusted replay input and enforce resource/size limits.
- [ ] Review captured HTML handling, image hosts, local API access/origin protections,
      file access, and dependencies; fix or explicitly assess findings before sharing.
- [ ] Scan release contents and Git history for secrets and private artifacts.
- [ ] Add a production startup workflow and document a tested Node/Chrome setup.
- [ ] Write a setup guide: install, personal spectator login, room code, record,
      safe stop, reopen, export/import, storage location, backup, and troubleshooting.
- [ ] Test clean installation without the developer's files or login session.
- [ ] Verify existing recordings and any database upgrades preserve raw evidence.

## Gate 3: Friends release

- [ ] Review known limitations and confirm the user approves sharing.
- [ ] Update version/changelog, commit the reviewed release, and tag v0.2.0.
- [ ] Publish only the reviewed package/source; never include personal session data.

Creating this branch does not itself approve a release, complete the security review,
or snapshot uncommitted files. Commit reviewed work separately before packaging.
