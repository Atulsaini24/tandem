import { useEffect, useRef, useState } from "react";
import { createEditor, type Editor } from "../canvas/editor";
import type { Route } from "../router";
import { useUiStore } from "../state/ui-store";
import { CommandPalette } from "../ui/CommandPalette";
import { CursorChat, EmptyState } from "../ui/CursorChat";
import { HistoryPanel } from "../ui/HistoryPanel";
import { Hud } from "../ui/Hud";
import { Inspector } from "../ui/Inspector";
import { LabelEditor } from "../ui/LabelEditor";
import { LeftSidebar } from "../ui/LeftSidebar";
import { Minimap } from "../ui/Minimap";
import { Notice } from "../ui/Presence";
import { PresentMode } from "../ui/PresentMode";
import { RadialMenu } from "../ui/RadialMenu";
import { RitualsPanel, TimerPill } from "../ui/Rituals";
import { Scenes3D } from "../ui/Scenes3D";
import { ShareDialog } from "../ui/ShareDialog";
import { TeamBar } from "../ui/TeamBar";
import { Toolbar } from "../ui/Toolbar";
import { TopBar } from "../ui/TopBar";
import { Tour } from "../ui/Tour";

const HEADER = 56;
const LEFT = 256;
const RIGHT = 300;

function readPanels(): { left: boolean; right: boolean } {
  try {
    const saved = JSON.parse(localStorage.getItem("canvas:panels") ?? "null") as { left?: boolean; right?: boolean } | null;
    return { left: saved?.left ?? window.innerWidth >= 1200, right: saved?.right ?? window.innerWidth >= 1000 };
  } catch {
    return { left: true, right: true };
  }
}

/**
 * One board, laid out like a pro editor: header across the top, pages/layers on the left,
 * design + AI on the right, the canvas in between. Present mode hides all of it.
 */
export default function Board({ route }: { route: Extract<Route, { page: "board" }> }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [panels, setPanels] = useState(readPanels);
  const { docId, token, viewMode, template } = route;
  const presenting = useUiStore((s) => s.presenting !== undefined);
  const aiOpen = useUiStore((s) => s.aiOpen);

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

  // The canvas fills whatever space the panels leave: resize it when that changes.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !editor) return;
    const observer = new ResizeObserver(() => editor.renderer.app.resize());
    observer.observe(host);
    return () => observer.disconnect();
  }, [editor]);

  // Asking for the AI (dock button, palette, empty state) opens the right panel on it.
  useEffect(() => {
    if (aiOpen && !panels.right) setPanels((p) => ({ ...p, right: true }));
  }, [aiOpen]);

  const toggle = (side: "left" | "right"): void => {
    setPanels((p) => {
      const next = { ...p, [side]: !p[side] };
      try {
        localStorage.setItem("canvas:panels", JSON.stringify(next));
      } catch {
        // fine
      }
      return next;
    });
  };

  const chrome = !presenting;
  const inset = {
    top: chrome ? HEADER : 0,
    left: chrome && panels.left ? LEFT : 0,
    right: chrome && panels.right ? RIGHT : 0,
    bottom: 0,
  };

  return (
    <div className="relative h-full w-full select-none overflow-hidden bg-canvas">
      {/* The canvas area, and everything that lives on top of the canvas itself. */}
      <div className="absolute transition-[left,right,top] duration-300 ease-out" style={inset}>
        <div ref={hostRef} className="absolute inset-0" />
        <Scenes3D editor={editor} />
        {chrome && (
          <div className="pointer-events-none absolute inset-0">
            <EmptyState editor={editor} />
            <Toolbar editor={editor} />
            <Minimap editor={editor} />
            <Hud />
            <TeamBar editor={editor} />
          </div>
        )}
        <div className="pointer-events-none absolute inset-0">
          <TimerPill editor={editor} />
          <Notice />
        </div>
        <LabelEditor editor={editor} />
        <CursorChat editor={editor} />
        {chrome && (
          <div className="pointer-events-none absolute inset-0">
            <HistoryPanel editor={editor} />
            <RitualsPanel editor={editor} />
          </div>
        )}
      </div>

      {chrome && (
        <div className="pointer-events-none absolute inset-0">
          <TopBar editor={editor} onShare={() => setShareOpen(true)} />
          <LeftSidebar editor={editor} open={panels.left} onToggle={() => toggle("left")} />
          <Inspector editor={editor} open={panels.right} onToggle={() => toggle("right")} />
        </div>
      )}
      <PresentMode editor={editor} />
      <RadialMenu editor={editor} />
      <CommandPalette editor={editor} />
      <ShareDialog editor={editor} open={shareOpen} onClose={() => setShareOpen(false)} />
      <Tour ready={editor !== null} />
    </div>
  );
}
