#!/usr/bin/env node
/**
 * Records the 60-second product demo as a WebM video, with nothing to install:
 * drives Chrome over the DevTools protocol, captures frames with Page.startScreencast,
 * then encodes them in Chrome itself (canvas + MediaRecorder).
 *
 *   1. the cinematic homepage (scroll story + AI Studio)
 *   2. a designed deck playing in Present mode
 *   3. two people editing offline at the same time, then merging with nothing lost
 *
 * Needs the dev servers running (pnpm dev: web on 5173, sync on 8787) and Chrome.
 * Usage: node scripts/record-demo.mjs [out.webm]
 */
/* global process, setTimeout, WebSocket, fetch, Buffer, console */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const OUT = resolve(process.argv[2] ?? "docs/tandem-demo.webm");
const APP = process.env.DEMO_URL ?? "http://localhost:5173";
const W = 1600;
const H = 900;
const PORT = 9333 + Math.floor(Math.random() * 500);
const CHROME =
  process.env.CHROME ??
  ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome"].find((p) => existsSync(p));
if (!CHROME) throw new Error("Chrome not found: set CHROME=/path/to/chrome");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * MediaRecorder writes WebM without a duration, so players can't show the length or seek
 * well. Insert a Duration element (ms, as a float64) at the start of the Segment's Info.
 */
function withDuration(buf, ms) {
  const info = buf.indexOf(Buffer.from([0x15, 0x49, 0xa9, 0x66]));
  if (info < 0) return buf;
  const sizeAt = info + 4;
  const first = buf[sizeAt];
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len += 1;
  if (len > 8) return buf;
  let size = first & ((0x80 >> (len - 1)) - 1);
  for (let i = 1; i < len; i += 1) size = size * 256 + buf[sizeAt + i];
  const duration = Buffer.alloc(11);
  duration.set([0x44, 0x89, 0x88]);
  duration.writeDoubleBE(ms, 3);
  // Same-length size field, so nothing after it moves except by the inserted bytes.
  const next = size + duration.length;
  if (next >= 2 ** (7 * len) - 1) return buf;
  const sizeField = Buffer.alloc(len);
  let v = next;
  for (let i = len - 1; i >= 0; i -= 1) {
    sizeField[i] = v % 256;
    v = Math.floor(v / 256);
  }
  sizeField[0] |= 0x80 >> (len - 1);
  const dataAt = sizeAt + len;
  return Buffer.concat([buf.subarray(0, sizeAt), sizeField, duration, buf.subarray(dataAt)]);
}
const profile = join(tmpdir(), `tandem-demo-${Date.now()}`);
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  "--headless=new",
  `--window-size=${W},${H}`,
  "--hide-scrollbars",
  "--mute-audio",
  "--no-first-run",
  "--no-default-browser-check",
  "--ignore-gpu-blocklist",
  "--enable-gpu-rasterization",
  "--autoplay-policy=no-user-gesture-required",
  "about:blank",
]);
chrome.stderr.on("data", () => {});

/** Minimal CDP client over Node's built-in WebSocket. */
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(msg.error.message));
      else res(msg.result);
    } else if (msg.method) for (const fn of listeners.get(msg.method) ?? []) fn(msg.params);
  };
  return {
    send: (method, params = {}) =>
      new Promise((res, rej) => {
        id += 1;
        pending.set(id, { res, rej });
        ws.send(JSON.stringify({ id, method, params }));
      }),
    on: (method, fn) => listeners.set(method, [...(listeners.get(method) ?? []), fn]),
    close: () => ws.close(),
  };
}

async function target() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      // not up yet
    }
    await sleep(200);
  }
  throw new Error("Chrome didn't start");
}

const cdp = await connect(await target());
const evaluate = async (expression) => {
  const r = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");
await cdp.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });

