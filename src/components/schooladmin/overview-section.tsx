"use client";

// School Admin — نمای کلی (spec §20): real stats + subscription + plan catalog

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { PageTitle, StatCard, faDate, faNum, daysUntil } from "@/components/shared/blocks";
import { FEATURE_LABELS_FA } from "@/lib/app/labels";
import { PLAN_SCOPE_FA, statusLabelFa, type OverviewResponse } from "./shared";
import {
  Users, GraduationCap, School, FileCheck2, TrendingUp, Sparkles,
  BadgeCheck, CalendarClock, Gauge, Wallet, LayoutGrid,
} from "lucide-react";

export function OverviewSection({ overview }: { overview: OverviewResponse }) {
  const { school, stats, subscription, planInfo } = overview;
  // planInfo.current mirrors the active subscription (with limits) or the SCHOOL_FREE default
  const current = planInfo.current;
  const hasScoreData = stats.avgScore !== null && (stats.resultsCount ?? 0) > 0;
  const periodEnd = current.currentPeriodEnd;
  const remaining = periodEnd ? daysUntil(periodEnd) : null;

  return (
    <div className="space-y-6">
      <PageTitle
        title="نمای کلی مدرسه"
        description="خلاصهٔ وضعیت مدرسهٔ شما — همهٔ اعداد از داده‌های واقعی پلتفرم ساخته شده‌اند."
      />

      {/* Stat cards (spec §20 overview) */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="معلم‌ها" value={faNum(stats.teachers)} icon={Users} tone="info" />
        <StatCard label="دانش‌آموزان" value={faNum(stats.students)} icon={GraduationCap} tone="info" />
        <StatCard label="کلاس‌ها" value={faNum(stats.classes)} icon={School} tone="default" />
        <StatCard label="آزمون‌ها" value={faNum(stats.exams)} icon={FileCheck2} tone="default" hint={`${faNum(stats.assignments)} تکلیف ثبت‌شده`} />
        <StatCard
          label="میانگین نمرهٔ آزمون‌ها"
          value={stats.avgScore !== null ? `${faNum(stats.avgScore)}٪` : null}
          icon={TrendingUp}
          tone={stats.avgScore !== null ? (stats.avgScore >= 50 ? "positive" : "warning") : "default"}
          hint={hasScoreData ? `از ${faNum(stats.resultsCount ?? 0)} نتیجهٔ ثبت‌شده` : undefined}
        />
        <StatCard label="فراخوانی هوش مصنوعی امروز" value={faNum(stats.aiCallsToday)} icon={Sparkles} tone="positive" />
      </div>

      {/* Subscription + limits */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Wallet className="h-4.5 w-4.5 text-primary" aria-hidden />
              اشتراک فعلی مدرسه
            </CardTitle>
            <CardDescription>مدرسهٔ {school.name}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-sm font-bold">{current.planName}</p>
                <p className="text-[11px] text-muted-foreground">
                  {subscription ? "بر اساس اشتراک فعال مدرسه" : "پلن پیش‌فرض — بدون اشتراک فعال"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={school.status === "ACTIVE" ? "secondary" : "destructive"}>
                  <BadgeCheck className="h-3 w-3 ml-1" aria-hidden />
                  مدرسه {statusLabelFa(school.status)}
                </Badge>
                <Badge variant="outline">{statusLabelFa(current.status)}</Badge>
              </div>
            </div>

            {periodEnd ? (
              <div className="rounded-xl border border-border/60 bg-muted/30 p-3 flex items-center gap-3">
                <CalendarClock className="h-5 w-5 text-primary shrink-0" aria-hidden />
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">تاریخ پایان دورهٔ فعلی</p>
                  <p className="text-sm font-bold">
                    {faDate(periodEnd)}
                    {remaining !== null && (
                      <span className="text-xs font-normal text-muted-foreground mr-2">
                        {remaining >= 0 ? `(${faNum(remaining)} روز باقی‌مانده)` : "(منقضی شده)"}
                      </span>
                    )}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground rounded-xl border border-dashed border-border/60 p-3">
                این پلن تاریخ انقضا ندارد و تا زمان ارتقا به پلن دیگری فعال می‌ماند.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Gauge className="h-4.5 w-4.5 text-primary" aria-hidden />
              سهمیهٔ روزانهٔ قابلیت‌های هوشمند
            </CardTitle>
            <CardDescription>بر اساس پلن فعلی ({current.planName}) — محدودیت‌ها در سرور اعمال می‌شوند.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {Object.keys(current.limits).length === 0 ? (
              <p className="text-xs text-muted-foreground">سهمیه‌ای برای این پلن تعریف نشده است.</p>
            ) : (
              Object.entries(current.limits).map(([feature, limit]) => (
                <div key={feature} className="flex items-center justify-between gap-3 rounded-lg border border-border/50 px-3 py-2.5">
                  <span className="text-xs font-medium truncate">{FEATURE_LABELS_FA[feature] ?? feature}</span>
                  <span className="text-xs font-bold tabular-nums shrink-0">{faNum(limit)} بار در روز</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Plan catalog */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <LayoutGrid className="h-4.5 w-4.5 text-primary" aria-hidden />
            پلن‌های موجود پلتفرم
          </CardTitle>
          <CardDescription>مقایسهٔ پلن‌ها و سهمیه‌های روزانهٔ هر پلن.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border border-border/60 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">پلن</TableHead>
                  <TableHead className="text-right">دامنه</TableHead>
                  <TableHead className="text-right">قیمت ماهانه</TableHead>
                  <TableHead className="text-right min-w-[240px]">سهمیهٔ روزانه</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {planInfo.catalog.map((plan) => (
                  <TableRow key={plan.code}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2 flex-wrap">
                        {plan.name}
                        {current.planCode === plan.code && (
                          <Badge variant="secondary" className="text-[10px]">پلن فعلی</Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell>{PLAN_SCOPE_FA[plan.roleScope] ?? plan.roleScope}</TableCell>
                    <TableCell className="tabular-nums whitespace-nowrap">
                      {plan.priceMonthly === 0 ? "رایگان" : `${faNum(plan.priceMonthly)} تومان`}
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5 flex-wrap">
                        {Object.entries(plan.limits).map(([feature, limit]) => (
                          <Badge key={feature} variant="outline" className="text-[10px] font-normal tabular-nums">
                            {FEATURE_LABELS_FA[feature] ?? feature}: {faNum(limit)}
                          </Badge>
                        ))}
                        {Object.keys(plan.limits).length === 0 && (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
