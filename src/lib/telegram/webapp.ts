"use client";

// Round 16 — Telegram Mini App client bridge.
// The official SDK (telegram-web-app.js) is loaded in app/layout.tsx; this module
// provides typed, SSR-safe access. NOTE: initData parsed here is UNVERIFIED client
// data — every security decision happens server-side (HMAC validation in
// services/telegram.ts). This layer is display/UX only.

export interface TgThemeParams {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  secondary_bg_color?: string;
  header_bg_color?: string;
  accent_text_color?: string;
}

export interface TgWebApp {
  initData: string;
  initDataUnsafe?: {
    user?: { id: number; first_name?: string; last_name?: string; username?: string };
  };
  version?: string;
  platform?: string;
  colorScheme?: "light" | "dark";
  themeParams?: TgThemeParams;
  ready: () => void;
  expand: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  disableVerticalSwipes?: () => void;
  BackButton?: { show: () => void; hide: () => void; onClick: (cb: () => void) => void; offClick: (cb: () => void) => void };
  HapticFeedback?: {
    impactOccurred: (style: string) => void;
    notificationOccurred: (type: string) => void;
  };
}

export function getTgWebApp(): TgWebApp | null {
  try {
    if (typeof window === "undefined") return null;
    const tg = (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;
    return tg ?? null;
  } catch {
    return null;
  }
}

/** True when running inside a Telegram Mini App (initData present). */
export function isInTelegram(): boolean {
  try {
    return typeof window !== "undefined" && !!getTgWebApp()?.initData;
  } catch {
    return false;
  }
}

/** Unverified Telegram user (display only — never trust for auth). */
export function tgDisplayUser(): { id: number; firstName: string; lastName?: string; username?: string } | null {
  try {
    const u = getTgWebApp()?.initDataUnsafe?.user;
    if (!u || typeof u.id !== "number") return null;
    return {
      id: u.id,
      firstName: u.first_name ?? "",
      lastName: u.last_name,
      username: u.username,
    };
  } catch {
    return null;
  }
}

let mounted = false;

/** Signal readiness + take the full viewport (call once after hydration). */
export function mountTelegramWebApp(): void {
  if (mounted || typeof window === "undefined") return;
  const tg = getTgWebApp();
  if (!tg?.initData) return;
  mounted = true;
  try {
    tg.ready();
    tg.expand();
    // keep the app interactive: block vertical swipe-down closing
    tg.disableVerticalSwipes?.();
  } catch {
    /* older Telegram clients */
  }
}

/**
 * Theme bridge — sync the app's dark class with the user's Telegram color scheme.
 * The platform palette itself (emerald/teal) stays ours for consistency; only the
 * light/dark mode follows Telegram.
 */
export function applyTelegramColorScheme(): void {
  if (typeof window === "undefined") return;
  const tg = getTgWebApp();
  if (!tg?.initData || !tg.colorScheme) return;
  try {
    const root = document.documentElement;
    if (tg.colorScheme === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
  } catch {
    /* noop */
  }
}

/** Subtle haptic feedback (no-op outside Telegram). */
export function tgHaptic(type: "success" | "error" | "warning" | "light" | "medium" | "heavy" = "light"): void {
  try {
    const tg = getTgWebApp();
    if (!tg?.initData) return;
    if (["success", "error", "warning"].includes(type)) {
      tg.HapticFeedback?.notificationOccurred(type);
    } else {
      tg.HapticFeedback?.impactOccurred(type);
    }
  } catch {
    /* noop */
  }
}
