import { redirect } from "next/navigation";

// Convenience alias: the team kept asking for /chart while the canonical
// route is /organization/chart. Redirect so old/short links keep working.
export default function ChartRedirect() {
  redirect("/organization/chart");
}
