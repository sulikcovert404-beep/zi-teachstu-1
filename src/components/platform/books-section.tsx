"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiClientError } from "@/lib/app/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EmptyState, ErrorState, LoadingGrid, PageTitle, StatCard, faDateTime, faNum } from "@/components/shared/blocks";
import { CurriculumPicker, type CurriculumValue } from "@/components/shared/curriculum-picker";
import { PdfExtractInput, type PdfExtractResult } from "@/components/shared/pdf-extract-input";
import { gradeLabelFa } from "@/lib/education-levels";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { MigrateStorageResponse } from "./types";
import {
  BookOpen, CheckCircle2, Cloud, CloudUpload, FileText, Globe, Headphones, Info, Layers, Library, Loader2,
  NotebookPen, PackageOpen, PenLine, Plus, RefreshCw, Settings, Shapes, Trash2, Upload, XCircle,
} from "lucide-react";

// ── Platform Smart Library manage (Round 16 + Round 18) ──
// SUPER_ADMIN: upload platform-wide books with the full course structure
// (دوره → پایه → درس), approve/reject school+teacher uploads (students only see
// approved ones), and watch the 5-artifact generation pipeline (خلاصه، جزوه،
// نمونه‌سؤال، شکل‌ها، پادکست) across ALL tenants.

const MIN_TEXT = 800;
const MAX_TEXT = 60_000;

const COVER_EMOJIS = ["📘", "📗", "📕", "📙", "📓"];

const SCOPE_LABEL: Record<string, string> = {
  PLATFORM: "عمومی پلتفرم",
  TENANT: "مدرسه",
  CLASSROOM: "کلاس",
};

const SCOPE_TONE: Record<string, string> = {
  PLATFORM: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30",
  TENANT: "bg-teal-500/10 text-teal-700 dark:text-teal-400 border border-teal-500/30",
  CLASSROOM: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30",
};

const APPROVAL_LABEL: Record<string, string> = {
  NOT_REQUIRED: "عمومی — بدون نیاز به تأیید",
  PENDING: "در انتظار تأیید",
  APPROVED: "تأییدشده",
  REJECTED: "ردشده",
};

const APPROVAL_TONE: Record<string, string> = {
  NOT_REQUIRED: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30",
  PENDING: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30",
  APPROVED: "bg-teal-500/10 text-teal-700 dark:text-teal-400 border border-teal-500/30",
  REJECTED: "bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/30",
};

const KIND_LABEL: Record<string, string> = {
  summary: "خلاصه",
  notes: "جزوه",
  quiz: "نمونه‌سؤال",
  figures: "شکل‌ها",
  podcast: "پادکست",
};

interface PlatformBookRow {
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
  summaryStatus: string;
  studyNotesStatus: string;
  quizStatus: string;
  figuresStatus: string;
  figuresCount: number;
  podcastStatus: string;
  podcastDurationSec: number | null;
  quizCount: number;
  hasOriginalPdf: boolean; // Round 20 — نسخهٔ اصلی PDF ضمیمه شده
  // Round 23 — ذخیره‌سازی در تلگرام
  originalPdfInTelegram?: boolean;
  podcastInTelegram?: boolean;
  approvalStatus: "NOT_REQUIRED" | "PENDING" | "APPROVED" | "REJECTED";
  approvalNote: string | null;
  createdAt: string;
  scope: "PLATFORM" | "TENANT" | "CLASSROOM";
  addedByName: string | null;
  tenantName: string | null;
  mine: boolean;
}

interface BooksListResponse {
  canUpload: boolean;
  canUploadLabel: string;
  role: string;
  books: PlatformBookRow[];
}

const ARTIFACTS = [
  { kind: "summary", label: "خلاصه", Icon: FileText },
  { kind: "notes", label: "جزوه", Icon: NotebookPen },
  { kind: "quiz", label: "نمونه‌سؤال", Icon: PenLine },
  { kind: "figures", label: "شکل‌ها", Icon: Shapes },
  { kind: "podcast", label: "پادکست", Icon: Headphones },
] as const;

