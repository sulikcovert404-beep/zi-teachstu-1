"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/app/api-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState, PageTitle, StatCard, faNum } from "@/components/shared/blocks";
import {
  Building2, Users, School, Layers, FileCheck2, ClipboardList, FileText, Activity,
  HeartPulse, Sparkles, AlertTriangle, CheckCircle2, FileDown,
} from "lucide-react";
import type { PlatformOverview } from "./types";

interface HealthReady {
  status: string;
  db: string;
}

// Spec §20/§80 — نمای کلی پلتفرم: همهٔ اعداد از داده واقعی پایگاه داده
export function OverviewSection({ onGoAi }: { onGoAi: () => void }) {
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [health, setHealth] = useState<HealthReady | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let ignore = false;
    async function start() {
      try {
        const res = await api<PlatformOverview>("/api/v1/platform/overview");
        if (!ignore) {
          setOverview(res);
          setError(null);
        }
      } catch (e) {
        if (!ignore)
          setError(e instanceof ApiClientError ? e.message : "بارگذاری نمای کلی ناموفق بود.");
      }
    }
    void start();
    return () => {
      ignore = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    let ignore = false;
    async function start() {
      try {
        const res = await api<HealthReady>("/api/v1/health/ready");
        if (!ignore) {
          setHealth(res);
          setHealthError(null);
        }
      } catch (e) {
        if (!ignore) {
          setHealth(null);
          setHealthError(e instanceof ApiClientError ? e.message : "بررسی سلامت سیستم ناموفق بود.");
        }
      }
    }
    void start();
    return () => {
      ignore = true;
    };
  }, [reloadKey]);

  const load = useCallback(() => setReloadKey((k) => k + 1), []);

  if (error) {
    return (
      <div className="space-y-4">
        <PageTitle title="نمای کلی" description="آمار لحظه‌ای کل پلتفرم از داده واقعی." />
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="space-y-4">
        <PageTitle title="نمای کلی" description="آمار لحظه‌ای کل پلتفرم از داده واقعی." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="border-border/60">
              <CardContent className="p-4 space-y-3">
                <Skeleton className="h-11 w-11 rounded-xl" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-7 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const systemHealthy = health?.status === "ready" && !healthError;
  const aiWithFailures = overview.failedAiToday > 0;

  return (
    <div className="space-y-6">
      <PageTitle
        title="نمای کلی"
        description="آمار لحظه‌ای کل پلتفرم — همهٔ اعداد از داده واقعی پایگاه داده ساخته شده‌اند."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="سازمان‌ها" value={faNum(overview.tenants)} icon={Building2} tone="info" />
        <StatCard label="کاربران" value={faNum(overview.users)} icon={Users} />
        <StatCard label="مدارس" value={faNum(overview.schools)} icon={School} />
        <StatCard label="کلاس‌ها" value={faNum(overview.classes)} icon={Layers} />
        <StatCard label="آزمون‌ها" value={faNum(overview.exams)} icon={FileCheck2} />
        <StatCard label="تکالیف" value={faNum(overview.assignments)} icon={ClipboardList} />
        <StatCard label="کاربرگ‌های آزمون" value={faNum(overview.attempts)} icon={FileText} />
        <StatCard
          label="نشست‌های فعال"
          value={faNum(overview.activeSessions)}
          icon={Activity}
          tone="positive"
          hint="نشست‌های معتبر و منقضی‌نشده"
        />
      </div>

      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <HeartPulse className="h-4.5 w-4.5 text-primary" aria-hidden />
            سلامت سیستم
          </CardTitle>
          <CardDescription>وضعیت لحظه‌ای اجزای حیاتی پلتفرم و دروازه هوش مصنوعی.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="flex items-center gap-3 rounded-xl border border-border/60 p-4">
            {systemHealthy ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden />
            ) : (
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" aria-hidden />
            )}
            <div className="min-w-0">
              <p className="text-sm font-bold">
                {systemHealthy ? "همه اجزا سالم" : healthError ? "وضعیت نامشخص" : "سیستم آماده نیست"}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {systemHealthy
                  ? "پایگاه داده و سرویس‌ها پاسخ‌گو هستند"
                  : healthError
                    ? "بررسی سلامت ناموفق بود"
                    : "پایگاه داده یا سرویس‌های وابسته پاسخ نمی‌دهند"}
              </p>
            </div>
            {systemHealthy && (
              <span
                className="ml-auto inline-block h-2.5 w-2.5 rounded-full bg-emerald-500 shrink-0"
                aria-label="سالم"
              />
            )}
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-border/60 p-4">
            <Sparkles className="h-5 w-5 text-primary shrink-0" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-bold">{faNum(overview.aiCallsToday)} فراخوانی امروز</p>
              <p className="text-xs text-muted-foreground truncate">
                {overview.aiCallsToday === 0
                  ? "امروز هنوز فراخوانی‌ای ثبت نشده است"
                  : aiWithFailures
                    ? `${faNum(overview.failedAiToday)} فراخوانی ناموفق`
                    : "بدون خطا"}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onGoAi}
            className="flex items-center gap-3 rounded-xl border border-dashed border-border p-4 text-right transition-colors hover:bg-muted/50 min-h-[44px]"
          >
            <Activity className="h-5 w-5 text-muted-foreground shrink-0" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-bold">ارائه‌دهنده‌های هوش مصنوعی</p>
              <p className="text-xs text-muted-foreground truncate">مشاهده وضعیت زنده دروازه هوش مصنوعی</p>
            </div>
          </button>
        </CardContent>
      </Card>

      {/* راند ۳۰ — گزارش جامع پروژه (PDF قابل دانلود) */}
      <Card className="border-border/60 bg-gradient-to-bl from-emerald-50/80 to-transparent dark:from-emerald-950/30">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileDown className="h-4.5 w-4.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
            گزارش جامع پروژه
          </CardTitle>
          <CardDescription>
            سند کامل معرفی پروژه — معماری، امکانات، همگام‌سازی ساختار درسی با chap.sch.ir، نتایج تست‌های جامع و نقشهٔ راه — در قالب PDF.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <a
            href="/project-report.pdf"
            download="پلتفرم-آموزش-هوشمند-ایران-گزارش.pdf"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
          >
            <FileDown className="h-4 w-4" aria-hidden />
            دانلود گزارش (PDF)
          </a>
          <a
            href="/report/project-report.html"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-bold transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            مشاهده نسخهٔ HTML
          </a>
          <p className="w-full text-xs text-muted-foreground">تاریخ تهیه: شهریور ۱۴۰۵ — راند ۳۰ · حجم حدود ۲۰۰ کیلوبایت</p>
        </CardContent>
      </Card>
    </div>
  );
}
