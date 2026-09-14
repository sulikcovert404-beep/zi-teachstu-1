"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/app/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  EmptyState,
  ErrorState,
  PageTitle,
  faDate,
  faNum,
} from "@/components/shared/blocks";
import { QuestionPreviewCard } from "./shared";
import { CreateExamDialog } from "./create-exam-dialog";
import { Clock, FileCheck2, HelpCircle, ListChecks, Plus, Users } from "lucide-react";
import { EXAM_STATUS_FA, type ExamDetail, type TeacherExam } from "./types";

// Exams (spec §20 Teacher/آزمون‌ها) — list + detail dialog + manual builder
export function ExamsSection() {
  const [exams, setExams] = useState<TeacherExam[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    async function start() {
      try {
        const res = await api<{ exams: TeacherExam[] }>("/api/v1/teacher/exams");
        if (!ignore) {
          setExams(res.exams);
          setError(null);
        }
      } catch (e) {
        if (!ignore)
          setError(e instanceof ApiClientError ? e.message : "بارگذاری آزمون‌ها ناموفق بود.");
      }
    }
    void start();
    return () => {
      ignore = true;
    };
  }, [reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const selected = exams?.find((e) => e.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      <PageTitle
        title="آزمون‌های من"
        description="آزمون‌های ساخته‌شده توسط شما؛ سؤال‌ها و پاسخ‌ها در هر آزمون قابل مشاهده است."
        action={
          <Button className="h-10" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 ml-1.5" aria-hidden /> ایجاد آزمون
          </Button>
        }
      />

      {error && (
        <div className="mb-4">
          <ErrorState message={error} onRetry={() => void reload()} />
        </div>
      )}

      {!exams && !error && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="border-border/60">
              <CardContent className="p-4 space-y-3">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-9 w-full rounded-lg" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {exams && exams.length === 0 && (
        <EmptyState
          icon={FileCheck2}
          title="هنوز آزمونی نساخته‌اید."
          description="آزمون را به‌صورت دستی بسازید یا از بخش «تولید سؤال هوشمند» از متن درس، آزمون تولید کنید."
          action={
            <Button className="h-10" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 ml-1.5" aria-hidden /> ایجاد اولین آزمون
            </Button>
          }
        />
      )}

      {exams && exams.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {exams.map((e) => (
            <Card key={e.id} className="border-border/60 flex flex-col">
              <CardContent className="p-4 space-y-3 flex-1 flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-bold text-sm leading-6 min-w-0">{e.title}</p>
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    {EXAM_STATUS_FA[e.status] ?? e.status}
                  </Badge>
                </div>
                {e.description && (
                  <p className="text-xs text-muted-foreground leading-6 line-clamp-2">{e.description}</p>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="secondary" className="text-[10px] tabular-nums gap-1">
                    <Clock className="h-3 w-3" aria-hidden /> {faNum(e.durationMinutes)} دقیقه
                  </Badge>
                  <Badge variant="secondary" className="text-[10px] tabular-nums gap-1">
                    <HelpCircle className="h-3 w-3" aria-hidden /> {faNum(e.questionCount)} سؤال
                  </Badge>
                  <Badge variant="secondary" className="text-[10px] tabular-nums gap-1">
                    <Users className="h-3 w-3" aria-hidden /> {faNum(e.attemptCount)} شرکت‌کننده
                  </Badge>
                </div>
                <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                  <span className="text-[11px] text-muted-foreground">{faDate(e.createdAt)}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9"
                    onClick={() => setSelectedId(e.id)}
                    disabled={e.questionCount === 0}
                    aria-label={`مشاهدهٔ سؤال‌های آزمون ${e.title}`}
                  >
                    <ListChecks className="h-4 w-4 ml-1" aria-hidden />
                    مشاهدهٔ سؤال‌ها
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selected && <ExamDetailDialog examId={selected.id} onClose={() => setSelectedId(null)} />}

      <CreateExamDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={reload}
      />
    </div>
  );
}

// Full exam detail (questions + correct answers + explanations)
function ExamDetailDialog({ examId, onClose }: { examId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<ExamDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    async function start() {
      try {
        const res = await api<ExamDetail>(`/api/v1/teacher/exams/${examId}`);
        if (!ignore) {
          setDetail(res);
          setError(null);
        }
      } catch (e) {
        if (!ignore)
          setError(e instanceof ApiClientError ? e.message : "بارگذاری آزمون ناموفق بود.");
      }
    }
    void start();
    return () => {
      ignore = true;
    };
  }, [examId]);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <FileCheck2 className="h-5 w-5 text-primary" aria-hidden />
            {detail?.title ?? "جزئیات آزمون"}
          </DialogTitle>
          {detail && (
            <DialogDescription className="flex items-center gap-2 flex-wrap">
              <span className="tabular-nums">{faNum(detail.durationMinutes)} دقیقه</span>
              <span aria-hidden>·</span>
              <span className="tabular-nums">{faNum(detail.questions.length)} سؤال</span>
              <span aria-hidden>·</span>
              <span>{EXAM_STATUS_FA[detail.status] ?? detail.status}</span>
              {detail.description && <span aria-hidden>·</span>}
              {detail.description && <span className="truncate">{detail.description}</span>}
            </DialogDescription>
          )}
        </DialogHeader>

        {error && <ErrorState message={error} onRetry={onClose} />}

        {!detail && !error && (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-40 w-full rounded-xl" />
            ))}
          </div>
        )}

        {detail && detail.questions.length === 0 && (
          <EmptyState
            icon={HelpCircle}
            title="این آزمون هنوز سؤالی ندارد."
            description="آزمون بدون سؤال قابل انتساب به تکلیف نیست؛ سؤال اضافه کنید."
          />
        )}

        {detail && detail.questions.length > 0 && (
          <div className="space-y-3">
            {detail.questions.map((q, i) => (
              <QuestionPreviewCard key={q.id} q={q} index={i} />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
