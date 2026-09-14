"use client";

import { useState } from "react";
import { useAuth } from "@/lib/app/auth-store";
import { AppShell, type NavItem } from "@/components/app/app-shell";
import { OverviewSection } from "./overview-section";
import { TenantsSection } from "./tenants-section";
import { UsersSection } from "./users-section";
import { PlansSection } from "./plans-section";
import { UsageSection } from "./usage-section";
import { AiProvidersSection } from "./ai-providers-section";
import { FeatureFlagsSection } from "./feature-flags-section";
import { AuditSection } from "./audit-section";
import { RolePreviewPanel } from "./role-preview";
import { SettingsSection } from "./settings-section";
import { PlatformBooksSection } from "./books-section";
import {
  LayoutDashboard, Building2, Users, Package, Gauge, Server, ToggleRight, ScrollText, Eye,
  BookOpen, Plug,
} from "lucide-react";

const NAV: NavItem[] = [
  { key: "overview", label: "نمای کلی", icon: LayoutDashboard },
  { key: "tenants", label: "سازمان‌ها", icon: Building2 },
  { key: "users", label: "کاربران", icon: Users },
  { key: "books", label: "کتاب‌خانه هوشمند", icon: BookOpen },
  { key: "plans", label: "پلن‌ها", icon: Package },
  { key: "usage", label: "مصرف هوش مصنوعی", icon: Gauge },
  { key: "ai", label: "ارائه‌دهنده‌های هوش مصنوعی", icon: Server },
  { key: "settings", label: "تنظیمات و اتصال‌ها", icon: Plug },
  { key: "flags", label: "فلگ‌های قابلیت", icon: ToggleRight },
  { key: "audit", label: "ردیابی", icon: ScrollText },
  { key: "preview", label: "پیش‌نمایش نقش", icon: Eye },
];

function sectionTitle(key: string): string {
  return NAV.find((n) => n.key === key)?.label ?? "داشبورد مدیر کل";
}

// Spec §20/§80 — داشبورد مدیر کل پلتفرم (فقط نقش SUPER_ADMIN)
export function PlatformDashboard() {
  const { me } = useAuth();
  const [section, setSection] = useState("overview");

  const firstName = me?.user.fullName?.split(" ")[0] ?? "مدیر کل";

  return (
    <AppShell
      navItems={NAV}
      activeKey={section}
      onNavigate={setSection}
      title={sectionTitle(section)}
      subtitle={`${firstName} عزیز — نمای مدیریت کل پلتفرم آموزش هوشمند ایران`}
    >
      <div key={section} className="animate-rtl-fade-in">
        {section === "overview" && <OverviewSection onGoAi={() => setSection("ai")} />}
        {section === "tenants" && <TenantsSection />}
        {section === "users" && <UsersSection />}
        {section === "books" && <PlatformBooksSection />}
        {section === "plans" && <PlansSection />}
        {section === "usage" && <UsageSection />}
        {section === "ai" && <AiProvidersSection />}
        {section === "settings" && <SettingsSection />}
        {section === "flags" && <FeatureFlagsSection />}
        {section === "audit" && <AuditSection />}
        {section === "preview" && <RolePreviewPanel />}
      </div>
    </AppShell>
  );
}
