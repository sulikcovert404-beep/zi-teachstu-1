"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/app/api-client";
import { AUDIT_ACTION_LABELS_FA, ROLE_LABELS_FA } from "@/lib/app/labels";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState, ErrorState, PageTitle, faDateTime } from "@/components/shared/blocks";
import { ScrollText } from "lucide-react";
import { auditTargetTypeFa, type AuditLogRow } from "./types";

// Spec §80 — ردیابی: آخرین رویدادهای امنیتی و مدیریتی پلتفرم (جدیدترین در بالا)
export function AuditSection() {
  const [logs, setLogs] = useState<AuditLogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let ignore = false;
    async function start() {
      try {
        const res = await api<{ logs: AuditLogRow[] }>("/api/v1/platform/audit");
        if (!ignore) {
          setLogs(res.logs);
          setError(null);
        }
      } catch (e) {
        if (!ignore) setError(e instanceof ApiClientError ? e.message : "بارگذاری ردیابی ناموفق بود.");
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
        title="ردیابی"
        description="آخرین رویدادهای امنیتی و مدیریتی ثبت‌شده روی پلتفرم — جدیدترین در بالا."
      />

      {error && <ErrorState message={error} onRetry={load} />}

      {!logs && !error && (
        <Card className="border-border/60">
          <CardContent className="p-6 space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      )}

      {logs && logs.length === 0 && (
        <EmptyState
          icon={ScrollText}
          title="رویدادی برای نمایش وجود ندارد"
          description="با نخستین فعالیت کاربران (ورود، آزمون، تغییر تنظیمات) رویدادها در این بخش ثبت می‌شوند."
        />
      )}

      {logs && logs.length > 0 && (
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ScrollText className="h-4.5 w-4.5 text-primary" aria-hidden />
              آخرین رویدادها
            </CardTitle>
            <CardDescription>{logs.length} رویداد اخیر.</CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <div className="max-h-96 overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="text-right min-w-[140px]">رویداد</TableHead>
                    <TableHead className="text-right min-w-[140px]">کاربر</TableHead>
                    <TableHead className="text-right">سازمان</TableHead>
                    <TableHead className="text-right min-w-[150px]">زمان</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((l) => {
                    const actionLabel = AUDIT_ACTION_LABELS_FA[l.action] ?? l.action;
                    const targetFa = auditTargetTypeFa(l.targetType);
                    return (
                      <TableRow key={l.id}>
                        <TableCell>
                          <Badge variant="outline" className="font-normal">
                            {actionLabel}
                          </Badge>
                          {targetFa && (
                            <p className="text-[11px] text-muted-foreground mt-1 truncate">
                              {targetFa}
                              {l.targetId ? ` · ${l.targetId}` : ""}
                            </p>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="block text-sm font-medium truncate">{l.actorName}</span>
                          {l.actorRole && (
                            <span className="block text-[11px] text-muted-foreground">
                              {ROLE_LABELS_FA[l.actorRole] ?? l.actorRole}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">{l.tenantName ?? "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {faDateTime(l.createdAt)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
