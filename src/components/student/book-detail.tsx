"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { api, ApiClientError, getToken } from "@/lib/app/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorState, faDateTime, faNum } from "@/components/shared/blocks";
import { gradeLabelFa } from "@/lib/education-levels";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowRight, BookOpen, Check, Download, Eye, FileDown, Headphones, Loader2, NotebookPen,
  Printer, RefreshCw, Shapes, Sparkles, Trophy, X,
} from "lucide-react";

// ── BookDetailView (Round 16 — task 16-b) ──
// Full student view of one smart-library book: live-polling generation status,
// markdown summary (+ Word download & print-to-PDF view), podcast player,
// sample-quiz runner with server-side grading, points and attempt history.

export type ArtifactStatus = "PENDING" | "GENERATING" | "READY" | "FAILED";

export interface BookRow {
  id: string;
  title: string;
  author: string | null;
  subject: string | null;
  level: string | null;
  levelLabel: string | null;
  gradeLevel: string | null;
  description: string | null;
  coverEmoji: string;
  charCount: number;
  status: "PENDING" | "GENERATING" | "READY" | "PARTIAL" | "FAILED";
  summaryStatus: ArtifactStatus;
  studyNotesStatus: ArtifactStatus;
  quizStatus: ArtifactStatus;
  figuresStatus: ArtifactStatus;
  figuresCount: number;
  podcastStatus: ArtifactStatus;
  podcastDurationSec: number | null;
  quizCount: number;
  hasOriginalPdf?: boolean; // Round 20 — نسخهٔ اصلی PDF برای دانلود
  createdAt: string;
  scope: "PLATFORM" | "TENANT" | "CLASSROOM";
}

export interface BookAttempt {
  id: string;
  quizModel: string;
  score: number;
  maxScore: number;
  pointsAwarded: number;
  createdAt: string;
}

export interface BookFigure {
  id: string;
  title: string;
  svg: string;
  caption: string;
}

export interface BookDetailData extends BookRow {
  addedByName: string | null;
  tenantName: string | null;
  mine: boolean;
  summary: string | null;
  studyNotes: string | null;
  figures: BookFigure[];
  quizModels: Array<{ kind: "mc" | "tf" | "fb" | "short"; label: string; count: number }>;
  myAttempts: BookAttempt[];
  errorReason: string | null;
  hasOriginalPdf: boolean;
}

interface QuizItem {
  id: string;
  kind: "mc" | "tf" | "fb" | "short";
  prompt: string;
  options?: string[];
  topic?: string | null;
}

