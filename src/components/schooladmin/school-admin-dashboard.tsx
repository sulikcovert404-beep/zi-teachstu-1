"use client";

// School Admin Dashboard (spec §20) — نمای کلی / معلم‌ها / دانش‌آموزان / کلاس‌ها / مصرف AI / عملکرد

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/app/auth-store";
import { api, ApiClientError } from "@/lib/app/api-client";
import { AppShell, type NavItem } from "@/components/app/app-shell";
import { ErrorState, LoadingGrid } from "@/components/shared/blocks";
import {
  LayoutDashboard, Users, GraduationCap, School, Sparkles, TrendingUp,
} from "lucide-react";
import { type OverviewResponse } from "./shared";
import { OverviewSection } from "./overview-section";
import { TeachersSection } from "./teachers-section";
import { StudentsSection } from "./students-section";
import { ClassesSection } from "./classes-section";
import { UsageSection } from "./usage-section";
import { PerformanceSection } from "./performance-section";

const NAV: NavItem[] = [
  { key: "overview", label: "نمای کلی", icon: LayoutDashboard },
  { key: "teachers", label: "معلم‌ها", icon: Users },
  { key: "students", label: "دانش‌آموزان", icon: GraduationCap },
  { key: "classes", label: "کلاس‌ها", icon: School },
  { key: "usage", label: "مصرف هوش مصنوعی", icon: Sparkles },
  { key: "performance", label: "عملکرد", icon: TrendingUp },
];

export function SchoolAdminDashboard() {
  const { me } = useAuth();
  const [section, setSection] = useState("overview");

  // overview stats — refreshed after onboarding mutations (teacher/student/class creation)
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [overviewKey, setOverviewKey] = useState(0);

  useEffect(() => {
    let ignore = false;
    async function start() {
      try {
        const res = await api<OverviewResponse>("/api/v1/admin/overview");
        if (!ignore) {
          setOverview(res);
          setOverviewError(null);
        }
      } catch (e) {
        if (!ignore) setOverviewError(e instanceof ApiClientError ? e.message : "بارگذاری نمای کلی ناموفق بود.");
      }
    }
    void start();
    return () => {
      ignore = true;
    };
  }, [overviewKey]);

  const refreshOverview = useCallback(() => setOverviewKey((k) => k + 1), []);

  const activeLabel = NAV.find((n) => n.key === section)?.label ?? "داشبورد مدیر مدرسه";
  const subtitle = me?.tenant?.name
    ? `${me.user.fullName} · ${me.tenant.name}`
    : (me?.user.fullName ?? "مدیر مدرسه");

  return (
    <AppShell
      navItems={NAV}
      activeKey={section}
      onNavigate={setSection}
      title={activeLabel}
      subtitle={subtitle}
    >
      {section === "overview" && (
        <>
          {overviewError && <ErrorState message={overviewError} onRetry={() => void refreshOverview()} />}
          {!overview && !overviewError && (
            <div className="space-y-6">
              <LoadingGrid count={6} />
              <LoadingGrid count={2} />
            </div>
          )}
          {overview && <OverviewSection overview={overview} />}
        </>
      )}

      {section === "teachers" && <TeachersSection onChanged={refreshOverview} />}
      {section === "students" && <StudentsSection onChanged={refreshOverview} />}
      {section === "classes" && <ClassesSection onChanged={refreshOverview} />}
      {section === "usage" && <UsageSection />}
      {section === "performance" && <PerformanceSection />}
    </AppShell>
  );
}
