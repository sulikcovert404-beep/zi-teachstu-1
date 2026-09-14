import fs from "fs/promises";
import path from "path";
import { Errors } from "@/server/core/errors";

// ─────────────────────────────────────────────────────────────────────────────
// Round 22 — Persian PDF engine (Chromium + Vazirmatn)
// Every downloadable document (خلاصه، جزوه، نمونه‌سؤال) is rendered as a real
// Persian RTL PDF: Chromium's text engine does the shaping/bidi (the same engine
// that renders the web app), and the Vazirmatn font is embedded as base64 woff2
// so the output looks identical everywhere — no system-font dependency.
// ─────────────────────────────────────────────────────────────────────────────

const CHROMIUM_CANDIDATES = [
  process.env.PDF_CHROMIUM_PATH,
  "/home/z/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome",
  "/home/z/.cache/ms-playwright/chromium-1200/chrome-linux/chrome",
].filter(Boolean) as string[];

const FONT_DIR = path.join(process.cwd(), "public", "fonts");
const RENDER_TIMEOUT_MS = 45_000;

// module/global-scoped singleton (hot-reload safe)
interface PdfGlobals {
  __pdfBrowser?: import("playwright-core").Browser | null;
  __pdfFonts?: { regular: string; bold: string; medium: string };
  __pdfLaunch?: Promise<import("playwright-core").Browser> | null;
}
const g = globalThis as typeof globalThis & PdfGlobals;

// ── fonts (base64, cached) ──

async function loadFonts(): Promise<{ regular: string; bold: string; medium: string }> {
  if (g.__pdfFonts) return g.__pdfFonts;
  const read = (f: string) => fs.readFile(path.join(FONT_DIR, f)).then((b) => b.toString("base64"));
  g.__pdfFonts = {
    regular: await read("Vazirmatn-Regular.woff2"),
    bold: await read("Vazirmatn-Bold.woff2"),
    medium: await read("Vazirmatn-Medium.woff2"),
  };
  return g.__pdfFonts;
}

// ── browser singleton ──

async function getBrowser(): Promise<import("playwright-core").Browser> {
  if (g.__pdfBrowser && g.__pdfBrowser.isConnected()) return g.__pdfBrowser;
  if (g.__pdfLaunch) return g.__pdfLaunch;
  g.__pdfLaunch = (async () => {
    const { chromium } = await import("playwright-core");
    let exe = CHROMIUM_CANDIDATES[0];
    for (const cand of CHROMIUM_CANDIDATES) {
      if (await fs.stat(cand).then(() => true).catch(() => false)) {
        exe = cand;
        break;
      }
    }
    const browser = await chromium.launch({
      executablePath: exe,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--disable-devtools-frontend", "--hide-scrollbars"],
    });
    g.__pdfBrowser = browser;
    return browser;
  })();
  try {
    return await g.__pdfLaunch;
  } finally {
    g.__pdfLaunch = null;
  }
}

/** رندر HTML به PDF فارسی (A4، پس‌زمینه چاپ‌شده، فوتر تکرارشونده) */
export async function renderPersianPdf(html: string): Promise<Buffer> {
  const browser = await getBrowser().catch(() => {
    throw Errors.internal();
  });
  let page: import("playwright-core").Page | null = null;
  try {
    page = await browser.newPage();
    const withTimeout = <T,>(p: Promise<T>): Promise<T> =>
      Promise.race([
        p,
        new Promise<T>((_, rej) => setTimeout(() => rej(new Error("pdf render timeout")), RENDER_TIMEOUT_MS)),
      ]);
    await withTimeout(page.setContent(html, { waitUntil: "load" }));
    // اطمینان از بار شدن فونت‌های جاسازی‌شده پیش از چاپ
    await withTimeout(page.evaluate(() => (document as any).fonts?.ready ?? Promise.resolve()));
    const pdf = await withTimeout(
      page.pdf({
        format: "A4",
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: "<div></div>",
        footerTemplate:
          '<div style="font-size:8px;color:#94a3b8;width:100%;text-align:center;padding-top:1mm;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
        margin: { top: "14mm", bottom: "16mm", left: "11mm", right: "11mm" },
      })
    );
    return Buffer.from(pdf);
  } catch {
    throw Errors.internal();
  } finally {
    await page?.close().catch(() => undefined);
  }
}

// ── helpers ──

