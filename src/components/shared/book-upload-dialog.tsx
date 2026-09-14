"use client";

import { useEffect, useState } from "react";
import { api, ApiClientError } from "@/lib/app/api-client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { faNum } from "@/components/shared/blocks";
import { CurriculumPicker, type CurriculumValue } from "@/components/shared/curriculum-picker";
import { PdfExtractInput, type PdfExtractResult } from "@/components/shared/pdf-extract-input";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { FileText, Info, Loader2, Plus, Sparkles, Upload } from "lucide-react";

// ── Round 22 — «افزودن کتاب جدید» داخل کتاب‌خانه هوشمند ──
// خواستهٔ مدیر: «تو قسمت کتابخانه هوشمند میخوام کتاب جدید اضافه کنم جایی برای آپلود
// کتاب یا لینک کتاب وجود نداشت». فرم آپلود قبلاً فقط در تب مدیریت پلتفرم بود؛
// این دیالوگ همان فرم را (فایل PDF یا لینک دانلود + دوره/پایه/درس) به هر کاربری
// که booksUploadPermission برایش صادر کند (canUpload) می‌رساند — بدون کلاس‌بندی
// (scope کلاس فقط مخصوص فرم معلم است و اینجا ارسال نمی‌شود).

const MIN_TEXT = 800;
const MAX_TEXT = 60_000;
const COVER_EMOJIS = ["📘", "📗", "📕", "📙", "📓"];

