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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EmptyState, ErrorState, LoadingGrid, PageTitle, faDateTime, faNum } from "@/components/shared/blocks";
import { CurriculumPicker, type CurriculumValue } from "@/components/shared/curriculum-picker";
import { PdfExtractInput, type PdfExtractResult } from "@/components/shared/pdf-extract-input";
import { gradeLabelFa } from "@/lib/education-levels";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { type TeacherClass } from "./types";
import {
  BookOpen, CheckCircle2, FileText, Headphones, Hourglass, Info, Library, Loader2, Lock,
  NotebookPen, PenLine, Plus, RefreshCw, Shapes, Sparkles, Trash2, Upload, XCircle,
} from "lucide-react";

// ── Teacher Books & Handouts (Round 16 + 18) ──
// Permission-gated upload (platform admin enables per tenant — default OFF) with the
// full course structure (دوره → پایه → درس). Uploading triggers the async pipeline:
// summary → جزوه → 4 quiz models → SVG figures → podcast. Round 18: uploads wait for
// SUPER_ADMIN approval before students can see them.

const MIN_TEXT = 800;
const MAX_TEXT = 60_000;

const COVER_EMOJIS = ["📘", "📗", "📕", "📙", "📓"];

const SCOPE_LABEL: Record<string, string> = {
  PLATFORM: "عمومی پلتفرم",
  TENANT: "مدرسه",
  CLASSROOM: "کلاس",
};

const APPROVAL_LABEL: Record<string, string> = {
  NOT_REQUIRED: "",
  PENDING: "در انتظار تأیید مدیر کل",
  APPROVED: "تأییدشده — برای دانش‌آموزان فعال",
  REJECTED: "ردشده",
};

