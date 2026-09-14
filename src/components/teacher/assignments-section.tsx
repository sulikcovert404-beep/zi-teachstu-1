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
import { Skeleton } from "@/components/ui/skeleton";
import {
  EmptyState,
  ErrorState,
  PageTitle,
  faDateTime,
  faNum,
} from "@/components/shared/blocks";
import { useToast } from "@/hooks/use-toast";
import { CalendarDays, ClipboardList, FileCheck2, Loader2, Plus } from "lucide-react";
import { ASSIGNMENT_STATUS_FA, type TeacherAssignment, type TeacherClass, type TeacherExam } from "./types";

interface AssignmentsPayload {
  assignments: TeacherAssignment[];
  classes: TeacherClass[];
  exams: TeacherExam[];
}

// Assignments (spec §20 Teacher/تکالیف) — list + create dialog
export function AssignmentsSection() {
  const [data, setData] = useState<AssignmentsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    let ignore = false;
    async function start() {
      try {
        const [assignments, classes, exams] = await Promise.all([
          api<{ assignments: TeacherAssignment[] }>("/api/v1/teacher/assignments"),
          api<{ classes: TeacherClass[] }>("/api/v1/teacher/classes"),
          api<{ exams: TeacherExam[] }>("/api/v1/teacher/exams"),
        ]);
        if (!ignore) {
          setData({
            assignments: assignments.assignments,
            classes: classes.classes,
            exams: exams.exams,
          });
          setError(null);
        }
      } catch (e) {
        if (!ignore)
          setError(e instanceof ApiClientError ? e.message : "بارگذاری تکالیف ناموفق بود.");
      }
    }
    void start();
    return () => {
      ignore = true;
    };
  }, [reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  return (
    <div className="space-y-4">
      <PageTitle
        title="تکالیف و آزمون‌های کلاس"
        description="تکلیف‌های منتشرشدهٔ شما برای کلاس‌ها، همراه با وضعیت تصحیح."
        action={
          <Button className="h-10" onClick={() => setCreateOpen(true)} disabled={data?.classes.length === 0}>
            <Plus className="h-4 w-4 ml-1.5" aria-hidden />
            ایجاد تکلیف
          </Button>
        }
      />

      {data?.classes.length === 0 && (
        <EmptyState
          icon={ClipboardList}
          title="برای ایجاد تکلیف ابتدا باید کلاسی داشته باشید."
          description="کلاس‌ها توسط مدیر مدرسه ایجاد و به شما نسبت داده می‌شوند."
        />
      )}

      {error && (
        <div className="mb-4">
          <ErrorState message={error} onRetry={() => void reload()} />
        </div>
      )}

      {!data && !error && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      )}

      {data && data.classes.length > 0 && data.assignments.length === 0 && (
        <EmptyState
          icon={ClipboardList}
          title="هنوز تکلیفی ایجاد نکرده‌اید."
          description="با دکمهٔ «ایجاد تکلیف» اولین تکلیف یا آزمون کلاسی خود را منتشر کنید."
          action={
            <Button className="h-10" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 ml-1.5" aria-hidden /> ایجاد اولین تکلیف
            </Button>
          }
        />
      )}

      {data && data.assignments.length > 0 && (
        <div className="grid gap-4">
          {data.assignments.map((a) => (
            <AssignmentCard key={a.id} assignment={a} />
          ))}
        </div>
      )}

      <CreateAssignmentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        classes={data?.classes ?? []}
        exams={data?.exams ?? []}
        onCreated={reload}
      />
    </div>
  );
}

