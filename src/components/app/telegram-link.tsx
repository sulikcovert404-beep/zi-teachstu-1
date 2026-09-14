"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiClientError } from "@/lib/app/api-client";
import { useAuth } from "@/lib/app/auth-store";
import { isInTelegram, tgHaptic } from "@/lib/telegram/webapp";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Send, Loader2, Copy, CheckCircle2, QrCode, RefreshCw, Smartphone, Info } from "lucide-react";
import { cn } from "@/lib/utils";

// Round 16 — «اتصال حساب به تلگرام»: two paths in ONE dialog.
//  (a) inside the Mini App + authenticated → direct auto-link via verified initData;
//  (b) on the web → 6-digit linking code (10-minute TTL) to send to the bot.
// Round 22 — (c) ثبت شمارهٔ موبایل → بعداً همان شماره در تلگرام = ورود خودکار بدون رمز.

/** ارقام لاتین یک رشته (مثل شمارهٔ موبایل) را به فارسی برمی‌گرداند */
function faDigits(s: string): string {
  return s.replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

interface TelegramLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface LinkCodeResponse {
  code: string;
  expiresInSec: number;
  botUsername: string | null;
}

export function TelegramLinkDialog({ open, onOpenChange }: TelegramLinkDialogProps) {
  const { toast } = useToast();
  const me = useAuth((s) => s.me);
  const [code, setCode] = useState<LinkCodeResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [copied, setCopied] = useState(false);
  const [autoLinked, setAutoLinked] = useState<"pending" | "done" | "failed" | "na">("na");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Round 22 — ثبت شمارهٔ موبایل برای ورود خودکار تلگرام ──
  const [phone, setPhone] = useState("");
  const [savedPhone, setSavedPhone] = useState<string | null>(null);
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [phoneJustSaved, setPhoneJustSaved] = useState(false);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Inside the Mini App: attempt direct linking once per open
  useEffect(() => {
    if (!open || !isInTelegram()) return;
    let ignore = false;
    setAutoLinked("pending");
    (async () => {
      try {
        const initData = (window as any).Telegram?.WebApp?.initData as string;
        const res = await api<{ linked: boolean }>("/api/v1/auth/telegram/link", {
          method: "POST",
          body: JSON.stringify({ initData }),
        });
        if (!ignore && res?.linked) {
          setAutoLinked("done");
          tgHaptic("success");
        }
      } catch (e) {
        if (!ignore) {
          setAutoLinked(e instanceof ApiClientError && e.code === "TELEGRAM_ALREADY_LINKED" ? "done" : "failed");
        }
      }
    })();
    return () => {
      ignore = true;
    };
  }, [open]);

  // Round 22 — شمارهٔ فعلی حساب را پیش‌فرم پر کن (user.phone از /auth/me)
  useEffect(() => {
    if (!open) return;
    const current = me?.user?.phone ?? null;
    setSavedPhone(current);
    setPhone(current ?? "");
    setPhoneError(null);
    setPhoneJustSaved(false);
  }, [open, me?.user?.phone]);

  // countdown ticker
  useEffect(() => {
    if (!code) return;
    setRemaining(code.expiresInSec);
    stopTimer();
    timerRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          stopTimer();
          setCode(null);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return stopTimer;
  }, [code, stopTimer]);

  useEffect(() => () => stopTimer(), [stopTimer]);

  async function requestCode() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const res = await api<LinkCodeResponse>("/api/v1/auth/telegram/link-code", { method: "POST" });
      setCode(res);
      tgHaptic("medium");
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "دریافت کد اتصال ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }

  // ── Round 22 — PUT /api/v1/me/phone: ثبت/به‌روزرسانی شماره برای ورود خودکار ──
  async function savePhone() {
    const raw = phone.trim();
    if (!raw) {
      setPhoneError("شمارهٔ موبایل را وارد کنید (مثلاً ۰۹۱۲۳۴۵۶۷۸۹).");
      return;
    }
    if (phoneBusy) return;
    setPhoneBusy(true);
    setPhoneError(null);
    setPhoneJustSaved(false);
    try {
      const res = await api<{ phone: string }>("/api/v1/me/phone", {
        method: "PUT",
        body: JSON.stringify({ phone: raw }),
      });
      setSavedPhone(res.phone);
      setPhoneJustSaved(true);
      tgHaptic("success");
      toast({
        title: "شمارهٔ موبایل ثبت شد",
        description: "از این پس اگر همان شماره را در تلگرام به ربات بفرستید، مستقیم وارد همین حساب می‌شوید.",
      });
    } catch (e) {
      setPhoneError(e instanceof ApiClientError ? e.message : "ثبت شمارهٔ موبایل ناموفق بود.");
      tgHaptic("error");
    } finally {
      setPhoneBusy(false);
    }
  }

  async function copyCode() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.code);
      setCopied(true);
      toast({ title: "کد اتصال کپی شد" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const mmss = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md rounded-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-cyan-500 text-white shadow-lg shadow-sky-500/25">
              <Send className="h-4.5 w-4.5" aria-hidden />
            </span>
            اتصال حساب به تلگرام
          </DialogTitle>
          <DialogDescription>
            سه راه اتصال: ثبت شمارهٔ موبایل برای ورود خودکار، اتصال مستقیم داخل مینی‌اپ، یا کد اتصال ۶ رقمی برای ربات.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* ── Round 22 — ثبت شمارهٔ موبایل برای ورود خودکار (برای همهٔ نقش‌ها) ── */}
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.05] p-3.5 space-y-3">
            <p className="text-sm font-bold flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white shrink-0">
                <Smartphone className="h-4 w-4" aria-hidden />
              </span>
              📱 ورود خودکار با شمارهٔ موبایل
            </p>
            <p className="text-xs leading-6 text-muted-foreground">
              شمارهٔ موبایل خود را ثبت کنید؛ بعد کافی است همان شماره را در تلگرام به ربات بفرستید
              تا بدون رمز، مستقیم وارد همین حساب شوید.
            </p>

            {savedPhone && (
              <div
                role="status"
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold",
                  phoneJustSaved
                    ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                )}
              >
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
                <span>
                  شمارهٔ ثبت‌شده: <span dir="ltr" className="tabular-nums tracking-wide">{faDigits(savedPhone)}</span>
                </span>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                dir="ltr"
                inputMode="tel"
                autoComplete="tel"
                placeholder="09123456789"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  if (phoneError) setPhoneError(null);
                  setPhoneJustSaved(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void savePhone();
                  }
                }}
                maxLength={20}
                disabled={phoneBusy}
                className="h-11 flex-1 tabular-nums"
                aria-label="شمارهٔ موبایل"
              />
              <Button
                onClick={() => void savePhone()}
                disabled={phoneBusy || !phone.trim()}
                className="h-11 rounded-xl bg-gradient-to-l from-emerald-600 to-teal-600 text-white hover:brightness-110 transition-all shrink-0"
              >
                {phoneBusy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> در حال ثبت…
                  </>
                ) : (
                  <>
                    <Smartphone className="h-4 w-4" aria-hidden /> ثبت شماره
                  </>
                )}
              </Button>
            </div>

            {phoneError && (
              <p role="alert" className="text-xs text-destructive leading-6">
                {phoneError}
              </p>
            )}

            <p className="text-[10px] text-muted-foreground leading-5 flex items-start gap-1.5">
              <Info className="h-3 w-3 shrink-0 mt-1" aria-hidden />
              قالب‌های پذیرفته‌شده: ۰۹۱۲۳۴۵۶۷۸۹، +۹۸۹۱۲۳۴۵۶۷۸۹ یا ارقام فارسی — شمارهٔ هر حساب دیگری قابل ثبت نیست.
            </p>
          </div>

          {/* Mini App auto-link state */}
          {isInTelegram() && (
            <div
              className={cn(
                "rounded-xl border p-3.5 text-sm",
                autoLinked === "done" && "border-emerald-500/30 bg-emerald-500/[0.07] text-emerald-700 dark:text-emerald-300",
                autoLinked === "pending" && "border-border bg-muted/40 text-muted-foreground",
                autoLinked === "failed" && "border-amber-500/30 bg-amber-500/[0.07] text-amber-700 dark:text-amber-300"
              )}
            >
              {autoLinked === "done" && (
                <p className="flex items-center gap-2 font-bold">
                  <CheckCircle2 className="h-4 w-4" aria-hidden /> حساب شما به تلگرام متصل است ✅
                </p>
              )}
              {autoLinked === "pending" && (
                <p className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> در حال اتصال خودکار…
                </p>
              )}
              {autoLinked === "failed" && (
                <p>اتصال خودکار ممکن نشد؛ از روش کد اتصال زیر استفاده کنید.</p>
              )}
            </div>
          )}

          {/* Link code flow */}
          {autoLinked !== "done" && (
            <>
              {!code ? (
                <div className="space-y-3">
                  <div className="rounded-xl border border-border/70 bg-muted/30 p-4 text-[13px] leading-7 text-muted-foreground">
                    <p className="font-bold text-foreground">چطور کار می‌کند؟</p>
                    <ol className="mt-1.5 list-decimal space-y-1 pr-5">
                      <li>دکمهٔ زیر را بزنید تا یک «کد اتصال» ۶ رقمی بسازید.</li>
                      <li>
                        ربات پلتفرم را در تلگرام باز کنید
                        {autoLinked === "na" && " (آدرس ربات را از مدیر پلتفرم بپرسید)"}.
                      </li>
                      <li>این کد را برای ربات بفرستید — اتصال فوراً انجام می‌شود.</li>
                    </ol>
                  </div>
                  <Button onClick={() => void requestCode()} disabled={busy} className="h-11 w-full rounded-xl">
                    {busy ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> در حال ساخت کد…
                      </>
                    ) : (
                      <>
                        <QrCode className="h-4 w-4" aria-hidden /> دریافت کد اتصال
                      </>
                    )}
                  </Button>
                  {error && (
                    <p role="alert" className="text-xs text-destructive">
                      {error}
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-2xl border-2 border-dashed border-primary/40 bg-primary/[0.04] p-5 text-center">
                    <p className="text-xs font-medium text-muted-foreground">کد اتصال شما</p>
                    <button
                      type="button"
                      onClick={() => void copyCode()}
                      className="group mt-2 inline-flex items-center gap-3 rounded-xl px-4 py-2 transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      title="کپی کد"
                    >
                      <span dir="ltr" className="font-mono text-3xl font-black tracking-[0.35em] text-primary tabular-nums">
                        {code.code}
                      </span>
                      {copied ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-500" aria-hidden />
                      ) : (
                        <Copy className="h-4.5 w-4.5 text-muted-foreground transition-colors group-hover:text-primary" aria-hidden />
                      )}
                    </button>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      اعتبار کد: <span className="font-bold text-foreground tabular-nums">{mmss}</span>
                    </p>
                  </div>

                  {code.botUsername && (
                    <Badge variant="secondary" className="w-full justify-center gap-1.5 py-1.5">
                      <Send className="h-3 w-3" aria-hidden />
                      ربات: @{code.botUsername}
                    </Badge>
                  )}

                  <div className="rounded-xl border border-border/70 bg-muted/30 p-3.5 text-[12px] leading-6 text-muted-foreground">
                    این کد را در گفتگوی ربات در تلگرام بفرستید. کد یک‌بارمصرف است و ۱۰ دقیقه اعتبار دارد.
                  </div>

                  <Button
                    variant="outline"
                    onClick={() => void requestCode()}
                    disabled={busy}
                    className="h-10 w-full rounded-xl"
                  >
                    <RefreshCw className="h-4 w-4" aria-hidden /> کد جدید
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
