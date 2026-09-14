"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiClientError } from "@/lib/app/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EmptyState, ErrorState, LoadingGrid, PageTitle, faNum } from "@/components/shared/blocks";
import { BookUploadDialog } from "@/components/shared/book-upload-dialog";
import { cn } from "@/lib/utils";
import { EDUCATION_LEVELS, gradesForLevel, gradeLabelFa, levelLabel } from "@/lib/education-levels";
import { subjectsForLevelGrade } from "@/lib/curriculum";
import { BookOpen, FileDown, Library, Plus, Search, Shapes, Sparkles, Trophy } from "lucide-react";
import { BookDetailView, type ArtifactStatus, type BookRow } from "./book-detail";

// ── Student Smart Library (Round 16 + 18 + 22) ──
// Browse visible books by the official course structure (دوره → پایه → درس — چینش
// چیپی به سبک chap.sch.ir) → open one → AI summary + جزوه + figures + podcast +
// sample quizzes with points. کاربران دارای مجوز (canUpload) همین‌جا کتاب جدید
// اضافه می‌کنند (فایل PDF یا لینک دانلود) — راند ۲۲، خواستهٔ مدیر.
// Grid polls itself while books are generating.

interface BooksListResponse {
  canUpload: boolean;
  canUploadLabel: string;
  role: string;
  books: Array<
    BookRow & {
      addedByName: string | null;
      tenantName: string | null;
      mine: boolean;
      myBest: number | null;
      myTries: number;
    }
  >;
}

interface PointsResponse {
  total: number;
  last30Days: number;
  recent: Array<{ points: number; reason: string; reasonLabel: string; createdAt: string }>;
}

const SCOPE_LABEL: Record<string, string> = {
  PLATFORM: "عمومی پلتفرم",
  TENANT: "مدرسه",
  CLASSROOM: "کلاس",
};

const COVER_TONES = [
  "from-emerald-500/15 to-teal-500/10 border-emerald-500/25",
  "from-amber-500/15 to-rose-500/10 border-amber-500/25",
  "from-teal-500/15 to-emerald-500/10 border-teal-500/25",
  "from-rose-500/15 to-amber-500/10 border-rose-500/25",
];

function coverTone(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return COVER_TONES[h % COVER_TONES.length];
}

function artifactTone(s: ArtifactStatus): { dot: string; label: string } {
  if (s === "READY") return { dot: "bg-emerald-500", label: "آماده" };
  if (s === "FAILED") return { dot: "bg-rose-500", label: "ناموفق" };
  if (s === "GENERATING" || s === "PENDING") return { dot: "bg-amber-500 animate-pulse", label: "در حال ساخت" };
  return { dot: "bg-muted-foreground/40", label: "در صف" };
}

// ── Round 22 — فیلتر آبشاری چیپی به سبک chap.sch.ir (کتاب‌های درسی ایران) ──
// دوره → پایه → درس به‌صورت ردیف چیپ‌های لمسی؛ فعال = گرادیان زمردی/فیروزه‌ای،
// غیرفعال = کانتور ملایم. جایگزین دراپ‌داون‌ها با همان state (fLevel/fGrade/fSubject).
function FilterChip({
  active,
  onClick,
  children,
  label,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={cn(
        "min-h-9 px-3 rounded-full text-xs font-bold transition-all inline-flex items-center gap-1.5 cursor-pointer",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 focus-visible:ring-offset-1",
        active
          ? "bg-gradient-to-l from-emerald-600 to-teal-600 text-white shadow-sm shadow-emerald-600/25 hover:brightness-110 active:scale-[0.97]"
          : "border border-border/60 bg-background text-muted-foreground hover:border-emerald-400/50 hover:text-foreground hover:bg-emerald-500/5 active:scale-[0.97]"
      )}
    >
      {children}
    </button>
  );
}

function ArtifactPill({ emoji, label, status }: { emoji: string; label: string; status: ArtifactStatus }) {
  const tone = artifactTone(status);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/30 px-2.5 py-1 text-[10px] cursor-default">
          <span aria-hidden>{emoji}</span>
          <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} aria-hidden />
          <span className="sr-only">{label}: {tone.label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="text-[10px]">{label} — {tone.label}</TooltipContent>
    </Tooltip>
  );
}

const FILTER_ARTIFACTS: Array<{ key: keyof BookRow; emoji: string; label: string }> = [
  { key: "summaryStatus", emoji: "📄", label: "خلاصه" },
  { key: "studyNotesStatus", emoji: "📒", label: "جزوه" },
  { key: "quizStatus", emoji: "✍️", label: "نمونه‌سؤال" },
  { key: "figuresStatus", emoji: "🖼️", label: "شکل‌ها" },
  { key: "podcastStatus", emoji: "🎧", label: "پادکست" },
];

