import type { EngineCommand, EngineEvent } from "./protocol";

/** UI-thread handle to the engine worker. */
export class EngineClient {
  readonly #worker: Worker;
  readonly #listeners = new Set<(event: EngineEvent) => void>();
  #seq = 0;

  constructor() {
    this.#worker = new Worker(new URL("./engine.worker.ts", import.meta.url), { type: "module" });
    this.#worker.addEventListener("message", (event: MessageEvent<EngineEvent>) => {
      for (const listener of this.#listeners) listener(event.data);
    });
  }

  nextSeq(): number {
    this.#seq += 1;
    return this.#seq;
  }

  send(command: EngineCommand): void {
    this.#worker.postMessage(command);
  }

  subscribe(listener: (event: EngineEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  terminate(): void {
    this.#listeners.clear();
    this.#worker.terminate();
  }
}
