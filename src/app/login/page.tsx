"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError("البريد الإلكتروني أو كلمة المرور غير صحيحة");
      setLoading(false);
      return;
    }

    // Server-side `/` resolves to the role's home page via landingPathFor.
    router.push("/");
  }

  return (
    <div className="min-h-screen bg-[#07090F] flex items-center justify-center px-4" dir="rtl">
      {/* Background effects */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle at top right, rgba(0,212,255,0.12), transparent 24%), radial-gradient(circle at top left, rgba(139,92,246,0.08), transparent 22%)",
        }}
      />

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan/30 to-[#8B5CF6]/30 ring-1 ring-white/10 mb-4">
            <span className="text-lg font-extrabold tracking-[0.2em] text-[#00D4FF]">CC</span>
          </div>
          <h1 className="text-2xl font-extrabold text-[#F1F5F9]">لوحة التحكم</h1>
          <p className="text-sm text-[#94A3B8] mt-1">تسجيل الدخول إلى لوحة التحكم</p>
        </div>

        {/* Login card */}
        <form
          onSubmit={handleSubmit}
          className="rounded-2xl p-6 space-y-5"
          style={{
            backgroundColor: "#111827",
            border: "1px solid rgba(0,212,255,0.2)",
            boxShadow: "0 0 30px rgba(0,212,255,0.08), inset 0 1px 0 rgba(255,255,255,0.04)",
          }}
        >
          <div className="space-y-2">
            <label className="text-xs text-[#94A3B8]">البريد الإلكتروني</label>
            <input
              type="email"
              name="email"
              required
              className="w-full rounded-xl bg-white/[0.04] border border-white/10 px-4 py-3 text-sm text-[#F1F5F9] placeholder:text-[#94A3B8]/50 focus:outline-none focus:ring-2 focus:ring-[#00D4FF]/30 focus:border-[#00D4FF]/50 transition-colors"
              placeholder="admin@example.com"
              dir="ltr"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs text-[#94A3B8]">كلمة المرور</label>
            <input
              type="password"
              name="password"
              required
              className="w-full rounded-xl bg-white/[0.04] border border-white/10 px-4 py-3 text-sm text-[#F1F5F9] placeholder:text-[#94A3B8]/50 focus:outline-none focus:ring-2 focus:ring-[#00D4FF]/30 focus:border-[#00D4FF]/50 transition-colors"
              placeholder="••••••••"
              dir="ltr"
            />
          </div>

          {error && (
            <p className="text-sm text-[#EF4444] bg-[#EF4444]/10 rounded-xl px-4 py-2.5 border border-[#EF4444]/20">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-[#00D4FF] hover:bg-[#00D4FF]/90 text-[#07090F] font-bold py-3 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "جاري تسجيل الدخول..." : "تسجيل الدخول"}
          </button>
        </form>

        <p className="text-center text-[10px] text-[#94A3B8]/50 mt-6">
          لوحة التحكم &copy; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
