// ── Round 26 — خروج شبکهٔ مرکزی جمینای (میان‌کار / پروکسی) ──
// خواستهٔ مدیر: «یه پروکسی بزن یا گزینه‌ای بگذار که بعداً روی هاست دیگه مشکل
// پیش نیاد» — گوگل برای برخی موقعیت‌های جغرافیایی (از جمله IP میزبان فعلی)
// API جمینای را با «User location is not supported» می‌بندد. این محدودیت
// سمت گوگل است و با کلید/مدل عوض نمی‌شود؛ راه‌حل استاندارد، خارج‌کردن ترافیک
// از میزبان است. از این پس همهٔ تماس‌های جمینای (گیت‌وی تولید محتوا، آزمون
// اتصال، فهرست مدل‌ها) از همین یک نقطه عبور می‌کنند و با دو تنظیم زیر —
// بدون دست‌زدن به کد و در هر میزبانی — قابل تغییرند:
//
//   geminiBaseUrl  (آدرس میان‌کار/آینه): مثلاً یک Cloudflare Worker شخصی که
//                  درخواست‌ها را به generativelanguage.googleapis.com می‌رساند.
//                  چون خروجی کلادفلر از کشورهای مجاز است، محدودیت جغرافیایی
//                  عملاً برطرف می‌شود. کد آمادهٔ وِرکر در تنظیمات قابل کپی است.
//   geminiProxyUrl (پروکسی HTTP(S) خروجی): مثلاً http://user:pass@host:port —
//                  در Bun با گزینهٔ بومی fetch({proxy}) و در Node با undici.
//
// توجه: پروکسی SOCKS پشتیبانی نمی‌شود (محدودیت Bun/undici) — اگر پروکسی
// شما SOCKS است با ابزاری مثل gost/privoxy به HTTP تبدیل کنید.

import { getSettings } from "./settings";

export const GEMINI_DEFAULT_BASE = "https://generativelanguage.googleapis.com";

export interface GeminiTransport {
  /** آدرس پایه بدون / انتهایی؛ پیش‌فرض = نقطهٔ پایانی رسمی گوگل */
  baseUrl: string;
  /** "" = اتصال مستقیم */
  proxyUrl: string;
}

/** نرمال‌سازی آدرس پایه: حذف / انتهایی و مسیرهای اضافی */
export function normalizeGeminiBase(raw: string | null | undefined): string {
  const v = (raw ?? "").trim();
  if (!v) return GEMINI_DEFAULT_BASE;
  return v.replace(/\/+$/, "");
}

/** تنظیمات حمل‌ونقل فعلی از دیتابیس (یک خواندن، همهٔ فراخوانی‌ها) */
export async function geminiTransport(): Promise<GeminiTransport> {
  const s = await getSettings();
  return { baseUrl: normalizeGeminiBase(s.geminiBaseUrl), proxyUrl: s.geminiProxyUrl.trim() };
}

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

// ماژول undici فقط در مسیر Node لود می‌شود (در Bun از گزینهٔ بومی fetch استفاده
// می‌کنیم). نکتهٔ حیاتی: fetch سراسریِ Node با ProxyAgentِ بستهٔ undici ناسازگار
// است («invalid onRequestStart method») — پس در Node باید fetch خودِ همان بسته
// به‌کار رود (تأییدشده با آزمون E2E روی همین میزبان).
type UndiciModule = {
  fetch: (url: string, init?: Record<string, unknown>) => Promise<unknown>;
  ProxyAgent: new (url: string) => unknown;
};
let nodeUndici: UndiciModule | null = null;
const nodeAgents = new Map<string, unknown>();

async function loadNodeUndici(): Promise<UndiciModule> {
  if (nodeUndici) return nodeUndici;
  nodeUndici = (await import("undici")) as unknown as UndiciModule;
  return nodeUndici;
}

/**
 * fetch با تنظیمات مرکزی جمینای. path نسبت به baseUrl است
 * (مثل "/v1beta/models/gemini-flash-latest:generateContent").
 * tr اختیاری است — در نبودش از تنظیمات ذخیره‌شده خوانده می‌شود.
 */
export async function geminiFetch(
  path: string,
  init: RequestInit = {},
  tr?: GeminiTransport
): Promise<Response> {
  const transport = tr ?? (await geminiTransport());
  const url = `${transport.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  if (!transport.proxyUrl) return fetch(url, init);

  if (isBun) {
    // Bun: گزینهٔ بومی fetch — از راند ۲۶ تأیید شد که واقعاً از پروکسی عبور می‌کند
    return fetch(url, { ...init, proxy: transport.proxyUrl } as RequestInit & { proxy: string });
  }
  // Node: undici.fetch (خود بسته) + ProxyAgent — fetch سراسری dispatcher را نمی‌پذیرد
  try {
    const undici = await loadNodeUndici();
    let agent = nodeAgents.get(transport.proxyUrl);
    if (!agent) {
      agent = new undici.ProxyAgent(transport.proxyUrl);
      nodeAgents.set(transport.proxyUrl, agent);
    }
    return (await undici.fetch(url, { ...init, dispatcher: agent })) as Response;
  } catch (e) {
    throw new Error(
      `GEMINI_PROXY_UNAVAILABLE: پروکسی جمینای (${transport.proxyUrl.slice(0, 40)}…) در این محیط قابل راه‌اندازی نیست — ${
        e instanceof Error ? e.message.slice(0, 80) : "خطای ناشناخته"
      }. اگر روی Node اجرا می‌کنید، بستهٔ undici نصب باشد یا از «آدرس میان‌کار» به‌جای پروکسی استفاده کنید.`
    );
  }
}
