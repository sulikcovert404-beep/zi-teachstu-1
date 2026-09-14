"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/app/auth-store";
import { api, ApiClientError } from "@/lib/app/api-client";
import { AppShell, type NavItem } from "@/components/app/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  EmptyState, ErrorState, LoadingGrid, PageTitle, StatCard, faDate, faDateTime, faNum, daysUntil,
} from "@/components/shared/blocks";
import { TutorChat } from "./tutor-chat";
import { ExamRunnerDialog } from "./exam-runner";
import { SummarizerTool, FlashcardsTool, StudyPlannerTool } from "./tools";
import { SourceQATool } from "./source-qa-tool";
import { PodcastTool } from "./podcast-tool";
import { BillingSection } from "./billing-section";
import { LibrarySection } from "./library-section";
import { FEATURE_LABELS_FA } from "@/lib/app/labels";
import {
  Sun, BookOpen, FileCheck2, TrendingUp, Sparkles, Layers, CalendarDays, Clock, PlayCircle,
  CheckCircle2, Lock, GraduationCap, Activity, Crown, FileText, BookMarked, Headphones, Library,
} from "lucide-react";

interface Overview {
  today: { dueSoon: Array<any>; openExams: number };
  assignments: Array<any>;
  progress: {
    hasData: boolean;
    assignmentsTotal: number;
    assignmentsSubmitted: number;
    completionRate: number | null;
    examsTaken: number;
    averageScore: number | null;
    tutorInteractions: number;
    flashcards: number;
    recentResults: Array<{ title: string; score: number; maxScore: number; percent: number; createdAt: string }>;
  };
  entitlements: Array<{ feature: string; planCode: string; planName: string; dailyLimit: number; usedToday: number; remaining: number; allowed: boolean }>;
}

const NAV: NavItem[] = [
  { key: "today", label: "امروز", icon: Sun },
  { key: "assignments", label: "تکالیف", icon: BookOpen },
  { key: "library", label: "کتاب‌خانه", icon: Library },
  { key: "tutor", label: "دستیار هوشمند", icon: Sparkles },
  { key: "progress", label: "پیشرفت", icon: TrendingUp },
  { key: "tools", label: "ابزارها", icon: Layers },
  { key: "billing", label: "اشتراک و ارتقا", icon: Crown },
];

export function StudentDashboard() {
  const { me } = useAuth();
  const [section, setSection] = useState("today");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [examAssignmentId, setExamAssignmentId] = useState<string | null>(null);
  const [viewAttemptId, setViewAttemptId] = useState<string | null>(null);
  const [examOpen, setExamOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let ignore = false;
    async function start() {
      try {
        const res = await api<Overview>("/api/v1/student/overview");
        if (!ignore) {
          setOverview(res);
          setError(null);
        }
      } catch (e) {
        if (!ignore) setError(e instanceof ApiClientError ? e.message : "بارگذاری داشبورد ناموفق بود.");
      }
    }
    void start();
    return () => { ignore = true; };
  }, [reloadKey]);

  const load = useCallback(() => setReloadKey((k) => k + 1), []);

  const startExam = useCallback((assignmentId: string, attemptId?: string | null) => {
    setExamAssignmentId(assignmentId);
    setViewAttemptId(attemptId ?? null);
    setExamOpen(true);
  }, []);

  const firstName = me?.user.fullName?.split(" ")[0] ?? "دانش‌آموز";

  return (
    <AppShell
      navItems={NAV}
      activeKey={section}
      onNavigate={setSection}
      title={sectionTitle(section)}
      subtitle={`${firstName} عزیز — ${me?.user.grade ? `پایه ${me.user.grade}` : "پایه شما"} · ${me?.tenant?.name ?? ""}`}
    >
      {error && section !== "billing" && <div className="mb-4"><ErrorState message={error} onRetry={() => void load()} /></div>}

      {!overview && !error && section !== "billing" && <LoadingGrid count={4} />}

      {overview && (
        <>
          {section === "today" && <TodaySection overview={overview} onStartExam={startExam} onGo={setSection} />}
          {section === "assignments" && <AssignmentsSection assignments={overview.assignments} onStartExam={startExam} />}
          {section === "tutor" && <TutorChat />}
          {section === "progress" && <ProgressSection progress={overview.progress} />}
          {section === "tools" && (
            <div className="space-y-4">
              <PageTitle
                title="جعبه‌ابزار هوشمند"
                description="ابزارهای مطالعهٔ هوش مصنوعی — همه با سهمیهٔ روزانهٔ پلن شما."
              />
              <Tabs defaultValue="summarizer">
                <TabsList className="flex-wrap h-auto gap-1 bg-muted/60 p-1">
                  <TabsTrigger value="summarizer" className="gap-1.5 data-[state=active]:shadow-sm">
                    <FileText className="h-3.5 w-3.5" aria-hidden /> خلاصه‌ساز
                  </TabsTrigger>
                  <TabsTrigger value="flashcards" className="gap-1.5 data-[state=active]:shadow-sm">
                    <Layers className="h-3.5 w-3.5" aria-hidden /> فلش‌کارت
                  </TabsTrigger>
                  <TabsTrigger value="planner" className="gap-1.5 data-[state=active]:shadow-sm">
                    <CalendarDays className="h-3.5 w-3.5" aria-hidden /> برنامه‌ریز مطالعه
                  </TabsTrigger>
                  <TabsTrigger value="sources" className="gap-1.5 data-[state=active]:shadow-sm">
                    <BookMarked className="h-3.5 w-3.5" aria-hidden /> پرسش از منابع
                  </TabsTrigger>
                  <TabsTrigger value="podcast" className="gap-1.5 data-[state=active]:shadow-sm">
                    <Headphones className="h-3.5 w-3.5" aria-hidden /> پادکست صوتی
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="summarizer" className="mt-4"><SummarizerTool /></TabsContent>
                <TabsContent value="flashcards" className="mt-4"><FlashcardsTool /></TabsContent>
                <TabsContent value="planner" className="mt-4"><StudyPlannerTool /></TabsContent>
                <TabsContent value="sources" className="mt-4"><SourceQATool /></TabsContent>
                <TabsContent value="podcast" className="mt-4"><PodcastTool /></TabsContent>
              </Tabs>
            </div>
          )}
        </>
      )}

      {/* Billing fetches its own data — mounted independently of overview */}
      {section === "billing" && <BillingSection onChanged={load} />}
      {/* Library fetches its own data too (round 16) */}
      {section === "library" && <LibrarySection onGo={setSection} />}

      <ExamRunnerDialog
        assignmentId={examAssignmentId}
        viewAttemptId={viewAttemptId}
        open={examOpen}
        onOpenChange={(o) => { setExamOpen(o); if (!o) void load(); }}
        onFinished={() => void load()}
      />
    </AppShell>
  );
}

