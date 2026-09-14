"use client";

import { useState } from "react";
import { api, ApiClientError } from "@/lib/app/api-client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorState, faDate, faNum } from "@/components/shared/blocks";
import { DIFFICULTY_LABELS_FA, QUESTION_TYPE_LABELS_FA } from "@/lib/app/labels";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, FileCheck2, Loader2, Sparkles, Wand2 } from "lucide-react";
import { PaywallNotice, QuestionPreviewCard, isPaywallError } from "./shared";
import { CreateExamDialog } from "./create-exam-dialog";
import {
  DIFFICULTY_VALUES,
  QUESTION_TYPES,
  type GeneratedQuestion,
  type QuestionGenerateResponse,
} from "./types";

// AI Question Generator (spec §11.3 / §20 Teacher/تولید سؤال هوشمند)
// Gated + metered through the central gateway; paywall feedback per spec §42.
export function QuestionGeneratorSection({ onGo }: { onGo: (key: string) => void }) {
  const { toast } = useToast();
  const [content, setContent] = useState("");
  const [type, setType] = useState("MULTIPLE_CHOICE");
  const [difficulty, setDifficulty] = useState("MEDIUM");
  const [count, setCount] = useState("5");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [result, setResult] = useState<QuestionGenerateResponse | null>(null);
  const [examOpen, setExamOpen] = useState(false);

  async function generate() {
    if (busy) return;
    if (content.trim().length < 30) {
      setError("متن مرجع باید حداقل ۳۰ کاراکتر باشد.");
      return;
    }
    setBusy(true);
    setError(null);
    setBlocked(null);
    setResult(null);
    try {
      const res = await api<QuestionGenerateResponse>("/api/v1/teacher/question-generate", {
        method: "POST",
        body: JSON.stringify({
          content: content.trim(),
          type,
          difficulty,
          count: Number(count) || 5,
        }),
      });
      setResult(res);
      if (!res.parsedOk) {
        toast({
          title: "خروجی ساختاریافتی تولید نشد",
          description: "پاسخ خام هوش مصنوعی در پایین صفحه نمایش داده می‌شود.",
        });
      } else {
        toast({
          title: "سؤال‌ها تولید شد",
          description: `${faNum(res.questions.length)} سؤال آمادهٔ بررسی است.`,
        });
      }
    } catch (e) {
      if (isPaywallError(e)) {
        setBlocked(e instanceof ApiClientError ? e.message : "سهمیهٔ امروز شما به پایان رسیده است.");
      } else {
        setError(e instanceof ApiClientError ? e.message : "تولید سؤال ناموفق بود.");
      }
    } finally {
      setBusy(false);
    }
  }

  const questions: GeneratedQuestion[] = result?.questions ?? [];

  return (
    <div className="space-y-4">
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Wand2 className="h-4.5 w-4.5 text-primary" aria-hidden /> تولید سؤال از متن درس
          </CardTitle>
          <CardDescription>
            متن جزوه یا کتاب را بچسبانید؛ هوش مصنوعی سؤال‌های آموزشی با پاسخ و توضیح می‌سازد.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            dir="auto"
            rows={8}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="متن مرجع (جزوه، بخشی از کتاب یا خلاصهٔ درس) را اینجا قرار دهید… حداقل ۳۰ کاراکتر."
            aria-label="متن مرجع"
          />

          <div className="grid sm:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">نوع سؤال</Label>
              <Select value={type} onValueChange={setType}>
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
              <Select value={difficulty} onValueChange={setDifficulty}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DIFFICULTY_VALUES.map((d) => (
                    <SelectItem key={d} value={d}>{DIFFICULTY_LABELS_FA[d]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">تعداد سؤال</Label>
              <Select value={count} onValueChange={setCount}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["3", "5", "8", "10"].map((n) => (
                    <SelectItem key={n} value={n}>{faNum(Number(n))} سؤال</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button className="w-full h-10" onClick={() => void generate()} disabled={busy}>
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin ml-1.5" aria-hidden />
                ) : (
                  <Sparkles className="h-4 w-4 ml-1.5" aria-hidden />
                )}
                {busy ? "در حال تولید…" : "تولید سؤال"}
              </Button>
            </div>
          </div>

          {error && <ErrorState message={error} />}
          {blocked && <PaywallNotice message={blocked} />}
        </CardContent>
      </Card>

      {/* Results */}
      {result && (
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4.5 w-4.5 text-primary" aria-hidden /> سؤال‌های تولیدشده
              {result.parsedOk && (
                <Badge variant="secondary" className="text-[10px] tabular-nums">
                  {faNum(questions.length)} سؤال
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              پاسخ‌ها را بررسی کنید؛ سپس می‌توانید همه را در قالب یک آزمون جدید ذخیره کنید.
              {result.usage && (result.usage.inputUnits !== undefined || result.usage.outputUnits !== undefined) && (
                <span className="block mt-1 tabular-nums">
                  مصرف: {faNum(result.usage.inputUnits ?? 0)} واحد ورودی · {faNum(result.usage.outputUnits ?? 0)} واحد خروجی
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!result.parsedOk && (
              <Alert>
                <AlertTriangle className="h-4 w-4" aria-hidden />
                <AlertTitle>خروجی ساختاریافتی تولید نشد</AlertTitle>
                <AlertDescription>
                  پاسخ خام مدل در ادامه نمایش داده می‌شود؛ می‌توانید متن را ویرایش و دوباره تلاش کنید.
                </AlertDescription>
              </Alert>
            )}

            {questions.length === 0 ? (
              <div>
                <EmptyState
                  icon={Sparkles}
                  title="سؤال قابل پردازشی تولید نشد."
                  description="متن مرجع را کامل‌تر کنید یا نوع سؤال دیگری را امتحان کنید."
                />
                <pre
                  dir="auto"
                  className="mt-3 max-h-64 overflow-y-auto rounded-xl bg-muted p-4 text-[11px] leading-6 whitespace-pre-wrap"
                >
                  {result.raw}
                </pre>
              </div>
            ) : (
              <>
                <div className="space-y-3 max-h-[560px] overflow-y-auto pl-1">
                  {questions.map((q, i) => (
                    <QuestionPreviewCard key={i} q={q} index={i} />
                  ))}
                </div>
                <Button
                  className="h-10"
                  onClick={() => setExamOpen(true)}
                >
                  <FileCheck2 className="h-4 w-4 ml-1.5" aria-hidden />
                  ایجاد آزمون از این سؤال‌ها
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Prefilled exam builder from generated questions */}
      <CreateExamDialog
        open={examOpen}
        onOpenChange={setExamOpen}
        initialTitle={`آزمون هوشمند — ${faDate(new Date())}`}
        initialQuestions={questions}
        onCreated={() => {
          setResult(null);
          onGo("exams");
        }}
      />
    </div>
  );
}
