"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/app/api-client";
import { FEATURE_LABELS_FA } from "@/lib/app/labels";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { EmptyState, ErrorState, PageTitle, faDateTime } from "@/components/shared/blocks";
import { ToggleRight, Loader2 } from "lucide-react";
import type { FeatureFlagRow } from "./types";

function flagLabelFa(key: string): { label: string; known: boolean } {
  const stripped = key.replace(/^feature\./, "");
  const label = FEATURE_LABELS_FA[stripped];
  return label ? { label, known: true } : { label: stripped, known: false };
}

// Spec §80 — فلگ‌های قابلیت: روشن/خاموش کردن سراسری قابلیت‌ها با ثبت در ردیابی
export function FeatureFlagsSection() {
  const { toast } = useToast();
  const [flags, setFlags] = useState<FeatureFlagRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    async function start() {
      try {
        const res = await api<{ flags: FeatureFlagRow[] }>("/api/v1/platform/feature-flags");
        if (!ignore) {
          setFlags(res.flags);
          setError(null);
        }
      } catch (e) {
        if (!ignore) setError(e instanceof ApiClientError ? e.message : "بارگذاری فلگ‌ها ناموفق بود.");
      }
    }
    void start();
    return () => {
      ignore = true;
    };
  }, [reloadKey]);

  const load = useCallback(() => setReloadKey((k) => k + 1), []);

  const toggle = useCallback(
    async (key: string, enabled: boolean) => {
      setPendingKey(key);
      try {
        await api<{ flag: FeatureFlagRow }>("/api/v1/platform/feature-flags", {
          method: "POST",
          body: JSON.stringify({ key, enabled }),
        });
        toast({
          title: "فلگ قابلیت به‌روزرسانی شد",
          description: `«${flagLabelFa(key).label}» ${enabled ? "فعال" : "غیرفعال"} شد.`,
        });
        load();
      } catch (e) {
        toast({
          title: "به‌روزرسانی فلگ ناموفق بود",
          description: e instanceof ApiClientError ? e.message : "ارتباط با سرور برقرار نشد.",
          variant: "destructive",
        });
      } finally {
        setPendingKey(null);
      }
    },
    [load, toast]
  );

  return (
    <div className="space-y-6">
      <PageTitle
        title="فلگ‌های قابلیت"
        description="روشن یا خاموش کردن سراسری قابلیت‌های هوش مصنوعی؛ تغییرها در ردیابی ثبت می‌شوند."
      />

      {error && <ErrorState message={error} onRetry={load} />}

      {!flags && !error && (
        <Card className="border-border/60">
          <CardContent className="p-6 space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </CardContent>
        </Card>
      )}

      {flags && flags.length === 0 && (
        <EmptyState
          icon={ToggleRight}
          title="فلگ قابلیتی ثبت نشده است"
          description="فلگ‌های سراسری قابلیت‌ها پس از تعریف اولیه در این بخش نمایش داده می‌شوند."
        />
      )}

      {flags && flags.length > 0 && (
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ToggleRight className="h-4.5 w-4.5 text-primary" aria-hidden />
              فهرست فلگ‌ها
            </CardTitle>
            <CardDescription>{flags.length} فلگ — وضعیت لحظه‌ای.</CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <ul className="divide-y divide-border/60">
              {flags.map((f) => {
                const { label, known } = flagLabelFa(f.key);
                const pending = pendingKey === f.key;
                return (
                  <li key={f.id} className="flex items-center gap-3 px-6 py-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold truncate">
                        {label}
                        {!known && <span className="sr-only"> (کلید: {f.key})</span>}
                      </p>
                      <p dir="ltr" className="text-[11px] text-muted-foreground truncate text-left">
                        {f.key}
                      </p>
                      {f.description && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{f.description}</p>
                      )}
                      {f.updatedAt && (
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          آخرین تغییر: {faDateTime(f.updatedAt)}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {f.enabled ? (
                        <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                          فعال
                        </Badge>
                      ) : (
                        <Badge variant="secondary">غیرفعال</Badge>
                      )}
                      {pending ? (
                        <Loader2 className="h-4.5 w-4.5 animate-spin text-muted-foreground" aria-label="در حال ثبت" />
                      ) : (
                        <Switch
                          checked={f.enabled}
                          onCheckedChange={(checked) => void toggle(f.key, checked)}
                          disabled={pendingKey !== null}
                          aria-label={`${f.enabled ? "غیرفعال‌سازی" : "فعال‌سازی"} قابلیت ${label}`}
                          className="scale-110"
                        />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
