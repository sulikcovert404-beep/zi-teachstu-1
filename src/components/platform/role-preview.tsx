"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/app/api-client";
import { useAuth } from "@/lib/app/auth-store";
import { useToast } from "@/hooks/use-toast";
import { ROLE_LABELS_FA } from "@/lib/app/labels";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState, PageTitle, faDateTime } from "@/components/shared/blocks";
import { Eye, Loader2, ShieldCheck, AlertCircle } from "lucide-react";
import type { PreviewStartResponse, TenantRow } from "./types";

const PREVIEW_ROLES = ["STUDENT", "TEACHER", "SCHOOL_ADMIN"] as const;

// Spec §6 — پیش‌نمایش امن نقش: نقش اصلی مدیر کل تغییری نمی‌کند؛ فقط دید موقتاً عوض می‌شود.
// پس از آغاز، نشست با نشانهٔ پیش‌نمایش جایگزین می‌شود و کل برنامه به داشبورد آن نقش می‌رود؛
// خروج از پیش‌نمایش از نوار کهربایی بالای صفحه انجام می‌شود.
export function RolePreviewPanel() {
  const { me, setPreviewToken } = useAuth();
  const { toast } = useToast();

  const [tenants, setTenants] = useState<TenantRow[] | null>(null);
  const [tenantsError, setTenantsError] = useState<string | null>(null);
  const [tenantsReloadKey, setTenantsReloadKey] = useState(0);

  const [role, setRole] = useState<string>("");
  const [tenantId, setTenantId] = useState<string>("NONE");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [started, setStarted] = useState<{ expiresAt: string; effectiveRole: string } | null>(null);

  useEffect(() => {
    let ignore = false;
    async function start() {
      try {
        const res = await api<{ tenants: TenantRow[] }>("/api/v1/platform/tenants");
        if (!ignore) {
          setTenants(res.tenants);
          setTenantsError(null);
        }
      } catch (e) {
        if (!ignore)
          setTenantsError(e instanceof ApiClientError ? e.message : "بارگذاری سازمان‌ها ناموفق بود.");
      }
    }
    void start();
    return () => {
      ignore = true;
    };
  }, [tenantsReloadKey]);

  const reloadTenants = useCallback(() => setTenantsReloadKey((k) => k + 1), []);

  // Tenant is required for every school-scoped preview role (server-enforced)
  const canStart = !!role && tenantId !== "NONE" && !!tenants && tenants.length > 0;

  const startPreview = useCallback(async () => {
    if (!role) {
      setStartError("انتخاب نقش برای شروع پیش‌نمایش الزامی است.");
      return;
    }
    if (tenantId === "NONE") {
      setStartError("برای پیش‌نمایش، انتخاب سازمان الزامی است.");
      return;
    }
    setStarting(true);
    setStartError(null);
    try {
      const res = await api<PreviewStartResponse>("/api/v1/platform/preview/start", {
        method: "POST",
        body: JSON.stringify({
          effectiveRole: role,
          tenantId: tenantId !== "NONE" ? tenantId : null,
        }),
      });
      setStarted({ expiresAt: res.expiresAt, effectiveRole: res.effectiveRole });
      toast({
        title: "پیش‌نمایش امن نقش آغاز شد",
        description: "در حال انتقال به داشبورد نقش انتخابی…",
      });
      // Swap the session token — the whole app switches to the previewed role's dashboard
      // (with the amber banner + «خروج از پیش‌نمایش»).
      await setPreviewToken(res.token);
    } catch (e) {
      setStartError(e instanceof ApiClientError ? e.message : "آغاز پیش‌نمایش ناموفق بود.");
    } finally {
      setStarting(false);
    }
  }, [role, tenantId, tenants, setPreviewToken, toast]);

  const previewAlreadyActive = me?.preview?.active === true;

  return (
    <div className="space-y-6">
      <PageTitle
        title="پیش‌نمایش امن نقش"
        description="دیدن پلتفرم از زاویهٔ دید نقش‌های دیگر — بدون هیچ تغییری در نقش اصلی شما."
      />

      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Eye className="h-4.5 w-4.5 text-primary" aria-hidden />
            شروع پیش‌نمایش
          </CardTitle>
          <CardDescription>
            نقش اصلی شما همیشه مدیر کل باقی می‌ماند؛ پیش‌نمایش فقط دید شما را موقتاً تغییر می‌دهد.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
            <ShieldCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" aria-hidden />
            <p className="text-xs leading-6 text-foreground/80">
              این قابلیت برای بررسی تجربهٔ واقعی دانش‌آموزان، معلم‌ها و مدیران مدرسه طراحی شده است.
              پیش‌نمایش عمر کوتاهی دارد، در ردیابی ثبت می‌شود و با یک کلیک می‌توانید از آن خارج شوید.
              نقش پایگاه‌داده‌ای شما در تمام این مدت «مدیر کل پلتفرم» می‌ماند.
            </p>
          </div>

          {previewAlreadyActive && (
            <Alert>
              <AlertCircle className="h-4 w-4" aria-hidden />
              <AlertTitle>پیش‌نمایش فعالی دارید</AlertTitle>
              <AlertDescription>
                برای شروع پیش‌نمایش جدید، ابتدا از پیش‌نمایش فعلی خارج شوید (دکمهٔ «خروج از پیش‌نمایش» در نوار بالای صفحه).
              </AlertDescription>
            </Alert>
          )}

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="preview-role" className="text-sm font-bold">
                نقش برای پیش‌نمایش
              </Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger id="preview-role" className="w-full h-11" aria-label="انتخاب نقش پیش‌نمایش">
                  <SelectValue placeholder="یک نقش را انتخاب کنید…" />
                </SelectTrigger>
                <SelectContent>
                  {PREVIEW_ROLES.map((r) => (
                    <SelectItem key={r} value={r} className="py-2.5">
                      {ROLE_LABELS_FA[r] ?? r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                پیش‌نمایش برای نقش‌های دانش‌آموز، معلم و مدیر مدرسه ممکن است.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="preview-tenant" className="text-sm font-bold">
                سازمان
                <span className="text-red-600 dark:text-red-400"> (الزامی)</span>
              </Label>
              {tenantsError ? (
                <ErrorState message={tenantsError} onRetry={reloadTenants} />
              ) : !tenants ? (
                <Skeleton className="h-11 w-full rounded-md" />
              ) : (
                <Select value={tenantId} onValueChange={setTenantId}>
                  <SelectTrigger id="preview-tenant" className="w-full h-11" aria-label="انتخاب سازمان">
                    <SelectValue placeholder="یک سازمان را انتخاب کنید…" />
                  </SelectTrigger>
                  <SelectContent>
                    {tenants.map((t) => (
                      <SelectItem key={t.id} value={t.id} className="py-2.5">
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <p className="text-[11px] text-muted-foreground">
                داده‌های نقش‌های مدرسه‌ای در بستر سازمان انتخابی نمایش داده می‌شود.
              </p>
            </div>
          </div>

          {startError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" aria-hidden />
              <AlertTitle>شروع پیش‌نمایش ناموفق بود</AlertTitle>
              <AlertDescription>{startError}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <Button
              size="lg"
              className="h-11 min-w-[180px]"
              onClick={() => void startPreview()}
              disabled={starting || previewAlreadyActive || !canStart}
            >
              {starting ? (
                <>
                  <Loader2 className="h-4.5 w-4.5 animate-spin" aria-hidden />
                  در حال آغاز پیش‌نمایش…
                </>
              ) : (
                <>
                  <Eye className="h-4.5 w-4.5" aria-hidden />
                  شروع پیش‌نمایش
                </>
              )}
            </Button>
            <p className="text-xs text-muted-foreground leading-6">
              پس از آغاز، کل برنامه به داشبورد نقش انتخابی منتقل می‌شود و نوار کهربایی
              «پیش‌نمایش» بالای صفحه نمایش داده می‌شود.
            </p>
          </div>

          {started && (
            <Alert>
              <Eye className="h-4 w-4" aria-hidden />
              <AlertTitle>
                پیش‌نمایش نقش «{ROLE_LABELS_FA[started.effectiveRole] ?? started.effectiveRole}» ثبت شد
              </AlertTitle>
              <AlertDescription>
                زمان پایان پیش‌نمایش: {faDateTime(started.expiresAt)} — در حال انتقال به داشبورد نقش…
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
