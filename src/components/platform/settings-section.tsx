"use client";

// Round 16-a — «تنظیمات و اتصال‌ها» (SUPER_ADMIN): انتخاب ارائه‌دهندهٔ هوش مصنوعی
// (پیش‌فرض پلتفرم / جمینای با کلید شخصی)، اتصال ربات تلگرام و مینی‌اپ با راهنمای
// BotFather، و مجوزهای بارگذاری کتاب/جزوه برای هر سازمان.
// رازها (کلید جمینای و توکن بات) هرگز به کلاینت برنمی‌گردند — فقط نسخهٔ ماسک‌شده نمایش داده می‌شود.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { api, ApiClientError } from "@/lib/app/api-client";
import { useToast } from "@/hooks/use-toast";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { EmptyState, ErrorState, PageTitle, faNum } from "@/components/shared/blocks";
import {
  AlertCircle,
  AlertTriangle,
  Bot,
  BookOpen,
  Building2,
  Check,
  CheckCircle2,
  Cloud,
  Copy,
  Database,
  ExternalLink,
  Eye,
  EyeOff,
  GraduationCap,
  Info,
  KeyRound,
  Link2,
  Loader2,
  Save,
  Send,
  Server,
  ShieldCheck,
  Sparkles,
  Wand2,
  Zap,
} from "lucide-react";
import { faDigits, faSizeBytes, tenantStatusFa, type TelegramStorageBlock, type TenantRow } from "./types";

// ── API contracts (src/server/services/settings.ts) ──

type AiProviderChoice = "zai" | "gemini";

interface GeminiModelOption {
  code: string;
  label: string;
}

interface PlatformSettingsView {
  aiProvider: AiProviderChoice;
  geminiModel: string;
  telegramMiniAppUrl: string;
  telegramBotUsername: string;
  // Round 23 — ذخیره‌سازی کامل در تلگرام (raw fields + rich status block)
  telegramStorageEnabled: boolean;
  telegramStorageChatId: string; // "" = خودکار (چت مدیر کل متصل‌شده)
  telegramStorage: TelegramStorageBlock;
  booksUploadTenants: string[];
  teacherBookUploadTenants: string[];
  hasGeminiKey: boolean;
  geminiApiKeyMasked: string;
  hasTelegramToken: boolean;
  telegramTokenMasked: string;
  geminiModels: GeminiModelOption[];
}

interface GeminiTestResult {
  ok: boolean;
  model: string;
  reply: string;
}

interface TelegramTestResult {
  ok: boolean;
  botUsername: string;
  botName: string;
  botId: number;
}

interface TelegramConfigResult {
  botUsername: string;
  botName: string;
  miniAppUrl: string;
}

interface InlineMsg {
  kind: "success" | "error";
  title: string;
  body?: ReactNode;
}

// ── ابزارهای کمکی ──

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* مسیر جایگزین پایین */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function CopyButton({
  value,
  label,
  srLabel,
  variant = "outline",
  disabled,
}: {
  value: string;
  label?: string;
  srLabel?: string;
  variant?: "outline" | "ghost" | "secondary";
  disabled?: boolean;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  const handle = useCallback(async () => {
    const ok = await copyText(value);
    if (ok) {
      setCopied(true);
      toast({
        title: "در حافظه کپی شد",
        description: value.length > 56 ? `${value.slice(0, 56)}…` : value,
      });
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1800);
    } else {
      toast({
        title: "کپی ناموفق بود",
        description: "لطفاً متن را به‌صورت دستی انتخاب و کپی کنید.",
        variant: "destructive",
      });
    }
  }, [value, toast]);

  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      onClick={() => void handle()}
      disabled={disabled || value === ""}
      aria-label={srLabel ?? (label ? `کپی ${label}` : "کپی")}
      className="shrink-0"
    >
      {copied ? (
        <Check className="text-emerald-600 dark:text-emerald-400" aria-hidden />
      ) : (
        <Copy aria-hidden />
      )}
      {label ? <span>{label}</span> : <span className="sr-only">{srLabel ?? "کپی"}</span>}
    </Button>
  );
}

