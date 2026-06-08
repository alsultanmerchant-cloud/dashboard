import { analyzeClientSatisfaction } from "@/lib/satisfaction-analyze";

const ORG = "11111111-1111-1111-1111-111111111111";
const CLIENTS: Array<[string, string]> = [
  ["saee", "55351ced-452e-4f7d-9428-0614ba0e3d80"],
  ["بيت التغذية - TNH", "16ce381b-4352-4d8e-acba-9dadf935a7ab"],
  ["مؤسسة اتوز فيرنتشر", "cf9a8cb9-26fa-4115-ad17-f256e21f7a79"],
  ["radiology", "c9c7f4f2-a727-4d51-b8fe-4925fe87fb26"],
];

for (const [name, id] of CLIENTS) {
  try {
    const t0 = Date.now();
    const { result } = await analyzeClientSatisfaction(ORG, id, null);
    const ms = Date.now() - t0;
    console.log(
      `✓ ${name}: sat=${result.satisfactionScore} brief=${result.briefAdherenceScore} sentiment=${result.sentiment} highlights=${result.highlights.length} risks=${result.risks.length} (${ms}ms)`,
    );
  } catch (e) {
    console.log(`✗ ${name}: ${(e as Error).message}`);
  }
}
