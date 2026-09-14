// Round 19 — server-side PDF text extraction for the Smart Library upload flow.
// The admin picks دوره → پایه → درس and uploads the textbook as a PDF; we extract
// the plain text here so the existing 5-artifact pipeline (خلاصه/جزوه/شکل/نمونه‌سؤال/
// پادکست) can run on it. Extraction uses pdfjs-dist (legacy Node build) kept external
// via next.config serverExternalPackages.
//
// Round 20 — two ingestion sources now share this core:
//   • direct file upload (POST /api/v1/books/extract-pdf — multipart)
//   • download link  (POST /api/v1/books/extract-url — server fetches the PDF)
// In BOTH cases the original PDF bytes are kept in storage/books/tmp/<key>.pdf and a
// storageKey is returned; createBook moves the file next to the book row so students
// can download the real book (GET /api/v1/books/:id/original.pdf).
//
// RTL reassembly (verified against a Chromium-printed Persian PDF with the Vazirmatn
// font): pdf.js returns text items in VISUAL order (x ascending) with presentation-form
// glyphs. For Persian-dominant lines we reverse the item sequence to logical order,
// re-reverse contiguous LTR runs (digits/Latin) so numbers stay readable, join items
// with a gap-aware space heuristic, then NFKC-normalize presentation forms to base
// letters (ﺴ → س). Persian digits (۰-۹) are unaffected by NFKC.

import crypto from "crypto";
import dns from "dns/promises";
import fs from "fs/promises";
import path from "path";
import type { AuthContext } from "@/server/auth/session";
import { ApiError, Errors } from "@/server/core/errors";
import { booksUploadPermission } from "@/server/services/books";

export const PDF_MAX_BYTES = 25 * 1024 * 1024; // 25MB
export const PDF_MAX_PAGES = 400;
export const PDF_MAX_CHARS = 60_000; // aligned with BOOK_TEXT_MAX

