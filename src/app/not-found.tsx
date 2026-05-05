import Link from "next/link";
import { Search, Home } from "lucide-react";
import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const tNF = await getTranslations("NotFound");
  const tA = await getTranslations("Actions");
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-2xl bg-cyan-dim text-cyan ring-1 ring-cyan/30 shadow-[0_0_30px_rgba(0,212,255,0.18)]">
          <Search className="size-7" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{tNF("title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{tNF("description")}</p>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Home className="size-4" />
          {tA("backToHome")}
        </Link>
      </div>
    </main>
  );
}