export function faDigits(input: string | number): string {
  return String(input).replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** حذف ایموجی‌ها (فونت ایموجی روی سرور نیست → مربع توخالی می‌شود) */
export function stripEmoji(s: string): string {
  return s
    .replace(/[\p{Extended_Pictographic}\u2600-\u27BF\uFE0F\u200D]/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function faDate(d = new Date()): string {
  try {
    return new Intl.DateTimeFormat("fa-IR", { dateStyle: "long" }).format(d);
  } catch {
    return faDigits(`${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`);
  }
}

// ── minimal markdown → HTML (same mapping family as the docx builder) ──

export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let listMode: "ul" | "ol" | null = null;
  const inline = (t: string) =>
    esc(t)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, '<code class="md-code">$1</code>');

  const closeList = () => {
    if (listMode) {
      out.push(`</${listMode}>`);
      listMode = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      closeList();
      continue;
    }
    // جدول مارک‌داون → جدول واقعی
    const tableRow = /^\|(.+)\|$/.exec(line);
    if (tableRow) {
      const cells = tableRow[1].split("|").map((c) => c.trim());
      if (cells.every((c) => /^[-: ]*$/.test(c))) continue; // ردیف جداکننده
      closeList();
      out.push(
        `<tr>${cells.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`
      );
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const lvl = heading[1].length;
      out.push(`<h${lvl + 1} class="md-h${lvl}">${inline(heading[2])}</h${lvl + 1}>`);
      continue;
    }
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      if (listMode !== "ul") {
        closeList();
        out.push('<ul class="md-ul">');
        listMode = "ul";
      }
      out.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (numbered) {
      if (listMode !== "ol") {
        closeList();
        out.push('<ol class="md-ol">');
        listMode = "ol";
      }
      out.push(`<li>${inline(numbered[1])}</li>`);
      continue;
    }
    closeList();
    out.push(`<p class="md-p">${inline(line)}</p>`);
  }
  closeList();

  // پیوستن ردیف‌های جدول پشت‌سرهم
  let html = out.join("\n");
  html = html.replace(/(<tr>[\s\S]*?<\/tr>\n?)+/g, (m) => `<table class="md-table">${m}</table>`);
  return html;
}

// ── استایل مشترک (کاور + بدنه + فوتر تکرارشونده) ──

async function baseCss(): Promise<string> {
  const f = await loadFonts();
  return `
@font-face{font-family:'Vazirmatn';src:url(data:font/woff2;base64,${f.regular}) format('woff2');font-weight:400;font-style:normal}
@font-face{font-family:'Vazirmatn';src:url(data:font/woff2;base64,${f.medium}) format('woff2');font-weight:500;font-style:normal}
@font-face{font-family:'Vazirmatn';src:url(data:font/woff2;base64,${f.bold}) format('woff2');font-weight:700;font-style:normal}
*{box-sizing:border-box}
html{direction:rtl}
body{font-family:'Vazirmatn','DejaVu Sans',sans-serif;direction:rtl;text-align:right;color:#1f2937;margin:0;font-size:10.5pt;line-height:2;font-weight:400}
.cover{position:relative;border-radius:14px;overflow:hidden;background:linear-gradient(135deg,#064e3b 0%,#0f766e 55%,#115e59 100%);color:#fff;padding:22px 24px 20px;margin-bottom:18px}
.cover .deco{position:absolute;left:-30px;top:-40px;width:170px;height:170px;border-radius:50%;background:rgba(255,255,255,.08)}
.cover .deco2{position:absolute;left:60px;bottom:-60px;width:130px;height:130px;border-radius:50%;background:rgba(52,211,153,.15)}
.cover .kind{display:inline-block;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.3);border-radius:99px;padding:2px 14px;font-size:8.5pt;font-weight:700;letter-spacing:.02em}
.cover h1{margin:10px 0 6px;font-size:17pt;font-weight:700;line-height:1.6}
.cover .meta{font-size:9pt;color:rgba(255,255,255,.85);line-height:1.9}
.cover .meta .chip{display:inline-block;background:rgba(255,255,255,.12);border-radius:8px;padding:1px 10px;margin:0 0 0 6px}
.brandline{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.brandline .logo{width:30px;height:30px;border-radius:9px;background:rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;border:1px solid rgba(255,255,255,.25)}
.brandline .name{font-size:9pt;font-weight:700;color:rgba(255,255,255,.92)}
.md-h1{font-size:13.5pt;font-weight:700;color:#0f766e;border-right:4px solid #10b981;padding-right:10px;margin:18px 0 8px;line-height:1.7}
.md-h2{font-size:12pt;font-weight:700;color:#115e59;border-right:3px solid #5eead4;padding-right:10px;margin:16px 0 6px;line-height:1.7}
.md-h3{font-size:11pt;font-weight:700;color:#134e4a;margin:12px 0 4px;line-height:1.7}
.md-p{margin:0 0 8px;text-align:justify}
.md-ul,.md-ol{margin:4px 22px 10px 8px;padding:0}
.md-ul li{list-style:none;position:relative;padding-right:14px;margin-bottom:4px}
.md-ul li:before{content:'';position:absolute;right:0;top:.72em;width:6px;height:6px;border-radius:2px;background:#10b981}
.md-ol{counter-reset:oli}
.md-ol li{list-style:none;position:relative;padding-right:22px;margin-bottom:4px;counter-increment:oli}
.md-ol li:before{content:counter(oli,arabic-indic);position:absolute;right:0;top:.1em;width:16px;height:16px;border-radius:5px;background:#d1fae5;color:#065f46;font-size:7.5pt;font-weight:700;display:flex;align-items:center;justify-content:center}
strong{font-weight:700;color:#0f172a}
.md-code{font-family:'DejaVu Sans Mono',monospace;font-size:8.5pt;background:#f1f5f9;border-radius:5px;padding:1px 5px;direction:ltr;display:inline-block}
.md-table{width:100%;border-collapse:collapse;margin:8px 0 12px;font-size:9.5pt}
.md-table td{border:1px solid #d7e3de;padding:6px 10px;vertical-align:top}
.md-table tr:first-child td{background:#ecfdf5;font-weight:700;color:#065f46}
.doc-footer{position:fixed;bottom:0;right:0;left:0;padding:5mm 11mm 3mm;background:linear-gradient(to top,#fffffff2 55%,rgba(255,255,255,0));border-top:.5pt solid #e2e8f0;color:#64748b;font-size:8pt;display:flex;justify-content:space-between;align-items:center}
.doc-footer .r{display:flex;align-items:center;gap:6px}
.doc-footer .dot{width:5px;height:5px;border-radius:50%;background:#10b981}
.note-box{border:1px solid #a5f3fc;background:linear-gradient(180deg,#f0fdfa,#ecfeff);border-radius:12px;padding:10px 14px;font-size:9.5pt;color:#155e75;margin:0 0 14px}
.warn-box{border:1px solid #fde68a;background:#fffbeb;border-radius:12px;padding:10px 14px;font-size:9.5pt;color:#92400e;margin:0 0 14px}
.pagebreak{page-break-before:always}
`;
}

async function wrapHtml(bodyInner: string, extraCss = ""): Promise<string> {
  const css = await baseCss();
  return `<!doctype html><html dir="rtl" lang="fa"><head><meta charset="utf-8"><style>${css}${extraCss}</style></head><body>${bodyInner}</body></html>`;
}

function footerHtml(footerNote: string): string {
  return `<div class="doc-footer"><div class="r"><span class="dot"></span><span>پلتفرم آموزش هوشمند ایران</span></div><div>${esc(footerNote)} · ${faDate()}</div></div>`;
}

const LOGO_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6ee7b7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 4.5 3 6 0 1.5 3 3 3 6 0v-5"/></svg>`;

// ── قالب خلاصه / جزوه (markdown body) ──

export interface DocPdfInput {
  title: string;
  kind: string; // «خلاصهٔ هوشمند کتاب» / «جزوهٔ درسی هوشمند»
  metaBits: string[];
  markdown: string;
  footerNote: string;
  intro?: string;
}

export async function renderDocPdf(input: DocPdfInput): Promise<Buffer> {
  const body = `
  <div class="cover">
    <div class="deco"></div><div class="deco2"></div>
    <div class="brandline"><div class="logo">${LOGO_SVG}</div><span class="name">پلتفرم آموزش هوشمند ایران</span></div>
    <span class="kind">${esc(input.kind)}</span>
    <h1>${esc(stripEmoji(input.title))}</h1>
    <div class="meta">${input.metaBits.filter(Boolean).map((m) => `<span class="chip">${esc(m)}</span>`).join("")}</div>
  </div>
  ${input.intro ? `<div class="note-box">${esc(input.intro)}</div>` : ""}
  ${markdownToHtml(stripEmoji(input.markdown))}
  ${footerHtml(input.footerNote)}
  `;
  return renderPersianPdf(await wrapHtml(body));
}

// ── قالب نمونه‌سؤال (چارچوب رسمی برگهٔ آزمون + پاسخ‌نامه) ──

export interface QuizPdfQuestion {
  kind: "mc" | "tf" | "fb" | "short";
  prompt: string;
  options?: string[];
  correctIndex?: number;
  correct?: boolean;
  answer?: string;
  referenceAnswer?: string;
  explanation?: string;
  topic?: string;
}

export interface QuizPdfInput {
  title: string;
  metaBits: string[];
  modelLabel: string;
  questions: QuizPdfQuestion[];
  footerNote: string;
}

const KIND_FA: Record<string, string> = {
  mc: "چهارگزینه‌ای",
  tf: "درست / غلط",
  fb: "جای خالی",
  short: "تشریحی کوتاه",
};

function optionLabel(i: number): string {
  return faDigits(i + 1);
}

function questionHtml(q: QuizPdfQuestion, idx: number): string {
  const num = faDigits(idx + 1);
  const topic = q.topic ? `<span class="q-topic">${esc(stripEmoji(q.topic))}</span>` : "";
  let body = "";
  if (q.kind === "mc" && q.options && q.options.length > 0) {
    body = `<div class="q-opts">${q.options
      .map((o, i) => `<div class="q-opt"><span class="q-opt-num">${optionLabel(i)})</span><span>${esc(stripEmoji(o))}</span></div>`)
      .join("")}</div>`;
  } else if (q.kind === "tf") {
    body = `<div class="q-opts one"><div class="q-opt tf"><span class="tf-paren">(</span><span>صحیح</span><span class="tf-sep">/</span><span>غلط</span><span class="tf-paren">)</span></div></div>`;
  } else if (q.kind === "fb") {
    body = `<div class="q-blank"></div>`;
  } else {
    body = `<div class="q-lines"><span></span><span></span><span></span></div>`;
  }
  return `<div class="q-block kind-${q.kind}">
    <div class="q-head"><span class="q-num">${num}.</span><span class="q-prompt">${esc(stripEmoji(q.prompt))}</span>${topic}</div>
    ${body}
    <div class="q-score">……… نمره از ۱</div>
  </div>`;
}

