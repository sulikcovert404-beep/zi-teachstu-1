"use client";

// ── Round 28 — نمای «درس‌محور» کتاب (معماری تنبل) ──
// خواستهٔ مدیر: «هر کسی اون درس را انتخاب کرد، اولین نفر تولید همهٔ کارهای آن درس
// را با AI شروع می‌کند و ذخیره می‌شود؛ نفر دوم همان درس را فوری از خروجی ذخیره‌شده
// می‌گیرد.» این کامپوننت انتخابگر درس‌ها + پنل کامل یک درس (خلاصه/جزوه/شکل/آزمون/
// پادکست) با poll زندهٔ وضعیت تولید است.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Markdown from "react-markdown";
import { toast as sonnerToast } from "sonner";
import { api, ApiClientError, getToken } from "@/lib/app/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, faNum } from "@/components/shared/blocks";
import { cn } from "@/lib/utils";
import { toast, useToast } from "@/hooks/use-toast";
import {
  ArrowRight, BookOpen, Check, Cloud, Headphones, Layers, Loader2, NotebookPen,
  RefreshCw, Shapes, Sparkles, Trophy, X,
} from "lucide-react";

export type ArtifactStatus = "PENDING" | "GENERATING" | "READY" | "FAILED";

export interface LessonMeta {
  id: string;
  order: number;
  title: string;
  kind: string;
  status: string;
  summaryStatus: string;
  studyNotesStatus: string;
  quizStatus: string;
  figuresStatus: string;
  podcastStatus: string;
  quizCount: number;
  podcastDurationSec: number | null;
}

interface LessonFigure {
  id: string;
  title: string;
  svg: string;
  caption: string;
}

interface LessonDetail extends LessonMeta {
  bookId: string;
  bookTitle: string;
  level: string | null;
  levelLabel: string | null;
  gradeLevel: string | null;
  subject: string | null;
  summary: string | null;
  studyNotes: string | null;
  quizModels: Array<{ kind: "mc" | "tf" | "fb" | "short"; label: string; count: number }>;
  figures: LessonFigure[];
  figuresCount: number;
  podcastInTelegram: boolean;
  errorReason: string | null;
  firstAccessAt: string | null;
}

interface QuizItem {
  id: string;
  kind: "mc" | "tf" | "fb" | "short";
  prompt: string;
  options?: string[];
  topic?: string | null;
}

interface QuizData {
  lessonId: string;
  lessonTitle: string;
  lessonOrder: number;
  model: string;
  modelLabel: string;
  maxScore: number;
  items: QuizItem[];
}

interface PerQuestion {
  id: string;
  kind: string;
  prompt: string;
  yourAnswer: string | null;
  correct: boolean | null;
  correctAnswer: string;
  explanation: string | null;
}

interface LessonQuizResult {
  score: number;
  maxScore: number;
  percent: number;
  previousBest: number;
  newBest: boolean;
  pointsAwarded: number;
  perQuestion: PerQuestion[];
}

const MODEL_LABEL: Record<string, string> = {
  MC: "چهارگزینه‌ای",
  TF: "درست/غلط",
  MIXED: "ترکیبی",
  FB: "جای خالی",
  SHORT: "تشریحی کوتاه",
};

function statusTone(s: string): { dot: string; label: string; text: string } {
  if (s === "READY") return { dot: "bg-emerald-500", label: "آماده", text: "text-emerald-700 dark:text-emerald-400" };
  if (s === "FAILED") return { dot: "bg-rose-500", label: "ناموفق", text: "text-rose-700 dark:text-rose-400" };
  if (s === "GENERATING") return { dot: "bg-amber-500 animate-pulse", label: "در حال ساخت", text: "text-amber-700 dark:text-amber-400" };
  return { dot: "bg-muted-foreground/40", label: "نساخته شده", text: "text-muted-foreground" };
}

function isLessonBusy(l: { status: string }): boolean {
  return l.status === "GENERATING" || l.status === "PENDING";
}

