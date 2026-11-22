import { useEffect, useRef, useState } from "react";
import { createEditor, type Editor } from "./canvas/editor";
import { AiPanel } from "./ui/AiPanel";
import { HistoryPanel } from "./ui/HistoryPanel";
import { LabelEditor } from "./ui/LabelEditor";
import { Hud, KeyHints } from "./ui/Hud";
import { Notice } from "./ui/Presence";
import { SyncPill } from "./ui/SyncPill";
import { Toolbar } from "./ui/Toolbar";

export function App() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<Editor | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const handle = createEditor(host);
    let alive = true;
    void handle.ready.then((instance) => {
      if (alive) setEditor(instance);
    });
    return () => {
      alive = false;
      setEditor(null);
      handle.destroy();
    };
  }, []);

  return (
    <div className="relative h-full w-full select-none">
      <div ref={hostRef} className="absolute inset-0" />
      <Toolbar editor={editor} />
      <SyncPill editor={editor} />
      <Hud />
      <KeyHints />
      <LabelEditor editor={editor} />
      <AiPanel editor={editor} />
      <HistoryPanel editor={editor} />
      <Notice />
    </div>
  );
}
