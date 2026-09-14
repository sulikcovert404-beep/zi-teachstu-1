"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/app/api-client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { ErrorState, PageTitle, faNum } from "@/components/shared/blocks";
import { Server, ShieldCheck, Activity, XCircle, Cpu } from "lucide-react";
import { aiProviderStatusFa, type AiProviderStatus } from "./types";

function statusBadge(status: AiProviderStatus["status"]) {
  switch (status) {
    case "HEALTHY":
      return {
        className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        dot: "bg-emerald-500",
      };
    case "HEALTHY_WITH_ERRORS":
      return {
        className: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
        dot: "bg-amber-500",
      };
    case "DEGRADED":
      return { className: "", dot: "bg-red-500", destructive: true };
    default:
      return { className: "", dot: "bg-muted-foreground", secondary: true };
  }
}

// Spec §80 — ارائه‌دهنده‌های هوش مصنوعی: وضعیت زنده بدون افشای کلید/رمز
export function AiProvidersSection() {
  const [provider, setProvider] = useState<AiProviderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let ignore = false;
    async function start() {
      try {
        const res = await api<AiProviderStatus>("/api/v1/platform/ai-providers");
        if (!ignore) {
          setProvider(res);
          setError(null);
        }
      } catch (e) {
        if (!ignore)
          setError(e instanceof ApiClientError ? e.message : "بارگذاری وضعیت ارائه‌دهنده ناموفق بود.");
      }
    }
    void start();
    return () => {
      ignore = true;
    };
  }, [reloadKey]);

  const load = useCallback(() => setReloadKey((k) => k + 1), []);

  return (
    <div className="space-y-6">
      <PageTitle
        title="ارائه‌دهنده‌های هوش مصنوعی"
        description="وضعیت لحظه‌ای دروازه و ارائه‌دهنده‌های هوش مصنوعی (یک ساعت گذشته)."
      />

      {error && <ErrorState message={error} onRetry={load} />}

      {!provider && !error && (
        <Card className="border-border/60">
          <CardContent className="p-6 space-y-4">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-16 w-full" />
          </CardContent>
        </Card>
      )}

      {provider && (
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Server className="h-4.5 w-4.5 text-primary" aria-hidden />
                  ارائه‌دهنده: <span dir="ltr">{provider.provider}</span>
                </CardTitle>
                <CardDescription className="mt-1">
                  مدل فعال: <span dir="ltr">{provider.model}</span>
                </CardDescription>
              </div>
              {(() => {
                const b = statusBadge(provider.status);
                return (
                  <Badge
                    variant={provider.status === "DEGRADED" ? "destructive" : provider.status === "IDLE" ? "secondary" : "outline"}
                    className={b.className}
                  >
                    <span className={`inline-block h-1.5 w-1.5 rounded-full ml-1.5 ${b.dot}`} aria-hidden />
                    {aiProviderStatusFa(provider.status)}
                  </Badge>
                );
              })()}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="flex items-center gap-3 rounded-xl border border-border/60 p-4">
                <Activity className="h-5 w-5 text-primary shrink-0" aria-hidden />
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">فراخوانی در ساعت گذشته</p>
                  <p className="text-lg font-extrabold tabular-nums">{faNum(provider.callsLastHour)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-border/60 p-4">
                <XCircle
                  className={`h-5 w-5 shrink-0 ${provider.failedLastHour > 0 ? "text-red-500" : "text-muted-foreground"}`}
                  aria-hidden
                />
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">ناموفق در ساعت گذشته</p>
                  <p
                    className={`text-lg font-extrabold tabular-nums ${
                      provider.failedLastHour > 0 ? "text-red-600 dark:text-red-400" : ""
                    }`}
                  >
                    {faNum(provider.failedLastHour)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-xl border border-border/60 p-4">
                <Cpu className="h-5 w-5 text-primary shrink-0" aria-hidden />
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">واحد مصرف (ورودی + خروجی)</p>
                  <p className="text-lg font-extrabold tabular-nums">{faNum(provider.unitsLastHour)}</p>
                </div>
              </div>
            </div>
          </CardContent>
          <Separator />
          <CardFooter className="py-3">
            <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
              این صفحه فقط وضعیت عملیاتی را نشان می‌دهد — بدون افشای کلید/رمز ارائه‌دهنده.
            </p>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}
