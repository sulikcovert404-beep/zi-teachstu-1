"use client";

// School Admin — کلاس‌ها (spec §20): list + create class dialog + enroll dialog

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiClientError } from "@/lib/app/api-client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { PageTitle, EmptyState, ErrorState, faNum } from "@/components/shared/blocks";
import { School, Plus, UserPlus, Loader2, Users, BookOpen, ClipboardList } from "lucide-react";
import { GRADE_OPTIONS, type ClassRow, type StudentRow, type TeacherRow } from "./shared";
import { StatusBadge, TableSkeleton } from "./ui-bits";

export function ClassesSection({ onChanged }: { onChanged?: () => void }) {
  const [classes, setClasses] = useState<ClassRow[] | null>(null);
  const [teachers, setTeachers] = useState<TeacherRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [enrollOpen, setEnrollOpen] = useState(false);

  // classes + teachers (teachers power the create-class dialog select)
  useEffect(() => {
    let ignore = false;
    async function start() {
      try {
        const [cls, tch] = await Promise.all([
          api<{ classes: ClassRow[] }>("/api/v1/admin/classes"),
          api<{ teachers: TeacherRow[] }>("/api/v1/admin/teachers"),
        ]);
        if (!ignore) {
          setClasses(cls.classes);
          setTeachers(tch.teachers);
          setError(null);
        }
      } catch (e) {
        if (!ignore) setError(e instanceof ApiClientError ? e.message : "بارگذاری فهرست کلاس‌ها ناموفق بود.");
      }
    }
    void start();
    return () => {
      ignore = true;
    };
  }, [reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const hasTeachers = (teachers?.length ?? 0) > 0;

  return (
    <div className="space-y-6">
      <PageTitle
        title="کلاس‌های مدرسه"
        description="مدیریت کلاس‌ها، ثبت‌نام دانش‌آموزان و وضعیت تکالیف."
        action={
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              onClick={() => setEnrollOpen(true)}
              disabled={!classes || classes.length === 0}
              className="h-10"
            >
              <UserPlus className="h-4 w-4 ml-1.5" aria-hidden />
              ثبت‌نام دانش‌آموز
            </Button>
            <Button onClick={() => setCreateOpen(true)} className="h-10">
              <Plus className="h-4 w-4 ml-1.5" aria-hidden />
              ایجاد کلاس
            </Button>
          </div>
        }
      />

      {error && <ErrorState message={error} onRetry={() => void reload()} />}

      {!classes && !error && <TableSkeleton rows={3} cols={6} />}

      {classes && classes.length === 0 && !error && (
        <EmptyState
          icon={School}
          title="هنوز کلاسی ایجاد نشده است."
          description={
            hasTeachers
              ? "اولین کلاس مدرسه را با انتخاب معلم و پایهٔ تحصیلی ایجاد کنید."
              : "برای ایجاد کلاس ابتدا باید از بخش «معلم‌ها» یک معلم اضافه کنید."
          }
          action={
            <Button onClick={() => setCreateOpen(true)} disabled={!hasTeachers} className="h-10">
              <Plus className="h-4 w-4 ml-1.5" aria-hidden />
              ایجاد اولین کلاس
            </Button>
          }
        />
      )}

      {classes && classes.length > 0 && (
        <div className="rounded-xl border border-border/60 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right min-w-[170px]">نام کلاس</TableHead>
                <TableHead className="text-right">پایه</TableHead>
                <TableHead className="text-right hidden sm:table-cell">درس</TableHead>
                <TableHead className="text-right min-w-[130px]">معلم</TableHead>
                <TableHead className="text-right whitespace-nowrap">دانش‌آموزان</TableHead>
                <TableHead className="text-right hidden md:table-cell whitespace-nowrap">تکالیف</TableHead>
                <TableHead className="text-right hidden lg:table-cell">وضعیت</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {classes.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="py-3.5">
                    <p className="font-medium">{c.name}</p>
                    <p className="text-[11px] text-muted-foreground">{c.schoolName}</p>
                  </TableCell>
                  <TableCell className="py-3.5 whitespace-nowrap">{c.grade}</TableCell>
                  <TableCell className="py-3.5 hidden sm:table-cell">
                    <Badge variant="outline" className="font-normal">
                      <BookOpen className="h-3 w-3 ml-1" aria-hidden />
                      {c.subject}
                    </Badge>
                  </TableCell>
                  <TableCell className="py-3.5">{c.teacher?.fullName ?? "—"}</TableCell>
                  <TableCell className="py-3.5 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <Users className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                      {faNum(c.studentCount)}
                    </span>
                  </TableCell>
                  <TableCell className="py-3.5 hidden md:table-cell whitespace-nowrap tabular-nums">
                    <span className="inline-flex items-center gap-1">
                      <ClipboardList className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                      {faNum(c.assignmentsCount)}
                    </span>
                  </TableCell>
                  <TableCell className="py-3.5 hidden lg:table-cell">
                    <StatusBadge status={c.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CreateClassDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        teachers={teachers ?? []}
        onCreated={() => {
          void reload();
          onChanged?.();
        }}
      />

      <EnrollDialog
        open={enrollOpen}
        onOpenChange={setEnrollOpen}
        classes={classes ?? []}
        onEnrolled={() => void reload()}
      />
    </div>
  );
}

function CreateClassDialog({
  open,
  onOpenChange,
  teachers,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teachers: TeacherRow[];
  onCreated: () => void;
}) {
  const { toast } = useToast();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>ایجاد کلاس جدید</DialogTitle>
          <DialogDescription>کلاس با معلم، پایه و درس مشخص در مدرسهٔ شما ایجاد می‌شود.</DialogDescription>
        </DialogHeader>
        {open && (
          <CreateClassForm
            teachers={teachers}
            onCreated={(name) => {
              onOpenChange(false);
              onCreated();
              toast({ title: "کلاس ایجاد شد", description: name });
            }}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CreateClassForm({
  teachers,
  onCreated,
  onCancel,
}: {
  teachers: TeacherRow[];
  onCreated: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [grade, setGrade] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [teacherId, setTeacherId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const clsName = name.trim();
    const subj = subject.trim();
    if (clsName.length < 3) {
      setError("نام کلاس باید حداقل ۳ حرف باشد.");
      return;
    }
    if (!grade) {
      setError("پایهٔ تحصیلی را انتخاب کنید.");
      return;
    }
    if (!subj) {
      setError("نام درس را وارد کنید.");
      return;
    }
    if (!teacherId) {
      setError("معلم کلاس را انتخاب کنید.");
      return;
    }
    setSubmitting(true);
    try {
      await api("/api/v1/admin/classes", {
        method: "POST",
        body: JSON.stringify({ name: clsName, grade, subject: subj, teacherId }),
      });
      onCreated(clsName);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "ایجاد کلاس ناموفق بود.");
      setSubmitting(false);
    }
  }

  if (teachers.length === 0) {
    return (
      <Alert>
        <AlertDescription>
          برای ایجاد کلاس ابتدا باید از بخش «معلم‌ها» یک معلم به مدرسه اضافه کنید.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor="class-name">نام کلاس</Label>
        <Input
          id="class-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="مثال: ریاضی ۱ — دهم"
          disabled={submitting}
          className="h-10"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="class-grade">پایهٔ تحصیلی</Label>
        <Select value={grade} onValueChange={(v) => setGrade(v)} disabled={submitting}>
          <SelectTrigger id="class-grade" className="w-full h-10">
            <SelectValue placeholder="انتخاب پایه" />
          </SelectTrigger>
          <SelectContent>
            {GRADE_OPTIONS.map((g) => (
              <SelectItem key={g} value={g}>{g}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="class-subject">درس</Label>
        <Input
          id="class-subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="مثال: ریاضی"
          disabled={submitting}
          className="h-10"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="class-teacher">معلم کلاس</Label>
        <Select value={teacherId} onValueChange={(v) => setTeacherId(v)} disabled={submitting}>
          <SelectTrigger id="class-teacher" className="w-full h-10">
            <SelectValue placeholder="انتخاب معلم" />
          </SelectTrigger>
          <SelectContent>
            {teachers.map((t) => (
              <SelectItem key={t.id} value={t.id}>{t.fullName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting} className="h-10">
          انصراف
        </Button>
        <Button type="submit" disabled={submitting} className="h-10 min-w-[130px]">
          {submitting && <Loader2 className="h-4 w-4 ml-1.5 animate-spin" aria-hidden />}
          {submitting ? "در حال ایجاد…" : "ایجاد کلاس"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function EnrollDialog({
  open,
  onOpenChange,
  classes,
  onEnrolled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classes: ClassRow[];
  onEnrolled: () => void;
}) {
  const { toast } = useToast();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>ثبت‌نام دانش‌آموز در کلاس</DialogTitle>
          <DialogDescription>
            دانش‌آموز و کلاس موردنظر را انتخاب کنید. اگر دانش‌آموز قبلاً در کلاس ثبت‌نام شده باشد، سرور خطای مربوط را نمایش می‌دهد.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <EnrollForm
            classes={classes}
            onEnrolled={(studentName, className) => {
              onOpenChange(false);
              onEnrolled();
              toast({ title: "ثبت‌نام انجام شد", description: `${studentName} در ${className}` });
            }}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EnrollForm({
  classes,
  onEnrolled,
  onCancel,
}: {
  classes: ClassRow[];
  onEnrolled: (studentName: string, className: string) => void;
  onCancel: () => void;
}) {
  // students are fetched fresh each time the dialog opens (form mounts on open)
  const [students, setStudents] = useState<StudentRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [classroomId, setClassroomId] = useState<string>("");
  const [studentId, setStudentId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    async function start() {
      try {
        const res = await api<{ students: StudentRow[] }>("/api/v1/admin/students");
        if (!ignore) {
          setStudents(res.students);
          setLoadError(null);
        }
      } catch (e) {
        if (!ignore) setLoadError(e instanceof ApiClientError ? e.message : "بارگذاری فهرست دانش‌آموزان ناموفق بود.");
      }
    }
    void start();
    return () => {
      ignore = true;
    };
  }, []);

  // unique students (a student enrolled in several classes appears once per membership)
  const uniqueStudents: StudentRow[] = [];
  const seen = new Set<string>();
  for (const s of students ?? []) {
    if (!seen.has(s.user.id)) {
      seen.add(s.user.id);
      uniqueStudents.push(s);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!classroomId) {
      setError("کلاس را انتخاب کنید.");
      return;
    }
    if (!studentId) {
      setError("دانش‌آموز را انتخاب کنید.");
      return;
    }
    setSubmitting(true);
    try {
      await api("/api/v1/admin/enroll", {
        method: "POST",
        body: JSON.stringify({ classroomId, studentId }),
      });
      const student = uniqueStudents.find((s) => s.user.id === studentId);
      const cls = classes.find((c) => c.id === classroomId);
      onEnrolled(student?.user.fullName ?? "دانش‌آموز", cls?.name ?? "کلاس");
    } catch (err) {
      // e.g. ALREADY_ENROLLED — Persian message from the server
      setError(err instanceof ApiClientError ? err.message : "ثبت‌نام ناموفق بود.");
      setSubmitting(false);
    }
  }

  if (loadError) {
    return <ErrorState message={loadError} />;
  }

  if (!students) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-1/2" />
      </div>
    );
  }

  if (uniqueStudents.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="هنوز دانش‌آموزی ثبت نشده است."
        description="ابتدا از بخش «دانش‌آموزان» یک دانش‌آموز اضافه کنید."
      />
    );
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor="enroll-class">کلاس</Label>
        <Select value={classroomId} onValueChange={(v) => setClassroomId(v)} disabled={submitting}>
          <SelectTrigger id="enroll-class" className="w-full h-10">
            <SelectValue placeholder="انتخاب کلاس" />
          </SelectTrigger>
          <SelectContent>
            {classes.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name} — {c.subject}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="enroll-student">دانش‌آموز</Label>
        <Select value={studentId} onValueChange={(v) => setStudentId(v)} disabled={submitting}>
          <SelectTrigger id="enroll-student" className="w-full h-10">
            <SelectValue placeholder="انتخاب دانش‌آموز" />
          </SelectTrigger>
          <SelectContent>
            {uniqueStudents.map((s) => (
              <SelectItem key={s.user.id} value={s.user.id}>
                {s.user.fullName}
                {s.user.grade ? ` — پایه ${s.user.grade}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting} className="h-10">
          انصراف
        </Button>
        <Button type="submit" disabled={submitting} className="h-10 min-w-[130px]">
          {submitting && <Loader2 className="h-4 w-4 ml-1.5 animate-spin" aria-hidden />}
          {submitting ? "در حال ثبت‌نام…" : "ثبت‌نام در کلاس"}
        </Button>
      </DialogFooter>
    </form>
  );
}
