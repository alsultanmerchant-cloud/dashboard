import type { Metadata } from "next";
import { Tajawal } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const tajawal = Tajawal({
  variable: "--font-tajawal",
  subsets: ["arabic", "latin"],
  weight: ["200", "300", "400", "500", "700", "800", "900"],
});

export const metadata: Metadata = {
  title: "مركز قيادة الوكالة",
  description: "نظام تشغيل داخلي ذكي للوكالة — العملاء والمشاريع والمهام والتسليم من المبيعات.",
  applicationName: "Agency Command Center",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body className={`${tajawal.variable} antialiased`}>
        {children}
        <Toaster
          position="top-center"
          richColors
          closeButton
          dir="rtl"
          theme="dark"
          toastOptions={{
            style: { fontFamily: "var(--font-tajawal), sans-serif" },
          }}
        />
      </body>
    </html>
  );
}
