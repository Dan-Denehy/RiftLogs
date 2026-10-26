import { useState } from "react";
import { createSampleReplay } from "./sampleReplay";
import type { BoardCard, BoardState, ReplayStep } from "./stateContext";
import { isBoardMove } from "./stateContext";
import CardArtwork from "./CardArtwork";
import "./replay.css";

const sampleReplay = createSampleReplay();
const zones = ["base", "battlefieldA", "battlefieldB", "hand", "trash", "legend", "champion", "runeArea"];
const zoneLabel: Record<string, string> = { base: "Base", battlefieldA: "Battlefield A", battlefieldB: "Battlefield B", hand: "Hand", trash: "Trash", legend: "Legend", champion: "Champion", runeArea: "Runes" };
const show = (value: number | null) => value ?? "?";

export default function ReplayViewer({ replay = sampleReplay, title = "Sample replay", recorded = false }: {
  replay?: ReplayStep[]; title?: string; recorded?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<BoardState | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [undo, setUndo] = useState<BoardState[]>([]);
  const [bottomPlayer, setBottomPlayer] = useState<string | null>(null);
  const step = replay[index];
  const state = draft ?? step.state;
  const labelForZone = (zone: string) => state.battlefieldNames?.[zone] ?? zoneLabel[zone] ?? zone;
  const selectedCard = state.cards?.find((card) => card.id === selected);
  const playerIds = Object.keys(state.players);
  const bottomId = bottomPlayer && playerIds.includes(bottomPlayer) ? bottomPlayer : playerIds[0];
  const topIds = playerIds.filter((id) => id !== bottomId);
  const boardOrder = [...topIds, ...(bottomId ? [bottomId] : [])];

  function navigate(next: number) {
    setIndex(next); setDraft(null); setSelected(null); setUndo([]);
  }
  function reset() { setDraft(null); setSelected(null); setUndo([]); }
  function edit(change: (next: BoardState) => void) {
    if (!editing) return;
    const next = structuredClone(state);
    change(next);
    setUndo([...undo, structuredClone(state)]);
    setDraft(next);
  }
  function move(id: string, zone: string) {
    edit((next) => {
      const card = next.cards?.find((item) => item.id === id);
      if (!card || card.zone === zone) return;
      const resources = next.resources[card.ownerId];
      if (resources?.hand != null) {
        if (card.zone === "hand") resources.hand = Math.max(0, resources.hand - 1);
        if (zone === "hand") resources.hand++;
      }
      if (card.cardType === "unit" && isBoardMove(card.zone, zone)) card.exhausted = true;
      card.zone = zone;
      card.attachedTo = null;
      for (const equipment of next.cards ?? []) if (equipment.attachedTo === id) {
        if (zone === "trash" || zone === "hand") { equipment.attachedTo = null; equipment.zone = "base"; }
        else equipment.zone = zone;
      }
    });
  }
  function cardView(card: BoardCard) {
    const equipment = state.cards?.filter((item) => item.attachedTo === card.id) ?? [];
    return <div className="replay-card-wrap" key={card.id}>
      <button type="button" className={`replay-card ${card.exhausted ? "is-tapped" : ""} ${selected === card.id ? "is-selected" : ""}`}
        aria-pressed={selected === card.id} draggable={editing}
        aria-label={`${card.hidden ? "Hidden card" : card.name ?? "Unknown card"}, ${card.exhausted === null ? "readiness unknown" : card.exhausted ? "tapped" : "ready"}`}
        title={card.hidden ? "Hidden card" : card.name ?? "Unknown card"}
        onDragStart={(event) => { event.dataTransfer.setData("text/plain", card.id); event.dataTransfer.effectAllowed = "move"; setSelected(card.id); }}
        onClick={() => setSelected(card.id)}>
        <CardArtwork name={card.hidden ? "Hidden card" : card.name ?? "Unknown card"} url={card.imageUrl} fallbackUrl={card.imageFallbackUrl} hidden={card.hidden === true} />
        <span className="replay-card-caption"><strong>{card.hidden ? "Hidden card" : card.name ?? "Unknown card"}</strong>
          <small>{card.exhausted === null ? "Readiness unknown" : card.exhausted ? "Tapped" : "Ready"}</small></span>
      </button>
      {equipment.map((item) => <button className="replay-equipment" type="button" key={item.id} onClick={() => setSelected(item.id)}>
        Attached: {item.hidden ? "Hidden card" : item.name ?? "Unknown equipment"}
      </button>)}
    </div>;
  }

  function zoneView(playerId: string, zone: string, battlefield = false) {
    const cards = state.cards?.filter((card) => card.ownerId === playerId && card.zone === zone && !card.attachedTo) ?? [];
    const totals = state.battlefieldMight?.filter((total) => total.playerId === playerId && total.zone === zone) ?? [];
    const might = totals.length === 1 ? totals[0] : undefined;
    return <section key={zone} className={`replay-zone zone-${zone} ${battlefield ? "battlefield-lane" : ""} ${playerId === bottomId ? "side-bottom" : "side-top"}`}
      aria-label={`${state.players[playerId]} ${labelForZone(zone)}`}
      onDragOver={(event) => { if (editing) event.preventDefault(); }}
      onDrop={(event) => { event.preventDefault(); const id = event.dataTransfer.getData("text/plain"); if (state.cards?.find((card) => card.id === id)?.ownerId === playerId) move(id, zone); }}>
      <div className="zone-heading">{battlefield ? <span>{state.players[playerId]}</span> : <h3>{labelForZone(zone)}</h3>}
        {battlefield && <small title={might?.title ?? "No unambiguous Atlas Might total was captured."}>
          {draft ? "Recorded Might (not recalculated)" : "Observed Might"} <b>{might?.value ?? "?"}</b>
        </small>}
      </div>
      <div className="replay-card-list">{cards.map(cardView)}</div>
      {!cards.length && <p className="replay-empty">{state.cards === null ? "Not observed" : "No tracked cards"}</p>}
    </section>;
  }

  function playerArea(playerId: string) {
    const pool = state.resources[playerId];
    return <section className={`replay-player ${playerId === bottomId ? "side-bottom" : "side-top"}`} key={playerId} aria-label={`${state.players[playerId]} board`}>
      <header className="player-identity"><div className="player-score" aria-label={`${state.players[playerId]} score`}>{show(state.scores[playerId] ?? null)}<small>POINTS</small></div>
        <div><h2>{state.players[playerId]} {state.context.activePlayerId === playerId && <span className="active-turn-label">Active turn</span>}</h2>
          <div className="replay-resources"><span>Runes <b>{show(pool?.ready ?? null)}</b> ready / <b>{pool?.ready != null && pool?.used != null ? pool.ready + pool.used : "?"}</b> total</span>
            <span>Hand <b>{show(pool?.hand ?? null)}</b></span><span>Deck <b>{show(pool?.deck ?? null)}</b></span></div>
        </div>
        <p className="turn-counters">This turn<br /><b>{state.turnActivity?.[playerId]?.cardsGained ?? (recorded ? "?" : 0)}</b> gained · <b>{state.turnActivity?.[playerId]?.runesRecycled ?? (recorded ? "?" : 0)}</b> recycled</p>
      </header>
      <div className="player-zone-grid">{zoneView(playerId, "runeArea")}{zoneView(playerId, "base")}
        <div className="command-zones">{["legend", "champion", "trash"].map((zone) => zoneView(playerId, zone))}</div>
      </div>
    </section>;
  }

  return <main className="replay-shell">
    <header className="replay-heading"><div><p className="eyebrow">State-context prototype · {recorded ? "RiftAtlas observations" : "Synthetic match"}</p><h1>{title}</h1>
      <p>Step through the record, or explore a local what-if position.</p></div>
      <span className="replay-badge">{draft ? "Modified position" : recorded ? "Observed replay" : "Recorded sample state"}</span></header>
    <section className="replay-toolbar" aria-label="Replay navigation">
      <button onClick={() => navigate(index - 1)} disabled={index === 0}>Previous</button>
      <label>Step <select aria-label="Replay action" value={index} onChange={(event) => navigate(Number(event.target.value))}>
        {replay.map((entry, i) => <option key={entry.action.sequence} value={i}>#{entry.action.sequence} · {entry.action.text}</option>)}
      </select></label>
      <button onClick={() => navigate(index + 1)} disabled={index === replay.length - 1}>Next</button>
      <span>{index + 1} / {replay.length}</span>
      <button disabled={playerIds.length !== 2} onClick={() => setBottomPlayer(topIds[0])}>Flip board</button>
    </section>
    <div className="replay-layout"><section className="replay-board" aria-label="Replay board">
      <div className="replay-turn" aria-live="polite">Turn {state.context.turn ?? "?"} · {state.players[state.context.activePlayerId ?? ""] ?? "Unknown player"}'s turn</div>
      {step.note?.startsWith("Rewind batch:") && <p className="replay-note" role="note">Rewind snapshot — exact board timing for this action is unverified.</p>}
      {!Object.keys(state.players).length && <p>No board observation is available yet. Advance to the first checkpoint.</p>}
      {topIds.map(playerArea)}
      {!!boardOrder.length && <div className="shared-battlefields">{["battlefieldA", "battlefieldB"].map((zone) => <section className="battlefield-table" key={zone} aria-label={`${labelForZone(zone)} shared battlefield`}>
        <div className="battlefield-background" aria-hidden="true"><CardArtwork landscape name="" url={state.battlefieldImages?.[zone]} /></div>
        {topIds.map((id) => zoneView(id, zone, true))}
        {bottomId && zoneView(bottomId, zone, true)}
      </section>)}</div>}
      {bottomId && playerArea(bottomId)}
    </section><aside className="replay-sidebar">
      <section aria-label="Current chain"><h2>Current chain</h2>
        {step.superseded && <p role="note">Debug: this position belongs to an undone branch.</p>}
        {state.chain == null ? <p>Not captured for this position.</p> : !state.chain.length ? <p>No cards on the observed chain.</p> : <>
          <small>Last observed chain · Atlas timeline order. Not simulated by local edits.</small>
          <ol className="replay-chain">{state.chain.map((entry) => <li key={entry.id}>
            <CardArtwork name={entry.hidden ? "Hidden card" : entry.name ?? "Unknown card"} url={entry.imageUrl} fallbackUrl={entry.imageFallbackUrl} hidden={entry.hidden} />
            <div><strong>{entry.hidden ? "Hidden card" : entry.name ?? "Unknown card"}</strong><br />
              <small>{state.players[entry.ownerId ?? ""] ?? "Unknown player"}{entry.newest ? " · Newest" : ""}</small></div>
          </li>)}</ol>
        </>}
      </section>
      <section><h2>Current action</h2><p>#{step.action.sequence} {step.action.text}</p><small>{step.action.actorId ? `Actor: ${state.players[step.action.actorId] ?? step.action.actorId}` : recorded && !step.observationSequence ? "Actor unknown" : "Turn boundary / observation"}{step.timestamp ? ` · ${step.timestamp}` : ""}</small></section>
      <section><h2>What-if controls</h2><label><input type="checkbox" checked={editing} onChange={(event) => { setEditing(event.target.checked); reset(); }} /> Enable local edits</label>
        {selectedCard && <div className="selected-card-preview"><CardArtwork name={selectedCard.hidden ? "Hidden card" : selectedCard.name ?? "Unknown card"} url={selectedCard.imageUrl} fallbackUrl={selectedCard.imageFallbackUrl} hidden={selectedCard.hidden === true} /></div>}
        <p className="replay-note">Select a card to move or tap it. Dragging also works within its owner's zones. Changes reset when you change actions or turn edits off.</p>
        <p><strong>{selectedCard ? selectedCard.hidden ? "Hidden card" : selectedCard.name ?? "Unknown card" : "No card selected"}</strong></p>
        <label>Move to <select aria-label="Move selected card" disabled={!editing || !selectedCard} value={selectedCard?.zone ?? "base"} onChange={(event) => selectedCard && move(selectedCard.id, event.target.value)}>
          {zones.map((zone) => <option key={zone} value={zone}>{labelForZone(zone)}</option>)}
        </select></label>
        <button disabled={!editing || !selectedCard} onClick={() => edit((next) => { const card = next.cards?.find((item) => item.id === selected); if (card) card.exhausted = card.exhausted !== true; })}>{selectedCard?.exhausted ? "Untap selected card" : "Tap selected card"}</button>
        <div className="replay-button-row"><button disabled={!undo.length} onClick={() => { setDraft(structuredClone(undo.at(-1)!)); setUndo(undo.slice(0, -1)); }}>Undo edit</button><button disabled={!draft} onClick={reset}>Reset position</button></div>
        <small>Freeform review only: costs, combat and triggered abilities are not simulated. Moving a unit to hand/trash returns its attached equipment to base.</small>
      </section>
      <section aria-label="Checkpoint flags"><h2>Checkpoint review</h2>
        {draft && <p>Flags below describe the recording, not your edited position.</p>}
        {step.note && <p role="note">{step.note}</p>}
        {!step.observationSequence ? <p>{recorded ? "Last observed position · action state unverified." : "Predicted state · no observation at this action."}</p> : <p>Checkpoint #{step.observationSequence}</p>}
        {step.flags.length === 0 ? <p>{recorded ? "Observed data; interpreter comparison is not yet available for this recording." : step.observationSequence ? "No discrepancies detected." : "Next turn boundary will check the board."}</p> : step.flags.map((flag, i) => <div className={`replay-flag ${flag.status}`} key={i}>
          <strong>{flag.status === "mismatch" ? "Mismatch" : "Unable to verify"}</strong><code>{flag.path}</code><small>Expected: {JSON.stringify(flag.expected) ?? "unknown"}<br />Observed: {JSON.stringify(flag.observed)}</small>
        </div>)}
      </section>
    </aside></div>
  </main>;
}
