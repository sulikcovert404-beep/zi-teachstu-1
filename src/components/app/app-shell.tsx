"use client";

import { ReactNode, useState } from "react";
import { useAuth } from "@/lib/app/auth-store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { faDateTime } from "@/components/shared/blocks";
import { TelegramLinkDialog } from "./telegram-link";
import { isInTelegram } from "@/lib/telegram/webapp";
import { LogOut, Eye, EyeOff, GraduationCap, Send, Unplug, type LucideIcon } from "lucide-react";

export interface NavItem {
  key: string;
  label: string;
  icon: LucideIcon;
}

interface AppShellProps {
  navItems: NavItem[];
  activeKey: string;
  onNavigate: (key: string) => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  headerExtra?: ReactNode;
}

// Shared dashboard shell: RTL sidebar + header + sticky footer (spec §20-style dashboards).
// Round 18: a clearly-labelled «خروج از حساب» button for EVERY role — desktop sidebar
// footer, and the mobile horizontal nav. Inside the Telegram Mini App the button asks
// for confirmation and ALSO unlinks the Telegram identity (otherwise auto-login would
// immediately log the user back in on the next open).
export function AppShell({
  navItems,
  activeKey,
  onNavigate,
  title,
  subtitle,
  children,
  headerExtra,
}: AppShellProps) {
  const { me, logout, exitPreview } = useAuth();
  const user = me?.user;
  const isPreview = me?.preview?.active;
  const [telegramOpen, setTelegramOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const inTelegram = isInTelegram();

  const initials = (user?.fullName ?? "؟")
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0])
    .join("");

  async function doLogout() {
    setLogoutBusy(true);
    try {
      await logout({ unlinkTelegram: inTelegram });
    } finally {
      setLogoutBusy(false);
      setConfirmLogout(false);
    }
  }

  function requestLogout() {
    if (inTelegram) {
      setConfirmLogout(true); // needs explicit unlink confirmation
    } else {
      void logout();
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-1 flex flex-col lg:flex-row">
        {/* Sidebar */}
        <aside className="lg:w-64 bg-sidebar text-sidebar-foreground lg:min-h-screen flex flex-col">
          <div className="p-4 flex items-center gap-3 border-b border-sidebar-border/50">
            <div className="h-10 w-10 rounded-xl bg-sidebar-primary text-sidebar-primary-foreground flex items-center justify-center shrink-0">
              <GraduationCap className="h-6 w-6" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-sm truncate">پلتفرم آموزش هوشمند</p>
              <p className="text-[11px] text-sidebar-foreground/60 truncate">{me?.tenant?.name ?? "پلتفرم ایران"}</p>
            </div>
          </div>

          {/* Mobile nav — horizontal scroll */}
          <nav className="lg:hidden flex gap-1 overflow-x-auto p-2 pb-3 items-center" aria-label="ناوبری اصلی">
            {navItems.map((item) => (
              <button
                key={item.key}
                onClick={() => onNavigate(item.key)}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors min-h-11",
                  activeKey === item.key
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent"
                )}
              >
                <item.icon className="h-4 w-4" aria-hidden />
                {item.label}
              </button>
            ))}
          </nav>

          {/* Desktop nav */}
          <nav className="hidden lg:flex flex-col gap-1 p-3" aria-label="ناوبری اصلی">
            {navItems.map((item) => (
              <button
                key={item.key}
                onClick={() => onNavigate(item.key)}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-right transition-colors",
                  activeKey === item.key
                    ? "bg-sidebar-primary text-sidebar-primary-foreground shadow"
                    : "text-sidebar-foreground/85 hover:bg-sidebar-accent"
                )}
              >
                <item.icon className="h-4.5 w-4.5 shrink-0" aria-hidden />
                {item.label}
              </button>
            ))}
          </nav>

          {/* User box + logout (desktop) */}
          <div className="hidden lg:block mt-auto p-3 border-t border-sidebar-border/50 space-y-2">
            <div className="flex items-center gap-3 rounded-lg p-2 hover:bg-sidebar-accent transition-colors">
              <Avatar className="h-9 w-9 border border-sidebar-border">
                <AvatarFallback className="bg-sidebar-accent text-sidebar-accent-foreground text-xs font-bold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold truncate">{user?.fullName}</p>
                <p className="text-[11px] text-sidebar-foreground/60 truncate">
                  {isPreview ? `پیش‌نمایش: ${user?.effectiveRoleLabel}` : user?.roleLabel}
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                onClick={() => setTelegramOpen(true)}
                title="اتصال به تلگرام"
                aria-label="اتصال حساب به تلگرام"
              >
                <Send className="h-4 w-4" aria-hidden />
              </Button>
            </div>
            <Button
              variant="outline"
              className="w-full h-10 justify-start gap-2 border-rose-500/40 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-300"
              onClick={requestLogout}
            >
              {logoutBusy ? (
                <LogOut className="h-4 w-4 ml-1 animate-pulse" aria-hidden />
              ) : (
                <LogOut className="h-4 w-4 ml-1" aria-hidden />
              )}
              خروج از حساب
            </Button>
          </div>

          {/* Mobile logout — labelled, below the horizontal nav */}
          <div className="lg:hidden px-2 pb-3 -mt-1">
            <Button
              variant="outline"
              size="sm"
              className="w-full h-10 justify-start gap-2 border-rose-500/40 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
              onClick={requestLogout}
            >
              <LogOut className="h-4 w-4 ml-1" aria-hidden />
              خروج از حساب
            </Button>
          </div>
        </aside>

        {/* Main column */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <header className="sticky top-0 z-20 bg-background/85 backdrop-blur border-b border-border/60">
            <div className="px-4 sm:px-6 py-3 flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 lg:hidden">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9"
                  onClick={() => setTelegramOpen(true)}
                  title="اتصال به تلگرام"
                  aria-label="اتصال حساب به تلگرام"
                >
                  <Send className="h-4 w-4" aria-hidden />
                </Button>
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="font-extrabold text-lg truncate">{title}</h1>
                {subtitle && <p className="text-xs text-muted-foreground truncate">{subtitle}</p>}
              </div>
              {headerExtra}
              <Badge variant="outline" className="shrink-0 hidden sm:inline-flex">
                {isPreview ? `پیش‌نمایش ${user?.effectiveRoleLabel}` : user?.roleLabel}
              </Badge>
            </div>
            {/* Secure Role Preview banner (spec §6) */}
            {isPreview && (
              <div className="px-4 sm:px-6 py-2 bg-amber-500/10 border-t border-amber-500/30 flex items-center gap-3 flex-wrap">
                <Eye className="h-4 w-4 text-amber-600" aria-hidden />
                <p className="text-xs text-amber-700 dark:text-amber-400 flex-1 min-w-0">
                  شما در حال پیش‌نمایش امن نقش «{user?.effectiveRoleLabel}» هستید. نقش اصلی شما تغییری نکرده است.
                  {me?.preview?.expiresAt && ` پایان پیش‌نمایش: ${faDateTime(me.preview.expiresAt)}`}
                </p>
                <Button size="sm" variant="outline" onClick={() => void exitPreview()} className="h-7 text-xs">
                  <EyeOff className="h-3.5 w-3.5 ml-1" aria-hidden />
                  خروج از پیش‌نمایش
                </Button>
              </div>
            )}
          </header>

          {/* Content */}
          <main className="flex-1 px-4 sm:px-6 py-6">{children}</main>
        </div>
      </div>

      {/* Sticky footer */}
      <footer className="mt-auto bg-sidebar text-sidebar-foreground/70 border-t border-sidebar-border/50">
        <div className="px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <span>پلتفرم آموزش هوشمند ایران — نسخه توسعه</span>
          <span className="flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
            API v1 · AI Gateway فعال
          </span>
        </div>
      </footer>

      {/* Telegram account linking (round 16) */}
      <TelegramLinkDialog open={telegramOpen} onOpenChange={setTelegramOpen} />

      {/* Mini App logout confirmation — logging out inside Telegram also detaches
          the linked account, otherwise the next open auto-logs back in (round 18) */}
      <AlertDialog open={confirmLogout} onOpenChange={setConfirmLogout}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Unplug className="h-5 w-5 text-rose-600" aria-hidden />
              خروج از حساب
            </AlertDialogTitle>
            <AlertDialogDescription className="leading-7">
              شما داخل مینی‌اپ تلگرام هستید. با خروج، حساب تلگرام شما نیز از این حساب{" "}
              <b>قطع می‌شود</b> تا دفعهٔ بعد به‌صورت خودکار وارد نشوید. برای اتصال مجدد، کد ۶ رقمی
              پروفایل را به بات بفرستید یا از صفحهٔ ورود استفاده کنید.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={logoutBusy}>انصراف</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 hover:bg-rose-700"
              disabled={logoutBusy}
              onClick={(e) => {
                e.preventDefault();
                void doLogout();
              }}
            >
              <LogOut className="h-4 w-4 ml-1.5" aria-hidden />
              {logoutBusy ? "در حال خروج…" : "خروج و قطع اتصال"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