function answerKeyHtml(questions: QuizPdfQuestion[]): string {
  const rows = questions
    .map((q, i) => {
      let ans = "—";
      if (q.kind === "mc" && typeof q.correctIndex === "number" && q.options?.[q.correctIndex] !== undefined) {
        ans = `گزینهٔ ${faDigits(q.correctIndex + 1)} — ${stripEmoji(q.options![q.correctIndex])}`;
      } else if (q.kind === "tf") {
        ans = q.correct === true ? "صحیح ✔" : q.correct === false ? "غلط ✘" : "—";
      } else if (q.kind === "fb") {
        ans = stripEmoji(q.answer ?? q.referenceAnswer ?? "—");
      } else {
        ans = stripEmoji(q.referenceAnswer ?? q.answer ?? "—");
      }
      const exp = q.explanation ? stripEmoji(q.explanation) : "";
      return `<tr><td class="c">${faDigits(i + 1)}</td><td class="c kind-${q.kind}">${KIND_FA[q.kind] ?? ""}</td><td><strong>${esc(ans)}</strong>${exp ? `<div class="exp">${esc(exp)}</div>` : ""}</td></tr>`;
    })
    .join("");
  return `
  <div class="pagebreak"></div>
  <div class="cover slim">
    <div class="deco"></div>
    <span class="kind">پاسخ‌نامهٔ تشریحی</span>
    <h1>پاسخ‌نامه + توضیحات</h1>
    <div class="meta"><span class="chip">${faDigits(questions.length)} سؤال</span></div>
  </div>
  <div class="warn-box">این بخش جداگانه چاپ می‌شود — ابتدا آزمون را بدهید، بعد پاسخ‌ها را بررسی کنید. هر پاسخ با توضیح کوتاه آمده است.</div>
  <table class="key-table">${rows}</table>`;
}