async function fetchBlob(url: string): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
  if (!res.ok) {
    let message = "دریافت فایل از سرور ناموفق بود.";
    let deepLink: string | undefined;
    try {
      const body = (await res.json()) as { error?: { message?: string; deepLink?: string } } | null;
      if (body?.error?.message) message = body.error.message;
      deepLink = body?.error?.deepLink;
    } catch {
      /* binary body */
    }
    throw new ApiClientError("DOWNLOAD_FAILED", message, res.status, deepLink);
  }
  const cd = res.headers.get("Content-Disposition") ?? "";
  const star = /filename\*=UTF-8''([^;]+)/.exec(cd);
  return { blob: await res.blob(), filename: star ? decodeURIComponent(star[1]) : "file" };
}

function LessonMarkdown({ text }: { text: string }) {
  return (
    <div className="text-sm leading-8" dir="auto">
      <Markdown
        components={{
          h1: ({ children }) => <h2 className="text-base font-extrabold mt-5 mb-2 text-emerald-700 dark:text-emerald-400">{children}</h2>,
          h2: ({ children }) => <h3 className="text-sm font-extrabold mt-4 mb-2 text-emerald-700 dark:text-emerald-400">{children}</h3>,
          h3: ({ children }) => <h4 className="text-sm font-bold mt-3.5 mb-1.5">{children}</h4>,
          p: ({ children }) => <p className="my-2.5">{children}</p>,
          ul: ({ children }) => <ul className="list-disc pr-5 space-y-1.5 my-2.5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pr-5 space-y-1.5 my-2.5">{children}</ol>,
          li: ({ children }) => <li className="leading-7">{children}</li>,
          strong: ({ children }) => <strong className="font-bold">{children}</strong>,
          blockquote: ({ children }) => (
            <blockquote className="border-r-4 border-emerald-500/40 pr-3 my-2.5 bg-muted/40 rounded-l-lg py-1.5">{children}</blockquote>
          ),
          hr: () => <hr className="my-4 border-border/60" />,
          code: ({ children }) => <code className="bg-muted rounded px-1.5 py-0.5 text-[13px]" dir="ltr">{children}</code>,
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}

export function LessonView({
  bookId,
  lessons,
  bookTitle,
  lessonsKind,
  onChanged,
  onPointsGained,
}: {
  bookId: string;
  lessons: LessonMeta[];
  bookTitle: string;
  lessonsKind: string | null;
  onChanged?: () => void;
  onPointsGained?: () => void;
}) {
  const { toast } = useToast();
  // انتخاب درس عمداً null شروع می‌شود — تولیدِ تنبل فقط با «انتخاب صریح کاربر»
  // شروع می‌شود (خواستهٔ مدیر: اولین نفری که درس را انتخاب کرد…).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lesson, setLesson] = useState<LessonDetail | null>(null);
  const [lessonError, setLessonError] = useState<string | null>(null);
  const [meta, setMeta] = useState<LessonMeta[]>(lessons);
  const [reloadKey, setReloadKey] = useState(0);

  // quiz state
  const [quiz, setQuiz] = useState<QuizData | null>(null);
  const [quizModel, setQuizModel] = useState<string>("MC");
  const [quizLoading, setQuizLoading] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<LessonQuizResult | null>(null);

  // podcast state
  const [podcastLoading, setPodcastLoading] = useState(false);
  const [podcastUrl, setPodcastUrl] = useState<string | null>(null);
  const [podcastFilename, setPodcastFilename] = useState<string>("podcast.wav");
  const [podcastError, setPodcastError] = useState<string | null>(null);
  const podcastUrlRef = useRef<string | null>(null);

  // ── بارگذاری درس انتخاب‌شده — همین GET اولین انتخاب را trigger می‌کند (سرور) ──
  useEffect(() => {
    if (!selectedId) return;
    let ignore = false;
    void (async () => {
      try {
        const res = await api<LessonDetail>(`/api/v1/books/${bookId}/lessons/${selectedId}`);
        if (!ignore) {
          setLesson(res);
          setLessonError(null);
          setMeta((prev) => prev.map((m) => (m.id === res.id ? { ...m, ...res } : m)));
        }
      } catch (e) {
        if (!ignore) setLessonError(e instanceof ApiClientError ? e.message : "بارگذاری درس ناموفق بود.");
      }
    })();
    return () => {
      ignore = true;
    };
  }, [bookId, selectedId, reloadKey]);

  const busy = !!lesson && isLessonBusy(lesson);

  // poll زندهٔ وضعیت تولید درس (تا READY/FAILED/PARTIAL)
  useEffect(() => {
    if (!busy || !selectedId) return;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const res = await api<LessonDetail>(`/api/v1/books/${bookId}/lessons/${selectedId}`);
          setLesson(res);
          setMeta((prev) => prev.map((m) => (m.id === res.id ? { ...m, ...res } : m)));
        } catch {
          /* next tick retries */
        }
      })();
    }, 5000);
    return () => clearInterval(timer);
  }, [busy, bookId, selectedId]);

  // اعلام اتمام تولید به لیست والد (برای به‌روز شدن نشان‌ها)
  const prevBusyRef = useRef(busy);
  useEffect(() => {
    if (prevBusyRef.current && !busy) onChanged?.();
    prevBusyRef.current = busy;
  }, [busy, onChanged]);

  // چرخهٔ object-URL پادکست
  useEffect(() => {
    return () => {
      if (podcastUrlRef.current) URL.revokeObjectURL(podcastUrlRef.current);
      podcastUrlRef.current = null;
    };
  }, [podcastUrl]);

  const refreshLesson = useCallback(async () => {
    if (!selectedId) return;
    try {
      const res = await api<LessonDetail>(`/api/v1/books/${bookId}/lessons/${selectedId}`);
      setLesson(res);
      setMeta((prev) => prev.map((m) => (m.id === res.id ? { ...m, ...res } : m)));
    } catch {
      /* silent */
    }
  }, [bookId, selectedId]);

  // وقتی درس عوض می‌شود، وضعت آزمون/پادکست ریست شود
  useEffect(() => {
    setQuiz(null);
    setResult(null);
    setAnswers({});
    setQuizModel("MC");
    if (podcastUrlRef.current) URL.revokeObjectURL(podcastUrlRef.current);
    podcastUrlRef.current = null;
    setPodcastUrl(null);
    setPodcastError(null);
  }, [selectedId]);

  async function startQuiz(model: string) {
    if (!selectedId) return;
    setQuizLoading(true);
    setQuizModel(model);
    setResult(null);
    setAnswers({});
    try {
      const res = await api<QuizData>(`/api/v1/books/${bookId}/lessons/${selectedId}/quiz?model=${model}`);
      setQuiz(res);
    } catch (e) {
      toast({
        title: "شروع آزمون ممکن نشد",
        description: e instanceof ApiClientError ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setQuizLoading(false);
    }
  }

  async function submitQuiz() {
    if (!selectedId || !quiz) return;
    setSubmitting(true);
    try {
      const res = await api<LessonQuizResult>(`/api/v1/books/${bookId}/lessons/${selectedId}/quiz/submit`, {
        method: "POST",
        body: JSON.stringify({ model: quizModel, answers }),
      });
      setResult(res);
      if (res.pointsAwarded > 0) onPointsGained?.();
      toast({
        title: `نتیجهٔ آزمونِ ${quiz.lessonTitle}`,
        description: `${faNum(res.score)} از ${faNum(res.maxScore)} (${faNum(res.percent)}٪)${res.pointsAwarded > 0 ? ` · +${faNum(res.pointsAwarded)} امتیاز` : ""}`,
      });
    } catch (e) {
      toast({
        title: "ثبت پاسخ‌ها ناموفق بود",
        description: e instanceof ApiClientError ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function playPodcast() {
    if (!selectedId) return;
    setPodcastLoading(true);
    setPodcastError(null);
    try {
      const { blob, filename } = await fetchBlob(`/api/v1/books/${bookId}/lessons/${selectedId}/podcast`);
      if (podcastUrlRef.current) URL.revokeObjectURL(podcastUrlRef.current);
      const url = URL.createObjectURL(blob);
      podcastUrlRef.current = url;
      setPodcastUrl(url);
      setPodcastFilename(filename);
    } catch (e) {
      if (e instanceof ApiClientError && e.deepLink) {
        const link = e.deepLink;
        sonnerToast.error(e.message, {
          duration: 30000,
          action: { label: "دریافت از تلگرام", onClick: () => window.open(link, "_blank") },
        });
      } else {
        setPodcastError(e instanceof ApiClientError ? e.message : "پخش پادکست ناموفق بود.");
      }
    } finally {
      setPodcastLoading(false);
    }
  }

  async function regenerate(kind: string) {
    if (!selectedId) return;
    try {
      await api(`/api/v1/books/${bookId}/lessons/${selectedId}/regenerate`, {
        method: "POST",
        body: JSON.stringify({ kind }),
      });
      toast({ title: "بازتولید شروع شد", description: "چند لحظه بعد این درس را دوباره باز کنید یا صبر کنید تا خودکار به‌روز شود." });
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast({
        title: "بازتولید ممکن نشد",
        description: e instanceof ApiClientError ? e.message : undefined,
        variant: "destructive",
      });
    }
  }

  const kindLabel = lessonsKind ?? "درس";
  const answeredCount = useMemo(() => Object.values(answers).filter((v) => v !== "").length, [answers]);

  return (
    <div className="space-y-5">
      {/* ── انتخابگر درس ── */}
      <div>
        <div className="flex items-center gap-2 mb-2.5 flex-wrap">
          <Layers className="h-4 w-4 text-emerald-600" aria-hidden />
          <p className="text-sm font-bold">{faNum(meta.length)} {kindLabel} شناسایی شد</p>
          <Badge variant="secondary" className="text-[10px]">انتخاب {kindLabel} → ساخت خودکار محتوا در اولین بازدید</Badge>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {meta.map((l) => {
            const tone = statusTone(l.status);
            const selected = l.id === selectedId;
            return (
              <button
                key={l.id}
                onClick={() => setSelectedId(l.id)}
                className={cn(
                  "text-right rounded-xl border p-3 transition-all min-h-[64px] active:scale-[0.98]",
                  selected
                    ? "border-emerald-500/60 bg-emerald-500/10 ring-1 ring-emerald-500/30"
                    : "border-border/60 hover:border-emerald-500/40 hover:bg-muted/40"
                )}
                aria-pressed={selected}
              >
                <div className="flex items-center gap-2">
                  <span className="h-7 w-7 rounded-lg bg-emerald-500/15 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs font-extrabold flex items-center justify-center shrink-0 tabular-nums">
                    {faNum(l.order)}
                  </span>
                  <span className={cn("h-2 w-2 rounded-full shrink-0", tone.dot)} aria-label={tone.label} />
                  <span className="text-[10px] text-muted-foreground shrink-0">{tone.label}</span>
                </div>
                <p className="text-xs font-bold leading-5 mt-1.5 line-clamp-2">{l.title}</p>
              </button>
            );
          })}
        </div>
      </div>

      {lessonError && <ErrorState message={lessonError} onRetry={() => setReloadKey((k) => k + 1)} />}

      {!selectedId && !lessonError && (
        <EmptyState
          icon={Layers}
          title={`${kindLabel} موردنظرت را انتخاب کن`}
          description={`محتوای هر ${kindLabel} (خلاصه، جزوه، شکل، نمونه‌سؤال و پادکست) بار اول که انتخاب شود با هوش مصنوعی ساخته و ذخیره می‌شود — دفعات بعد فوری آماده است.`}
        />
      )}

      {selectedId && !lesson && !lessonError && (
        <div className="space-y-3">
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      )}

      {lesson && (
        <div className="space-y-5">
          {/* ── سربرگ درس ── */}
          <div className="rounded-xl border border-emerald-500/25 bg-gradient-to-l from-emerald-500/10 via-transparent to-teal-500/10 p-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm font-extrabold leading-6">
                  {kindLabel} {faNum(lesson.order)} — {lesson.title}
                </p>
                <p className="text-[11px] text-muted-foreground mt-1 leading-5">
                  از کتاب «{lesson.bookTitle}»
                  {lesson.subject ? ` · درس ${lesson.subject}` : ""}
                  {lesson.levelLabel ? ` · ${lesson.levelLabel}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {([
                  ["summaryStatus", "خلاصه"],
                  ["studyNotesStatus", "جزوه"],
                  ["quizStatus", "آزمون"],
                  ["figuresStatus", "شکل"],
                  ["podcastStatus", "پادکست"],
                ] as const).map(([field, label]) => {
                  const tone = statusTone(lesson[field]);
                  return (
                    <Badge key={field} variant="outline" className={cn("text-[9px] gap-1", tone.text)}>
                      <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} aria-hidden />
                      {label}: {tone.label}
                    </Badge>
                  );
                })}
              </div>
            </div>
            {busy && (
              <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 flex items-center gap-2 text-[11px] text-amber-700 dark:text-amber-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" aria-hidden />
                <span className="leading-5">
                  در حال ساخت محتوای این {kindLabel} با هوش مصنوعی (خلاصه، جزوه، نمونه‌سؤال، شکل و پادکست) — این بخش هر ۵ ثانیه خودکار به‌روز می‌شود.
                </span>
              </div>
            )}
            {lesson.status === "FAILED" && (
              <div className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-2.5 flex items-start gap-2 text-[11px] text-rose-700 dark:text-rose-400">
                <X className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden />
                <span className="leading-5">
                  بخشی از محتوای این {kindLabel} ساخته نشد{lesson.errorReason ? ` — ${lesson.errorReason}` : ""}.
                </span>
              </div>
            )}
          </div>

          {/* ── خلاصه ── */}
          {lesson.summaryStatus === "READY" && lesson.summary ? (
            <Card className="border-border/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-emerald-600" aria-hidden />
                  خلاصهٔ هوشمند {kindLabel}
                </CardTitle>
                <CardDescription>ساختارمند و متناسب با سن و دورهٔ تحصیلی — بر پایهٔ متن همین {kindLabel} از کتاب.</CardDescription>
              </CardHeader>
              <CardContent>
                <LessonMarkdown text={lesson.summary} />
              </CardContent>
            </Card>
          ) : (
            lesson.summaryStatus === "FAILED" && (
              <RetryCard title={`خلاصهٔ ${kindLabel}`} onRetry={() => void regenerate("summary")} />
            )
          )}

          {/* ── جزوه ── */}
          {lesson.studyNotesStatus === "READY" && lesson.studyNotes ? (
            <Card className="border-border/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <NotebookPen className="h-4 w-4 text-teal-600" aria-hidden />
                  جزوهٔ شبامتحان {kindLabel}
                </CardTitle>
                <CardDescription>تعاریف، نکات کلیدی و نکته‌های امتحانی همین {kindLabel} — برای مرور سریع.</CardDescription>
              </CardHeader>
              <CardContent>
                <LessonMarkdown text={lesson.studyNotes} />
              </CardContent>
            </Card>
          ) : (
            lesson.studyNotesStatus === "FAILED" && (
              <RetryCard title={`جزوهٔ ${kindLabel}`} onRetry={() => void regenerate("notes")} />
            )
          )}

          {/* ── شکل‌های آموزشی ── */}
          {lesson.figuresStatus === "READY" && lesson.figures.length > 0 && (
            <Card className="border-border/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Shapes className="h-4 w-4 text-sky-600" aria-hidden />
                  شکل‌های آموزشی
                  <Badge variant="secondary" className="text-[10px] tabular-nums">{faNum(lesson.figures.length)} شکل</Badge>
                </CardTitle>
                <CardDescription>نمودارها و شکل‌های مفهومی همین {kindLabel}.</CardDescription>
              </CardHeader>
              <CardContent className="grid sm:grid-cols-2 gap-3">
                {lesson.figures.map((f) => (
                  <figure key={f.id} className="rounded-xl border border-border/60 overflow-hidden bg-card">
                    <div className="p-3 bg-[#f8fafc] dark:bg-muted/30" dangerouslySetInnerHTML={{ __html: f.svg }} />
                    <figcaption className="px-3 py-2 text-[11px] leading-5 border-t border-border/60">
                      <span className="font-bold">{f.title}</span>
                      {f.caption ? ` — ${f.caption}` : ""}
                    </figcaption>
                  </figure>
                ))}
              </CardContent>
            </Card>
          )}

          {/* ── پادکست ── */}
          {lesson.podcastStatus === "READY" && (
            <Card className="border-border/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Headphones className="h-4 w-4 text-violet-600" aria-hidden />
                  پادکست {kindLabel}
                  {lesson.podcastDurationSec ? (
                    <Badge variant="secondary" className="text-[10px] tabular-nums">
                      {faNum(Math.floor(lesson.podcastDurationSec / 60))}:{String(lesson.podcastDurationSec % 60).padStart(2, "0")}
                    </Badge>
                  ) : null}
                  {lesson.podcastInTelegram && (
                    <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 text-[9px]">
                      <Cloud className="h-3 w-3 ml-0.5" aria-hidden />
                      ذخیره‌شده در تلگرام
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription>گفتار طبیعی با گویندهٔ هوش مصنوعی — برای مرور در مسیر.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {!podcastUrl ? (
                  <Button
                    onClick={() => void playPodcast()}
                    disabled={podcastLoading}
                    className="h-10 bg-gradient-to-l from-violet-600 to-fuchsia-600 text-white hover:brightness-110"
                  >
                    {podcastLoading ? <Loader2 className="h-4 w-4 animate-spin ml-1.5" aria-hidden /> : <Headphones className="h-4 w-4 ml-1.5" aria-hidden />}
                    پخش پادکست
                  </Button>
                ) : (
                  <div className="space-y-2">
                    <audio controls src={podcastUrl} className="w-full h-10" preload="metadata" />
                    <a
                      href={podcastUrl}
                      download={podcastFilename}
                      className="inline-flex items-center gap-1.5 text-xs text-violet-700 dark:text-violet-400 hover:underline"
                    >
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                      دانلود فایل صوتی
                    </a>
                  </div>
                )}
                {podcastError && <p className="text-[11px] text-rose-600 leading-5">{podcastError}</p>}
              </CardContent>
            </Card>
          )}
          {lesson.podcastStatus === "FAILED" && <RetryCard title={`پادکست ${kindLabel}`} onRetry={() => void regenerate("podcast")} />}

          {/* ── نمونه‌سؤال ── */}
          {lesson.quizStatus === "READY" && lesson.quizModels.length > 0 && (
            <Card className="border-border/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-amber-600" aria-hidden />
                  نمونه‌سؤال‌های {kindLabel}
                  <Badge variant="secondary" className="text-[10px] tabular-nums">{faNum(lesson.quizCount)} سؤال</Badge>
                </CardTitle>
                <CardDescription>چهار مدل سؤال با تصحیح خودکار سمت سرور و امتیاز برای رکورد شخصی بهتر.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!quiz && !result && (
                  <div className="flex flex-wrap gap-2">
                    {lesson.quizModels.map((m) => (
                      <Button
                        key={m.kind}
                        size="sm"
                        variant="outline"
                        onClick={() => void startQuiz(m.kind.toUpperCase())}
                        disabled={quizLoading}
                        className="h-9"
                      >
                        {quizLoading && quizModel === m.kind.toUpperCase() ? (
                          <Loader2 className="h-4 w-4 animate-spin ml-1.5" aria-hidden />
                        ) : null}
                        {m.label} ({faNum(m.count)})
                      </Button>
                    ))}
                  </div>
                )}

                {quiz && !result && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="text-xs font-bold">
                        آزمون {MODEL_LABEL[quiz.model] ?? quiz.model} — {quiz.lessonTitle}
                        <span className="text-muted-foreground font-normal"> ({faNum(quiz.maxScore)} سؤال)</span>
                      </p>
                      <Button size="sm" variant="ghost" onClick={() => setQuiz(null)} className="h-8 text-xs">
                        <X className="h-3.5 w-3.5 ml-1" aria-hidden />
                        انصراف
                      </Button>
                    </div>
                    <div className="space-y-4 max-h-[420px] overflow-y-auto pl-1">
                      {quiz.items.map((it, idx) => (
                        <div key={it.id} className="rounded-xl border border-border/60 p-3.5 space-y-2.5">
                          <div className="flex items-start gap-2">
                            <span className="text-[10px] font-extrabold text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5 tabular-nums">
                              {faNum(idx + 1)}.
                            </span>
                            <p className="text-sm font-medium leading-7 flex-1" dir="auto">{it.prompt}</p>
                          </div>
                          {it.topic && <Badge variant="outline" className="text-[9px]">{it.topic}</Badge>}

                          {it.kind === "mc" && (
                            <div className="grid gap-1.5">
                              {(it.options ?? []).map((opt, i) => (
                                <button
                                  key={i}
                                  onClick={() => setAnswers((a) => ({ ...a, [it.id]: String(i) }))}
                                  className={cn(
                                    "text-right rounded-lg border px-3 py-2 text-xs leading-6 transition-all active:scale-[0.99]",
                                    answers[it.id] === String(i)
                                      ? "border-emerald-500/60 bg-emerald-500/10 font-bold"
                                      : "border-border/60 hover:border-emerald-500/40"
                                  )}
                                  aria-pressed={answers[it.id] === String(i)}
                                >
                                  {opt}
                                </button>
                              ))}
                            </div>
                          )}
                          {it.kind === "tf" && (
                            <div className="flex gap-2">
                              {["صحیح", "غلط"].map((opt, i) => (
                                <button
                                  key={opt}
                                  onClick={() => setAnswers((a) => ({ ...a, [it.id]: i === 0 ? "true" : "false" }))}
                                  className={cn(
                                    "flex-1 rounded-lg border px-3 py-2 text-xs font-bold transition-all active:scale-[0.98]",
                                    (answers[it.id] ?? "") === (i === 0 ? "true" : "false")
                                      ? "border-emerald-500/60 bg-emerald-500/10"
                                      : "border-border/60 hover:border-emerald-500/40"
                                  )}
                                  aria-pressed={(answers[it.id] ?? "") === (i === 0 ? "true" : "false")}
                                >
                                  {opt}
                                </button>
                              ))}
                            </div>
                          )}
                          {it.kind === "fb" && (
                            <Input
                              value={answers[it.id] ?? ""}
                              onChange={(e) => setAnswers((a) => ({ ...a, [it.id]: e.target.value }))}
                              placeholder="پاسخ کوتاه…"
                              className="h-10 text-sm"
                            />
                          )}
                          {it.kind === "short" && (
                            <Input
                              value={answers[it.id] ?? ""}
                              onChange={(e) => setAnswers((a) => ({ ...a, [it.id]: e.target.value }))}
                              placeholder="پاسخ شما (خودآزمایی — با پاسخ نمونه مقایسه می‌شود)…"
                              className="h-10 text-sm"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                      <Button
                        onClick={() => void submitQuiz()}
                        disabled={submitting || answeredCount === 0}
                        className="h-10 bg-gradient-to-l from-emerald-600 to-teal-600 text-white hover:brightness-110"
                      >
                        {submitting ? <Loader2 className="h-4 w-4 animate-spin ml-1.5" aria-hidden /> : <Check className="h-4 w-4 ml-1.5" aria-hidden />}
                        ثبت پاسخ‌ها ({faNum(answeredCount)}/{faNum(quiz.maxScore)})
                      </Button>
                      <span className="text-[10px] text-muted-foreground">امتیاز فقط برای بهبود رکورد شخصی همین درس داده می‌شود.</span>
                    </div>
                  </div>
                )}

                {result && (
                  <div className="space-y-4">
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-center">
                      <Trophy className="h-7 w-7 mx-auto text-amber-500" aria-hidden />
                      <p className="text-lg font-extrabold mt-2 tabular-nums">
                        {faNum(result.score)} از {faNum(result.maxScore)} ({faNum(result.percent)}٪)
                      </p>
                      {result.newBest && <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-1 font-bold">🏆 رکورد جدید!</p>}
                      {result.pointsAwarded > 0 && (
                        <Badge className="mt-2 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 text-[10px] tabular-nums">
                          +{faNum(result.pointsAwarded)} امتیاز
                        </Badge>
                      )}
                    </div>
                    <div className="space-y-3 max-h-[380px] overflow-y-auto pl-1">
                      {result.perQuestion.map((q, idx) => (
                        <div
                          key={q.id}
                          className={cn(
                            "rounded-xl border p-3 text-xs leading-6",
                            q.correct === true
                              ? "border-emerald-500/40 bg-emerald-500/5"
                              : q.correct === false
                                ? "border-rose-500/40 bg-rose-500/5"
                                : "border-border/60"
                          )}
                        >
                          <div className="flex items-start gap-2">
                            {q.correct === true ? (
                              <Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" aria-hidden />
                            ) : q.correct === false ? (
                              <X className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" aria-hidden />
                            ) : (
                              <Sparkles className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" aria-hidden />
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="font-medium" dir="auto">{faNum(idx + 1)}. {q.prompt}</p>
                              <p className="mt-1 text-muted-foreground">
                                پاسخ شما: <span className="font-bold">{q.yourAnswer ?? "—"}</span>
                                {q.correct !== null && (
                                  <>
                                    {" "}· پاسخ درست: <span className="font-bold text-emerald-700 dark:text-emerald-400">{q.correctAnswer}</span>
                                  </>
                                )}
                              </p>
                              {q.explanation && <p className="mt-1 text-muted-foreground leading-6" dir="auto">{q.explanation}</p>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <Button size="sm" variant="outline" onClick={() => { setResult(null); setQuiz(null); }} className="h-9">
                        <RefreshCw className="h-3.5 w-3.5 ml-1.5" aria-hidden />
                        آزمون دوباره
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
          {lesson.quizStatus === "FAILED" && <RetryCard title={`نمونه‌سؤال‌های ${kindLabel}`} onRetry={() => void regenerate("quiz")} />}
          {lesson.figuresStatus === "FAILED" && <RetryCard title={`شکل‌های ${kindLabel}`} onRetry={() => void regenerate("figures")} />}

          {/* ── راهنمای معماری ── */}
          <p className="text-[10px] text-muted-foreground leading-5 flex items-center gap-1.5 flex-wrap">
            <Layers className="h-3 w-3 shrink-0" aria-hidden />
            محتوای هر {kindLabel} بار اول که انتخاب شود ساخته و ذخیره می‌شود؛ انتخاب‌های بعدی فوری از همان خروجی استفاده می‌کنند.
          </p>
        </div>
      )}
    </div>
  );
}

function RetryCard({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <Card className="border-rose-500/30">
      <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs text-rose-700 dark:text-rose-400">
          <X className="h-4 w-4 shrink-0" aria-hidden />
          <span className="font-bold">{title}</span>
          <span className="text-muted-foreground">— ساخته نشد</span>
        </div>
        <Button size="sm" variant="outline" onClick={onRetry} className="h-9 border-rose-500/40 text-rose-700 dark:text-rose-400 hover:bg-rose-500/10">
          <RefreshCw className="h-3.5 w-3.5 ml-1.5" aria-hidden />
          تلاش دوباره
        </Button>
      </CardContent>
    </Card>
  );
}
