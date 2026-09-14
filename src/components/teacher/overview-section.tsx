"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { EmptyState, PageTitle, StatCard, faNum } from "@/components/shared/blocks";
import { FEATURE_LABELS_FA } from "@/lib/app/labels";
import {
  Activity,
  ChevronLeft,
  ClipboardList,
  FileCheck2,
  GraduationCap,
  Lock,
  School,
  TrendingUp,
  Users,
} from "lucide-react";
import type { TeacherOverview } from "./types";

// Overview (spec §20 Teacher/داشبورد) — real stats only, no fabricated numbers
export function OverviewSection({
  overview,
  onGo,
}: {
  overview: TeacherOverview;
  onGo: (key: string) => void;
}) {
  const { classes, stats, entitlements } = overview;
  const planName = entitlements[0]?.planName ?? "—";

  return (
    <div className="space-y-6">
      <PageTitle
        title="خلاصهٔ وضعیت کلاس‌ها"
        description="همهٔ اعداد از فعالیت واقعی کلاس‌های شما محاسبه شده‌اند."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="کلاس‌های فعال"
          value={stats.classCount}
          icon={Users}
          tone="info"
          hint={`${faNum(stats.studentCount)} دانش‌آموز در مجموع`}
        />
        <StatCard
          label="تکالیف منتشرشده"
          value={stats.assignmentsCount}
          icon={ClipboardList}
        />
        <StatCard
          label="آزمون‌های ساخته‌شده"
          value={stats.examsCount}
          icon={FileCheck2}
          tone="positive"
          hint={`${faNum(stats.gradedResults)} نتیجهٔ تصحیح‌شده`}
        />
        <StatCard
          label="میانگین نمرهٔ آزمون‌ها"
          value={stats.avgExamScore !== null ? `${faNum(stats.avgExamScore)}٪` : null}
          icon={TrendingUp}
          tone={stats.avgExamScore !== null && stats.avgExamScore >= 50 ? "positive" : "warning"}
          hint={stats.avgExamScore === null ? "هنوز داده‌ای نیست" : undefined}
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Class cards */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="font-bold text-sm">کلاس‌های من</h3>
            <Button size="sm" variant="ghost" className="h-9" onClick={() => onGo("classes")}>
              مشاهدهٔ جزئیات <ChevronLeft className="h-4 w-4 mr-1" aria-hidden />
            </Button>
          </div>
          {classes.length === 0 ? (
            <EmptyState
              icon={School}
              title="هنوز کلاسی ثبت نشده است."
              description="کلاس‌های شما توسط مدیر مدرسه ایجاد و به شما نسبت داده می‌شوند."
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {classes.map((c) => (
                <Card key={c.id} className="border-border/60">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-bold text-sm truncate">{c.name}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5 truncate flex items-center gap-1">
                          <School className="h-3 w-3 shrink-0" aria-hidden />
                          {c.schoolName}
                        </p>
                      </div>
                      <Badge variant="outline" className="shrink-0">پایه {c.grade}</Badge>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5" aria-hidden />
                        {faNum(c.studentCount)} دانش‌آموز
                      </span>
                      <span className="flex items-center gap-1.5">
                        <ClipboardList className="h-3.5 w-3.5" aria-hidden />
                        {faNum(c.assignmentsCount)} تکلیف
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="secondary">{c.subject}</Badge>
                      <Button size="sm" variant="outline" className="h-9" onClick={() => onGo("classes")}>
                        <GraduationCap className="h-4 w-4 ml-1" aria-hidden />
                        دانش‌آموزان
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* AI quota mini-panel (spec §42) */}
        <Card className="border-border/60 h-fit">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4.5 w-4.5 text-primary" aria-hidden /> سهمیهٔ قابلیت‌های هوشمند
            </CardTitle>
            <CardDescription>مصرف امروز بر اساس پلن شما ({planName}).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {entitlements.map((e) => {
              const pct = e.dailyLimit > 0 ? Math.min(100, (e.usedToday / e.dailyLimit) * 100) : 0;
              return (
                <div key={e.feature} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium flex items-center gap-1.5 min-w-0">
                      <span className="truncate">
                        {FEATURE_LABELS_FA[e.feature] ?? e.feature}
                      </span>
                      {e.dailyLimit === 0 && <Lock className="h-3 w-3 text-muted-foreground shrink-0" aria-hidden />}
                    </span>
                    <span className="tabular-nums text-muted-foreground shrink-0">
                      {faNum(e.usedToday)} / {faNum(e.dailyLimit)}
                    </span>
                  </div>
                  <Progress value={pct} className="h-1.5" />
                </div>
              );
            })}
            <p className="text-[11px] text-muted-foreground pt-1 leading-5">
              برای سهمیهٔ بیشتر، پلن «معلم پرو» به‌زودی از طریق مدیر مدرسه قابل فعال‌سازی است.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
