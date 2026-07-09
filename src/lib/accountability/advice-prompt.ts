import { createHash } from "node:crypto";
import type { AccountabilityCase } from "@/lib/data/accountability-cases";

const SEVERITY_AR: Record<string, string> = {
  critical: "حرجة",
  proven: "مثبتة",
  signal: "إشارة",
};
const STREAM_AR: Record<string, string> = {
  execution: "تنفيذ",
  client: "صوت العميل",
  commercial: "تجاري",
};

// Signature over exactly the facts the advice is grounded in, so cached advice
// invalidates when the case changes (new proof, severity shift, workload move).
export function adviceSignature(c: AccountabilityCase): string {
  const basis = {
    sev: c.severity,
    st: [...c.streams].sort(),
    tags: [...c.problemTags].sort(),
    proof: c.proof.map((p) => `${p.stream}:${p.kind}:${p.taskCode ?? ""}:${p.text}`),
    led: c.ledger
      ? [c.ledger.openTasks, c.ledger.overdueOwned, c.ledger.onTimeRate, c.ledger.actions30d]
      : null,
  };
  return createHash("sha1").update(JSON.stringify(basis)).digest("hex");
}

// Render the case as a compact factual brief for the model.
export function buildCaseAdvicePrompt(c: AccountabilityCase, knowledgeBlock: string): string {
  const led = c.ledger;
  const ledgerLine = led
    ? `المهام المفتوحة ${led.openTasks}، المتأخرة ${led.overdueOwned}، الالتزام بالمواعيد ${
        led.onTimeRate === null ? "غير مقاس" : `${led.onTimeRate}%`
      }، إجراءات ٣٠ يومًا ${led.actions30d} على ${led.activeDays} يوم عمل، آخر إجراء منذ ${
        led.daysSinceLastAction === null ? "غير معروف" : `${led.daysSinceLastAction} يوم`
      }.`
    : "لا توجد بيانات تنفيذ مقاسة.";

  const proofByStream = (["execution", "client", "commercial"] as const)
    .map((s) => {
      const lines = c.proof.filter((p) => p.stream === s);
      if (lines.length === 0) return "";
      const body = lines
        .map((p) => `  - ${p.text}${p.crossLinked ? " [دليل متقاطع بين مصدرين]" : ""}`)
        .join("\n");
      return `${STREAM_AR[s]}:\n${body}`;
    })
    .filter(Boolean)
    .join("\n");

  return `أنت مستشار عمليات في وكالة تسويق سعودية. مهمتك أن تعطي المدير المسؤول نصيحة عملية وواقعية للتعامل مع قضية مساءلة لأحد أعضاء الفريق. اكتب بالعربية.

قواعد صارمة:
- استند فقط إلى الحقائق أدناه. لا تخترع أرقامًا أو مهامًا أو أحداثًا غير مذكورة.
- النبرة مهنية ومحترمة وبنّاءة، لا اتهامية. الهدف حل المشكلة لا التوبيخ.
- النصيحة موجّهة للمدير: ماذا يفعل، وكيف يفتح الحوار مع الموظف، وكيف يزيل العائق ويتابع.
- إن كانت الأدلة ضعيفة أو من مصدر واحد، اجعل النصيحة تحققية (تأكّد أولًا) لا عقابية.

القضية:
- الموظف: ${c.employeeName}${c.role ? ` — ${c.role}` : ""}${c.department ? ` (${c.department})` : ""}
- الخطورة: ${SEVERITY_AR[c.severity] ?? c.severity} (من مصادر: ${c.streams.map((s) => STREAM_AR[s] ?? s).join("، ")})
- أنواع المشكلة: ${c.problemTags.join("، ")}
- المؤشرات: ${ledgerLine}
${c.clientNames.length ? `- عملاء متأثرون: ${c.clientNames.join("، ")}` : ""}

الأدلة:
${proofByStream}
${knowledgeBlock ? `\n\n${knowledgeBlock}` : ""}`;
}