const PERSIAN_RE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
// A run of digits / Latin letters (+ light punctuation) keeps its internal order in
// RTL lines — numbers are written left-to-right even inside Persian sentences.
const LTR_RUN_RE = /^[0-9۰-۹A-Za-z][0-9۰-۹A-Za-z .,:;+\-–—/%'"]*$/;

export interface ExtractedPdf {
  text: string;
  pages: number;
  chars: number;
  truncated: boolean;
  fileName: string;
  storageKey: string; // tmp key of the kept original PDF (attach on createBook)
  sourceUrl?: string;
}

const TMP_DIR = path.join(process.cwd(), "storage", "books", "tmp");
const STORAGE_KEY_RE = /^[a-zA-Z0-9_-]{6,}\.pdf$/;

/** نگهداری فایل اصلی برای دانلود بعدی دانش‌آموزان (storage/books/tmp/<key>.pdf) */
async function keepOriginalPdf(bytes: Uint8Array): Promise<string> {
  await fs.mkdir(TMP_DIR, { recursive: true });
  const key = `${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}.pdf`;
  await fs.writeFile(path.join(TMP_DIR, key), bytes);
  return key;
}

/** جابه‌جایی فایل موقتی به کنار ردیف کتاب — توسط createBook فراخوانده می‌شود */
export async function attachOriginalPdf(
  bookId: string,
  storageKey: string | null | undefined,
  fileName: string | null | undefined
): Promise<{ path: string; name: string } | null> {
  if (!storageKey || !STORAGE_KEY_RE.test(storageKey)) return null;
  const src = path.join(TMP_DIR, storageKey);
  const dest = path.join(process.cwd(), "storage", "books", `${bookId}-original.pdf`);
  try {
    await fs.rename(src, dest); // tmp و storage در یک فایل‌سیستم‌اند
    return { path: dest, name: (fileName ?? "book.pdf").slice(0, 120) };
  } catch {
    return null; // فایل موقتی نبود (مثلاً فرم بدون PDF ثبت شد) — بی‌خطر
  }
}

/** پاک‌سازی بهترین تلاشِ فایل‌های موقتیِ رهاشده (>۲۴ ساعت) */
async function sweepTmp(): Promise<void> {
  try {
    const entries = await fs.readdir(TMP_DIR).catch(() => null);
    if (!entries) return;
    const cutoff = Date.now() - 24 * 3600_000;
    for (const e of entries) {
      if (!e.endsWith(".pdf")) continue;
      const p = path.join(TMP_DIR, e);
      const st = await fs.stat(p).catch(() => null);
      if (st && st.mtimeMs < cutoff) await fs.rm(p, { force: true }).catch(() => undefined);
    }
  } catch {
    /* بهترین تلاش */
  }
}

interface Piece {
  str: string;
  x: number;
  w: number;
  size: number;
  ltr: boolean; // pure LTR content (digits/Latin) — never Persian, never blank
}

export async function extractPdfText(ctx: AuthContext, file: File): Promise<ExtractedPdf> {
  const perm = await booksUploadPermission(ctx);
  if (!perm.can) {
    throw Errors.forbidden(
      "قابلیت افزودن کتاب برای شما فعال نیست. مدیر کل پلتفرم باید آن را در «تنظیمات و اتصال‌ها» فعال کند."
    );
  }

  const fileName = (file.name || "book.pdf").slice(0, 120);
  if (file.size === 0) throw Errors.validation("فایل خالی است.");
  if (file.size > PDF_MAX_BYTES) {
    throw Errors.validation("حجم فایل PDF بیش از ۲۵ مگابایت است — لطفاً فایل سبک‌تری بارگذاری کنید.");
  }
  const looksPdf = /\.pdf$/i.test(fileName) || file.type === "application/pdf" || file.type === "";
  if (!looksPdf) throw Errors.validation("تنها فایل PDF پشتیبانی می‌شود.");

  const data = new Uint8Array(await file.arrayBuffer());
  if (data.length < 8 || data[0] !== 0x25 || data[1] !== 0x50 || data[2] !== 0x44 || data[3] !== 0x46) {
    throw Errors.validation("این فایل PDF معتبر نیست (امضای فایل یافت نشد).");
  }

  void sweepTmp(); // housekeeping — غیر مسدودکننده
  const storageKey = await keepOriginalPdf(data);
  const out = await extractFromBytes(data, fileName);
  return { ...out, storageKey };
}

// ── Round 20 — استخراج از لینک دانلود (سرور خودش فایل را می‌گیرد) ──

export async function extractPdfFromUrl(ctx: AuthContext, rawUrl: string): Promise<ExtractedPdf> {
  const perm = await booksUploadPermission(ctx);
  if (!perm.can) {
    throw Errors.forbidden(
      "قابلیت افزودن کتاب برای شما فعال نیست. مدیر کل پلتفرم باید آن را در «تنظیمات و اتصال‌ها» فعال کند."
    );
  }

  const url = (rawUrl ?? "").trim();
  if (!/^https?:\/\//i.test(url) || url.length > 800) {
    throw Errors.validation("لینک دانلود باید با http:// یا https:// شروع شود.");
  }

  const { bytes, fileName } = await safeFetchPdf(url);
  void sweepTmp();
  const storageKey = await keepOriginalPdf(bytes);
  const out = await extractFromBytes(bytes, fileName);
  return { ...out, storageKey, sourceUrl: url };
}

/** محافظ SSRF — فقط میزبان‌های عمومی؛ IPهای لوکال/خصوصی و لوکال‌هاست مسدود می‌شوند */
function isPrivateIp(ip: string): boolean {
  const v4 =
    /^(127\.|10\.|0\.|192\.168\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
  const v6 =
    ip === "::1" ||
    ip === "::" ||
    /^(f[cd]|fe[89ab])/i.test(ip); // fc00::/7 (private) + fe80::/10 (link-local)
  return v4 || v6;
}

async function assertPublicHttpUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw Errors.validation("لینک دانلود معتبر نیست.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw Errors.validation("فقط لینک‌های http و https پشتیبانی می‌شوند.");
  }
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw Errors.validation("لینک‌های داخلی/لوکال برای امنیت قابل قبول نیستند — لینک عمومی فایل کتاب را بفرستید.");
  }
  // حل DNS و بررسی همهٔ IPها (جلوگیری از دور زدن با نام دامنه)
  try {
    const addrs = await dns.lookup(host, { all: true });
    for (const a of addrs) {
      const ip = a.address.toLowerCase();
      const mapped = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
      if (isPrivateIp(ip) || isPrivateIp(mapped)) {
        throw Errors.validation("آدرس این لینک به شبکهٔ داخلی اشاره می‌کند — برای امنیت قابل قبول نیست.");
      }
    }
  } catch (e) {
    if (e instanceof ApiError) throw e; // خطای خودمان را دست‌نخورده رد کن
    throw Errors.validation("میزبان این لینک قابل شناسایی نبود — آدرس را بررسی کنید.");
  }
  return u;
}

