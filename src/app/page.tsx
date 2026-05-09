import { redirect } from "next/navigation";
import { getServerSession, landingPathFor } from "@/lib/auth-server";

export default async function Home() {
  const session = await getServerSession();
  // Null session can mean either "no JWT" or "JWT exists but no profile".
  // Route through /auth/sign-out so the cookie gets cleared either way —
  // otherwise the second case loops via the middleware.
  if (!session) redirect("/auth/sign-out");
  redirect(landingPathFor(session));
}