function AssignmentCard({ assignment: a }: { assignment: TeacherAssignment }) {
  const due = a.dueAt ? new Date(a.dueAt) : null;
  const overdue = due !== null && due.getTime() < Date.now();
  const statusLabel = ASSIGNMENT_STATUS_FA[a.status] ?? a.status;

  return (
    <Card className="border-border/60">
      <CardContent className="p-4 flex flex-wrap items-center gap-4">
        <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          {a.exam ? <FileCheck2 className="h-5.5 w-5.5" aria-hidden /> : <ClipboardList className="h-5.5 w-5.5" aria-hidden />}
        </div>
        <div className="min-w-0 flex-1 basis-52">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-bold text-sm">{a.title}</p>
            <Badge variant={a.status === "PUBLISHED" ? "secondary" : "outline"} className="text-[10px]">
              {statusLabel}
            </Badge>
            {a.exam && (
              <Badge variant="outline" className="text-[10px] tabular-nums">
                آزمون {faNum(a.exam.durationMinutes)} دقیقه‌ای
              </Badge>
            )}
          </div>
          {a.description && (
            <p className="text-xs text-muted-foreground mt-1 leading-6 line-clamp-2">{a.description}</p>
          )}
          <p className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-1.5 flex-wrap">
            <span>{a.classroom.name}</span>
            <span aria-hidden>·</span>
            {a.dueAt && (
              <span className={overdue ? "text-destructive font-medium" : ""}>
                مهلت: {faDateTime(a.dueAt)}
              </span>
            )}
            {a.gradedAttempts > 0 && (
              <>
                <span aria-hidden>·</span>
                <span className="tabular-nums">{faNum(a.gradedAttempts)} پاسخ دریافت‌شده</span>
              </>
            )}
          </p>
        </div>
        <div className="shrink-0">
          {a.gradedAttempts > 0 ? (
            <Badge className="bg-emerald-600 tabular-nums">
              {faNum(a.gradedAttempts)} نتیجه
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">در انتظار پاسخ</Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function CreateAssignmentDialog({
  open,
  onOpenChange,
  classes,
  exams,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classes: TeacherClass[];
  exams: TeacherExam[];
  onCreated: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <CreateAssignmentForm
          classes={classes}
          linkableExams={exams.filter((e) => e.questionCount > 0)}
          onDone={() => {
            onOpenChange(false);
            onCreated();
          }}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function CreateAssignmentForm({
  classes,
  linkableExams,
  onDone,
  onCancel,
}: {
  classes: TeacherClass[];
  linkableExams: TeacherExam[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const [classroomId, setClassroomId] = useState(() => classes[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [examId, setExamId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [closeAt, setCloseAt] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    if (!classroomId) {
      toast({ title: "کلاس را انتخاب کنید", variant: "destructive" });
      return;
    }
    if (title.trim().length < 3) {
      toast({
        title: "عنوان تکلیف باید حداقل ۳ کاراکتر باشد.",
        variant: "destructive",
      });
      return;
    }
    setBusy(true);
    try {
      await api("/api/v1/teacher/assignments", {
        method: "POST",
        body: JSON.stringify({
          classroomId,
          title: title.trim(),
          description: description.trim() || undefined,
          examId: examId && examId !== "none" ? examId : undefined,
          dueAt: dueAt || null,
          closeAt: closeAt || null,
          publishNow: true,
        }),
      });
      toast({
        title: "تکلیف منتشر شد",
        description: `تکلیف «${title.trim()}» برای دانش‌آموزان کلاس ارسال شد.`,
      });
      onDone();
    } catch (e) {
      toast({
        title: "ایجاد تکلیف ناموفق بود",
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
            <ClipboardList className="h-5 w-5 text-primary" aria-hidden />
            ایجاد تکلیف جدید
          </DialogTitle>
          <DialogDescription>
            تکلیف بلافاصله برای دانش‌آموزان کلاس انتخاب‌شده منتشر می‌شود.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">کلاس</Label>
            <Select value={classroomId} onValueChange={setClassroomId}>
              <SelectTrigger className="w-full"><SelectValue placeholder="یک کلاس انتخاب کنید" /></SelectTrigger>
              <SelectContent>
                {classes.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} — پایه {c.grade}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="as-title" className="text-xs">عنوان تکلیف</Label>
            <Input
              id="as-title"
              dir="auto"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="مثلاً: تمرین‌های فصل ۳"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="as-desc" className="text-xs">توضیحات (اختیاری)</Label>
            <Textarea
              id="as-desc"
              dir="auto"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="دستور کار، منبع یا نکات مهم تکلیف…"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">پیوند به آزمون (اختیاری)</Label>
            {linkableExams.length === 0 ? (
              <p className="text-[11px] text-muted-foreground leading-5 rounded-lg border border-dashed border-border/70 bg-muted/30 px-3 py-2.5">
                آزمونی با سؤال برای پیوند وجود ندارد؛ ابتدا از بخش «آزمون‌ها» آزمون بسازید.
              </p>
            ) : (
              <Select value={examId} onValueChange={setExamId}>
                <SelectTrigger className="w-full"><SelectValue placeholder="بدون آزمون — تکلیف ساده" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">بدون آزمون — تکلیف ساده</SelectItem>
                  {linkableExams.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.title} ({faNum(e.questionCount)} سؤال)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="as-due" className="text-xs flex items-center gap-1">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden /> مهلت انجام (اختیاری)
              </Label>
              <Input
                id="as-due"
                type="datetime-local"
                dir="ltr"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="as-close" className="text-xs flex items-center gap-1">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden /> بستن نهایی (اختیاری)
              </Label>
              <Input
                id="as-close"
                type="datetime-local"
                dir="ltr"
                value={closeAt}
                onChange={(e) => setCloseAt(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-10" onClick={onCancel} disabled={busy}>
            انصراف
          </Button>
          <Button className="h-10" onClick={() => void submit()} disabled={busy || !classroomId}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin ml-1.5" aria-hidden /> : <Plus className="h-4 w-4 ml-1.5" aria-hidden />}
            {busy ? "در حال انتشار…" : "انتشار تکلیف"}
          </Button>
        </DialogFooter>
    </div>
  );
}