function InlineAlert({ msg }: { msg: InlineMsg }) {
  if (msg.kind === "error") {
    return (
      <Alert variant="destructive" role="alert">
        <AlertCircle className="h-4 w-4" aria-hidden />
        <AlertTitle>{msg.title}</AlertTitle>
        {msg.body && <AlertDescription>{msg.body}</AlertDescription>}
      </Alert>
    );
  }
  return (
    <Alert className="border-emerald-500/40 bg-emerald-500/5" role="status">
      <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
      <AlertTitle className="text-emerald-800 dark:text-emerald-400">{msg.title}</AlertTitle>
      {msg.body && (
        <AlertDescription className="text-emerald-800/90 dark:text-emerald-400/90">
          {msg.body}
        </AlertDescription>
      )}
    </Alert>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs text-muted-foreground leading-5 flex items-start gap-1.5">
      <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

function StatusChip({
  icon: Icon,
  label,
  ok,
  children,
}: {
  icon: typeof KeyRound;
  label: string;
  ok: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border p-3 ${
        ok ? "border-emerald-500/40 bg-emerald-500/5" : "border-border/60 bg-muted/30"
      }`}
    >
      <div
        className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${
          ok
            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            : "bg-muted text-muted-foreground"
        }`}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className="text-sm font-bold truncate" dir="auto">
          {children}
        </p>
      </div>
    </div>
  );
}

function StepBadge({ n }: { n: number }) {
  return (
    <span
      className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-extrabold tabular-nums shrink-0"
      aria-hidden
    >
      {faNum(n)}
    </span>
  );
}

function CommandBox({ command }: { command: string }) {
  return (
    <div
      dir="ltr"
      className="flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/40 px-3 py-2"
    >
      <code className="font-mono text-sm text-foreground select-all truncate">{command}</code>
      <CopyButton value={command} srLabel={`کپی دستور ${command}`} variant="ghost" />
    </div>
  );
}

function tenantStatusClass(status: string): string {
  switch (status) {
    case "ACTIVE":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
    case "SUSPENDED":
      return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400";
    default:
      return "";
  }
}

function PermissionSwitch({
  label,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
        disabled ? "opacity-60 pointer-events-none" : "cursor-pointer border-border/60 bg-muted/20 hover:border-primary/40"
      }`}
    >
      <span className="text-xs font-medium leading-5">{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} aria-label={label} className="scale-110" />
    </label>
  );
}

// ── بخش اصلی ──

export function SettingsSection() {
  const { toast } = useToast();

  // داده‌ها
  const [settings, setSettings] = useState<PlatformSettingsView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [tenants, setTenants] = useState<TenantRow[] | null>(null);
  const [tenantsError, setTenantsError] = useState<string | null>(null);
  const [tenantsReloadKey, setTenantsReloadKey] = useState(0);

  // فرم هوش مصنوعی
  const [aiProvider, setAiProvider] = useState<AiProviderChoice>("zai");
  const [geminiKeyInput, setGeminiKeyInput] = useState("");
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [geminiModel, setGeminiModel] = useState("gemini-2.5-flash");

  // فرم تلگرام
  const [botTokenInput, setBotTokenInput] = useState("");
  const [showBotToken, setShowBotToken] = useState(false);
  const [miniAppUrl, setMiniAppUrl] = useState("");

  // مجوزهای کتاب‌خانه
  const [adminUpload, setAdminUpload] = useState<Set<string>>(new Set());
  const [teacherUpload, setTeacherUpload] = useState<Set<string>>(new Set());

  // Round 23 — ذخیره‌سازی در تلگرام
  const [tgChatIdInput, setTgChatIdInput] = useState("");

  // وضعیت‌های مشغول و پیام درون‌کاری
  const [savingGemini, setSavingGemini] = useState(false);
  const [testingGemini, setTestingGemini] = useState(false);
  const [savingTelegram, setSavingTelegram] = useState(false);
  const [testingTelegram, setTestingTelegram] = useState(false);
  const [configuringBot, setConfiguringBot] = useState(false);
  const [savingBooks, setSavingBooks] = useState(false);
  const [togglingStorage, setTogglingStorage] = useState(false);
  const [savingStorageChat, setSavingStorageChat] = useState(false);
  const [geminiMsg, setGeminiMsg] = useState<InlineMsg | null>(null);
  const [telegramMsg, setTelegramMsg] = useState<InlineMsg | null>(null);
  const [booksMsg, setBooksMsg] = useState<InlineMsg | null>(null);
  const [storageMsg, setStorageMsg] = useState<InlineMsg | null>(null);

  const syncAll = useCallback((res: PlatformSettingsView) => {
    setSettings(res);
    setAiProvider(res.aiProvider === "gemini" ? "gemini" : "zai");
    setGeminiModel(res.geminiModel);
    setGeminiKeyInput("");
    setMiniAppUrl(res.telegramMiniAppUrl);
    setBotTokenInput("");
    setTgChatIdInput(res.telegramStorageChatId ?? "");
    setAdminUpload(new Set(res.booksUploadTenants));
    setTeacherUpload(new Set(res.teacherBookUploadTenants));
  }, []);

  // فقط حوزهٔ همان کارت را با پاسخ سرور همگام می‌کند تا ویرایش‌های ذخیره‌نشدهٔ
  // کارت‌های دیگر از بین نرود.
  const applyScoped = useCallback(
    (res: PlatformSettingsView, scope: "gemini" | "telegram" | "books" | "storage") => {
      setSettings(res);
      if (scope === "gemini") {
        setAiProvider(res.aiProvider === "gemini" ? "gemini" : "zai");
        setGeminiModel(res.geminiModel);
        setGeminiKeyInput("");
      } else if (scope === "telegram") {
        setMiniAppUrl(res.telegramMiniAppUrl);
        setBotTokenInput("");
      } else if (scope === "storage") {
        setTgChatIdInput(res.telegramStorageChatId ?? "");
      } else {
        setAdminUpload(new Set(res.booksUploadTenants));
        setTeacherUpload(new Set(res.teacherBookUploadTenants));
      }
    },
    []
  );

  useEffect(() => {
    let ignore = false;
    async function start() {
      try {
        const res = await api<PlatformSettingsView>("/api/v1/platform/settings");
        if (!ignore) {
          syncAll(res);
          setLoadError(null);
        }
      } catch (e) {
        if (!ignore)
          setLoadError(e instanceof ApiClientError ? e.message : "بارگذاری تنظیمات ناموفق بود.");
      }
    }
    void start();
    return () => {
      ignore = true;
    };
  }, [reloadKey, syncAll]);

  useEffect(() => {
    let ignore = false;
    async function start() {
      try {
        const res = await api<{ tenants: TenantRow[] }>("/api/v1/platform/tenants");
        if (!ignore) {
          setTenants(res.tenants);
          setTenantsError(null);
        }
      } catch (e) {
        if (!ignore)
          setTenantsError(e instanceof ApiClientError ? e.message : "بارگذاری سازمان‌ها ناموفق بود.");
      }
    }
    void start();
    return () => {
      ignore = true;
    };
  }, [tenantsReloadKey]);

  const load = useCallback(() => setReloadKey((k) => k + 1), []);
  const loadTenants = useCallback(() => setTenantsReloadKey((k) => k + 1), []);

  // نشانگر «تغییرات ذخیره‌نشده» برای هر کارت
  const geminiDirty = useMemo(
    () =>
      !!settings &&
      (aiProvider !== settings.aiProvider ||
        geminiModel !== settings.geminiModel ||
        geminiKeyInput.trim() !== ""),
    [settings, aiProvider, geminiModel, geminiKeyInput]
  );

  const telegramDirty = useMemo(
    () =>
      !!settings &&
      (miniAppUrl.trim() !== settings.telegramMiniAppUrl || botTokenInput.trim() !== ""),
    [settings, miniAppUrl, botTokenInput]
  );

  const booksDirty = useMemo(() => {
    if (!settings) return false;
    const sameAdmin =
      settings.booksUploadTenants.length === adminUpload.size &&
      settings.booksUploadTenants.every((id) => adminUpload.has(id));
    const sameTeacher =
      settings.teacherBookUploadTenants.length === teacherUpload.size &&
      settings.teacherBookUploadTenants.every((id) => teacherUpload.has(id));
    return !sameAdmin || !sameTeacher;
  }, [settings, adminUpload, teacherUpload]);

  const storageChatDirty = useMemo(
    () => !!settings && tgChatIdInput.trim() !== (settings.telegramStorageChatId ?? ""),
    [settings, tgChatIdInput]
  );

  const toggleInSet = useCallback(
    (setter: Dispatch<SetStateAction<Set<string>>>, id: string, on: boolean) => {
      setter((prev) => {
        const next = new Set(prev);
        if (on) next.add(id);
        else next.delete(id);
        return next;
      });
    },
    []
  );

  function errMsg(e: unknown): string {
    return e instanceof ApiClientError ? e.message : "ارتباط با سرور برقرار نشد.";
  }

  // ── هوش مصنوعی جمینای ──

  async function saveGemini() {
    if (!settings) return;
    setSavingGemini(true);
    setGeminiMsg(null);
    try {
      const body: Record<string, unknown> = { aiProvider, geminiModel };
      const key = geminiKeyInput.trim();
      if (key !== "") body.geminiApiKey = key;
      const res = await api<PlatformSettingsView>("/api/v1/platform/settings", {
        method: "PUT",
        body: JSON.stringify(body),
      });
      applyScoped(res, "gemini");
      const providerFa = res.aiProvider === "gemini" ? "جمینای (کلید شخصی)" : "پیش‌فرض پلتفرم (zai)";
      setGeminiMsg({
        kind: "success",
        title: "تنظیمات هوش مصنوعی ذخیره شد",
        body: (
          <p>
            ارائه‌دهندهٔ فعال: <span className="font-bold">{providerFa}</span> · مدل:{" "}
            <code dir="ltr" className="font-mono text-xs bg-muted/60 rounded px-1.5 py-0.5">
              {res.geminiModel}
            </code>
          </p>
        ),
      });
      toast({ title: "تنظیمات هوش مصنوعی ذخیره شد", description: providerFa });
    } catch (e) {
      setGeminiMsg({ kind: "error", title: "ذخیرهٔ تنظیمات ناموفق بود", body: <p>{errMsg(e)}</p> });
      toast({ title: "ذخیرهٔ تنظیمات ناموفق بود", description: errMsg(e), variant: "destructive" });
    } finally {
      setSavingGemini(false);
    }
  }

  async function testGemini() {
    setTestingGemini(true);
    setGeminiMsg(null);
    try {
      const res = await api<GeminiTestResult>("/api/v1/platform/settings/test-gemini", {
        method: "POST",
      });
      setGeminiMsg({
        kind: "success",
        title: "اتصال جمینای برقرار است ✅",
        body: (
          <div className="space-y-1.5 w-full">
            <p className="flex items-center gap-1.5 flex-wrap">
              مدل پاسخ‌گو:
              <code dir="ltr" className="font-mono text-xs bg-muted/60 rounded px-1.5 py-0.5">
                {res.model}
              </code>
            </p>
            <p>پاسخ نمونهٔ مدل: «{res.reply}»</p>
          </div>
        ),
      });
      toast({ title: "اتصال جمینای برقرار است", description: res.model });
    } catch (e) {
      setGeminiMsg({ kind: "error", title: "آزمودن اتصال ناموفق بود", body: <p>{errMsg(e)}</p> });
      toast({ title: "آزمودن اتصال ناموفق بود", description: errMsg(e), variant: "destructive" });
    } finally {
      setTestingGemini(false);
    }
  }

  // ── ربات تلگرام ──

  async function saveTelegram() {
    if (!settings) return;
    setSavingTelegram(true);
    setTelegramMsg(null);
    try {
      const body: Record<string, unknown> = { telegramMiniAppUrl: miniAppUrl.trim() };
      const token = botTokenInput.trim();
      if (token !== "") body.telegramBotToken = token;
      const res = await api<PlatformSettingsView>("/api/v1/platform/settings", {
        method: "PUT",
        body: JSON.stringify(body),
      });
      applyScoped(res, "telegram");
      setTelegramMsg({
        kind: "success",
        title: "اتصال تلگرام ذخیره شد",
        body: (
          <div className="space-y-1.5 w-full">
            <p>
              توکن بات:{" "}
              {res.hasTelegramToken ? (
                <span dir="auto" className="font-bold">
                  {res.telegramTokenMasked}
                </span>
              ) : (
                "ثبت نشده"
              )}{" "}
              · آدرس مینی‌اپ:{" "}
              {res.telegramMiniAppUrl ? (
                <code dir="ltr" className="font-mono text-xs bg-muted/60 rounded px-1.5 py-0.5">
                  {res.telegramMiniAppUrl}
                </code>
              ) : (
                "ثبت نشده"
              )}
            </p>
            <p className="text-xs leading-5">
              برای اعمال نهایی روی بات، «پیکربندی خودکار بات» را اجرا کنید.
            </p>
          </div>
        ),
      });
      toast({ title: "اتصال تلگرام ذخیره شد" });
    } catch (e) {
      setTelegramMsg({ kind: "error", title: "ذخیرهٔ اتصال تلگرام ناموفق بود", body: <p>{errMsg(e)}</p> });
      toast({ title: "ذخیرهٔ اتصال تلگرام ناموفق بود", description: errMsg(e), variant: "destructive" });
    } finally {
      setSavingTelegram(false);
    }
  }

  async function testTelegram() {
    setTestingTelegram(true);
    setTelegramMsg(null);
    try {
      const res = await api<TelegramTestResult>("/api/v1/platform/settings/test-telegram", {
        method: "POST",
      });
      // نام کاربری بات را در نمایش وضعیت به‌روز کن (کش سمت سرور با پیکربندی خودکار ثبت می‌شود)
      setSettings((s) => (s ? { ...s, telegramBotUsername: res.botUsername } : s));
      setTelegramMsg({
        kind: "success",
        title: "بات متصل است ✅",
        body: (
          <p>
            بات <span dir="ltr" className="font-bold">{`@${res.botUsername}`}</span> پاسخ داد — نام: «{res.botName}» ·
            شناسه: {faNum(res.botId)}
          </p>
        ),
      });
      toast({ title: "بات متصل است", description: `@${res.botUsername}` });
    } catch (e) {
      setTelegramMsg({ kind: "error", title: "آزمودن اتصال ناموفق بود", body: <p>{errMsg(e)}</p> });
      toast({ title: "آزمودن اتصال ناموفق بود", description: errMsg(e), variant: "destructive" });
    } finally {
      setTestingTelegram(false);
    }
  }

  async function configureBot() {
    setConfiguringBot(true);
    setTelegramMsg(null);
    try {
      const res = await api<TelegramConfigResult>("/api/v1/platform/settings/configure-telegram", {
        method: "POST",
      });
      setSettings((s) =>
        s ? { ...s, telegramBotUsername: res.botUsername, telegramMiniAppUrl: res.miniAppUrl } : s
      );
      setTelegramMsg({
        kind: "success",
        title: "پیکربندی خودکار بات انجام شد ✅",
        body: (
          <div className="space-y-1.5 w-full">
            <p>
              بات <span dir="ltr" className="font-bold">{`@${res.botUsername}`}</span> («{res.botName}») آماده است.
            </p>
            <p>
              دکمهٔ منوی بات به مینی‌اپ ست شد و ۶ دستور فارسی (شروع، کتاب‌خانه، آزمون، امتیازها، مینی‌اپ،
              راهنما) به‌همراه توضیحات فارسی بات نصب شد.
            </p>
            <p className="flex items-center gap-1.5 flex-wrap">
              آدرس مینی‌اپ:
              <code dir="ltr" className="font-mono text-xs bg-muted/60 rounded px-1.5 py-0.5">
                {res.miniAppUrl}
              </code>
            </p>
          </div>
        ),
      });
      toast({ title: "پیکربندی خودکار بات انجام شد", description: `@${res.botUsername}` });
    } catch (e) {
      setTelegramMsg({ kind: "error", title: "پیکربندی خودکار ناموفق بود", body: <p>{errMsg(e)}</p> });
      toast({ title: "پیکربندی خودکار ناموفق بود", description: errMsg(e), variant: "destructive" });
    } finally {
      setConfiguringBot(false);
    }
  }

  // ── Round 23 — ذخیره‌سازی در تلگرام ──

  async function toggleTelegramStorage(next: boolean) {
    if (!settings) return;
    setTogglingStorage(true);
    setStorageMsg(null);
    try {
      const res = await api<PlatformSettingsView>("/api/v1/platform/settings", {
        method: "PUT",
        body: JSON.stringify({ telegramStorageEnabled: next }),
      });
      applyScoped(res, "storage");
      setStorageMsg({
        kind: "success",
        title: next ? "ذخیره‌سازی در تلگرام فعال شد ☁️" : "ذخیره‌سازی در تلگرام غیرفعال شد",
        body: next ? (
          <p>
            از این پس کتاب‌ها، پادکست‌ها و PDFهای فارسی داخل خود تلگرام نگه داشته می‌شوند — هیچ فایلی
            روی هاست ذخیره نمی‌شود.
          </p>
        ) : (
          <p>فایل‌های جدید موقتاً روی هاست می‌مانند تا دوباره فعالش کنید.</p>
        ),
      });
      toast({
        title: next ? "ذخیره‌سازی در تلگرام فعال شد" : "ذخیره‌سازی در تلگرام غیرفعال شد",
      });
    } catch (e) {
      setStorageMsg({ kind: "error", title: "تغییر وضعیت ذخیره‌سازی ناموفق بود", body: <p>{errMsg(e)}</p> });
      toast({ title: "تغییر وضعیت ذخیره‌سازی ناموفق بود", description: errMsg(e), variant: "destructive" });
    } finally {
      setTogglingStorage(false);
    }
  }

  async function saveStorageChatId() {
    if (!settings) return;
    setSavingStorageChat(true);
    setStorageMsg(null);
    try {
      const value = tgChatIdInput.trim();
      const res = await api<PlatformSettingsView>("/api/v1/platform/settings", {
        method: "PUT",
        body: JSON.stringify({ telegramStorageChatId: value }),
      });
      applyScoped(res, "storage");
      setStorageMsg({
        kind: "success",
        title: value ? "چت ذخیره‌سازی ثبت شد" : "چت ذخیره‌سازی به حالت خودکار برگشت",
        body: (
          <p>
            {value
              ? "فایل‌های تلگرامی از این پس به این چت/کانال فرستاده می‌شوند."
              : "به‌طور خودکار از چت تلگرامِ مدیر کلِ متصل‌شده استفاده می‌شود."}{" "}
            چت فعال: {" "}
            <span dir="ltr" className="font-bold tabular-nums">
              {res.telegramStorage?.storageChatId || "—"}
            </span>
          </p>
        ),
      });
      toast({
        title: value ? "چت ذخیره‌سازی ثبت شد" : "چت ذخیره‌سازی خودکار شد",
        description: value ? tgChatIdInput.trim() : undefined,
      });
    } catch (e) {
      setStorageMsg({
        kind: "error",
        title: "ذخیرهٔ چت ذخیره‌سازی ناموفق بود",
        body: <p>{errMsg(e)}</p>,
      });
      toast({ title: "ذخیرهٔ چت ذخیره‌سازی ناموفق بود", description: errMsg(e), variant: "destructive" });
    } finally {
      setSavingStorageChat(false);
    }
  }

  // ── مجوزهای کتاب‌خانه ──

  async function saveBooks() {
    if (!settings || !tenants) return;
    setSavingBooks(true);
    setBooksMsg(null);
    try {
      const res = await api<PlatformSettingsView>("/api/v1/platform/settings", {
        method: "PUT",
        body: JSON.stringify({
          booksUploadTenants: Array.from(adminUpload),
          teacherBookUploadTenants: Array.from(teacherUpload),
        }),
      });
      applyScoped(res, "books");
      setBooksMsg({
        kind: "success",
        title: "مجوزهای کتاب‌خانه ذخیره شد",
        body: (
          <p>
            افزودن کتاب توسط مدیر مدرسه: <span className="font-bold">{faNum(res.booksUploadTenants.length)}</span> مدرسه ·
            بارگذاری توسط معلم:{" "}
            <span className="font-bold">{faNum(res.teacherBookUploadTenants.length)}</span> مدرسه
          </p>
        ),
      });
      toast({ title: "مجوزهای کتاب‌خانه ذخیره شد" });
    } catch (e) {
      setBooksMsg({ kind: "error", title: "ذخیرهٔ مجوزها ناموفق بود", body: <p>{errMsg(e)}</p> });
      toast({ title: "ذخیرهٔ مجوزها ناموفق بود", description: errMsg(e), variant: "destructive" });
    } finally {
      setSavingBooks(false);
    }
  }

  // ── نمایش ──

  const telegramReady = !!settings && settings.hasTelegramToken && !!settings.telegramMiniAppUrl;

  return (
    <div className="space-y-6">
      <PageTitle
        title="تنظیمات و اتصال‌ها"
        description="کلید API جمینای، اتصال ربات تلگرام و مینی‌اپ، و مجوزهای کتاب‌خانه."
      />

      {loadError && <ErrorState message={loadError} onRetry={load} />}

      {!settings && !loadError && (
        <div className="space-y-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="border-border/60">
              <CardContent className="p-6 space-y-4">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-2/3" />
                <Skeleton className="h-9 w-40" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {settings && (
        <div className="space-y-6">
          {/* ═══ کارت ۱ — هوش مصنوعی جمینای ═══ */}
          <Card className="border-border/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4.5 w-4.5 text-primary" aria-hidden />
                هوش مصنوعی جمینای
              </CardTitle>
              <CardDescription>
                انتخاب زیرساخت پردازش زبان: پیش‌فرض پلتفرم یا کلید شخصی جمینای.
              </CardDescription>
              <CardAction>
                <Badge
                  variant="outline"
                  className={
                    settings.aiProvider === "gemini"
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border"
                  }
                >
                  ارائه‌دهندهٔ فعال: {settings.aiProvider === "gemini" ? "جمینای" : "پیش‌فرض پلتفرم"}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-5">
              <div
                role="radiogroup"
                aria-label="انتخاب ارائه‌دهندهٔ هوش مصنوعی"
                className="grid gap-3 sm:grid-cols-2"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={aiProvider === "zai"}
                  onClick={() => setAiProvider("zai")}
                  className={`text-right rounded-xl border p-4 transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
                    aiProvider === "zai"
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-border/60 hover:border-primary/40 hover:bg-muted/40"
                  }`}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm font-bold">
                      <Server
                        className={`h-4.5 w-4.5 ${aiProvider === "zai" ? "text-primary" : "text-muted-foreground"}`}
                        aria-hidden
                      />
                      پیش‌فرض پلتفرم (zai)
                    </span>
                    {aiProvider === "zai" && <CheckCircle2 className="h-4.5 w-4.5 text-primary shrink-0" aria-hidden />}
                  </span>
                  <span className="block text-xs text-muted-foreground leading-5 mt-2">
                    زیرساخت هوش مصنوعی پلتفرم — بدون نیاز به کلید API و بدون هزینهٔ جداگانه؛ همیشه آمادهٔ
                    استفاده.
                  </span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={aiProvider === "gemini"}
                  onClick={() => setAiProvider("gemini")}
                  className={`text-right rounded-xl border p-4 transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
                    aiProvider === "gemini"
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-border/60 hover:border-primary/40 hover:bg-muted/40"
                  }`}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm font-bold">
                      <Sparkles
                        className={`h-4.5 w-4.5 ${aiProvider === "gemini" ? "text-primary" : "text-muted-foreground"}`}
                        aria-hidden
                      />
                      جمینای (کلید شخصی)
                    </span>
                    {aiProvider === "gemini" && <CheckCircle2 className="h-4.5 w-4.5 text-primary shrink-0" aria-hidden />}
                  </span>
                  <span className="block text-xs text-muted-foreground leading-5 mt-2">
                    کلید API شخصی خود را از Google AI Studio می‌آورید؛ مصرف مستقیماً به حساب گوگل شما
                    متصل می‌شود.
                  </span>
                </button>
              </div>

              {aiProvider === "gemini" && !settings.hasGeminiKey && geminiKeyInput.trim() === "" && (
                <p className="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1.5 leading-5">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />
                  برای فعال‌سازی جمینای ابتدا کلید API را در کادر زیر وارد کنید؛ در غیر این صورت ذخیره
                  با خطای اعتبارسنجی رد می‌شود.
                </p>
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <Label htmlFor="gemini-key">کلید API جمینای</Label>
                  <Badge
                    variant={settings.hasGeminiKey ? "outline" : "secondary"}
                    className={
                      settings.hasGeminiKey
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                        : ""
                    }
                  >
                    {settings.hasGeminiKey
                      ? `کلید ذخیره‌شده: ${settings.geminiApiKeyMasked}`
                      : "کلیدی ذخیره نشده است"}
                  </Badge>
                </div>
                <div className="relative">
                  <Input
                    id="gemini-key"
                    dir="ltr"
                    type={showGeminiKey ? "text" : "password"}
                    autoComplete="new-password"
                    spellCheck={false}
                    value={geminiKeyInput}
                    onChange={(e) => setGeminiKeyInput(e.target.value)}
                    placeholder={settings.hasGeminiKey ? settings.geminiApiKeyMasked : "AIzaSy…"}
                    className="text-left pl-10 font-mono text-sm"
                    aria-describedby="gemini-key-hint"
                  />
                  <button
                    type="button"
                    onClick={() => setShowGeminiKey((v) => !v)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors rounded-md p-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    aria-label={showGeminiKey ? "پنهان‌کردن کلید" : "نمایش کلید"}
                  >
                    {showGeminiKey ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                  </button>
                </div>
                <Hint>
                  <span id="gemini-key-hint">
                    کلید API خود را از Google AI Studio (aistudio.google.com) دریافت کنید — کلید فقط روی
                    سرور ذخیره می‌شود و هرگز به کلاینت برگردانده نمی‌شود.
                  </span>
                </Hint>
                {settings.hasGeminiKey && geminiKeyInput === "" && (
                  <p className="text-[11px] text-muted-foreground">
                    برای حفظ کلید فعلی، این کادر را خالی بگذارید؛ با وارد کردن مقدار جدید، کلید قبلی
                    جایگزین می‌شود.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="gemini-model">مدل جمینای</Label>
                <Select value={geminiModel} onValueChange={setGeminiModel}>
                  <SelectTrigger id="gemini-model" className="w-full sm:w-80" aria-describedby="gemini-model-hint">
                    <SelectValue placeholder="انتخاب مدل" />
                  </SelectTrigger>
                  <SelectContent>
                    {settings.geminiModels.map((m) => (
                      <SelectItem key={m.code} value={m.code}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p id="gemini-model-hint" className="text-xs text-muted-foreground leading-5">
                  مدل فقط هنگام استفاده از ارائه‌دهندهٔ جمینای به کار می‌رود؛ انتخاب آن هم‌اکنون ذخیره
                  می‌شود تا بعداً آماده باشد.
                </p>
              </div>

              {geminiMsg && <InlineAlert msg={geminiMsg} />}
            </CardContent>
            <Separator />
            <CardFooter className="py-3 flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void saveGemini()} disabled={savingGemini || !geminiDirty}>
                  {savingGemini ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <Save aria-hidden />
                  )}
                  ذخیرهٔ تنظیمات
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void testGemini()}
                  disabled={testingGemini || aiProvider !== "gemini" || geminiDirty}
                >
                  {testingGemini ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <Zap aria-hidden />
                  )}
                  آزمودن اتصال
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground leading-5">
                {aiProvider !== "gemini"
                  ? "آزمودن اتصال پس از انتخاب «جمینای (کلید شخصی)» فعال می‌شود."
                  : geminiDirty
                    ? "ابتدا تغییرات را ذخیره کنید — آزمودن اتصال با تنظیمات ذخیره‌شده انجام می‌شود."
                    : "آزمودن اتصال یک پرسش نمونه به مدل فعال می‌فرستد."}
              </p>
            </CardFooter>
          </Card>

          {/* ═══ کارت ۲ — اتصال ربات تلگرام ═══ */}
          <Card className="border-border/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Send className="h-4.5 w-4.5 text-primary" aria-hidden />
                اتصال ربات تلگرام
              </CardTitle>
              <CardDescription>
                توکن بات و آدرس مینی‌اپ — پل ورود دانش‌آموزان به پلتفرم از داخل تلگرام.
              </CardDescription>
              <CardAction>
                <Badge
                  variant="outline"
                  className={
                    telegramReady
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : settings.hasTelegramToken
                        ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                        : ""
                  }
                >
                  {telegramReady
                    ? "آمادهٔ اتصال"
                    : settings.hasTelegramToken
                      ? "نیازمند آدرس مینی‌اپ"
                      : "متصل نشده است"}
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-2 sm:grid-cols-3">
                <StatusChip icon={KeyRound} label="توکن بات" ok={settings.hasTelegramToken}>
                  {settings.hasTelegramToken ? settings.telegramTokenMasked : "ثبت نشده"}
                </StatusChip>
                <StatusChip icon={Link2} label="آدرس مینی‌اپ" ok={!!settings.telegramMiniAppUrl}>
                  {settings.telegramMiniAppUrl ? "ثبت شده" : "ثبت نشده"}
                </StatusChip>
                <StatusChip icon={Bot} label="بات شناسایی‌شده" ok={!!settings.telegramBotUsername}>
                  {settings.telegramBotUsername ? `@${settings.telegramBotUsername}` : "نامشخص"}
                </StatusChip>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <Label htmlFor="telegram-token">توکن بات</Label>
                  <Badge
                    variant={settings.hasTelegramToken ? "outline" : "secondary"}
                    className={
                      settings.hasTelegramToken
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                        : ""
                    }
                  >
                    {settings.hasTelegramToken
                      ? `توکن ذخیره‌شده: ${settings.telegramTokenMasked}`
                      : "توکنی ذخیره نشده است"}
                  </Badge>
                </div>
                <div className="relative">
                  <Input
                    id="telegram-token"
                    dir="ltr"
                    type={showBotToken ? "text" : "password"}
                    autoComplete="new-password"
                    spellCheck={false}
                    value={botTokenInput}
                    onChange={(e) => setBotTokenInput(e.target.value)}
                    placeholder={settings.hasTelegramToken ? settings.telegramTokenMasked : "123456789:AA…"}
                    className="text-left pl-10 font-mono text-sm"
                    aria-describedby="telegram-token-hint"
                  />
                  <button
                    type="button"
                    onClick={() => setShowBotToken((v) => !v)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors rounded-md p-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    aria-label={showBotToken ? "پنهان‌کردن توکن" : "نمایش توکن"}
                  >
                    {showBotToken ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                  </button>
                </div>
                <Hint>
                  <span id="telegram-token-hint">
                    از @BotFather با دستور /newbot بگیرید — قالب: 123456789:AA... — توکن فقط روی سرور
                    ذخیره می‌شود و هرگز به کلاینت برگردانده نمی‌شود.
                  </span>
                </Hint>
                {settings.hasTelegramToken && botTokenInput === "" && (
                  <p className="text-[11px] text-muted-foreground">
                    برای حفظ توکن فعلی، این کادر را خالی بگذارید؛ با وارد کردن مقدار جدید، توکن قبلی
                    جایگزین می‌شود.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <Label htmlFor="miniapp-url">آدرس مینی‌اپ تلگرام</Label>
                  {settings.telegramMiniAppUrl && (
                    <CopyButton
                      value={settings.telegramMiniAppUrl}
                      label="کپی لینک ذخیره‌شده"
                      srLabel="کپی آدرس مینی‌اپ ذخیره‌شده"
                    />
                  )}
                </div>
                <Input
                  id="miniapp-url"
                  dir="ltr"
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  value={miniAppUrl}
                  onChange={(e) => setMiniAppUrl(e.target.value)}
                  placeholder="https://…"
                  className="text-left font-mono text-sm"
                  aria-describedby="miniapp-url-hint"
                />
                <Hint>
                  <span id="miniapp-url-hint">
                    همان آدرس HTTPS عمومی همین پلتفرم است؛ از دکمهٔ «Open in New Tab» پنل پیش‌نمایش
                    کپی کنید و اینجا قرار دهید — دقیقاً همین لینک را در BotFather هم وارد می‌کنید.
                  </span>
                </Hint>
              </div>

              {telegramMsg && <InlineAlert msg={telegramMsg} />}
            </CardContent>
            <Separator />
            <CardFooter className="py-3 flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void saveTelegram()} disabled={savingTelegram || !telegramDirty}>
                  {savingTelegram ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <Save aria-hidden />
                  )}
                  ذخیره
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void testTelegram()}
                  disabled={testingTelegram || !settings.hasTelegramToken || telegramDirty}
                >
                  {testingTelegram ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <Bot aria-hidden />
                  )}
                  آزمودن اتصال
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => void configureBot()}
                  disabled={
                    configuringBot || !settings.hasTelegramToken || !settings.telegramMiniAppUrl || telegramDirty
                  }
                >
                  {configuringBot ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <Wand2 aria-hidden />
                  )}
                  پیکربندی خودکار بات
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground leading-5">
                {!settings.hasTelegramToken
                  ? "برای آزمودن و پیکربندی، ابتدا توکن بات را ذخیره کنید."
                  : telegramDirty
                    ? "ابتدا تغییرات را ذخیره کنید — آزمودن و پیکربندی با تنظیمات ذخیره‌شده انجام می‌شود."
                    : !settings.telegramMiniAppUrl
                      ? "پیکربندی خودکار به «آدرس مینی‌اپ» ذخیره‌شده نیاز دارد."
                      : "پیکربندی خودکار دکمهٔ منو، دستورها و توضیحات فارسی بات را ست می‌کند."}
              </p>
            </CardFooter>
          </Card>

          {/* ═══ کارت ۳ — Round 23: ذخیره‌سازی در تلگرام ═══ */}
          <Card className="border-border/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Cloud className="h-4.5 w-4.5 text-primary" aria-hidden />
                ذخیره‌سازی در تلگرام
              </CardTitle>
              <CardDescription>
                کتاب‌ها، پادکست‌ها و PDFهای فارسی به‌جای هاست، داخل خود تلگرام نگه داشته
                می‌شوند و مستقیماً از تلگرام سرو می‌شوند.
              </CardDescription>
              <CardAction>
                {(() => {
                  const ts = settings.telegramStorage;
                  if (!ts?.configured) {
                    return (
                      <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400">
                        آماده نیست
                      </Badge>
                    );
                  }
                  if (ts.enabled) {
                    return (
                      <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                        فعال
                      </Badge>
                    );
                  }
                  return <Badge variant="outline" className="border-border">غیرفعال</Badge>;
                })()}
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-5">
              {settings.telegramStorage && (
                <div className="grid gap-2 sm:grid-cols-3">
                  <StatusChip
                    icon={Cloud}
                    label="چت ذخیره‌سازی"
                    ok={settings.telegramStorage.configured && !!settings.telegramStorage.storageChatId}
                  >
                    {settings.telegramStorage.storageChatId ? (
                      /^\d+$/.test(settings.telegramStorage.storageChatId) ? (
                        faDigits(settings.telegramStorage.storageChatId)
                      ) : (
                        <span dir="ltr" className="font-mono text-xs">
                          {settings.telegramStorage.storageChatId}
                        </span>
                      )
                    ) : (
                      "نامشخص"
                    )}
                  </StatusChip>
                  <StatusChip icon={Bot} label="بات ذخیره‌ساز" ok={!!settings.telegramStorage.botUsername}>
                    {settings.telegramStorage.botUsername ? (
                      <span dir="ltr" className="font-bold">{`@${settings.telegramStorage.botUsername}`}</span>
                    ) : (
                      "ثبت نشده"
                    )}
                  </StatusChip>
                  <StatusChip icon={Database} label="ذخیره‌شده در تلگرام" ok={settings.telegramStorage.assets > 0}>
                    {faNum(settings.telegramStorage.assets)} فایل · {faSizeBytes(settings.telegramStorage.bytes)}
                  </StatusChip>
                </div>
              )}

              {!settings.telegramStorage?.configured && (
                <Alert className="border-amber-500/40 bg-amber-500/5">
                  <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />
                  <AlertTitle className="text-sm">ذخیره‌سازی تلگرام هنوز آماده نیست</AlertTitle>
                  <AlertDescription className="text-xs leading-5">
                    توکن بات را در کارت «اتصال ربات تلگرام» ثبت کنید و حساب مدیر کل را به تلگرام
                    متصل کنید (یا شناسهٔ چت ذخیره‌سازی را در کادر پایین وارد کنید).
                  </AlertDescription>
                </Alert>
              )}

              <label
                className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 transition-colors ${
                  togglingStorage
                    ? "opacity-60 pointer-events-none border-border/60 bg-muted/20"
                    : "cursor-pointer border-border/60 bg-muted/20 hover:border-primary/40"
                }`}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-bold">فعال‌سازی ذخیره‌سازی در تلگرام</span>
                  <span className="block text-[11px] text-muted-foreground leading-5 mt-1">
                    روشن = هیچ فایلی روی هاست ذخیره نمی‌شود؛ همهٔ باینری‌ها داخل تلگرام
                    می‌روند.
                  </span>
                </span>
                <Switch
                  checked={settings.telegramStorageEnabled}
                  onCheckedChange={(checked) => void toggleTelegramStorage(checked)}
                  disabled={togglingStorage}
                  aria-label="فعال‌سازی ذخیره‌سازی در تلگرام"
                  className="scale-110 shrink-0"
                />
              </label>

              <form
                className="space-y-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveStorageChatId();
                }}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <Label htmlFor="tg-storage-chat">شناسهٔ چت ذخیره‌سازی (اختیاری)</Label>
                  <Badge variant="secondary" className="text-[10px]">
                    {settings.telegramStorageChatId === "" ? "حالت خودکار" : "ثبت دستی"}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Input
                    id="tg-storage-chat"
                    dir="ltr"
                    autoComplete="off"
                    spellCheck={false}
                    inputMode="text"
                    value={tgChatIdInput}
                    onChange={(e) => setTgChatIdInput(e.target.value)}
                    placeholder="۵۳۸۱۱۲۴۹۹۶ یا @storage_channel"
                    disabled={savingStorageChat}
                    className="text-left font-mono text-sm h-11 flex-1 min-w-52 sm:max-w-xs"
                    aria-describedby="tg-storage-chat-hint"
                  />
                  <Button
                    type="submit"
                    variant="outline"
                    disabled={savingStorageChat || !storageChatDirty}
                    className="min-h-11"
                  >
                    {savingStorageChat ? (
                      <Loader2 className="animate-spin" aria-hidden />
                    ) : (
                      <Save aria-hidden />
                    )}
                    ذخیره
                  </Button>
                </div>
                <Hint>
                  <span id="tg-storage-chat-hint">
                    خالی بگذارید تا به‌طور خودکار از چت تلگرامِ مدیر کلِ متصل‌شده استفاده شود؛ یا
                    شناسهٔ عددی چت/کانال تلگرام (مثلاً ۵۳۸۱۱۲۴۹۹۶) یا نام کانال عمومی (مثل{" "}
                    <span dir="ltr" className="font-mono">
                      @storage_channel
                    </span>
                    ) را وارد کنید.
                  </span>
                </Hint>
              </form>

              <Hint>
                <span>
                  هیچ فایلی روی هاست ذخیره نمی‌شود — کتاب‌ها، پادکست‌ها و PDFهای فارسی همگی داخل
                  خود تلگرام نگه داشته می‌شوند و هر بار که کاربری (در وب یا تلگرام) درخواست کند،
                  مستقیماً از تلگرام سرو می‌شوند. سقف هر فایل{" "}
                  {faNum(settings.telegramStorage?.uploadLimitMb ?? 50)} مگابایت؛ دانلود مستقیم وب
                  تا {faNum(settings.telegramStorage?.proxyLimitMb ?? 20)} مگابایت (بزرگ‌ترها با
                  لینک خود بات).
                </span>
              </Hint>

              {storageMsg && <InlineAlert msg={storageMsg} />}
            </CardContent>
          </Card>

          {/* ═══ کارت ۴ — راهنمای گام‌به‌گام BotFather ═══ */}
          <Card className="border-border/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <GraduationCap className="h-4.5 w-4.5 text-primary" aria-hidden />
                راهنمای گام‌به‌گام BotFather
              </CardTitle>
              <CardDescription>
                ساخت بات و اتصال مینی‌اپ در ۶ گام — هر دستور را با دکمهٔ کپی بردارید و در BotFather
                بفرستید.
              </CardDescription>
              <CardAction>
                <Badge variant="outline" className="border-border">
                  {faNum(6)} گام · حدود {faNum(5)} دقیقه
                </Badge>
              </CardAction>
            </CardHeader>
            <CardContent>
              <Accordion
                type="single"
                collapsible
                defaultValue="step-1"
                className="rounded-xl border border-border/60 bg-muted/20 px-4"
              >
                <AccordionItem value="step-1">
                  <AccordionTrigger className="items-center text-right hover:no-underline py-3.5">
                    <span className="flex items-center gap-2.5 min-w-0">
                      <StepBadge n={1} />
                      <span className="text-sm font-bold">ساخت بات با @BotFather</span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3 pb-4">
                    <p className="text-sm leading-6">
                      در تلگرام به{" "}
                      <a
                        href="https://t.me/BotFather"
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline underline-offset-4 inline-flex items-center gap-1"
                      >
                        @BotFather
                        <ExternalLink className="h-3 w-3" aria-hidden />
                      </a>{" "}
                      بروید و دستور زیر را بفرستید؛ سپس یک «نام» برای بات و یک username منتهی به bot
                      انتخاب کنید.
                    </p>
                    <CommandBox command="/newbot" />
                    <p className="text-xs text-muted-foreground leading-5">
                      توکنی که BotFather می‌دهد (قالب 123456789:AA...) را کپی کنید و در کارت «اتصال ربات
                      تلگرام» در کادر «توکن بات» ذخیره کنید.
                    </p>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="step-2">
                  <AccordionTrigger className="items-center text-right hover:no-underline py-3.5">
                    <span className="flex items-center gap-2.5 min-w-0">
                      <StepBadge n={2} />
                      <span className="text-sm font-bold">ساخت مینی‌اپ با /newapp</span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3 pb-4">
                    <p className="text-sm leading-6">
                      در BotFather دستور زیر را بفرستید، بات خود را انتخاب کنید و یک «کوتاه‌نام» (short
                      name) مانند «آموزش هوشمند» بدهید.
                    </p>
                    <CommandBox command="/newapp" />
                    <p className="text-xs text-muted-foreground leading-5">
                      BotFather سپس آدرس Web App را می‌پرسید — آدرس آماده در گام بعدی است.
                    </p>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="step-3">
                  <AccordionTrigger className="items-center text-right hover:no-underline py-3.5">
                    <span className="flex items-center gap-2.5 min-w-0">
                      <StepBadge n={3} />
                      <span className="text-sm font-bold">درج آدرس مینی‌اپ به‌عنوان Web App</span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3 pb-4">
                    {settings.telegramMiniAppUrl ? (
                      <>
                        <p className="text-sm leading-6">
                          BotFather آدرس Web App را می‌پرسد — دقیقاً همان «آدرس مینی‌اپ» ذخیره‌شده در کارت
                          بالا را paste کنید (باید https باشد):
                        </p>
                        <div
                          dir="ltr"
                          className="flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/40 px-3 py-2"
                        >
                          <code className="font-mono text-xs sm:text-sm text-foreground select-all truncate">
                            {settings.telegramMiniAppUrl}
                          </code>
                          <CopyButton value={settings.telegramMiniAppUrl} srLabel="کپی آدرس مینی‌اپ" variant="ghost" />
                        </div>
                        <p className="text-xs text-muted-foreground leading-5">
                          همین لینک در کارت «اتصال ربات تلگرام» ذخیره شده است؛ لینک باید دقیقاً و بدون
                          تغییر وارد شود.
                        </p>
                      </>
                    ) : (
                      <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2.5 text-xs leading-5 text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
                        ابتدا آدرس مینی‌اپ را در کارت «اتصال ربات تلگرام» ذخیره کنید تا این‌جا برای کپی
                        نمایش داده شود.
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="step-4">
                  <AccordionTrigger className="items-center text-right hover:no-underline py-3.5">
                    <span className="flex items-center gap-2.5 min-w-0">
                      <StepBadge n={4} />
                      <span className="text-sm font-bold">دکمهٔ منوی بات (اختیاری)</span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3 pb-4">
                    <p className="text-sm leading-6">
                      (اختیاری) در /mybots → Bot Settings → Menu Button همان لینک مینی‌اپ را قرار دهید —
                      یا فقط روی «پیکربندی خودکار بات» در کارت بالا بزنید تا همه‌چیز خودکار ست شود.
                    </p>
                    <CommandBox command="/mybots" />
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="step-5">
                  <AccordionTrigger className="items-center text-right hover:no-underline py-3.5">
                    <span className="flex items-center gap-2.5 min-w-0">
                      <StepBadge n={5} />
                      <span className="text-sm font-bold">ذخیرهٔ توکن و پیکربندی خودکار</span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3 pb-4">
                    <p className="text-sm leading-6">
                      توکن بات را در کارت «اتصال ربات تلگرام» ذخیره کنید و روی «پیکربندی خودکار بات»
                      بزنید — سرور به‌جای شما دکمهٔ منوی بات را به مینی‌اپ ست می‌کند، ۶ دستور فارسی
                      (شروع، کتاب‌خانه، آزمون، امتیازها، مینی‌اپ، راهنما) و توضیحات فارسی بات را نصب
                      می‌کند.
                    </p>
                    <p className="text-xs text-muted-foreground leading-5">
                      پس از پیکربندی، نام کاربری بات در کارت «اتصال ربات تلگرام» نمایش داده می‌شود.
                    </p>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="step-6">
                  <AccordionTrigger className="items-center text-right hover:no-underline py-3.5">
                    <span className="flex items-center gap-2.5 min-w-0">
                      <StepBadge n={6} />
                      <span className="text-sm font-bold">شروع به کار 🎉</span>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3 pb-4">
                    <p className="text-sm leading-6">
                      در تلگرام به بات خود /start بدهید، حساب خود را متصل کنید و از مینی‌اپ استفاده کنید!
                    </p>
                    <CommandBox command="/start" />
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </CardContent>
          </Card>

          {/* ═══ کارت ۵ — مجوزهای کتاب‌خانه ═══ */}
          <Card className="border-border/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <BookOpen className="h-4.5 w-4.5 text-primary" aria-hidden />
                مجوز افزودن کتاب
              </CardTitle>
              <CardDescription>
                برای هر مدرسه مشخص کنید چه کسی اجازهٔ بارگذاری کتاب و جزوه دارد — پیش‌فرض هر دو خاموش
                است.
              </CardDescription>
              <CardAction>
                <Badge variant="secondary">پیش‌فرض: مجوز خاموش</Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert className="border-primary/30 bg-primary/5">
                <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
                <AlertTitle className="text-sm">دسترسی همیشگی مدیر کل</AlertTitle>
                <AlertDescription className="text-xs leading-5">
                  مدیر کل پلتفرم همیشه می‌تواند کتاب اضافه کند (کتاب‌های عمومی پلتفرم)؛ این مجوزها فقط
                  وضعیت «مدیر مدرسه» و «معلم» هر سازمان را کنترل می‌کنند.
                </AlertDescription>
              </Alert>

              {tenantsError && <ErrorState message={tenantsError} onRetry={loadTenants} />}

              {!tenants && !tenantsError && (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="space-y-2.5">
                      <Skeleton className="h-5 w-44" />
                      <div className="grid gap-2.5 sm:grid-cols-2">
                        <Skeleton className="h-11 w-full rounded-lg" />
                        <Skeleton className="h-11 w-full rounded-lg" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {tenants && tenants.length === 0 && (
                <EmptyState
                  icon={Building2}
                  title="هنوز سازمانی ثبت نشده است"
                  description="پس از ثبت نخستین مدرسه، مجوزهای بارگذاری کتاب آن سازمان در این‌جا قابل تنظیم است."
                />
              )}

              {tenants && tenants.length > 0 && (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge
                      variant="outline"
                      className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    >
                      افزودن توسط مدیر مدرسه: {faNum(adminUpload.size)} مدرسه
                    </Badge>
                    <Badge
                      variant="outline"
                      className="border-teal-500/40 bg-teal-500/10 text-teal-700 dark:text-teal-400"
                    >
                      بارگذاری توسط معلم: {faNum(teacherUpload.size)} مدرسه
                    </Badge>
                  </div>
                  <div className="max-h-96 overflow-y-auto rounded-xl border border-border/60 divide-y divide-border/60 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border">
                    {tenants.map((t) => (
                      <div key={t.id} className="p-4 space-y-3">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="min-w-0">
                            <p className="text-sm font-bold truncate">{t.name}</p>
                            <p dir="ltr" className="text-[11px] text-muted-foreground truncate text-left">
                              {t.slug}
                            </p>
                          </div>
                          <Badge variant="outline" className={tenantStatusClass(t.status)}>
                            {tenantStatusFa(t.status)}
                          </Badge>
                        </div>
                        <div className="grid gap-2.5 sm:grid-cols-2">
                          <PermissionSwitch
                            label="افزودن کتاب توسط مدیر مدرسه"
                            checked={adminUpload.has(t.id)}
                            onCheckedChange={(checked) => toggleInSet(setAdminUpload, t.id, checked)}
                            disabled={savingBooks}
                          />
                          <PermissionSwitch
                            label="بارگذاری جزوه/کتاب توسط معلم"
                            checked={teacherUpload.has(t.id)}
                            onCheckedChange={(checked) => toggleInSet(setTeacherUpload, t.id, checked)}
                            disabled={savingBooks}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {booksMsg && <InlineAlert msg={booksMsg} />}
            </CardContent>
            <Separator />
            <CardFooter className="py-3 flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[11px] text-muted-foreground leading-5">
                {booksDirty
                  ? "تغییرات ذخیره‌نشده دارید — با زدن دکمهٔ ذخیره اعمال می‌شود."
                  : `${faNum(tenants?.length ?? 0)} سازمان بررسی شد.`}
              </p>
              <Button onClick={() => void saveBooks()} disabled={savingBooks || !booksDirty || !tenants}>
                {savingBooks ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Save aria-hidden />
                )}
                ذخیرهٔ مجوزها
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}
    </div>
  );
}