function statusOf(b: PlatformBookRow, kind: string): string {
  switch (kind) {
    case "summary":
      return b.summaryStatus;
    case "notes":
      return b.studyNotesStatus;
    case "quiz":
      return b.quizStatus;
    case "figures":
      return b.figuresStatus;
    default:
      return b.podcastStatus;
  }
}

function artifactTone(s: string): { dot: string; label: string } {
  if (s === "READY") return { dot: "bg-emerald-500", label: "آماده" };
  if (s === "FAILED") return { dot: "bg-rose-500", label: "ناموفق" };
  if (s === "GENERATING" || s === "PENDING") return { dot: "bg-amber-500 animate-pulse", label: "در حال ساخت" };
  return { dot: "bg-muted-foreground/40", label: "در صف" };
}

function isBookBusy(b: PlatformBookRow): boolean {
  return (
    ["GENERATING", "PENDING"].includes(b.status) ||
    ARTIFACTS.some((a) => ["GENERATING", "PENDING"].includes(statusOf(b, a.kind)))
  );
}

// Round 23 — کتاب کاملاً پشتیبان تلگرام نیست؟ (PDF اصلی یا پادکست آماده، داخل تلگرام)
function needsTelegramMigration(b: PlatformBookRow): boolean {
  return (
    (b.hasOriginalPdf && !b.originalPdfInTelegram) ||
    (b.podcastStatus === "READY" && !b.podcastInTelegram)
  );
}

function StatusPill({ icon: Icon, label, status }: { icon: typeof FileText; label: string; status: string }) {
  const tone = artifactTone(status);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] cursor-default",
            status === "FAILED"
              ? "border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-400"
              : "border-border/60 bg-muted/30",
          )}
        >
          <Icon className="h-3 w-3" aria-hidden />
          <span>{label}</span>
          <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} aria-hidden />
          <span className="sr-only">{tone.label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="text-[10px]">{label} — {tone.label}</TooltipContent>
    </Tooltip>
  );
}

function structureLine(b: { level?: string | null; levelLabel: string | null; gradeLevel: string | null; subject: string | null }): string | null {
  const bits = [b.levelLabel, b.gradeLevel ? gradeLabelFa(b.level, b.gradeLevel) : null, b.subject].filter(Boolean);
  return bits.length > 0 ? bits.join(" · ") : null;
}

