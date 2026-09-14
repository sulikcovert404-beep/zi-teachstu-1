"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiClientError } from "@/lib/app/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorState, faDateTime, faNum } from "@/components/shared/blocks";
import {
  Clock, Send, Save, ChevronRight, ChevronLeft, CheckCircle2, XCircle,
  Loader2, Trophy, AlertTriangle, FileCheck2,
} from "lucide-react";

interface PublicQuestion {
  id: string;
  type: string;
  prompt: string;
  options: string[];
  points: number;
  difficulty: string;
  topic: string | null;
}

interface AttemptData {
  attemptId: string;
  attemptNo: number;
  state: string;
  exam: { title: string; durationMinutes: number };
  questions: PublicQuestion[];
  answers: Record<string, string> | null;
  startedAt: string;
}

interface ResultData {
  attempt: { id: string; state: string; attemptNo: number; submittedAt: string | null };
  exam: { title: string };
  score: number;
  maxScore: number;
  questions: Array<{
    id: string; prompt: string; type: string; options: string[]; chosen: string | null;
    correctAnswer: string; correct: boolean; earned: number; points: number; explanation: string | null;
  }>;
}

const DIFF_LABELS: Record<string, string> = { EASY: "آسان", MEDIUM: "متوسط", HARD: "سخت" };

