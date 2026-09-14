"use client";

import { useState } from "react";
import { api, ApiClientError } from "@/lib/app/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { faNum } from "@/components/shared/blocks";
import { QUESTION_TYPE_LABELS_FA, DIFFICULTY_LABELS_FA } from "@/lib/app/labels";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Trash2, FileCheck2 } from "lucide-react";
import { DIFFICULTY_VALUES, QUESTION_TYPES, type GeneratedQuestion } from "./types";

// Manual exam builder dialog (spec §20 Teacher/آزمون‌ها).
// Reusable: the AI question generator opens it pre-filled via initialTitle/initialQuestions.

interface QuestionForm {
  type: string;
  prompt: string;
  options: string[];
  correctIndex: string; // "0".."3" for MC / "0"|"1" for TRUE_FALSE
  correctAnswer: string; // free text for SHORT_ANSWER / FILL_IN_BLANK
  explanation: string;
  difficulty: string;
  topic: string;
  points: string;
}

function emptyQuestion(): QuestionForm {
  return {
    type: "MULTIPLE_CHOICE",
    prompt: "",
    options: ["", "", "", ""],
    correctIndex: "0",
    correctAnswer: "",
    explanation: "",
    difficulty: "MEDIUM",
    topic: "",
    points: "1",
  };
}

function padOptions(options: string[] | null | undefined): string[] {
  const list = (options ?? []).map((o) => String(o ?? ""));
  while (list.length < 4) list.push("");
  return list.slice(0, 4);
}

// Map an AI-generated question into the manual builder form state (tolerant parsing)
function toForm(q: GeneratedQuestion): QuestionForm {
  const form = emptyQuestion();
  form.type = QUESTION_TYPES.includes(q.type) ? q.type : "MULTIPLE_CHOICE";
  form.prompt = String(q.prompt ?? "");
  form.explanation = String(q.explanation ?? "");
  form.difficulty = DIFFICULTY_VALUES.includes(q.difficulty ?? "") ? (q.difficulty as string) : "MEDIUM";
  form.topic = String(q.topic ?? "");
  form.points = String(q.points ?? 1);

  const raw = String(q.correctAnswer ?? "");
  if (form.type === "MULTIPLE_CHOICE") {
    form.options = padOptions(q.options);
    const n = Number(raw);
    if (!Number.isNaN(n) && n >= 0 && n < 4) {
      form.correctIndex = String(n);
    } else {
      const idx = form.options.findIndex((o) => o !== "" && o === raw);
      form.correctIndex = String(idx >= 0 ? idx : 0);
    }
  } else if (form.type === "TRUE_FALSE") {
    if (raw === "0" || raw === "1") form.correctIndex = raw;
    else if (/صحیح|درست|true/i.test(raw)) form.correctIndex = "0";
    else form.correctIndex = "1";
  } else {
    form.correctAnswer = raw;
  }
  return form;
}

interface CreateExamDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTitle?: string;
  initialQuestions?: GeneratedQuestion[];
  onCreated?: () => void;
}

