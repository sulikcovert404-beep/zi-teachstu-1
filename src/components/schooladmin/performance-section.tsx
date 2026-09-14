"use client";

// School Admin — عملکرد (spec §20): latest exam results with percent badges

import { useCallback, useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/app/api-client";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageTitle, EmptyState, ErrorState, faDateTime, faNum } from "@/components/shared/blocks";
import { TrendingUp, Trophy } from "lucide-react";
import { type PerformanceRow } from "./shared";
import { TableSkeleton } from "./ui-bits";

export function PerformanceSection() {
  const [performance, setPerformance] = useState<PerformanceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let ignore = false;
    async function start() {
      try {
        const res = await api<{ performance: PerformanceRow[] }>("/api/v1/admin/performance");
        if (!ignore) {
          setPerformance(res.performance);
          setError(null);
        }
      } catch (e) {
        if (!ignore) setError(e instanceof ApiClientError ? e.message : "بارگذاری عملکرد تحصیلی ناموفق بود.");
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
        title="عملکرد تحصیلی"
        description="آخرین نتایج آزمون‌های ثبت‌شدهٔ دانش‌آموزان مدرسه — نمرات به‌صورت خودکار توسط سرور تصحیح می‌شوند."
      />

      {error && <ErrorState message={error} onRetry={() => void reload()} />}

      {!performance && !error && <TableSkeleton rows={5} cols={5} />}

      {performance && performance.length === 0 && !error && (
        <EmptyState
          icon={TrendingUp}
          title="هنوز نتیجه‌ای ثبت نشده است."
          description="وقتی دانش‌آموزان آزمون‌هایشان را تحویل دهند، نتایج و نمرات این‌جا نمایش داده می‌شود."
        />
      )}

      {performance && performance.length > 0 && (
        <div className="rounded-xl border border-border/60 max-h-96 overflow-y-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead className="text-right min-w-[200px]">عنوان آزمون</TableHead>
                <TableHead className="text-right min-w-[130px]">کلاس</TableHead>
                <TableHead className="text-right whitespace-nowrap">نمره</TableHead>
                <TableHead className="text-right">درصد</TableHead>
                <TableHead className="text-right hidden md:table-cell whitespace-nowrap">تاریخ ثبت</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {performance.map((r, i) => (
                <TableRow key={`${r.createdAt}-${i}`}>
                  <TableCell className="py-3.5 font-medium">
                    <span className="flex items-center gap-2">
                      <Trophy className="h-4 w-4 text-amber-500 shrink-0 hidden sm:inline-block" aria-hidden />
                      {r.examTitle}
                    </span>
                  </TableCell>
                  <TableCell className="py-3.5 text-muted-foreground">{r.classroom}</TableCell>
                  <TableCell className="py-3.5 whitespace-nowrap tabular-nums">
                    {faNum(r.score)} از {faNum(r.maxScore)}
                  </TableCell>
                  <TableCell className="py-3.5">
                    <Badge variant={r.percent >= 50 ? "default" : "destructive"} className="tabular-nums">
                      {faNum(r.percent)}٪
                    </Badge>
                  </TableCell>
                  <TableCell className="py-3.5 hidden md:table-cell text-muted-foreground whitespace-nowrap">
                    {faDateTime(r.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