// Exam taking flow (spec §18.4): snapshot-based runner, idempotent saves, server grading
// viewAttemptId → review mode for an already-graded attempt (no new attempt is created)
export function ExamRunner({
  assignmentId,
  viewAttemptId,
  onClose,
  onFinished,
}: {
  assignmentId: string;
  viewAttemptId?: string | null;
  onClose: () => void;
  onFinished: () => void;
}) {
  const [phase, setPhase] = useState<"loading" | "taking" | "submitting" | "result">("loading");
  const [data, setData] = useState<AttemptData | null>(null);
  const [result, setResult] = useState<ResultData | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [qIndex, setQIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number>(0);
  const [savedTick, setSavedTick] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submittingRef = useRef(false);

  const start = useCallback(async () => {
    setPhase("loading");
    setError(null);
    try {
      if (viewAttemptId) {
        // Review mode: show the graded result of an existing attempt
        const res = await api<ResultData>(`/api/v1/student/exam-attempts/${viewAttemptId}/result`);
        setResult(res);
        setPhase("result");
        return;
      }
      const res = await api<AttemptData>(`/api/v1/student/exam-assignments/${assignmentId}/attempts`, { method: "POST" });
      setData(res);
      setAnswers(res.answers ?? {});
      setPhase("taking");
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "شروع آزمون ناموفق بود.");
      setPhase("taking");
    }
  }, [assignmentId, viewAttemptId]);

  useEffect(() => {
    void start();
  }, [start]);

  // Timer (auto-submit on expiry)
  useEffect(() => {
    if (phase !== "taking" || !data) return;
    const endAt = new Date(data.startedAt).getTime() + data.exam.durationMinutes * 60000;
    const iv = setInterval(() => {
      const left = Math.max(0, endAt - Date.now());
      setRemaining(left);
      if (left <= 0) {
        clearInterval(iv);
        void doSubmit(true);
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [phase, data]);

  // Debounced idempotent save (spec §18.4 — save answers idempotent)
  const scheduleSave = useCallback((next: Record<string, string>) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        if (!data) return;
        await api(`/api/v1/student/exam-attempts/${data.attemptId}/answers`, {
          method: "PATCH",
          body: JSON.stringify({ answers: next }),
        });
        setSavedTick(true);
        setTimeout(() => setSavedTick(false), 1500);
      } catch {
        /* silent — next keystroke retries */
      }
    }, 700);
  }, [data]);

  function setAnswer(qid: string, value: string) {
    const next = { ...answers, [qid]: value };
    setAnswers(next);
    scheduleSave(next);
  }

  async function doSubmit(auto = false) {
    if (!data || submittingRef.current) return;
    if (!auto && Object.keys(answers).length < data.questions.length) {
      const ok = window.confirm("به بعضی سؤال‌ها پاسخ نداده‌اید. مطمئنید که تحویل می‌دهید؟");
      if (!ok) return;
    }
    submittingRef.current = true;
    setPhase("submitting");
    try {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      await api(`/api/v1/student/exam-attempts/${data.attemptId}/answers`, {
        method: "PATCH",
        body: JSON.stringify({ answers }),
      });
      await api(`/api/v1/student/exam-attempts/${data.attemptId}/submit`, { method: "POST" });
      const res = await api<ResultData>(`/api/v1/student/exam-attempts/${data.attemptId}/result`);
      setResult(res);
      setPhase("result");
      onFinished();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "تحویل آزمون ناموفق بود.");
      setPhase("taking");
    } finally {
      submittingRef.current = false;
    }
  }

  const fmt = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };

  if (phase === "loading") {
    return (
      <DialogContent className="max-w-2xl">
        <DialogHeader className="sr-only">
          <DialogTitle>در حال آماده‌سازی آزمون</DialogTitle>
          <DialogDescription>لطفاً منتظر بمانید.</DialogDescription>
        </DialogHeader>
        <div className="py-10 flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
          <p className="text-sm text-muted-foreground">در حال آماده‌سازی آزمون…</p>
        </div>
      </DialogContent>
    );
  }

  if (phase === "taking" || phase === "submitting") {
    if (!data) return <DialogContent><DialogHeader className="sr-only"><DialogTitle>خطا</DialogTitle></DialogHeader><ErrorState message={error ?? "آزمون در دسترس نیست."} onRetry={() => void start()} /></DialogContent>;
    const q = data.questions[qIndex];
    const answeredCount = Object.keys(answers).length;
    return (
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            {data.exam.title}
            <Badge variant="secondary">کوشش {faNum(data.attemptNo)}</Badge>
          </DialogTitle>
          <DialogDescription className="flex items-center gap-3 flex-wrap">
            <span className="flex items-center gap-1 tabular-nums font-bold">
              <Clock className="h-3.5 w-3.5" aria-hidden />
              {fmt(remaining)}
            </span>
            <span>
              {faNum(answeredCount)} از {faNum(data.questions.length)} پاسخ داده شده
            </span>
            {savedTick && (
              <span className="flex items-center gap-1 text-emerald-600 text-xs">
                <Save className="h-3 w-3" aria-hidden /> ذخیره شد
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

        <div className="mt-2">
          <Progress value={(answeredCount / data.questions.length) * 100} className="h-2" />
        </div>

        {/* Question */}
        <Card className="border-border/60 mt-4">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-base">
                سؤال {faNum(qIndex + 1)} از {faNum(data.questions.length)}
              </CardTitle>
              <div className="flex gap-1.5 flex-wrap">
                <Badge variant="outline">{DIFF_LABELS[q.difficulty] ?? q.difficulty}</Badge>
                <Badge variant="outline">{faNum(q.points)} نمره</Badge>
                {q.topic && <Badge variant="secondary">{q.topic}</Badge>}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="font-bold leading-8">{q.prompt}</p>

            {q.type === "MULTIPLE_CHOICE" || q.type === "TRUE_FALSE" ? (
              <RadioGroup
                value={answers[q.id] ?? ""}
                onValueChange={(v) => setAnswer(q.id, v)}
                className="gap-2.5"
              >
                {q.options.map((opt, i) => (
                  <div key={i} className="flex items-center gap-2.5 rounded-lg border border-border/60 px-3 py-2.5 has-[button[data-state=checked]]:border-primary has-[button[data-state=checked]]:bg-primary/5 transition-colors">
                    <RadioGroupItem value={String(i)} id={`q-${q.id}-${i}`} />
                    <Label htmlFor={`q-${q.id}-${i}`} className="cursor-pointer font-normal leading-6 flex-1">
                      {opt}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            ) : q.type === "FILL_IN_BLANK" ? (
              <Input
                dir="auto"
                placeholder="پاسخ خود را بنویسید…"
                value={answers[q.id] ?? ""}
                onChange={(e) => setAnswer(q.id, e.target.value)}
              />
            ) : (
              <Textarea
                dir="auto"
                rows={4}
                placeholder="پاسخ تشریحی خود را بنویسید…"
                value={answers[q.id] ?? ""}
                onChange={(e) => setAnswer(q.id, e.target.value)}
              />
            )}
          </CardContent>
        </Card>

        {/* Nav */}
        <div className="flex items-center justify-between gap-2 pt-2">
          <Button variant="outline" disabled={qIndex === 0} onClick={() => setQIndex((i) => i - 1)}>
            <ChevronRight className="h-4 w-4 ml-1" aria-hidden /> قبلی
          </Button>
          <div className="flex gap-1.5 flex-wrap justify-center">
            {data.questions.map((qq, i) => (
              <button
                key={qq.id}
                onClick={() => setQIndex(i)}
                aria-label={`سؤال ${i + 1}`}
                className={cn(
                  "h-8 w-8 rounded-lg text-xs font-bold tabular-nums transition-colors",
                  i === qIndex
                    ? "bg-primary text-primary-foreground"
                    : answers[qq.id] !== undefined
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground hover:bg-muted/70"
                )}
              >
                {faNum(i + 1)}
              </button>
            ))}
          </div>
          {qIndex < data.questions.length - 1 ? (
            <Button onClick={() => setQIndex((i) => i + 1)}>
              بعدی <ChevronLeft className="h-4 w-4 mr-1" aria-hidden />
            </Button>
          ) : (
            <Button onClick={() => void doSubmit()} disabled={phase === "submitting"}>
              {phase === "submitting" ? <Loader2 className="h-4 w-4 animate-spin ml-1" aria-hidden /> : <Send className="h-4 w-4 ml-1" aria-hidden />}
              تحویل آزمون
            </Button>
          )}
        </div>
        <div className="flex justify-end pt-1">
          {qIndex === data.questions.length - 1 && phase !== "submitting" && (
            <Button variant="ghost" size="sm" onClick={onClose} className="text-muted-foreground">
              بستن (پاسخ‌ها ذخیره می‌شود)
            </Button>
          )}
        </div>
      </DialogContent>
    );
  }

  // Result phase
  if (phase === "result" && result) {
    const percent = result.maxScore > 0 ? Math.round((result.score / result.maxScore) * 100) : 0;
    return (
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-amber-500" aria-hidden />
            نتیجهٔ آزمون: {result.exam.title}
          </DialogTitle>
          <DialogDescription>تصحیح به‌صورت خودکار و سمت سرور انجام شد.</DialogDescription>
        </DialogHeader>

        <Card className="border-border/60">
          <CardContent className="p-5 text-center space-y-3">
            <p className="text-4xl font-extrabold tabular-nums">{faNum(percent)}٪</p>
            <p className="text-sm text-muted-foreground">
              نمرهٔ شما: {faNum(result.score)} از {faNum(result.maxScore)}
            </p>
            <Progress value={percent} className="h-2.5" />
            <p className="text-xs text-muted-foreground">تحویل: {faDateTime(result.attempt.submittedAt)}</p>
          </CardContent>
        </Card>

        <div className="space-y-3 mt-2">
          {result.questions.map((qq, i) => (
            <Card key={qq.id} className={cn("border-border/60", qq.correct ? "border-emerald-500/40" : "border-destructive/40")}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-bold text-sm leading-7">
                    {faNum(i + 1)}. {qq.prompt}
                  </p>
                  {qq.correct ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" aria-hidden />
                  ) : (
                    <XCircle className="h-5 w-5 text-destructive shrink-0" aria-hidden />
                  )}
                </div>
                <div className="text-xs space-y-1.5 text-muted-foreground">
                  {qq.options.length > 0 && (
                    <p>
                      پاسخ شما:{" "}
                      <span className={qq.correct ? "text-emerald-600 font-bold" : "text-destructive font-bold"}>
                        {qq.chosen !== null && qq.options[Number(qq.chosen)] !== undefined ? qq.options[Number(qq.chosen)] : "بی‌پاسخ"}
                      </span>
                    </p>
                  )}
                  {qq.type === "FILL_IN_BLANK" && (
                    <p>
                      پاسخ شما:{" "}
                      <span className={qq.correct ? "text-emerald-600 font-bold" : "text-destructive font-bold"}>
                        {qq.chosen ?? "بی‌پاسخ"}
                      </span>
                    </p>
                  )}
                  {qq.type === "SHORT_ANSWER" && (
                    <p>
                      پاسخ شما:{" "}
                      <span className="font-bold text-foreground">{qq.chosen ?? "بی‌پاسخ"}</span>
                    </p>
                  )}
                  <p>
                    پاسخ صحیح:{" "}
                    <span className="text-emerald-600 font-bold">
                      {qq.options.length > 0 && qq.correctAnswer !== "" && !isNaN(Number(qq.correctAnswer))
                        ? qq.options[Number(qq.correctAnswer)] ?? qq.correctAnswer
                        : qq.correctAnswer}
                    </span>
                  </p>
                  {qq.explanation && (
                    <p className="bg-muted rounded-lg p-2.5 leading-6 text-foreground/80">{qq.explanation}</p>
                  )}
                  <p className="flex items-center gap-1">
                    <FileCheck2 className="h-3.5 w-3.5" aria-hidden />
                    نمرهٔ این سؤال: {faNum(qq.earned)} از {faNum(qq.points)}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="flex justify-end pt-2">
          <Button onClick={onClose}>بستن</Button>
        </div>
      </DialogContent>
    );
  }

  return <DialogContent><DialogHeader className="sr-only"><DialogTitle>آزمون در دسترس نیست</DialogTitle></DialogHeader><EmptyState title="آزمون در دسترس نیست." icon={AlertTriangle} /></DialogContent>;
}

// Thin wrapper to mount the runner inside a Dialog
export function ExamRunnerDialog({
  assignmentId,
  viewAttemptId,
  open,
  onOpenChange,
  onFinished,
}: {
  assignmentId: string | null;
  viewAttemptId?: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onFinished: () => void;
}) {
  return (
    <Dialog open={open && !!assignmentId} onOpenChange={onOpenChange}>
      {assignmentId && (
        <ExamRunner
          assignmentId={assignmentId}
          viewAttemptId={viewAttemptId}
          onClose={() => onOpenChange(false)}
          onFinished={onFinished}
        />
      )}
    </Dialog>
  );
}