function sectionTitle(key: string): string {
  return NAV.find((n) => n.key === key)?.label ?? "داشبورد دانش‌آموز";
}

// ── Today (spec §20 — امروز) ──
function TodaySection({ overview, onStartExam, onGo }: { overview: Overview; onStartExam: (assignmentId: string, attemptId?: string | null) => void; onGo: (s: string) => void }) {
  const { progress, entitlements, today } = overview;
  const openAssignments = overview.assignments.filter((a) => !a.attempts.some((t: any) => t.state === "GRADED"));
  const ent = (f: string) => entitlements.find((e) => e.feature === f);

  return (
    <div className="space-y-6">
      <PageTitle
        title={`سلام ${"دانش‌آموز"} 👋`}
        description="خلاصهٔ امروز شما — همهٔ اعداد از فعالیت واقعی شما ساخته شده‌اند."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="تکالیف باز" value={openAssignments.length} icon={BookOpen} tone="info" hint={`از ${faNum(progress.assignmentsTotal)} تکلیف کل`} />
        <StatCard label="آزمون‌های انجام‌شده" value={progress.examsTaken} icon={FileCheck2} tone="positive" />
        <StatCard label="میانگین نمره" value={progress.averageScore !== null ? `${faNum(progress.averageScore)}٪` : null} icon={TrendingUp} tone={progress.averageScore !== null && progress.averageScore >= 50 ? "positive" : "warning"} hint={progress.averageScore === null ? "هنوز داده‌ای نیست" : undefined} />
        <StatCard label="گفتگو با دستیار" value={progress.tutorInteractions} icon={Sparkles} hint={progress.flashcards > 0 ? `${faNum(progress.flashcards)} فلش‌کارت` : undefined} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Due soon */}
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4.5 w-4.5 text-primary" aria-hidden /> در انتظار انجام
            </CardTitle>
            <CardDescription>تکالیف و آزمون‌هایی که باید انجام دهید.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {today.dueSoon.length === 0 && openAssignments.length === 0 ? (
              <EmptyState icon={CheckCircle2} title="همه‌چیز انجام شده است!" description="در حال حاضر تکلیف بازی ندارید." />
            ) : (
              (today.dueSoon.length > 0 ? today.dueSoon : openAssignments).slice(0, 4).map((a: any) => {
                const graded = a.attempts?.some((t: any) => t.state === "GRADED");
                const d = a.dueAt ? daysUntil(a.dueAt) : null;
                return (
                  <div key={a.id} className="rounded-xl border border-border/60 p-3.5 flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      {a.exam ? <FileCheck2 className="h-5 w-5" aria-hidden /> : <BookOpen className="h-5 w-5" aria-hidden />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-sm truncate">{a.title}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {a.classroom?.name ?? "—"}
                        {d !== null && ` · ${d >= 0 ? `${faNum(d)} روز تا مهلت` : "مهلت گذشته"}`}
                      </p>
                    </div>
                    {a.exam && !graded && (
                      <Button size="sm" onClick={() => onStartExam(a.id)}>
                        <PlayCircle className="h-4 w-4 ml-1" aria-hidden /> شروع
                      </Button>
                    )}
                    {graded && <Badge variant="secondary">انجام شد</Badge>}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Quotas / paywall (spec §42) */}
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4.5 w-4.5 text-primary" aria-hidden /> وضعیت قابلیت‌های هوشمند
            </CardTitle>
            <CardDescription>سهمیهٔ امروز بر اساس پلن شما ({ent("AI_TUTOR")?.planName ?? "—"}).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {entitlements.map((e) => {
              const pct = e.dailyLimit > 0 ? Math.min(100, (e.usedToday / e.dailyLimit) * 100) : 0;
              return (
                <div key={e.feature} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium flex items-center gap-1.5">
                      {FEATURE_LABELS_FA[e.feature] ?? e.feature}
                      {e.dailyLimit === 0 && <Lock className="h-3 w-3 text-muted-foreground" aria-hidden />}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {faNum(e.usedToday)} / {faNum(e.dailyLimit)}
                    </span>
                  </div>
                  <Progress value={pct} className="h-1.5" />
                </div>
              );
            })}
            <Button
              variant="outline"
              size="sm"
              className="w-full h-11 mt-2 border-primary/40 text-primary hover:bg-primary/10 hover:text-primary"
              onClick={() => onGo("billing")}
            >
              <Crown className="h-4 w-4 ml-1.5" aria-hidden />
              ارتقا به دانش‌آموز پرو ←
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Learning recommendations (spec §20) */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <GraduationCap className="h-4.5 w-4.5 text-primary" aria-hidden /> پیشنهاد ادامهٔ مسیر
          </CardTitle>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Button variant="outline" className="h-auto py-3.5 justify-start gap-2.5" onClick={() => onGo("tutor")}>
            <Sparkles className="h-5 w-5 text-primary shrink-0" aria-hidden />
            <span className="text-right">
              <span className="block text-xs font-bold">از دستیار بپرسید</span>
              <span className="block text-[10px] text-muted-foreground mt-0.5">سؤال درسی‌تان را مرحله‌به‌مرحله بیاموزید</span>
            </span>
          </Button>
          <Button variant="outline" className="h-auto py-3.5 justify-start gap-2.5" onClick={() => onGo("tools")}>
            <BookMarked className="h-5 w-5 text-emerald-600 shrink-0" aria-hidden />
            <span className="text-right">
              <span className="block text-xs font-bold">از منابع کلاس بپرسید</span>
              <span className="block text-[10px] text-muted-foreground mt-0.5">پاسخ مستند با ارجاع به جزوه‌ها</span>
            </span>
          </Button>
          <Button variant="outline" className="h-auto py-3.5 justify-start gap-2.5" onClick={() => onGo("tools")}>
            <Headphones className="h-5 w-5 text-amber-600 shrink-0" aria-hidden />
            <span className="text-right">
              <span className="block text-xs font-bold">پادکست صوتی بسازید</span>
              <span className="block text-[10px] text-muted-foreground mt-0.5">متن درس را گوش کنید، هر جا که هستید</span>
            </span>
          </Button>
          <Button variant="outline" className="h-auto py-3.5 justify-start gap-2.5" onClick={() => onGo("tools")}>
            <CalendarDays className="h-5 w-5 text-primary shrink-0" aria-hidden />
            <span className="text-right">
              <span className="block text-xs font-bold">برنامهٔ مطالعه</span>
              <span className="block text-[10px] text-muted-foreground mt-0.5">برنامهٔ ۱۴ روزهٔ شخصی‌سازی‌شده</span>
            </span>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Assignments (spec §20 — تکالیف) ──
function AssignmentsSection({ assignments, onStartExam }: { assignments: Array<any>; onStartExam: (assignmentId: string, attemptId?: string | null) => void }) {
  if (assignments.length === 0) {
    return <EmptyState icon={BookOpen} title="هنوز تکلیفی برای شما ثبت نشده است." description="وقتی معلم شما تکلیف یا آزمون منتشر کند، اینجا نمایش داده می‌شود." />;
  }
  return (
    <div className="space-y-4">
      <PageTitle title="تکالیف و آزمون‌های من" description="فقط تکالیف کلاس‌های شما — نه چیز دیگری." />
      <div className="grid gap-4">
        {assignments.map((a) => {
          const gradedAttempt = a.attempts?.find((t: any) => t.state === "GRADED");
          const graded = !!gradedAttempt;
          const inProgress = a.attempts?.some((t: any) => t.state === "IN_PROGRESS");
          const d = a.dueAt ? daysUntil(a.dueAt) : null;
          return (
            <Card key={a.id} className="border-border/60">
              <CardContent className="p-4 flex flex-wrap items-center gap-4">
                <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  {a.exam ? <FileCheck2 className="h-5.5 w-5.5" aria-hidden /> : <BookOpen className="h-5.5 w-5.5" aria-hidden />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-bold text-sm">{a.title}</p>
                    {a.exam && <Badge variant="outline">آزمون {faNum(a.exam.durationMinutes)} دقیقه‌ای</Badge>}
                    {graded && <Badge className="bg-emerald-600">نمره ثبت شد</Badge>}
                    {inProgress && !graded && <Badge variant="secondary">در جریان</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 leading-6 line-clamp-2">{a.description}</p>
                  <p className="text-[11px] text-muted-foreground mt-1.5">
                    {a.classroom?.name ?? "—"}
                    {a.dueAt && ` · مهلت: ${faDate(a.dueAt)}${d !== null ? ` (${d >= 0 ? `${faNum(d)} روز مانده` : "گذشته"})` : ""}`}
                  </p>
                </div>
                <div className="shrink-0">
                  {a.exam && !graded && (
                    <Button onClick={() => onStartExam(a.id)}>
                      <PlayCircle className="h-4 w-4 ml-1" aria-hidden />
                      {inProgress ? "ادامهٔ آزمون" : "شروع آزمون"}
                    </Button>
                  )}
                  {a.exam && graded && (
                    <div className="flex gap-2">
                      <Button variant="outline" onClick={() => onStartExam(a.id, gradedAttempt.id)}>
                        مشاهدهٔ نتیجه
                      </Button>
                      <Button variant="ghost" onClick={() => onStartExam(a.id)}>
                        <PlayCircle className="h-4 w-4 ml-1" aria-hidden />
                        کوشش جدید
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ── Progress (spec §19 — real data only) ──
function ProgressSection({ progress }: { progress: Overview["progress"] }) {
  if (!progress.hasData) {
    return (
      <div className="space-y-4">
        <PageTitle title="پیشرفت یادگیری" description="پیشرفت فقط از دادهٔ واقعی شما ساخته می‌شود." />
        <EmptyState
          icon={TrendingUp}
          title="هنوز داده‌ای برای نمایش پیشرفت وجود ندارد."
          description="با شرکت در آزمون‌ها و استفاده از دستیار هوشمند، این بخش به‌صورت خودکار کامل می‌شود."
        />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <PageTitle title="پیشرفت یادگیری" description="همهٔ اعداد از فعالیت واقعی شما محاسبه شده‌اند." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="تکمیل تکالیف" value={progress.completionRate !== null ? `${faNum(progress.completionRate)}٪` : null} icon={BookOpen} tone="info" hint={`${faNum(progress.assignmentsSubmitted)} از ${faNum(progress.assignmentsTotal)}`} />
        <StatCard label="آزمون‌های تصحیح‌شده" value={progress.examsTaken} icon={FileCheck2} tone="positive" />
        <StatCard label="میانگین نمره" value={progress.averageScore !== null ? `${faNum(progress.averageScore)}٪` : null} icon={TrendingUp} tone="positive" />
        <StatCard label="فلش‌کارت‌ها" value={progress.flashcards} icon={Layers} />
      </div>

      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">نتایج اخیر</CardTitle>
          <CardDescription>نتایج آزمون‌های تصحیح‌شدهٔ شما.</CardDescription>
        </CardHeader>
        <CardContent>
          {progress.recentResults.length === 0 ? (
            <EmptyState title="هنوز آزمونی انجام نداده‌اید." description="پس از اولین آزمون، نتایج اینجا نمایش داده می‌شود." />
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {progress.recentResults.map((r, i) => (
                <div key={i} className="rounded-xl border border-border/60 p-3.5 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <p className="font-bold text-sm">{r.title}</p>
                    <Badge variant={r.percent >= 50 ? "default" : "destructive"} className="tabular-nums">
                      {faNum(r.percent)}٪ ({faNum(r.score)}/{faNum(r.maxScore)})
                    </Badge>
                  </div>
                  <Progress value={r.percent} className="h-1.5" />
                  <p className="text-[11px] text-muted-foreground">{faDateTime(r.createdAt)}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
