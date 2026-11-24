import type { Presence } from "@canvas/sync";
import { useUiStore } from "../state/ui-store";
import type { Editor } from "./editor";

/**
 * Video calls on the board: everyone in the call connects to everyone else (a mesh, fine
 * for the 2-6 people around one board). Media flows browser to browser; the sync server
 * only relays the few small setup messages (SDP offers/answers and ICE candidates) as
 * SIGNALs, so it never sees audio or video.
 *
 * Who's in the call comes from presence (`call: true`), so there's no join handshake:
 * when two people both have the flag, the one with the smaller client id makes the offer
 * (only one side offers, so the two can't collide).
 *
 * Same network works out of the box. Across the internet, set VITE_ICE_SERVERS to a JSON
 * list of STUN/TURN servers; none are contacted by default.
 */
export interface CallPeer {
  readonly id: string;
  readonly name: string;
  readonly color: number;
  stream: MediaStream | undefined;
  mic: boolean;
  cam: boolean;
  state: RTCPeerConnectionState | "new";
}

type Signal =
  | { readonly t: "sdp"; readonly d: RTCSessionDescriptionInit }
  | { readonly t: "ice"; readonly c: RTCIceCandidateInit }
  | { readonly t: "av"; readonly mic: boolean; readonly cam: boolean };

interface Link {
  readonly pc: RTCPeerConnection;
  readonly queued: RTCIceCandidateInit[];
  readonly peer: CallPeer;
}

function iceServers(): RTCIceServer[] {
  const raw = (import.meta.env as Record<string, string | undefined>).VITE_ICE_SERVERS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as RTCIceServer[]) : [];
  } catch {
    return [];
  }
}

const parseSignal = (data: string): Signal | undefined => {
  try {
    const s = JSON.parse(data) as Signal;
    if (s && (s.t === "sdp" || s.t === "ice" || s.t === "av")) return s;
  } catch {
    // not a call message
  }
  return undefined;
};

export class Call {
  readonly #editor: Editor;
  readonly #links = new Map<string, Link>();
  readonly #listeners = new Set<() => void>();
  #me = "";
  #local: MediaStream | undefined;
  #mic = true;
  #cam = true;
  #version = 0;

  constructor(editor: Editor) {
    this.#editor = editor;
    editor.engine.subscribe((event) => {
      if (event.type === "restored") this.#me = event.clientId;
      else if (event.type === "signal") void this.#onSignal(event.from, event.data);
      else if (event.type === "presence") this.#onPresence(event.clientId, event.presence);
    });
  }

