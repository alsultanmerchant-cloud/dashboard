import { redirect } from "next/navigation";
import { getServerSession, landingPathFor } from "@/lib/auth-server";

export default async function Home() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  redirect(landingPathFor(session));
}
