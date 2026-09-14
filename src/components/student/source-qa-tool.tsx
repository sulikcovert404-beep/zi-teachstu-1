"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiClientError } from "@/lib/app/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorState, faDateTime, faNum } from "@/components/shared/blocks";
import { cn } from "@/lib/utils";
import {
  BookMarked, Check, ChevronDown, GraduationCap, Info, Library, Loader2, Lock,
  MessageCircleQuestion, RefreshCw, Send, ShieldCheck, Users,
} from "lucide-react";

// ── Student Source Q&A (spec §12 — «RAG روی منابع مجاز») ──
// Same Source Guardian pipeline as the teacher knowledge base, but retrieval is
// scoped server-side to: tenant-wide sources + the student's active classrooms.
// Answers cite sources as [۱] and refuse honestly when nothing matches (spec §99).

interface StudentSourceRow {
  id: string;
  title: string;
  description: string | null;
  subject: string | null;
  charCount: number;
  chunkCount: number;
  classroom: { name: string } | null;
  creator: string;
  createdAt: string;
}

interface CitationRef {
  sourceId: string;
  title: string;
  chunkPosition: number;
  snippet: string;
}

interface AskResponse {
  answer: string;
  foundInSources: boolean;
  sources: CitationRef[];
  usedChunks: number;
  usedSourceCount: number;
  quota: { usedToday: number; dailyLimit: number; remaining: number; planName: string };
}

interface HistoryItem {
  question: string;
  res: AskResponse;
  at: string;
}

const SUBJECT_TONES = [
  "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
  "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30",
  "bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-500/30",
];

function subjectTone(key: string): string {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return SUBJECT_TONES[h % SUBJECT_TONES.length];
}

