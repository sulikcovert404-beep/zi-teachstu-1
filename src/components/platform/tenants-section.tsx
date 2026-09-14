"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/app/api-client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState, ErrorState, PageTitle, faDate, faNum } from "@/components/shared/blocks";
import { Building2, Users, Layers, FileCheck2 } from "lucide-react";
import { tenantStatusFa, type TenantRow } from "./types";

function tenantStatusClass(status: string): string {
  switch (status) {
    case "ACTIVE":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
    case "SUSPENDED":
      return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400";
    default:
      return "";
  }
}

// Spec §80 — سازمان‌های ثبت‌شده روی پلتفرم
export function TenantsSection() {
  const [tenants, setTenants] = useState<TenantRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let ignore = false;
    async function start() {
      try {
        const res = await api<{ tenants: TenantRow[] }>("/api/v1/platform/tenants");
        if (!ignore) {
          setTenants(res.tenants);
          setError(null);
        }
      } catch (e) {
        if (!ignore) setError(e instanceof ApiClientError ? e.message : "بارگذاری سازمان‌ها ناموفق بود.");
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
      <PageTitle title="سازمان‌ها" description="مدرسه‌ها و سازمان‌های ثبت‌شده روی پلتفرم." />

      {error && <ErrorState message={error} onRetry={load} />}

      {!tenants && !error && (
        <Card className="border-border/60">
          <CardContent className="p-6 space-y-4">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-3/4" />
          </CardContent>
        </Card>
      )}

      {tenants && tenants.length === 0 && (
        <EmptyState
          icon={Building2}
          title="هنوز سازمانی ثبت نشده است"
          description="با ثبت نخستین مدرسه، سازمان آن به‌صورت خودکار در این فهرست ظاهر می‌شود."
        />
      )}

      {tenants && tenants.length > 0 && (
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4.5 w-4.5 text-primary" aria-hidden />
              فهرست سازمان‌ها
            </CardTitle>
            <CardDescription>{faNum(tenants.length)} سازمان — مرتب‌شده از جدیدترین.</CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right min-w-[180px]">سازمان</TableHead>
                    <TableHead className="text-right">وضعیت</TableHead>
                    <TableHead className="text-right">مدرسه</TableHead>
                    <TableHead className="text-right">کاربران</TableHead>
                    <TableHead className="text-right">کلاس‌ها</TableHead>
                    <TableHead className="text-right">آزمون‌ها</TableHead>
                    <TableHead className="text-right">تاریخ ثبت</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tenants.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">
                        <span className="block truncate">{t.name}</span>
                        <span dir="ltr" className="block text-[11px] text-muted-foreground truncate text-left">
                          {t.slug}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={tenantStatusClass(t.status)}>
                          {tenantStatusFa(t.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{t.schoolName ?? "—"}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-sm tabular-nums">
                          <Users className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                          {faNum(t.userCount)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-sm tabular-nums">
                          <Layers className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                          {faNum(t.classCount)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-sm tabular-nums">
                          <FileCheck2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                          {faNum(t.examCount)}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {faDate(t.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
