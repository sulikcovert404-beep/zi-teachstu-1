"use client";

// School Admin — مصرف هوش مصنوعی (spec §20): 14-day usage — per feature + per day (real data only)

import { useCallback, useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/app/api-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { PageTitle, StatCard, EmptyState, ErrorState, faNum } from "@/components/shared/blocks";
import { FEATURE_LABELS_FA } from "@/lib/app/labels";
import { Sparkles, BarChart3, Cpu } from "lucide-react";
import { type UsageResponse } from "./shared";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";

export function UsageSection() {
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let ignore = false;
    async function start() {
      try {
        const res = await api<UsageResponse>("/api/v1/admin/usage");
        if (!ignore) {
          setUsage(res);
          setError(null);
        }
      } catch (e) {
        if (!ignore) setError(e instanceof ApiClientError ? e.message : "بارگذاری داده‌های مصرف ناموفق بود.");
      }
    }
    void start();
    return () => {
      ignore = true;
    };
  }, [reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  return (
    <div className="space-y-6">
      <PageTitle
        title="مصرف هوش مصنوعی"
        description="گزارش مصرف قابلیت‌های هوشمند مدرسه در ۱۴ روز گذشته — فقط بر اساس رویدادهای واقعی."
      />

      {error && <ErrorState message={error} onRetry={() => void reload()} />}

      {!usage && !error && (
        <div className="grid gap-4 sm:grid-cols-2">
          <StatCard label="مصرف کل (۱۴ روز اخیر)" value={null} icon={Sparkles} />
          <StatCard label="فراخوانی امروز" value={null} icon={Cpu} />
        </div>
      )}

      {usage && (
        <>
          <StatCard
            label="مصرف کل (۱۴ روز اخیر)"
            value={faNum(usage.total14d)}
            icon={Sparkles}
            tone="info"
            hint="فراخوانی قابلیت‌های هوش مصنوعی"
          />

          {usage.total14d === 0 ? (
            <EmptyState
              icon={BarChart3}
              title="هنوز مصرفی ثبت نشده است."
              description="به‌محض استفادهٔ معلم‌ها و دانش‌آموزان مدرسه از قابلیت‌های هوشمند، گزارش مصرف این‌جا نمایش داده می‌شود."
            />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <FeatureUsageCard byFeature={usage.byFeature} total={usage.total14d} />
              <DailyUsageCard byDay={usage.byDay} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FeatureUsageCard({ byFeature, total }: { byFeature: Record<string, number>; total: number }) {
  const entries = Object.entries(byFeature).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, count]) => count));
  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Cpu className="h-4.5 w-4.5 text-primary" aria-hidden />
          مصرف به تفکیک قابلیت
        </CardTitle>
        <CardDescription>سهم هر قابلیت از {faNum(total)} فراخوانی ثبت‌شده.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {entries.map(([feature, count]) => (
          <div key={feature} className="space-y-1.5">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="font-medium truncate">{FEATURE_LABELS_FA[feature] ?? feature}</span>
              <span className="tabular-nums text-muted-foreground shrink-0">{faNum(count)} فراخوانی</span>
            </div>
            <Progress value={Math.round((count / max) * 100)} className="h-2" aria-label={`${FEATURE_LABELS_FA[feature] ?? feature}: ${faNum(count)}`} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function DailyUsageCard({ byDay }: { byDay: Record<string, number> }) {
  const data = buildDailySeries(byDay);
  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <BarChart3 className="h-4.5 w-4.5 text-primary" aria-hidden />
          روند مصرف روزانه
        </CardTitle>
        <CardDescription>تعداد فراخوانی‌ها در هر روز — ۱۴ روز گذشته با تاریخ شمسی.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-64 w-full" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
              <XAxis
                dataKey="label"
                reversed
                tick={{ fontSize: 10 }}
                interval={0}
                angle={-40}
                textAnchor="end"
                height={56}
                tickLine={false}
                axisLine={{ stroke: "var(--color-border)" }}
              />
              <YAxis
                allowDecimals={false}
                width={34}
                orientation="right"
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => faNum(v)}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--color-muted)" }} />
              <Bar dataKey="count" name="فراخوانی" fill="var(--color-primary)" radius={[6, 6, 0, 0]} maxBarSize={26} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          جدیدترین روز در سمت چپ نمودار است (چیدمان راست‌به‌چپ).
        </p>
      </CardContent>
    </Card>
  );
}

// Persian (Jalali) short label for a UTC day key like "2026-09-13"
function faDayLabel(key: string): string {
  try {
    return new Intl.DateTimeFormat("fa-IR", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(new Date(`${key}T00:00:00Z`));
  } catch {
    return key;
  }
}

// last 14 days (UTC keys — server buckets by UTC day); days without events are real zeros
function buildDailySeries(byDay: Record<string, number>): Array<{ key: string; label: string; count: number }> {
  const now = new Date();
  const out: Array<{ key: string; label: string; count: number }> = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    const key = d.toISOString().slice(0, 10);
    out.push({ key, label: faDayLabel(key), count: byDay[key] ?? 0 });
  }
  return out;
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value?: number | string }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-lg border border-border/60 bg-background px-3 py-2 text-xs shadow-md">
      <p className="font-bold mb-1">{label}</p>
      <p className="tabular-nums text-muted-foreground">{faNum(Number(payload[0].value))} فراخوانی</p>
    </div>
  );
}
