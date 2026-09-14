"use client";

// School Admin — دانش‌آموزان (spec §20): list (with classroom column) + create dialog

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
import { PageTitle, EmptyState, ErrorState, faDate } from "@/components/shared/blocks";
import { UserPlus, GraduationCap, Loader2 } from "lucide-react";
import { GRADE_OPTIONS, isValidEmail, type StudentRow } from "./shared";
import { StatusBadge, TableSkeleton } from "./ui-bits";

export function StudentsSection({ onChanged }: { onChanged?: () => void }) {
  const [students, setStudents] = useState<StudentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    let ignore = false;
    async function start() {
      try {
        const res = await api<{ students: StudentRow[] }>("/api/v1/admin/students");
        if (!ignore) {
          setStudents(res.students);
          setError(null);
        }
      } catch (e) {
        if (!ignore) setError(e instanceof ApiClientError ? e.message : "بارگذاری فهرست دانش‌آموزان ناموفق بود.");
      }
    }
    void start();
    return () => {
      ignore = true;
    };
  }, [reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  return (
    <div className="space-y-6">
      <PageTitle
        title="دانش‌آموزان مدرسه"
        description="فهرست دانش‌آموزان به‌همراه کلاس ثبت‌نامی آن‌ها."
        action={
          <Button onClick={() => setCreateOpen(true)} className="h-10">
            <UserPlus className="h-4 w-4 ml-1.5" aria-hidden />
            افزودن دانش‌آموز
          </Button>
        }
      />

      {error && <ErrorState message={error} onRetry={() => void reload()} />}

      {!students && !error && <TableSkeleton rows={5} cols={5} />}

      {students && students.length === 0 && !error && (
        <EmptyState
          icon={GraduationCap}
          title="هنوز دانش‌آموزی ثبت نشده است."
          description="دانش‌آموزان مدرسه را اضافه کنید و سپس از بخش «کلاس‌ها» آن‌ها را در کلاس‌ها ثبت‌نام کنید."
          action={
            <Button onClick={() => setCreateOpen(true)} className="h-10">
              <UserPlus className="h-4 w-4 ml-1.5" aria-hidden />
              افزودن اولین دانش‌آموز
            </Button>
          }
        />
      )}

      {students && students.length > 0 && (
        <div className="rounded-xl border border-border/60 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right min-w-[170px]">دانش‌آموز</TableHead>
                <TableHead className="text-right hidden md:table-cell">ایمیل</TableHead>
                <TableHead className="text-right">پایه</TableHead>
                <TableHead className="text-right min-w-[170px]">کلاس</TableHead>
                <TableHead className="text-right">وضعیت</TableHead>
                <TableHead className="text-right hidden lg:table-cell whitespace-nowrap">تاریخ ثبت‌نام</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {students.map((s) => (
                <TableRow key={`${s.user.id}-${s.classroom?.id ?? "none"}`}>
                  <TableCell className="py-3.5">
                    <p className="font-medium">{s.user.fullName}</p>
                    <p className="text-[11px] text-muted-foreground md:hidden">
                      {s.user.email ? <span dir="ltr">{s.user.email}</span> : "—"}
                    </p>
                  </TableCell>
                  <TableCell className="py-3.5 hidden md:table-cell text-muted-foreground">
                    {s.user.email ? <span dir="ltr" className="text-xs">{s.user.email}</span> : "—"}
                  </TableCell>
                  <TableCell className="py-3.5 whitespace-nowrap">{s.user.grade ?? "—"}</TableCell>
                  <TableCell className="py-3.5">
                    {s.classroom ? (
                      <span className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm">{s.classroom.name}</span>
                        <Badge variant="outline" className="font-normal">{s.classroom.subject}</Badge>
                      </span>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">بدون کلاس</Badge>
                    )}
                  </TableCell>
                  <TableCell className="py-3.5"><StatusBadge status={s.user.status} /></TableCell>
                  <TableCell className="py-3.5 hidden lg:table-cell text-muted-foreground whitespace-nowrap">
                    {faDate(s.createdAt ?? null)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CreateStudentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          void reload();
          onChanged?.();
        }}
      />
    </div>
  );
}

function CreateStudentDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>افزودن دانش‌آموز جدید</DialogTitle>
          <DialogDescription>
            حساب دانش‌آموز در مدرسهٔ شما ایجاد می‌شود؛ پس از ایجاد، از بخش «کلاس‌ها» می‌توانید او را ثبت‌نام کنید.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <CreateStudentForm
            onCreated={(name) => {
              onOpenChange(false);
              onCreated();
              toast({ title: "دانش‌آموز جدید ایجاد شد", description: name });
            }}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CreateStudentForm({
  onCreated,
  onCancel,
}: {
  onCreated: (fullName: string) => void;
  onCancel: () => void;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [grade, setGrade] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const name = fullName.trim();
    const mail = email.trim().toLowerCase();
    if (name.length < 3) {
      setError("نام کامل باید حداقل ۳ حرف باشد.");
      return;
    }
    if (!isValidEmail(mail)) {
      setError("ایمیل معتبر نیست.");
      return;
    }
    if (password.length < 6) {
      setError("رمز عبور باید حداقل ۶ کاراکتر باشد.");
      return;
    }
    setSubmitting(true);
    try {
      await api("/api/v1/admin/users", {
        method: "POST",
        body: JSON.stringify({
          fullName: name,
          email: mail,
          password,
          role: "STUDENT",
          ...(grade ? { grade } : {}),
        }),
      });
      onCreated(name);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "ایجاد حساب دانش‌آموز ناموفق بود.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor="student-name">نام و نام خانوادگی</Label>
        <Input
          id="student-name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="مثال: الهام صادقی"
          disabled={submitting}
          className="h-10"
          autoComplete="off"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="student-email">ایمیل</Label>
        <Input
          id="student-email"
          type="text"
          inputMode="email"
          dir="ltr"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="student@school.ir"
          disabled={submitting}
          className="h-10 text-left"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="student-password">رمز عبور</Label>
        <Input
          id="student-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="حداقل ۶ کاراکتر"
          disabled={submitting}
          className="h-10"
          autoComplete="new-password"
        />
        <p className="text-[11px] text-muted-foreground">رمز عبور باید حداقل ۶ کاراکتر باشد.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="student-grade">پایهٔ تحصیلی (اختیاری)</Label>
        <Select value={grade} onValueChange={(v) => setGrade(v)} disabled={submitting}>
          <SelectTrigger id="student-grade" className="w-full h-10">
            <SelectValue placeholder="انتخاب پایه" />
          </SelectTrigger>
          <SelectContent>
            {GRADE_OPTIONS.map((g) => (
              <SelectItem key={g} value={g}>{g}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting} className="h-10">
          انصراف
        </Button>
        <Button type="submit" disabled={submitting} className="h-10 min-w-[140px]">
          {submitting && <Loader2 className="h-4 w-4 ml-1.5 animate-spin" aria-hidden />}
          {submitting ? "در حال ایجاد…" : "ایجاد حساب دانش‌آموز"}
        </Button>
      </DialogFooter>
    </form>
  );
}