// The split-screen page for the merge scene is served by intercepting one URL (same origin
// as the app, so it can reach both editors inside its frames). Nothing is added to the app.
const board = `demo-merge-${Date.now().toString(36)}`;
const HARNESS = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#05060a;font-family:Inter,Segoe UI,Arial;color:#fff;overflow:hidden}
  .wrap{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:64px 14px 14px;height:${H - 78}px}
  .pane{position:relative;border-radius:18px;overflow:hidden;border:1px solid #ffffff22}
  iframe{width:100%;height:100%;border:0}
  .tag{position:absolute;left:14px;bottom:14px;z-index:5;padding:8px 14px;border-radius:999px;font-weight:800;font-size:15px;background:#1e8f5a;transition:all .4s}
  .tag.off{background:#d6453d}
  h1{position:absolute;top:14px;left:0;right:0;text-align:center;margin:0;font-size:24px;font-weight:800;letter-spacing:-.3px}
  #flash{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;opacity:0;transition:opacity .5s;z-index:9}
  #flash span{background:linear-gradient(90deg,#5b8cff,#b36bff);padding:18px 34px;border-radius:999px;font-size:30px;font-weight:900;box-shadow:0 0 80px #5b8cffaa}
</style></head><body><h1 id="title">Two people, one board</h1>
<div class="wrap"><div class="pane"><iframe id="a" src="/b/${board}"></iframe><div class="tag" id="ta">Ana · online</div></div>
<div class="pane"><iframe id="b" src="/b/${board}"></iframe><div class="tag" id="tb">Ben · online</div></div></div>
<div id="flash"><span>Merged — nothing lost ✨</span></div></body></html>`;
await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*/__demo-merge*" }] });
cdp.on("Fetch.requestPaused", (p) => {
  void cdp.send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "text/html; charset=utf-8" }], body: Buffer.from(HARNESS).toString("base64") });
});

// --- capture ------------------------------------------------------------------------------
const frames = [];
let capturing = false;
let chapter = 0;
cdp.on("Page.screencastFrame", (f) => {
  void cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId });
  if (capturing) frames.push({ t: f.metadata.timestamp, data: f.data, ch: chapter });
});
const startCapture = async () => {
  chapter += 1;
  capturing = true;
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 82, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
};
const pause = async () => {
  capturing = false;
  await cdp.send("Page.stopScreencast");
};
const go = async (url, settle = 3500) => {
  await cdp.send("Page.navigate", { url });
  await sleep(settle);
};
/** A caption chip at the top of the frame for each chapter. */
const caption = (text) =>
  evaluate(`(() => { let c = document.getElementById("__cap"); if (!c) { c = document.createElement("div"); c.id = "__cap"; c.style.cssText = "position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:99999;padding:10px 20px;border-radius:999px;background:rgba(10,12,20,.82);color:#fff;font:700 16px Inter,Segoe UI,Arial;letter-spacing:.2px;border:1px solid rgba(255,255,255,.18);backdrop-filter:blur(10px);box-shadow:0 10px 40px rgba(0,0,0,.4);transition:opacity .4s"; document.body.appendChild(c); } c.textContent = ${JSON.stringify(text)}; c.style.opacity = "1"; })()`);

console.log("1/3 homepage…");
await go(`${APP}/`, 1500);
// A first-time visitor gets the onboarding tour; the demo skips it.
await evaluate(`localStorage.setItem("canvas:tour-done", "1")`);
await go(`${APP}/`, 4500);
await startCapture();
await caption("Tandem — the local-first canvas");
await sleep(2800);
// Glide down through the scroll story and the AI Studio gallery.
const total = await evaluate(`(document.getElementById("ai").offsetTop + document.getElementById("ai").offsetHeight - innerHeight)`);
const steps = 175;
for (let i = 1; i <= steps; i += 1) {
  const p = i / steps;
  const eased = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
  await evaluate(`window.scrollTo(0, ${Math.round(eased * total)})`);
  if (i === Math.round(steps * 0.62)) await caption("AI Studio: decks, charts and 3D that build themselves");
  await sleep(100);
}
await sleep(1500);
await pause();

console.log("2/3 deck in Present mode…");
await go(`${APP}/b/demo-pitch-${Date.now().toString(36)}?template=pitch`, 5000);
await startCapture();
await caption("A designed deck, played in Present mode");
await sleep(1600);
await evaluate(`window.__editor.startPresenting()`);
await sleep(3600);
for (const i of [1, 2, 3]) {
  await evaluate(`window.__editor.goToSlide(${i})`);
  await sleep(2900);
}
await evaluate(`window.__editor.stopPresenting()`);
await sleep(600);
await pause();

console.log("3/3 offline merge…");
await go(`${APP}/__demo-merge`, 7000);
const inFrame = (which, code) => evaluate(`(() => { const w = document.getElementById(${JSON.stringify(which)}).contentWindow; const r = (${code})(w.__editor, w); w.__ui?.getState().setEditing(undefined); return r; })()`);
await startCapture();
await sleep(800);
await evaluate(`document.getElementById("title").textContent = "Both go offline…"`);
await inFrame("a", "(e) => e.setOnline(false)");
await inFrame("b", "(e) => e.setOnline(false)");
await evaluate(`["ta","tb"].forEach((id, i) => { const t = document.getElementById(id); t.textContent = (i ? "Ben" : "Ana") + " · offline"; t.classList.add("off"); })`);
await sleep(1200);
await evaluate(`document.getElementById("title").textContent = "…and keep working on their own copies"`);
const notesA = ["Launch in June", "Beta: 500 teams", "Pricing: $12/mo", "Hire 2 designers"];
const notesB = ["Fix sync on Wi-Fi", "Add dark mode", "Template gallery", "Press kit"];
for (let i = 0; i < 4; i += 1) {
  await inFrame("a", `(e) => { const c = e.viewCenter(); e.createNote({ x: c.x - 260, y: c.y - 200 + ${i} * 120 }, 0xa9cdff); const id = [...e.selected()][0]?.id; if (id) e.setLabel(id, ${JSON.stringify(notesA[i])}); }`);
  await sleep(450);
  await inFrame("b", `(e) => { const c = e.viewCenter(); e.createNote({ x: c.x + 40, y: c.y - 200 + ${i} * 120 }, 0xffc49b); const id = [...e.selected()][0]?.id; if (id) e.setLabel(id, ${JSON.stringify(notesB[i])}); }`);
  await sleep(450);
}
await sleep(1200);
await evaluate(`document.getElementById("title").textContent = "Back online: every edit merges, nothing overwritten"`);
await inFrame("a", "(e) => e.setOnline(true)");
await inFrame("b", "(e) => e.setOnline(true)");
await evaluate(`["ta","tb"].forEach((id, i) => { const t = document.getElementById(id); t.textContent = (i ? "Ben" : "Ana") + " · online"; t.classList.remove("off"); })`);
await sleep(1500);
await evaluate(`document.getElementById("flash").style.opacity = "1"`);
await inFrame("a", "(e) => e.zoomToFit()");
await inFrame("b", "(e) => e.zoomToFit()");
await sleep(3200);
const counts = await evaluate(`[document.getElementById("a").contentWindow.__editor.scene.ordered().length, document.getElementById("b").contentWindow.__editor.scene.ordered().length]`);
console.log(`   shapes on each side after merge: ${counts.join(" / ")}`);
await pause();

// --- encode -------------------------------------------------------------------------------
console.log(`encoding ${frames.length} frames…`);
const dir = join(tmpdir(), `tandem-frames-${Date.now()}`);
mkdirSync(dir, { recursive: true });
// Chapters play back to back; inside one, frames keep their real timing (a still moment
// sends no frames, so the gap is how long it stayed on screen).
const timeline = [];
let clock = 0;
for (let i = 0; i < frames.length; i += 1) {
  const f = frames[i];
  const prev = frames[i - 1];
  const gap = prev && prev.ch === f.ch ? f.t - prev.t : 1 / 30;
  clock += gap > 0 ? Math.min(gap, 6) : 1 / 30;
  writeFileSync(join(dir, `${i}.jpg`), Buffer.from(f.data, "base64"));
  timeline.push(Math.round(clock * 1000));
}
let result;
const server = createServer((req, res) => {
  if (req.method === "POST") {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      result = Buffer.concat(chunks);
      res.end("ok");
    });
    return;
  }
  const n = Number((req.url ?? "").replace(/\D/g, ""));
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.url === "/timeline") return res.end(JSON.stringify(timeline));
  try {
    res.setHeader("Content-Type", "image/jpeg");
    res.end(readFileSync(join(dir,`${n}.jpg`)));
  } catch {
    res.statusCode = 404;
    res.end();
  }
});
// Any free port: a leftover run must not block this one.
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const encoderPort = server.address().port;
await cdp.send("Fetch.disable");
await go(`http://127.0.0.1:${encoderPort}/timeline`, 500);
const ok = await evaluate(`(async () => {
  const timeline = await (await fetch("/timeline")).json();
  const canvas = document.createElement("canvas");
  canvas.width = ${W}; canvas.height = ${H};
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  const images = [];
  for (let i = 0; i < timeline.length; i++) {
    const img = new Image(); img.src = "/" + i; await img.decode(); images.push(img);
  }
  const stream = canvas.captureStream(30);
  const type = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 6_000_000 });
  const parts = [];
  rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
  const done = new Promise((r) => (rec.onstop = r));
  ctx.drawImage(images[0], 0, 0, ${W}, ${H});
  rec.start(1000);
  const start = performance.now();
  let i = 0;
  await new Promise((resolve) => {
    const tick = () => {
      const t = performance.now() - start;
      while (i < timeline.length - 1 && timeline[i + 1] <= t) i++;
      ctx.drawImage(images[i], 0, 0, ${W}, ${H});
      if (t > timeline[timeline.length - 1] + 400) return resolve();
      requestAnimationFrame(tick);
    };
    tick();
  });
  rec.stop();
  await done;
  const blob = new Blob(parts, { type: "video/webm" });
  await fetch("/upload", { method: "POST", body: blob });
  return blob.size;
})()`);
for (let i = 0; i < 50 && !result; i += 1) await sleep(200);
if (!result) throw new Error("encoding failed");
mkdirSync(join(OUT, ".."), { recursive: true });
writeFileSync(OUT, withDuration(result, timeline[timeline.length - 1] + 400));
console.log(`wrote ${OUT} (${(ok / 1e6).toFixed(1)} MB, ${(timeline[timeline.length - 1] / 1000).toFixed(1)} s)`);
server.close();
cdp.close();
chrome.kill();
rmSync(dir, { recursive: true, force: true });
setTimeout(() => rmSync(profile, { recursive: true, force: true }), 1500);
