/**
 * Images for the AI: shrink a photo before sending it (a vision model doesn't need 12
 * megapixels, and a smaller image answers several times faster), as base64 JPEG.
 */
export interface PreparedImage {
  readonly base64: string;
  readonly width: number;
  readonly height: number;
  /** For showing a preview. */
  readonly dataUrl: string;
}

export async function prepareImage(blob: Blob, max = 1024): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(blob);
  const k = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * k));
  const height = Math.max(1, Math.round(bitmap.height * k));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Can't read this image.");
  ctx.fillStyle = "#ffffff"; // transparent PNGs: white, like paper
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/jpeg", 0.86);
  return { base64: dataUrl.slice(dataUrl.indexOf(",") + 1), width, height, dataUrl };
}

function filesOf(items: DataTransferItemList | FileList): File[] {
  if (items instanceof FileList) return Array.from(items);
  return Array.from(items).flatMap((item) => {
    const f = item.kind === "file" ? item.getAsFile() : null;
    return f ? [f] : [];
  });
}

/** The first image in a drop or paste, if any. */
export function imageFrom(items: DataTransferItemList | FileList | undefined | null): File | undefined {
  if (!items) return undefined;
  for (const file of filesOf(items)) {
    if (file.type.startsWith("image/")) return file;
  }
  return undefined;
}

/** The first CSV/TSV/text table in a drop, if any. */
export function tableFrom(items: DataTransferItemList | FileList | undefined | null): File | undefined {
  if (!items) return undefined;
  for (const file of filesOf(items)) {
    if ((/\.(csv|tsv|txt)$/i.test(file.name) || /csv|tab-separated/.test(file.type))) return file;
  }
  return undefined;
}

/**
 * The colour under a box of the photo (percent coordinates), averaged over its middle, and
 * whether it's coloured paper (a sticky note) rather than the board behind it.
 */
export async function sampleColors(dataUrl: string, boxes: ReadonlyArray<{ x: number; y: number; w: number; h: number }>): Promise<Array<{ rgb: [number, number, number]; paper: boolean }>> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return boxes.map(() => ({ rgb: [255, 255, 255], paper: false }));
  ctx.drawImage(img, 0, 0);
  // The board colour: the photo's border.
  const edge = ctx.getImageData(0, 0, img.width, Math.max(1, Math.round(img.height * 0.04))).data;
  let br = 0, bg = 0, bb = 0, bn = 0;
  for (let i = 0; i < edge.length; i += 16) {
    br += edge[i] ?? 0;
    bg += edge[i + 1] ?? 0;
    bb += edge[i + 2] ?? 0;
    bn += 1;
  }
  const board: [number, number, number] = [br / bn, bg / bn, bb / bn];
  return boxes.map((b) => {
    const x = Math.round(((b.x + b.w * 0.15) / 100) * img.width);
    const y = Math.round(((b.y + b.h * 0.15) / 100) * img.height);
    const w = Math.max(1, Math.round(((b.w * 0.7) / 100) * img.width));
    const h = Math.max(1, Math.round(((b.h * 0.7) / 100) * img.height));
    const d = ctx.getImageData(Math.min(img.width - 1, x), Math.min(img.height - 1, y), Math.min(w, img.width - x), Math.min(h, img.height - y)).data;
    // Ignore dark pixels (ink) so handwriting doesn't tint the paper.
    let r = 0, g = 0, bl = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const v = (d[i] ?? 0) + (d[i + 1] ?? 0) + (d[i + 2] ?? 0);
      if (v < 240) continue;
      r += d[i] ?? 0;
      g += d[i + 1] ?? 0;
      bl += d[i + 2] ?? 0;
      n += 1;
    }
    const rgb: [number, number, number] = n ? [r / n, g / n, bl / n] : board;
    const diff = Math.abs(rgb[0] - board[0]) + Math.abs(rgb[1] - board[1]) + Math.abs(rgb[2] - board[2]);
    const sat = Math.max(...rgb) - Math.min(...rgb);
    return { rgb, paper: diff > 45 && sat > 25 };
  });
}

/** The sticky-note colour closest to an RGB sample. */
export function nearestNote(rgb: readonly [number, number, number], palette: Readonly<Record<string, number>>): number {
  let best = 0xffd666;
  let dist = Infinity;
  for (const value of Object.values(palette)) {
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    const d = (r - rgb[0]) ** 2 + (g - rgb[1]) ** 2 + (b - rgb[2]) ** 2;
    if (d < dist) {
      dist = d;
      best = value;
    }
  }
  return best;
}
