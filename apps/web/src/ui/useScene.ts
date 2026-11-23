import { useEffect, useState } from "react";
import type { Editor } from "../canvas/editor";

/** Re-render when the board changes (polled cheaply: panels don't need every frame). */
export function useSceneVersion(editor: Editor | null, ms = 180): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!editor) return;
    let last = -1;
    const timer = setInterval(() => {
      if (editor.scene.version !== last) {
        last = editor.scene.version;
        setVersion(last);
      }
    }, ms);
    return () => clearInterval(timer);
  }, [editor, ms]);
  return version;
}