export function PlatformBooksSection() {
  const { toast } = useToast();
  const [data, setData] = useState<BooksListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [regenKey, setRegenKey] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [approving, setApproving] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PlatformBookRow | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [rejectBusy, setRejectBusy] = useState(false);
  // Round 23 — انتقال باینری‌های کتاب به تلگرام (۱۰ تا ۲۵ ثانیه)
  const [migrating, setMigrating] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    void (async () => {
      try {
        const res = await api<BooksListResponse>("/api/v1/books");
        if (!ignore) {
          setData(res);
          setError(null);
        }
      } catch (e) {
        if (!ignore) setError(e instanceof ApiClientError ? e.message : "بارگذاری کتاب‌خانه ناموفق بود.");
      }
    })();
    return () => {
      ignore = true;
    };
  }, [reloadKey]);

  const refreshSilent = useCallback(async () => {
    try {
      setData(await api<BooksListResponse>("/api/v1/books"));
    } catch {
      /* silent */
    }
  }, []);

  // ── poll while any book (any tenant) is generating ──
  const anyGenerating = useMemo(() => (data?.books ?? []).some(isBookBusy), [data]);
  useEffect(() => {
    if (!anyGenerating) return;
    const timer = setInterval(() => void refreshSilent(), 5000);
    return () => clearInterval(timer);
  }, [anyGenerating, refreshSilent]);

  async function regenerate(book: PlatformBookRow, kind: string) {
    setRegenKey(`${book.id}:${kind}`);
    try {
      await api(`/api/v1/books/${book.id}/regenerate`, {
        method: "POST",
        body: JSON.stringify({ kind }),
      });
      toast({
        title: "بازتولید آغاز شد",
        description: `${KIND_LABEL[kind]} کتاب «${book.title}» دوباره ساخته می‌شود.`,
      });
      void refreshSilent();
    } catch (e) {
      toast({
        title: "بازتولید ناموفق بود",
        description: e instanceof ApiClientError ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setRegenKey(null);
    }
  }

  async function remove(book: PlatformBookRow) {
    setDeleting(book.id);
    try {
      await api(`/api/v1/books/${book.id}`, { method: "DELETE" });
      toast({ title: "کتاب حذف شد", description: `«${book.title}» از کتاب‌خانه پلتفرم حذف شد.` });
      void refreshSilent();
    } catch (e) {
      toast({
        title: "حذف ناموفق بود",
        description: e instanceof ApiClientError ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setDeleting(null);
    }
  }

  // ── Round 23 — انتقال باینری‌های یک کتاب به داخل تلگرام ──
  async function migrateToTelegram(book: PlatformBookRow) {
    setMigrating(book.id);
    try {
      const res = await api<MigrateStorageResponse>(`/api/v1/books/${book.id}/migrate-storage`, {
        method: "POST",
      });
      const skippedNote =
        res.skipped.length > 0
          ? ` — رد شد: ${res.skipped.map((s) => `${s.label} (${s.reason})`).join("، ")}`
          : "";
      if (res.migrated.length > 0) {
        toast({
          title: `${faNum(res.migrated.length)} فایل به تلگرام منتقل شد ☁️`,
          description: `${res.migrated.map((m) => m.label).join("، ")}${skippedNote}`,
        });
      } else {
        toast({
          title: "چیزی برای انتقال نبود",
          description:
            res.skipped.map((s) => `${s.label} — ${s.reason}`).join("، ") ||
            "همهٔ فایل‌های این کتاب از قبل در تلگرام ذخیره شده‌اند.",
        });
      }
      void refreshSilent();
    } catch (e) {
      toast({
        title: "انتقال به تلگرام ناموفق بود",
        description: e instanceof ApiClientError ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setMigrating(null);
    }
  }

  async function decideApproval(book: PlatformBookRow, decision: "APPROVED" | "REJECTED", note?: string) {
    setApproving(book.id);
    try {
      await api(`/api/v1/books/${book.id}/approve`, {
        method: "POST",
        body: JSON.stringify({ decision, note }),
      });
      toast({
        title: decision === "APPROVED" ? "کتاب تأیید و منتشر شد" : "کتاب رد شد",
        description:
          decision === "APPROVED"
            ? `«${book.title}» از این پس برای دانش‌آموزان ${book.tenantName ?? "مدرسه"} قابل استفاده است.`
            : `«${book.title}» برای بارگذاری‌کننده اعلام می‌شود که رد شده است.`,
      });
      void refreshSilent();
    } catch (e) {
      toast({
        title: "ثبت تصمیم ناموفق بود",
        description: e instanceof ApiClientError ? e.message : undefined,
        variant: "destructive",
      });
    } finally {
      setApproving(null);
    }
  }

  if (data === null && !error) {
    return (
      <div className="space-y-4">
        <PageTitle title="کتاب‌خانه هوشمند" description="افزودن کتاب و مدیریت محتوای تولیدشده." />
        <LoadingGrid count={4} />
      </div>
    );
  }

  const books = data?.books ?? [];
  const pending = books.filter((b) => b.approvalStatus === "PENDING");
  const filtered = search.trim()
    ? books.filter((b) =>
        [b.title, b.author, b.subject, b.gradeLevel, b.levelLabel, b.tenantName, b.addedByName]
          .filter(Boolean)
          .some((f) => (f as string).includes(search.trim())),
      )
    : books;

  const readyCount = books.filter((b) => b.status === "READY").length;
  const generatingCount = books.filter(isBookBusy).length;
  const failedCount = books.filter(
    (b) =>
      b.status === "FAILED" ||
      ARTIFACTS.some((a) => statusOf(b, a.kind) === "FAILED"),
  ).length;

  return (
    <div className="space-y-5">
      <PageTitle
        title="کتاب‌خانه هوشمند"
        description="کتاب‌های عمومی پلتفرم را با ساختار درسی (دوره → پایه → درس) بارگذاری کنید و محتوای هوشمند همهٔ مدارس را یک‌جا ببینید."
      />

      {error && <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />}

      {data && (
        <>
          {/* stats */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="کل کتاب‌ها" value={faNum(books.length)} icon={Library} />
            <StatCard label="آمادهٔ استفاده" value={faNum(readyCount)} icon={BookOpen} tone="positive" />
            <StatCard
              label="در انتظار تأیید"
              value={faNum(pending.length)}
              icon={CheckCircle2}
              tone={pending.length > 0 ? "warning" : "default"}
              hint={pending.length > 0 ? "کتاب مدارس/معلمان — پیش از تأیید برای دانش‌آموزان نامرئی است" : undefined}
            />
            <StatCard
              label={generatingCount > 0 ? "در حال تولید" : "دارای خطا"}
              value={faNum(generatingCount > 0 ? generatingCount : failedCount)}
              icon={generatingCount > 0 ? Loader2 : Info}
              tone={generatingCount > 0 ? "warning" : failedCount > 0 ? "warning" : "default"}
              hint={generatingCount > 0 ? "فهرست هر ۵ ثانیه به‌روز می‌شود" : undefined}
            />
          </div>

          {/* permission hint — settings lives in its own nav item, text only */}
          <Card className="border-teal-500/40 bg-teal-500/5">
            <CardContent className="p-4 flex items-start gap-3">
              <Settings className="h-5 w-5 text-teal-600 dark:text-teal-400 shrink-0 mt-0.5" aria-hidden />
              <p className="text-xs leading-6">
                مجوز افزودن کتاب برای مدارس/معلمان را در «تنظیمات و اتصال‌ها» فعال کنید — این تنظیم به‌صورت
                پیش‌فرض خاموش است. کتاب‌هایی که مدیر مدرسه یا معلم بارگذاری می‌کنند پیش از نمایش به
                دانش‌آموزان باید توسط شما تأیید شوند.
              </p>
            </CardContent>
          </Card>

          {/* ── approval queue (round 18) ── */}
          {pending.length > 0 && (
            <section className="space-y-3">
              <h3 className="text-sm font-extrabold flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-amber-600" aria-hidden />
                درخواست‌های تأیید کتاب
                <Badge variant="secondary" className="text-[10px] tabular-nums">{faNum(pending.length)}</Badge>
              </h3>
              <div className="grid gap-4 lg:grid-cols-2">
                {pending.map((b) => (
                  <Card key={b.id} className="border-amber-500/40 bg-amber-500/5">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start gap-3">
                        <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-amber-500/15 to-teal-500/10 border border-amber-500/20 flex items-center justify-center text-2xl shrink-0" aria-hidden>
                          {b.coverEmoji}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold leading-6 line-clamp-1">{b.title}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                            <span className={cn("rounded-full border px-1.5 py-0.5 text-[9px] font-bold shrink-0", SCOPE_TONE[b.scope])}>
                              {SCOPE_LABEL[b.scope]}
                            </span>
                            {b.tenantName && <span className="truncate">{b.tenantName}</span>}
                            {b.addedByName && (
                              <>
                                <span aria-hidden>·</span>
                                <span className="truncate">{b.addedByName}</span>
                              </>
                            )}
                          </p>
                          {structureLine(b) && (
                            <p className="text-[10px] text-muted-foreground mt-1">{structureLine(b)}</p>
                          )}
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {ARTIFACTS.map((a) => (
                              <StatusPill key={a.kind} icon={a.Icon} label={a.label} status={statusOf(b, a.kind)} />
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-amber-500/20">
                        <Button
                          size="sm"
                          className="bg-gradient-to-l from-emerald-600 to-teal-600 hover:brightness-110"
                          disabled={approving === b.id}
                          onClick={() => void decideApproval(b, "APPROVED")}
                        >
                          {approving === b.id ? (
                            <Loader2 className="h-4 w-4 animate-spin ml-1.5" aria-hidden />
                          ) : (
                            <CheckCircle2 className="h-4 w-4 ml-1.5" aria-hidden />
                          )}
                          تأیید و انتشار به دانش‌آموزان
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-rose-500/40 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                          disabled={approving === b.id}
                          onClick={() => {
                            setRejectTarget(b);
                            setRejectNote("");
                          }}
                        >
                          <XCircle className="h-4 w-4 ml-1.5" aria-hidden />
                          رد
                        </Button>
                        <span className="text-[10px] text-muted-foreground mr-auto">{faDateTime(b.createdAt)}</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {/* upload */}
          <BookUploadForm onCreated={() => void refreshSilent()} />

          {/* all books */}
          <section className="space-y-3">
            <h3 className="text-sm font-extrabold flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" aria-hidden />
              همهٔ کتاب‌ها (همهٔ مدارس)
              <Badge variant="secondary" className="text-[10px] tabular-nums">{faNum(books.length)}</Badge>
            </h3>

            {books.length > 0 && (
              <div className="relative">
                <Input
                  dir="auto"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="جست‌وجو در عنوان، دوره، پایه، درس، مدرسه یا بارگذاری‌کننده…"
                  className="h-11"
                  maxLength={80}
                />
              </div>
            )}

            {books.length === 0 && (
              <EmptyState
                icon={Library}
                title="هنوز کتابی ثبت نشده است"
                description="اولین کتاب عمومی پلتفرم را با فرم بالا اضافه کنید — بعد از فعال‌کردن مجوز، مدارس هم می‌توانند کتاب‌های خودشان را بارگذاری کنند."
              />
            )}

            {books.length > 0 && filtered.length === 0 && (
              <EmptyState
                title="نتیجه‌ای برای این جست‌وجو نیست"
                description="عبارت دیگری را امتحان کنید."
                action={
                  <Button variant="ghost" size="sm" onClick={() => setSearch("")}>
                    پاک‌کردن جست‌وجو
                  </Button>
                }
              />
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              {filtered.map((b) => (
                <Card key={b.id} className="border-border/60">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-emerald-500/15 to-teal-500/10 border border-emerald-500/20 flex items-center justify-center text-2xl shrink-0" aria-hidden>
                        {b.coverEmoji}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-sm font-bold leading-6 line-clamp-1">{b.title}</p>
                          {b.mine && (
                            <Badge variant="secondary" className="text-[9px] shrink-0">بارگذاری من</Badge>
                          )}
                          {(b.originalPdfInTelegram || b.podcastInTelegram) && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/5 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700 dark:text-emerald-400 shrink-0 cursor-default">
                                  <Cloud className="h-3 w-3" aria-hidden />
                                  تلگرام
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="text-[10px] max-w-56">
                                باینری‌های این کتاب (PDF، پادکست و PDFهای فارسی) داخل خود تلگرام ذخیره شده‌اند و از همان‌جا سرو می‌شوند
                              </TooltipContent>
                            </Tooltip>
                          )}
                          {b.approvalStatus !== "NOT_REQUIRED" && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className={cn("rounded-full border px-1.5 py-0.5 text-[9px] font-bold shrink-0 cursor-default", APPROVAL_TONE[b.approvalStatus])}>
                                  {APPROVAL_LABEL[b.approvalStatus]}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="text-[10px] max-w-56">
                                {b.approvalStatus === "PENDING"
                                  ? "برای دانش‌آموزان نامرئی است تا مدیر کل تأیید کند"
                                  : b.approvalStatus === "APPROVED"
                                    ? "برای دانش‌آموزان همین مدرسه/کلاس منتشر شده است"
                                    : b.approvalNote
                                      ? `علت رد: ${b.approvalNote}`
                                      : "توسط مدیر کل رد شده است"}
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                          <span className={cn("rounded-full border px-1.5 py-0.5 text-[9px] font-bold shrink-0", SCOPE_TONE[b.scope])}>
                            {SCOPE_LABEL[b.scope]}
                          </span>
                          {b.tenantName && (
                            <>
                              <Globe className="h-3 w-3 shrink-0" aria-hidden />
                              <span className="truncate">{b.tenantName}</span>
                            </>
                          )}
                          {b.addedByName && (
                            <>
                              <span aria-hidden>·</span>
                              <span className="truncate">{b.addedByName}</span>
                            </>
                          )}
                        </p>
                        {structureLine(b) && (
                          <p className="text-[10px] text-muted-foreground mt-1">
                            🎓 {structureLine(b)}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {ARTIFACTS.map((a) => (
                            <StatusPill key={a.kind} icon={a.Icon} label={a.label} status={statusOf(b, a.kind)} />
                          ))}
                        </div>
                      </div>
                    </div>

                    {isBookBusy(b) ? (
                      <p className="text-[11px] text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        در حال تولید محتوای هوشمند…
                      </p>
                    ) : (
                      <>
                        <p className="text-[10px] text-muted-foreground tabular-nums">
                          {faDateTime(b.createdAt)} · {faNum(b.charCount)} نویسه · {faNum(b.quizCount)} سؤال
                          {b.figuresCount > 0 ? ` · ${faNum(b.figuresCount)} شکل` : ""}
                        </p>
                        {b.hasOriginalPdf && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-400">
                            <PackageOpen className="h-3 w-3" aria-hidden />
                            نسخهٔ اصلی PDF ضمیمه است (دانلودی دانش‌آموزان)
                          </span>
                        )}
                      </>
                    )}

                    <div className="flex items-center justify-between gap-2 flex-wrap pt-1 border-t border-border/60">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {ARTIFACTS.map((a) => {
                          const st = statusOf(b, a.kind);
                          const busy = st === "GENERATING" || st === "PENDING";
                          const key = `${b.id}:${a.kind}`;
                          return (
                            <Button
                              key={a.kind}
                              variant="outline"
                              size="sm"
                              className="h-7 text-[10px]"
                              disabled={busy || regenKey === key}
                              onClick={() => void regenerate(b, a.kind)}
                              title={`بازتولید ${a.label}`}
                            >
                              {regenKey === key ? (
                                <Loader2 className="h-3 w-3 animate-spin ml-1" aria-hidden />
                              ) : (
                                <RefreshCw className="h-3 w-3 ml-1" aria-hidden />
                              )}
                              {a.label}
                            </Button>
                          );
                        })}
                        {/* Round 23 — انتقال باینری‌های کتاب به تلگرام (فقط مدیر کل) */}
                        {data.role === "SUPER_ADMIN" && needsTelegramMigration(b) && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 text-[10px] border-emerald-500/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10"
                            disabled={migrating !== null || isBookBusy(b)}
                            onClick={() => void migrateToTelegram(b)}
                            title="انتقال PDF اصلی، پادکست و PDFهای فارسی این کتاب از هاست به داخل تلگرام (۱۰ تا ۲۵ ثانیه)"
                          >
                            {migrating === b.id ? (
                              <Loader2 className="h-3 w-3 animate-spin ml-1" aria-hidden />
                            ) : (
                              <CloudUpload className="h-3 w-3 ml-1" aria-hidden />
                            )}
                            {migrating === b.id ? "در حال انتقال به تلگرام…" : "☁️ انتقال به تلگرام"}
                          </Button>
                        )}
                      </div>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-7 text-[10px] text-rose-600 dark:text-rose-400 hover:bg-rose-500/10">
                            {deleting === b.id ? (
                              <Loader2 className="h-3 w-3 animate-spin ml-1" aria-hidden />
                            ) : (
                              <Trash2 className="h-3 w-3 ml-1" aria-hidden />
                            )}
                            حذف
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent dir="rtl">
                          <AlertDialogHeader>
                            <AlertDialogTitle>حذف کتاب</AlertDialogTitle>
                            <AlertDialogDescription>
                              آیا از حذف «{b.title}» مطمئن هستید؟ خلاصه، جزوه، شکل‌ها، نمونه‌سؤال‌ها، پادکست و
                              رکوردهای مرتبط آن برای همهٔ کاربران حذف می‌شود و این کار بازگشت‌پذیر نیست.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>انصراف</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-rose-600 hover:bg-rose-700"
                              onClick={() => void remove(b)}
                            >
                              حذف قطعی
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        </>
      )}

      {/* ── reject dialog with reason ── */}
      <Dialog open={!!rejectTarget} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-rose-600" aria-hidden />
              رد کتاب «{rejectTarget?.title}»
            </DialogTitle>
            <DialogDescription className="leading-6">
              دلیل رد را برای بارگذاری‌کننده بنویسید (اختیاری اما مفید). کتاب برای دانش‌آموزان منتشر نمی‌شود.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            dir="rtl"
            rows={3}
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            placeholder="مثلاً: محتوای کتاب با درس اعلامی هم‌خوانی ندارد."
            maxLength={300}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)} disabled={rejectBusy}>
              انصراف
            </Button>
            <Button
              className="bg-rose-600 hover:bg-rose-700"
              disabled={rejectBusy}
              onClick={() => {
                if (!rejectTarget) return;
                setRejectBusy(true);
                void decideApproval(rejectTarget, "REJECTED", rejectNote.trim() || undefined).finally(() => {
                  setRejectBusy(false);
                  setRejectTarget(null);
                });
              }}
            >
              {rejectBusy ? <Loader2 className="h-4 w-4 animate-spin ml-1.5" aria-hidden /> : <XCircle className="h-4 w-4 ml-1.5" aria-hidden />}
              رد کتاب
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── upload form (SUPER_ADMIN: platform-wide, structured دوره → پایه → درس) ──
function BookUploadForm({ onCreated }: { onCreated: () => void }) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [curr, setCurr] = useState<CurriculumValue>({});
  const [author, setAuthor] = useState("");
  const [description, setDescription] = useState("");
  const [coverEmoji, setCoverEmoji] = useState("📘");
  const [text, setText] = useState("");
  const [pdfKey, setPdfKey] = useState<string | null>(null); // Round 20 — کلید PDF اصلی برای ضمیمه شدن به کتاب
  const [pdfName, setPdfName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);

  const len = text.length;
  const counterTone =
    len === 0
      ? "text-muted-foreground"
      : len < MIN_TEXT
        ? "text-amber-600 dark:text-amber-400"
        : len > MAX_TEXT * 0.95
          ? "text-rose-600 dark:text-rose-400"
          : "text-emerald-600 dark:text-emerald-400";

  const canSubmit = title.trim().length >= 2 && len >= MIN_TEXT && len <= MAX_TEXT && !busy;

  // Round 19 — PDF upload: extracted text fills the review textarea; the file name
  // (ریاضی-سوم.pdf → «ریاضی سوم») seeds the title when it is still empty.
  function onPdfExtracted(r: PdfExtractResult) {
    setText(r.text);
    setPdfKey(r.storageKey ?? null);
    setPdfName(r.fileName ?? null);
    if (!title.trim()) {
      const suggested = r.fileName
        .replace(/\.pdf$/i, "")
        .replace(/[_\-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120);
      if (suggested.length >= 2) setTitle(suggested);
    }
  }

  async function submit() {
    setBusy(true);
    setBlocked(null);
    try {
      await api("/api/v1/books", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          text: text.trim(),
          subject: curr.subject?.trim() || undefined,
          level: curr.level || undefined,
          gradeLevel: curr.gradeLevel || undefined,
          author: author.trim() || undefined,
          description: description.trim() || undefined,
          coverEmoji,
          pdfStorageKey: pdfKey || undefined,
          pdfFileName: pdfName || undefined,
        }),
      });
      toast({
        title: "کتاب عمومی ثبت شد",
        description: "تولید خلاصه، جزوه، شکل‌ها، نمونه‌سؤال‌ها و پادکست در پس‌زمینه آغاز شد — وضعیت را در فهرست پایین ببینید.",
      });
      setTitle(""); setCurr({}); setAuthor(""); setDescription("");
      setCoverEmoji("📘"); setText(""); setPdfKey(null); setPdfName(null);
      onCreated();
    } catch (e) {
      if (e instanceof ApiClientError) {
        if (e.status === 429 || e.status === 403) setBlocked(e.message);
        else toast({ title: "ثبت کتاب ناموفق بود", description: e.message, variant: "destructive" });
      } else {
        toast({ title: "ثبت کتاب ناموفق بود", description: "خطای غیرمنتظره‌ای رخ داد.", variant: "destructive" });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-border/60 bg-gradient-to-l from-emerald-500/5 via-transparent to-teal-500/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <span className="h-8 w-8 rounded-xl bg-emerald-600/15 text-emerald-700 dark:text-emerald-400 flex items-center justify-center">
            <Plus className="h-4.5 w-4.5" aria-hidden />
          </span>
          افزودن کتاب عمومی پلتفرم
        </CardTitle>
        <CardDescription>
          کتاب را در ساختار درسی قرار دهید (دوره → پایه → درس، مثل «ابتدایی · کلاس سوم · ریاضی»)
          و فایل PDF کتاب را بارگذاری کنید یا متن کامل آن را بچسبانید (حداقل {faNum(MIN_TEXT)} و حداکثر {faNum(MAX_TEXT)} نویسه).
          <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 text-[9px] mr-1.5">
            کتاب عمومی — همهٔ دانش‌آموزان می‌بینند
          </Badge>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="pb-title" className="text-xs">عنوان *</Label>
            <Input
              id="pb-title"
              dir="auto"
              className="h-11"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثلاً: فارسی پایهٔ هفتم — کامل"
              maxLength={120}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pb-author" className="text-xs">نویسنده / انتشارات (اختیاری)</Label>
            <Input
              id="pb-author"
              dir="auto"
              className="h-11"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="مثلاً: وزارت آموزش و پرورش"
              maxLength={80}
            />
          </div>
        </div>

        {/* دوره → پایه → درس */}
        <CurriculumPicker value={curr} onChange={setCurr} idPrefix="pb" />

        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="pb-desc" className="text-xs">توضیح کوتاه (اختیاری)</Label>
            <Input
              id="pb-desc"
              dir="auto"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="یک جمله دربارهٔ محتوای کتاب…"
              maxLength={300}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">جلد کتاب</Label>
            <div className="flex items-center gap-1.5">
              {COVER_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setCoverEmoji(e)}
                  aria-pressed={coverEmoji === e}
                  aria-label={`جلد ${e}`}
                  className={cn(
                    "h-10 w-10 rounded-xl border text-xl transition-all min-h-11",
                    coverEmoji === e
                      ? "border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500/30"
                      : "border-border/60 hover:border-emerald-400/40"
                  )}
                >
                  <span aria-hidden>{e}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pb-text" className="text-xs">متن کامل کتاب / جزوه *</Label>
          <PdfExtractInput idPrefix="pb-pdf" onExtracted={onPdfExtracted} onCleared={() => { setText(""); setPdfKey(null); setPdfName(null); }} disabled={busy} />
          <p className="text-[10px] text-muted-foreground leading-4 flex items-center gap-1">
            <FileText className="h-3 w-3" aria-hidden />
            فایل PDF کتاب را بارگذاری کنید، لینک مستقیم دانلود آن را بدهید، یا متن را دستی در کادر پایین بچسبانید.
          </p>
          <Textarea
            id="pb-text"
            dir="auto"
            rows={9}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="فایل PDF کتاب را بارگذاری کنید تا متن آن خودکار اینجا بیاید، یا متن کامل را دستی بچسبانید… (حداقل ۸۰۰ نویسه — خلاصه، جزوه، شکل‌ها، نمونه‌سؤال و پادکست از همین متن ساخته می‌شود)"
            maxLength={MAX_TEXT}
          />
          <div className="flex items-center justify-between text-[10px]">
            <span className={cn("tabular-nums", counterTone)}>
              {faNum(len)} / {faNum(MAX_TEXT)} نویسه
              {len > 0 && len < MIN_TEXT && ` — حداقل ${faNum(MIN_TEXT)} نویسه لازم است`}
            </span>
            <span className="text-muted-foreground flex items-center gap-1">
              <Info className="h-3 w-3" aria-hidden />
              خلاصه + جزوه + شکل‌ها + نمونه‌سؤال + پادکست
            </span>
          </div>
        </div>

        {blocked && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
            <Info className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
            <span className="leading-6">{blocked}</span>
          </div>
        )}

        <div className="flex items-center justify-end">
          <Button
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="bg-gradient-to-l from-emerald-600 to-teal-600 hover:brightness-110 active:scale-[0.98] transition-all"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin ml-1.5" aria-hidden />
            ) : (
              <Upload className="h-4 w-4 ml-1.5" aria-hidden />
            )}
            {busy ? "در حال ثبت…" : "ثبت و ساخت محتوای هوشمند"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
