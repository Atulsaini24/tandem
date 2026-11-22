import { useEffect, useRef, useState } from "react";
import { createEditor, type Editor } from "../canvas/editor";
import type { Route } from "../router";
import { AiPanel } from "../ui/AiPanel";
import { CommandPalette } from "../ui/CommandPalette";
import { CursorChat, EmptyState } from "../ui/CursorChat";
import { HistoryPanel } from "../ui/HistoryPanel";
import { Hud } from "../ui/Hud";
import { LabelEditor } from "../ui/LabelEditor";
import { Minimap } from "../ui/Minimap";
import { Notice } from "../ui/Presence";
import { ShareDialog } from "../ui/ShareDialog";
import { StyleBar } from "../ui/StyleBar";
import { Toolbar } from "../ui/Toolbar";
import { TopBar } from "../ui/TopBar";

/** One board: the canvas plus all of its chrome. */
export default function Board({ route }: { route: Extract<Route, { page: "board" }> }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const { docId, token, viewMode, template } = route;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const handle = createEditor(host, { docId, token, viewMode, template });
    let alive = true;
    void handle.ready.then((instance) => {
      if (alive) setEditor(instance);
    });
    // The template only applies to the first open: drop it from the URL.
    if (template) history.replaceState(null, "", location.pathname + location.search.replace(/[?&]template=[^&]*/, "").replace(/^&/, "?"));
    return () => {
      alive = false;
      setEditor(null);
      handle.destroy();
    };
  }, [docId, token, viewMode, template]);

  return (
    <div className="relative h-full w-full select-none overflow-hidden bg-canvas">
      <div ref={hostRef} className="absolute inset-0" />
      <div className="pointer-events-none absolute inset-0">
        <TopBar editor={editor} onShare={() => setShareOpen(true)} />
        <StyleBar editor={editor} />
        <EmptyState editor={editor} />
        <Toolbar editor={editor} />
        <Minimap editor={editor} />
        <Hud />
        <Notice />
      </div>
      <LabelEditor editor={editor} />
      <CursorChat editor={editor} />
      <div className="pointer-events-none absolute inset-0">
        <AiPanel editor={editor} />
        <HistoryPanel editor={editor} />
      </div>
      <CommandPalette editor={editor} />
      <ShareDialog editor={editor} open={shareOpen} onClose={() => setShareOpen(false)} />
    </div>
  );
}
