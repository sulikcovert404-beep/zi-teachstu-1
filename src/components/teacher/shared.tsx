"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Check, Lightbulb, Lock, Sparkles } from "lucide-react";
import { ApiClientError } from "@/lib/app/api-client";
import { QUESTION_TYPE_LABELS_FA, DIFFICULTY_LABELS_FA } from "@/lib/app/labels";
import { faNum } from "@/components/shared/blocks";
import { cn } from "@/lib/utils";

// Lenient question shape shared by exam detail + AI-generated previews
export interface QuestionLike {
  type: string;
  prompt: string;
  options?: string[] | null;
  correctAnswer: string;
  explanation?: string | null;
  difficulty?: string;
  topic?: string | null;
  points?: number;
  aiGenerated?: boolean;
}

// Paywall-style notice (spec §42) — amber panel + lock + Persian message from server
export function PaywallNotice({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 flex items-start gap-3">
      <Lock className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" aria-hidden />
      <div className="text-xs leading-6 text-amber-700 dark:text-amber-400 min-w-0">
        <p className="font-bold mb-1">دسترسی محدود شده است</p>
        <p>{message}</p>
        <p className="mt-1 text-[11px] opacity-80">برای دسترسی بیشتر، پلن خود را از طریق مدیر مدرسه ارتقا دهید.</p>
      </div>
    </div>
  );
}

export function isPaywallError(e: unknown): boolean {
  return (
    e instanceof ApiClientError &&
    (e.status === 429 || e.code === "RATE_LIMITED" || e.code === "FORBIDDEN")
  );
}

// Resolve the correct option index for four-choice questions (index or text match)
export function mcCorrectIndex(options: string[], raw: string): number {
  const n = Number(raw);
  if (!Number.isNaN(n) && n >= 0 && n < options.length) return n;
  return options.findIndex((o) => o === raw);
}

// Human-readable correct answer (Persian) for any question type
export function correctAnswerLabel(q: QuestionLike): string {
  const raw = String(q.correctAnswer ?? "");
  if (q.type === "TRUE_FALSE") {
    if (raw === "0" || /صحیح|درست|true/i.test(raw)) return "صحیح";
    return "غلط";
  }
  if (q.type === "MULTIPLE_CHOICE") {
    const opts = q.options ?? [];
    const idx = mcCorrectIndex(opts, raw);
    if (idx >= 0) return `گزینهٔ ${faNum(idx + 1)} — ${opts[idx]}`;
    return raw;
  }
  return raw;
}

// Question preview card — used in exam detail dialog + AI generator results
export function QuestionPreviewCard({ q, index }: { q: QuestionLike; index: number }) {
  const options = q.options ?? [];
  const showOptions =
    options.length > 0 && (q.type === "MULTIPLE_CHOICE" || q.type === "TRUE_FALSE");
  const correctIdx =
    q.type === "MULTIPLE_CHOICE"
      ? mcCorrectIndex(options, String(q.correctAnswer))
      : q.type === "TRUE_FALSE" && options.length >= 2
        ? mcCorrectIndex(options, correctAnswerLabel(q))
        : -1;

  return (
    <Card className="border-border/60">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="secondary" className="text-[10px]">
            {QUESTION_TYPE_LABELS_FA[q.type] ?? q.type}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {DIFFICULTY_LABELS_FA[q.difficulty ?? "MEDIUM"] ?? q.difficulty}
          </Badge>
          <Badge variant="outline" className="text-[10px] tabular-nums">
            {faNum(q.points ?? 1)} نمره
          </Badge>
          {q.aiGenerated && (
            <Badge className="text-[10px] gap-1">
              <Sparkles className="h-3 w-3" aria-hidden /> هوشمند
            </Badge>
          )}
          {q.topic && <span className="text-[10px] text-muted-foreground">مبحث: {q.topic}</span>}
        </div>

        <p className="text-sm font-medium leading-7">
          <span className="text-muted-foreground tabular-nums ml-1">{faNum(index + 1)}.</span>
          {q.prompt}
        </p>

        {showOptions && (
          <ul className="space-y-1.5">
            {options.map((o, i) => {
              const isCorrect = i === correctIdx;
              return (
                <li
                  key={i}
                  className={cn(
                    "rounded-lg px-3 py-2 text-xs leading-6 border flex items-center gap-2",
                    isCorrect
                      ? "border-emerald-500/40 bg-emerald-500/10 font-bold"
                      : "border-border/60 bg-muted/40"
                  )}
                >
                  <span className="tabular-nums text-muted-foreground shrink-0">{faNum(i + 1)}.</span>
                  <span className="min-w-0 flex-1">{o}</span>
                  {isCorrect && <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" aria-hidden />}
                </li>
              );
            })}
          </ul>
        )}

        <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/25 px-3 py-2 text-xs flex items-start gap-2">
          <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" aria-hidden />
          <span className="text-emerald-700 dark:text-emerald-400 leading-6 min-w-0">
            <span className="font-bold">پاسخ صحیح: </span>
            {correctAnswerLabel(q)}
          </span>
        </div>

        {q.explanation && (
          <div className="rounded-lg bg-muted px-3 py-2 text-xs leading-6 text-muted-foreground flex items-start gap-2">
            <Lightbulb className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden />
            <span className="whitespace-pre-wrap min-w-0">{q.explanation}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