const APPROVAL_TONE: Record<string, string> = {
  NOT_REQUIRED: "",
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

const ARTIFACTS = [
  { kind: "summary", label: "خلاصه", Icon: FileText },
  { kind: "notes", label: "جزوه", Icon: NotebookPen },
  { kind: "quiz", label: "نمونه‌سؤال", Icon: PenLine },
  { kind: "figures", label: "شکل‌ها", Icon: Shapes },
  { kind: "podcast", label: "پادکست", Icon: Headphones },
] as const;

function statusOf(b: TeacherBookRow, kind: string): string {
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

interface TeacherBookRow {
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
  books: TeacherBookRow[];
}

function artifactTone(s: string): { dot: string; label: string } {
  if (s === "READY") return { dot: "bg-emerald-500", label: "آماده" };
  if (s === "FAILED") return { dot: "bg-rose-500", label: "ناموفق" };
  if (s === "GENERATING" || s === "PENDING") return { dot: "bg-amber-500 animate-pulse", label: "در حال ساخت" };
  return { dot: "bg-muted-foreground/40", label: "در صف" };
}

function isBookBusy(b: TeacherBookRow): boolean {
  return (
    ["GENERATING", "PENDING"].includes(b.status) ||
    ARTIFACTS.some((a) => ["GENERATING", "PENDING"].includes(statusOf(b, a.kind)))
  );
}

function structureLine(b: { level?: string | null; levelLabel: string | null; gradeLevel: string | null; subject: string | null }): string | null {
  const bits = [b.levelLabel, b.gradeLevel ? gradeLabelFa(b.level, b.gradeLevel) : null, b.subject].filter(Boolean);
  return bits.length > 0 ? bits.join(" · ") : null;
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

export function TeacherBooksSection() {
  const { toast } = useToast();
  const [data, setData] = useState<BooksListResponse | null>(null);
  const [classes, setClasses] = useState<TeacherClass[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [regenKey, setRegenKey] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  // ── list + own classrooms ──
  useEffect(() => {
    let ignore = false;
    void (async () => {
      try {
        const [res, cls] = await Promise.all([
          api<BooksListResponse>("/api/v1/books"),
          api<{ classes: TeacherClass[] }>("/api/v1/teacher/classes").catch(() => null),
        ]);
        if (!ignore) {
          setData(res);
          setError(null);
          if (cls) setClasses(cls.classes);
        }
      } catch (e) {
        if (!ignore) setError(e instanceof ApiClientError ? e.message : "بارگذاری کتاب‌ها ناموفق بود.");
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

  // ── poll while any book is generating ──
  const anyGenerating = useMemo(() => (data?.books ?? []).some(isBookBusy), [data]);
  useEffect(() => {
    if (!anyGenerating) return;
    const timer = setInterval(() => void refreshSilent(), 5000);
    return () => clearInterval(timer);
  }, [anyGenerating, refreshSilent]);

  async function regenerate(book: TeacherBookRow, kind: string) {
    setRegenKey(`${book.id}:${kind}`);
    try {
      await api(`/api/v1/books/${book.id}/regenerate`, {
        method: "POST",
        body: JSON.stringify({ kind }),
      });
      toast({
        title: "بازتولید آغاز شد",
        description: `${KIND_LABEL[kind]} کتاب «${book.title}» دوباره ساخته می‌شود — چند لحظه طول می‌کشد.`,
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

  async function remove(book: TeacherBookRow) {
    setDeleting(book.id);
    try {
      await api(`/api/v1/books/${book.id}`, { method: "DELETE" });
      toast({ title: "کتاب حذف شد", description: `«${book.title}» از کتاب‌خانه حذف شد.` });
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

  if (data === null && !error) {
    return (
      <div className="space-y-4">
        <PageTitle title="کتاب‌ها و جزوه‌ها" description="بارگذاری جزوه و ساخت محتوای هوشمند برای دانش‌آموزان." />
        <LoadingGrid count={4} />
      </div>
    );
  }

  const mine = (data?.books ?? []).filter((b) => b.mine);
  const others = (data?.books ?? []).filter((b) => !b.mine);

  return (
    <div className="space-y-5">
      <PageTitle
        title="کتاب‌ها و جزوه‌ها"
        description="متن کتاب یا جزوه را با ساختار درسی (دوره → پایه → درس) بارگذاری کن؛ خلاصه، جزوه، شکل‌ها، چهار مدل نمونه‌سؤال و پادکست صوتی خودکار ساخته می‌شود."
      />

      {error && <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />}

      {data && !data.canUpload && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="p-5 flex items-start gap-3.5">
            <span className="h-10 w-10 rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-400 flex items-center justify-center shrink-0">
              <Lock className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="font-bold text-sm">قابلیت بارگذاری کتاب/جزوه فعال نشده است</p>
              <p className="text-xs text-muted-foreground leading-6 mt-1.5">
                قابلیت افزودن کتاب برای شما فعال نیست{data.canUploadLabel ? ` (${data.canUploadLabel})` : ""} —
                مدیر کل پلتفرم باید آن را در بخش «تنظیمات و اتصال‌ها» برای مدرسهٔ شما فعال کند. تا آن زمان
                کتاب‌های موجود زیر این کارت قابل مشاهده‌اند و دانش‌آموزان می‌توانند از محتوای هوشمندشان استفاده کنند.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {data && data.canUpload && (
        <BookUploadForm classes={classes} onCreated={() => void refreshSilent()} />
      )}

      {data && (
        <section className="space-y-3">
          <h3 className="text-sm font-extrabold flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" aria-hidden />
            کتاب‌های من
            <Badge variant="secondary" className="text-[10px] tabular-nums">{faNum(mine.length)}</Badge>
          </h3>

          {mine.length === 0 && (
            <EmptyState
              icon={Upload}
              title={data.canUpload ? "هنوز کتابی بارگذاری نکرده‌ای" : "کتابی از شما ثبت نشده است"}
              description={
                data.canUpload
                  ? "اولین جزوه یا کتاب را با فرم بالا ثبت کن تا محتوای هوشمند آن برای دانش‌آموزان ساخته شود."
                  : "برای بارگذاری کتاب، ابتدا باید مدیر کل پلتفرم این قابلیت را فعال کند."
              }
            />
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            {mine.map((b) => (
              <Card key={b.id} className="border-border/60">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-emerald-500/15 to-teal-500/10 border border-emerald-500/20 flex items-center justify-center text-2xl shrink-0" aria-hidden>
                      {b.coverEmoji}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold leading-6 line-clamp-1">{b.title}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                        <span>{SCOPE_LABEL[b.scope]}</span>
                        {b.author && <><span aria-hidden>·</span><span className="truncate">{b.author}</span></>}
                        <span aria-hidden>·</span>
                        <span className="tabular-nums">{faNum(b.charCount)} نویسه</span>
                      </p>
                      {structureLine(b) && (
                        <p className="text-[10px] text-muted-foreground mt-1">🎓 {structureLine(b)}</p>
                      )}
                      {b.approvalStatus !== "NOT_REQUIRED" && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className={cn("inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-bold mt-1.5 cursor-default", APPROVAL_TONE[b.approvalStatus])}>
                              {b.approvalStatus === "PENDING" ? <Hourglass className="h-3 w-3" aria-hidden /> : b.approvalStatus === "APPROVED" ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : <XCircle className="h-3 w-3" aria-hidden />}
                              {APPROVAL_LABEL[b.approvalStatus]}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="text-[10px] max-w-56">
                            {b.approvalStatus === "PENDING"
                              ? "پس از تأیید مدیر کل پلتفرم برای دانش‌آموزان نمایش داده می‌شود"
                              : b.approvalStatus === "APPROVED"
                                ? "برای دانش‌آموزان مدرسه/کلاس منتشر شده است"
                                : b.approvalNote
                                  ? `علت رد: ${b.approvalNote}`
                                  : "توسط مدیر کل رد شده — می‌توانید ویرایش و دوباره ثبت کنید"}
                          </TooltipContent>
                        </Tooltip>
                      )}
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {ARTIFACTS.map((a) => (
                          <StatusPill key={a.kind} icon={a.Icon} label={a.label} status={statusOf(b, a.kind)} />
                        ))}
                      </div>
                    </div>
                  </div>

                  {b.status === "GENERATING" || b.status === "PENDING" ? (
                    <p className="text-[11px] text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                      در حال تولید محتوای هوشمند — فهرست هر ۵ ثانیه به‌روز می‌شود.
                    </p>
                  ) : b.status === "FAILED" ? (
                    <p className="text-[11px] text-rose-700 dark:text-rose-400">تولید ناموفق — از دکمه‌های بازتولید استفاده کن.</p>
                  ) : (
                    <p className="text-[10px] text-muted-foreground tabular-nums">
                      {faDateTime(b.createdAt)} · {faNum(b.quizCount)} نمونه‌سؤال
                      {b.figuresCount > 0 ? ` · ${faNum(b.figuresCount)} شکل` : ""}
                      {b.podcastDurationSec !== null && ` · پادکست ${faNum(b.podcastDurationSec)} ثانیه‌ای`}
                    </p>
                  )}

                  <div className="flex items-center justify-between gap-2 flex-wrap pt-1 border-t border-border/60">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {ARTIFACTS.map((a) => {
                        const busy = ["GENERATING", "PENDING"].includes(statusOf(b, a.kind));
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
                            آیا از حذف «{b.title}» مطمئن هستی؟ خلاصه، جزوه، شکل‌ها، نمونه‌سؤال‌ها، پادکست و
                            رکوردهای مرتبط آن نیز حذف می‌شوند و این کار بازگشت‌پذیر نیست.
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
      )}

      {data && others.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-extrabold flex items-center gap-2">
            <Library className="h-4 w-4 text-primary" aria-hidden />
            سایر کتاب‌های قابل مشاهده
            <Badge variant="secondary" className="text-[10px] tabular-nums">{faNum(others.length)}</Badge>
          </h3>
          <Card className="border-border/60">
            <CardContent className="p-2.5 max-h-80 overflow-y-auto">
              <div className="space-y-1.5">
                {others.map((b) => (
                  <div key={b.id} className="flex items-center justify-between gap-2.5 rounded-lg border border-border/60 px-3 py-2.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="text-xl shrink-0" aria-hidden>{b.coverEmoji}</span>
                      <div className="min-w-0">
                        <p className="text-xs font-bold truncate">{b.title}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                          {SCOPE_LABEL[b.scope]}
                          {b.addedByName ? ` · ${b.addedByName}` : ""}
                          {b.tenantName ? ` · ${b.tenantName}` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <StatusPill icon={FileText} label="خلاصه" status={b.summaryStatus} />
                      <StatusPill icon={NotebookPen} label="جزوه" status={b.studyNotesStatus} />
                      <StatusPill icon={PenLine} label="سؤال" status={b.quizStatus} />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}

// ── upload form (teacher: structured دوره → پایه → درس, optional classroom scoping, quota-checked) ──
function BookUploadForm({ classes, onCreated }: { classes: TeacherClass[] | null; onCreated: () => void }) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [curr, setCurr] = useState<CurriculumValue>({});
  const [author, setAuthor] = useState("");
  const [description, setDescription] = useState("");
  const [coverEmoji, setCoverEmoji] = useState("📘");
  const [classroomId, setClassroomId] = useState("ALL");
  const [text, setText] = useState("");
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
  // seeds the title when it is still empty.
  function onPdfExtracted(r: PdfExtractResult) {
    setText(r.text);
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
          classroomId: classroomId !== "ALL" ? classroomId : undefined,
        }),
      });
      toast({
        title: "کتاب ثبت شد و به تأیید فرستاده شد",
        description: "تولید خلاصه، جزوه، شکل‌ها، نمونه‌سؤال‌ها و پادکست آغاز شد. پس از تأیید مدیر کل برای دانش‌آموزان نمایش داده می‌شود.",
      });
      setTitle(""); setCurr({}); setAuthor(""); setDescription("");
      setCoverEmoji("📘"); setClassroomId("ALL"); setText("");
      onCreated();
    } catch (e) {
      if (e instanceof ApiClientError) {
        if (e.status === 429 || e.status === 403) setBlocked(e.message);
        else
          toast({ title: "ثبت کتاب ناموفق بود", description: e.message, variant: "destructive" });
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
          افزودن کتاب / جزوه
        </CardTitle>
        <CardDescription>
          کتاب/جزوه را در ساختار درسی قرار بده (دوره → پایه → درس، مثل «متوسطهٔ اول · پایهٔ هفتم · فارسی»)
          و متن کامل را بچسبانید (حداقل {faNum(MIN_TEXT)} نویسه). پنج قابلیت هوشمند — خلاصه، جزوه،
          نمونه‌سؤال (چهار مدل)، شکل‌های آموزشی و پادکست — به‌ترتیب ساخته می‌شوند.
          <Badge className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30 text-[9px] mr-1.5">
            پس از تأیید مدیر کل برای دانش‌آموزان نمایش داده می‌شود
          </Badge>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="tb-title" className="text-xs">عنوان *</Label>
            <Input
              id="tb-title"
              dir="auto"
              className="h-11"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثلاً: جزوهٔ ریاضی — معادلهٔ خط"
              maxLength={120}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tb-author" className="text-xs">نویسنده / مدرس (اختیاری)</Label>
            <Input
              id="tb-author"
              dir="auto"
              className="h-11"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="مثلاً: خانم رضایی"
              maxLength={80}
            />
          </div>
        </div>

        {/* دوره → پایه → درس (ساختار درسی رسمی) */}
        <CurriculumPicker value={curr} onChange={setCurr} idPrefix="tb" />

        <div className="space-y-1.5">
          <Label htmlFor="tb-desc" className="text-xs">توضیح کوتاه (اختیاری)</Label>
          <Input
            id="tb-desc"
            dir="auto"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="یک جمله دربارهٔ محتوای کتاب برای دانش‌آموزان…"
            maxLength={300}
          />
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
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
          <div className="space-y-1.5">
            <Label className="text-xs">محدودهٔ نمایش</Label>
            <Select value={classroomId} onValueChange={setClassroomId}>
              <SelectTrigger className="h-11 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">همهٔ دانش‌آموزان مدرسه</SelectItem>
                {(classes ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} — پایه {c.grade}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground leading-4">
              اگر کلاس خاصی انتخاب شود، فقط دانش‌آموزان همان کلاس کتاب را می‌بینند.
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tb-text" className="text-xs">متن کامل کتاب / جزوه *</Label>
          <PdfExtractInput idPrefix="tb-pdf" onExtracted={onPdfExtracted} onCleared={() => setText("")} disabled={busy} />
          <p className="text-[10px] text-muted-foreground leading-4 flex items-center gap-1">
            <FileText className="h-3 w-3" aria-hidden />
            فایل PDF جزوه/کتاب را بارگذاری کنید یا متن را دستی در کادر پایین بچسبانید.
          </p>
          <Textarea
            id="tb-text"
            dir="auto"
            rows={9}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="فایل PDF را بارگذاری کنید تا متن آن خودکار اینجا بیاید، یا متن کامل جزوه را دستی بچسبانید… (حداقل ۸۰۰ نویسه تا خلاصهٔ باکیفیت ساخته شود)"
            maxLength={MAX_TEXT}
          />
          <div className="flex items-center justify-between text-[10px]">
            <span className={cn("tabular-nums", counterTone)}>
              {faNum(len)} / {faNum(MAX_TEXT)} نویسه
              {len > 0 && len < MIN_TEXT && ` — حداقل ${faNum(MIN_TEXT)} نویسه لازم است`}
            </span>
            <span className="text-muted-foreground flex items-center gap-1">
              <Sparkles className="h-3 w-3" aria-hidden />
              خلاصه + جزوه + شکل‌ها + نمونه‌سؤال + پادکست
            </span>
          </div>
        </div>

        {blocked && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
            <Lock className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
            <span className="leading-6">{blocked}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-3">
          <Button onClick={() => void submit()} disabled={!canSubmit} className="bg-gradient-to-l from-emerald-600 to-teal-600 hover:brightness-110 active:scale-[0.98] transition-all">
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin ml-1.5" aria-hidden />
            ) : (
              <Upload className="h-4 w-4 ml-1.5" aria-hidden />
            )}
            {busy ? "در حال ثبت…" : "ثبت و ساخت محتوای هوشمند"}
          </Button>
        </div>

        <p className="text-[10px] text-muted-foreground flex items-center gap-1.5 leading-5">
          <Info className="h-3 w-3 shrink-0" aria-hidden />
          هر بارگذاری از سهمیهٔ روزانهٔ قابلیت‌های «خلاصه‌ساز»، «تولید سؤال» و «پادکست» شما استفاده می‌کند؛ کتاب پس از ثبت به تأیید مدیر کل پلتفرم می‌رود.
        </p>
      </CardContent>
    </Card>
  );
}
