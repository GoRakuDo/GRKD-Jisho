// Model display configuration
// Central registry for model ID → display name mapping

export interface ModelDisplayInfo {
  id: string; // Raw model ID stored in DB
  displayName: string; // Human-readable name
  provider: string; // Provider category
}

export const MODEL_REGISTRY: ModelDisplayInfo[] = [
  {
    id: "google/gemma-4-31b-it:free",
    displayName: "Gemma 4 31B",
    provider: "OpenRouter",
  },
  {
    id: "google/gemini-3.1-flash-lite",
    displayName: "Gemini 3.1 Flash Lite",
    provider: "Google Gemini",
  },
];

/**
 * Look up display info for a model ID.
 * Returns the raw model ID and "Unknown" provider if not found.
 */
export function getModelDisplayInfo(modelId: string): {
  displayName: string;
  provider: string;
} {
  const entry = MODEL_REGISTRY.find((m) => m.id === modelId);
  if (entry) {
    return { displayName: entry.displayName, provider: entry.provider };
  }
  // Fallback for legacy model IDs
  if (modelId === "gemma-4-31b-it") {
    return { displayName: "Gemma 4 31B (old)", provider: "Google Gemini" };
  }
  if (modelId === "openrouter/free") {
    return { displayName: "OpenRouter Free (old)", provider: "OpenRouter" };
  }
  return { displayName: modelId, provider: "Unknown" };
}