interface QuizData {
  bookId: string;
  bookTitle: string;
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

interface AttemptResult {
  attemptId: string;
  score: number;
  maxScore: number;
  percent: number;
  previousBest: number;
  newBest: boolean;
  pointsAwarded: number;
  perQuestion: PerQuestion[];
}

const SCOPE_LABEL: Record<string, string> = {
  PLATFORM: "عمومی پلتفرم",
  TENANT: "مدرسه",
  CLASSROOM: "کلاس",
};

const MODEL_LABEL: Record<string, string> = {
  MC: "چهارگزینه‌ای",
  TF: "درست/غلط",
  MIXED: "ترکیبی",
  FB: "جای خالی",
  SHORT: "تشریحی کوتاه",
};

function artifactTone(s: string): { dot: string; label: string } {
  if (s === "READY") return { dot: "bg-emerald-500", label: "آماده" };
  if (s === "FAILED") return { dot: "bg-rose-500", label: "ناموفق" };
  if (s === "GENERATING" || s === "PENDING") return { dot: "bg-amber-500 animate-pulse", label: "در حال ساخت" };
  return { dot: "bg-muted-foreground/40", label: "در صف" };
}

function isBusy(s: string): boolean {
  return s === "GENERATING" || s === "PENDING";
}

function isBookBusy(b: { status: string; summaryStatus: string; studyNotesStatus: string; quizStatus: string; figuresStatus: string; podcastStatus: string }): boolean {
  return (
    isBusy(b.status) ||
    isBusy(b.summaryStatus) ||
    isBusy(b.studyNotesStatus) ||
    isBusy(b.quizStatus) ||
    isBusy(b.figuresStatus) ||
    isBusy(b.podcastStatus)
  );
}

// Authorized blob download (audio element / anchor can't send the Bearer header,
// so podcasts and docx files are fetched manually and turned into object URLs).
async function fetchBlob(url: string): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${getToken() ?? ""}` },
  });
  if (!res.ok) {
    let message = "دریافت فایل از سرور ناموفق بود.";
    try {
      const body = (await res.json()) as { error?: { message?: string } } | null;
      if (body?.error?.message) message = body.error.message;
    } catch {
      /* binary/error body — keep the default message */
    }
    throw new ApiClientError("DOWNLOAD_FAILED", message, res.status);
  }
  const cd = res.headers.get("Content-Disposition") ?? "";
  const star = /filename\*=UTF-8''([^;]+)/.exec(cd);
  const filename = star ? decodeURIComponent(star[1]) : "file";
  return { blob: await res.blob(), filename };
}

const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  .print-area, .print-area * { visibility: visible !important; }
  .print-area {
    position: absolute !important;
    top: 0 !important;
    right: 0 !important;
    left: 0 !important;
    width: 100% !important;
    max-width: none !important;
    max-height: none !important;
    margin: 0 !important;
    transform: none !important;
    border: none !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    padding: 10mm 8mm !important;
    overflow: visible !important;
    background: #fff !important;
  }
  .print-area, .print-area * { color: #000 !important; }
  .print-area * { background-color: transparent !important; background-image: none !important; }
  .print-area code { background-color: #f2f2f2 !important; }
  .print-hide { display: none !important; }
}
`;

// Shared markdown renderer (headings, lists, bold, quotes — RTL friendly).
function MarkdownSummary({ text }: { text: string }) {
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
          code: ({ children }) => (
            <code className="bg-muted rounded px-1.5 py-0.5 text-[13px]" dir="ltr">{children}</code>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}

export function BookDetailView({
  book,
  onClose,
  onChanged,
  onPointsGained,
}: {
  book: BookRow;
  onClose: () => void;
  onChanged?: () => void;
  onPointsGained?: () => void;
}) {
  const { toast } = useToast();
  const [detail, setDetail] = useState<BookDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // quiz state machine
  const [quizMode, setQuizMode] = useState<"idle" | "runner" | "result">("idle");
  const [quizModel, setQuizModel] = useState<string>("MC");
  const [quiz, setQuiz] = useState<QuizData | null>(null);
  const [quizLoading, setQuizLoading] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [qIdx, setQIdx] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  // artifacts
  const [docxBusy, setDocxBusy] = useState(false);
  const [notesDocxBusy, setNotesDocxBusy] = useState(false);
  // Round 22 — خروجی PDF فارسی (فونت وزیرمتن) برای خلاصه/جزوه/نمونه‌سؤال
  const [summaryPdfBusy, setSummaryPdfBusy] = useState(false);
  const [notesPdfBusy, setNotesPdfBusy] = useState(false);
  const [quizPdfBusy, setQuizPdfBusy] = useState<Record<string, boolean>>({});
  const [originalPdfBusy, setOriginalPdfBusy] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [podcastLoading, setPodcastLoading] = useState(false);
  const [podcastUrl, setPodcastUrl] = useState<string | null>(null);
  const [podcastFilename, setPodcastFilename] = useState<string>("podcast.wav");
  const [podcastError, setPodcastError] = useState<string | null>(null);
  const podcastUrlRef = useRef<string | null>(null);

  // ── data loading + 5s auto-poll while generation is in flight ──
  useEffect(() => {
    let ignore = false;
    void (async () => {
      try {
        const res = await api<BookDetailData>(`/api/v1/books/${book.id}`);
        if (!ignore) {
          setDetail(res);
          setError(null);
        }
      } catch (e) {
        if (!ignore) setError(e instanceof ApiClientError ? e.message : "بارگذاری کتاب ناموفق بود.");
      }
    })();
    return () => {
      ignore = true;
    };
  }, [book.id, reloadKey]);

  const busyGenerating = !!detail && isBookBusy(detail);

  useEffect(() => {
    if (!busyGenerating) return;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const res = await api<BookDetailData>(`/api/v1/books/${book.id}`);
          setDetail(res);
        } catch {
          /* silent — the next tick retries */
        }
      })();
    }, 5000);
    return () => clearInterval(timer);
  }, [busyGenerating, book.id]);

  // when generation finishes (or fails), tell the parent list to refresh
  const prevBusyRef = useRef(busyGenerating);
  useEffect(() => {
    if (prevBusyRef.current && !busyGenerating) onChanged?.();
    prevBusyRef.current = busyGenerating;
  }, [busyGenerating, onChanged]);

  // object-URL lifecycle for the podcast player
  useEffect(() => {
    return () => {
      if (podcastUrlRef.current) URL.revokeObjectURL(podcastUrlRef.current);
      podcastUrlRef.current = null;
    };
  }, [podcastUrl]);

  const refreshDetailQuiet = useCallback(async () => {
    try {
      setDetail(await api<BookDetailData>(`/api/v1/books/${book.id}`));
    } catch {
      /* silent */
    }
  }, [book.id]);

  // ── artifacts ──
  // تبدیل بلاب به دانلود مرورگر (لینک موقت object-URL)
  function saveBlob(blob: Blob, filename: string, fallback: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || fallback;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  // Round 20 — دانلود نسخهٔ اصلی کتاب (PDF بارگذاری‌شده مدیر/معلم یا دریافت‌شده از لینک)
  async function downloadOriginalPdf() {
    setOriginalPdfBusy(true);
    try {
      const { blob, filename } = await fetchBlob(`/api/v1/books/${book.id}/original.pdf`);
      saveBlob(blob, filename, `${book.title.slice(0, 40)}.pdf`);
      toast({ title: "نسخهٔ اصلی کتاب دانلود شد", description: `«${filename}» — خود کتاب PDF.` });
    } catch (e) {
      toast({
        title: "دانلود نسخهٔ اصلی ناموفق بود",
        description: e instanceof ApiClientError ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setOriginalPdfBusy(false);
    }
  }

  async function downloadDocx() {
    if (!detail) return;
    setDocxBusy(true);
    try {
      const { blob, filename } = await fetchBlob(`/api/v1/books/${book.id}/summary.docx`);
      saveBlob(blob, filename, "summary.docx");
      toast({ title: "فایل Word دانلود شد", description: `«${filename}» — خلاصهٔ کامل کتاب با قالب فارسی.` });
    } catch (e) {
      toast({
        title: "دانلود Word ناموفق بود",
        description: e instanceof ApiClientError ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setDocxBusy(false);
    }
  }

  // Round 22 — خلاصهٔ PDF با فونت فارسی وزیرمتن (درخواست مدیر: «حتماً خروجی PDF با فونت مناسب فارسی»)
  async function downloadSummaryPdf() {
    if (!detail) return;
    setSummaryPdfBusy(true);
    try {
      const { blob, filename } = await fetchBlob(`/api/v1/books/${book.id}/summary.pdf`);
      saveBlob(blob, filename, `خلاصه-${book.title.slice(0, 40)}.pdf`);
      toast({ title: "خلاصهٔ PDF دانلود شد", description: `«${filename}» — با فونت فارسی وزیرمتن، آمادهٔ چاپ.` });
    } catch (e) {
      toast({
        title: "دانلود PDF ناموفق بود",
        description: e instanceof ApiClientError ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSummaryPdfBusy(false);
    }
  }

  async function downloadNotesDocx() {
    if (!detail) return;
    setNotesDocxBusy(true);
    try {
      const { blob, filename } = await fetchBlob(`/api/v1/books/${book.id}/notes.docx`);
      saveBlob(blob, filename, "jozve.docx");
      toast({ title: "جزوهٔ Word دانلود شد", description: `«${filename}» — جزوهٔ شبامتحان با قالب فارسی.` });
    } catch (e) {
      toast({
        title: "دانلود جزوه ناموفق بود",
        description: e instanceof ApiClientError ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setNotesDocxBusy(false);
    }
  }

  // Round 22 — جزوهٔ PDF با فونت فارسی وزیرمتن
  async function downloadNotesPdf() {
    if (!detail) return;
    setNotesPdfBusy(true);
    try {
      const { blob, filename } = await fetchBlob(`/api/v1/books/${book.id}/notes.pdf`);
      saveBlob(blob, filename, `جزوه-${book.title.slice(0, 40)}.pdf`);
      toast({ title: "جزوهٔ PDF دانلود شد", description: `«${filename}» — با فونت فارسی وزیرمتن، آمادهٔ چاپ.` });
    } catch (e) {
      toast({
        title: "دانلود جزوهٔ PDF ناموفق بود",
        description: e instanceof ApiClientError ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setNotesPdfBusy(false);
    }
  }

  // Round 22 — نمونه‌سؤال PDF با چارچوب رسمی برگهٔ آزمون + پاسخ‌نامهٔ تشریحی
  async function downloadQuizPdf(model: string) {
    setQuizPdfBusy((prev) => ({ ...prev, [model]: true }));
    try {
      const { blob, filename } = await fetchBlob(`/api/v1/books/${book.id}/quiz.pdf?model=${model}`);
      saveBlob(blob, filename, `نمونه‌سوال-${book.title.slice(0, 40)}.pdf`);
      toast({
        title: "نمونه‌سؤال PDF دانلود شد",
        description: `«${filename}» — برگهٔ رسمی آزمون + پاسخ‌نامهٔ تشریحی.`,
      });
    } catch (e) {
      toast({
        title: "دانلود نمونه‌سؤال PDF ناموفق بود",
        description: e instanceof ApiClientError ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setQuizPdfBusy((prev) => ({ ...prev, [model]: false }));
    }
  }

  async function loadPodcast() {
    setPodcastLoading(true);
    setPodcastError(null);
    try {
      const { blob, filename } = await fetchBlob(`/api/v1/books/${book.id}/podcast`);
      if (podcastUrlRef.current) URL.revokeObjectURL(podcastUrlRef.current);
      const url = URL.createObjectURL(blob);
      podcastUrlRef.current = url;
      setPodcastFilename(filename || `podcast-${book.title.slice(0, 40)}.wav`);
      setPodcastUrl(url);
    } catch (e) {
      setPodcastError(e instanceof ApiClientError ? e.message : "دریافت پادکست ناموفق بود.");
    } finally {
      setPodcastLoading(false);
    }
  }

  // ── quiz ──
  async function startQuiz(model: string) {
    setQuizModel(model);
    setQuizMode("runner");
    setQuizLoading(true);
    setQuiz(null);
    setAnswers({});
    setQIdx(0);
    setResult(null);
    setRevealed(new Set());
    try {
      const res = await api<QuizData>(`/api/v1/books/${book.id}/quiz?model=${model}`);
      setQuiz(res);
    } catch (e) {
      setQuizMode("idle");
      toast({
        title: "شروع آزمون ناموفق بود",
        description: e instanceof ApiClientError ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setQuizLoading(false);
    }
  }

  async function submitQuiz() {
    if (!quiz) return;
    setSubmitting(true);
    try {
      const res = await api<AttemptResult>(`/api/v1/books/${book.id}/quiz/attempts`, {
        method: "POST",
        body: JSON.stringify({ model: quizModel, answers }),
      });
      setResult(res);
      setQuizMode("result");
      if (res.pointsAwarded > 0) {
        toast({
          title: `🎉 آفرین! ${faNum(res.pointsAwarded)} امتیاز گرفتی`,
          description: res.newBest ? "رکورد جدیدت برای این کتاب ثبت شد." : "امتیازها به جمع امتیازهایت اضافه شد.",
        });
        onPointsGained?.();
      }
      void refreshDetailQuiet();
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

  function setAnswer(itemId: string, value: string) {
    setAnswers((prev) => ({ ...prev, [itemId]: value }));
  }

  function toggleReveal(id: string) {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const quizCount = (kind: "mc" | "tf" | "fb" | "short") => detail?.quizModels.find((m) => m.kind === kind)?.count ?? 0;

  return (
    <>
      <style>{PRINT_CSS}</style>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent
          dir="rtl"
          className="max-w-3xl max-h-[92vh] overflow-y-auto p-0 gap-0"
        >
          {/* ── header ── */}
          <div className="bg-gradient-to-l from-emerald-500/10 via-transparent to-teal-500/10 border-b border-border/60 p-5">
            <div className="flex items-start gap-4">
              <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-emerald-500/15 to-teal-500/15 border border-emerald-500/20 flex items-center justify-center text-4xl shrink-0">
                <span aria-hidden>{book.coverEmoji}</span>
              </div>
              <div className="min-w-0 flex-1">
                <DialogTitle className="text-lg font-extrabold leading-7">{book.title}</DialogTitle>
                <DialogDescription className="mt-1 text-xs">
                  {book.author ?? "نویسنده نامشخص"}
                  {detail?.addedByName ? ` · بارگذاری توسط ${detail.addedByName}` : ""}
                </DialogDescription>
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  {book.levelLabel && (
                    <Badge className="bg-teal-500/10 text-teal-700 dark:text-teal-400 border border-teal-500/30 text-[10px]">
                      {book.levelLabel}
                    </Badge>
                  )}
                  {book.gradeLevel && <Badge variant="outline" className="text-[10px]">{gradeLabelFa(book.level, book.gradeLevel)}</Badge>}
                  {book.subject && (
                    <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 text-[10px]">
                      {book.subject}
                    </Badge>
                  )}
                  <Badge variant="secondary" className="text-[10px]">{SCOPE_LABEL[book.scope]}</Badge>
                  {detail?.tenantName && <Badge variant="secondary" className="text-[10px]">{detail.tenantName}</Badge>}
                  <Badge variant="secondary" className="text-[10px] tabular-nums">{faNum(book.charCount)} نویسه</Badge>
                </div>
                {(book.hasOriginalPdf ?? detail?.hasOriginalPdf) && (
                  <Button
                    size="sm"
                    onClick={() => void downloadOriginalPdf()}
                    disabled={originalPdfBusy}
                    className="mt-3 h-9 bg-gradient-to-l from-emerald-600 to-teal-600 text-white hover:brightness-110 active:scale-[0.98] transition-all"
                  >
                    {originalPdfBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin ml-1.5" aria-hidden />
                    ) : (
                      <Download className="h-4 w-4 ml-1.5" aria-hidden />
                    )}
                    دانلود نسخهٔ اصلی کتاب (PDF)
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="p-5 space-y-5">
            {error && <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />}

            {!detail && !error && (
              <div className="space-y-3">
                <Skeleton className="h-16 w-full rounded-xl" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-24 w-full rounded-xl" />
              </div>
            )}

            {detail && (
              <>
                {/* ── generation status banner ── */}
                {isBusy(detail.status) && (
                  <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 flex items-center gap-2.5 text-xs text-amber-700 dark:text-amber-400">
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
                    <span className="leading-6">
                      در حال تولید محتوای هوشمند… (خلاصه، نمونه‌سؤال و پادکست) — این صفحه هر ۵ ثانیه خودکار به‌روز می‌شود.
                    </span>
                  </div>
                )}
                {detail.status === "FAILED" && (
                  <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3.5 flex items-start gap-2.5 text-xs text-rose-700 dark:text-rose-400">
                    <X className="h-4 w-4 shrink-0 mt-1" aria-hidden />
                    <span className="leading-6">
                      تولید محتوای هوشمند برای این کتاب ناموفق بود{detail.errorReason ? ` — ${detail.errorReason}` : ""}.
                    </span>
                  </div>
                )}
                {detail.status === "PARTIAL" && (
                  <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 flex items-start gap-2.5 text-xs text-amber-700 dark:text-amber-400">
                    <Sparkles className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
                    <span className="leading-6">
                      بخشی از محتوای هوشمند این کتاب ساخته نشد — وضعیت هر بخش را در پایین ببینید.
                    </span>
                  </div>
                )}

                {/* ── summary ── */}
                {detail.summaryStatus === "READY" && detail.summary && (
                  <Card className="border-border/60">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
                        <BookOpen className="h-4 w-4 text-emerald-600" aria-hidden />
                        خلاصهٔ هوشمند کتاب
                      </CardTitle>
                      <CardDescription>خلاصهٔ تولیدشده توسط هوش مصنوعی، بر پایهٔ متن کامل کتاب.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <MarkdownSummary text={detail.summary} />
                      <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-border/60">
                        {/* Round 22 — خروجی PDF فارسی (وزیرمتن) به‌عنوان گزینهٔ اصلی */}
                        <Button
                          size="sm"
                          onClick={() => void downloadSummaryPdf()}
                          disabled={summaryPdfBusy}
                          className="bg-gradient-to-l from-emerald-600 to-teal-600 text-white hover:brightness-110 active:scale-[0.98] transition-all"
                        >
                          {summaryPdfBusy ? (
                            <Loader2 className="h-4 w-4 animate-spin ml-1.5" aria-hidden />
                          ) : (
                            <FileDown className="h-4 w-4 ml-1.5" aria-hidden />
                          )}
                          دانلود PDF
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => void downloadDocx()} disabled={docxBusy} title="خلاصه در قالب Word">
                          {docxBusy ? (
                            <Loader2 className="h-4 w-4 animate-spin ml-1.5" aria-hidden />
                          ) : (
                            <Download className="h-4 w-4 ml-1.5" aria-hidden />
                          )}
                          Word
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setPrintOpen(true)}>
                          <Printer className="h-4 w-4 ml-1.5" aria-hidden />
                          چاپ
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}
                {isBusy(detail.summaryStatus) && (
                  <Card className="border-border/60">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        خلاصهٔ هوشمند در حال نوشته‌شدن است…
                      </div>
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-5/6" />
                      <Skeleton className="h-4 w-2/3" />
                    </CardContent>
                  </Card>
                )}
                {detail.summaryStatus === "FAILED" && (
                  <div className="rounded-xl border border-dashed border-rose-500/40 bg-rose-500/5 p-3.5 text-xs text-rose-700 dark:text-rose-400">
                    ساخت خلاصه ناموفق بود{detail.errorReason ? ` — ${detail.errorReason}` : ""}.
                  </div>
                )}

                {/* ── study notes (جزوه) — round 18 ── */}
                {detail.studyNotesStatus === "READY" && detail.studyNotes && (
                  <Card className="border-border/60 bg-gradient-to-l from-teal-500/5 via-transparent to-emerald-500/5">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
                        <NotebookPen className="h-4 w-4 text-teal-600" aria-hidden />
                        جزوهٔ شبامتحان
                        <Badge variant="secondary" className="text-[9px]">تعاریف · فرمول‌ها · نکات کنکوری</Badge>
                      </CardTitle>
                      <CardDescription>جزوهٔ ساختارمند تولیدشده توسط هوش مصنوعی — برای مرور سریع قبل از امتحان.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <MarkdownSummary text={detail.studyNotes} />
                      <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-border/60">
                        {/* Round 22 — جزوه PDF فارسی (وزیرمتن) گزینهٔ اصلی */}
                        <Button
                          size="sm"
                          onClick={() => void downloadNotesPdf()}
                          disabled={notesPdfBusy}
                          className="bg-gradient-to-l from-emerald-600 to-teal-600 text-white hover:brightness-110 active:scale-[0.98] transition-all"
                        >
                          {notesPdfBusy ? (
                            <Loader2 className="h-4 w-4 animate-spin ml-1.5" aria-hidden />
                          ) : (
                            <FileDown className="h-4 w-4 ml-1.5" aria-hidden />
                          )}
                          دانلود PDF
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void downloadNotesDocx()}
                          disabled={notesDocxBusy}
                          title="جزوه در قالب Word"
                        >
                          {notesDocxBusy ? (
                            <Loader2 className="h-4 w-4 animate-spin ml-1.5" aria-hidden />
                          ) : (
                            <Download className="h-4 w-4 ml-1.5" aria-hidden />
                          )}
                          Word
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}
                {isBusy(detail.studyNotesStatus) && (
                  <div className="rounded-xl border border-border/60 bg-muted/30 p-3.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    جزوهٔ شبامتحان در حال نوشته‌شدن است…
                  </div>
                )}
                {detail.studyNotesStatus === "FAILED" && (
                  <div className="rounded-xl border border-dashed border-rose-500/40 bg-rose-500/5 p-3.5 text-xs text-rose-700 dark:text-rose-400">
                    ساخت جزوه ناموفق بود.
                  </div>
                )}

                {/* ── figures (شکل‌های آموزشی) — round 18 ── */}
                {detail.figuresStatus === "READY" && detail.figures.length > 0 && (
                  <Card className="border-border/60">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Shapes className="h-4 w-4 text-amber-600" aria-hidden />
                        شکل‌های آموزشی
                        <Badge variant="secondary" className="text-[10px] tabular-nums">{faNum(detail.figures.length)} شکل</Badge>
                      </CardTitle>
                      <CardDescription>نمودارها و شکل‌های کلیدی کتاب — تولیدشده برای درک بهتر مفاهیم.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {detail.figures.map((f) => (
                        <figure key={f.id} className="rounded-xl border border-border/60 overflow-hidden bg-muted/20">
                          <figcaption className="px-3.5 py-2.5 text-xs font-bold border-b border-border/60 bg-muted/30 flex items-center gap-2">
                            <Shapes className="h-3.5 w-3.5 text-amber-600 shrink-0" aria-hidden />
                            <span className="truncate">{f.title}</span>
                          </figcaption>
                          <div
                            className="w-full flex items-center justify-center p-3 [&_svg]:max-w-full [&_svg]:h-auto"
                            dir="ltr"
                            // server-side sanitized SVG (scripts/handlers stripped at generation)
                            dangerouslySetInnerHTML={{ __html: f.svg }}
                          />
                          {f.caption && (
                            <p className="px-3.5 py-2 text-[11px] text-muted-foreground leading-6 border-t border-border/60" dir="auto">
                              {f.caption}
                            </p>
                          )}
                        </figure>
                      ))}
                    </CardContent>
                  </Card>
                )}
                {isBusy(detail.figuresStatus) && (
                  <div className="rounded-xl border border-border/60 bg-muted/30 p-3.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    شکل‌های آموزشی کتاب در حال ترسیم است…
                  </div>
                )}
                {detail.figuresStatus === "FAILED" && (
                  <div className="rounded-xl border border-dashed border-rose-500/40 bg-rose-500/5 p-3.5 text-xs text-rose-700 dark:text-rose-400">
                    ساخت شکل‌های آموزشی ناموفق بود.
                  </div>
                )}

                {/* ── podcast ── */}
                {detail.podcastStatus === "READY" && (
                  <Card className="border-border/60 bg-gradient-to-l from-amber-500/5 via-transparent to-rose-500/5">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Headphones className="h-4 w-4 text-amber-600" aria-hidden />
                        پادکست کتاب
                        {detail.podcastDurationSec !== null && (
                          <Badge variant="secondary" className="text-[10px] tabular-nums">
                            {faNum(detail.podcastDurationSec)} ثانیه
                          </Badge>
                        )}
                      </CardTitle>
                      <CardDescription>گفتار طبیعی از خلاصهٔ کتاب — برای مرور در مسیر مدرسه.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {!podcastUrl && (
                        <div className="flex items-center gap-3 flex-wrap">
                          <Button size="sm" variant="outline" onClick={() => void loadPodcast()} disabled={podcastLoading}>
                            {podcastLoading ? (
                              <Loader2 className="h-4 w-4 animate-spin ml-1.5" aria-hidden />
                            ) : (
                              <Headphones className="h-4 w-4 ml-1.5" aria-hidden />
                            )}
                            {podcastLoading ? "در حال آماده‌سازی…" : "آماده‌سازی پخش"}
                          </Button>
                          {podcastError && <p className="text-xs text-rose-600 dark:text-rose-400">{podcastError}</p>}
                        </div>
                      )}
                      {podcastUrl && (
                        <>
                          <div dir="ltr" className="rounded-xl border border-border/60 bg-muted/30 p-2.5">
                            <audio controls preload="metadata" src={podcastUrl} className="w-full h-10">
                              مرورگر شما پخش صوت را پشتیبانی نمی‌کند.
                            </audio>
                          </div>
                          <div className="flex items-center justify-end">
                            <Button asChild variant="outline" size="sm">
                              <a href={podcastUrl} download={podcastFilename}>
                                <Download className="h-4 w-4 ml-1.5" aria-hidden />
                                دانلود پادکست
                              </a>
                            </Button>
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                )}
                {isBusy(detail.podcastStatus) && (
                  <div className="rounded-xl border border-border/60 bg-muted/30 p-3.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    پادکست کتاب در حال ضبط است…
                  </div>
                )}
                {detail.podcastStatus === "FAILED" && (
                  <div className="rounded-xl border border-dashed border-rose-500/40 bg-rose-500/5 p-3.5 text-xs text-rose-700 dark:text-rose-400">
                    ساخت پادکست ناموفق بود.
                  </div>
                )}

                {/* ── sample quiz ── */}
                {detail.quizStatus === "READY" && quizMode === "idle" && (
                  <Card className="border-border/60">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
                        <Sparkles className="h-4 w-4 text-teal-600" aria-hidden />
                        نمونه‌سؤال‌های هوشمند
                        <Badge variant="secondary" className="text-[9px]">برگهٔ PDF رسمی + پاسخ‌نامه</Badge>
                      </CardTitle>
                      <CardDescription>
                        مدلی را انتخاب کن، به سؤال‌ها پاسخ بده و با بهبود رکوردتان امتیاز بگیر؛ با «PDF» همان مدل را به‌صورت برگهٔ رسمی آزمون دانلود کن.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {[
                          { value: "MC", label: "چهارگزینه‌ای", count: quizCount("mc") },
                          { value: "TF", label: "درست/غلط", count: quizCount("tf") },
                          { value: "MIXED", label: "ترکیبی", count: quizCount("mc") + quizCount("tf") + quizCount("fb") },
                        ]
                          .concat(quizCount("fb") > 0 ? [{ value: "FB", label: "جای خالی", count: quizCount("fb") }] : [])
                          .concat(quizCount("short") > 0 ? [{ value: "SHORT", label: "تشریحی کوتاه", count: quizCount("short") }] : [])
                          .map((m) => (
                            <div
                              key={m.value}
                              className={cn(
                                "rounded-xl border overflow-hidden flex flex-col transition-all",
                                m.count === 0 ? "border-border/50 bg-muted/30" : "border-border/60 hover:border-teal-500/50"
                              )}
                            >
                              <button
                                type="button"
                                disabled={m.count === 0 || quizLoading}
                                onClick={() => void startQuiz(m.value)}
                                className={cn(
                                  "p-3 text-center transition-all min-h-11 flex-1",
                                  m.count === 0
                                    ? "text-muted-foreground/60 cursor-not-allowed"
                                    : "hover:bg-teal-500/5 active:scale-[0.98] cursor-pointer"
                                )}
                              >
                                <p className="text-xs font-bold">{m.label}</p>
                                <p className="text-[10px] text-muted-foreground tabular-nums mt-1">
                                  {m.count === 0 ? "بدون سؤال" : `${faNum(m.count)} سؤال`}
                                </p>
                              </button>
                              {/* Round 22 — دانلود همان مدل به‌صورت برگهٔ رسمی PDF + پاسخ‌نامه */}
                              <button
                                type="button"
                                disabled={m.count === 0 || quizPdfBusy[m.value]}
                                onClick={() => void downloadQuizPdf(m.value)}
                                aria-label={`دانلود نمونه‌سؤال ${m.label} به‌صورت PDF`}
                                title="دانلود نمونه‌سؤال (PDF) — برگهٔ رسمی آزمون + پاسخ‌نامه"
                                className={cn(
                                  "border-t border-border/60 py-2 min-h-9 text-[10px] font-bold inline-flex items-center justify-center gap-1 transition-colors",
                                  m.count === 0 || quizPdfBusy[m.value]
                                    ? "text-muted-foreground/50 cursor-not-allowed"
                                    : "text-teal-700 dark:text-teal-400 hover:bg-teal-500/10 active:scale-[0.98] cursor-pointer"
                                )}
                              >
                                {quizPdfBusy[m.value] ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                                ) : (
                                  <FileDown className="h-3.5 w-3.5" aria-hidden />
                                )}
                                PDF
                              </button>
                            </div>
                          ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {quizMode === "runner" && (
                  <Card className="border-border/60">
                    <CardHeader className="pb-3 space-y-3">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <Sparkles className="h-4 w-4 text-teal-600" aria-hidden />
                          {MODEL_LABEL[quizModel] ?? quizModel}
                        </CardTitle>
                        <Button
                          variant="ghost" size="sm"
                          className="h-7 text-[11px] text-muted-foreground"
                          onClick={() => setQuizMode("idle")}
                        >
                          انصراف از آزمون
                        </Button>
                      </div>
                      {quiz && (
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                            <span className="font-medium">
                              سؤال {faNum(qIdx + 1)} از {faNum(quiz.items.length)}
                            </span>
                            <span className="tabular-nums">
                              {faNum(Object.keys(answers).filter((k) => answers[k] !== "").length)} پاسخ داده‌شده
                            </span>
                          </div>
                          <Progress
                            value={quiz.items.length > 0 ? ((qIdx + 1) / quiz.items.length) * 100 : 0}
                            className="h-1.5"
                          />
                        </div>
                      )}
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {quizLoading && (
                        <div className="space-y-3">
                          <Skeleton className="h-5 w-3/4" />
                          <Skeleton className="h-11 w-full rounded-xl" />
                          <Skeleton className="h-11 w-full rounded-xl" />
                          <Skeleton className="h-11 w-2/3 rounded-xl" />
                        </div>
                      )}
                      {!quizLoading && quiz && quiz.items[qIdx] && (
                        <QuizQuestion
                          item={quiz.items[qIdx]}
                          value={answers[quiz.items[qIdx].id] ?? ""}
                          onAnswer={(v) => setAnswer(quiz.items[qIdx].id, v)}
                        />
                      )}
                    </CardContent>
                    {quiz && !quizLoading && (
                      <div className="flex items-center justify-between gap-2 p-5 pt-0 flex-wrap">
                        <Button
                          variant="outline" size="sm"
                          disabled={qIdx === 0}
                          onClick={() => setQIdx((i) => Math.max(0, i - 1))}
                        >
                          <ArrowRight className="h-4 w-4 ml-1.5" aria-hidden />
                          قبلی
                        </Button>
                        {qIdx < quiz.items.length - 1 ? (
                          <Button size="sm" onClick={() => setQIdx((i) => Math.min(quiz.items.length - 1, i + 1))}>
                            بعدی
                          </Button>
                        ) : (
                          <Button size="sm" onClick={() => void submitQuiz()} disabled={submitting}>
                            {submitting ? (
                              <Loader2 className="h-4 w-4 animate-spin ml-1.5" aria-hidden />
                            ) : (
                              <Check className="h-4 w-4 ml-1.5" aria-hidden />
                            )}
                            {submitting ? "در حال تصحیح…" : "ثبت پاسخ‌ها"}
                          </Button>
                        )}
                      </div>
                    )}
                  </Card>
                )}

                {quizMode === "result" && result && (
                  <Card className="border-border/60">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Trophy className="h-4 w-4 text-amber-600" aria-hidden />
                        نتیجهٔ آزمون {MODEL_LABEL[quizModel] ?? quizModel}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-3 gap-2.5">
                        <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-center">
                          <p className="text-[10px] text-muted-foreground">امتیاز آزمون</p>
                          <p className="text-lg font-extrabold tabular-nums">
                            {faNum(result.score)} / {faNum(result.maxScore)}
                          </p>
                        </div>
                        <div className="rounded-xl border border-border/60 bg-muted/30 p-3 text-center">
                          <p className="text-[10px] text-muted-foreground">درصد</p>
                          <p className="text-lg font-extrabold tabular-nums">{faNum(result.percent)}٪</p>
                        </div>
                        <div
                          className={cn(
                            "rounded-xl border p-3 text-center",
                            result.pointsAwarded > 0
                              ? "border-emerald-500/40 bg-emerald-500/10"
                              : "border-border/60 bg-muted/30"
                          )}
                        >
                          <p className="text-[10px] text-muted-foreground">امتیاز پلتفرم</p>
                          <p
                            className={cn(
                              "text-lg font-extrabold tabular-nums",
                              result.pointsAwarded > 0 && "text-emerald-600 dark:text-emerald-400"
                            )}
                          >
                            {result.pointsAwarded > 0 ? `+${faNum(result.pointsAwarded)}` : faNum(0)}
                          </p>
                        </div>
                      </div>

                      {result.newBest && (
                        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 flex items-center gap-2.5 text-xs text-emerald-700 dark:text-emerald-400 font-bold">
                          <Trophy className="h-4 w-4 shrink-0" aria-hidden />
                          🎉 رکورد جدید! بهترین نتیجهٔ قبلی {faNum(result.previousBest)} بود و بهبود دادی.
                        </div>
                      )}
                      {!result.newBest && (
                        <p className="text-[11px] text-muted-foreground leading-5">
                          بهترین رکورد فعلی‌ات {faNum(result.previousBest)} است — فقط بالاتر از رکورد فعلی امتیاز جدید می‌گیری،
                          پس دوباره تلاش کن!
                        </p>
                      )}

                      <div className="space-y-2.5">
                        <p className="text-xs font-bold pt-1">مرور پاسخ‌ها</p>
                        {result.perQuestion.map((q, i) => (
                          <div key={q.id} className="rounded-xl border border-border/60 p-3 space-y-2">
                            <div className="flex items-start gap-2">
                              <span className="shrink-0 mt-0.5" aria-hidden>
                                {q.kind === "short" ? "👁" : q.correct ? "✅" : "❌"}
                              </span>
                              <p className="text-xs font-medium leading-6 min-w-0" dir="auto">
                                {faNum(i + 1)}. {q.prompt}
                              </p>
                            </div>
                            <div className="text-[11px] space-y-1.5 pr-6">
                              <p className="text-muted-foreground leading-6">
                                <span className="font-bold">پاسخ شما: </span>
                                <span dir="auto">{q.yourAnswer ?? "— (بی‌پاسخ)"}</span>
                              </p>
                              {q.kind === "short" ? (
                                revealed.has(q.id) ? (
                                  <p className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-2 leading-6" dir="auto">
                                    <span className="font-bold text-emerald-700 dark:text-emerald-400">پاسخ نمونه: </span>
                                    {q.correctAnswer}
                                  </p>
                                ) : (
                                  <Button
                                    variant="outline" size="sm"
                                    className="h-7 text-[11px]"
                                    onClick={() => toggleReveal(q.id)}
                                  >
                                    <Eye className="h-3.5 w-3.5 ml-1" aria-hidden />
                                    دیدن پاسخ نمونه (خودآزمایی)
                                  </Button>
                                )
                              ) : (
                                <p className="text-emerald-700 dark:text-emerald-400 leading-6" dir="auto">
                                  <span className="font-bold">پاسخ درست: </span>
                                  {q.correctAnswer}
                                </p>
                              )}
                              {q.explanation && (
                                <p className="text-muted-foreground leading-6" dir="auto">
                                  <span className="font-bold">توضیح: </span>
                                  {q.explanation}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="flex items-center gap-2 flex-wrap pt-1">
                        <Button size="sm" onClick={() => void startQuiz(quizModel)}>
                          <RefreshCw className="h-4 w-4 ml-1.5" aria-hidden />
                          آزمون مجدد
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setQuizMode("idle")}>
                          بازگشت به کتاب
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {isBusy(detail.quizStatus) && (
                  <div className="rounded-xl border border-border/60 bg-muted/30 p-3.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    نمونه‌سؤال‌های هوشمند در حال ساخته‌شدن است…
                  </div>
                )}
                {detail.quizStatus === "FAILED" && (
                  <div className="rounded-xl border border-dashed border-rose-500/40 bg-rose-500/5 p-3.5 text-xs text-rose-700 dark:text-rose-400">
                    ساخت نمونه‌سؤال ناموفق بود.
                  </div>
                )}

                {/* ── my attempts ── */}
                {detail.myAttempts.length > 0 && quizMode === "idle" && (
                  <Card className="border-border/60">
                    <CardHeader className="pb-2.5">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Trophy className="h-4 w-4 text-amber-600" aria-hidden />
                        سابقهٔ تلاش‌های من
                        <Badge variant="secondary" className="text-[10px] tabular-nums">
                          {faNum(detail.myAttempts.length)} تلاش
                        </Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="max-h-44 overflow-y-auto space-y-1.5 pl-1">
                        {detail.myAttempts.map((a) => (
                          <div
                            key={a.id}
                            className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 text-[11px]"
                          >
                            <span className="font-bold shrink-0">{MODEL_LABEL[a.quizModel] ?? a.quizModel}</span>
                            <span className="tabular-nums text-muted-foreground">
                              {faDateTime(a.createdAt)}
                            </span>
                            <span className="flex items-center gap-2 shrink-0 tabular-nums">
                              <span className="font-bold">
                                {faNum(a.score)} / {faNum(a.maxScore)}
                              </span>
                              {a.pointsAwarded > 0 && (
                                <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 text-[9px] tabular-nums">
                                  +{faNum(a.pointsAwarded)}
                                </Badge>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* ── meta footer ── */}
                <p className="text-[10px] text-muted-foreground leading-5 flex items-center gap-1.5 flex-wrap">
                  <BookOpen className="h-3 w-3 shrink-0" aria-hidden />
                  اضافه‌شده در {faDateTime(detail.createdAt)} · {faNum(detail.quizCount)} نمونه‌سؤال تولیدشده
                </p>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── print / save-as-PDF dialog — only .print-area prints ── */}
      <Dialog open={printOpen} onOpenChange={setPrintOpen}>
        <DialogContent
          dir="rtl"
          className="print-area max-w-2xl max-h-[92vh] overflow-y-auto bg-white text-foreground"
        >
          <DialogHeader className="print-hide">
            <DialogTitle className="text-base">چاپ خلاصهٔ کتاب</DialogTitle>
            <DialogDescription className="text-xs leading-6">
              این نمای چاپی است. با زدن دکمهٔ زیر پنجرهٔ چاپ مرورگر باز می‌شود — برای ذخیرهٔ PDF گزینهٔ
              «Save as PDF / ذخیره به‌صورت PDF» را انتخاب کنید.
            </DialogDescription>
          </DialogHeader>
          <div className="print-hide flex items-center gap-2 flex-wrap px-1">
            <Button size="sm" onClick={() => window.print()}>
              <Printer className="h-4 w-4 ml-1.5" aria-hidden />
              چاپ / ذخیرهٔ PDF
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPrintOpen(false)}>
              بستن
            </Button>
          </div>
          <div className="mt-2 rounded-xl border border-border/60 p-5">
            <div className="border-b border-border pb-3 mb-3">
              <p className="text-lg font-extrabold leading-7">{book.title}</p>
              <p className="text-xs mt-1">
                {book.author ?? "نویسنده نامشخص"}
                {book.subject ? ` · درس ${book.subject}` : ""}
                {book.gradeLevel ? ` · پایه ${book.gradeLevel}` : ""}
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">خلاصهٔ هوشمند — پلتفرم آموزش هوشمند ایران</p>
            </div>
            {detail?.summary ? (
              <MarkdownSummary text={detail.summary} />
            ) : (
              <EmptyState title="خلاصه‌ای برای چاپ موجود نیست" description="ابتدا صبر کنید تا خلاصهٔ کتاب آماده شود." />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── one quiz question (mc / tf / short) ──
function QuizQuestion({
  item,
  value,
  onAnswer,
}: {
  item: QuizItem;
  value: string;
  onAnswer: (v: string) => void;
}) {
  return (
    <div className="space-y-3.5">
      {item.topic && <Badge variant="outline" className="text-[10px]">{item.topic}</Badge>}
      <p className="text-sm font-medium leading-7" dir="auto">{item.prompt}</p>

      {item.kind === "mc" && (
        <div className="space-y-2">
          {(item.options ?? []).map((opt, i) => {
            const selected = value === String(i);
            return (
              <button
                key={i}
                type="button"
                onClick={() => onAnswer(String(i))}
                aria-pressed={selected}
                className={cn(
                  "w-full rounded-xl border p-3.5 text-right transition-all min-h-11 cursor-pointer",
                  selected
                    ? "border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500/30 font-bold"
                    : "border-border/60 hover:border-emerald-400/50 hover:bg-emerald-500/5"
                )}
              >
                <span className="flex items-center gap-2.5">
                  <span
                    className={cn(
                      "h-6 w-6 rounded-lg border flex items-center justify-center text-[11px] font-bold shrink-0 tabular-nums",
                      selected ? "border-emerald-500 bg-emerald-500 text-white" : "border-border/70"
                    )}
                    aria-hidden
                  >
                    {faNum(i + 1)}
                  </span>
                  <span className="text-sm leading-6 min-w-0" dir="auto">{opt}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {item.kind === "tf" && (
        <div className="grid grid-cols-2 gap-2.5">
          {[
            { v: "true", label: "صحیح", Icon: Check },
            { v: "false", label: "غلط", Icon: X },
          ].map(({ v, label, Icon }) => {
            const selected = value === v;
            return (
              <button
                key={v}
                type="button"
                onClick={() => onAnswer(v)}
                aria-pressed={selected}
                className={cn(
                  "rounded-xl border p-4 flex items-center justify-center gap-2 text-sm font-bold transition-all min-h-12 cursor-pointer",
                  selected
                    ? v === "true"
                      ? "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-500/30"
                      : "border-rose-500 bg-rose-500/10 text-rose-700 dark:text-rose-400 ring-1 ring-rose-500/30"
                    : "border-border/60 hover:border-emerald-400/40"
                )}
              >
                <Icon className="h-5 w-5" aria-hidden />
                {label}
              </button>
            );
          })}
        </div>
      )}

      {item.kind === "fb" && (
        <div className="space-y-1.5">
          <Input
            dir="auto"
            className="h-12 text-sm"
            value={value}
            onChange={(e) => onAnswer(e.target.value)}
            placeholder="جواب کوتاه جای خالی را اینجا بنویس… (مثلاً: میتوکندری)"
            maxLength={120}
          />
          <p className="text-[10px] text-muted-foreground leading-4">
            پاسخ کوتاه است — یک تا سه کلمه. تصحیح خودکار با لحاظ غلط‌های تایپی معمول انجام می‌شود.
          </p>
        </div>
      )}

      {item.kind === "short" && (
        <div className="space-y-1.5">
          <Textarea
            dir="auto"
            rows={4}
            value={value}
            onChange={(e) => onAnswer(e.target.value)}
            placeholder="پاسخ کوتاه خود را بنویسید… (تصحیح این سؤال‌ها خودآزمایی است)"
            maxLength={500}
          />
          <p className="text-[10px] text-muted-foreground tabular-nums text-right">
            {faNum(value.length)} / {faNum(500)} نویسه
          </p>
        </div>
      )}
    </div>
  );
}
