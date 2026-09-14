"use client";

// Spec §23 — Shared Auth Bootstrap + API client.
// 1. sessionStorage access token → Bearer → bootstrap
// 2. if missing/invalid → detect Telegram WebApp → POST /api/v1/auth/telegram
// 3. outside Telegram & no token → explicit auth-required state
// 4. no infinite 401 loop (bounded retries)

export interface ApiErrorShape {
  error: { code: string; message: string };
}

export class ApiClientError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const TOKEN_KEY = "aep_token";

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* storage unavailable */
  }
}

export function clearToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* noop */
  }
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit & { skipAuth?: boolean } = {}
): Promise<T> {
  const { skipAuth, ...init } = options;
  const headers = new Headers(init.headers ?? {});
  // Only default to JSON for string bodies — FormData must keep its multipart boundary.
  if (!headers.has("Content-Type") && init.body && typeof init.body === "string") {
    headers.set("Content-Type", "application/json");
  }
  const token = getToken();
  if (!skipAuth && token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(path, { ...init, headers });

  if (res.status === 401) {
    clearToken(); // stale token cleanup (spec §79)
  }

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (body as ApiErrorShape | null)?.error;
    throw new ApiClientError(
      err?.code ?? "NETWORK_ERROR",
      err?.message ?? "ارتباط با سرور برقرار نشد.",
      res.status
    );
  }
  return body as T;
}

export function detectTelegramWebApp(): boolean {
  try {
    return typeof window !== "undefined" && !!(window as any).Telegram?.WebApp?.initData;
  } catch {
    return false;
  }
}

export interface TelegramAuthOutcome {
  token?: string;
  linked?: boolean;
  telegramUser?: { id: number; firstName: string; lastName?: string; username?: string };
}

// Bounded Telegram auth attempt (single try per bootstrap — no 401 loop).
// Returns {token} on linked sessions, or {linked:false, telegramUser} so the client
// can render the account-linking flow; null when not in Telegram / network error.
export async function tryTelegramAuth(): Promise<TelegramAuthOutcome | null> {
  if (!detectTelegramWebApp()) return null;
  try {
    const initData = (window as any).Telegram?.WebApp?.initData as string;
    const res = await api<TelegramAuthOutcome>("/api/v1/auth/telegram", {
      method: "POST",
      body: JSON.stringify({ initData }),
      skipAuth: true,
    });
    if (res?.token) {
      setToken(res.token);
      return { token: res.token };
    }
    return res ?? null;
  } catch {
    return null;
  }
}