export function SourceQATool() {
  const [sources, setSources] = useState<StudentSourceRow[] | null>(null);
  const [classrooms, setClassrooms] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [asked, setAsked] = useState<string | null>(null);
  const [answer, setAnswer] = useState<AskResponse | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [quota, setQuota] = useState<{ usedToday: number; dailyLimit: number; remaining: number } | null>(null);
  const answerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let ignore = false;
    void (async () => {
      try {
        const res = await api<{ sources: StudentSourceRow[]; classrooms: number }>(
          "/api/v1/student/knowledge/sources"
        );
        if (!ignore) {
          setSources(res.sources);
          setClassrooms(res.classrooms);
        }
      } catch (e) {
        if (!ignore) {
          setError(e instanceof ApiClientError ? e.message : "بارگذاری منابع ناموفق بود.");
          setSources([]);
        }
      }
    })();
    return () => {
      ignore = true;
    };
  }, [reloadKey]);

  async function ask() {
    const q = question.trim();
    if (q.length < 3) {
      setError("پرسش باید حداقل ۳ نویسه باشد.");
      return;
    }
    setBusy(true); setError(null); setBlocked(null); setUnavailable(null); setAnswer(null); setAsked(null);
    try {
      const res = await api<AskResponse>("/api/v1/student/knowledge/ask", {
        method: "POST",
        body: JSON.stringify({
          question: q,
          sourceIds: selected.size > 0 ? Array.from(selected) : undefined,
        }),
      });
      setAnswer(res);
      setAsked(q);
      setQuota(res.quota);
      setHistory((h) => [{ question: q, res, at: new Date().toISOString() }, ...h].slice(0, 8));
      setQuestion("");
      requestAnimationFrame(() => answerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
    } catch (e) {
      if (e instanceof ApiClientError) {
        if (e.status === 429 || e.code === "FORBIDDEN") setBlocked(e.message);
        else if (e.status === 503 || e.code === "AI_PROVIDER_UNAVAILABLE") setUnavailable(e.message);
        else setError(e.message);
      } else setError("ارسال پرسش ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (sources === null && !error) {
    return (
      <div className="space-y-4">
        <Card className="border-border/60">
          <CardContent className="p-4 space-y-3">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-2/3" />
          </CardContent>
        </Card>
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  const totalChunks = (sources ?? []).reduce((s, x) => s + x.chunkCount, 0);

  return (
    <div className="space-y-4">
      {/* Header / quota */}
      <Card className="border-border/60 bg-gradient-to-l from-emerald-500/5 via-transparent to-teal-500/5">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <span className="h-8 w-8 rounded-xl bg-emerald-600/15 text-emerald-700 dark:text-emerald-400 flex items-center justify-center">
                  <Library className="h-4.5 w-4.5" aria-hidden />
                </span>
                پرسش از منابع کلاس
                {sources !== null && (
                  <Badge variant="secondary" className="text-[10px] tabular-nums">
                    {faNum(sources.length)} منبع · {faNum(totalChunks)} قطعه
                  </Badge>
                )}
              </CardTitle>
              <CardDescription className="mt-1.5">
                از جزوه‌ها و متن‌هایی که معلم شما در دانش‌نامه ثبت کرده بپرسید؛ پاسخ‌ها فقط بر پایهٔ همان
                منابع ساخته می‌شوند و هر ادعا با شمارهٔ منبع [۱] استناد می‌شود.
              </CardDescription>
            </div>
            <Button
              variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground"
              onClick={() => setReloadKey((k) => k + 1)}
              aria-label="به‌روزرسانی فهرست منابع"
              title="به‌روزرسانی فهرست منابع"
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border/60 bg-background/60 p-3 flex items-center gap-2.5">
              <GraduationCap className="h-4.5 w-4.5 text-primary shrink-0" aria-hidden />
              <div className="min-w-0">
                <p className="text-[10px] text-muted-foreground">دسترسی</p>
                <p className="text-xs font-bold truncate">
                  {faNum(classrooms)} کلاس فعال شما + منابع عمومی مدرسه
                </p>
              </div>
            </div>
            <div className="rounded-xl border border-border/60 bg-background/60 p-3 flex items-center gap-2.5">
              <ShieldCheck className="h-4.5 w-4.5 text-emerald-600 shrink-0" aria-hidden />
              <div className="min-w-0">
                <p className="text-[10px] text-muted-foreground">گارانتی منبع</p>
                <p className="text-xs font-bold">پاسخ بی‌منبع داده نمی‌شود</p>
              </div>
            </div>
          </div>
          {quota && quota.dailyLimit > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-medium">سهمیهٔ پرسش امروز</span>
                <span className="tabular-nums text-muted-foreground">
                  {faNum(quota.usedToday)} / {faNum(quota.dailyLimit)}
                </span>
              </div>
              <Progress
                value={Math.min(100, (quota.usedToday / quota.dailyLimit) * 100)}
                className="h-1.5"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Source scope selector */}
      {sources !== null && sources.length > 0 && (
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <BookMarked className="h-4 w-4 text-primary" aria-hidden /> محدودهٔ جست‌وجو
              <span className="text-[10px] font-normal text-muted-foreground">
                (خالی بمانید تا همهٔ منابع جست‌وجو شوند)
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-2 gap-2.5">
              {sources.map((s) => {
                const active = selected.has(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggle(s.id)}
                    aria-pressed={active}
                    className={cn(
                      "rounded-xl border p-3 text-right transition-all hover:shadow-sm min-h-16",
                      active
                        ? "border-primary/60 bg-primary/5 ring-1 ring-primary/30"
                        : "border-border/60 hover:border-primary/30"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-bold truncate flex items-center gap-1.5">
                          {active && <Check className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden />}
                          {s.title}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1.5 flex-wrap">
                          <span className="inline-flex items-center gap-0.5">
                            <Users className="h-3 w-3" aria-hidden />
                            {s.classroom ? s.classroom.name : "عمومی مدرسه"}
                          </span>
                          <span aria-hidden>·</span>
                          <span>{faNum(s.chunkCount)} قطعه</span>
                        </p>
                      </div>
                      {s.subject && (
                        <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold", subjectTone(s.id))}>
                          {s.subject}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
            {selected.size > 0 && (
              <Button
                variant="ghost" size="sm" className="mt-2.5 h-8 text-[11px] text-muted-foreground"
                onClick={() => setSelected(new Set())}
              >
                پاک‌کردن انتخاب ({faNum(selected.size)} منبع)
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Ask box */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <MessageCircleQuestion className="h-4 w-4 text-primary" aria-hidden /> پرسش خود را بنویسید
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            dir="auto"
            rows={3}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="مثلاً: تعریف شتاب در حرکت‌شناسی چیست و چه فرقی با سرعت دارد؟"
            maxLength={1000}
          />
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-[10px] text-muted-foreground tabular-nums">
              {faNum(question.length)} / {faNum(1000)}
            </p>
            <Button onClick={() => void ask()} disabled={busy || question.trim().length < 3}>
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin ml-1.5" aria-hidden />
              ) : (
                <Send className="h-4 w-4 ml-1.5" aria-hidden />
              )}
              {busy ? "در حال جست‌وجوی منابع…" : "از منابع بپرس"}
            </Button>
          </div>
          {error && <ErrorState message={error} />}
          {blocked && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
              <Lock className="h-4 w-4 shrink-0" aria-hidden /> {blocked}
            </div>
          )}
          {unavailable && (
            <div className="rounded-xl border border-sky-500/40 bg-sky-500/10 p-3 flex items-start gap-2 text-xs text-sky-700 dark:text-sky-300">
              <Info className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
              <span>{unavailable}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Answer */}
      <div ref={answerRef}>
        {busy && (
          <Card className="border-border/60">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                بازیابی قطعه‌های مرتبط و ساخت پاسخ مستند…
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
            </CardContent>
          </Card>
        )}
        {answer && !busy && <AnswerCard res={answer} question={asked} />}
      </div>

      {/* History */}
      {history.length > 0 && (
        <Collapsible>
          <Card className="border-border/60">
            <CollapsibleTrigger className="w-full flex items-center justify-between p-3 text-xs font-bold hover:bg-muted/40 transition-colors rounded-xl">
              <span className="flex items-center gap-1.5">
                <Info className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                پرسش‌های این نشست ({faNum(history.length)})
              </span>
              <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0 space-y-2 max-h-64 overflow-y-auto">
                {history.map((h, i) => (
                  <div key={i} className="rounded-lg border border-border/60 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-bold truncate">{h.question}</p>
                      <span className="text-[9px] text-muted-foreground shrink-0 tabular-nums">
                        {faDateTime(h.at)}
                      </span>
                    </div>
                    <p className={cn("text-[10px] mt-1 leading-5 line-clamp-2", h.res.foundInSources ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400")}>
                      {h.res.foundInSources ? h.res.answer.slice(0, 140) : "پاسخ در منابع موجود نبود."}
                    </p>
                  </div>
                ))}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}
    </div>
  );
}

function AnswerCard({ res, question }: { res: AskResponse; question: string | null }) {
  const questionBlock = question ? (
    <div className="rounded-xl bg-primary/5 border border-primary/20 px-3.5 py-2.5 flex items-start gap-2.5">
      <MessageCircleQuestion className="h-4 w-4 text-primary shrink-0 mt-1" aria-hidden />
      <div className="min-w-0">
        <p className="text-[10px] font-bold text-primary/80">پرسش شما</p>
        <p className="text-xs font-medium leading-6 mt-0.5" dir="auto">{question}</p>
      </div>
    </div>
  ) : null;

  if (!res.foundInSources) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-4 space-y-3">
          {questionBlock}
          <div className="rounded-xl bg-muted/50 border border-dashed p-4 flex items-start gap-3">
            <Info className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" aria-hidden />
            <div className="text-sm min-w-0">
              <p className="font-bold">پاسخ این پرسش در منابع موجود نیست</p>
              <p className="text-xs text-muted-foreground mt-1.5 leading-6">
                نگهبان منبع قطعهٔ مرتبطی پیدا نکرد و به‌جای حدس‌زدن، صادقانه پاسخ نداد. پرسش را با
                کلمات نزدیک‌تر به متن جزوه‌ها دوباره بپرسید.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <ShieldCheck className="h-4.5 w-4.5 text-emerald-600" aria-hidden /> پاسخ مستند از منابع
          {res.usedChunks > 0 && (
            <Badge variant="secondary" className="text-[10px] tabular-nums">
              بر پایهٔ {faNum(res.usedChunks)} قطعه از {faNum(res.usedSourceCount)} منبع
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          شماره‌های داخل کروشه به منابع استنادشده در پایین پاسخ ارجاع می‌دهند.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {questionBlock}
        <div className="text-sm leading-7 space-y-2" dir="auto">
          {res.answer
            .split(/\n+/)
            .map((p) => p.trim())
            .filter(Boolean)
            .map((p, i) => (
              <p key={i}>{p}</p>
            ))}
        </div>

        {res.sources.length > 0 && (
          <div className="space-y-2 pt-1 border-t border-border/60">
            <p className="text-xs font-bold flex items-center gap-1.5 pt-2">
              <BookMarked className="h-3.5 w-3.5 text-primary" aria-hidden /> منابع استنادشده
            </p>
            <div className="flex flex-wrap gap-1.5">
              {res.sources.map((s, i) => (
                <Badge
                  key={`${s.sourceId}-${i}`}
                  className="gap-1 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 transition-colors text-[10px]"
                >
                  <BookMarked className="h-3 w-3" aria-hidden />
                  [{s.title} — قطعهٔ {faNum(s.chunkPosition + 1)}]
                </Badge>
              ))}
            </div>
            {res.sources.map((s, i) => (
              <blockquote
                key={`snip-${s.sourceId}-${i}`}
                className="border-r-4 border-primary/40 pr-3 rounded-sm bg-muted/40 py-2"
              >
                <p className="text-[10px] text-muted-foreground mb-1">
                  {s.title} — قطعهٔ {faNum(s.chunkPosition + 1)}
                </p>
                <p className="text-xs leading-6 text-muted-foreground" dir="auto">
                  {s.snippet}
                </p>
              </blockquote>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
