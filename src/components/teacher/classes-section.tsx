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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  EmptyState,
  ErrorState,
  LoadingGrid,
  PageTitle,
  faNum,
} from "@/components/shared/blocks";
import { GraduationCap, Mail, School, Users } from "lucide-react";
import type { ClassStudent, TeacherClass } from "./types";

// Classes + students (spec §20 Teacher/کلاس‌ها و دانش‌آموزان)
export function ClassesSection() {
  const [classes, setClasses] = useState<TeacherClass[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<TeacherClass | null>(null);

  useEffect(() => {
    let ignore = false;
    async function start() {
      try {
        const res = await api<{ classes: TeacherClass[] }>("/api/v1/teacher/classes");
        if (!ignore) {
          setClasses(res.classes);
          setError(null);
        }
      } catch (e) {
        if (!ignore)
          setError(e instanceof ApiClientError ? e.message : "بارگذاری کلاس‌ها ناموفق بود.");
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
        title="کلاس‌ها و دانش‌آموزان"
        description="فهرست کلاس‌های محول‌شده به شما و عملکرد دانش‌آموزان هر کلاس."
      />

      {error && (
        <div className="mb-4">
          <ErrorState message={error} onRetry={() => void reload()} />
        </div>
      )}

      {!classes && !error && <LoadingGrid count={4} />}

      {classes && classes.length === 0 && (
        <EmptyState
          icon={School}
          title="هنوز کلاسی ثبت نشده است."
          description="کلاس‌های شما توسط مدیر مدرسه ایجاد و به شما نسبت داده می‌شوند؛ پس از آن اینجا نمایش داده می‌شود."
        />
      )}

      {classes && classes.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {classes.map((c) => (
            <Card key={c.id} className="border-border/60">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-sm truncate">{c.name}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate flex items-center gap-1">
                      <School className="h-3 w-3 shrink-0" aria-hidden />
                      {c.schoolName}
                    </p>
                  </div>
                  <Badge variant="outline" className="shrink-0">پایه {c.grade}</Badge>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                  <span className="flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" aria-hidden />
                    {faNum(c.studentCount)} دانش‌آموز
                  </span>
                  <span className="flex items-center gap-1.5 tabular-nums">
                    {faNum(c.assignmentsCount)} تکلیف
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="secondary">{c.subject}</Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9"
                    onClick={() => setSelected(c)}
                    aria-label={`دانش‌آموزان کلاس ${c.name}`}
                  >
                    <GraduationCap className="h-4 w-4 ml-1" aria-hidden />
                    دانش‌آموزان
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selected && (
        <StudentsDialog classroom={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

// Lazy-loaded students roster for one classroom (server-side ownership enforced)
function StudentsDialog({
  classroom,
  onClose,
}: {
  classroom: TeacherClass;
  onClose: () => void;
}) {
  const [students, setStudents] = useState<ClassStudent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    async function start() {
      try {
        const res = await api<{ students: ClassStudent[] }>(
          `/api/v1/teacher/classes/${classroom.id}/students`
        );
        if (!ignore) {
          setStudents(res.students);
          setError(null);
        }
      } catch (e) {
        if (!ignore)
          setError(e instanceof ApiClientError ? e.message : "بارگذاری دانش‌آموزان ناموفق بود.");
      }
    }
    void start();
    return () => {
      ignore = true;
    };
  }, [classroom.id]);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <GraduationCap className="h-5 w-5 text-primary" aria-hidden />
            دانش‌آموزان کلاس «{classroom.name}»
          </DialogTitle>
          <DialogDescription>
            پایه {classroom.grade} · درس {classroom.subject} · {classroom.schoolName}
          </DialogDescription>
        </DialogHeader>

        {error && <ErrorState message={error} onRetry={onClose} />}

        {!students && !error && (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-xl" />
            ))}
          </div>
        )}

        {students && students.length === 0 && (
          <EmptyState
            icon={Users}
            title="هنوز دانش‌آموزی در این کلاس ثبت‌نام نشده است."
            description="ثبت‌نام دانش‌آموزان توسط مدیر مدرسه انجام می‌شود."
          />
        )}

        {students && students.length > 0 && (
          <div className="rounded-lg border border-border/60 overflow-hidden">
            <div className="max-h-96 overflow-auto">
              <Table className="min-w-[560px]">
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead className="text-right">دانش‌آموز</TableHead>
                    <TableHead className="text-right">پایه</TableHead>
                    <TableHead className="text-right">آزمون‌های انجام‌شده</TableHead>
                    <TableHead className="text-right">میانگین نمره</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {students.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="text-right">
                        <p className="font-bold text-sm">{s.fullName}</p>
                        {s.email && (
                          <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                            <Mail className="h-3 w-3 shrink-0" aria-hidden />
                            <span dir="ltr" className="truncate">{s.email}</span>
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {s.grade ?? "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {faNum(s.examsTaken)}
                      </TableCell>
                      <TableCell className="text-right">
                        {s.avgScore === null ? (
                          <span className="text-sm text-muted-foreground">—</span>
                        ) : (
                          <Badge
                            variant={s.avgScore >= 50 ? "default" : "destructive"}
                            className="tabular-nums"
                          >
                            {faNum(s.avgScore)}٪
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
