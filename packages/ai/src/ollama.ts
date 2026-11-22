import type { ChatMessage } from "./plan.js";

/**
 * Minimal Ollama chat client (streaming). Ollama runs on the user's own machine, so
 * prompts and boards never leave it and there's no per-request cost.
 *
 * The response is NDJSON: one JSON object per line, each with a fragment of the reply.
 * Lines can be split across network chunks, so partial lines are buffered.
 */
export class OllamaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OllamaError";
  }
}

export interface ChatChunk {
  readonly content: string;
  readonly done: boolean;
  /** On the final chunk: tokens generated and generation time. */
  readonly evalCount?: number;
  readonly evalSeconds?: number;
}

export interface ChatOptions {
  readonly url: string;
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly format?: object;
  readonly temperature?: number;
  readonly signal?: AbortSignal;
  readonly fetch?: typeof fetch;
}

interface OllamaLine {
  message?: { content?: string };
  done?: boolean;
  error?: string;
  eval_count?: number;
  eval_duration?: number;
}

export async function* streamChat(options: ChatOptions): AsyncGenerator<ChatChunk> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${options.url.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        stream: true,
        ...(options.format ? { format: options.format } : {}),
        options: { temperature: options.temperature ?? 0.3 },
      }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new OllamaError(`Can't reach Ollama at ${options.url}. Is it running? (ollama serve)`);
  }
  if (!response.ok || !response.body) {
    let detail = `HTTP ${response.status}`;
    try {
      detail = ((await response.json()) as OllamaLine).error ?? detail;
    } catch {
      // keep the status
    }
    if (/not found/i.test(detail)) detail += ` (run: ollama pull ${options.model})`;
    throw new OllamaError(`Ollama: ${detail}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of done ? [...lines, buffer] : lines) {
      if (!line.trim()) continue;
      let parsed: OllamaLine;
      try {
        parsed = JSON.parse(line) as OllamaLine;
      } catch {
        continue; // never fail the whole answer on one garbled line
      }
      if (parsed.error) throw new OllamaError(`Ollama: ${parsed.error}`);
      yield {
        content: parsed.message?.content ?? "",
        done: parsed.done === true,
        ...(parsed.eval_count === undefined ? {} : { evalCount: parsed.eval_count }),
        ...(parsed.eval_duration === undefined ? {} : { evalSeconds: parsed.eval_duration / 1e9 }),
      };
    }
    if (done) return;
  }
}
