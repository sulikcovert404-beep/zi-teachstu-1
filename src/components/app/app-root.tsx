"use client";

import { useEffect } from "react";
import { useAuth } from "@/lib/app/auth-store";
import { LoginScreen } from "./login-screen";
import { AuthenticatedApp } from "./authenticated-app";
import { Loader2, GraduationCap } from "lucide-react";
import { mountTelegramWebApp, applyTelegramColorScheme } from "@/lib/telegram/webapp";

// Root of the SPA. Renders the Mini-App gateway semantics (spec §21):
// authenticated → role dashboard; unauthenticated → login (web channel) / Telegram bootstrap.
// Inside a Telegram Mini App: SDK mounted (ready/expand), color scheme synced,
// initData login attempted in the auth bootstrap (round 16).
export function AppRoot() {
  const { status, bootstrap } = useAuth();

  useEffect(() => {
    mountTelegramWebApp();
    applyTelegramColorScheme();
    void bootstrap();
  }, [bootstrap]);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {status === "bootstrapping" && (
        <div className="flex-1 flex flex-col items-center justify-center gap-5 p-8">
          <div className="relative">
            <div
              aria-hidden
              className="animate-soft-pulse absolute inset-0 rounded-3xl bg-primary/30 blur-2xl"
            />
            <div className="relative h-16 w-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center shadow-xl shadow-primary/25">
              <GraduationCap className="h-9 w-9" aria-hidden />
            </div>
            <span className="absolute -bottom-1 -left-1 flex h-6 w-6 items-center justify-center rounded-full bg-background">
              <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
            </span>
          </div>
          <p className="text-muted-foreground text-sm">در حال بارگذاری پلتفرم آموزش هوشمند…</p>
        </div>
      )}
      {status === "unauthenticated" && <LoginScreen />}
      {status === "authenticated" && <AuthenticatedApp />}
      {status === "error" && (
        <div className="flex-1 flex items-center justify-center p-8">
          <p className="text-destructive">خطایی رخ داد. لطفاً صفحه را دوباره بارگذاری کنید.</p>
        </div>
      )}
    </div>
  );
}

export default AppRoot;
