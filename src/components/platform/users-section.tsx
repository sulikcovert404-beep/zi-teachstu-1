"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/app/api-client";
import { ROLE_LABELS_FA } from "@/lib/app/labels";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState, ErrorState, PageTitle, faDate, faNum } from "@/components/shared/blocks";
import { Search, Users } from "lucide-react";
import { userStatusFa, type PlatformUser } from "./types";

const ROLE_FILTERS = ["STUDENT", "TEACHER", "SCHOOL_ADMIN", "SUPER_ADMIN"] as const;

function roleBadgeClass(role: string): string {
  switch (role) {
    case "SUPER_ADMIN":
      return "border-primary/40 bg-primary/10 text-primary";
    case "SCHOOL_ADMIN":
      return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400";
    case "TEACHER":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
    default:
      return "border-border bg-muted text-foreground";
  }
}

// Spec §80 — مدیریت کاربران کل پلتفرم: فیلتر نقش + جست‌وجوی نام/ایمیل (با تأخیر ۴۰۰ms)
export function UsersSection() {
  const [users, setUsers] = useState<PlatformUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [roleFilter, setRoleFilter] = useState<string>("ALL");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  // Debounce 400ms — only committed value (search) hits the API
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    let ignore = false;
    async function start() {
      const params = new URLSearchParams();
      if (roleFilter !== "ALL") params.set("role", roleFilter);
      if (search.trim()) params.set("q", search.trim());
      const qs = params.toString();
      try {
        const res = await api<{ users: PlatformUser[] }>(
          `/api/v1/platform/users${qs ? `?${qs}` : ""}`
        );
        if (!ignore) {
          setUsers(res.users);
          setError(null);
        }
      } catch (e) {
        if (!ignore) setError(e instanceof ApiClientError ? e.message : "بارگذاری کاربران ناموفق بود.");
      }
    }
    void start();
    return () => {
      ignore = true;
    };
  }, [reloadKey, roleFilter, search]);

  const load = useCallback(() => setReloadKey((k) => k + 1), []);

  return (
    <div className="space-y-6">
      <PageTitle title="کاربران" description="جست‌وجو و بررسی همهٔ کاربران پلتفرم در همهٔ سازمان‌ها." />

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative w-full sm:max-w-xs">
          <Search
            className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
            aria-hidden
          />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="جست‌وجوی نام یا ایمیل…"
            className="pr-9 h-11"
            inputMode="search"
            aria-label="جست‌وجوی کاربر"
          />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-full sm:w-[220px] h-11" aria-label="فیلتر نقش">
            <SelectValue placeholder="همهٔ نقش‌ها" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL" className="py-2.5">همهٔ نقش‌ها</SelectItem>
            {ROLE_FILTERS.map((r) => (
              <SelectItem key={r} value={r} className="py-2.5">
                {ROLE_LABELS_FA[r] ?? r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && <ErrorState message={error} onRetry={load} />}

      {!users && !error && (
        <Card className="border-border/60">
          <CardContent className="p-6 space-y-4">
            <Skeleton className="h-12 w-full" />
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      )}

      {users && users.length === 0 && (
        <EmptyState
          icon={Users}
          title="کاربری یافت نشد"
          description="با تغییر فیلتر نقش یا عبارت جست‌وجو دوباره تلاش کنید."
        />
      )}

      {users && users.length > 0 && (
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4.5 w-4.5 text-primary" aria-hidden />
              فهرست کاربران
            </CardTitle>
            <CardDescription>
              {faNum(users.length)} کاربر — مرتب‌شده از جدیدترین.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right min-w-[200px]">کاربر</TableHead>
                    <TableHead className="text-right">نقش</TableHead>
                    <TableHead className="text-right">سازمان</TableHead>
                    <TableHead className="text-right">پایه</TableHead>
                    <TableHead className="text-right">نشست فعال</TableHead>
                    <TableHead className="text-right">تاریخ عضویت</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">
                        <span className="block truncate">{u.fullName}</span>
                        {u.email && (
                          <span dir="ltr" className="block text-[11px] text-muted-foreground truncate text-left">
                            {u.email}
                          </span>
                        )}
                        {u.status !== "ACTIVE" && (
                          <Badge variant="outline" className="mt-1 border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400">
                            {userStatusFa(u.status)}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={roleBadgeClass(u.role)}>
                          {u.roleLabel}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{u.tenant?.name ?? "—"}</TableCell>
                      <TableCell className="text-sm">{u.grade ?? "—"}</TableCell>
                      <TableCell className="text-sm tabular-nums">{faNum(u._count?.sessions ?? 0)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {faDate(u.createdAt)}
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
