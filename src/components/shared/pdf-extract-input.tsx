"use client";

import { useRef, useState, type ReactNode } from "react";
import { api, ApiClientError } from "@/lib/app/api-client";
import { faNum } from "@/components/shared/blocks";
import { cn } from "@/lib/utils";
import {
  BadgeCheck,
  FileText,
  FlaskConical,
  Link2,
  Loader2,
  PackageOpen,
  RefreshCw,
  TriangleAlert,
  UploadCloud,
  X,
} from "lucide-react";

// ── Round 19 — PDF upload with server-side text extraction ──
// ── Round 20 — two sources share one widget: 📎 file upload OR 🔗 download link ──
// ── Round 21 — «تست لینک دانلود» دکمهٔ مستقل: سرور لینک را واقعاً دانلود می‌کند و ──
// اگر دانلود نشد خطای دقیق فارسی نشان می‌دهد؛ بعد مدیر به «دریافت و استخراج» می‌رود.
// Used by the platform + teacher book upload forms: the admin picks
// دوره → پایه → درس and provides the textbook either as a PDF file or as a direct
// download link; the server extracts the text (RTL-aware) and keeps the original PDF
// so students can later download the real book. The form fills the review textarea
// with the extracted text.

const MAX_BYTES = 25 * 1024 * 1024;

export interface PdfExtractResult {
  text: string;
  pages: number;
  chars: number;
  truncated: boolean;
  fileName: string;
  storageKey: string;
  sourceUrl?: string;
}

export interface PdfLinkTestResult {
  ok: true;
  fileName: string;
  sizeBytes: number;
  sourceUrl: string;
}

/** حجم فایل به فارسی (کیلوبایت/مگابایت) */
function faSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    // Intl.NumberFormat fa-IR خودش ممیز فارسی می‌گذارد
    return `${new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1 }).format(mb)} مگابایت`;
  }
  return `${faNum(Math.max(1, Math.round(bytes / 1024)))} کیلوبایت`;
}

type Mode = "file" | "url";

