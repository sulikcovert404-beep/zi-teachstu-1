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
  faDate,
} from "@/components/shared/blocks";
import { useToast } from "@/hooks/use-toast";
import { BookOpen, ExternalLink, FolderOpen, Link2, Loader2, Plus } from "lucide-react";
import type { ClassResource, TeacherClass } from "./types";

// Class resources (spec §3.3 / §20 Teacher/منابع) — list + add dialog
export function ResourcesSection() {
  const [data, setData] = useState<{ resources: ClassResource[]; classes: TeacherClass[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [addOpen, setAddOpen] = useState(false);

  useEffect(() => {
    let ignore = false;
    async function start() {
      try {
        const [resources, classes] = await Promise.all([
          api<{ resources: ClassResource[] }>("/api/v1/teacher/resources"),
          api<{ classes: TeacherClass[] }>("/api/v1/teacher/classes"),
        ]);
        if (!ignore) {
          setData({ resources: resources.resources, classes: classes.classes });
          setError(null);
        }
      } catch (e) {
        if (!ignore)
          setError(e instanceof ApiClientError ? e.message : "بارگذاری منابع ناموفق بود.");
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
        title="منابع آموزشی کلاس"
        description="جزوه‌ها، لینک‌ها و منابعی که برای دانش‌آموزان کلاس‌های خود به اشتراک می‌گذارید."
        action={
          <Button className="h-10" onClick={() => setAddOpen(true)} disabled={data?.classes.length === 0}>
            <Plus className="h-4 w-4 ml-1.5" aria-hidden /> افزودن منبع
          </Button>
        }
      />

      {data?.classes.length === 0 && (
        <EmptyState
          icon={FolderOpen}
          title="برای افزودن منبع ابتدا باید کلاسی داشته باشید."
          description="کلاس‌ها توسط مدیر مدرسه ایجاد و به شما نسبت داده می‌شوند."
        />
      )}

      {error && (
        <div className="mb-4">
          <ErrorState message={error} onRetry={() => void reload()} />
        </div>
      )}

      {!data && !error && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="border-border/60">
              <CardContent className="p-4 space-y-3">
                <Skeleton className="h-5 w-36" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-9 w-28 rounded-lg" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {data && data.classes.length > 0 && data.resources.length === 0 && (
        <EmptyState
          icon={FolderOpen}
          title="هنوز منبعی ثبت نشده است."
          description="جزوه، لینک یا مرجع آموزشی کلاس خود را با دکمهٔ «افزودن منبع» به اشتراک بگذارید."
          action={
            <Button className="h-10" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4 ml-1.5" aria-hidden /> افزودن اولین منبع
            </Button>
          }
        />
      )}

      {data && data.resources.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.resources.map((r) => (
            <Card key={r.id} className="border-border/60 flex flex-col">
              <CardContent className="p-4 space-y-3 flex-1 flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-bold text-sm leading-6 min-w-0">{r.title}</p>
                  <Badge variant="secondary" className="text-[10px] shrink-0">
                    {r.classroom.name}
                  </Badge>
                </div>
                {r.description && (
                  <p className="text-xs text-muted-foreground leading-6 line-clamp-3">{r.description}</p>
                )}
                <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                  <span className="text-[11px] text-muted-foreground">{faDate(r.createdAt)}</span>
                  {r.url ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9"
                      onClick={() => window.open(r.url as string, "_blank", "noopener,noreferrer")}
                      aria-label={`باز کردن لینک ${r.title}`}
                    >
                      <ExternalLink className="h-4 w-4 ml-1" aria-hidden />
                      باز کردن لینک
                    </Button>
                  ) : (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground gap-1">
                      <BookOpen className="h-3 w-3" aria-hidden /> بدون لینک
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AddResourceDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        classes={data?.classes ?? []}
        onCreated={reload}
      />
    </div>
  );
}

function AddResourceDialog({
  open,
  onOpenChange,
  classes,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classes: TeacherClass[];
  onCreated: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <AddResourceForm
          classes={classes}
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

function AddResourceForm({
  classes,
  onDone,
  onCancel,
}: {
  classes: TeacherClass[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const [classroomId, setClassroomId] = useState(() => classes[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    if (!classroomId) {
      toast({ title: "کلاس را انتخاب کنید", variant: "destructive" });
      return;
    }
    if (title.trim().length < 2) {
      toast({ title: "عنوان منبع الزامی است.", variant: "destructive" });
      return;
    }
    if (url.trim() && !/^https?:\/\/.+/i.test(url.trim())) {
      toast({ title: "آدرس لینک معتبر نیست.", description: "لینک باید با http یا https شروع شود.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      await api("/api/v1/teacher/resources", {
        method: "POST",
        body: JSON.stringify({
          classroomId,
          title: title.trim(),
          description: description.trim() || undefined,
          url: url.trim() || undefined,
        }),
      });
      toast({ title: "منبع ثبت شد", description: `«${title.trim()}» برای کلاس به اشتراک گذاشته شد.` });
      onDone();
    } catch (e) {
      toast({
        title: "ثبت منبع ناموفق بود",
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
          <FolderOpen className="h-5 w-5 text-primary" aria-hidden />
          افزودن منبع آموزشی
        </DialogTitle>
        <DialogDescription>منبع برای دانش‌آموزان کلاس انتخاب‌شده قابل مشاهده خواهد بود.</DialogDescription>
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
          <Label htmlFor="rs-title" className="text-xs">عنوان منبع</Label>
          <Input
            id="rs-title"
            dir="auto"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="مثلاً: جزوهٔ فصل ۳ — تابع"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="rs-desc" className="text-xs">توضیحات (اختیاری)</Label>
          <Textarea
            id="rs-desc"
            dir="auto"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="توضیح کوتاه دربارهٔ محتوای منبع…"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="rs-url" className="text-xs flex items-center gap-1">
            <Link2 className="h-3.5 w-3.5" aria-hidden /> لینک (اختیاری)
          </Label>
          <Input
            id="rs-url"
            dir="ltr"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/lesson-notes"
          />
        </div>
      </div>

      <DialogFooter className="gap-2">
        <Button variant="outline" className="h-10" onClick={onCancel} disabled={busy}>
          انصراف
        </Button>
        <Button className="h-10" onClick={() => void submit()} disabled={busy || !classroomId}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin ml-1.5" aria-hidden /> : <Plus className="h-4 w-4 ml-1.5" aria-hidden />}
          {busy ? "در حال ذخیره…" : "ذخیرهٔ منبع"}
        </Button>
      </DialogFooter>
    </div>
  );
}
