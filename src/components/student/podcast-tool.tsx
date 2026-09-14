"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiClientError } from "@/lib/app/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorState, faNum } from "@/components/shared/blocks";
import { cn } from "@/lib/utils";
import {
  Download, Gauge, Headphones, Info, Loader2, Lock, Mic, Radio, Sparkles, Waves,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ── Podcast Tool (Milestone G — spec §13) ──
// Text-to-speech through the central AI Gateway (feature PODCAST, quota-gated).
// The server splits text at sentence boundaries, synthesizes each chunk, and
// merges everything into one downloadable WAV.

const MAX_CHARS = 3000;

const VOICES: Array<{ value: string; label: string; hint: string }> = [
  { value: "tongtong", label: "گرم و صمیمی", hint: "مناسب جزوه‌های معمولی" },
  { value: "xiaochen", label: "آرام و حرفه‌ای", hint: "لحن ارائهٔ درسی" },
  { value: "jam", label: "رسمی", hint: "متن‌های جدی‌تر" },
  { value: "kazi", label: "شفاف", hint: "تلفص واضح‌تر" },
  { value: "douji", label: "روان و طبیعی", hint: "گفتار روزمره" },
];

const SPEEDS: Array<{ value: string; label: string }> = [
  { value: "0.8", label: "آهسته" },
  { value: "1", label: "عادی" },
  { value: "1.2", label: "تند" },
];

interface PodcastResult {
  audioBase64: string;
  contentType: "audio/wav";
  title: string;
  chars: number;
  chunks: number;
  durationSec: number;
  quota: { usedToday: number; dailyLimit: number; remaining: number; planName: string };
}

function base64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

export function PodcastTool() {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [voice, setVoice] = useState("tongtong");
  const [speed, setSpeed] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [result, setResult] = useState<PodcastResult | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  // Revoke the previous object URL whenever a new podcast replaces it.
  useEffect(() => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = audioUrl;
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, [audioUrl]);

  async function generate() {
    const t = text.trim();
    if (t.length < 2) {
      setError("متن پادکست را وارد کنید.");
      return;
    }
    setBusy(true); setError(null); setBlocked(null); setUnavailable(null);
    try {
      const res = await api<PodcastResult>("/api/v1/student/podcast", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim() || undefined,
          text: t,
          voice,
          speed: Number(speed),
        }),
      });
      const blob = base64ToBlob(res.audioBase64, "audio/wav");
      const url = URL.createObjectURL(blob);
      setResult(res);
      setAudioUrl(url);
      toast({
        title: "پادکست ساخته شد",
        description: `${faNum(res.durationSec)} ثانیه صوت آمادهٔ پخش است.`,
      });
    } catch (e) {
      if (e instanceof ApiClientError) {
        if (e.status === 429 || e.code === "FORBIDDEN") setBlocked(e.message);
        else if (e.status === 503 || e.code === "AI_PROVIDER_UNAVAILABLE") setUnavailable(e.message);
        else setError(e.message);
      } else setError("ساخت پادکست ناموفق بود.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className="border-border/60 bg-gradient-to-l from-amber-500/5 via-transparent to-rose-500/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <span className="h-8 w-8 rounded-xl bg-amber-600/15 text-amber-700 dark:text-amber-400 flex items-center justify-center">
              <Headphones className="h-4.5 w-4.5" aria-hidden />
            </span>
            پادکست صوتی
            {result && (
              <Badge variant="secondary" className="text-[10px] tabular-nums">
                {faNum(result.durationSec)} ثانیه
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            متن درس یا خلاصهٔ خود را به گفتار طبیعی تبدیل کنید — برای مرور در مسیر مدرسه یا قبل
            از امتحان. خروجی قابل پخش و دانلود است (WAV).
          </CardDescription>
        </CardHeader>
        {result && result.quota.dailyLimit > 0 && (
          <CardContent className="pt-0">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-medium">سهمیهٔ پادکست امروز</span>
                <span className="tabular-nums text-muted-foreground">
                  {faNum(result.quota.usedToday)} / {faNum(result.quota.dailyLimit)}
                </span>
              </div>
              <Progress
                value={Math.min(100, (result.quota.usedToday / result.quota.dailyLimit) * 100)}
                className="h-1.5"
              />
            </div>
          </CardContent>
        )}
      </Card>

      {/* Input */}
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Mic className="h-4 w-4 text-primary" aria-hidden /> متن گفتار
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">عنوان (اختیاری)</Label>
            <Input
              dir="auto"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثلاً: مرور فصل حرکت‌شناسی"
              maxLength={120}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">متن پادکست</Label>
            <Textarea
              dir="auto"
              rows={7}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="متن درس، خلاصه یا نکات کلیدی را اینجا بچسبانید… (حداکثر ۳٬۰۰۰ نویسه)"
              maxLength={MAX_CHARS}
            />
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span className="tabular-nums">
                {faNum(text.length)} / {faNum(MAX_CHARS)} نویسه
              </span>
              <span className="flex items-center gap-1">
                <Waves className="h-3 w-3" aria-hidden />
                حدود {faNum(Math.max(1, Math.round(text.length / 17)))} ثانیه صوت
              </span>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1">
                <Mic className="h-3 w-3" aria-hidden /> صدا
              </Label>
              <Select value={voice} onValueChange={setVoice}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VOICES.map((v) => (
                    <SelectItem key={v.value} value={v.value}>
                      {v.label} — {v.hint}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1">
                <Gauge className="h-3 w-3" aria-hidden /> سرعت گفتار
              </Label>
              <RadioGroup
                value={speed}
                onValueChange={setSpeed}
                className="grid grid-cols-3 gap-1.5"
              >
                {SPEEDS.map((s) => (
                  <Label
                    key={s.value}
                    className={cn(
                      "flex items-center justify-center gap-1.5 rounded-lg border py-2 text-xs cursor-pointer transition-all",
                      speed === s.value
                        ? "border-primary/60 bg-primary/5 font-bold text-primary"
                        : "border-border/60 text-muted-foreground hover:border-primary/30"
                    )}
                  >
                    <RadioGroupItem value={s.value} className="sr-only" />
                    {s.label}
                  </Label>
                ))}
              </RadioGroup>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Info className="h-3 w-3" aria-hidden />
              متن طولانی به‌صورت خودکار بخش‌بندی و یکپارچه خوانده می‌شود.
            </p>
            <Button
              onClick={() => void generate()}
              disabled={busy || text.trim().length < 2}
              className="bg-gradient-to-l from-amber-600 to-rose-600 hover:brightness-110 active:scale-[0.98] transition-all"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin ml-1.5" aria-hidden /> : <Radio className="h-4 w-4 ml-1.5" aria-hidden />}
              {busy ? "در حال ضبط پادکست…" : "ساخت پادکست"}
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

      {/* Player */}
      {busy && (
        <Card className="border-border/60">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              سنتز گفتار — متن بخش‌بندی و به صدای طبیعی تبدیل می‌شود…
            </div>
            <div className="flex items-end gap-1 h-8 px-1" aria-hidden>
              {[6, 14, 22, 10, 26, 16, 30, 12, 20, 8, 24, 14, 28, 10, 18].map((h, i) => (
                <span
                  key={i}
                  className="w-1.5 rounded-full bg-amber-500/50 animate-pulse"
                  style={{ height: `${h}px`, animationDelay: `${i * 90}ms` }}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {result && audioUrl && !busy && (
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
              <Headphones className="h-4 w-4 text-amber-600" aria-hidden />
              {result.title}
              <Badge variant="secondary" className="text-[10px] tabular-nums">
                {faNum(result.chars)} نویسه · {faNum(result.chunks)} بخش
              </Badge>
            </CardTitle>
            <CardDescription>پخش آنلاین یا دانلود فایل صوتی.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* LTR audio element with RTL wrapper */}
            <div dir="ltr" className="rounded-xl border border-border/60 bg-muted/30 p-2.5">
              <audio controls preload="metadata" src={audioUrl} className="w-full h-10">
                مرورگر شما پخش صوت را پشتیبانی نمی‌کند.
              </audio>
            </div>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-[10px] text-muted-foreground tabular-nums flex items-center gap-1.5">
                <Sparkles className="h-3 w-3" aria-hidden />
                مدت: {faNum(result.durationSec)} ثانیه · فرمت WAV
              </p>
              <Button asChild variant="outline" size="sm">
                <a href={audioUrl} download={`${result.title || "podcast"}.wav`}>
                  <Download className="h-4 w-4 ml-1.5" aria-hidden />
                  دانلود فایل صوتی
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!result && !busy && (
        <EmptyState
          icon={Radio}
          title="هنوز پادکستی نساخته‌اید"
          description="متن را در کادر بالا بچسبانید و دکمهٔ «ساخت پادکست» را بزنید."
        />
      )}
    </div>
  );
}
