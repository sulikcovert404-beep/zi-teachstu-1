"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/app/api-client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  EmptyState,
  ErrorState,
  PageTitle,
  faDateTime,
  faNum,
} from "@/components/shared/blocks";
import { BarChart3, TrendingUp } from "lucide-react";
import type { TeacherExamResult } from "./types";

// Exam results (spec §20 Teacher/نتایج) — real graded results of own classrooms only
export function ResultsSection() {
  const [results, setResults] = useState<TeacherExamResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let ignore = false;
    async function start() {
      try {
        const res = await api<{ results: TeacherExamResult[] }>("/api/v1/teacher/exam-results");
        if (!ignore) {
          setResults(res.results);
          setError(null);
        }
      } catch (e) {
        if (!ignore)
          setError(e instanceof ApiClientError ? e.message : "بارگذاری نتایج ناموفق بود.");
      }
    }
    void start();
    return () => {
      ignore = true;
    };
  }, [reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const avgPercent =
    results && results.length > 0
      ? Math.round(results.reduce((s, r) => s + r.percent, 0) / results.length)
      : null;

  return (
    <div className="space-y-4">
      <PageTitle
        title="نتایج آزمون‌ها"
        description="نتایج تصحیح‌شدهٔ دانش‌آموزان کلاس‌های شما — مرتب‌شده از جدیدترین."
      />

      {error && (
        <div className="mb-4">
          <ErrorState message={error} onRetry={() => void reload()} />
        </div>
      )}

      {!results && !error && (
        <Card className="border-border/60">
          <CardContent className="p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </CardContent>
        </Card>
      )}

      {results && results.length === 0 && (
        <EmptyState
          icon={BarChart3}
          title="هنوز نتیجه‌ای ثبت نشده است."
          description="وقتی دانش‌آموزان آزمون‌های تکالیف شما را انجام دهند، نتایج اینجا نمایش داده می‌شود."
        />
      )}

      {results && results.length > 0 && (
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4.5 w-4.5 text-primary" aria-hidden />
              کارنامهٔ کلاس‌ها
              <Badge variant="secondary" className="text-[10px] tabular-nums">
                {faNum(results.length)} نتیجه
              </Badge>
            </CardTitle>
            <CardDescription className="flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5" aria-hidden />
              میانگین درصد کلاس‌ها:
              <span className="font-bold tabular-nums">
                {avgPercent !== null ? `${faNum(avgPercent)}٪` : "—"}
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-border/60 overflow-hidden">
              <div className="max-h-96 overflow-auto">
                <Table className="min-w-[720px]">
                  <TableHeader className="sticky top-0 z-10 bg-card">
                    <TableRow>
                      <TableHead className="text-right">دانش‌آموز</TableHead>
                      <TableHead className="text-right">آزمون</TableHead>
                      <TableHead className="text-right">تکلیف / کلاس</TableHead>
                      <TableHead className="text-right">نمره</TableHead>
                      <TableHead className="text-right">درصد</TableHead>
                      <TableHead className="text-right">تاریخ تحویل</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-right font-bold text-sm">{r.student.fullName}</TableCell>
                        <TableCell className="text-right text-sm">{r.exam.title}</TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          <span className="block truncate max-w-44">{r.assignment.title}</span>
                          <span>{r.assignment.classroom}</span>
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums whitespace-nowrap">
                          {faNum(r.score)} از {faNum(r.maxScore)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge
                            variant={r.percent >= 50 ? "default" : "destructive"}
                            className="tabular-nums"
                          >
                            {faNum(r.percent)}٪
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground whitespace-nowrap">
                          {faDateTime(r.submittedAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