  get joined(): boolean {
    return useUiStore.getState().call;
  }
  get local(): MediaStream | undefined {
    return this.#local;
  }
  get mic(): boolean {
    return this.#mic;
  }
  get cam(): boolean {
    return this.#cam;
  }
  get version(): number {
    return this.#version;
  }
  peers(): CallPeer[] {
    return [...this.#links.values()].map((l) => l.peer);
  }
  /** People in the call right now (from presence), whether or not I've joined. */
  inCall(): { id: string; name: string; color: number }[] {
    return this.#editor.peers
      .list()
      .filter((p) => p.presence.call)
      .map((p) => ({ id: p.clientId, name: p.presence.name, color: p.presence.color }));
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  #changed(): void {
    this.#version += 1;
    for (const l of this.#listeners) l();
  }

  async join(video = true): Promise<void> {
    if (this.joined) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      useUiStore.getState().setNotice("This browser can't make calls (needs HTTPS or localhost)");
      return;
    }
    try {
      this.#local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: video ? { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" } : false });
    } catch {
      try {
        // No camera (or it's busy): join with the microphone only.
        this.#local = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        useUiStore.getState().setNotice("Allow the microphone or camera to join the call");
        return;
      }
    }
    this.#mic = this.#local.getAudioTracks().some((t) => t.enabled);
    this.#cam = this.#local.getVideoTracks().length > 0;
    this.#editor.setInCall(true);
    for (const p of this.inCall()) this.#connect(p.id, p.name, p.color);
    this.#changed();
  }

  leave(): void {
    for (const id of [...this.#links.keys()]) this.#drop(id);
    for (const t of this.#local?.getTracks() ?? []) t.stop();
    this.#local = undefined;
    this.#editor.setInCall(false);
    this.#changed();
  }

  toggleMic(): void {
    this.#mic = !this.#mic;
    for (const t of this.#local?.getAudioTracks() ?? []) t.enabled = this.#mic;
    this.#broadcastAv();
  }

  toggleCam(): void {
    this.#cam = !this.#cam;
    for (const t of this.#local?.getVideoTracks() ?? []) t.enabled = this.#cam;
    this.#broadcastAv();
  }

  #broadcastAv(): void {
    for (const id of this.#links.keys()) this.#send(id, { t: "av", mic: this.#mic, cam: this.#cam && (this.#local?.getVideoTracks().length ?? 0) > 0 });
    this.#changed();
  }

  #send(to: string, signal: Signal): void {
    this.#editor.engine.send({ type: "signal", to, data: JSON.stringify(signal) });
  }

  #onPresence(id: string, presence: Presence | null): void {
    if (!this.joined) return;
    if (presence?.call) this.#connect(id, presence.name, presence.color);
    else if (this.#links.has(id)) {
      this.#drop(id);
      this.#changed();
    }
  }

  #connect(id: string, name: string, color: number): Link {
    const existing = this.#links.get(id);
    if (existing) return existing;
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    const peer: CallPeer = { id, name, color, stream: undefined, mic: true, cam: true, state: "new" };
    const link: Link = { pc, queued: [], peer };
    this.#links.set(id, link);
    pc.onicecandidate = (e) => {
      if (e.candidate) this.#send(id, { t: "ice", c: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      peer.stream = e.streams[0] ?? new MediaStream([e.track]);
      this.#changed();
    };
    pc.onconnectionstatechange = () => {
      peer.state = pc.connectionState;
      if (pc.connectionState === "connected") this.#send(id, { t: "av", mic: this.#mic, cam: this.#cam && (this.#local?.getVideoTracks().length ?? 0) > 0 });
      this.#changed();
    };
    const offerer = this.#me !== "" && this.#me < id;
    if (offerer) {
      for (const kind of ["audio", "video"] as const) {
        const track = this.#local?.getTracks().find((t) => t.kind === kind);
        if (track && this.#local) pc.addTrack(track, this.#local);
        else pc.addTransceiver(kind, { direction: "recvonly" });
      }
      void (async () => {
        await pc.setLocalDescription(await pc.createOffer());
        if (pc.localDescription) this.#send(id, { t: "sdp", d: pc.localDescription.toJSON() });
      })().catch((error: unknown) => console.warn("call: offer failed", error));
    }
    this.#changed();
    return link;
  }

  async #onSignal(from: string, data: string): Promise<void> {
    const signal = parseSignal(data);
    if (!signal || !this.joined) return;
    const known = this.#editor.peers.list().find((p) => p.clientId === from);
    const link = this.#links.get(from) ?? (signal.t === "sdp" && signal.d.type === "offer" ? this.#connect(from, known?.presence.name ?? "Guest", known?.presence.color ?? 0x5b8cff) : undefined);
    if (!link) return;
    const { pc } = link;
    try {
      if (signal.t === "sdp") {
        await pc.setRemoteDescription(signal.d);
        for (const c of link.queued.splice(0)) await pc.addIceCandidate(c);
        if (signal.d.type === "offer") {
          for (const track of this.#local?.getTracks() ?? []) if (this.#local) pc.addTrack(track, this.#local);
          await pc.setLocalDescription(await pc.createAnswer());
          if (pc.localDescription) this.#send(from, { t: "sdp", d: pc.localDescription.toJSON() });
        }
      } else if (signal.t === "ice") {
        // Candidates can beat the description they belong to: hold them until it lands.
        if (pc.remoteDescription) await pc.addIceCandidate(signal.c);
        else link.queued.push(signal.c);
      } else {
        link.peer.mic = signal.mic;
        link.peer.cam = signal.cam;
        this.#changed();
      }
    } catch (error) {
      console.warn("call: signal failed", error);
    }
  }

  #drop(id: string): void {
    const link = this.#links.get(id);
    if (!link) return;
    link.pc.close();
    this.#links.delete(id);
  }
}

const calls = new WeakMap<Editor, Call>();
/** One call per board (per editor). */
export function callFor(editor: Editor): Call {
  let call = calls.get(editor);
  if (!call) {
    call = new Call(editor);
    calls.set(editor, call);
  }
  return call;
}
