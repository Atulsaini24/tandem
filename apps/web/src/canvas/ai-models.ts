/**
 * Which local model the AI uses. Bigger = smarter and slower. The choice is a per-viewer
 * convenience in localStorage; the default is the best model that's actually installed.
 */
export const OLLAMA_URL = (import.meta.env.VITE_OLLAMA_URL as string | undefined) ?? "http://localhost:11434";

export interface ModelInfo {
  readonly name: string;
  /** Short description for the picker. */
  readonly blurb: string;
  readonly sizeGb: number;
}

/** Best first. Anything else installed is listed after these. */
const PREFERRED: ReadonlyArray<{ match: RegExp; blurb: string }> = [
  { match: /^qwen3:4b/, blurb: "Smart · fast (recommended)" },
  { match: /^qwen3:(8b|14b)/, blurb: "Smartest · slow on small GPUs" },
  { match: /^gemma3:12b/, blurb: "Smart · slower" },
  { match: /^qwen3/, blurb: "Balanced" },
  { match: /^gemma3:4b/, blurb: "Fast · basic answers" },
];

const KEY = "canvas:ai-model";
const env = import.meta.env.VITE_OLLAMA_MODEL as string | undefined;

/** Models that think out loud unless told not to (see ChatOptions.think). */
export const isReasoningModel = (model: string): boolean => /^(qwen3|deepseek-r1|gpt-oss|magistral)/.test(model);

export function chatOptions(model: string): { url: string; model: string; think?: boolean } {
  return isReasoningModel(model) ? { url: OLLAMA_URL, model, think: false } : { url: OLLAMA_URL, model };
}

export function savedModel(): string | undefined {
  try {
    return localStorage.getItem(KEY) ?? env ?? undefined;
  } catch {
    return env;
  }
}

export function saveModel(model: string): void {
  try {
    localStorage.setItem(KEY, model);
  } catch {
    // storage blocked: the choice just won't survive a reload
  }
}

/** Installed chat models, best first. Empty when Ollama isn't running. */
export async function listModels(): Promise<ModelInfo[]> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`);
    const body = (await response.json()) as { models?: Array<{ name: string; size: number }> };
    const models = (body.models ?? []).filter((m) => !/embed/.test(m.name));
    // Over ~12 GB won't load on a typical 16 GB laptop: listed last, flagged.
    const huge = (size: number): boolean => size > 12e9;
    const rank = (m: { name: string; size: number }): number => {
      if (huge(m.size)) return PREFERRED.length + 1;
      const i = PREFERRED.findIndex((p) => p.match.test(m.name));
      return i < 0 ? PREFERRED.length : i;
    };
    return models
      .sort((a, b) => rank(a) - rank(b))
      .map((m) => ({
        name: m.name,
        sizeGb: Math.round((m.size / 1e9) * 10) / 10,
        blurb: huge(m.size) ? "Needs a lot of memory" : (PREFERRED.find((p) => p.match.test(m.name))?.blurb ?? "Installed"),
      }));
  } catch {
    return [];
  }
}
