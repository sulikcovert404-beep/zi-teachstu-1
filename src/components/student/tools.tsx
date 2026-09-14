"use client";

import { useState } from "react";
import { api, ApiClientError } from "@/lib/app/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { EmptyState, ErrorState, faDate } from "@/components/shared/blocks";
import { cn } from "@/lib/utils";
import {
  FileText, Sparkles, Loader2, Layers, CalendarDays, Trash2, ChevronLeft, ChevronRight,
  Lock, Wand2, Save,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ── Summarizer (spec §11.2) ──
export function SummarizerTool() {
  const [text, setText] = useState("");
  const [mode, setMode] = useState("KEYPOINTS");
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);

  async function run() {
    if (text.trim().length < 40) {
      setError("متن باید حداقل ۴۰ کاراکتر باشد.");
      return;
    }
    setBusy(true); setError(null); setBlocked(null); setSummary(null);
    try {
      const res = await api<{ summary: string }>("/api/v1/student/summarize", {
        method: "POST",
        body: JSON.stringify({ text, mode }),
      });
      setSummary(res.summary);
    } catch (e) {
      if (e instanceof ApiClientError && (e.status === 429 || e.code === "FORBIDDEN")) setBlocked(e.message);
      else setError(e instanceof ApiClientError ? e.message : "خلاصه‌سازی ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4.5 w-4.5 text-primary" aria-hidden /> متن ورودی
          </CardTitle>
          <CardDescription>متن درس یا جزوه را قرار دهید تا خلاصه شود.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea dir="auto" rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder="متن آموزشی را اینجا بچسبانید… (حداقل ۴۰ کاراکتر)" />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">نوع خلاصه</Label>
              <Select value={mode} onValueChange={setMode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="SHORT">خلاصه کوتاه</SelectItem>
                  <SelectItem value="FULL">خلاصه کامل</SelectItem>
                  <SelectItem value="KEYPOINTS">نکات کلیدی</SelectItem>
                  <SelectItem value="EXAM">نکات امتحانی</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button className="w-full" onClick={() => void run()} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin ml-1.5" aria-hidden /> : <Sparkles className="h-4 w-4 ml-1.5" aria-hidden />}
                {busy ? "در حال خلاصه‌سازی…" : "خلاصه کن"}
              </Button>
            </div>
          </div>
          {error && <ErrorState message={error} />}
          {blocked && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
              <Lock className="h-4 w-4 shrink-0" aria-hidden /> {blocked}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base">خروجی</CardTitle>
          <CardDescription>نتیجهٔ خلاصه‌سازی اینجا نمایش داده می‌شود.</CardDescription>
        </CardHeader>
        <CardContent>
          {summary === null ? (
            <EmptyState icon={Sparkles} title="هنوز خلاصه‌ای تولید نشده است" description="متن را وارد کرده و دکمهٔ «خلاصه کن» را بزنید." />
          ) : (
            <div className="rounded-xl bg-muted p-4 text-sm leading-8 whitespace-pre-wrap max-h-[420px] overflow-y-auto">{summary}</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Flashcards (spec §11.8) ──
interface Deck { id: string; title: string; topic: string | null; createdAt: string; cards: Array<{ id: string; front: string; back: string; position: number }> }

export function FlashcardsTool() {
  const { toast } = useToast();
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [reviewDeck, setReviewDeck] = useState<Deck | null>(null);
  const [cardIndex, setCardIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);

  async function load() {
    try {
      const res = await api<{ decks: Deck[] }>("/api/v1/student/flashcards");
      setDecks(res.decks);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "بارگذاری فلش‌کارت‌ها ناموفق بود.");
      setDecks([]);
    }
  }

  async function generate() {
    if (text.trim().length < 40) {
      setError("متن باید حداقل ۴۰ کاراکتر باشد.");
      return;
    }
    setBusy(true); setError(null); setBlocked(null);
    try {
      const res = await api<{ cards: Array<{ front: string; back: string }>; deckId: string | null }>("/api/v1/student/flashcards/generate", {
        method: "POST",
        body: JSON.stringify({ text, title: title || undefined, save: true }),
      });
      toast({ title: "فلش‌کارت ساخته شد", description: `${res.cards.length} کارت ذخیره شد.` });
      setText(""); setTitle("");
      await load();
    } catch (e) {
      if (e instanceof ApiClientError && (e.status === 429 || e.code === "FORBIDDEN")) setBlocked(e.message);
      else setError(e instanceof ApiClientError ? e.message : "ساخت فلش‌کارت ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(deckId: string) {
    try {
      await api(`/api/v1/student/flashcards/${deckId}`, { method: "DELETE" });
      await load();
    } catch {
      toast({ title: "حذف ناموفق بود", variant: "destructive" });
    }
  }

  if (decks === null && !error) {
    void load();
    return <p className="text-sm text-muted-foreground p-4">در حال بارگذاری…</p>;
  }

  const card = reviewDeck?.cards[cardIndex];

  return (
    <div className="space-y-4">
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Wand2 className="h-4.5 w-4.5 text-primary" aria-hidden /> ساخت فلش‌کارت از متن
          </CardTitle>
          <CardDescription>متن درس را بدهید؛ هوش مصنوعی کارت‌های مرور می‌سازد و ذخیره می‌کند.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-[1fr_220px_auto] gap-3 items-end">
            <div className="space-y-1.5">
              <Label className="text-xs">عنوان دسته</Label>
              <Input dir="auto" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثلاً: لغات فصل ۲" />
            </div>
            <div className="space-y-1.5 md:col-span-2" />
          </div>
          <Textarea dir="auto" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="متن آموزشی… (حداقل ۴۰ کاراکتر)" />
          <div className="flex items-center gap-3">
            <Button onClick={() => void generate()} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin ml-1.5" aria-hidden /> : <Layers className="h-4 w-4 ml-1.5" aria-hidden />}
              {busy ? "در حال ساخت…" : "ساخت فلش‌کارت"}
            </Button>
          </div>
          {error && <ErrorState message={error} />}
          {blocked && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
              <Lock className="h-4 w-4 shrink-0" aria-hidden /> {blocked}
            </div>
          )}
        </CardContent>
      </Card>

      {decks && decks.length > 0 && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {decks.map((d) => (
            <Card key={d.id} className="border-border/60">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-sm truncate">{d.title}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {d.cards.length} کارت · {faDate(d.createdAt)}
                    </p>
                  </div>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => void remove(d.id)} aria-label="حذف">
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </div>
                <Button size="sm" variant="outline" className="mt-3 w-full" onClick={() => { setReviewDeck(d); setCardIndex(0); setFlipped(false); }}>
                  مرور کارت‌ها
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {decks && decks.length === 0 && !busy && (
        <EmptyState icon={Layers} title="هنوز فلش‌کارتی نساخته‌اید" description="از متن درس، اولین دسته فلش‌کارت خود را بسازید." />
      )}

      {/* Review modal-lite */}
      {reviewDeck && card && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <Card className="w-full max-w-lg">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <Badge variant="secondary">{reviewDeck.title}</Badge>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {cardIndex + 1} / {reviewDeck.cards.length}
                </span>
              </div>
              <Progress value={((cardIndex + 1) / reviewDeck.cards.length) * 100} className="h-1.5" />
              <button
                className="w-full min-h-44 rounded-xl bg-muted hover:bg-muted/70 transition-colors p-6 text-center flex items-center justify-center"
                onClick={() => setFlipped((f) => !f)}
              >
                <div className={cn("text-base font-bold leading-9 transition-all", flipped ? "text-primary" : "")}>
                  {flipped ? card.back : card.front}
                  <p className="text-[10px] text-muted-foreground mt-3 font-normal">برای {flipped ? "پرسش" : "پاسخ"} کلیک کنید</p>
                </div>
              </button>
              <div className="flex items-center justify-between">
                <Button variant="outline" disabled={cardIndex === 0} onClick={() => { setCardIndex((i) => i - 1); setFlipped(false); }}>
                  <ChevronRight className="h-4 w-4 ml-1" aria-hidden /> قبلی
                </Button>
                <Button variant="ghost" onClick={() => setReviewDeck(null)}>بستن</Button>
                <Button
                  disabled={cardIndex === reviewDeck.cards.length - 1}
                  onClick={() => { setCardIndex((i) => i + 1); setFlipped(false); }}
                >
                  بعدی <ChevronLeft className="h-4 w-4 mr-1" aria-hidden />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// ── Study Planner (spec §11.9) ──
export function StudyPlannerTool() {
  const [plan, setPlan] = useState<any | null | undefined>(undefined); // undefined = loading, null = none
  const [goal, setGoal] = useState("");
  const [examDate, setExamDate] = useState("");
  const [hours, setHours] = useState("2");
  const [subjects, setSubjects] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);

  async function load() {
    try {
      const res = await api<{ plan: any | null }>("/api/v1/student/study-plan");
      setPlan(res.plan);
      if (res.plan) {
        setGoal(res.plan.goal ?? "");
        setHours(String(res.plan.availableHoursDay ?? 2));
      }
    } catch {
      setPlan(null);
    }
  }

  if (plan === undefined) {
    void load();
    return <p className="text-sm text-muted-foreground p-4">در حال بارگذاری…</p>;
  }

  async function generate() {
    setBusy(true); setError(null); setBlocked(null);
    try {
      const res = await api<{ plan: any }>("/api/v1/student/study-plan", {
        method: "POST",
        body: JSON.stringify({ goal, examDate: examDate || null, availableHoursDay: Number(hours) || 2, subjects }),
      });
      setPlan(res.plan);
    } catch (e) {
      if (e instanceof ApiClientError && (e.status === 429 || e.code === "FORBIDDEN")) setBlocked(e.message);
      else setError(e instanceof ApiClientError ? e.message : "ساخت برنامه ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }

  const days: any[] = Array.isArray(plan?.days) ? plan.days : [];
  const milestones: any[] = Array.isArray(plan?.milestones) ? plan.milestones : [];

  return (
    <div className="space-y-4">
      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarDays className="h-4.5 w-4.5 text-primary" aria-hidden /> برنامه‌ریز مطالعه
          </CardTitle>
          <CardDescription>هدف و زمان آزاد خود را بدهید؛ برنامهٔ ۱۴ روزه با مرورهای دوره‌ای می‌سازیم.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">هدف مطالعه</Label>
              <Input dir="auto" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="مثلاً: آمادگی امتحان ریاضی فصل ۲ و ۳" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">تاریخ آزمون (اختیاری)</Label>
              <Input type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">ساعت آزاد روزانه</Label>
              <Input type="number" min={1} max={12} value={hours} onChange={(e) => setHours(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">درس‌ها / منابع</Label>
              <Input dir="auto" value={subjects} onChange={(e) => setSubjects(e.target.value)} placeholder="مثلاً: ریاضی، فیزیک" />
            </div>
          </div>
          <Button onClick={() => void generate()} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin ml-1.5" aria-hidden /> : <Save className="h-4 w-4 ml-1.5" aria-hidden />}
            {plan ? "به‌روزرسانی برنامه" : "ساخت برنامه"}
          </Button>
          {error && <ErrorState message={error} />}
          {blocked && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
              <Lock className="h-4 w-4 shrink-0" aria-hidden /> {blocked}
            </div>
          )}
        </CardContent>
      </Card>

      {plan === null && (
        <EmptyState icon={CalendarDays} title="هنوز برنامه‌ای ندارید" description="فرم بالا را پر کنید تا برنامهٔ مطالعهٔ شخصی‌سازی‌شده ساخته شود." />
      )}

      {plan && (
        <Tabs defaultValue="days">
          <TabsList>
            <TabsTrigger value="days">برنامهٔ روزانه</TabsTrigger>
            <TabsTrigger value="milestones">نقاط عطف</TabsTrigger>
            {plan.advice && <TabsTrigger value="advice">توصیه</TabsTrigger>}
          </TabsList>
          <TabsContent value="days" className="mt-3">
            {days.length === 0 ? (
              <EmptyState title="جزئیات روزانه در برنامه موجود نیست" />
            ) : (
              <div className="grid sm:grid-cols-2 gap-3">
                {days.map((d: any, i: number) => (
                  <Card key={i} className="border-border/60">
                    <CardContent className="p-3.5">
                      <p className="text-xs font-bold tabular-nums" dir="ltr">{d.date}</p>
                      <div className="mt-2 space-y-1.5">
                        {(d.sessions ?? []).map((s: any, j: number) => (
                          <div key={j} className="flex items-center gap-2 text-xs">
                            <Badge variant={s.type === "review" ? "secondary" : s.type === "practice" ? "outline" : "default"} className="text-[10px] shrink-0">
                              {s.type === "review" ? "مرور" : s.type === "practice" ? "تمرین" : "مطالعه"}
                            </Badge>
                            <span className="truncate flex-1">{s.topic}</span>
                            <span className="text-muted-foreground tabular-nums shrink-0">{s.minutes}′</span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
          <TabsContent value="milestones" className="mt-3">
            {milestones.length === 0 ? (
              <EmptyState title="نقطهٔ عطفی ثبت نشده است" />
            ) : (
              <div className="space-y-2">
                {milestones.map((m: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 rounded-lg border border-border/60 p-3 text-sm">
                    <Badge variant="outline" className="tabular-nums shrink-0" dir="ltr">{m.date}</Badge>
                    <span>{m.title}</span>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
          {plan.advice && (
            <TabsContent value="advice" className="mt-3">
              <div className="rounded-xl bg-muted p-4 text-sm leading-8">{plan.advice}</div>
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}
