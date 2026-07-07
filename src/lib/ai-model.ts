// Single source of truth for every AI surface's model.
//
// All models route through the Vercel AI Gateway (one key — AI_GATEWAY_API_KEY —
// one provider, automatic fallback) instead of talking to Google directly, so
// each surface can pick the cheapest model that is good enough for its task
// instead of paying frontier price (gemini-3.1-pro = $2/$12 per M tok) for
// everything. Tune per-area in ONE place: the MODELS map.
//
// Model choices are backed by a Sonnet-4.6-judged bake-off on the hardest
// (client-satisfaction) surface + the live gateway price list:
//   flagship  gemini-3.1-pro   accuracy 73  — kept for high-stakes analysis
//   arabicHiQ gemini-3-flash   accuracy 61  — exec-read wording (CEO brief)
//   arabicGen gemini-2.5-flash-lite         — Arabic narrative, ~25× cheaper
//   mechanical gpt-5-nano                    — SIMPLE JSON only (fails rich schemas)
import { gateway } from "ai";
import type { LanguageModel } from "ai";

export const MODELS = {
  /** Highest-stakes Arabic analysis (feeds exec decisions) — satisfaction. */
  flagship: "google/gemini-3.1-pro-preview", // $2 / $12
  /** Exec-read Arabic wording where tone matters most — CEO brief. */
  arabicHiQ: "google/gemini-3-flash", // $0.50 / $3
  /** Arabic narrative, lower stakes — insights, reports, tips, coaching. */
  arabicGen: "google/gemini-2.5-flash-lite", // $0.10 / $0.40
  /** In-app assistant + tool-use. */
  agent: "google/gemini-2.5-flash-lite", // $0.10 / $0.40
  /** Mechanical rank/classify → SIMPLE JSON only (strict-mode fails nullable/anyOf). */
  mechanical: "openai/gpt-5-nano", // $0.05 / $0.40
  /** Web-search-native model (grounded answers from a plain prompt) — agent tool. */
  webSearch: "openai/gpt-4o-mini-search-preview", // $0.15 / $0.60
} as const;

export type ModelRole = keyof typeof MODELS;

/** Resolve a role to a gateway-routed LanguageModel. */
export function aiModel(role: ModelRole): LanguageModel {
  return gateway(MODELS[role]);
}

// Back-compat string default (pointed at the general Arabic model). Existing
// call-sites that still pass a bare id string — or store the model id — keep
// working; the value is a valid gateway id too.
export const GEMINI_MODEL: string = MODELS.arabicGen;
