// ── Round 27 — خروج شبکهٔ مرکزی جمینای (پروکسی HTTP با احراز هویت) ──
// خواستهٔ مدیر: راه‌حل «میان‌کار Cloudflare Worker» حذف شد؛ به‌جای آن یک
// «آدرس پروکسی» واحد و قابل‌تنظیم از رابط (نمونهٔ واقعی: سرور اوبونتوی
// مدیر در هلند با tinyproxy + BasicAuth). چون IP خروجی سرور در کشورهای
// مجاز گوگل است، محدودیت جغرافیایی عملاً برطرف می‌شود و روی هر هاست
// دیگری هم فقط همین یک کادر عوض می‌شود — بدون تغییر کد.
//
//   geminiProxyUrl  مثال:  http://user:pass@host:port
//     "" = اتصال مستقیم به generativelanguage.googleapis.com
//     اعتبارنامه (user:pass) اختیاری است — Bun آن را به هدر
//     Proxy-Authorization تبدیل می‌کند (با پروکسی واقعی E2E تأیید شد)
//     و در Node مسیر undici با token صریح ارسال می‌شود.
//
// توجه: پروکسی SOCKS پشتیبانی نمی‌شود (محدودیت Bun/undici) — اگر پروکسی
// شما SOCKS است با ابزاری مثل gost/privoxy به HTTP تبدیل کنید.

import { getSettings } from "./settings";
import { ApiError, Errors } from "@/server/core/errors";

export const GEMINI_DEFAULT_BASE = "https://generativelanguage.googleapis.com";

export interface GeminiTransport {
  /** "" = اتصال مستقیم */
  proxyUrl: string;
}

/** تنظیمات حمل‌ونقل فعلی از دیتابیس (یک خواندن، همهٔ فراخوانی‌ها) */
export async function geminiTransport(): Promise<GeminiTransport> {
  const s = await getSettings();
  return { proxyUrl: s.geminiProxyUrl.trim() };
}

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

// ماژول undici فقط در مسیر Node لود می‌شود (در Bun از گزینهٔ بومی fetch استفاده
// می‌کنیم). نکتهٔ حیاتی: fetch سراسریِ Node با ProxyAgentِ بستهٔ undici ناسازگار
// است («invalid onRequestStart method») — پس در Node باید fetch خودِ همان بسته
// به‌کار رود (تأییدشده با آزمون E2E روی همین میزبان).
type UndiciModule = {
  fetch: (url: string, init?: Record<string, unknown>) => Promise<unknown>;
  ProxyAgent: new (opts: { uri: string; token?: string }) => unknown;
};
let nodeUndici: UndiciModule | null = null;
const nodeAgents = new Map<string, unknown>();

async function loadNodeUndici(): Promise<UndiciModule> {
  if (nodeUndici) return nodeUndici;
  nodeUndici = (await import("undici")) as unknown as UndiciModule;
  return nodeUndici;
}

/** استخراج اعتبارنامهٔ Basic از URL پروکسی برای مسیر Node/undici */
function proxyAuthToken(proxyUrl: string): string | undefined {
  try {
    const u = new URL(proxyUrl);
    if (!u.username && !u.password) return undefined;
    return `Basic ${btoa(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`)}`;
  } catch {
    return undefined;
  }
}

/** حذف اعتبارنامهٔ user:pass از URL پروکسی (با کلاس URL — regex نشتی‌دار نباشد) */
function bareProxyUrl(proxyUrl: string): string {
  try {
    const u = new URL(proxyUrl);
    return `${u.protocol}//${u.host}${u.pathname}${u.search}`;
  } catch {
    return proxyUrl;
  }
}

/** پوشاندن رمز در آدرس پروکسی برای پیام‌های خطا (هرگز رمز لاگ نمی‌شود) */
function maskProxyUrl(proxyUrl: string): string {
  return proxyUrl.replace(/(https?:\/\/[^:@/\s]+:)[^@/\s]+(@)/, "$1••••$2");
}

