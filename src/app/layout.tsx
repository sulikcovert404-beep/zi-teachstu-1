import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "پلتفرم آموزش هوشمند ایران",
  description:
    "پلتفرم آموزشی هوشمند فارسی برای دانش‌آموزان، معلمان، مدارس و مدیران — با دستیار هوش مصنوعی، آزمون‌سازی، تحلیل یادگیری و برنامه‌ریزی مطالعه.",
  keywords: ["آموزش", "هوش مصنوعی", "مدرسه", "آزمون", "معلم", "دانش‌آموز"],
  icons: { icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#0f766e",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa-IR" dir="rtl" suppressHydrationWarning>
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css"
        />
        {/* Telegram Mini App SDK (round 16) — inert in normal browsers; inside Telegram
            it provides window.Telegram.WebApp (initData, theme, haptics). */}
        <script src="https://telegram.org/js/telegram-web-app.js" async defer />
      </head>
      <body className="font-sans antialiased bg-background text-foreground min-h-screen">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
