"use client";

// School Admin — معلم‌ها (spec §20): list + onboarding dialog

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, ApiClientError } from "@/lib/app/api-client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageTitle, EmptyState, ErrorState, faDate } from "@/components/shared/blocks";
import { UserPlus, Users, Loader2, BookOpen } from "lucide-react";
import { isValidEmail, type TeacherRow } from "./shared";
import { StatusBadge, TableSkeleton } from "./ui-bits";

export function TeachersSection({ onChanged }: { onChanged?: () => void }) {
  const [teachers, setTeachers] = useState<TeacherRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    let ignore = false;
    async function start() {
      try {
        const res = await api<{ teachers: TeacherRow[] }>("/api/v1/admin/teachers");
        if (!ignore) {
          setTeachers(res.teachers);
          setError(null);
        }
      } catch (e) {
        if (!ignore) setError(e instanceof ApiClientError ? e.message : "بارگذاری فهرست معلم‌ها ناموفق بود.");
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
        title="معلم‌های مدرسه"
        description="فهرست معلم‌ها و کلاس‌های تدریسی آن‌ها — ایجاد حساب از دکمهٔ زیر."
        action={
          <Button onClick={() => setCreateOpen(true)} className="h-10">
            <UserPlus className="h-4 w-4 ml-1.5" aria-hidden />
            افزودن معلم
          </Button>
        }
      />

      {error && <ErrorState message={error} onRetry={() => void reload()} />}

      {!teachers && !error && <TableSkeleton rows={4} cols={5} />}

      {teachers && teachers.length === 0 && !error && (
        <EmptyState
          icon={Users}
          title="هنوز معلمی ثبت نشده است."
          description="برای ایجاد کلاس و شروع آموزش، ابتدا اولین معلم مدرسه را اضافه کنید."
          action={
            <Button onClick={() => setCreateOpen(true)} className="h-10">
              <UserPlus className="h-4 w-4 ml-1.5" aria-hidden />
              افزودن اولین معلم
            </Button>
          }
        />
      )}

      {teachers && teachers.length > 0 && (
        <div className="rounded-xl border border-border/60 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right min-w-[150px]">نام معلم</TableHead>
                <TableHead className="text-right hidden md:table-cell">ایمیل</TableHead>
                <TableHead className="text-right min-w-[200px]">کلاس‌های تدریسی</TableHead>
                <TableHead className="text-right">وضعیت</TableHead>
                <TableHead className="text-right hidden lg:table-cell whitespace-nowrap">تاریخ عضویت</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {teachers.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="py-3.5 font-medium">{t.fullName}</TableCell>
                  <TableCell className="py-3.5 hidden md:table-cell text-muted-foreground">
                    {t.email ? <span dir="ltr" className="text-xs">{t.email}</span> : "—"}
                  </TableCell>
                  <TableCell className="py-3.5">
                    {t.taughtClassrooms.length === 0 ? (
                      <span className="text-xs text-muted-foreground">بدون کلاس</span>
                    ) : (
                      <span className="flex items-center gap-1.5 flex-wrap">
                        {t.taughtClassrooms.map((c) => (
                          <Badge key={c.id} variant="outline" className="font-normal">
                            <BookOpen className="h-3 w-3 ml-1" aria-hidden />
                            {c.name}
                          </Badge>
                        ))}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="py-3.5"><StatusBadge status={t.status} /></TableCell>
                  <TableCell className="py-3.5 hidden lg:table-cell text-muted-foreground whitespace-nowrap">
                    {faDate(t.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <CreateTeacherDialog
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

function CreateTeacherDialog({
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
          <DialogTitle>افزودن معلم جدید</DialogTitle>
          <DialogDescription>
            حساب معلم در مدرسهٔ شما ایجاد می‌شود؛ معلم با همین ایمیل و رمز عبور می‌تواند وارد پلتفرم شود.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <CreateTeacherForm
            onCreated={(name) => {
              onOpenChange(false);
              onCreated();
              toast({ title: "معلم جدید ایجاد شد", description: name });
            }}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CreateTeacherForm({
  onCreated,
  onCancel,
}: {
  onCreated: (fullName: string) => void;
  onCancel: () => void;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
        body: JSON.stringify({ fullName: name, email: mail, password, role: "TEACHER" }),
      });
      onCreated(name);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "ایجاد حساب معلم ناموفق بود.");
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
        <Label htmlFor="teacher-name">نام و نام خانوادگی</Label>
        <Input
          id="teacher-name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="مثال: مریم محمدی"
          disabled={submitting}
          className="h-10"
          autoComplete="off"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="teacher-email">ایمیل</Label>
        <Input
          id="teacher-email"
          type="text"
          inputMode="email"
          dir="ltr"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="teacher@school.ir"
          disabled={submitting}
          className="h-10 text-left"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="teacher-password">رمز عبور</Label>
        <Input
          id="teacher-password"
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
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting} className="h-10">
          انصراف
        </Button>
        <Button type="submit" disabled={submitting} className="h-10 min-w-[140px]">
          {submitting && <Loader2 className="h-4 w-4 ml-1.5 animate-spin" aria-hidden />}
          {submitting ? "در حال ایجاد…" : "ایجاد حساب معلم"}
        </Button>
      </DialogFooter>
    </form>
  );
}