export function CreateExamDialog({
  open,
  onOpenChange,
  initialTitle,
  initialQuestions,
  onCreated,
}: CreateExamDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <CreateExamForm
          initialTitle={initialTitle}
          initialQuestions={initialQuestions}
          onDone={() => {
            onOpenChange(false);
            onCreated?.();
          }}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function CreateExamForm({
  initialTitle,
  initialQuestions,
  onDone,
  onCancel,
}: {
  initialTitle?: string;
  initialQuestions?: GeneratedQuestion[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState(initialTitle ?? "");
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState("20");
  const [questions, setQuestions] = useState<QuestionForm[]>(() =>
    initialQuestions && initialQuestions.length > 0
      ? initialQuestions.map(toForm)
      : [emptyQuestion()]
  );
  const [busy, setBusy] = useState(false);

  function updateQuestion(index: number, patch: Partial<QuestionForm>) {
    setQuestions((list) => list.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  }

  function updateOption(qIndex: number, oIndex: number, value: string) {
    setQuestions((list) =>
      list.map((q, i) =>
        i === qIndex ? { ...q, options: q.options.map((o, j) => (j === oIndex ? value : o)) } : q
      )
    );
  }

  function addQuestion() {
    setQuestions((list) => [...list, emptyQuestion()]);
  }

  function removeQuestion(index: number) {
    setQuestions((list) => (list.length <= 1 ? list : list.filter((_, i) => i !== index)));
  }

  function validate(): string | null {
    if (title.trim().length < 3) return "عنوان آزمون باید حداقل ۳ کاراکتر باشد.";
    for (const q of questions) {
      if (!q.prompt.trim()) return "متن هیچ سؤالی نمی‌تواند خالی باشد.";
      if (q.type === "MULTIPLE_CHOICE") {
        const filled = q.options.filter((o) => o.trim() !== "").length;
        if (filled < 2) return "هر سؤال چهارگزینه‌ای حداقل به دو گزینهٔ پرشده نیاز دارد.";
        if (!q.options[Number(q.correctIndex)]?.trim())
          return "گزینهٔ انتخاب‌شده به‌عنوان پاسخ صحیح نمی‌تواند خالی باشد.";
      }
      if (
        (q.type === "SHORT_ANSWER" || q.type === "FILL_IN_BLANK") &&
        !q.correctAnswer.trim()
      ) {
        return "پاسخ صحیح سؤالات تشریحی و جای خالی را وارد کنید.";
      }
    }
    return null;
  }

  async function submit() {
    if (busy) return;
    const problem = validate();
    if (problem) {
      toast({ title: "فرم ناقص است", description: problem, variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      await api("/api/v1/teacher/exams", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          durationMinutes: Number(duration) || 20,
          questions: questions.map((q) => ({
            type: q.type,
            prompt: q.prompt.trim(),
            ...(q.type === "MULTIPLE_CHOICE" ? { options: q.options.map((o) => o.trim()) } : {}),
            correctAnswer:
              q.type === "MULTIPLE_CHOICE" || q.type === "TRUE_FALSE"
                ? q.correctIndex
                : q.correctAnswer.trim(),
            explanation: q.explanation.trim() || undefined,
            difficulty: q.difficulty,
            topic: q.topic.trim() || undefined,
            points: Number(q.points) || 1,
          })),
        }),
      });
      toast({
        title: "آزمون ساخته شد",
        description: `${faNum(questions.length)} سؤال برای آزمون «${title.trim()}» ذخیره شد.`,
      });
      onDone();
    } catch (e) {
      toast({
        title: "ایجاد آزمون ناموفق بود",
        description: e instanceof ApiClientError ? e.message : "خطای غیرمنتظره‌ای رخ داد.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <FileCheck2 className="h-5 w-5 text-primary" aria-hidden />
          ایجاد آزمون جدید
        </DialogTitle>
        <DialogDescription>
          سؤال‌ها را به‌صورت دستی بسازید؛ نمره‌دهی چهارگزینه‌ای و صحیح/غلط خودکار است.
        </DialogDescription>
      </DialogHeader>

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="exam-title" className="text-xs">عنوان آزمون</Label>
          <Input
            id="exam-title"
            dir="auto"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="مثلاً: کوییز فصل ۳ — ریاضی"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="exam-desc" className="text-xs">توضیحات (اختیاری)</Label>
          <Textarea
            id="exam-desc"
            dir="auto"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="توضیح کوتاه دربارهٔ مبحث آزمون…"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="exam-duration" className="text-xs">مدت آزمون (دقیقه)</Label>
          <Input
            id="exam-duration"
            type="number"
            min={1}
            max={240}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-bold">
            سؤال‌ها <span className="text-muted-foreground font-normal text-xs">({faNum(questions.length)} سؤال)</span>
          </p>
          <Button type="button" size="sm" variant="outline" className="h-9" onClick={addQuestion}>
            <Plus className="h-4 w-4 ml-1" aria-hidden /> افزودن سؤال
          </Button>
        </div>

        {questions.map((q, qi) => (
          <Card key={qi} className="border-border/60">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-xs font-bold flex items-center gap-2">
                  <span className="h-6 w-6 rounded-lg bg-primary/10 text-primary flex items-center justify-center tabular-nums">
                    {faNum(qi + 1)}
                  </span>
                  سؤال {faNum(qi + 1)}
                </p>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px]">
                    {QUESTION_TYPE_LABELS_FA[q.type]}
                  </Badge>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-9 w-9 text-muted-foreground hover:text-destructive"
                    onClick={() => removeQuestion(qi)}
                    disabled={questions.length <= 1}
                    aria-label={`حذف سؤال ${faNum(qi + 1)}`}
                    title="حذف سؤال"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">نوع سؤال</Label>
                  <Select value={q.type} onValueChange={(v) => updateQuestion(qi, { type: v })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {QUESTION_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{QUESTION_TYPE_LABELS_FA[t]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">سطح سختی</Label>
                  <Select value={q.difficulty} onValueChange={(v) => updateQuestion(qi, { difficulty: v })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DIFFICULTY_VALUES.map((d) => (
                        <SelectItem key={d} value={d}>{DIFFICULTY_LABELS_FA[d]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`q-${qi}-prompt`} className="text-xs">متن سؤال</Label>
                <Textarea
                  id={`q-${qi}-prompt`}
                  dir="auto"
                  rows={2}
                  value={q.prompt}
                  onChange={(e) => updateQuestion(qi, { prompt: e.target.value })}
                  placeholder="صورت سؤال را بنویسید…"
                />
              </div>

              {q.type === "MULTIPLE_CHOICE" && (
                <div className="grid sm:grid-cols-2 gap-3">
                  {q.options.map((opt, oi) => (
                    <div key={oi} className="space-y-1.5">
                      <Label htmlFor={`q-${qi}-opt-${oi}`} className="text-xs">
                        گزینهٔ {faNum(oi + 1)}
                      </Label>
                      <Input
                        id={`q-${qi}-opt-${oi}`}
                        dir="auto"
                        value={opt}
                        onChange={(e) => updateOption(qi, oi, e.target.value)}
                        placeholder={`متن گزینهٔ ${faNum(oi + 1)}`}
                      />
                    </div>
                  ))}
                  <div className="space-y-1.5">
                    <Label className="text-xs">گزینهٔ صحیح</Label>
                    <Select value={q.correctIndex} onValueChange={(v) => updateQuestion(qi, { correctIndex: v })}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {q.options.map((_, oi) => (
                          <SelectItem key={oi} value={String(oi)}>گزینهٔ {faNum(oi + 1)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              {q.type === "TRUE_FALSE" && (
                <div className="space-y-1.5">
                  <Label className="text-xs">پاسخ صحیح</Label>
                  <Select value={q.correctIndex} onValueChange={(v) => updateQuestion(qi, { correctIndex: v })}>
                    <SelectTrigger className="w-full sm:w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">صحیح</SelectItem>
                      <SelectItem value="1">غلط</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {(q.type === "SHORT_ANSWER" || q.type === "FILL_IN_BLANK") && (
                <div className="space-y-1.5">
                  <Label htmlFor={`q-${qi}-answer`} className="text-xs">پاسخ صحیح</Label>
                  <Input
                    id={`q-${qi}-answer`}
                    dir="auto"
                    value={q.correctAnswer}
                    onChange={(e) => updateQuestion(qi, { correctAnswer: e.target.value })}
                    placeholder="پاسخ کوتاه مورد انتظار…"
                  />
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor={`q-${qi}-points`} className="text-xs">بارم (نمره)</Label>
                  <Input
                    id={`q-${qi}-points`}
                    type="number"
                    min={1}
                    max={100}
                    value={q.points}
                    onChange={(e) => updateQuestion(qi, { points: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`q-${qi}-topic`} className="text-xs">مبحث (اختیاری)</Label>
                  <Input
                    id={`q-${qi}-topic`}
                    dir="auto"
                    value={q.topic}
                    onChange={(e) => updateQuestion(qi, { topic: e.target.value })}
                    placeholder="مثلاً: معادله خط"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`q-${qi}-exp`} className="text-xs">توضیح پاسخ (اختیاری)</Label>
                <Textarea
                  id={`q-${qi}-exp`}
                  dir="auto"
                  rows={2}
                  value={q.explanation}
                  onChange={(e) => updateQuestion(qi, { explanation: e.target.value })}
                  placeholder="توضیحی که پس از تصحیح به دانش‌آموز نمایش داده می‌شود…"
                />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" className="h-10" onClick={onCancel} disabled={busy}>
          انصراف
        </Button>
        <Button type="button" className="h-10" onClick={() => void submit()} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin ml-1.5" aria-hidden /> : <FileCheck2 className="h-4 w-4 ml-1.5" aria-hidden />}
          {busy ? "در حال ذخیره…" : "ذخیرهٔ آزمون"}
        </Button>
      </DialogFooter>
    </div>
  );
}