export async function renderQuizPdf(input: QuizPdfInput): Promise<Buffer> {
  const total = input.questions.length;
  const kindCounts = input.questions.reduce<Record<string, number>>((acc, q) => {
    acc[q.kind] = (acc[q.kind] ?? 0) + 1;
    return acc;
  }, {});
  const kindBits = Object.entries(kindCounts)
    .map(([k, n]) => `${faDigits(n)} ${KIND_FA[k] ?? k}`)
    .join(" · ");

  const css = `
.q-block{border:1px solid #e2e8f0;border-right:4px solid #10b981;border-radius:11px;padding:10px 14px 8px;margin:0 0 12px;page-break-inside:avoid;background:#ffffff}
.q-block.kind-tf{border-right-color:#0ea5e9}
.q-block.kind-fb{border-right-color:#f59e0b}
.q-block.kind-short{border-right-color:#8b5cf6}
.q-head{display:flex;align-items:flex-start;gap:8px;font-weight:500}
.q-num{font-weight:700;color:#0f766e;font-size:11pt;min-width:20px}
.q-prompt{flex:1;line-height:1.95;text-align:justify}
.q-topic{background:#f1f5f9;border-radius:7px;padding:1px 9px;font-size:8pt;color:#475569;margin-top:4px;white-space:nowrap}
.q-opts{display:grid;grid-template-columns:1fr 1fr;gap:6px 18px;margin:8px 20px 2px 0}
.q-opts.one{grid-template-columns:1fr}
.q-opt{display:flex;gap:7px;align-items:flex-start;line-height:1.8;font-size:10pt}
.q-opt-num{font-weight:700;color:#92400e;min-width:16px}
.q-opt.tf{font-weight:700;letter-spacing:.06em;color:#0c4a6e}
.tf-paren{color:#94a3b8;font-weight:700}
.tf-sep{color:#cbd5e1;margin:0 6px}
.q-blank{margin:10px 20px 4px 0;border-bottom:1.5pt dotted #94a3b8;height:16px}
.q-lines{margin:8px 20px 2px 0;display:flex;flex-direction:column;gap:14px}
.q-lines span{border-bottom:1pt dotted #cbd5e1;height:1px}
.q-score{font-size:8pt;color:#94a3b8;text-align:left;margin-top:2px}
.key-table{width:100%;border-collapse:collapse;margin-top:10px;font-size:10pt}
.key-table td{border:1px solid #d7e3de;padding:8px 12px;vertical-align:top}
.key-table td.c{text-align:center;white-space:nowrap;font-weight:700;background:#f8fafc}
.key-table .exp{margin-top:4px;font-size:9pt;color:#475569;line-height:1.8}
.cover.slim{padding:16px 20px 14px}
.cover.slim h1{font-size:14pt;margin:8px 0 4px}
`;

  const body = `
  <div class="cover">
    <div class="deco"></div><div class="deco2"></div>
    <div class="brandline"><div class="logo">${LOGO_SVG}</div><span class="name">پلتفرم آموزش هوشمند ایران</span></div>
    <span class="kind">نمونه‌سؤال هوشمند · ${esc(input.modelLabel)}</span>
    <h1>${esc(stripEmoji(input.title))}</h1>
    <div class="meta">${input.metaBits.filter(Boolean).map((m) => `<span class="chip">${esc(m)}</span>`).join("")}</div>
  </div>

  <div class="note-box">
    <strong>راهنمای برگهٔ آزمون:</strong>
    این برگه شامل <strong>${faDigits(total)} سؤال</strong> است (${esc(kindBits)}).
    برای هر سؤال فقط یک پاسخ صحیح است و هر سؤال ۱ نمره دارد — نمرهٔ کل: <strong>${faDigits(total)} نمره</strong>.
    سؤال‌های جای‌خالی را روی خط نقطه‌چین و سؤال‌های تشریحی را در کادر پاسخ بنویسید.
    <strong>پاسخ‌نامهٔ تشریحی در صفحهٔ آخر</strong> این فایل آمده است.
  </div>

  <div class="student-row">
    <div class="s-field"><span class="s-label">نام و نام خانوادگی:</span><span class="s-line"></span></div>
    <div class="s-field small"><span class="s-label">کلاس:</span><span class="s-line"></span></div>
    <div class="s-field small"><span class="s-label">تاریخ:</span><span class="s-line"></span></div>
  </div>

  ${input.questions.map((q, i) => questionHtml(q, i)).join("\n")}

  ${answerKeyHtml(input.questions)}

  ${footerHtml(input.footerNote)}
  `;

  const extra = css + `
.student-row{display:flex;gap:14px;border:1px dashed #cbd5e1;border-radius:11px;padding:9px 14px;margin:0 0 16px;background:#f8fafc}
.s-field{flex:1;display:flex;align-items:flex-end;gap:8px;font-size:9.5pt;color:#334155;padding-bottom:2px}
.s-field.small{flex:0 0 30%}
.s-label{font-weight:700;color:#0f766e;white-space:nowrap}
.s-line{flex:1;border-bottom:1pt dotted #94a3b8;height:12px}
`;
  return renderPersianPdf(await wrapHtml(body, extra));
}
