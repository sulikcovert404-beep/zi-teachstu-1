"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/app/api-client";
import { FEATURE_LABELS_FA } from "@/lib/app/labels";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, PageTitle, faNum } from "@/components/shared/blocks";
import { Package, CheckCircle2 } from "lucide-react";
import { planScopeFa, type PlanRow } from "./types";

// Spec §80 — پلن‌های اشتراک: سقف‌های روزانهٔ قابلیت‌ها و قیمت ماهانه
export function PlansSection() {
  const [plans, setPlans] = useState<PlanRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let ignore = false;
    async function start() {
      try {
        const res = await api<{ plans: PlanRow[] }>("/api/v1/platform/plans");
        if (!ignore) {
          setPlans(res.plans);
          setError(null);
        }
      } catch (e) {
        if (!ignore) setError(e instanceof ApiClientError ? e.message : "بارگذاری پلن‌ها ناموفق بود.");
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
        title="پلن‌ها"
        description="پلن‌های اشتراک و سقف مصرف روزانهٔ قابلیت‌های هوش مصنوعی برای هر نقش."
      />

      {error && <ErrorState message={error} onRetry={load} />}

      {!plans && !error && (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="border-border/60">
              <CardContent className="p-6 space-y-4">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-9 w-40" />
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-2/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {plans && plans.length === 0 && (
        <EmptyState
          icon={Package}
          title="پلنی تعریف نشده است"
          description="پلن‌های اشتراک از طریق داده اولیه پلتفرم تعریف می‌شوند."
        />
      )}

      {plans && plans.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {plans.map((p) => (
            <Card key={p.id} className="border-border/60">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Package className="h-4.5 w-4.5 text-primary" aria-hidden />
                      {p.name}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      کد: <span dir="ltr">{p.code}</span> · دامنه: {planScopeFa(p.roleScope)}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    {p.active ? (
                      <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 className="h-3 w-3 ml-1" aria-hidden />
                        فعال
                      </Badge>
                    ) : (
                      <Badge variant="secondary">غیرفعال</Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-xs text-muted-foreground">قیمت ماهانه</p>
                  <p className="text-xl font-extrabold tabular-nums">
                    {p.priceMonthly === 0 ? "رایگان" : `${faNum(p.priceMonthly)} تومان`}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-2">سقف مصرف روزانه قابلیت‌ها</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(p.limits).map(([key, value]) => (
                      <Badge key={key} variant="secondary" className="font-normal">
                        {FEATURE_LABELS_FA[key] ?? key}: {faNum(value)} در روز
                      </Badge>
                    ))}
                    {Object.keys(p.limits).length === 0 && (
                      <p className="text-xs text-muted-foreground">سقفی تعریف نشده است.</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
