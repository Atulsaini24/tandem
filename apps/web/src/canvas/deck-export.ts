import type { ShapeView } from "@canvas/doc";
import { useUiStore } from "../state/ui-store";
import type { Editor } from "./editor";
import { download, svgToPng, toSvg } from "./export";

/**
 * Decks out of the board: every frame is a slide (in Present order). Each is drawn exactly
 * as it looks on the board, at 1920×1080, then packed into a PowerPoint (with the speaker
 * notes) or a video (a gentle zoom on each slide, crossfading to the next).
 */
export interface SlideFrame {
  readonly frame: ShapeView;
  readonly title: string;
  readonly notes: string;
}

const inside = (s: ShapeView, f: ShapeView): boolean => {
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  return s.id !== f.id && cx > f.x && cx < f.x + f.w && cy > f.y && cy < f.y + f.h;
};

export function deckFrames(editor: Editor): SlideFrame[] {
  const all = editor.scene.ordered();
  return editor.slides().flatMap((id) => {
    const frame = editor.scene.get(id);
    if (!frame) return [];
    const slide = all.find((s) => s.kind === "slide" && inside(s, frame));
    let notes = "";
    if (slide?.data) {
      try {
        const n = (JSON.parse(slide.data) as { notes?: unknown }).notes;
        notes = typeof n === "string" ? n : "";
      } catch {
        // no notes
      }
    }
    return [{ frame, title: (frame.label ?? "").replace(/^\d+\.\s*/, ""), notes }];
  });
}

/** One slide as an SVG cropped to its frame. */
export function frameSvg(editor: Editor, frame: ShapeView): string {
  const content = editor.scene.ordered().filter((s) => inside(s, frame) && s.kind !== "frame");
  const theme = editor.renderer.theme;
  const inner = content.length > 0 ? toSvg(content, editor.lookup, { theme, padding: 0, background: false }).svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "") : "";
  const bg = `#${theme.background.toString(16).padStart(6, "0")}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(frame.w)}" height="${Math.round(frame.h)}" viewBox="${frame.x} ${frame.y} ${frame.w} ${frame.h}"><rect x="${frame.x}" y="${frame.y}" width="${frame.w}" height="${frame.h}" fill="${bg}"/>${inner}</svg>`;
}

async function slideImages(editor: Editor, frames: readonly SlideFrame[]): Promise<Blob[]> {
  const out: Blob[] = [];
  for (const f of frames) out.push(await svgToPng(frameSvg(editor, f.frame), f.frame.w, f.frame.h, 1920 / Math.max(1, f.frame.w)));
  return out;
}

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(blob);
  });

const fileName = (): string => (useUiStore.getState().title ?? "deck").replace(/[^\w\- ]+/g, "").trim() || "deck";

export async function exportPptx(editor: Editor): Promise<number> {
  const frames = deckFrames(editor);
  if (frames.length === 0) {
    useUiStore.getState().setNotice("No slides yet: add frames (F), templates or an AI deck first.");
    return 0;
  }
  useUiStore.getState().setNotice(`Building ${frames.length} PowerPoint slides…`);
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = useUiStore.getState().title ?? "Deck";
  const images = await slideImages(editor, frames);
  for (let i = 0; i < frames.length; i += 1) {
    const f = frames[i];
    const img = images[i];
    if (!f || !img) continue;
    const slide = pptx.addSlide();
    // Fit the frame's shape into 16:9 without stretching.
    const W = 13.333;
    const H = 7.5;
    const k = Math.min(W / f.frame.w, H / f.frame.h);
    const w = f.frame.w * k;
    const h = f.frame.h * k;
    slide.background = { color: "111318" };
    slide.addImage({ data: await blobToDataUrl(img), x: (W - w) / 2, y: (H - h) / 2, w, h });
    if (f.notes) slide.addNotes(f.notes);
  }
  await pptx.writeFile({ fileName: `${fileName()}.pptx` });
  useUiStore.getState().setNotice(`Saved ${fileName()}.pptx · ${frames.length} slides`);
  return frames.length;
}

/** A video of the deck: each slide eases in for ~3.5 s, crossfading to the next. */
export async function exportVideo(editor: Editor, seconds = 3.5): Promise<number> {
  const frames = deckFrames(editor);
  if (frames.length === 0) {
    useUiStore.getState().setNotice("No slides yet: add frames (F), templates or an AI deck first.");
    return 0;
  }
  useUiStore.getState().setNotice(`Recording a ${Math.round(frames.length * seconds)}-second video…`);
  const blobs = await slideImages(editor, frames);
  const images = await Promise.all(blobs.map((b) => createImageBitmap(b)));
  const W = 1920;
  const H = 1080;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  const type = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
  const rec = new MediaRecorder(canvas.captureStream(30), { mimeType: type, videoBitsPerSecond: 8_000_000 });
  const parts: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));
  const draw = (img: ImageBitmap, t: number, alpha: number): void => {
    // Ken Burns: a slow push-in on each slide.
    const zoom = 1 + 0.045 * t;
    const k = Math.min(W / img.width, H / img.height) * zoom;
    const w = img.width * k;
    const h = img.height * k;
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
    ctx.globalAlpha = 1;
  };
  rec.start(500);
  const per = seconds * 1000;
  const fade = 600;
  const start = performance.now();
  await new Promise<void>((resolve) => {
    const tick = (): void => {
      const now = performance.now() - start;
      const i = Math.min(images.length - 1, Math.floor(now / per));
      const t = (now - i * per) / per;
      ctx.fillStyle = "#0b0d14";
      ctx.fillRect(0, 0, W, H);
      const cur = images[i];
      if (cur) draw(cur, t, 1);
      const next = images[i + 1];
      const into = now - (i + 1) * per + fade;
      if (next && into > 0) draw(next, 0, Math.min(1, into / fade));
      if (now >= images.length * per + 300) return resolve();
      requestAnimationFrame(tick);
    };
    tick();
  });
  rec.stop();
  await stopped;
  download(new Blob(parts, { type: "video/webm" }), `${fileName()}.webm`);
  useUiStore.getState().setNotice(`Saved ${fileName()}.webm · ${frames.length} slides`);
  return frames.length;
}
