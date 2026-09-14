"use client";

import { create } from "zustand";
import { api, clearToken, getToken, setToken, tryTelegramAuth } from "./api-client";

// Spec §23 — auth bootstrap state machine with bounded retries (no infinite 401 loop)
export type AuthStatus = "bootstrapping" | "authenticated" | "unauthenticated" | "error";

export interface TelegramLinkState {
  required: boolean;
  user: { id: number; firstName: string; lastName?: string; username?: string } | null;
}

export interface Me {
  user: {
    id: string;
    role: string;
    roleLabel: string;
    effectiveRole: string;
    effectiveRoleLabel: string;
    fullName: string;
    email: string | null;
    phone?: string | null; // Round 22 — شمارهٔ موبایل برای ورود خودکار تلگرام
    tenantId: string | null;
    grade: string | null;
    dashboard: string;
  };
  tenant: { id: string; name: string; slug: string } | null;
  preview: {
    active: boolean;
    realRole?: string;
    effectiveRole?: string;
    previewTenantId?: string | null;
    expiresAt?: string | null;
  };
}

interface AuthStore {
  status: AuthStatus;
  me: Me | null;
  error: string | null;
  telegramLink: TelegramLinkState;
  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  // Round 22 — adopt a server-issued token from the phone-based Telegram login
  // flow (/api/v1/auth/telegram/link-phone): same adoption path as `login`.
  loginWithToken: (token: string) => Promise<void>;
  logout: (opts?: { unlinkTelegram?: boolean }) => Promise<void>;
  refreshMe: () => Promise<void>;
  setPreviewToken: (token: string) => Promise<void>;
  exitPreview: () => Promise<void>;
}

export const useAuth = create<AuthStore>((set, get) => ({
  status: "bootstrapping",
  me: null,
  error: null,
  telegramLink: { required: false, user: null },

  bootstrap: async () => {
    set({ status: "bootstrapping", error: null });
    // 0. one-time browser-login link (?tglt=… — opened from the Telegram bot / Mini App).
    //    Single-use, short-TTL token; exchanged for a session then scrubbed from the URL.
    if (typeof window !== "undefined") {
      try {
        const url = new URL(window.location.href);
        const tglt = url.searchParams.get("tglt");
        if (tglt) {
          url.searchParams.delete("tglt");
          window.history.replaceState({}, "", url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : ""));
          const res = await api<{ token: string; user: Me["user"] }>("/api/v1/auth/web-login", {
            method: "POST",
            body: JSON.stringify({ token: tglt }),
            skipAuth: true,
          });
          if (res?.token) {
            setToken(res.token);
            const me = await api<Me>("/api/v1/auth/me");
            set({ status: "authenticated", me });
            return;
          }
        }
      } catch {
        /* invalid/expired link → fall through to the normal bootstrap */
      }
    }
    // 1. existing token?
    if (getToken()) {
      try {
        const me = await api<Me>("/api/v1/auth/me");
        set({ status: "authenticated", me });
        return;
      } catch {
        clearToken();
      }
    }
    // 2. Telegram WebApp channel (single bounded attempt) — linked accounts get a
    //    session; unknown telegram users get linked:false → login screen renders
    //    the Telegram-aware linking flow (round 16).
    const outcome = await tryTelegramAuth();
    if (outcome?.token) {
      try {
        const me = await api<Me>("/api/v1/auth/me");
        set({ status: "authenticated", me });
        return;
      } catch {
        clearToken();
      }
    } else if (outcome && outcome.linked === false) {
      set({
        status: "unauthenticated",
        telegramLink: { required: true, user: outcome.telegramUser ?? null },
      });
      return;
    }
    // 3. explicit auth-required state (spec §23.4)
    set({ status: "unauthenticated" });
  },

  login: async (email, password) => {
    set({ error: null });
    const res = await api<{ token: string; user: Me["user"] }>("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
      skipAuth: true,
    });
    setToken(res.token);
    const me = await api<Me>("/api/v1/auth/me");
    set({ status: "authenticated", me });
  },

  // Round 22 — Mini App «ورود با شمارهٔ تلفن»: the link-phone endpoint returns a
  // fresh session token; mirror `login` so the app auto-transitions to the dashboard.
  loginWithToken: async (token) => {
    set({ error: null });
    setToken(token);
    const me = await api<Me>("/api/v1/auth/me");
    set({ status: "authenticated", me, telegramLink: { required: false, user: null } });
  },

  logout: async (opts) => {
    // Mini App «خروج» — also detach the telegram identity so the next Mini App open
    // does NOT auto-login again (round 18). Web sessions stay separate.
    if (opts?.unlinkTelegram) {
      try {
        await api("/api/v1/auth/telegram/unlink", { method: "POST" });
      } catch {
        /* idempotent — continue logging out regardless */
      }
    }
    try {
      await api("/api/v1/auth/logout", { method: "POST" });
    } catch {
      /* session may already be gone */
    }
    clearToken();
    set({ status: "unauthenticated", me: null, telegramLink: { required: false, user: null } });
  },

  refreshMe: async () => {
    if (get().status !== "authenticated") return;
    try {
      const me = await api<Me>("/api/v1/auth/me");
      set({ me });
    } catch {
      clearToken();
      set({ status: "unauthenticated", me: null });
    }
  },

  // Secure Role Preview — swap token (preview session), then refresh context
  setPreviewToken: async (token: string) => {
    setToken(token);
    const me = await api<Me>("/api/v1/auth/me");
    set({ me });
  },

  exitPreview: async () => {
    const res = await api<{ token: string }>("/api/v1/platform/preview/exit", { method: "POST" });
    setToken(res.token);
    const me = await api<Me>("/api/v1/auth/me");
    set({ me });
  },
}));
