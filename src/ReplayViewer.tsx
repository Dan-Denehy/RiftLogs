import { useState } from "react";
import { createSampleReplay } from "./sampleReplay";
import type { BoardCard, BoardState } from "./stateContext";
import { isBoardMove } from "./stateContext";
import "./replay.css";

const replay = createSampleReplay();
const zones = ["base", "battlefieldA", "battlefieldB", "hand", "trash"];
const zoneLabel: Record<string, string> = { base: "Base", battlefieldA: "Battlefield A", battlefieldB: "Battlefield B", hand: "Hand", trash: "Trash" };
const show = (value: number | null) => value ?? "?";

export default function ReplayViewer() {
  const [index, setIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<BoardState | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [undo, setUndo] = useState<BoardState[]>([]);
  const step = replay[index];
  const state = draft ?? step.state;
  const selectedCard = state.cards?.find((card) => card.id === selected);

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
        onDragStart={(event) => { event.dataTransfer.setData("text/plain", card.id); event.dataTransfer.effectAllowed = "move"; setSelected(card.id); }}
        onClick={() => setSelected(card.id)}>
        <strong>{card.hidden ? "Hidden card" : card.name ?? "Unknown card"}</strong>
        <small>{card.exhausted === null ? "Readiness unknown" : card.exhausted ? "Tapped" : "Ready"}</small>
        <small>{card.id}</small>
      </button>
      {equipment.map((item) => <button className="replay-equipment" type="button" key={item.id} onClick={() => setSelected(item.id)}>
        Attached: {item.name ?? "Unknown equipment"}
      </button>)}
    </div>;
  }

  return <main className="replay-shell">
    <header className="replay-heading"><div><p className="eyebrow">State-context prototype · Synthetic match</p><h1>Sample replay</h1>
      <p>Three turns. Step through the record, or explore a local what-if position.</p></div>
      <span className="replay-badge">{draft ? "Modified position" : "Recorded sample state"}</span></header>
    <section className="replay-toolbar" aria-label="Replay navigation">
      <button onClick={() => navigate(index - 1)} disabled={index === 0}>Previous</button>
      <label>Action <select aria-label="Replay action" value={index} onChange={(event) => navigate(Number(event.target.value))}>
        {replay.map((entry, i) => <option key={entry.action.sequence} value={i}>#{entry.action.sequence} · {entry.action.text}</option>)}
      </select></label>
      <button onClick={() => navigate(index + 1)} disabled={index === replay.length - 1}>Next</button>
      <span>{index + 1} / {replay.length}</span>
    </section>
    <div className="replay-layout"><section className="replay-board" aria-label="Replay board">
      <div className="replay-turn" aria-live="polite">Turn {state.context.turn ?? "?"} · {state.players[state.context.activePlayerId ?? ""] ?? "Unknown player"}'s turn</div>
      {Object.entries(state.players).reverse().map(([playerId, name]) => <section className="replay-player" key={playerId} aria-label={`${name} board`}>
        <header><h2>{name}</h2><div className="replay-resources">
          <span>Score <b>{show(state.scores[playerId] ?? null)}</b></span>
          <span>Runes <b>{show(state.resources[playerId]?.ready ?? null)}</b> ready / <b>{state.resources[playerId]?.ready != null && state.resources[playerId]?.used != null ? state.resources[playerId].ready! + state.resources[playerId].used! : "?"}</b> total</span>
          <span>Hand <b>{show(state.resources[playerId]?.hand ?? null)}</b></span>
          <span>Deck <b>{show(state.resources[playerId]?.deck ?? null)}</b></span>
        </div></header>
        <p className="replay-note">This turn: <strong>{state.turnActivity?.[playerId]?.cardsGained ?? 0}</strong> cards gained · <strong>{state.turnActivity?.[playerId]?.runesRecycled ?? 0}</strong> runes recycled</p>
        <div className="replay-zones">{zones.filter((zone) => zone !== "hand").map((zone) => {
          const cards = state.cards?.filter((card) => card.ownerId === playerId && card.zone === zone && !card.attachedTo) ?? [];
          return <section key={zone} className="replay-zone" aria-label={`${name} ${zoneLabel[zone]}`}
            onDragOver={(event) => { if (editing) event.preventDefault(); }}
            onDrop={(event) => { event.preventDefault(); const id = event.dataTransfer.getData("text/plain"); if (state.cards?.find((card) => card.id === id)?.ownerId === playerId) move(id, zone); }}>
            <h3>{zoneLabel[zone]}</h3><div className="replay-card-list">{cards.map(cardView)}</div>
            {!cards.length && <p className="replay-empty">No tracked cards</p>}
          </section>;
        })}</div>
      </section>)}
    </section><aside className="replay-sidebar">
      <section><h2>Current action</h2><p>#{step.action.sequence} {step.action.text}</p><small>{step.action.actorId ? `Actor: ${state.players[step.action.actorId]}` : "Turn boundary / observation"}</small></section>
      <section><h2>What-if controls</h2><label><input type="checkbox" checked={editing} onChange={(event) => { setEditing(event.target.checked); reset(); }} /> Enable local edits</label>
        <p className="replay-note">Select a card to move or tap it. Dragging also works within its owner's zones. Changes reset when you change actions or turn edits off.</p>
        <p><strong>{selectedCard ? selectedCard.hidden ? "Hidden card" : selectedCard.name ?? "Unknown card" : "No card selected"}</strong></p>
        <label>Move to <select aria-label="Move selected card" disabled={!editing || !selectedCard} value={selectedCard?.zone ?? "base"} onChange={(event) => selectedCard && move(selectedCard.id, event.target.value)}>
          {zones.map((zone) => <option key={zone} value={zone}>{zoneLabel[zone]}</option>)}
        </select></label>
        <button disabled={!editing || !selectedCard} onClick={() => edit((next) => { const card = next.cards?.find((item) => item.id === selected); if (card) card.exhausted = card.exhausted !== true; })}>{selectedCard?.exhausted ? "Untap selected card" : "Tap selected card"}</button>
        <div className="replay-button-row"><button disabled={!undo.length} onClick={() => { setDraft(structuredClone(undo.at(-1)!)); setUndo(undo.slice(0, -1)); }}>Undo edit</button><button disabled={!draft} onClick={reset}>Reset position</button></div>
        <small>Freeform review only: costs, combat and triggered abilities are not simulated. Moving a unit to hand/trash returns its attached equipment to base.</small>
      </section>
      <section aria-label="Checkpoint flags"><h2>Checkpoint review</h2>
        {draft && <p>Flags below describe the recorded sample, not your edited position.</p>}
        {!step.observationSequence ? <p>Predicted state · no observation at this action.</p> : <p>Full checkpoint #{step.observationSequence}</p>}
        {step.flags.length === 0 ? <p>{step.observationSequence ? "No discrepancies detected." : "Next turn boundary will check the board."}</p> : step.flags.map((flag, i) => <div className={`replay-flag ${flag.status}`} key={i}>
          <strong>{flag.status === "mismatch" ? "Mismatch" : "Unable to verify"}</strong><code>{flag.path}</code><small>Expected: {JSON.stringify(flag.expected) ?? "unknown"}<br />Observed: {JSON.stringify(flag.observed)}</small>
        </div>)}
      </section>
    </aside></div>
  </main>;
}
