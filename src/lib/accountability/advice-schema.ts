import { z } from "zod";

// On-demand advice for ONE accountability case. Generated only when a manager
// clicks "توليد نصيحة" — the page itself never prescribes actions. Grounded
// strictly in the case's code-computed facts (problem tags, proof, ledger).
// Audience = the manager handling the case.
export const CaseAdviceSchema = z.object({
  // One-line framing of what this case is really about.
  headline: z.string(),
  // 2-3 sentences: the likely root cause, read only from the given evidence.
  diagnosis: z.string(),
  // Concrete steps the MANAGER should take next (talk track, unblock, follow-up).
  steps: z.array(z.string()).max(6).default([]),
  // A short, respectful note the manager can relay to the employee (nullable).
  coachingNote: z.string().nullable().default(null),
  // Early-warning signs to watch so this does not repeat.
  watchFor: z.array(z.string()).max(3).default([]),
});

export type CaseAdvice = z.infer<typeof CaseAdviceSchema>;