/** دانلود امن PDF با محافظ SSRF (IPهای خصوصی/لوکال مسدود، پیگیری حداکثر ۳ ریدایرکت) */
async function safeFetchPdf(
  startUrl: string,
  hopsLeft = 3
): Promise<{ bytes: Uint8Array; fileName: string }> {
  await assertPublicHttpUrl(startUrl);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(startUrl, {
      redirect: "manual", // هر پرش را خودمان اعتبارسنجی می‌کنیم
      signal: ctrl.signal,
      headers: { "user-agent": "AEP-BookImporter/1.0", accept: "application/pdf,*/*" },
    });
    // ریدایرکت؟ → مقصد را مثل لینک اصلی اعتبارسنجی و دنبال کن
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw Errors.validation("سرور لینک مقصد را اعلام نکرد (ریدایرکت بدون Location).");
      if (hopsLeft <= 0) throw Errors.validation("زنجیرهٔ ریدایرکت‌های این لینک بیش از حد طولانی است.");
      const next = new URL(loc, startUrl).toString();
      return await safeFetchPdf(next, hopsLeft - 1);
    }
    if (!res.ok) {
      throw Errors.validation(`دریافت فایل از لینک ناموفق بود (کد ${res.status.toLocaleString("fa-IR")}).`);
    }

    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    if (contentType && !contentType.includes("pdf")) {
      throw Errors.validation("آدرس داده‌شده به فایل PDF اشاره ندارد — لینک مستقیم فایل کتاب را بفرستید.");
    }

    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared && declared > PDF_MAX_BYTES) {
      throw Errors.validation("حجم فایل PDF بیش از ۲۵ مگابایت است — لطفاً فایل سبک‌تری معرفی کنید.");
    }

    // خواندن جریانی با سقف حجم
    const reader = res.body?.getReader();
    if (!reader) throw Errors.validation("پاسخ دریافتی فایل قابل خواندنی ندارد.");
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > PDF_MAX_BYTES) {
          ctrl.abort();
          throw Errors.validation("حجم فایل PDF بیش از ۲۵ مگابایت است.");
        }
        chunks.push(value);
      }
    }
    const bytes = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      bytes.set(c, off);
      off += c.byteLength;
    }
    if (bytes.length === 0) throw Errors.validation("فایل دریافتی خالی است.");
    if (bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
      throw Errors.validation("فایل دریافتی PDF معتبر نیست — لینک باید مستقیماً به فایل کتاب ختم شود.");
    }

    // نام فایل: content-disposition → مسیر لینک → پیش‌فرض
    let fileName = "";
    const cd = res.headers.get("content-disposition") ?? "";
    const cdMatch = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(cd);
    if (cdMatch) fileName = decodeURIComponent(cdMatch[1].trim()).slice(0, 120);
    if (!fileName) {
      const base = decodeURIComponent(new URL(startUrl).pathname.split("/").pop() ?? "").slice(0, 120);
      if (/\.pdf$/i.test(base)) fileName = base;
    }
    if (!fileName) fileName = "book.pdf";
    return { bytes, fileName };
  } catch (e) {
    if (e instanceof ApiError) throw e; // خطاهای فارسی خودمان را دست‌نخورده رد کن
    if (e instanceof Error && e.name === "AbortError") {
      throw Errors.validation("دریافت فایل از لینک بیش از ۳۰ ثانیه طول کشید — بعداً دوباره تلاش کنید.");
    }
    throw Errors.validation("دریافت فایل از این لینک ممکن نشد — آدرس را بررسی کنید.");
  } finally {
    clearTimeout(timer);
  }
}

  // Dynamic import keeps the heavy parser out of the module graph until first use.