export function LibrarySection({ onGo }: { onGo?: (section: string) => void }) {
  const [data, setData] = useState<BooksListResponse | null>(null);
  const [points, setPoints] = useState<PointsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // Round 22 — دیالوگ «افزودن کتاب جدید» (canUpload)
  const [uploadOpen, setUploadOpen] = useState(false);
  // course-structure filters (round 18)
  const [fLevel, setFLevel] = useState("ALL");
  const [fGrade, setFGrade] = useState("ALL");
  const [fSubject, setFSubject] = useState("ALL");

  const gradeOptions = useMemo(() => (fLevel === "ALL" ? [] : gradesForLevel(fLevel)), [fLevel]);
  const subjectOptions = useMemo(
    () => (fLevel === "ALL" ? [] : subjectsForLevelGrade(fLevel, fGrade === "ALL" ? null : fGrade)),
    [fLevel, fGrade],
  );

  // ── initial load (list + points chip) ──
  useEffect(() => {
    let ignore = false;
    void (async () => {
      try {
        const [res, pts] = await Promise.all([
          api<BooksListResponse>("/api/v1/books"),
          api<PointsResponse>("/api/v1/me/points").catch(() => null),
        ]);
        if (!ignore) {
          setData(res);
          setError(null);
          if (pts) setPoints(pts);
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
      /* silent — next poll/interaction retries */
    }
  }, []);

  const refreshPoints = useCallback(async () => {
    try {
      setPoints(await api<PointsResponse>("/api/v1/me/points"));
    } catch {
      /* silent */
    }
  }, []);

  // ── poll the grid every 5s while any book is generating (paused while a book dialog is open) ──
  const selectedBook = data?.books.find((b) => b.id === selectedId) ?? null;
  const anyGenerating = useMemo(
    () =>
      (data?.books ?? []).some(
        (b) =>
          FILTER_ARTIFACTS.some((a) => ["GENERATING", "PENDING"].includes(String(b[a.key]))) ||
          b.status === "GENERATING" ||
          b.status === "PENDING",
      ),
    [data],
  );

  useEffect(() => {
    if (!anyGenerating || selectedBook) return;
    const timer = setInterval(() => void refreshSilent(), 5000);
    return () => clearInterval(timer);
  }, [anyGenerating, selectedBook, refreshSilent]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.books ?? []).filter((b) => {
      if (fLevel !== "ALL" && (b.level ?? "") !== fLevel) return false;
      if (fGrade !== "ALL" && (b.gradeLevel ?? "") !== fGrade) return false;
      if (fSubject !== "ALL" && (b.subject ?? "") !== fSubject) return false;
      if (!q) return true;
      return [b.title, b.author, b.subject, b.description, b.gradeLevel, levelLabel(b.level)]
        .filter(Boolean)
        .some((f) => (f as string).toLowerCase().includes(q));
    });
  }, [data, search, fLevel, fGrade, fSubject]);

  if (data === null && !error) {
    return (
      <div className="space-y-4">
        <PageTitle title="کتاب‌خانه هوشمند" description="خلاصه، جزوه، شکل‌ها، پادکست و نمونه‌سؤال‌های هوشمند کتاب‌ها." />
        <LoadingGrid count={6} />
      </div>
    );
  }

  const hasFilters = fLevel !== "ALL" || fGrade !== "ALL" || fSubject !== "ALL" || search.trim() !== "";

  return (
    <div className="space-y-4">
      <PageTitle
        title="کتاب‌خانه هوشمند"
        description="کتاب‌ها را بر اساس دوره، پایه و درس پیدا کن؛ خلاصه، جزوه، پادکست صوتی و نمونه‌سؤال‌ها آمادهٔ استفاده‌اند."
        action={
          <div className="flex items-center gap-2 flex-wrap">
            {/* Round 22 — «افزودن کتاب جدید» همان‌جا که کتاب‌ها دیده می‌شوند */}
            {data?.canUpload && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => setUploadOpen(true)}
                    className="h-9 bg-gradient-to-l from-emerald-600 to-teal-600 text-white hover:brightness-110 active:scale-[0.98] transition-all shadow-md shadow-emerald-600/20"
                  >
                    <Plus className="h-4 w-4 ml-1.5" aria-hidden />
                    افزودن کتاب جدید
                  </Button>
                </TooltipTrigger>
                <TooltipContent className="text-[10px] max-w-56 text-right" dir="rtl">
                  {data.canUploadLabel}
                </TooltipContent>
              </Tooltip>
            )}
            {points ? (
              <Badge
                className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30 text-xs font-bold tabular-nums h-8 px-3 cursor-default"
                title={`۳۰ روز اخیر: ${faNum(points.last30Days)} امتیاز`}
              >
                <span aria-hidden>⭐</span> {faNum(points.total)} امتیاز
              </Badge>
            ) : undefined}
          </div>
        }
      />

      {/* مجوز آپلود — راهنمای زیر دکمه وقتی دیالوگ باز است */}
      {data?.canUpload && uploadOpen && (
        <p className="text-[10px] text-muted-foreground flex items-center gap-1.5 -mt-2">
          <Plus className="h-3 w-3 shrink-0" aria-hidden />
          {data.canUploadLabel}
        </p>
      )}

      {error && <ErrorState message={error} onRetry={() => setReloadKey((k) => k + 1)} />}

      {data && (
        <>
          {data.books.length > 0 && (
            <div className="space-y-2.5">
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
                <Input
                  dir="auto"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="جست‌وجو در عنوان، نویسنده یا درس…"
                  className="pr-9 h-11"
                  maxLength={80}
                />
              </div>
              {/* ── Round 22 — فیلتر آبشاری چیپی به سبک chap.sch.ir: دوره → پایه → درس ── */}
              <div className="rounded-xl border border-border/60 bg-muted/20 p-3 space-y-2.5">
                {/* ردیف ۱ — دورهٔ تحصیلی */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-bold text-muted-foreground shrink-0 pl-0.5">
                    دوره:
                  </span>
                  <FilterChip
                    active={fLevel === "ALL"}
                    onClick={() => {
                      setFLevel("ALL");
                      setFGrade("ALL");
                      setFSubject("ALL");
                    }}
                    label="همهٔ دوره‌ها"
                  >
                    همه
                  </FilterChip>
                  {EDUCATION_LEVELS.map((l) => (
                    <FilterChip
                      key={l.code}
                      active={fLevel === l.code}
                      onClick={() => {
                        setFLevel(l.code);
                        setFGrade("ALL");
                        setFSubject("ALL");
                      }}
                      label={`دوره ${l.label}`}
                    >
                      <span aria-hidden>{l.emoji}</span>
                      {l.label}
                    </FilterChip>
                  ))}
                </div>

                {/* ردیف ۲ — پایه (بعد از انتخاب دوره؛ پیش‌دبستانی پایه ندارد) */}
                {fLevel !== "ALL" && gradeOptions.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-2.5 border-t border-border/50">
                    <span className="text-[10px] font-bold text-muted-foreground shrink-0 pl-0.5">
                      {fLevel === "PRIMARY" ? "کلاس:" : "پایه:"}
                    </span>
                    <FilterChip
                      active={fGrade === "ALL"}
                      onClick={() => {
                        setFGrade("ALL");
                        setFSubject("ALL");
                      }}
                      label="همهٔ پایه‌ها"
                    >
                      همهٔ پایه‌ها
                    </FilterChip>
                    {gradeOptions.map((g) => (
                      <FilterChip
                        key={g}
                        active={fGrade === g}
                        onClick={() => {
                          setFGrade(g);
                          setFSubject("ALL");
                        }}
                        label={gradeLabelFa(fLevel, g)}
                      >
                        {gradeLabelFa(fLevel, g)}
                      </FilterChip>
                    ))}
                  </div>
                )}

                {/* ردیف ۳ — درس (بعد از انتخاب پایه؛ پیش‌دبستانی مستقیم درس دارد) */}
                {fLevel !== "ALL" && subjectOptions.length > 0 && (fGrade !== "ALL" || gradeOptions.length === 0) && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-2.5 border-t border-border/50">
                    <span className="text-[10px] font-bold text-muted-foreground shrink-0 pl-0.5">
                      درس:
                    </span>
                    <FilterChip
                      active={fSubject === "ALL"}
                      onClick={() => setFSubject("ALL")}
                      label="همهٔ درس‌ها"
                    >
                      همهٔ دروس
                    </FilterChip>
                    {subjectOptions.map((s) => (
                      <FilterChip
                        key={s}
                        active={fSubject === s}
                        onClick={() => setFSubject(s)}
                        label={`درس ${s}`}
                      >
                        {s}
                      </FilterChip>
                    ))}
                  </div>
                )}
              </div>
              {hasFilters && (
                <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                  <span className="tabular-nums">{faNum(filtered.length)} کتاب مطابق فیلترها</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[10px]"
                    onClick={() => {
                      setFLevel("ALL");
                      setFGrade("ALL");
                      setFSubject("ALL");
                      setSearch("");
                    }}
                  >
                    پاک‌کردن فیلترها
                  </Button>
                </div>
              )}
            </div>
          )}

          {data.books.length === 0 && (
            <EmptyState
              icon={Library}
              title="هنوز کتابی در کتاب‌خانه نیست…"
              description="به‌محض اینکه مدیر پلتفرم یا معلم‌هایت کتاب یا جزوه‌ای اضافه کنند، خلاصه، جزوه، پادکست و نمونه‌سؤال‌های آن اینجا ظاهر می‌شود."
              action={
                onGo ? (
                  <Button variant="outline" size="sm" onClick={() => onGo("tutor")}>
                    <Sparkles className="h-4 w-4 ml-1.5" aria-hidden />
                    گفت‌وگو با دستیار هوشمند
                  </Button>
                ) : undefined
              }
            />
          )}

          {data.books.length > 0 && filtered.length === 0 && (
            <EmptyState
              icon={Search}
              title="کتابی مطابق فیلترها نیست"
              description="فیلتر دیگری را امتحان کنید یا فیلترها را پاک کنید."
              action={
                <Button variant="ghost" size="sm" onClick={() => {
                  setFLevel("ALL");
                  setFGrade("ALL");
                  setFSubject("ALL");
                  setSearch("");
                }}>
                  پاک‌کردن فیلترها
                </Button>
              }
            />
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((b) => (
              <Card
                key={b.id}
                className="border-border/60 hover:border-emerald-400/50 hover:shadow-md transition-all overflow-hidden"
              >
                <CardContent className="p-4 flex flex-col h-full">
                  <div className="flex items-start gap-3.5">
                    <div
                      className={cn(
                        "h-16 w-16 rounded-2xl bg-gradient-to-br border flex items-center justify-center text-4xl shrink-0",
                        coverTone(b.id),
                      )}
                      aria-hidden
                    >
                      {b.coverEmoji}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-bold text-sm leading-6 line-clamp-2">{b.title}</h3>
                      <p className="text-[11px] text-muted-foreground mt-1 truncate">
                        {b.author ?? "نویسنده نامشخص"} · {SCOPE_LABEL[b.scope]}
                      </p>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {b.levelLabel && (
                          <Badge className="bg-teal-500/10 text-teal-700 dark:text-teal-400 border border-teal-500/30 text-[9px]">
                            {b.levelLabel}
                          </Badge>
                        )}
                        {b.gradeLevel && <Badge variant="outline" className="text-[9px]">{gradeLabelFa(b.level, b.gradeLevel)}</Badge>}
                        {b.subject && (
                          <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 text-[9px]">
                            {b.subject}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  {b.description && (
                    <p className="text-[11px] text-muted-foreground leading-5 line-clamp-2 mt-3" dir="auto">
                      {b.description}
                    </p>
                  )}

                  <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                    {FILTER_ARTIFACTS.map((a) => (
                      <ArtifactPill
                        key={a.key}
                        emoji={a.emoji}
                        label={a.label}
                        status={b[a.key] as ArtifactStatus}
                      />
                    ))}
                    {b.figuresCount > 0 && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/30 px-2 py-1 text-[10px] cursor-default tabular-nums">
                            <Shapes className="h-3 w-3" aria-hidden />
                            {faNum(b.figuresCount)}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="text-[10px]">{faNum(b.figuresCount)} شکل آموزشی</TooltipContent>
                      </Tooltip>
                    )}
                    {b.hasOriginalPdf && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[10px] cursor-default text-emerald-700 dark:text-emerald-400">
                            <FileDown className="h-3 w-3" aria-hidden />
                            PDF اصلی
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="text-[10px]">نسخهٔ اصلی کتاب (PDF) قابل دانلود است</TooltipContent>
                      </Tooltip>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 mt-auto pt-3.5 border-t border-border/60">
                    {b.myTries > 0 ? (
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1 tabular-nums">
                        <Trophy className="h-3.5 w-3.5 text-amber-500 shrink-0" aria-hidden />
                        بهترین رکورد: {faNum(b.myBest ?? 0)} · {faNum(b.myTries)} تلاش
                      </span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">هنوز آزمون نداده‌ای</span>
                    )}
                    <Button size="sm" className="h-8" onClick={() => setSelectedId(b.id)}>
                      <BookOpen className="h-4 w-4 ml-1" aria-hidden />
                      مشاهده
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {selectedBook && (
            <BookDetailView
              book={selectedBook}
              onClose={() => {
                setSelectedId(null);
                void refreshSilent();
              }}
              onChanged={() => void refreshSilent()}
              onPointsGained={() => {
                void refreshPoints();
                void refreshSilent();
              }}
            />
          )}

          {/* Round 22 — دیالوگ افزودن کتاب جدید (روی فراخوانی onCreated کل فهرست تازه می‌شود) */}
          {data.canUpload && (
            <BookUploadDialog
              open={uploadOpen}
              onOpenChange={setUploadOpen}
              onCreated={() => setReloadKey((k) => k + 1)}
            />
          )}
        </>
      )}
    </div>
  );
}
