"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/app/auth-store";
import { api, ApiClientError } from "@/lib/app/api-client";
import { AppShell, type NavItem } from "@/components/app/app-shell";
import { ErrorState, LoadingGrid } from "@/components/shared/blocks";
import { OverviewSection } from "./overview-section";
import { ClassesSection } from "./classes-section";
import { AssignmentsSection } from "./assignments-section";
import { ExamsSection } from "./exams-section";
import { ResultsSection } from "./results-section";
import { QuestionGeneratorSection } from "./question-generator";
import { AssistantSection } from "./assistant-section";
import { ResourcesSection } from "./resources-section";
import { KnowledgeSection } from "./knowledge-section";
import { TeacherBooksSection } from "./books-section";
import type { TeacherOverview } from "./types";
import {
  BarChart3,
  Bot,
  BookMarked,
  BookOpen,
  ClipboardList,
  FileCheck2,
  FolderOpen,
  LayoutDashboard,
  Sparkles,
  Users,
} from "lucide-react";

const NAV: NavItem[] = [
  { key: "overview", label: "داشبورد", icon: LayoutDashboard },
  { key: "classes", label: "کلاس‌ها و دانش‌آموزان", icon: Users },
  { key: "assignments", label: "تکالیف", icon: ClipboardList },
  { key: "exams", label: "آزمون‌ها", icon: FileCheck2 },
  { key: "results", label: "نتایج", icon: BarChart3 },
  { key: "generator", label: "تولید سؤال هوشمند", icon: Sparkles },
  { key: "assistant", label: "دستیار معلم", icon: Bot },
  { key: "knowledge", label: "دانش‌نامه (RAG)", icon: BookMarked },
  { key: "books", label: "کتاب‌ها و جزوه‌ها", icon: BookOpen },
  { key: "resources", label: "منابع", icon: FolderOpen },
];

// Teacher Dashboard (spec §20 Teacher) — Persian RTL, real data only (spec §53)
export function TeacherDashboard() {
  const { me } = useAuth();
  const [section, setSection] = useState("overview");
  const [overview, setOverview] = useState<TeacherOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let ignore = false;
    async function start() {
      try {
        const res = await api<TeacherOverview>("/api/v1/teacher/overview");
        if (!ignore) {
          setOverview(res);
          setError(null);
        }
      } catch (e) {
        if (!ignore)
          setError(e instanceof ApiClientError ? e.message : "بارگذاری داشبورد ناموفق بود.");
      }
    }
    void start();
    return () => {
      ignore = true;
    };
  }, [reloadKey]);

  const reloadOverview = useCallback(() => setReloadKey((k) => k + 1), []);

  const go = useCallback(
    (key: string) => {
      setSection(key);
      // refresh overview stats when returning to the dashboard after mutations
      if (key === "overview") reloadOverview();
    },
    [reloadOverview]
  );

  const firstName = me?.user.fullName?.split(" ")[0] ?? "معلم";
  const title = NAV.find((n) => n.key === section)?.label ?? "داشبورد معلم";

  return (
    <AppShell
      navItems={NAV}
      activeKey={section}
      onNavigate={go}
      title={title}
      subtitle={`${firstName} عزیز — ${me?.tenant?.name ?? "پلتفرم آموزش هوشمند"}`}
    >
      {section === "overview" && (
        <>
          {error && <div className="mb-4"><ErrorState message={error} onRetry={() => void reloadOverview()} /></div>}
          {!overview && !error && <LoadingGrid count={4} />}
          {overview && !error && <OverviewSection overview={overview} onGo={go} />}
        </>
      )}

      {section === "classes" && <ClassesSection />}
      {section === "assignments" && <AssignmentsSection />}
      {section === "exams" && <ExamsSection />}
      {section === "results" && <ResultsSection />}
      {section === "generator" && <QuestionGeneratorSection onGo={go} />}
      {section === "assistant" && <AssistantSection />}
      {section === "knowledge" && <KnowledgeSection />}
      {section === "books" && <TeacherBooksSection />}
      {section === "resources" && <ResourcesSection />}
    </AppShell>
  );
}
