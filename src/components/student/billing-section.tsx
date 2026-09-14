"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/app/api-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  EmptyState, ErrorState, LoadingGrid, PageTitle, faDate, faDateTime, faNum,
} from "@/components/shared/blocks";
import { FEATURE_LABELS_FA, INVOICE_STATUS_LABELS_FA, PLAN_MARKETING_LABELS_FA } from "@/lib/app/labels";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Activity, ArrowLeft, BadgeCheck, CalendarClock, CheckCircle2, Crown, Info,
  Loader2, Receipt, ShieldCheck, Sparkles, TrendingUp, Zap,
} from "lucide-react";

// ── Subscription & billing (spec §41 Subscription & Billing, §42 Paywall) ──
// Value BEFORE payment: current plan + real usage + Free-vs-Pro quota comparison.
// Checkout → mock gateway → PAID invoice + ACTIVE personal STUDENT_PRO subscription.

const STUDENT_FEATURES = ["AI_TUTOR", "SUMMARIZER", "QUESTION_GENERATOR", "FLASHCARDS", "STUDY_PLANNER"];

interface EntitlementRow {
  feature: string;
  planCode: string;
  planName: string;
  dailyLimit: number;
  usedToday: number;
  remaining: number;
  allowed: boolean;
}

interface PeriodOption {
  months: number;
  discountPercent: number;
  total: number;
}

interface BillingPreview {
  currentPlan: { code: string; name: string };
  proPlan: { code: string; name: string; priceMonthly: number };
  entitlements: EntitlementRow[];
  comparison: Array<{ feature: string; freeLimit: number; proLimit: number; usedToday: number }>;
  periods: PeriodOption[];
}

interface SubscriptionRow {
  planCode: string;
  planName: string;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  daysRemaining: number;
}

interface InvoiceRow {
  number: string;
  planCode: string;
  periodMonths: number;
  amount: number;
  status: string;
  paymentRef: string | null;
  paidAt: string | null;
  createdAt: string;
}

interface CheckoutResult {
  invoice: InvoiceRow;
  subscription: SubscriptionRow;
}

const PRO_BENEFITS = [
  { icon: Zap, text: "سهمیهٔ روزانهٔ همهٔ ابزارهای هوشمند چند برابر می‌شود" },
  { icon: Sparkles, text: "دستیار آموزشی، خلاصه‌ساز، فلش‌کارت، برنامه‌ریز، پرسش از منابع و پادکست صوتی با سهمیهٔ بالا" },
  { icon: BadgeCheck, text: "فعال‌سازی آنی پس از پرداخت — بدون انتظار" },
];

