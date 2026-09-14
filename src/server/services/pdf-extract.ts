// Round 19 — server-side PDF text extraction for the Smart Library upload flow.
// The admin picks دوره → پایه → درس and uploads the textbook as a PDF; we extract
// the plain text here so the existing 5-artifact pipeline (خلاصه/جزوه/شکل/نمونه‌سؤال/
// پادکست) can run on it. Extraction uses pdfjs-dist (legacy Node build) kept external
// via next.config serverExternalPackages.
//
// RTL reassembly (verified against a Chromium-printed Persian PDF with the Vazirmatn
// font): pdf.js returns text items in VISUAL order (x ascending) with presentation-form
// glyphs. For Persian-dominant lines we reverse the item sequence to logical order,
// re-reverse contiguous LTR runs (digits/Latin) so numbers stay readable, join items
// with a gap-aware space heuristic, then NFKC-normalize presentation forms to base
// letters (ﺴ → س). Persian digits (۰-۹) are unaffected by NFKC.

import type { AuthContext } from "@/server/auth/session";
import { Errors } from "@/server/core/errors";
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

  // Dynamic import keeps the heavy parser out of the module graph until first use.
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
