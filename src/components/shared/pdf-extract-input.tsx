"use client";

import { useRef, useState } from "react";
import { api, ApiClientError } from "@/lib/app/api-client";
import { faNum } from "@/components/shared/blocks";
import { cn } from "@/lib/utils";
import { FileText, Loader2, RefreshCw, TriangleAlert, UploadCloud, X } from "lucide-react";

// ── Round 19 — PDF upload with server-side text extraction ──
// Used by the platform + teacher book upload forms: the admin picks
// دوره → پایه → درس and uploads the textbook PDF; the server extracts the
// text (RTL-aware) and the form fills the review textarea with it.

const MAX_BYTES = 25 * 1024 * 1024;

export interface PdfExtractResult {
  text: string;
  pages: number;
  chars: number;
  truncated: boolean;
  fileName: string;
}

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
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<PdfExtractResult | null>(null);

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

  function reset() {
    setError(null);
    setDone(null);
    onCleared?.();
  }

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

      {!busy && !done && (
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

      {busy && (
        <div className="rounded-xl border border-teal-500/40 bg-teal-500/5 p-3.5 flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-teal-600 dark:text-teal-400 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium">در حال استخراج متن از PDF…</p>
            <p className="text-[10px] text-muted-foreground truncate" dir="auto">
              {done?.fileName ?? "این چند لحظه طول می‌کشد — لطفاً صفحه را نبندید."}
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
              {done.fileName} — متن در کادر پایین بارگذاری شد؛ می‌توانید پیش از ثبت، آن را ویرایش کنید.
            </p>
            {done.truncated && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1 leading-4">
                <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden />
                متن طولانی بود و فقط {faNum(done.chars)} نویسهٔ ابتدایی آن (سقف مجاز) نگه داشته شد.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={reset}
            className="h-8 px-2.5 rounded-lg border border-border/60 text-[10px] text-muted-foreground hover:bg-muted/50 transition-colors shrink-0 flex items-center gap-1"
          >
            <RefreshCw className="h-3 w-3" aria-hidden />
            فایل دیگر
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
