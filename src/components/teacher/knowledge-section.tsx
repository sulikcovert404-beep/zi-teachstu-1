"use client";

import { useCallback, useEffect, useState, type ChangeEvent } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorState, faDateTime, faNum } from "@/components/shared/blocks";
import { useToast } from "@/hooks/use-toast";
import {
  BookMarked,
  ChevronDown,
  Eye,
  FileText,
  Gauge,
  GraduationCap,
  History,
  Info,
  Layers,
  Library,
  Loader2,
  MessageCircleQuestion,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { PaywallNotice, isPaywallError } from "./shared";
import type { TeacherClass } from "./types";

// ── Knowledge Base (Milestone D — spec §12/§11.13/§99) ──
// Ingest (paste / TXT) → chunking → BM25 retrieval → Source Guardian answer + citations.

const MIN_CONTENT = 200;
const MAX_CONTENT = 100_000;
const MAX_FILE_BYTES = 500 * 1024;

interface KnowledgeSourceRow {
  id: string;
  title: string;
  description: string | null;
  subject: string | null;
  status: string;
  sourceType: string;
  charCount: number;
  chunkCount: number;
  classroom: { id: string; name: string } | null;
  creator: string;
  createdAt: string;
}

interface QuotaInfo {
  planCode: string;
  planName: string;
  dailyLimit: number;
  usedToday: number;
  remaining: number;
  allowed: boolean;
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
  quota: QuotaInfo;
}

interface SourceDetailResponse {
  source: KnowledgeSourceRow;
  chunks: Array<{ position: number; approxTokens: number; content: string }>;
  remainingChunks: number;
}

// rotating subject tones (emerald / amber / rose / teal — never indigo/blue)
const SUBJECT_TONES = [
  "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400",
  "border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-400",
];

function toneFor(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return hash % SUBJECT_TONES.length;
}

export function KnowledgeSection() {
  const [tab, setTab] = useState("manage");
  const [sources, setSources] = useState<KnowledgeSourceRow[] | null>(null);
  const [classes, setClasses] = useState<TeacherClass[]>([]);
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [quotaKey, setQuotaKey] = useState(0);

  useEffect(() => {
    let ignore = false;
    async function start() {
      try {
        const [srcRes, clsRes] = await Promise.all([
          api<{ sources: KnowledgeSourceRow[] }>("/api/v1/teacher/knowledge/sources"),
          api<{ classes: TeacherClass[] }>("/api/v1/teacher/classes"),
        ]);
        if (!ignore) {
          setSources(srcRes.sources);
          setClasses(clsRes.classes);
          setError(null);
        }
      } catch (e) {
        if (!ignore)
          setError(e instanceof ApiClientError ? e.message : "بارگذاری دانش‌نامه ناموفق بود.");
      }
    }
    void start();
    return () => {
      ignore = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    let ignore = false;
    async function start() {
      try {
        const res = await api<{ quota: QuotaInfo }>("/api/v1/teacher/knowledge/quota");
        if (!ignore) setQuota(res.quota);
      } catch {
        // quota display is non-critical — ignore failures
      }
    }
    void start();
    return () => {
      ignore = true;
    };
  }, [quotaKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  const reloadQuota = useCallback(() => setQuotaKey((k) => k + 1), []);

  const totalChunks = sources?.reduce((s, x) => s + x.chunkCount, 0) ?? 0;
  const totalChars = sources?.reduce((s, x) => s + x.charCount, 0) ?? 0;

  return (
    <div className="space-y-4">
      {/* gradient header */}
      <div className="rounded-2xl border border-border/60 bg-gradient-to-l from-primary/10 via-emerald-500/10 to-transparent p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Library className="h-5.5 w-5.5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-extrabold text-base">دانش‌نامه و نگهبان منبع</h3>
            <p className="text-xs text-muted-foreground leading-6 mt-1">
              متن‌های درسی را در دانش‌نامهٔ سازمان ذخیره کنید و فقط بر پایهٔ همان منابع پاسخ مستند
              بگیرید؛ هر ادعا با شمارهٔ منبع [۱] استناد می‌شود.
            </p>
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              <Badge variant="secondary" className="text-[10px] tabular-nums gap-1">
                <BookMarked className="h-3 w-3" aria-hidden /> {faNum(sources?.length ?? 0)} منبع
              </Badge>
              <Badge variant="secondary" className="text-[10px] tabular-nums gap-1">
                <Layers className="h-3 w-3" aria-hidden /> {faNum(totalChunks)} قطعه
              </Badge>
              <Badge variant="secondary" className="text-[10px] tabular-nums gap-1">
                <FileText className="h-3 w-3" aria-hidden /> {faNum(totalChars)} حرف
              </Badge>
            </div>
          </div>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid grid-cols-2 w-full sm:w-auto">
          <TabsTrigger value="manage" className="gap-1.5 min-h-11">
            <Library className="h-4 w-4" aria-hidden /> مدیریت منابع
          </TabsTrigger>
          <TabsTrigger value="ask" className="gap-1.5 min-h-11">
            <ShieldCheck className="h-4 w-4" aria-hidden /> پرسش از منابع
          </TabsTrigger>
        </TabsList>

        <TabsContent value="manage" className="mt-4 space-y-4">
          {error && (
            <ErrorState message={error} onRetry={() => void reload()} />
          )}
          {!sources && !error && <SourcesSkeleton />}

          {sources && (
            <>
              <AddSourceCard classes={classes} onCreated={reload} />
              <SourcesList sources={sources} onChanged={reload} />
            </>
          )}
        </TabsContent>

        <TabsContent value="ask" className="mt-4 space-y-4">
          {error && <ErrorState message={error} onRetry={() => void reload()} />}
          {!sources && !error && <SourcesSkeleton />}

          {sources && (
            <AskCard
              sources={sources}
              quota={quota}
              onQuotaRefresh={reloadQuota}
              onManage={() => setTab("manage")}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Ingest form (paste-first + optional TXT upload) ──

function AddSourceCard({ classes, onCreated }: { classes: TeacherClass[]; onCreated: () => void }) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [classroomId, setClassroomId] = useState("ALL");
  const [content, setContent] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".txt") && file.type !== "text/plain") {
      toast({ title: "فقط فایل متنی TXT پشتیبانی می‌شود.", variant: "destructive" });
      e.target.value = "";
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast({
        title: "حجم فایل بیش از ۵۰۰ کیلوبایت است.",
        description: "بخش کوچک‌تری از متن را بارگذاری کنید یا محتوا را مستقیم بچسبانید.",
        variant: "destructive",
      });
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      if (text.trim().length < MIN_CONTENT) {
        toast({
          title: `متن فایل باید حداقل ${faNum(MIN_CONTENT)} نویسه باشد.`,
          variant: "destructive",
        });
        return;
      }
      if (text.length > MAX_CONTENT) {
        toast({
          title: `متن فایل بیش از ${faNum(MAX_CONTENT)} نویسه است.`,
          description: "فایل را به چند منبع کوچک‌تر تقسیم کنید.",
          variant: "destructive",
        });
        return;
      }
      setContent(text);
      setFileName(file.name);
      toast({ title: "فایل خوانده شد", description: "محتوای فایل در کادر متن قرار گرفت و قابل ویرایش است." });
    };
    reader.onerror = () => {
      toast({ title: "خواندن فایل ناموفق بود.", variant: "destructive" });
    };
    reader.readAsText(file);
  }

  async function submit() {
    if (busy) return;
    const t = title.trim();
    if (t.length < 2 || t.length > 120) {
      toast({ title: "عنوان منبع باید بین ۲ تا ۱۲۰ نویسه باشد.", variant: "destructive" });
      return;
    }
    if (content.trim().length < MIN_CONTENT) {
      toast({
        title: `متن منبع باید حداقل ${faNum(MIN_CONTENT)} نویسه باشد.`,
        description: `اکنون ${faNum(content.trim().length)} نویسه وارد شده است.`,
        variant: "destructive",
      });
      return;
    }
    if (content.length > MAX_CONTENT) {
      toast({ title: `متن منبع حداکثر ${faNum(MAX_CONTENT)} نویسه است.`, variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ source: { id: string; title: string; chunkCount: number } }>(
        "/api/v1/teacher/knowledge/sources",
        {
          method: "POST",
          body: JSON.stringify({
            title: t,
            description: description.trim() || undefined,
            subject: subject.trim() || undefined,
            classroomId: classroomId === "ALL" ? undefined : classroomId,
            content,
          }),
        }
      );
      toast({
        title: "منبع با موفقیت ثبت شد",
        description: `«${res.source.title}» در ${faNum(res.source.chunkCount)} قطعه ذخیره شد.`,
      });
      setTitle("");
      setSubject("");
      setDescription("");
      setContent("");
      setFileName(null);
      setClassroomId("ALL");
      onCreated();
    } catch (e) {
      toast({
        title: "ثبت منبع ناموفق بود",
        description: e instanceof ApiClientError ? e.message : "خطای غیرمنتظره‌ای رخ داد.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  const len = content.length;
  const counterTone =
    len === 0
      ? "text-muted-foreground"
      : len < MIN_CONTENT
        ? "text-amber-600 dark:text-amber-400"
        : len > MAX_CONTENT * 0.95
          ? "text-rose-600 dark:text-rose-400"
          : "text-emerald-600 dark:text-emerald-400";

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Plus className="h-4.5 w-4.5 text-primary" aria-hidden /> افزودن منبع
        </CardTitle>
        <CardDescription>
          متن جزوه یا کتاب را بچسبانید (یا فایل TXT بارگذاری کنید). متن به‌صورت خودکار قطعه‌بندی و
          برای پرسش‌های آینده آماده می‌شود.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="kn-title" className="text-xs">عنوان منبع *</Label>
            <Input
              id="kn-title"
              dir="auto"
              className="h-11"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثلاً: جزوهٔ فیزیک — حرکت‌شناسی"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kn-subject" className="text-xs">درس (اختیاری)</Label>
            <Input
              id="kn-subject"
              dir="auto"
              className="h-11"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="مثلاً: فیزیک"
            />
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">کلاس (اختیاری)</Label>
            <Select value={classroomId} onValueChange={setClassroomId}>
              <SelectTrigger className="w-full h-11">
                <SelectValue placeholder="محدودهٔ کلاس" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">
                  <span className="flex items-center gap-1.5">
                    <GraduationCap className="h-3.5 w-3.5" aria-hidden /> بدون محدودیت کلاس
                  </span>
                </SelectItem>
                {classes.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} — پایه {c.grade}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kn-desc" className="text-xs">توضیحات (اختیاری)</Label>
            <Input
              id="kn-desc"
              dir="auto"
              className="h-11"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="توضیح کوتاه محتوای منبع…"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <Label htmlFor="kn-content" className="text-xs">متن منبع *</Label>
            <span className={`text-[11px] tabular-nums ${counterTone}`} aria-live="polite">
              {faNum(len)} / {faNum(MAX_CONTENT)} نویسه
              {len > 0 && len < MIN_CONTENT && ` (حداقل ${faNum(MIN_CONTENT)})`}
            </span>
          </div>
          <Textarea
            id="kn-content"
            dir="auto"
            rows={9}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="متن آموزشی منبع را اینجا بچسبانید… حداقل ۲۰۰ نویسه. برای فایل‌های Word محتوای آن را کپی و اینجا بچسبانید."
            aria-label="متن منبع"
          />
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 min-h-11">
              <label
                className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 h-11 text-xs cursor-pointer hover:bg-muted/60 transition-colors"
                aria-label="بارگذاری فایل متنی TXT"
              >
                <Upload className="h-4 w-4 text-primary" aria-hidden />
                بارگذاری فایل TXT
                <input
                  type="file"
                  accept=".txt,text/plain"
                  className="sr-only"
                  onChange={onFile}
                />
              </label>
              {fileName && (
                <Badge variant="outline" className="text-[10px] gap-1 max-w-48">
                  <FileText className="h-3 w-3 shrink-0" aria-hidden />
                  <span className="truncate">{fileName}</span>
                </Badge>
              )}
            </div>
            <Button className="h-11 px-6" onClick={() => void submit()} disabled={busy}>
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin ml-1.5" aria-hidden />
              ) : (
                <BookMarked className="h-4 w-4 ml-1.5" aria-hidden />
              )}
              {busy ? "در حال ثبت…" : "ثبت منبع"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Sources list (scrollable, sticky header) ──

function SourcesList({
  sources,
  onChanged,
}: {
  sources: KnowledgeSourceRow[];
  onChanged: () => void;
}) {
  const [detailId, setDetailId] = useState<string | null>(null);

  if (sources.length === 0) {
    return (
      <EmptyState
        icon={BookMarked}
        title="هنوز منبعی ثبت نشده است"
        description="اولین جزوه یا متن درسی خود را با فرم «افزودن منبع» ثبت کنید تا نگهبان منبع بتواند بر پایهٔ آن پاسخ مستند بدهد."
      />
    );
  }

  return (
    <div className="rounded-xl border border-border/60 overflow-hidden bg-card">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border/60 px-4 py-2.5 flex items-center justify-between gap-2">
        <span className="text-xs font-bold flex items-center gap-1.5">
          <Library className="h-3.5 w-3.5 text-primary" aria-hidden /> منابع دانش‌نامه
        </span>
        <Badge variant="secondary" className="text-[10px] tabular-nums">
          {faNum(sources.length)} منبع
        </Badge>
      </div>
      <div className="max-h-96 overflow-y-auto p-3 space-y-3 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border">
        {sources.map((s) => (
          <SourceCard key={s.id} source={s} onDeleted={onChanged} onView={() => setDetailId(s.id)} />
        ))}
      </div>

      {detailId && (
        <SourceDetailDialog sourceId={detailId} onClose={() => setDetailId(null)} />
      )}
    </div>
  );
}

function SourceCard({
  source,
  onDeleted,
  onView,
}: {
  source: KnowledgeSourceRow;
  onDeleted: () => void;
  onView: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function doDelete() {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/api/v1/teacher/knowledge/sources/${source.id}`, { method: "DELETE" });
      toast({ title: "منبع حذف شد", description: `«${source.title}» و همهٔ قطعات آن حذف شد.` });
      onDeleted();
    } catch (e) {
      toast({
        title: "حذف منبع ناموفق بود",
        description: e instanceof ApiClientError ? e.message : "خطای غیرمنتظره‌ای رخ داد.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-border/60 hover:border-primary/40 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-emerald-500/15 to-teal-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <BookMarked className="h-5.5 w-5.5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <p className="font-bold text-sm leading-6 min-w-0">{source.title}</p>
              <div className="flex items-center gap-1.5 flex-wrap">
                {source.subject && (
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${SUBJECT_TONES[toneFor(source.subject)]}`}
                  >
                    {source.subject}
                  </Badge>
                )}
                <Badge variant="secondary" className="text-[10px]">
                  {source.status === "READY" ? "آماده" : source.status}
                </Badge>
              </div>
            </div>
            {source.description && (
              <p className="text-xs text-muted-foreground leading-6 line-clamp-2 mt-1">
                {source.description}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2 text-[11px] text-muted-foreground">
              <span className="tabular-nums inline-flex items-center gap-1">
                <FileText className="h-3 w-3" aria-hidden /> {faNum(source.charCount)} حرف
              </span>
              <span className="tabular-nums inline-flex items-center gap-1">
                <Layers className="h-3 w-3" aria-hidden /> {faNum(source.chunkCount)} قطعه
              </span>
              {source.classroom && (
                <span className="inline-flex items-center gap-1">
                  <GraduationCap className="h-3 w-3" aria-hidden /> {source.classroom.name}
                </span>
              )}
              <span className="tabular-nums">{faDateTime(source.createdAt)}</span>
              <span className="opacity-70">ثبت: {source.creator}</span>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-1.5 shrink-0">
            <Button
              variant="outline"
              size="sm"
              className="h-10 gap-1"
              onClick={onView}
              aria-label={`مشاهدهٔ قطعات ${source.title}`}
            >
              <Eye className="h-4 w-4" aria-hidden /> مشاهده
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-10 gap-1 text-destructive hover:text-destructive hover:bg-destructive/10"
                  disabled={busy}
                  aria-label={`حذف ${source.title}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden /> حذف
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>حذف منبع؟</AlertDialogTitle>
                  <AlertDialogDescription>
                    «{source.title}» و {faNum(source.chunkCount)} قطعهٔ آن نیز حذف می‌شود. این عمل
                    قابل بازگشت نیست.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>انصراف</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-white hover:bg-destructive/90"
                    onClick={() => void doDelete()}
                  >
                    حذف قطعی
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Source detail dialog (first chunks preview) ──

function SourceDetailDialog({ sourceId, onClose }: { sourceId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<SourceDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    async function start() {
      try {
        const res = await api<SourceDetailResponse>(
          `/api/v1/teacher/knowledge/sources/${sourceId}`
        );
        if (!ignore) {
          setDetail(res);
          setError(null);
        }
      } catch (e) {
        if (!ignore)
          setError(e instanceof ApiClientError ? e.message : "بارگذاری منبع ناموفق بود.");
      }
    }
    void start();
    return () => {
      ignore = true;
    };
  }, [sourceId]);

  const s = detail?.source;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-1">
            <BookMarked className="h-5 w-5 text-primary shrink-0" aria-hidden />
            <span className="truncate">{s?.title ?? "منبع دانش‌نامه"}</span>
          </DialogTitle>
          <DialogDescription>
            {s
              ? `${s.subject ? `${s.subject} · ` : ""}${faNum(s.charCount)} حرف · ${faNum(s.chunkCount)} قطعه${s.classroom ? ` · کلاس ${s.classroom.name}` : ""}`
              : "جزئیات منبع"}
          </DialogDescription>
        </DialogHeader>

        {error && <ErrorState message={error} />}
        {!detail && !error && (
          <div className="space-y-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        )}

        {detail && (
          <div className="space-y-3">
            {detail.source.description && (
              <p className="text-xs text-muted-foreground leading-6">
                {detail.source.description}
              </p>
            )}
            {detail.chunks.map((c) => (
              <div key={c.position} className="border-r-4 border-primary/40 pr-3 rounded-sm">
                <p className="text-[10px] text-muted-foreground tabular-nums mb-1">
                  قطعهٔ {faNum(c.position + 1)} — حدود {faNum(c.approxTokens)} توکن
                </p>
                <p className="text-xs leading-6 text-foreground/90 whitespace-pre-wrap">
                  {c.content}
                </p>
              </div>
            ))}
            {detail.remainingChunks > 0 && (
              <p className="text-[11px] text-muted-foreground text-center">
                و {faNum(detail.remainingChunks)} قطعهٔ دیگر…
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Source Guardian ask card ──

interface HistoryItem {
  question: string;
  res: AskResponse;
  at: string;
}

function AskCard({
  sources,
  quota,
  onQuotaRefresh,
  onManage,
}: {
  sources: KnowledgeSourceRow[];
  quota: QuotaInfo | null;
  onQuotaRefresh: () => void;
  onManage: () => void;
}) {
  const { toast } = useToast();
  const [question, setQuestion] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [answer, setAnswer] = useState<AskResponse | null>(null);
  const [askedQuestion, setAskedQuestion] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function ask() {
    if (busy) return;
    const q = question.trim();
    if (q.length < 3) {
      setError("پرسش را کامل‌تر بنویسید (حداقل ۳ نویسه).");
      return;
    }
    setBusy(true);
    setError(null);
    setBlocked(null);
    setAnswer(null);
    try {
      const res = await api<AskResponse>("/api/v1/teacher/knowledge/ask", {
        method: "POST",
        body: JSON.stringify({
          question: q,
          sourceIds: selected.size > 0 ? [...selected] : undefined,
        }),
      });
      setAnswer(res);
      setAskedQuestion(q);
      setHistory((h) =>
        [{ question: q, res, at: new Date().toISOString() }, ...h].slice(0, 8)
      );
      onQuotaRefresh();
    } catch (e) {
      if (isPaywallError(e)) {
        setBlocked(e instanceof ApiClientError ? e.message : "سهمیهٔ امروز شما به پایان رسیده است.");
      } else {
        setError(e instanceof ApiClientError ? e.message : "پرسش از منابع ناموفق بود.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (sources.length === 0) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="برای پرسش از منابع، ابتدا منبعی ثبت کنید"
        description="نگهبان منبع فقط بر پایهٔ متن منابع ثبت‌شده پاسخ می‌دهد؛ با ثبت جزوه یا متن درسی، پرسش‌های مستند دریافت کنید."
        action={
          <Button className="h-11" onClick={onManage}>
            <Plus className="h-4 w-4 ml-1.5" aria-hidden /> افزودن اولین منبع
          </Button>
        }
      />
    );
  }

  const quotaPct =
    quota && quota.dailyLimit > 0
      ? Math.min(100, Math.round((quota.usedToday / quota.dailyLimit) * 100))
      : 0;

  return (
    <>
      {/* quota card */}
      <Card className="border-border/60">
        <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-center gap-3 shrink-0">
            <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <Gauge className="h-5.5 w-5.5" aria-hidden />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">
                سهمیهٔ پرسش از منابع{quota ? ` — ${quota.planName}` : ""}
              </p>
              <p className="text-lg font-extrabold tabular-nums">
                {faNum(quota?.usedToday ?? 0)} / {faNum(quota?.dailyLimit ?? 0)}
                <span className="text-xs font-normal mr-1">پرسش امروز</span>
              </p>
            </div>
          </div>
          <div className="flex-1 w-full min-w-0">
            <Progress
              value={quotaPct}
              className="h-2"
              aria-label={`سهمیهٔ استفاده‌شده: ${faNum(quota?.usedToday ?? 0)} از ${faNum(quota?.dailyLimit ?? 0)}`}
            />
            <p className="text-[11px] text-muted-foreground mt-1 tabular-nums">
              {quota ? `${faNum(quota.remaining)} پرسش باقی‌مانده` : "در حال دریافت سهمیه…"}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ask form */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4.5 w-4.5 text-emerald-600" aria-hidden /> پرسش از منابع
          </CardTitle>
          <CardDescription>
            پاسخ‌ها فقط از دل منابع ساخته می‌شوند و هر ادعا به شمارهٔ منبع استناد می‌کند.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="kn-question" className="text-xs">پرسش شما *</Label>
            <Textarea
              id="kn-question"
              dir="auto"
              rows={3}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="مثلاً: تعریف شتاب چیست و با سرعت چه تفاوتی دارد؟"
              aria-label="پرسش از منابع"
            />
          </div>

          {/* source scope filter */}
          <div className="rounded-xl border border-border/60 p-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Label className="text-xs flex items-center gap-1.5">
                <Library className="h-3.5 w-3.5 text-primary" aria-hidden /> محدودهٔ جست‌وجو
              </Label>
              {selected.size > 0 && (
                <button
                  type="button"
                  className="text-[11px] text-primary hover:underline min-h-11"
                  onClick={() => setSelected(new Set())}
                >
                  بازنشانی به همهٔ منابع
                </button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5 leading-5">
              {selected.size === 0
                ? "پیش‌فرض: همهٔ منابع سازمان جست‌وجو می‌شوند."
                : `جست‌وجو محدود به ${faNum(selected.size)} منبع انتخاب‌شده است.`}
            </p>
            <div className="grid sm:grid-cols-2 gap-1 mt-2 max-h-40 overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border">
              {sources.map((s) => (
                <label
                  key={s.id}
                  className="flex items-center gap-2 rounded-lg px-2.5 min-h-11 py-1.5 hover:bg-muted/60 cursor-pointer text-xs transition-colors"
                >
                  <Checkbox
                    checked={selected.has(s.id)}
                    onCheckedChange={() => toggle(s.id)}
                    aria-label={`انتخاب منبع ${s.title}`}
                  />
                  <span className="truncate">{s.title}</span>
                  {s.subject && (
                    <Badge
                      variant="outline"
                      className={`text-[9px] shrink-0 ${SUBJECT_TONES[toneFor(s.subject)]}`}
                    >
                      {s.subject}
                    </Badge>
                  )}
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <Button className="h-11 px-6" onClick={() => void ask()} disabled={busy}>
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin ml-1.5" aria-hidden />
              ) : (
                <ShieldCheck className="h-4 w-4 ml-1.5" aria-hidden />
              )}
              {busy ? "در حال جست‌وجو در منابع…" : "پرسش"}
            </Button>
          </div>

          {error && <ErrorState message={error} />}
          {blocked && <PaywallNotice message={blocked} />}
        </CardContent>
      </Card>

      {/* live answer */}
      {busy && (
        <Card className="border-border/60">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              نگهبان منبع در حال بازیابی قطعه‌های مرتبط و ساخت پاسخ مستند است…
            </div>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </CardContent>
        </Card>
      )}

      {answer && !busy && <AnswerCard res={answer} question={askedQuestion} />}

      {/* session history */}
      {history.length > 0 && !busy && (
        <Collapsible defaultOpen={false}>
          <Card className="border-border/60">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="w-full justify-between h-11 rounded-xl">
                <span className="flex items-center gap-1.5 text-xs font-bold">
                  <History className="h-3.5 w-3.5 text-primary" aria-hidden />
                  پرسش‌های این نشست ({faNum(history.length)})
                </span>
                <ChevronDown className="h-4 w-4" aria-hidden />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="px-4 pb-4 space-y-3">
              <div className="h-px bg-border/60" />
              {history.map((h, i) => (
                <div key={i} className="rounded-xl border border-border/60 p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-bold leading-6 min-w-0">{h.question}</p>
                    <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                      {faDateTime(h.at)}
                    </span>
                  </div>
                  <p
                    className={`text-xs leading-6 line-clamp-3 ${
                      h.res.foundInSources ? "text-foreground/85" : "text-muted-foreground"
                    }`}
                    dir="auto"
                  >
                    {h.res.answer}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {h.res.sources.slice(0, 2).map((s, j) => (
                      <Badge key={j} variant="outline" className="text-[9px] max-w-56">
                        <span className="truncate">{s.title}</span>
                      </Badge>
                    ))}
                    {h.res.sources.length > 2 && (
                      <Badge variant="outline" className="text-[9px] tabular-nums">
                        +{faNum(h.res.sources.length - 2)}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}
    </>
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
                هیچ قطعهٔ مرتبطی در دانش‌نامه یافت نشد؛ برای این موضوع منبع جدیدی ثبت کنید یا
                پرسش را با کلمات مرتبط‌تر با متن منابع بپرسید.
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
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-4.5 w-4.5 text-emerald-600" aria-hidden /> پاسخ نگهبان منبع
          {res.usedChunks > 0 && (
            <Badge variant="secondary" className="text-[10px] tabular-nums">
              بر پایهٔ {faNum(res.usedChunks)} قطعه از {faNum(res.usedSourceCount)} منبع
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          پاسخ فقط بر اساس متن قطعه‌های بازیابی‌شده ساخته شده است؛ شماره‌های داخل کروشه به منابع
          پایین صفحه ارجاع می‌دهند.
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
                  منبع: [{s.title} — قطعهٔ {faNum(s.chunkPosition + 1)}]
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

function SourcesSkeleton() {
  return (
    <div className="space-y-4">
      <Card className="border-border/60">
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-36 w-full" />
        </CardContent>
      </Card>
      <Card className="border-border/60">
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}