export function PdfExtractInput({
  onExtracted,
  onCleared,
  disabled = false,
  idPrefix = "pdf",
}: {
  onExtracted: (r: PdfExtractResult) => void;
  onCleared?: () => void;
  disabled?: boolean;
  idPrefix?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("file");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<PdfExtractResult | null>(null);
  // ── تست لینک دانلود (راند ۲۱) ──
  const [testBusy, setTestBusy] = useState(false);
  const [testOk, setTestOk] = useState<PdfLinkTestResult | null>(null);
  const [testErr, setTestErr] = useState<string | null>(null);

  function switchMode(next: Mode) {
    if (disabled || busy || next === mode) return;
    setMode(next);
    setError(null);
    // نتیجهٔ قبلی در تعویض روش پاک می‌شود (متن در textarea دست کاربر می‌ماند)
    if (done) {
      setDone(null);
      onCleared?.();
    }
  }

  async function handleFile(file: File | null | undefined) {
    if (!file || disabled) return;
    setError(null);
    setDone(null);
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      setError("تنها فایل PDF پشتیبانی می‌شود.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("حجم فایل بیش از ۲۵ مگابایت است.");
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await api<PdfExtractResult>("/api/v1/books/extract-pdf", { method: "POST", body });
      setDone(res);
      onExtracted(res);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "استخراج متن از فایل ممکن نشد.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleUrl() {
    const u = url.trim();
    if (disabled || busy || !u) return;
    setError(null);
    setDone(null);
    setTestOk(null);
    setTestErr(null);
    if (!/^https?:\/\//i.test(u)) {
      setError("لینک باید با http:// یا https:// شروع شود.");
      return;
    }
    setBusy(true);
    try {
      const res = await api<PdfExtractResult>("/api/v1/books/extract-url", {
        method: "POST",
        body: JSON.stringify({ url: u }),
      });
      setDone(res);
      onExtracted(res);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "دریافت فایل از لینک ممکن نشد.");
    } finally {
      setBusy(false);
    }
  }

  /** راند ۲۱ — تست لینک دانلود: سرور فایل را واقعاً دانلود می‌کند؛ خطای دقیق اگر نشد */
  async function handleTestUrl() {
    const u = url.trim();
    if (disabled || testBusy || busy || !u) return;
    setTestOk(null);
    setTestErr(null);
    setError(null);
    setDone(null);
    if (!/^https?:\/\//i.test(u)) {
      setTestErr("لینک باید با http:// یا https:// شروع شود.");
      return;
    }
    setTestBusy(true);
    try {
      const res = await api<PdfLinkTestResult>("/api/v1/books/test-url", {
        method: "POST",
        body: JSON.stringify({ url: u }),
      });
      setTestOk(res);
    } catch (e) {
      setTestErr(
        e instanceof ApiClientError
          ? e.message
          : "دانلود از این لینک ممکن نشد — آدرس را بررسی کنید و دوباره تست کنید."
      );
    } finally {
      setTestBusy(false);
    }
  }

  function reset() {
    setError(null);
    setDone(null);
    setUrl("");
    setTestOk(null);
    setTestErr(null);
    onCleared?.();
  }

  const modeTabs: Array<{ key: Mode; label: string; icon: ReactNode }> = [
    { key: "file", label: "فایل PDF", icon: <UploadCloud className="h-3.5 w-3.5" aria-hidden /> },
    { key: "url", label: "لینک دانلود", icon: <Link2 className="h-3.5 w-3.5" aria-hidden /> },
  ];

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        id={`${idPrefix}-file`}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />

      {/* ── selector de روش: فایل یا لینک ── */}
      {!busy && !done && (
        <div
          role="tablist"
          aria-label="روش افزودن کتاب"
          className="inline-flex rounded-xl border border-border/70 bg-muted/30 p-1 gap-1"
        >
          {modeTabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={mode === t.key}
              disabled={disabled}
              onClick={() => switchMode(t.key)}
              className={cn(
                "h-8 px-3 rounded-lg text-xs font-medium transition-all inline-flex items-center gap-1.5",
                mode === t.key
                  ? "bg-teal-600 text-white shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                disabled && "opacity-50 cursor-not-allowed"
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      )}

      {mode === "file" && !busy && !done && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void handleFile(e.dataTransfer.files?.[0]);
          }}
          className={cn(
            "w-full min-h-11 rounded-xl border-2 border-dashed p-4 text-center transition-all",
            "flex flex-col items-center gap-1.5",
            dragOver
              ? "border-teal-500 bg-teal-500/10 scale-[1.01]"
              : "border-border/70 bg-muted/30 hover:border-teal-400/60 hover:bg-teal-500/5",
            disabled && "opacity-50 cursor-not-allowed"
          )}
          aria-describedby={error ? `${idPrefix}-err` : undefined}
        >
          <UploadCloud className="h-6 w-6 text-teal-600 dark:text-teal-400" aria-hidden />
          <span className="text-xs font-medium">بارگذاری کتاب به‌صورت فایل PDF</span>
          <span className="text-[10px] text-muted-foreground leading-4">
            کلیک کنید یا فایل را همین‌جا رها کنید — متن کتاب به‌صورت خودکار استخراج می‌شود (تا ۲۵ مگابایت و ۴۰۰ صفحه)
          </span>
        </button>
      )}

      {mode === "url" && !busy && !done && (
        <div className="rounded-xl border border-border/70 bg-muted/30 p-3 space-y-2">
          <label htmlFor={`${idPrefix}-url`} className="text-xs font-medium flex items-center gap-1.5">
            <Link2 className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" aria-hidden />
            لینک مستقیم دانلود PDF کتاب
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              id={`${idPrefix}-url`}
              type="url"
              dir="ltr"
              inputMode="url"
              className="h-11 flex-1 min-w-0 rounded-lg border border-border/70 bg-background px-3 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500/60 transition-all"
              placeholder="https://example.com/riazi-3.pdf"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (testOk || testErr) {
                  // لینک عوض شد — نتیجهٔ تست قبلی دیگر معتبر نیست
                  setTestOk(null);
                  setTestErr(null);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleUrl();
                }
              }}
              disabled={disabled || testBusy}
              maxLength={800}
              autoComplete="off"
              spellCheck={false}
            />
            <div className="flex gap-2 shrink-0">
              <button
                type="button"
                onClick={() => void handleTestUrl()}
                disabled={disabled || testBusy || !url.trim()}
                className="h-11 px-3.5 rounded-lg border border-teal-600/50 text-teal-700 dark:text-teal-400 text-xs font-medium inline-flex items-center gap-1.5 hover:bg-teal-500/10 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {testBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <FlaskConical className="h-4 w-4" aria-hidden />
                )}
                تست لینک
              </button>
              <button
                type="button"
                onClick={() => void handleUrl()}
                disabled={disabled || !url.trim()}
                className="h-11 px-4 rounded-lg bg-gradient-to-l from-emerald-600 to-teal-600 text-white text-xs font-medium inline-flex items-center gap-1.5 hover:brightness-110 active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <PackageOpen className="h-4 w-4" aria-hidden />
                دریافت و استخراج
              </button>
            </div>
          </div>

          {/* نتیجهٔ تست لینک دانلود (راند ۲۱) */}
          {testBusy && (
            <div
              className="rounded-lg border border-teal-500/40 bg-teal-500/5 px-3 py-2 flex items-center gap-2"
              role="status"
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin text-teal-600 dark:text-teal-400 shrink-0" aria-hidden />
              <p className="text-[11px] text-teal-700 dark:text-teal-400">در حال دانلود و تست لینک…</p>
            </div>
          )}
          {testOk && !testBusy && (
            <div
              className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3 py-2.5 flex items-start gap-2"
              role="status"
            >
              <BadgeCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 leading-5">
                  لینک سالم است — فایل با موفقیت دانلود و اعتبارسنجی شد ✅
                </p>
                <p className="text-[10px] text-muted-foreground truncate leading-4" dir="auto">
                  {testOk.fileName} · {faSize(testOk.sizeBytes)} · PDF معتبر
                </p>
                <p className="text-[10px] text-muted-foreground leading-4">
                  حالا «دریافت و استخراج» را بزنید تا متن کتاب استخراج و PDF اصلی ضمیمه شود.
                </p>
              </div>
            </div>
          )}
          {testErr && !testBusy && (
            <div
              className="rounded-lg border border-rose-500/40 bg-rose-500/5 px-3 py-2.5 flex items-start gap-2"
              role="alert"
            >
              <TriangleAlert className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium text-rose-700 dark:text-rose-400 leading-5">دانلود از این لینک ممکن نشد!</p>
                <p className="text-[10px] text-rose-600/90 dark:text-rose-400/90 leading-5">{testErr}</p>
              </div>
              <button
                type="button"
                onClick={() => setTestErr(null)}
                className="text-[10px] underline underline-offset-2 shrink-0 text-rose-700 dark:text-rose-400"
              >
                تلاش مجدد
              </button>
            </div>
          )}

          <p className="text-[10px] text-muted-foreground leading-4">
            سرور خودش فایل را از لینک می‌گیرد (تا ۲۵ مگابایت) — نسخهٔ اصلی PDF برای دانلود دانش‌آموزان نگه داشته می‌شود. با «تست لینک» ابتدا مطمئن شوید لینک دانلود می‌شود.
          </p>
        </div>
      )}

      {busy && (
        <div className="rounded-xl border border-teal-500/40 bg-teal-500/5 p-3.5 flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-teal-600 dark:text-teal-400 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium">
              {mode === "url" ? "در حال دریافت فایل از لینک و استخراج متن…" : "در حال استخراج متن از PDF…"}
            </p>
            <p className="text-[10px] text-muted-foreground truncate" dir="auto">
              {mode === "url" ? url : "این چند لحظه طول می‌کشد — لطفاً صفحه را نبندید."}
            </p>
          </div>
        </div>
      )}

      {done && (
        <div
          className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-3.5 flex items-start gap-3"
          role="status"
        >
          <FileText className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" aria-hidden />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
              متن کتاب با موفقیت استخراج شد
              <span className="text-muted-foreground font-normal"> — {faNum(done.pages)} صفحه · {faNum(done.chars)} نویسه</span>
            </p>
            <p className="text-[10px] text-muted-foreground truncate" dir="auto">
              {done.sourceUrl ? `🔗 ${done.sourceUrl}` : done.fileName} — متن در کادر پایین بارگذاری شد؛ می‌توانید پیش از ثبت، آن را ویرایش کنید.
            </p>
            {done.truncated && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1 leading-4">
                <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden />
                متن طولانی بود و فقط {faNum(done.chars)} نویسهٔ ابتدایی آن (سقف مجاز) نگه داشته شد.
              </p>
            )}
            <p className="text-[10px] text-emerald-600/90 dark:text-emerald-400/80 flex items-center gap-1 leading-4">
              <PackageOpen className="h-3 w-3 shrink-0" aria-hidden />
              نسخهٔ اصلی PDF ضمیمه کتاب می‌شود تا دانش‌آموزان بتوانند خود کتاب را دانلود کنند.
            </p>
          </div>
          <button
            type="button"
            onClick={reset}
            className="h-8 px-2.5 rounded-lg border border-border/60 text-[10px] text-muted-foreground hover:bg-muted/50 transition-colors shrink-0 flex items-center gap-1"
          >
            <RefreshCw className="h-3 w-3" aria-hidden />
            {mode === "url" ? "لینک دیگر" : "فایل دیگر"}
          </button>
        </div>
      )}

      {error && (
        <div
          id={`${idPrefix}-err`}
          className="rounded-xl border border-rose-500/40 bg-rose-500/5 p-3 flex items-start gap-2 text-xs text-rose-700 dark:text-rose-400"
          role="alert"
        >
          <X className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
          <span className="leading-6 flex-1">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-[10px] underline underline-offset-2 shrink-0"
          >
            تلاش مجدد
          </button>
        </div>
      )}
    </div>
  );
}