export function BillingSection({ onChanged }: { onChanged?: () => void }) {
  const [data, setData] = useState<{
    preview: BillingPreview;
    subscription: SubscriptionRow | null;
    invoices: InvoiceRow[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [period, setPeriod] = useState(1);
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  useEffect(() => {
    let ignore = false;
    async function start() {
      try {
        const [previewRes, subRes, invRes] = await Promise.all([
          api<{ preview: BillingPreview }>("/api/v1/student/billing/preview"),
          api<{ subscription: SubscriptionRow | null }>("/api/v1/student/billing/subscription"),
          api<{ invoices: InvoiceRow[] }>("/api/v1/student/billing/invoices"),
        ]);
        if (!ignore) {
          setData({ preview: previewRes.preview, subscription: subRes.subscription, invoices: invRes.invoices });
          setError(null);
        }
      } catch (e) {
        if (!ignore) setError(e instanceof ApiClientError ? e.message : "بارگذاری اطلاعات اشتراک ناموفق بود.");
      }
    }
    void start();
    return () => { ignore = true; };
  }, [reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  if (error) {
    return (
      <div className="space-y-4">
        <PageTitle title="اشتراک و ارتقا" description="پلن فعلی، سهمیه‌ها و ارتقا به «دانش‌آموز پرو»." />
        <ErrorState message={error} onRetry={() => void reload()} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <PageTitle title="اشتراک و ارتقا" description="پلن فعلی، سهمیه‌ها و ارتقا به «دانش‌آموز پرو»." />
        <LoadingGrid count={4} />
      </div>
    );
  }

  const { preview, subscription, invoices } = data;
  const isPro = preview.entitlements.some((e) => e.planCode === "STUDENT_PRO");
  const chosen = preview.periods.find((p) => p.months === period) ?? preview.periods[0];

  return (
    <div className="space-y-6">
      <PageTitle
        title="اشتراک و ارتقا"
        description="مقایسهٔ پلن رایگان و «دانش‌آموز پرو»، خرید، تمدید و تاریخچهٔ فاکتورها."
      />

      {isPro && <ProStatusCard subscription={subscription} />}

      <div className="grid lg:grid-cols-2 gap-4 items-stretch">
        <CurrentPlanCard preview={preview} subscription={subscription} />
        <ProBenefitsCard preview={preview} />
      </div>

      <PurchaseCard
        periods={preview.periods}
        selected={period}
        onSelect={setPeriod}
        isPro={isPro}
        onCheckout={() => setCheckoutOpen(true)}
      />

      <InvoicesCard invoices={invoices} />

      {checkoutOpen && (
        <CheckoutDialog
          preview={preview}
          period={chosen}
          onClose={() => setCheckoutOpen(false)}
          onDone={() => { void reload(); onChanged?.(); }}
        />
      )}
    </div>
  );
}

// ── PRO status (shown when the effective plan is already STUDENT_PRO) ──
function ProStatusCard({ subscription }: { subscription: SubscriptionRow | null }) {
  const days = subscription?.daysRemaining ?? null;
  const remainingPct = subscription ? (() => {
    const start = new Date(subscription.currentPeriodStart).getTime();
    const end = new Date(subscription.currentPeriodEnd).getTime();
    if (end <= start) return 0;
    return Math.max(0, Math.min(100, Math.round(((end - Date.now()) / (end - start)) * 100)));
  })() : 0;

  return (
    <Card className="border-emerald-600/30 overflow-hidden">
      <div className="bg-gradient-to-l from-emerald-600 via-emerald-500 to-teal-500 px-4 sm:px-5 py-4 text-white flex items-center gap-3 flex-wrap">
        <div className="h-11 w-11 rounded-xl bg-white/15 flex items-center justify-center shrink-0 ring-1 ring-white/25">
          <Crown className="h-6 w-6" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-extrabold text-base">اشتراک دانش‌آموز پرو فعال است</p>
          <p className="text-xs text-white/85 mt-0.5">
            {subscription
              ? `اعتبار تا ${faDate(subscription.currentPeriodEnd)}`
              : "این اشتراک از طریق مدرسهٔ شما فعال شده است"}
          </p>
        </div>
        {days !== null && (
          <Badge className="bg-white/20 text-white border-white/25 hover:bg-white/25 shrink-0 tabular-nums">
            {faNum(days)} روز مانده
          </Badge>
        )}
      </div>
      {subscription && (
        <CardContent className="p-4 sm:p-5 space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>باقی‌ماندهٔ اعتبار اشتراک</span>
            <span className="tabular-nums">{faNum(days)} روز</span>
          </div>
          <Progress value={remainingPct} className="h-2" />
        </CardContent>
      )}
    </Card>
  );
}

// ── Current plan + real usage (paywall data — spec §42) ──
function CurrentPlanCard({ preview, subscription }: { preview: BillingPreview; subscription: SubscriptionRow | null }) {
  const ents = preview.entitlements.filter((e) => STUDENT_FEATURES.includes(e.feature));
  const isPro = preview.entitlements.some((e) => e.planCode === "STUDENT_PRO");

  return (
    <Card className="border-border/60 h-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4.5 w-4.5 text-primary" aria-hidden /> پلن فعلی شما
        </CardTitle>
        <CardDescription>
          مصرف واقعی امروز شما در این پلن.
          {isPro && subscription && ` اعتبار تا ${faDate(subscription.currentPeriodEnd)}.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={isPro ? "default" : "secondary"} className={cn(isPro && "bg-emerald-600")}>
            {PLAN_MARKETING_LABELS_FA[preview.currentPlan.code] ?? preview.currentPlan.name}
          </Badge>
          {!isPro && <Badge variant="outline" className="text-muted-foreground">سهمیهٔ محدود روزانه</Badge>}
        </div>
        {ents.map((e) => {
          const pct = e.dailyLimit > 0 ? Math.min(100, (e.usedToday / e.dailyLimit) * 100) : 0;
          return (
            <div key={e.feature} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">{FEATURE_LABELS_FA[e.feature] ?? e.feature}</span>
                <span className="tabular-nums text-muted-foreground">
                  {faNum(e.usedToday)} / {faNum(e.dailyLimit)}
                </span>
              </div>
              <Progress value={pct} className="h-1.5" />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ── STUDENT_PRO value card: price, benefits, quota comparison, discount chips ──
function ProBenefitsCard({ preview }: { preview: BillingPreview }) {
  const { proPlan, comparison, periods } = preview;
  const discounted = periods.filter((p) => p.discountPercent > 0);

  return (
    <Card className="border-emerald-600/30 overflow-hidden h-full shadow-sm">
      <div className="bg-gradient-to-l from-emerald-600 via-emerald-500 to-teal-500 p-4 sm:p-5 text-white">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-xl bg-white/15 flex items-center justify-center shrink-0 ring-1 ring-white/25">
            <Crown className="h-6 w-6" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="font-extrabold text-lg leading-tight">{proPlan.name}</p>
            <p className="text-xs text-white/85 mt-0.5">
              <span className="font-bold tabular-nums">{faNum(proPlan.priceMonthly)}</span> تومان / ماهانه
            </p>
          </div>
          <Badge className="mr-auto bg-white/20 text-white border-white/25 hover:bg-white/25 shrink-0 hidden sm:inline-flex">
            ویژهٔ دانش‌آموزان
          </Badge>
        </div>
      </div>
      <CardContent className="p-4 sm:p-5 space-y-4">
        <ul className="space-y-2">
          {PRO_BENEFITS.map((b) => (
            <li key={b.text} className="flex items-center gap-2.5 text-xs leading-6">
              <span className="h-7 w-7 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <b.icon className="h-4 w-4" aria-hidden />
              </span>
              {b.text}
            </li>
          ))}
        </ul>

        <Separator />

        <div>
          <p className="text-xs font-bold mb-2 flex items-center gap-1.5">
            <TrendingUp className="h-4 w-4 text-primary" aria-hidden />
            مقایسهٔ سهمیهٔ روزانه (رایگان ← پرو)
          </p>
          <div className="space-y-1.5">
            {comparison.map((c) => (
              <div key={c.feature} className="flex items-center justify-between gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs">
                <span className="font-medium truncate">{FEATURE_LABELS_FA[c.feature] ?? c.feature}</span>
                <span className="flex items-center gap-1.5 shrink-0 tabular-nums">
                  <span className="text-muted-foreground">{faNum(c.freeLimit)}</span>
                  <ArrowLeft className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
                  <span className="font-extrabold text-emerald-600 dark:text-emerald-400">{faNum(c.proLimit)}</span>
                  <span className="text-[10px] text-muted-foreground">در روز</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        {discounted.length > 0 && (
          <div className="grid grid-cols-2 gap-2.5">
            {discounted.map((p) => (
              <div
                key={p.months}
                className="rounded-xl border border-emerald-600/30 bg-emerald-500/10 p-3 text-center transition-colors hover:bg-emerald-500/15"
              >
                <p className="text-[10px] text-muted-foreground">{faNum(p.months)} ماهه</p>
                <p className="text-xs font-extrabold text-emerald-700 dark:text-emerald-400 mt-0.5">
                  ٪{faNum(p.discountPercent)} تخفیف
                </p>
                <p className="text-[11px] text-muted-foreground tabular-nums mt-1">مجموع {faNum(p.total)} تومان</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Period selector + checkout CTA ──
function PurchaseCard({
  periods, selected, onSelect, isPro, onCheckout,
}: {
  periods: PeriodOption[];
  selected: number;
  onSelect: (months: number) => void;
  isPro: boolean;
  onCheckout: () => void;
}) {
  const chosen = periods.find((p) => p.months === selected) ?? periods[0];

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <CalendarClock className="h-4.5 w-4.5 text-primary" aria-hidden /> انتخاب مدت اشتراک
        </CardTitle>
        <CardDescription>مدت دلخواه را انتخاب کنید؛ با دوره‌های بلندتر تخفیف بگیرید.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label="مدت اشتراک">
          {periods.map((p) => (
            <button
              key={p.months}
              type="button"
              role="radio"
              aria-checked={selected === p.months}
              onClick={() => onSelect(p.months)}
              className={cn(
                "min-h-[92px] rounded-xl border p-3 flex flex-col items-center justify-center gap-1 text-center transition-colors",
                selected === p.months
                  ? "border-primary ring-2 ring-primary/50 bg-primary/5 shadow-sm"
                  : "border-border/60 hover:border-primary/40 hover:bg-muted/50"
              )}
            >
              <span className="text-sm font-extrabold">{faNum(p.months)} ماه</span>
              {p.discountPercent > 0 ? (
                <Badge className="bg-emerald-600 text-[10px] px-1.5">٪{faNum(p.discountPercent)} تخفیف</Badge>
              ) : (
                <span className="text-[10px] text-muted-foreground">بدون تخفیف</span>
              )}
              <span className="text-[11px] text-muted-foreground tabular-nums">{faNum(p.total)} تومان</span>
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl bg-muted/60 px-4 py-3">
          <p className="text-xs text-muted-foreground">
            مبلغ قابل پرداخت برای {faNum(chosen.months)} ماه {isPro ? "(تمدید)" : ""}
          </p>
          <p className="text-lg font-extrabold tabular-nums text-primary">
            {faNum(chosen.total)} <span className="text-xs font-normal text-muted-foreground">تومان</span>
          </p>
        </div>

        <Button size="lg" className="w-full h-12 text-base" onClick={onCheckout}>
          <Crown className="h-5 w-5 ml-2" aria-hidden />
          {isPro ? "پرداخت و تمدید اشتراک پرو" : "پرداخت و فعال‌سازی"}
        </Button>
        <p className="text-[11px] text-muted-foreground text-center leading-5">
          پرداخت از طریق درگاه نمونه انجام می‌شود؛ اشتراک بلافاصله پس از پرداخت فعال می‌شود.
        </p>
      </CardContent>
    </Card>
  );
}

// ── Mock checkout dialog (remounts fresh on every open) ──
function CheckoutDialog({
  preview, period, onClose, onDone,
}: {
  preview: BillingPreview;
  period: PeriodOption;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const [phase, setPhase] = useState<"summary" | "paying" | "success" | "error">("summary");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckoutResult | null>(null);

  const base = preview.proPlan.priceMonthly * period.months;
  const discount = base - period.total;

  async function pay() {
    if (phase === "paying") return;
    setPhase("paying");
    setError(null);
    try {
      const res = await api<CheckoutResult>("/api/v1/student/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ periodMonths: period.months }),
      });
      setResult(res);
      setPhase("success");
      toast({
        title: "اشتراک دانش‌آموز پرو فعال شد 🎉",
        description: `پرداخت ${faNum(res.invoice.amount)} تومان — شمارهٔ فاکتور ${res.invoice.number}`,
      });
      onDone();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "پرداخت ناموفق بود. لطفاً دوباره تلاش کنید.");
      setPhase("error");
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {phase === "success"
              ? <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden />
              : <Crown className="h-5 w-5 text-primary" aria-hidden />}
            {phase === "success" ? "پرداخت موفق" : "تأیید پرداخت"}
          </DialogTitle>
          <DialogDescription>
            {phase === "success"
              ? "اشتراک «دانش‌آموز پرو» شما فعال شد."
              : "خلاصهٔ سفارش را بررسی و پرداخت را تکمیل کنید."}
          </DialogDescription>
        </DialogHeader>

        {phase !== "success" ? (
          <div className="space-y-4">
            <div className="space-y-2.5 rounded-xl border border-border/60 p-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">پلن</span>
                <span className="font-bold">{preview.proPlan.name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">مدت</span>
                <span className="font-bold tabular-nums">{faNum(period.months)} ماه</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">قیمت پایه</span>
                <span className="tabular-nums">{faNum(base)} تومان</span>
              </div>
              {discount > 0 && (
                <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400">
                  <span>تخفیف (٪{faNum(period.discountPercent)})</span>
                  <span className="tabular-nums">−{faNum(discount)} تومان</span>
                </div>
              )}
              <Separator />
              <div className="flex items-center justify-between">
                <span className="font-bold">مبلغ نهایی</span>
                <span className="text-lg font-extrabold tabular-nums text-primary">{faNum(period.total)} تومان</span>
              </div>
            </div>

            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 flex items-start gap-2.5 text-xs text-amber-700 dark:text-amber-400 leading-6">
              <Info className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
              <span>این درگاه پرداخت نمونه است — در نسخهٔ نمایشی مبلغی پرداخت نمی‌شود.</span>
            </div>

            {phase === "error" && error && <ErrorState message={error} />}

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 h-11" onClick={onClose} disabled={phase === "paying"}>
                انصراف
              </Button>
              <Button className="flex-1 h-11" onClick={() => void pay()} disabled={phase === "paying"}>
                {phase === "paying"
                  ? <Loader2 className="h-4 w-4 animate-spin ml-1.5" aria-hidden />
                  : <ShieldCheck className="h-4 w-4 ml-1.5" aria-hidden />}
                {phase === "paying" ? "در حال پرداخت…" : "پرداخت و فعال‌سازی"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="mx-auto h-16 w-16 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <CheckCircle2 className="h-9 w-9" aria-hidden />
            </div>
            <p className="text-sm leading-7 text-center">
              اشتراک «{PLAN_MARKETING_LABELS_FA[result?.invoice.planCode ?? "STUDENT_PRO"] ?? "دانش‌آموز پرو"}» فعال شد و
              سهمیه‌های جدید همین حالا اعمال می‌شود.
            </p>
            <div className="space-y-2 rounded-xl border border-border/60 p-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">شمارهٔ فاکتور</span>
                <span dir="ltr" className="font-mono text-xs font-bold tabular-nums">{result?.invoice.number ?? "—"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">مبلغ پرداخت‌شده</span>
                <span className="tabular-nums font-bold">{faNum(result?.invoice.amount ?? 0)} تومان</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">اعتبار تا</span>
                <span className="font-bold">{faDate(result?.subscription.currentPeriodEnd)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">مدت اعتبار</span>
                <span className="tabular-nums font-bold">{faNum(result?.subscription.daysRemaining ?? 0)} روز</span>
              </div>
            </div>
            <Button className="w-full h-11" onClick={onClose}>بستن</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Invoice history (everyone) ──
function InvoicesCard({ invoices }: { invoices: InvoiceRow[] }) {
  const statusBadge = (status: string) => {
    if (status === "PAID") return <Badge className="bg-emerald-600">{INVOICE_STATUS_LABELS_FA[status] ?? status}</Badge>;
    if (status === "FAILED") return <Badge variant="destructive">{INVOICE_STATUS_LABELS_FA[status] ?? status}</Badge>;
    if (status === "REFUNDED") return <Badge variant="outline">{INVOICE_STATUS_LABELS_FA[status] ?? status}</Badge>;
    return <Badge variant="secondary">{INVOICE_STATUS_LABELS_FA[status] ?? status}</Badge>;
  };

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Receipt className="h-4.5 w-4.5 text-primary" aria-hidden /> تاریخچهٔ خریدها
        </CardTitle>
        <CardDescription>فاکتورهای اشتراک شما — جدیدترین در بالا.</CardDescription>
      </CardHeader>
      <CardContent>
        {invoices.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="هنوز خریدی ثبت نشده است"
            description="پس از اولین ارتقا یا تمدید، فاکتورها اینجا نمایش داده می‌شوند."
          />
        ) : (
          <div className="max-h-96 overflow-y-auto rounded-xl border border-border/60">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-muted/95 backdrop-blur-sm">
                <TableRow>
                  <TableHead className="text-right text-xs whitespace-nowrap">شمارهٔ فاکتور</TableHead>
                  <TableHead className="text-right text-xs hidden sm:table-cell">پلن</TableHead>
                  <TableHead className="text-right text-xs hidden md:table-cell">مدت</TableHead>
                  <TableHead className="text-right text-xs">مبلغ</TableHead>
                  <TableHead className="text-right text-xs">وضعیت</TableHead>
                  <TableHead className="text-right text-xs hidden lg:table-cell">تاریخ پرداخت</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.number}>
                    <TableCell dir="ltr" className="text-right font-mono text-[11px] tabular-nums whitespace-nowrap">
                      {inv.number}
                    </TableCell>
                    <TableCell className="text-xs hidden sm:table-cell">
                      {PLAN_MARKETING_LABELS_FA[inv.planCode] ?? inv.planCode}
                    </TableCell>
                    <TableCell className="text-xs tabular-nums hidden md:table-cell whitespace-nowrap">
                      {faNum(inv.periodMonths)} ماه
                    </TableCell>
                    <TableCell className="text-xs tabular-nums font-bold whitespace-nowrap">
                      {faNum(inv.amount)} <span className="text-muted-foreground font-normal">تومان</span>
                    </TableCell>
                    <TableCell>{statusBadge(inv.status)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground hidden lg:table-cell whitespace-nowrap">
                      {faDateTime(inv.paidAt ?? inv.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