async function extractFromBytes(data: Uint8Array, fileName: string): Promise<Omit<ExtractedPdf, "storageKey">> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });

  let doc: Awaited<typeof task.promise>;
  try {
    doc = await task.promise;
  } catch (e) {
    const name = (e as { name?: string })?.name ?? "";
    if (name === "PasswordException") {
      throw Errors.validation("این فایل PDF رمزگذاری شده است — ابتدا رمز آن را بردارید.");
    }
    throw Errors.validation("خواندن فایل PDF ممکن نشد — فایل ممکن است خراب باشد.");
  }

  try {
    if (doc.numPages > PDF_MAX_PAGES) {
      throw Errors.validation(`این PDF دارای ${doc.numPages.toLocaleString("fa-IR")} صفحه است؛ حداکثر ${PDF_MAX_PAGES.toLocaleString("fa-IR")} صفحه پشتیبانی می‌شود.`);
    }

    const pageTexts: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      pageTexts.push(assemblePage(tc.items as Array<Record<string, unknown>>));
      page.cleanup();
    }

    let text = pageTexts.join("\n\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    const truncated = text.length > PDF_MAX_CHARS;
    if (truncated) text = text.slice(0, PDF_MAX_CHARS);

    if (text.replace(/\s/g, "").length < 40) {
      throw Errors.validation(
        "متن قابل استخراجی در این PDF پیدا نشد — به‌نظر می‌رسد فایل اسکن‌شده/تصویری است. لطفاً نسخهٔ متنی کتاب را بارگذاری کنید یا متن را دستی بچسبانید."
      );
    }

    return { text, pages: doc.numPages, chars: text.length, truncated, fileName };
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

// ── visual → logical reassembly ──

function assemblePage(items: Array<Record<string, unknown>>): string {
  const pieces: Array<Piece & { y: number }> = [];
  for (const it of items) {
    const str = String(it.str ?? "");
    if (!str || !str.trim()) continue;
    const tr = (it.transform as number[] | undefined) ?? [0, 0, 0, 0, 0, 0];
    pieces.push({
      str,
      x: tr[4] ?? 0,
      y: tr[5] ?? 0,
      w: typeof it.width === "number" ? it.width : 0,
      size: Math.abs(tr[3] ?? tr[0] ?? 12) || 12,
      ltr: LTR_RUN_RE.test(str.trim()) && /[0-9۰-۹A-Za-z]/.test(str),
    });
  }
  if (pieces.length === 0) return "";

  // cluster pieces into visual lines by baseline (top → bottom)
  pieces.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Array<Array<typeof pieces[number]>> = [];
  let current: Array<typeof pieces[number]> = [];
  let baseline = NaN;
  for (const pc of pieces) {
    const tol = Math.max(2, pc.size * 0.45);
    if (Number.isNaN(baseline) || Math.abs(pc.y - baseline) <= tol) {
      current.push(pc);
      baseline = Number.isNaN(baseline) ? pc.y : (baseline * (current.length - 1) + pc.y) / current.length;
    } else {
      lines.push(current);
      current = [pc];
      baseline = pc.y;
    }
  }
  if (current.length) lines.push(current);

  const out: string[] = [];
  for (const line of lines) {
    line.sort((a, b) => a.x - b.x); // visual left → right
    const rtl = line.filter((p) => PERSIAN_RE.test(p.str)).length > 0;
    let seq: typeof line = rtl ? [...line].reverse() : line;
    if (rtl) {
      // digits/Latin runs must keep their internal (LTR) order inside the reversed line
      let start = -1;
      for (let i = 0; i <= seq.length; i++) {
        const isLtr = i < seq.length && seq[i].ltr;
        if (isLtr && start === -1) start = i;
        else if (!isLtr && start !== -1) {
          const seg = seq.slice(start, i).reverse();
          for (let j = 0; j < seg.length; j++) seq[start + j] = seg[j];
          start = -1;
        }
      }
    }
    // gap-aware join: no space between touching glyphs (same word), space on real gaps
    let s = "";
    for (let i = 0; i < seq.length; i++) {
      const p = seq[i];
      s += p.str;
      if (i + 1 < seq.length) {
        const q = seq[i + 1];
        const gap = p.x <= q.x ? q.x - (p.x + p.w) : p.x - (q.x + q.w);
        const threshold = Math.max(1, p.size * 0.16);
        if (gap > threshold && !/\s$/.test(p.str) && !/^\s/.test(q.str)) s += " ";
      }
    }
    const lineText = s
      .normalize("NFKC") // shaped presentation forms → base letters
      .replace(/[ \t]{2,}/g, " ")
      .trim();
    // Neutral bracket/quote pairs get visually mirrored by the line reversal
    // («x» came out as »x«) — swap them back on RTL lines.
    const fixed = rtl
      ? lineText.replace(/[«»()[\]{}]/g, (c) => {
          switch (c) {
            case "«": return "»";
            case "»": return "«";
            case "(": return ")";
            case ")": return "(";
            case "[": return "]";
            case "]": return "[";
            case "{": return "}";
            case "}": return "{";
            default: return c;
          }
        })
      : lineText;
    if (fixed) out.push(fixed);
  }
  return out.join("\n");
}
