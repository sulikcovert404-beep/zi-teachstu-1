"use client";

import { useState } from "react";
import { useAuth } from "@/lib/app/auth-store";
import { api } from "@/lib/app/api-client";
import { isInTelegram, tgHaptic } from "@/lib/telegram/webapp";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  GraduationCap,
  LogIn,
  Loader2,
  Sparkles,
  BookOpenCheck,
  ShieldCheck,
  LineChart,
  Mail,
  Lock,
  Eye,
  EyeOff,
  CircleAlert,
  BookOpen,
  School,
  Building2,
  Bot,
  ClipboardCheck,
  KeyRound,
  Send,
  CheckCircle2,
} from "lucide-react";

const DEMO_ACCOUNTS = [
  {
    email: "student@school.ir",
    label: "دانش‌آموز",
    name: "سارا احمدی",
    icon: GraduationCap,
    tint: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  {
    email: "teacher@school.ir",
    label: "معلم",
    name: "مریم محمدی",
    icon: BookOpen,
    tint: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
  },
  {
    email: "admin@school.ir",
    label: "مدیر مدرسه",
    name: "علی رضایی",
    icon: School,
    tint: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  {
    email: "owner@platform.ir",
    label: "مدیر کل پلتفرم",
    name: "مدیر پلتفرم",
    icon: Building2,
    tint: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  },
];

// Hero showcase (right column in RTL) — glassy feature cards on the dark emerald panel
const FEATURES = [
  {
    icon: Sparkles,
    title: "دستیار آموزشی هوشمند",
    desc: "پاسخ مرحله‌به‌مرحله با مثال و تمرین",
    tile: "bg-emerald-400/15 text-emerald-200",
  },
  {
    icon: BookOpenCheck,
    title: "آزمون‌سازی و تصحیح خودکار",
    desc: "تصحیح سمت سرور و نتایج شفاف",
    tile: "bg-teal-400/15 text-teal-200",
  },
  {
    icon: LineChart,
    title: "تحلیل یادگیری واقعی",
    desc: "پیشرفت فقط از داده واقعی شما",
    tile: "bg-amber-400/15 text-amber-200",
  },
  {
    icon: ShieldCheck,
    title: "امن و چندسازمانی",
    desc: "جداسازی کامل داده مدارس",
    tile: "bg-rose-400/15 text-rose-200",
  },
];

// Honest capability highlights (no fabricated KPIs)
const HIGHLIGHTS = [
  { icon: Building2, label: "چند-مدرسه‌ای" },
  { icon: Bot, label: "دستیار هوشمند ۲۴/۷" },
  { icon: ClipboardCheck, label: "تصحیح خودکار آزمون" },
];

// Web login (spec §40 — web must be able to login independently of Telegram).
// Round 16 — Telegram-aware: when the Mini App opens unlinked, a Persian banner
// explains linking; after a successful email/password login INSIDE Telegram the
// account is auto-linked via verified initData (one-time, then auto-login forever).
export function LoginScreen() {
  const { login, telegramLink } = useAuth();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // After a successful login inside the Telegram Mini App, link this telegram
  // identity to the freshly-authenticated account (best effort, non-blocking).
  async function autoLinkTelegram() {
    if (!isInTelegram()) return;
    try {
      const initData = (window as any).Telegram?.WebApp?.initData as string;
      if (!initData) return;
      const res = await api<{ linked: boolean; botUsername: string | null }>(
        "/api/v1/auth/telegram/link",
        { method: "POST", body: JSON.stringify({ initData }) }
      );
      if (res?.linked) {
        tgHaptic("success");
        toast({
          title: "اتصال به تلگرام انجام شد ✅",
          description: "از این پس با باز کردن مینی‌اپ، مستقیم وارد حساب خود می‌شوید.",
        });
      }
    } catch {
      /* linking is best-effort — login itself already succeeded */
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
      await autoLinkTelegram();
    } catch (err: any) {
      setError(err?.message ?? "ورود ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }

  async function quickLogin(demoEmail: string) {
    if (busy) return;
    setEmail(demoEmail);
    setPassword("123456");
    setError(null);
    setBusy(true);
    try {
      await login(demoEmail, "123456");
      await autoLinkTelegram();
    } catch (err: any) {
      setError(err?.message ?? "ورود ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid flex-1 lg:grid-cols-2 xl:grid-cols-[1.12fr_1fr]">
      {/* ===== Hero panel (right column in RTL; compact header on mobile) ===== */}
      <section
        aria-labelledby="login-hero-title"
        className="relative isolate overflow-hidden bg-gradient-to-br from-emerald-950 via-teal-950 to-emerald-900 text-white max-lg:mx-4 max-lg:mt-4 max-lg:rounded-3xl lg:min-h-screen lg:flex lg:flex-col lg:justify-center"
      >
        {/* Decorative layers (CSS-only) */}
        <div
          aria-hidden
          className="hero-dot-grid absolute inset-0 opacity-70 [mask-image:linear-gradient(to_bottom,black_25%,transparent_90%)]"
        />
        <div
          aria-hidden
          className="animate-float-slow absolute -right-24 -top-32 h-96 w-96 rounded-full bg-emerald-400/20 blur-3xl"
        />
        <div
          aria-hidden
          className="animate-float-slow absolute -bottom-24 -left-28 h-80 w-80 rounded-full bg-teal-400/15 blur-3xl"
          style={{ animationDelay: "-3.5s" }}
        />
        <div
          aria-hidden
          className="animate-float-slow absolute left-1/3 top-1/4 h-56 w-56 rounded-full bg-amber-300/10 blur-3xl"
          style={{ animationDelay: "-7s" }}
        />
        <GraduationCap
          aria-hidden
          className="pointer-events-none absolute -bottom-12 -left-12 hidden h-72 w-72 text-white/[0.045] lg:block"
        />

        <div className="relative z-10 mx-auto flex w-full max-w-xl flex-col gap-7 p-6 sm:gap-8 sm:p-8 max-lg:items-center max-lg:text-center lg:gap-9 lg:p-12">
          {/* Kicker pill */}
          <span className="animate-fade-up inline-flex items-center gap-1.5 self-start rounded-full bg-white/10 px-3 py-1 text-[11px] font-medium text-emerald-100 ring-1 ring-white/15 backdrop-blur-sm max-lg:self-center">
            <Sparkles className="h-3.5 w-3.5 text-amber-200" aria-hidden />
            قدرت‌گرفته از هوش مصنوعی
          </span>

          {/* Logo mark + title */}
          <div
            className="animate-fade-up flex flex-col items-center gap-4 text-center lg:flex-row lg:gap-4 lg:text-start"
            style={{ animationDelay: "90ms" }}
          >
            <div className="relative shrink-0">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 text-white shadow-xl shadow-emerald-950/40 ring-1 ring-white/25 sm:h-16 sm:w-16">
                <GraduationCap className="h-7 w-7 sm:h-8 sm:w-8" aria-hidden />
              </div>
              <span className="absolute -left-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-amber-300 text-emerald-950 shadow-md ring-1 ring-white/40">
                <Sparkles className="h-3 w-3" aria-hidden />
              </span>
            </div>
            <div className="space-y-1.5">
              <h1
                id="login-hero-title"
                className="text-xl font-extrabold leading-8 tracking-tight text-white sm:text-2xl lg:text-3xl lg:leading-10"
              >
                پلتفرم آموزش هوشمند ایران
              </h1>
              <p className="text-sm leading-6 text-emerald-100/75 sm:text-base">
                آموزش شخصی‌سازی‌شده — از کلاس درس تا آزمون
              </p>
            </div>
          </div>

          {/* Feature showcase — 2×2 glass cards (desktop) */}
          <div className="hidden gap-3 sm:gap-4 lg:grid lg:grid-cols-2">
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                className="animate-fade-up rounded-xl border border-white/10 bg-white/[0.05] p-4 backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.09]"
                style={{ animationDelay: `${180 + i * 90}ms` }}
              >
                <div
                  className={cn(
                    "mb-3 flex h-9 w-9 items-center justify-center rounded-lg ring-1 ring-inset ring-white/10",
                    f.tile
                  )}
                >
                  <f.icon className="h-4.5 w-4.5" aria-hidden />
                </div>
                <p className="text-sm font-bold text-white/95">{f.title}</p>
                <p className="mt-1 text-xs leading-5 text-emerald-100/60">{f.desc}</p>
              </div>
            ))}
          </div>

          {/* Capability strip (honest, no fabricated numbers) */}
          <div
            className="animate-fade-up border-t border-white/10 pt-5"
            style={{ animationDelay: "540ms" }}
          >
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5 max-lg:justify-center">
              {HIGHLIGHTS.map((h) => (
                <span
                  key={h.label}
                  className="flex items-center gap-1.5 text-xs text-emerald-100/75 sm:text-[13px]"
                >
                  <h.icon className="h-4 w-4 text-emerald-300/90" aria-hidden />
                  {h.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ===== Auth form (left column in RTL) ===== */}
      <section className="relative flex items-center justify-center px-4 py-8 sm:px-6 lg:min-h-screen lg:px-10 xl:px-12">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-secondary/70 to-transparent"
        />
        <div className="relative w-full max-w-md">
          {/* Telegram Mini App banner (round 16) — unlinked telegram user */}
          {telegramLink.required && (
            <div className="animate-rtl-fade-in mb-4 rounded-2xl border border-sky-500/30 bg-sky-500/[0.07] p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-cyan-500 text-white shadow-lg shadow-sky-500/25">
                  <Send className="h-5 w-5" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold leading-6">
                    {telegramLink.user?.firstName
                      ? `سلام ${telegramLink.user.firstName} 👋`
                      : "سلام 👋"}{" "}
                    — مینی‌اپ تلگرام
                  </p>
                  <p className="mt-1 text-xs leading-6 text-muted-foreground">
                    حساب تلگرام شما هنوز به پلتفرم متصل نیست. همین‌جا با ایمیل و رمز عبور خود وارد شوید؛
                    پس از ورود، حساب شما <span className="font-bold text-foreground">به‌صورت خودکار به تلگرام متصل می‌شود</span> و دفعهٔ بعد بدون رمز وارد می‌شوید.
                  </p>
                  <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5 text-sky-500" aria-hidden />
                    اتصال با امضای امن تلگرام روی سرور تأیید می‌شود.
                  </p>
                </div>
              </div>
            </div>
          )}
          <Card className="animate-rtl-fade-in gap-4 rounded-2xl border-border/70 shadow-2xl shadow-primary/10 ring-1 ring-black/[0.04] dark:border-white/10 dark:shadow-black/50 dark:ring-white/[0.06]">
            <CardHeader>
              <CardTitle className="text-xl font-bold">ورود به حساب</CardTitle>
              <CardDescription>با ایمیل و رمز عبور خود وارد شوید.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={submit} className="space-y-4" noValidate>
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-[13px] font-medium">
                    ایمیل
                  </Label>
                  <div className="relative">
                    <Mail
                      aria-hidden
                      className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70"
                    />
                    <Input
                      id="email"
                      type="email"
                      dir="ltr"
                      placeholder="student@school.ir"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      required
                      className="h-11 rounded-xl pr-10 pl-4 focus-visible:border-primary/50 focus-visible:ring-primary/20"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password" className="text-[13px] font-medium">
                    رمز عبور
                  </Label>
                  <div className="relative">
                    <Lock
                      aria-hidden
                      className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70"
                    />
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      dir="ltr"
                      placeholder="••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      required
                      className="h-11 rounded-xl pr-10 pl-12 focus-visible:border-primary/50 focus-visible:ring-primary/20"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? "پنهان‌سازی رمز عبور" : "نمایش رمز عبور"}
                      className="absolute left-0.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" aria-hidden />
                      ) : (
                        <Eye className="h-4 w-4" aria-hidden />
                      )}
                    </button>
                  </div>
                </div>

                {error && (
                  <div
                    role="alert"
                    className="animate-rtl-fade-in flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-3"
                  >
                    <CircleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    <p className="text-sm leading-5 text-destructive">{error}</p>
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={busy}
                  className="h-11 w-full rounded-xl bg-gradient-to-l from-emerald-600 to-teal-600 text-white shadow-lg shadow-emerald-600/25 transition-all hover:brightness-110 hover:shadow-emerald-600/35 active:scale-95 dark:from-emerald-500 dark:to-teal-600"
                >
                  {busy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      در حال ورود…
                    </>
                  ) : (
                    <>
                      <LogIn className="h-4 w-4" aria-hidden />
                      ورود
                    </>
                  )}
                </Button>
              </form>

              {/* Demo accounts — quick login */}
              <div className="mt-6 border-t border-border/70 pt-5">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="text-[13px] font-semibold">حساب‌های نمونه</p>
                  <Badge
                    variant="secondary"
                    className="gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-medium"
                  >
                    <KeyRound aria-hidden className="h-3 w-3" />
                    رمز: ۱۲۳۴۵۶
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  {DEMO_ACCOUNTS.map((a) => (
                    <button
                      key={a.email}
                      type="button"
                      onClick={() => quickLogin(a.email)}
                      disabled={busy}
                      title={`${a.name} — ${a.email}`}
                      className="flex min-h-11 items-center gap-2.5 rounded-xl border border-border bg-card px-2.5 py-2.5 text-start outline-none transition-all hover:border-primary/40 hover:bg-primary/5 active:scale-[0.98] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:px-3 disabled:pointer-events-none disabled:opacity-50"
                    >
                      <span
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                          a.tint
                        )}
                      >
                        <a.icon className="h-4 w-4" aria-hidden />
                      </span>
                      <span className="flex min-w-0 flex-col items-start gap-0.5">
                        <span className="text-xs font-bold leading-4">{a.label}</span>
                        <span
                          dir="ltr"
                          className="w-full truncate font-mono text-[10px] leading-3 text-muted-foreground"
                          title={a.email}
                        >
                          {a.email}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
          <p className="mt-5 text-center text-xs text-muted-foreground">
            محیط نمایشی با داده‌های واقعی و قابل استفاده
          </p>
        </div>
      </section>
    </div>
  );
}
