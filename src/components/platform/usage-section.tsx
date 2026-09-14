"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { api, ApiClientError } from "@/lib/app/api-client";
import { FEATURE_LABELS_FA } from "@/lib/app/labels";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from "@/components/ui/chart";
import { EmptyState, ErrorState, PageTitle, StatCard, faNum } from "@/components/shared/blocks";
import { Gauge, Wallet, Sparkles } from "lucide-react";
import type { PlatformUsage } from "./types";

const chartConfig = {
  calls: { label: "فراخوانی", color: "var(--chart-1)" },
} satisfies ChartConfig;

function faDayTick(day: string): string {
  try {
    return new Intl.DateTimeFormat("fa-IR", { month: "2-digit", day: "2-digit" }).format(
      new Date(`${day}T00:00:00Z`)
    );
  } catch {
    return day;
  }
}

// Spec §80 — مصرف هوش مصنوعی: ۱۴ روز گذشته، تفکیک قابلیت و هزینه برآوردی
export function UsageSection() {
  const [usage, setUsage] = useState<PlatformUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let ignore = false;
    async function start() {
      try {
        const res = await api<PlatformUsage>("/api/v1/platform/usage");
        if (!ignore) {
          setUsage(res);
          setError(null);
        }
      } catch (e) {
        if (!ignore) setError(e instanceof ApiClientError ? e.message : "بارگذاری مصرف ناموفق بود.");
      }
    }
    void start();
    return () => {
      ignore = true;
    };
  }, [reloadKey]);

  const load = useCallback(() => setReloadKey((k) => k + 1), []);

  // Sorted (oldest → newest) daily series for the chart
  const daily = useMemo(() => {
    if (!usage) return [];
    return Object.entries(usage.byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, count]) => ({ day: faDayTick(day), calls: count }));
  }, [usage]);

  // Per-feature usage ordered by count desc for the progress list
  const perFeature = useMemo(() => {
    if (!usage) return [];
    return Object.entries(usage.byFeature)
      .sort(([, a], [, b]) => b - a)
      .map(([key, count]) => ({
        key,
        label: FEATURE_LABELS_FA[key] ?? key,
        count,
      }));
  }, [usage]);

  const maxFeature = perFeature.length > 0 ? perFeature[0].count : 1;

  if (error) {
    return (
      <div className="space-y-4">
        <PageTitle title="مصرف هوش مصنوعی" description="آمار فراخوانی‌های ۱۴ روز گذشته." />
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }

  if (!usage) {
    return (
      <div className="space-y-4">
        <PageTitle title="مصرف هوش مصنوعی" description="آمار فراخوانی‌های ۱۴ روز گذشته." />
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      </div>
    );
  }

  if (usage.total14d === 0) {
    return (
      <div className="space-y-6">
        <PageTitle title="مصرف هوش مصنوعی" description="آمار فراخوانی‌های ۱۴ روز گذشته." />
        <EmptyState
          icon={Sparkles}
          title="هنوز مصرفی ثبت نشده است"
          description="در ۱۴ روز گذشته هیچ فراخوانی هوش مصنوعی روی پلتفرم ثبت نشده است. با اولین استفاده از دستیار آموزشی، این بخش به‌روز می‌شود."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageTitle
        title="مصرف هوش مصنوعی"
        description="آمار فراخوانی‌های ۱۴ روز گذشته — همهٔ اعداد از رویدادهای واقعی دروازه هوش مصنوعی."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label="فراخوانی در ۱۴ روز گذشته"
          value={faNum(usage.total14d)}
          icon={Gauge}
          tone="info"
        />
        <StatCard
          label="هزینه برآوردی"
          value={`${faNum(Math.round(usage.estimatedCostTotal / 1000))} تومان (تقریبی)`}
          icon={Wallet}
          hint="برآورد بر اساس واحد مصرف ثبت‌شده"
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">مصرف روزانه</CardTitle>
            <CardDescription>تعداد فراخوانی‌ها به تفکیک روز (۱۴ روز گذشته).</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-64 w-full">
              <BarChart data={daily} margin={{ left: 8, right: 8, top: 4 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="day"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={10}
                  minTickGap={16}
                />
                <YAxis tickLine={false} axisLine={false} width={36} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} cursor={{ fill: "var(--muted)" }} />
                <Bar dataKey="calls" fill="var(--color-calls)" radius={[6, 6, 0, 0]} minPointSize={3} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">مصرف به تفکیک قابلیت</CardTitle>
            <CardDescription>سهم هر قابلیت از کل فراخوانی‌های ۱۴ روز گذشته.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {perFeature.map((f) => (
              <div key={f.key}>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <p className="text-sm font-medium truncate">{f.label}</p>
                  <p className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                    {faNum(f.count)} فراخوانی
                  </p>
                </div>
                <Progress
                  value={Math.round((f.count / maxFeature) * 100)}
                  aria-label={`سهم قابلیت ${f.label}`}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
