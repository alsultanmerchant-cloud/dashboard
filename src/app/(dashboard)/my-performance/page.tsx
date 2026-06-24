import { redirect } from "next/navigation";

// "أدائي" was merged into "لوحتي" (the dashboard): Delivery Commitment + monthly
// history now live there, and "learn from your delays" moved to the head
// dashboard. Old links/bookmarks land on the unified dashboard.
export default function MyPerformancePage() {
  redirect("/dashboard");
}