export function BookUploadDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [curr, setCurr] = useState<CurriculumValue>({});
  const [author, setAuthor] = useState("");
  const [description, setDescription] = useState("");
  const [coverEmoji, setCoverEmoji] = useState("📘");
  const [text, setText] = useState("");
  const [pdfKey, setPdfKey] = useState<string | null>(null);
  const [pdfName, setPdfName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  // اعتبارسنجی فارسی سمت کلاینت (MIN_TEXT) قبل از ارسال
  const [validation, setValidation] = useState<string | null>(null);

  // باز شدن دیالوگ = فرم تازه
  useEffect(() => {
    if (open) {
      setTitle(""); setCurr({}); setAuthor(""); setDescription("");
      setCoverEmoji("📘"); setText(""); setPdfKey(null); setPdfName(null);
      setBlocked(null); setValidation(null);
    }
  }, [open]);

  const len = text.length;
  const counterTone =
    len === 0
      ? "text-muted-foreground"
      : len < MIN_TEXT
        ? "text-amber-600 dark:text-amber-400"
        : len > MAX_TEXT * 0.95
          ? "text-rose-600 dark:text-rose-400"
          : "text-emerald-600 dark:text-emerald-400";

  const canSubmit = title.trim().length >= 2 && len >= MIN_TEXT && len <= MAX_TEXT && !busy;

  // PDF (فایل یا لینک) استخراج شد → متن در کادر بازبینی + پیشنهاد عنوان از نام فایل
  function onPdfExtracted(r: PdfExtractResult) {
    setText(r.text);
    setPdfKey(r.storageKey ?? null);
    setPdfName(r.fileName ?? null);
    setValidation(null);
    if (!title.trim()) {
      const suggested = r.fileName
        .replace(/\.pdf$/i, "")
        .replace(/[_\-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120);
      if (suggested.length >= 2) setTitle(suggested);
    }
  }

  async function submit() {
    if (busy) return;
    setBlocked(null);
    setValidation(null);
    if (title.trim().length < 2) {
      setValidation("عنوان کتاب را بنویسید (حداقل ۲ نویسه).");
      return;
    }
    if (len < MIN_TEXT) {
      setValidation(`متن کتاب کوتاه است — حداقل ${faNum(MIN_TEXT)} نویسه لازم است؛ فایل PDF را بارگذاری کنید یا لینک دانلود آن را بدهید تا متن خودکار استخراج شود.`);
      return;
    }
    if (len > MAX_TEXT) {
      setValidation(`متن کتاب بیش از حد بلند است (سقف ${faNum(MAX_TEXT)} نویسه).`);
      return;
    }
    setBusy(true);
    try {
      await api("/api/v1/books", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          text: text.trim(),
          subject: curr.subject?.trim() || undefined,
          level: curr.level || undefined,
          gradeLevel: curr.gradeLevel || undefined,
          author: author.trim() || undefined,
          description: description.trim() || undefined,
          coverEmoji,
          pdfStorageKey: pdfKey || undefined,
          pdfFileName: pdfName || undefined,
        }),
      });
      toast({
        title: "کتاب ثبت شد",
        description: "تولید خلاصه، جزوه، شکل‌ها، نمونه‌سؤال‌ها و پادکست در پس‌زمینه آغاز شد — وضعیت روی کارت کتاب به‌روز می‌شود.",
      });
      onOpenChange(false);
      onCreated();
    } catch (e) {
      if (e instanceof ApiClientError) {
        if (e.status === 429 || e.status === 403) setBlocked(e.message);
        else toast({ title: "ثبت کتاب ناموفق بود", description: e.message, variant: "destructive" });
      } else {
        toast({ title: "ثبت کتاب ناموفق بود", description: "خطای غیرمنتظره‌ای رخ داد.", variant: "destructive" });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base flex-wrap">
            <span className="h-8 w-8 rounded-xl bg-emerald-600/15 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <Plus className="h-4.5 w-4.5" aria-hidden />
            </span>
            افزودن کتاب جدید
            <Badge variant="secondary" className="text-[9px]">فایل PDF یا لینک دانلود</Badge>
          </DialogTitle>
          <DialogDescription className="leading-6">
            کتاب را در ساختار درسی رسمی قرار دهید (دوره → پایه → درس، مثل «ابتدایی · کلاس سوم · ریاضی»)
            و فایل PDF آن را بارگذاری کنید یا لینک مستقیم دانلودش را بدهید — متن خودکار استخراج می‌شود
            و خلاصه، جزوه، شکل‌ها، نمونه‌سؤال و پادکست ساخته می‌شود.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="bu-title" className="text-xs">عنوان کتاب *</Label>
              <Input
                id="bu-title"
                dir="auto"
                className="h-11"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="مثلاً: ریاضی کلاس سوم — کامل"
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bu-author" className="text-xs">نویسنده / انتشارات (اختیاری)</Label>
              <Input
                id="bu-author"
                dir="auto"
                className="h-11"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="مثلاً: وزارت آموزش و پرورش"
                maxLength={80}
              />
            </div>
          </div>

          {/* دوره → پایه → درس */}
          <CurriculumPicker value={curr} onChange={setCurr} idPrefix="bu" />

          <div className="space-y-1.5">
            <Label htmlFor="bu-desc" className="text-xs">توضیح (اختیاری)</Label>
            <Textarea
              id="bu-desc"
              dir="auto"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="یک جمله دربارهٔ محتوای کتاب…"
              maxLength={300}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">جلد کتاب</Label>
            <div className="flex items-center gap-1.5 flex-wrap">
              {COVER_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setCoverEmoji(e)}
                  aria-pressed={coverEmoji === e}
                  aria-label={`جلد ${e}`}
                  className={cn(
                    "h-10 w-10 rounded-xl border text-xl transition-all min-h-11",
                    coverEmoji === e
                      ? "border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500/30"
                      : "border-border/60 hover:border-emerald-400/40"
                  )}
                >
                  <span aria-hidden>{e}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bu-text" className="text-xs">متن کامل کتاب / جزوه *</Label>
            <PdfExtractInput
              idPrefix="bu-pdf"
              onExtracted={onPdfExtracted}
              onCleared={() => {
                setText("");
                setPdfKey(null);
                setPdfName(null);
              }}
              disabled={busy}
            />
            <p className="text-[10px] text-muted-foreground leading-4 flex items-center gap-1">
              <FileText className="h-3 w-3 shrink-0" aria-hidden />
              فایل PDF کتاب را بارگذاری کنید، لینک مستقیم دانلود آن را بدهید، یا متن را دستی در کادر پایین بچسبانید.
            </p>
            <Textarea
              id="bu-text"
              dir="auto"
              rows={7}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="فایل PDF کتاب را بارگذاری کنید تا متن آن خودکار اینجا بیاید، یا متن کامل را دستی بچسبانید… (حداقل ۸۰۰ نویسه — خلاصه، جزوه، شکل‌ها، نمونه‌سؤال و پادکست از همین متن ساخته می‌شود)"
              maxLength={MAX_TEXT}
            />
            <div className="flex items-center justify-between text-[10px]">
              <span className={cn("tabular-nums", counterTone)}>
                {faNum(len)} / {faNum(MAX_TEXT)} نویسه
                {len > 0 && len < MIN_TEXT && ` — حداقل ${faNum(MIN_TEXT)} نویسه لازم است`}
              </span>
              <span className="text-muted-foreground flex items-center gap-1">
                <Sparkles className="h-3 w-3" aria-hidden />
                خلاصه + جزوه + شکل‌ها + نمونه‌سؤال + پادکست
              </span>
            </div>
          </div>

          {validation && (
            <div
              role="alert"
              className="rounded-xl border border-rose-500/40 bg-rose-500/5 p-3 flex items-start gap-2 text-xs text-rose-700 dark:text-rose-400"
            >
              <Info className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
              <span className="leading-6">{validation}</span>
            </div>
          )}

          {blocked && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
              <Info className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
              <span className="leading-6">{blocked}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              انصراف
            </Button>
            <Button
              onClick={() => void submit()}
              disabled={!canSubmit}
              className="bg-gradient-to-l from-emerald-600 to-teal-600 hover:brightness-110 active:scale-[0.98] transition-all"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin ml-1.5" aria-hidden />
              ) : (
                <Upload className="h-4 w-4 ml-1.5" aria-hidden />
              )}
              {busy ? "در حال ثبت…" : "ثبت و ساخت محتوای هوشمند"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
