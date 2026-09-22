import { useStore } from "./store.ts";
import { AskPanel } from "./components/AskPanel.tsx";
import { CaptionStream } from "./components/CaptionStream.tsx";
import { GlossaryPanel } from "./components/GlossaryPanel.tsx";
import { SessionOutputPanel } from "./components/SessionOutputPanel.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { ReplayControl } from "./dev/ReplayControl.tsx";

export function App() {
  // Caption size rides a CSS custom property rather than a prop. A size change then costs
  // one style write on this element and zero React renders anywhere in the caption list.
  const fontPx = useStore((state) => state.fontPx);
  const showOutput = useStore((state) => state.view === "output" && state.sessionOutput !== null);

  return (
    <div className="app" style={{ ["--caption-size" as string]: fontPx + "px" }}>
      <StatusBar />
      <main className="main">
        {showOutput ? <SessionOutputPanel /> : <CaptionStream />}
        <div className="side">
          <AskPanel />
          <GlossaryPanel />
        </div>
      </main>
      <ReplayControl />
    </div>
  );
}
