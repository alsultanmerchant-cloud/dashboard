import type { Metadata } from "next";
import { Tajawal, Inter } from "next/font/google";
import { Toaster } from "sonner";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { ThemeProvider } from "@/components/theme-provider";
import { getLocale } from "@/i18n/locale";
import { dirFor } from "@/i18n/config";
import "./globals.css";

const tajawal = Tajawal({
  variable: "--font-tajawal",
  subsets: ["arabic", "latin"],
  weight: ["200", "300", "400", "500", "700", "800", "900"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App");
  return {
    title: t("title"),
    description: t("description"),
    applicationName: "Agency Command Center",
  };
}

// Inline script: apply theme class before paint to avoid FOUC.
const themeBootstrap = `(function(){try{var k='rwasem-theme';var t=localStorage.getItem(k);if(t!=='light'&&t!=='dark')t='light';if(t==='dark')document.documentElement.classList.add('dark');document.documentElement.style.colorScheme=t;}catch(e){}})();`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const dir = dirFor(locale);
  const messages = await getMessages();

  return (
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className={`${tajawal.variable} ${inter.variable} antialiased`}>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider defaultTheme="light">
            {children}
            <Toaster
              position="top-center"
              richColors
              closeButton
              dir={dir}
              toastOptions={{
                style: { fontFamily: "var(--font-tajawal), sans-serif" },
              }}
            />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
