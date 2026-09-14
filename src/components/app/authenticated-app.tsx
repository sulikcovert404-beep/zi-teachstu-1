"use client";

import { useAuth } from "@/lib/app/auth-store";
import { StudentDashboard } from "@/components/student/student-dashboard";
import { TeacherDashboard } from "@/components/teacher/teacher-dashboard";
import { SchoolAdminDashboard } from "@/components/schooladmin/school-admin-dashboard";
import { PlatformDashboard } from "@/components/platform/platform-dashboard";
import { Card, CardContent } from "@/components/ui/card";
import { Compass } from "lucide-react";

// Role routing (spec §21/§76 — canonical map, client-side views)
export function AuthenticatedApp() {
  const { me } = useAuth();
  const role = me?.user.effectiveRole ?? me?.user.role;

  switch (role) {
    case "STUDENT":
      return <StudentDashboard />;
    case "TEACHER":
      return <TeacherDashboard />;
    case "SCHOOL_ADMIN":
      return <SchoolAdminDashboard />;
    case "SUPER_ADMIN":
      return <PlatformDashboard />;
    default:
      // unknown → mini-app gateway state
      return (
        <div className="flex-1 flex items-center justify-center p-8">
          <Card className="max-w-md w-full text-center">
            <CardContent className="p-8 space-y-3">
              <Compass className="h-10 w-10 mx-auto text-muted-foreground" aria-hidden />
              <p className="font-bold">نقش شما هنوز مشخص نشده است.</p>
              <p className="text-sm text-muted-foreground">برای شروع با پشتیبانی تماس بگیرید تا حساب شما تکمیل شود.</p>
            </CardContent>
          </Card>
        </div>
      );
  }
}