/** خطای سطح اتصال/تونل پروکسی → پیام فارسی قابل‌اقدام (رمز ماسک می‌شود) */
function isProxyTunnelError(e: unknown): boolean {
  if (e instanceof ApiError) return false; // قبلاً ترجمه شده — دوباره wrap نشود
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /tunnel|proxy|connect|ENOTFOUND|ECONNREFUSED|ECONNRESET|fetch failed/i.test(msg);
}

function proxyTunnelFaError(proxyUrl: string, e: unknown): Error {
  const raw = e instanceof Error ? e.message.slice(0, 120) : String(e).slice(0, 120);
  // ApiError → همهٔ مسیرها (آزمون اتصال، فهرست مدل‌ها، تولید محتوا) پیام فارسی
  // قابل‌اقدام را با کد GEMINI_PROXY_TUNNEL می‌بینند، نه ۵۰۰ خام.
  return Errors.conflict(
    "GEMINI_PROXY_TUNNEL",
    `اتصال از طریق پروکسی جمینای برقرار نشد (${maskProxyUrl(proxyUrl)}). ` +
      `علت‌های محتمل: رمز پروکسی اشتباه است (خطای ۴۰۷)، پروکسی هنوز با BasicAuth راه‌اندازی نشده، سرویس پروکسی خاموش است، یا فایروال پورت را بسته است. ` +
      `جزئیات فنی: ${raw}`
  );
}

/**
 * fetch با تنظیمات مرکزی جمینای. path نسبت به نقطهٔ پایانی رسمی گوگل است
 * (مثل "/v1beta/models/gemini-flash-latest:generateContent").
 * tr اختیاری است — در نبودش از تنظیمات ذخیره‌شده خوانده می‌شود.
 */
export async function geminiFetch(
  path: string,
  init: RequestInit = {},
  tr?: GeminiTransport
): Promise<Response> {
  const transport = tr ?? (await geminiTransport());
  const url = `${GEMINI_DEFAULT_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  if (!transport.proxyUrl) return fetch(url, init);

  if (isBun) {
    // Bun: گزینهٔ بومی fetch — اعتبارنامهٔ user:pass در URL به هدر
    // Proxy-Authorization تبدیل می‌شود (E2E با پروکسی BasicAuth تأیید شد).
    try {
      return await fetch(url, { ...init, proxy: transport.proxyUrl } as RequestInit & { proxy: string });
    } catch (e) {
      // خطای سطح تونل (مثلاً CONNECT 403/407) نباید به‌صورت 500 خام برسد
      if (isProxyTunnelError(e)) throw proxyTunnelFaError(transport.proxyUrl, e);
      throw e;
    }
  }
  // Node: undici.fetch (خود بسته) + ProxyAgent — fetch سراسری dispatcher را نمی‌پذیرد
  try {
    const undici = await loadNodeUndici();
    const token = proxyAuthToken(transport.proxyUrl);
    let agent = nodeAgents.get(transport.proxyUrl);
    if (!agent) {
      agent = new undici.ProxyAgent(token ? { uri: bareProxyUrl(transport.proxyUrl), token } : { uri: bareProxyUrl(transport.proxyUrl) });
      nodeAgents.set(transport.proxyUrl, agent);
    }
    return (await undici.fetch(url, { ...init, dispatcher: agent })) as Response;
  } catch (e) {
    if (isProxyTunnelError(e)) throw proxyTunnelFaError(transport.proxyUrl, e);
    throw new Error(
      `GEMINI_PROXY_UNAVAILABLE: پروکسی جمینای در این محیط قابل راه‌اندازی نیست — ${
        e instanceof Error ? e.message.slice(0, 80) : "خطای ناشناخته"
      }. اگر روی Node اجرا می‌کنید، بستهٔ undici نصب باشد.`
    );
  }
}
