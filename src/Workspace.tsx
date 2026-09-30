import { useState } from "react";
import App from "./App";
import ReplayViewer from "./ReplayViewer";

export default function Workspace() {
  const [screen, setScreen] = useState<"history" | "replay">("replay");
  return <><nav className="workspace-nav" aria-label="RiftLogs views">
    <strong>RiftLogs</strong>
    <button aria-pressed={screen === "replay"} onClick={() => setScreen("replay")}>Sample replay</button>
    <button aria-pressed={screen === "history"} onClick={() => setScreen("history")}>Capture history</button>
  </nav>{screen === "replay" ? <ReplayViewer /> : <App />}</>;
}
