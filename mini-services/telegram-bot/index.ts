/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  بات تلگرام «پلتفرم آموزش هوشمند ایران» 🎓
 *  mini-service · port 3003 · Bun runtime · long-polling getUpdates
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  معماری:
 *   • GET /  → health-check ({ok, service, uptime})
 *   • هر ۳۰ ثانیه پیکربندی را از اپ اصلی می‌گیرد:
 *       GET http://localhost:3000/api/v1/internal/telegram/config  (X-Bot-Secret)
 *     تا وقتی توکنی تنظیم نشده باشد فقط لاگ می‌کند؛ با ذخیرهٔ توکن توسط مدیر،
 *     بات بدون ری‌استارت فعال می‌شود (deleteWebhook → getUpdates).
 *   • کاربران با «کد اتصال ۶ رقمی» حساب خود را متصل می‌کنند
 *       POST /api/v1/internal/telegram/link  (X-Bot-Secret)
 *     و برای هر چت یک session token کش می‌شود که برای فراخوانی‌های Bearer به‌کار می‌رود.
 *   • کتاب‌خانه/خلاصه (متن + PDF فارسی)/پادکست (WAV)/آزمون تعاملی/امتیازها — همه از
 *     همان API عمومی نسخهٔ وب (/api/v1/books، /api/v1/me/points، …).
 *   • راند ۲۳ — ذخیره‌سازی کامل در تلگرام: فایل‌های هر کتاب یک‌بار در چت ذخیره‌سازی
 *     آپلود می‌شوند و file_id دائمی‌شان در جزئیات کتاب (telegramFiles) می‌آید؛ بات
 *     در صورت وجود file_id همان را مستقیم ارسال می‌کند (فوری، بدون دریافت بایت‌ها)
 *     و فقط در نبودش به مسیر بایت‌های اپ برمی‌گردد.
 *
 *  قواعد:
 *   • توکن بات و توکن نشست‌ها هرگز لاگ نمی‌شوند.
 *   • همهٔ متن‌های پویا قبل از قرارگیری در parse_mode=HTML escape می‌شوند (esc).
 *   • `bun --hot` → با تغییر فایل، نسل (generation) جدید حلقه‌ها را می‌گیرد و
 *     offset در globalThis حفظ می‌شود.
 */

// ─────────────────────────────── ثابت‌ها ───────────────────────────────

const PORT = 3003;
const MAIN_APP = process.env.MAIN_APP_URL ?? "http://localhost:3000";
const BOT_SECRET = process.env.TELEGRAM_BOT_SECRET ?? "aep-internal-bot-secret";
const TG_API_BASE = "https://api.telegram.org";

const NET_ERR = "⚠️ ارتباط با سرور برقرار نشد، دوباره تلاش کنید.";
const QUIZ_IDLE_MS = 10 * 60_000; // انقضای جلسهٔ آزمون پس از ۱۰ دقیقه بی‌فعالیتی
const SESSION_TTL_MS = 12 * 3600_000; // پاک‌سازی نشست‌های کهنه
const BOOKS_PAGE_LIMIT = 40; // سقف دکمه‌های فهرست کتاب‌ها
const MSG_CHUNK = 3200; // هر پیام ≤ ۳۵۰۰ نویسه (محدودیت تلگرام ۴۰۹۶)

// ─────────────────────────────── انواع (Types) ───────────────────────────────

interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

interface TgChat {
  id: number;
  type: string;
}

interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  date: number;
  text?: string;
  document?: TgDocument; // round 20 — آپلود PDF کتاب از خود تلگرام
  contact?: TgContact; // round 22 — ورود با شمارهٔ موبایل (request_contact)
  caption?: string;
}

/** مخاطب به‌اشتراک‌گذاشته‌شده (دکمهٔ reply با request_contact — راند ۲۲) */
interface TgContact {
  phone_number: string;
  first_name?: string;
  last_name?: string;
  user_id?: number;
  user?: TgUser;
}

interface TgDocument {
  file_id: string;
  file_unique_id?: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}

interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
  web_app?: { url: string };
}

type InlineKeyboard = InlineButton[][];

type QuizModel = "MC" | "TF" | "MIXED" | "FB" | "SHORT";

// ── پاسخ‌های اپ اصلی ──

interface BotConfig {
  enabled: boolean;
  token: string | null;
  miniAppUrl: string | null;
  botUsername: string | null;
}

interface AppUser {
  id: string;
  role: string;
  fullName: string;
  grade?: string | null;
  tenantId?: string | null;
}

interface ResolveResponse {
  linked: boolean;
  token?: string;
  user?: AppUser;
}

interface LinkResponse {
  token?: string;
  user?: AppUser;
  error?: { message?: string };
}

interface BookSummary {
  id: string;
  title: string;
  author: string | null;
  subject: string | null;
  level: string | null;
  levelLabel: string | null;
  gradeLevel: string | null;
  description: string | null;
  coverEmoji: string;
  charCount: number;
  status: string;
  summaryStatus: string;
  studyNotesStatus: string;
  quizStatus: string;
  figuresStatus: string;
  figuresCount: number;
  podcastStatus: string;
  podcastDurationSec: number | null;
  quizCount: number;
  createdAt: string;
  scope: string;
  myBest: number | null;
  myTries: number;
}

interface BookDetail extends BookSummary {
  addedByName: string | null;
  tenantName: string | null;
  mine: boolean;
  summary: string | null;
  studyNotes: string | null;
  figures: { id: string; title: string; svg: string; caption: string }[] | null;
  quizModels: { kind: string; label: string; count: number }[];
  errorReason: string | null;
  myAttempts: { id: string; quizModel: string; score: number; maxScore: number; pointsAwarded: number; createdAt: string }[];
  /** راند ۲۳ — ذخیره‌سازی کامل در تلگرام: file_id های دائمی به‌تفکیک نوع
   *  (ORIGINAL_PDF / PODCAST_AUDIO / SUMMARY_PDF / NOTES_PDF / QUIZ_PDF_MC و مدل‌های تنبل آزمون) */
  telegramFiles?: Record<string, string>;
}

interface BooksListData {
  canUpload: boolean;
  canUploadLabel: string;
  role: string;
  books: BookSummary[];
}

interface BookSummaryEx extends BookSummary {
  hasOriginalPdf?: boolean;
}

interface BookDetailEx extends BookDetail {
  hasOriginalPdf?: boolean;
}

interface PdfExtractResult {
  text: string;
  pages: number;
  chars: number;
  truncated: boolean;
  fileName: string;
  storageKey: string;
  sourceUrl?: string;
}

interface CreatedBook {
  id: string;
  title: string;
  status: string;
}

/** ساختار درسی رسمی از اپ اصلی (دوره → پایه → دروس) */
interface MetaCurriculum {
  levels: Array<{ code: string; label: string; emoji: string; grades: Array<{ grade: string; subjects: string[] }> }>;
}

interface QuizFetch {
  bookId: string;
  bookTitle: string;
  model: string;
  modelLabel: string;
  maxScore: number;
  items: { id: string; kind: string; prompt: string; options?: string[]; topic: string | null }[];
}

interface QuizResult {
  attemptId: string;
  bookId: string;
  bookTitle: string;
  model: string;
  modelLabel: string;
  score: number;
  maxScore: number;
  percent: number;
  previousBest: number;
  newBest: boolean;
  pointsAwarded: number;
  perQuestion: {
    id: string;
    kind: string;
    prompt: string;
    yourAnswer: string | null;
    correct: boolean | null;
    correctAnswer: string;
    explanation: string | null;
  }[];
}

interface PointsData {
  total: number;
  last30Days: number;
  recent: { points: number; reason: string; reasonLabel: string; refType: string | null; refId: string | null; createdAt: string }[];
}

// ─────────────────────────────── وضعیت سرویس ───────────────────────────────

interface BotState {
  botToken: string | null;
  miniAppUrl: string | null;
  botUsername: string | null;
  configLogged: "init" | "down" | "waiting" | "active" | "token-error";
}

const state: BotState = { botToken: null, miniAppUrl: null, botUsername: null, configLogged: "init" };

interface ChatSession {
  token: string;
  user: AppUser;
  tgId: number;
  at: number;
  booksCache: { at: number; key: string; data: BooksListData } | null;
  /** راند ۲۶ — وضعیت منوی مرحله‌ای کتاب‌خانه (دوره → پایه → درس)؛ برای
   * اندیس‌های کوتاه callback (سقف ۶۴ بایت) در سرویس نگه داشته می‌شود. */
  browse?: LibraryBrowse | null;
}

const chatSessions = new Map<number, ChatSession>();

interface QuizSession {
  sid: string;
  chatId: number;
  tgUser: TgUser;
  bookId: string;
  bookTitle: string;
  model: QuizModel;
  modelLabel: string;
  items: QuizFetch["items"];
  answers: Record<string, string>;
  idx: number;
  currentMsgId: number | null;
  shortPending: string | null; // شناسهٔ سؤال تشریحیِ در انتظار پاسخ تایپی
  lastTouch: number;
}

const quizSessions = new Map<string, QuizSession>();
const quizByChat = new Map<number, string>();

// ── مدیریت hot-reload (bun --hot): نسل‌ها و offset پایدار ──

const g = globalThis as {
  __tgBotGen?: number;
  __tgBotOffset?: number;
  __tgBotAborts?: Set<AbortController>;
  __tgBotServer?: unknown;
  __tgBotBeat?: number; // ضربان حلقهٔ نظرسنجی (watchdog راند ۲۱)
  __tgBotLoop?: boolean; // آیا حلقهٔ نظرسنجی در حال اجراست؟
};

const myGen = (g.__tgBotGen = (g.__tgBotGen ?? 0) + 1);
if (!g.__tgBotAborts) g.__tgBotAborts = new Set<AbortController>();
for (const ctrl of [...g.__tgBotAborts]) ctrl.abort(); // لغو long-pollهای نسل قبل
g.__tgBotAborts.clear();

let offset = g.__tgBotOffset ?? 0;

const alive = (): boolean => g.__tgBotGen === myGen;

// ─────────────────────────────── ابزارهای عمومی ───────────────────────────────

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/** تبدیل ارقام لاتین به فارسی */
function faNum(n: number | string): string {
  return String(n).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}

/** escape برای parse_mode=HTML تلگرام */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function trunc(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

function safeFilename(s: string): string {
  return s.replace(/[\\/:*?"<>|\n\r\t]/g, "_").trim().slice(0, 50) || "file";
}

let faDateFmt: Intl.DateTimeFormat | null = null;
try {
  faDateFmt = new Intl.DateTimeFormat("fa-IR", { year: "numeric", month: "long", day: "numeric" });
} catch {
  faDateFmt = null;
}

/** تاریخ شمسیِ خوانا (با fallback ایمن) */
function faDate(iso: string): string {
  try {
    if (faDateFmt) return faDateFmt.format(new Date(iso));
  } catch {
    /* fallback */
  }
  return iso.slice(0, 10);
}

/** مدت زمان به فارسی: «~۲ دقیقه و ۳۰ ثانیه» */
function durationFa(sec: number): string {
  const s = Math.max(1, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return `~${faNum(s)} ثانیه`;
  if (r === 0) return `~${faNum(m)} دقیقه`;
  return `~${faNum(m)} دقیقه و ${faNum(r)} ثانیه`;
}

function roleLabelFa(role: string): string {
  switch (role) {
    case "SUPER_ADMIN":
      return "مدیر کل پلتفرم";
    case "SCHOOL_ADMIN":
      return "مدیر مدرسه";
    case "TEACHER":
      return "معلم";
    case "STUDENT_PRO":
      return "دانش‌آموز پرو";
    case "STUDENT":
      return "دانش‌آموز";
    case "PARENT":
      return "والد";
    default:
      return role;
  }
}

function bookStatusEmoji(s: string): string {
  if (s === "READY") return "✅";
  if (s === "GENERATING" || s === "PENDING") return "⏳";
  if (s === "PARTIAL") return "⚠️";
  return "❌";
}

function statusFa(s: string | null | undefined): string {
  switch (s) {
    case "READY":
      return "✅ آماده";
    case "GENERATING":
    case "PENDING":
      return "⏳ در حال تولید…";
    case "FAILED":
      return "✖ ناموفق";
    case "PARTIAL":
      return "⚠️ ناقص";
    default:
      return "✖ نامشخص";
  }
}

function log(msg: string): void {
  console.log(`[tg-bot] ${msg}`);
}

function errStr(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e);
  // هرگز توکن بات در لاگ ظاهر نشود
  if (state.botToken && s.includes(state.botToken)) return s.split(state.botToken).join("***");
  return s;
}

/** تبدیل مارک‌دانِ خلاصهٔ AI به HTML تلگرام (bold ساده) */
function mdToTgHtml(md: string): string {
  return esc(md)
    .replace(/^#{1,6}\s*(.+)$/gm, "<b>$1</b>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/__([^_\n]+)__/g, "<b>$1</b>")
    .replace(/`([^`\n]+)`/g, "<i>$1</i>")
    .replace(/^[-*•]\s+/gm, "• ");
}

/** شکستن پیام بلند به قطعات ≤ max نویسه (سرِ سطرها — امن برای تگ‌های سطری) */
function splitMessage(text: string, max = MSG_CHUNK): string[] {
  if (text.length <= max) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n\n", max);
    if (cut < max * 0.4) cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.4) cut = rest.lastIndexOf(" ", max);
    if (cut < max * 0.4) cut = max;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\s+/, "");
  }
  if (rest) parts.push(rest);
  return parts;
}

const FA_LETTERS = ["الف", "ب", "ج", "د", "ه"];

// ─────────────────────────────── کلاینت Bot API تلگرام ───────────────────────────────

class BotApiError extends Error {
  constructor(
    public readonly code: number,
    public readonly description: string
  ) {
    super(`telegram api ${code}: ${description}`);
  }
}

async function tg<T = unknown>(
  method: string,
  payload?: Record<string, unknown>,
  opts: { timeoutMs?: number; multipart?: FormData; longPoll?: boolean } = {}
): Promise<T> {
  const token = state.botToken;
  if (!token) throw new BotApiError(0, "bot token not configured");
  const url = `${TG_API_BASE}/bot${token}/${method}`;
  const ctrl = new AbortController();
  if (opts.longPoll) g.__tgBotAborts?.add(ctrl);
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: opts.multipart ? undefined : { "content-type": "application/json" },
      body: opts.multipart ?? JSON.stringify(payload ?? {}),
      signal: ctrl.signal,
    });
    const data = (await res.json().catch(() => null)) as
      | { ok?: boolean; result?: T; error_code?: number; description?: string }
      | null;
    if (!data) throw new BotApiError(0, "empty Telegram API response");
    if (data.ok !== true || data.result === undefined) {
      throw new BotApiError(data.error_code ?? 0, data.description ?? "unknown Telegram API error");
    }
    return data.result;
  } finally {
    clearTimeout(timer);
    if (opts.longPoll) g.__tgBotAborts?.delete(ctrl);
  }
}

async function safeTg<T = unknown>(
  method: string,
  payload?: Record<string, unknown>,
  opts?: { timeoutMs?: number; multipart?: FormData }
): Promise<T | null> {
  try {
    return await tg<T>(method, payload, opts);
  } catch (e) {
    log(`⚠️ Telegram ${method}: ${errStr(e)}`);
    return null;
  }
}

async function sendMessage(
  chatId: number,
  html: string,
  inline?: InlineKeyboard,
  replyMarkup?: unknown
): Promise<TgMessage | null> {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  };
  const markup = inline ? { inline_keyboard: inline } : replyMarkup;
  if (markup) payload.reply_markup = markup;
  return safeTg<TgMessage>("sendMessage", payload);
}

async function editMessage(chatId: number, messageId: number, html: string, inline?: InlineKeyboard): Promise<void> {
  try {
    await tg("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: html,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: inline ?? [] },
    });
  } catch (e) {
    if (e instanceof BotApiError && (e.description.includes("message is not modified") || e.description.includes("MESSAGE_ID_INVALID"))) {
      return; // بی‌خطر — پیام همان است یا حذف شده
    }
    log(`⚠️ editMessageText: ${errStr(e)}`);
  }
}

async function answerCb(id: string, text?: string): Promise<void> {
  await safeTg("answerCallbackQuery", {
    callback_query_id: id,
    ...(text ? { text: trunc(text, 190) } : {}),
  });
}

async function chatAction(chatId: number, action: string): Promise<void> {
  await safeTg("sendChatAction", { chat_id: chatId, action });
}

// ─────────────────────────────── کلاینت اپ اصلی (localhost) ───────────────────────────────

async function mainAppFetch(path: string, init?: RequestInit, timeoutMs = 25_000): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`${MAIN_APP}${path}`, { ...init, signal: ctrl.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * راند ۲۱ — مقاوم‌سازی: خواندن بدنهٔ پاسخ (json/arrayBuffer) نیز باید مهلت زمانی داشته باشد.
 * ریشهٔ باگ «بات از کار افتاد»: با مرگ ناگهانی سرور وسط پاسخ، سوکت نیمه‌باز می‌ماند و
 * res.json()/res.arrayBuffer() برای همیشه معلق می‌شود؛ چون handleUpdate ترتیبی بود،
 * کل حلقهٔ نظرسنجی فریز می‌شد و هیچ فرمانی (حتی /start) دیگر پاسخ نمی‌گرفت.
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      log(`⏱ مهلت «${label}» (${faNum(Math.round(ms / 1000))} ثانیه) به پایان رسید — ادامه می‌دهیم.`);
      resolve(null);
    }, ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(null);
      }
    );
  });
}

async function readJson<T>(res: Response | null | undefined, timeoutMs = 20_000): Promise<T | null> {
  if (!res) return null;
  try {
    return (await withTimeout(res.json(), timeoutMs, "پاسخ JSON")) as T | null;
  } catch {
    return null;
  }
}

/** خواندن بدنهٔ فایل (docx/podcast/PDF) با مهلت زمانی — دیگر گیر ابدی وجود ندارد */
async function readArrayBuffer(
  res: Response | null | undefined,
  timeoutMs = 90_000
): Promise<ArrayBuffer | null> {
  if (!res) return null;
  try {
    return await withTimeout(res.arrayBuffer(), timeoutMs, "دریافت فایل از سرور");
  } catch {
    return null;
  }
}

function apiErrorText(data: unknown): string {
  const msg = (data as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof msg === "string" && msg.trim() ? msg.trim() : "ارتباط با سرور برقرار نشد، دوباره تلاش کنید.";
}

/** نام فایل فارسی از Content-Disposition (filename* چندزبانه) — در صورت نبود، fallback (راند ۲۲) */
function fileNameFromResponse(res: Response | null | undefined, fallback: string): string {
  const cd = res?.headers.get("content-disposition") ?? "";
  const mStar = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  const mPlain = /filename="?([^";]+)"?/i.exec(cd);
  let fname = "";
  try {
    if (mStar) fname = decodeURIComponent(mStar[1].trim());
    else if (mPlain) fname = mPlain[1].trim();
  } catch {
    fname = "";
  }
  return fname || fallback;
}

/**
 * راند ۲۳ — «ذخیره‌سازی کامل در تلگرام»: فایل‌های کتاب (PDF اصلی، پادکست، خلاصه،
 * جزوه، نمونه‌سؤال) یک‌بار در چت ذخیره‌سازی آپلود شده‌اند و file_id دائمی‌شان در
 * جزئیات کتاب (telegramFiles) می‌آید. با file_id ارسال «فوری» است — بدون دریافت
 * بایت‌ها از اپ و بدون آپلود مالتی‌پارت (مهلت پیش‌فرض ۳۰ث کافی است).
 */
function tgFileId(b: BookDetail | null | undefined, kind: string): string | null {
  const fid = b?.telegramFiles?.[kind];
  return typeof fid === "string" && fid.length > 0 ? fid : null;
}

/** resolve نشست کاربر تلگرام از اپ اصلی (server-to-server با X-Bot-Secret) */
async function resolveSession(
  tgId: number
): Promise<{ linked: true; token: string; user: AppUser } | { linked: false } | null> {
  const res = await mainAppFetch(
    "/api/v1/internal/telegram/resolve",
    {
      method: "POST",
      headers: { "x-bot-secret": BOT_SECRET, "content-type": "application/json" },
      body: JSON.stringify({ telegramId: tgId }),
    },
    15_000
  );
  if (!res || !res.ok) return null;
  const data = await readJson<ResolveResponse>(res);
  if (!data || data.linked !== true || !data.token || !data.user) return { linked: false };
  return { linked: true, token: data.token, user: data.user };
}

async function getSession(chatId: number, from: TgUser): Promise<ChatSession | null> {
  const cached = chatSessions.get(chatId);
  if (cached) return cached;
  const r = await resolveSession(from.id);
  if (!r || r.linked !== true) return null;
  const s: ChatSession = { token: r.token, user: r.user, tgId: from.id, at: Date.now(), booksCache: null };
  chatSessions.set(chatId, s);
  return s;
}

/**
 * فراخوانی API با توکن نشست کاربر (Bearer). اگر ۴۰۱ گرفت، نشست را تازه می‌کند
 * و یک‌بار دیگر تلاش می‌کند. خروجی: Response | null | "unlinked".
 */
async function authed(
  chatId: number,
  from: TgUser,
  path: string,
  init?: RequestInit,
  timeoutMs = 25_000
): Promise<Response | null | "unlinked"> {
  const s = await getSession(chatId, from);
  if (!s) return "unlinked";
  const call = async (): Promise<Response | null> => {
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${s.token}`);
    // body متنی → JSON؛ FormData (multipart) → مرز خودش را می‌گذارد (round 20)
    if (init?.body && typeof init.body === "string" && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    return mainAppFetch(path, { ...init, headers }, timeoutMs);
  };
  let res = await call();
  if (res && res.status === 401) {
    chatSessions.delete(chatId);
    const again = await getSession(chatId, from);
    if (!again) return "unlinked";
    res = await call();
  }
  return res;
}

// ─────────────────────────────── پیام‌های پایه ───────────────────────────────

function appKeyboard(): InlineKeyboard | null {
  if (!state.miniAppUrl) return null;
  const url = state.miniAppUrl;
  const rows: InlineKeyboard = [[{ text: "🎓 باز کردن مینی‌اپ", web_app: { url } }]];
  if (url.startsWith("https://")) rows.push([{ text: "🔗 باز کردن در مرورگر", url }]);
  return rows;
}

// دوره‌های تحصیلی برای فیلتر کتاب‌خانه (برچسب فارسی + کد)
const LEVELS_FA: Array<{ code: string; label: string; emoji: string }> = [
  { code: "PRE_PRIMARY", label: "پیش‌دبستانی", emoji: "🧸" },
  { code: "PRIMARY", label: "ابتدایی", emoji: "🎒" },
  { code: "MIDDLE_1", label: "متوسطهٔ اول", emoji: "📗" },
  { code: "MIDDLE_2", label: "متوسطهٔ دوم", emoji: "📘" },
  { code: "TECHNICAL", label: "هنرستان", emoji: "🔧" },
];

function structureLineFa(b: { levelLabel: string | null; gradeLevel: string | null; subject: string | null }): string | null {
  const bits = [b.levelLabel, b.gradeLevel ? `پایهٔ ${b.gradeLevel}` : null, b.subject].filter(Boolean);
  return bits.length > 0 ? bits.join(" · ") : null;
}

function mainMenuReply(): Record<string, unknown> {
  return {
    keyboard: [
      ["📚 کتاب‌خانه", "✍️ آزمون نمونه"],
      ["⭐ امتیازهای من", "🎓 باز کردن اپ"],
      ["ℹ️ راهنما", "🚪 خروج"],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

/**
 * راند ۲۲ — کیبورد پاسخ برای کاربران متصل‌نشده: دکمهٔ «📱 ورود با شمارهٔ موبایل»
 * (request_contact → تلگرام شمارهٔ کاربر را برای بات می‌فرستد) + مسیر کد ۶ رقمی.
 */
function linkPhoneReply(): Record<string, unknown> {
  return {
    keyboard: [
      [{ text: "📱 ورود با شمارهٔ موبایل", request_contact: true }],
      [{ text: "🔗 اتصال با کد ۶ رقمی" }],
    ],
    resize_keyboard: true,
  };
}

async function promptLink(chatId: number): Promise<void> {
  await sendMessage(
    chatId,
    "🔐 برای این کار ابتدا باید حساب خود را متصل کنید.\n\n📱 اگر شمارهٔ موبایلی که در حساب وب‌تان ثبت کرده‌اید با شمارهٔ تلگرام‌تان یکی است، دکمهٔ «📱 ورود با شمارهٔ موبایل» پایین را بزنید تا مستقیم وارد شوید.\n\n🔗 یا در نسخهٔ وب (یا مینی‌اپ) وارد حساب خود شوید و از بخش پروفایل «کد اتصال» بگیرید و همان ۶ رقم را همین‌جا بفرستید.",
    [[{ text: "🔗 اتصال با کد ۶ رقمی", callback_data: "link" }]],
    linkPhoneReply()
  );
}

async function sendWelcomeUnlinked(chatId: number, from: TgUser): Promise<void> {
  const name = esc(from.first_name || "دوست عزیز");
  const lines = [
    `👋 سلام <b>${name}</b>!`,
    "",
    "به بات رسمی <b>«پلتفرم آموزش هوشمند ایران»</b> 🎓 خوش آمدید.",
    "",
    "من همراه همیشگی شما برای یادگیری هستم و می‌توانم:",
    "📚 کتاب‌خانهٔ هوشمند شما را نشان دهم",
    "📄 خلاصهٔ کتاب‌ها را بفرستم (متن + فایل PDF با فونت فارسی)",
    "🎧 پادکست صوتی کتاب‌ها را برایتان بفرستم",
    "✍️ با نمونه‌سؤال‌های هوشمند محکتان کنم",
    "⭐ امتیازها و رکوردهایتان را دنبال کنم",
    "",
    "برای شروع، یکی از دو راه اتصال را انتخاب کنید 👇",
  ];
  await sendMessage(
    chatId,
    lines.join("\n"),
    [[{ text: "🔗 اتصال با کد ۶ رقمی", callback_data: "link" }]],
    linkPhoneReply()
  );
  await sendMessage(
    chatId,
    "📱 <b>ورود سریع:</b> اگر شمارهٔ موبایلی که در حساب وب‌تان ثبت کرده‌اید با شمارهٔ تلگرام‌تان یکی است، دکمهٔ «📱 ورود با شمارهٔ موبایل» پایین را بزنید تا مستقیم وارد شوید.\n\n🔗 <b>راه دیگر:</b> در نسخهٔ وب (یا مینی‌اپ) وارد حساب خود شوید و از بخش پروفایل «کد اتصال» بگیرید و همان ۶ رقم را همین‌جا بفرستید. 🔢"
  );
}

async function sendWelcomeLinked(chatId: number, from: TgUser, session: ChatSession): Promise<void> {
  const firstName = from.first_name || session.user.fullName;
  const lines = [
    `🌟 سلام <b>${esc(firstName)}</b>!`,
    "",
    `خوش برگشتی! حساب «${esc(session.user.fullName)}» (${esc(roleLabelFa(session.user.role))}) متصل است. ✅`,
    "",
    "از منوی پایین هر کاری را خواستی شروع کن:",
    "📚 کتاب‌خانه · ✍️ آزمون نمونه · ⭐ امتیازهای من",
    "",
    "هر وقت خواستی /help را بفرست تا همهٔ امکانات را ببینی 💡",
  ];
  const kb = appKeyboard();
  await sendMessage(chatId, lines.join("\n"), kb ?? undefined);
  await sendMessage(chatId, "منوی اصلی برای شما فعال شد 👇 کافیست یکی را انتخاب کنید.", undefined, mainMenuReply());
}

async function sendLinkGuide(chatId: number): Promise<void> {
  const lines = [
    "🔗 <b>اتصال حساب تلگرام به پلتفرم</b>",
    "",
    "۱. در نسخهٔ وب پلتفرم وارد حساب خود شوید (یا مینی‌اپ را باز کنید).",
    "۲. به بخش «پروفایل» بروید و روی «کد اتصال تلگرام» بزنید.",
    "۳. کد ۶ رقمی نمایش داده‌شده را همین‌جا در همین گفتگو بفرستید. 🔢",
    "",
    "⏱ کد ۱۰ دقیقه اعتبار دارد.",
  ];
  if (state.botUsername) {
    lines.push("", `💡 راه میان‌بر: پس از گرفتن کد، از t.me/${state.botUsername} به این گفتگو برگردید.`);
  }
  await sendMessage(chatId, lines.join("\n"));
}

async function sendHelp(chatId: number): Promise<void> {
  const lines = [
    "ℹ️ <b>راهنمای بات آموزش هوشمند</b>",
    "",
    "📚 <b>کتاب‌خانه</b> — منوی مرحله‌ای مثل سایت مدرسه: دورهٔ تحصیلی ← پایهٔ تحصیلی ← درس/نوع کتاب ← فهرست کتاب‌ها (با شمارش روی هر دکمه)؛ هر کتاب دارای خلاصه، جزوه، شکل، نمونه‌سؤال و پادکست است.",
    "📄 <b>خلاصهٔ کتاب</b> — خلاصهٔ کامل به‌صورت متن + فایل PDF با فونت فارسی (وزیرمتن).",
    "📒 <b>جزوهٔ شبامتحان</b> — تعاریف، فرمول‌ها و نکات کنکوری، به‌صورت متن + PDF با فونت فارسی.",
    "🎧 <b>پادکست صوتی</b> — نسخهٔ شنیداری کتاب؛ در مسیر هم گوش بدهید!",
    "📥 <b>ذخیره در پیام‌های ذخیره</b> — پادکست و کتاب اصلی را با یک دکمه داخل خود تلگرام نگه دارید.",
    "✍️ <b>آزمون نمونه</b> — چهارگزینه‌ای، درست/غلط، جای خالی، ترکیبی و تشریحی؛ همراه با مرور کامل پاسخ‌ها.",
    "📝 <b>نمونه‌سؤال PDF</b> — برگهٔ رسمی آزمون (۴ گزینه‌ای) + پاسخ‌نامهٔ تشریحی، PDF با فونت فارسی.",
    "⭐ <b>امتیازهای من</b> — مجموع امتیاز، ۳۰ روز اخیر و آخرین دستاوردها.",
    "🎓 <b>باز کردن اپ</b> — مینی‌اپ کامل پلتفرم، همین‌جا داخل تلگرام.",
    "🔗 <b>اتصال حساب</b> — با کد ۶ رقمی از بخش پروفایل وب (/link) یا 📱 ورود با شمارهٔ موبایل.",
    "🚪 <b>خروج</b> — قطع اتصال حساب تلگرام از پلتفرم (/logout).",
    "➕ <b>افزودن کتاب</b> — فایل PDF کتاب را بفرستید (/upload): دوره → پایه → درس → عنوان؛ خلاصه، جزوه، شکل، سؤال و پادکست خودکار ساخته می‌شود و خود PDF هم برای دانلود دانش‌آموزان ضمیمه می‌شود. (برای مدیر کل و مدرسه/معلمِ دارای مجوز)",
    "",
    "💡 نکته: نتیجهٔ آزمون‌ها در پلتفرم ثبت می‌شود و با بهبود رکوردتان امتیاز می‌گیرید! 🚀",
    "",
    "فرمان‌ها: /start · /books · /upload · /app · /points · /link · /logout · /help",
  ];
  const kb = appKeyboard();
  await sendMessage(chatId, lines.join("\n"), kb ?? undefined);
}

async function sendApp(chatId: number): Promise<void> {
  const kb = appKeyboard();
  if (kb) {
    await sendMessage(
      chatId,
      "🎓 <b>پلتفرم آموزش هوشمند ایران</b>\n\nبا دکمهٔ زیر می‌توانید مینی‌اپ کامل پلتفرم را همین‌جا در تلگرام باز کنید:",
      kb
    );
  } else {
    await sendMessage(
      chatId,
      "🎓 مینی‌اپ هنوز تنظیم نشده است.\nمدیر کل می‌تواند آدرس آن را از بخش «تنظیمات و اتصال‌ها» ثبت کند."
    );
  }
}

async function sendFallback(chatId: number): Promise<void> {
  await sendMessage(
    chatId,
    "🤔 متوجه پیام شما نشدم!\nمی‌توانید از منوی پایین استفاده کنید یا /help را بفرستید. 💡",
    [
      [{ text: "📚 کتاب‌ها", callback_data: "books" }, { text: "ℹ️ راهنما", callback_data: "help" }],
    ]
  );
}

// ─────────────────────────────── کتاب‌خانه (منوی مرحله‌ای) ───────────────────────────────
// راند ۲۶ — خواستهٔ مدیر: «چرا دورهٔ تحصیلی، پایهٔ تحصیلی و نوع کتاب منو ندارد؟»
// الگوی chap.sch.ir حالا کامل پیاده شده: دورهٔ تحصیلی → پایهٔ تحصیلی → درس/نوع
// کتاب → فهرست کتاب‌ها. همهٔ مراحل روی همان فهرست کامل (کش ۶۰ ثانیه‌ای چت)
// به‌صورت محلی فیلتر می‌شوند تا شمارشِ روی دکمه‌ها همیشه با دادهٔ واقعی یکی
// باشد. وضعیت مراحل در نشست چت نگه داشته می‌شود تا callback_data کوتاه بماند
// (سقف ۶۴ بایت تلگرام) و متن فارسیِ آزاد (نام پایه/درس) مشکلی ایجاد نکند.

const NO_LEVEL = "__none"; // callback کتاب‌های بدون دورهٔ مشخص

interface LibraryBrowse {
  level: string | null; // کد دورهٔ انتخابی؛ null = همهٔ کتاب‌ها (بدون فیلتر)
  grade: string | null; // مقدار پایهٔ انتخابی؛ "" = بدون پایه؛ null = همهٔ پایه‌ها
  gradeIdx: number; // اندیس پایه برای بازگشت/به‌روزرسانی (-1 = همهٔ پایه‌ها)
  subject: string | null; // درس/نوع کتاب انتخابی؛ "" = بدون درس؛ null = همه
  subjectIdx: number; // اندیس درس برای بازگشت/به‌روزرسانی (-1 = همهٔ درس‌ها)
  grades: string[]; // گزینه‌های پایهٔ مشتق‌شده (پشتوانهٔ اندیس‌های callback)
  subjects: string[]; // گزینه‌های درس مشتق‌شده
}

type LibraryData = { ok: true; data: BooksListData } | { ok: false; text: string } | "unlinked";

/** فهرست کامل کتاب‌های کاربر — با کش ۶۰ ثانیه‌ای (کلید "") */
async function fetchLibrary(
  chatId: number,
  from: TgUser,
  opts: { fresh?: boolean } = {}
): Promise<LibraryData> {
  const cached = chatSessions.get(chatId)?.booksCache;
  if (!opts.fresh && cached && cached.key === "" && Date.now() - cached.at < 60_000) {
    return { ok: true, data: cached.data };
  }
  const res = await authed(chatId, from, "/api/v1/books");
  if (res === "unlinked") return "unlinked";
  if (!res || !res.ok) {
    return { ok: false, text: `⚠️ ${esc(apiErrorText(await readJson(res)))}` };
  }
  const data = await readJson<BooksListData>(res);
  if (!data) return { ok: false, text: NET_ERR };
  const s = chatSessions.get(chatId);
  if (s) s.booksCache = { at: Date.now(), key: "", data };
  return { ok: true, data };
}

function levelOfBook(b: BookSummary): string {
  return b.level ?? "";
}
function gradeOfBook(b: BookSummary): string {
  return b.gradeLevel ?? "";
}
function subjectOfBook(b: BookSummary): string {
  return b.subject ?? "";
}
function gradeFa(level: string | null, grade: string): string {
  if (grade === "") return "بدون پایهٔ مشخص";
  return level === "PRIMARY" ? `کلاس ${grade}` : `پایهٔ ${grade}`;
}
function subjectFa(subject: string): string {
  return subject === "" ? "بدون درس مشخص" : subject;
}
function chunkRows<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** ترتیب رسمی پایه‌های هر دوره (برای مرتب‌سازی دکمه‌ها مثل chap.sch.ir) */
const GRADE_ORDER: Record<string, string[]> = {
  PRE_PRIMARY: [],
  PRIMARY: ["اول", "دوم", "سوم", "چهارم", "پنجم", "ششم"],
  MIDDLE_1: ["هفتم", "هشتم", "نهم"],
  MIDDLE_2: ["دهم", "یازدهم", "دوازدهم"],
  TECHNICAL: ["دهم", "یازدهم", "دوازدهم"],
};

/** پایه‌های موجودِ کتاب‌های یک دوره — مرتب با ترتیب رسمی؛ «بدون پایه» آخر */
function deriveGrades(books: BookSummary[], level: string | null): string[] {
  const set = new Set<string>();
  for (const b of books) {
    if (levelOfBook(b) === level) set.add(gradeOfBook(b));
  }
  const canon = GRADE_ORDER[level ?? ""] ?? [];
  const known = canon.filter((g) => set.has(g));
  const unknown = [...set].filter((g) => !canon.includes(g) && g !== "").sort((a, b) => a.localeCompare(b, "fa"));
  const out = [...known, ...unknown];
  if (set.has("")) out.push("");
  return out;
}

/** درس‌های/نوع کتاب‌های موجود — الفبایی؛ «بدون درس» آخر */
function deriveSubjects(books: BookSummary[]): string[] {
  const set = new Set<string>();
  for (const b of books) set.add(subjectOfBook(b));
  const out = [...set].filter((s) => s !== "").sort((a, b) => a.localeCompare(b, "fa"));
  if (set.has("")) out.push("");
  return out;
}

async function deliverScreen(
  chatId: number,
  opts: { messageId?: number },
  text: string,
  kb: InlineKeyboard
): Promise<void> {
  if (opts.messageId) await editMessage(chatId, opts.messageId, text, kb);
  else await sendMessage(chatId, text, kb);
}

/** گام ۱ — انتخاب دورهٔ تحصیلی (ریشهٔ کتاب‌خانه) */
async function sendLibraryRoot(
  chatId: number,
  from: TgUser,
  opts: { messageId?: number; fresh?: boolean; hint?: string } = {}
): Promise<void> {
  await chatAction(chatId, "typing");
  const r = await fetchLibrary(chatId, from, opts);
  if (r === "unlinked") return void (await promptLink(chatId));
  if (!r.ok) return void (await deliverScreen(chatId, opts, r.text, [[{ text: "🔄 تلاش دوباره", callback_data: "books" }]]));
  const s = chatSessions.get(chatId);
  if (s) s.browse = null; // شروع تازه

  const all = r.data.books ?? [];
  const kb: InlineKeyboard = [];
  const levelBtns = LEVELS_FA.map((l) => {
    const n = all.filter((b) => levelOfBook(b) === l.code).length;
    return { text: `${l.emoji} ${l.label}${n > 0 ? ` (${faNum(n)})` : ""}`, callback_data: `blvl:${l.code}` };
  });
  kb.push(...chunkRows(levelBtns, 2));
  const noLevel = all.filter((b) => levelOfBook(b) === "").length;
  if (noLevel > 0) kb.push([{ text: `🗂 بدون دورهٔ مشخص (${faNum(noLevel)})`, callback_data: `blvl:${NO_LEVEL}` }]);
  kb.push([{ text: `📚 همهٔ کتاب‌ها (${faNum(all.length)})`, callback_data: "ball" }]);
  kb.push([{ text: "🔄 به‌روزرسانی", callback_data: "books" }]);
  if (r.data.canUpload) kb.push([{ text: "➕ افزودن کتاب جدید (PDF)", callback_data: "upnew" }]);

  let text: string;
  if (all.length === 0) {
    text = "📚 <b>کتاب‌خانه هوشمند</b>\n\nهنوز کتابی برای شما ثبت نشده است! 🌱\nبه‌محض افزودن کتاب توسط مدیر یا معلمان، همین‌جا نمایش داده می‌شود.";
    if (r.data.canUpload) text += "\n\n➕ شما می‌توانید همین‌جا اولین کتاب را اضافه کنید — فایل PDF را بفرستید!";
  } else {
    text =
      `📚 <b>کتاب‌خانه هوشمند</b> — ${faNum(all.length)} کتاب\n\n` +
      `🎓 <b>گام ۱ از ۳ — دورهٔ تحصیلی</b> را انتخاب کنید؛\nسپس پایهٔ تحصیلی و درس/نوع کتاب را می‌بینید. اگر فیلتری نمی‌خواهید، «📚 همهٔ کتاب‌ها» را بزنید.`;
  }
  if (opts.hint) text += `\n\n💡 ${esc(opts.hint)}`;
  await deliverScreen(chatId, opts, text, kb);
}

/** گام ۲ — انتخاب پایهٔ تحصیلی (پس از انتخاب دوره) */
async function sendLibraryGrades(
  chatId: number,
  from: TgUser,
  levelCode: string, // "" = کتاب‌های بدون دورهٔ مشخص
  opts: { messageId?: number; fresh?: boolean } = {}
): Promise<void> {
  await chatAction(chatId, "typing");
  const meta = LEVELS_FA.find((l) => l.code === levelCode);
  const levelLabel = levelCode === "" ? "بدون دورهٔ مشخص" : (meta?.label ?? levelCode);
  const emoji = meta?.emoji ?? "🗂";

  const r = await fetchLibrary(chatId, from, opts);
  if (r === "unlinked") return void (await promptLink(chatId));
  if (!r.ok) return void (await deliverScreen(chatId, opts, r.text, [[{ text: "🔄 تلاش دوباره", callback_data: `blvl:${levelCode === "" ? NO_LEVEL : levelCode}` }]]));

  const all = (r.data.books ?? []).filter((b) => levelOfBook(b) === levelCode);
  if (all.length === 0) {
    const kb: InlineKeyboard = [[{ text: "🔙 بازگشت به دوره‌ها", callback_data: "books" }]];
    if (r.data.canUpload) kb.push([{ text: "➕ افزودن کتاب جدید (PDF)", callback_data: "upnew" }]);
    return void (await deliverScreen(
      chatId,
      opts,
      `${emoji} <b>${esc(levelLabel)}</b>\n\nکتابی در این دوره ثبت نشده است! 🌱\nدورهٔ دیگری را انتخاب کنید یا بعداً سر بزنید.`,
      kb
    ));
  }

  const grades = deriveGrades(all, levelCode);
  const s = chatSessions.get(chatId);
  if (s) s.browse = { level: levelCode, grade: null, gradeIdx: -1, subject: null, subjectIdx: -1, grades, subjects: [] };

  const kb: InlineKeyboard = [];
  const gradeBtns = grades.map((g, i) => ({
    text: `${gradeFa(levelCode, g)} (${faNum(all.filter((b) => gradeOfBook(b) === g).length)})`,
    callback_data: `bgrd:${i}`,
  }));
  kb.push(...chunkRows(gradeBtns, 2));
  kb.push([{ text: `✨ همهٔ پایه‌ها (${faNum(all.length)})`, callback_data: "bgrd:-1" }]);
  kb.push([{ text: "🔄 به‌روزرسانی", callback_data: `blvl:${levelCode === "" ? NO_LEVEL : levelCode}` }]);
  kb.push([{ text: "🔙 تغییر دوره", callback_data: "books" }]);

  await deliverScreen(
    chatId,
    opts,
    `${emoji} <b>${esc(levelLabel)}</b> — ${faNum(all.length)} کتاب\n\n🎓 <b>گام ۲ از ۳ — پایهٔ تحصیلی</b> را انتخاب کنید 👇`,
    kb
  );
}

/** گام ۳ — انتخاب درس/نوع کتاب (پس از انتخاب پایه) */
async function sendLibrarySubjects(
  chatId: number,
  from: TgUser,
  gradeIdx: number,
  opts: { messageId?: number; fresh?: boolean } = {}
): Promise<void> {
  const s = chatSessions.get(chatId);
  const browse = s?.browse ?? null;
  if (!browse || browse.level === null || !browse.grades.length) {
    // نشست منقضی (مثلاً ری‌استارت بات) — از ابتدا شروع می‌کنیم
    return void (await sendLibraryRoot(chatId, from, { messageId: opts.messageId, fresh: true }));
  }
  const level = browse.level;
  const meta = LEVELS_FA.find((l) => l.code === level);
  const levelLabel = level === "" ? "بدون دورهٔ مشخص" : (meta?.label ?? level);
  const emoji = meta?.emoji ?? "🗂";
  const grade = gradeIdx >= 0 && gradeIdx < browse.grades.length ? browse.grades[gradeIdx] : null;

  await chatAction(chatId, "typing");
  const r = await fetchLibrary(chatId, from, opts);
  if (r === "unlinked") return void (await promptLink(chatId));
  if (!r.ok) return void (await deliverScreen(chatId, opts, r.text, [[{ text: "🔄 تلاش دوباره", callback_data: `bgrd:${gradeIdx}` }]]));

  let all = (r.data.books ?? []).filter((b) => levelOfBook(b) === level);
  if (grade !== null) all = all.filter((b) => gradeOfBook(b) === grade);

  if (all.length === 0) {
    const kb: InlineKeyboard = [
      [{ text: "🔙 تغییر پایه", callback_data: `blvl:${level === "" ? NO_LEVEL : level}` }],
      [{ text: "🏫 دوره‌ها", callback_data: "books" }],
    ];
    return void (await deliverScreen(
      chatId,
      opts,
      `${emoji} <b>${esc(levelLabel)}</b>\n\nکتابی برای این پایه پیدا نشد! 🌱\nپایهٔ دیگری را انتخاب کنید.`,
      kb
    ));
  }

  const subjects = deriveSubjects(all);
  if (s?.browse) {
    s.browse.grade = grade;
    s.browse.gradeIdx = grade !== null ? gradeIdx : -1;
    s.browse.subject = null;
    s.browse.subjectIdx = -1;
    s.browse.subjects = subjects;
  }

  const kb: InlineKeyboard = [];
  const subBtns = subjects.map((sub, i) => ({
    text: `${subjectFa(sub)} (${faNum(all.filter((b) => subjectOfBook(b) === sub).length)})`,
    callback_data: `bsub:${i}`,
  }));
  kb.push(...chunkRows(subBtns, 2));
  kb.push([{ text: `✨ همهٔ درس‌ها (${faNum(all.length)})`, callback_data: "bsub:-1" }]);
  kb.push([{ text: "🔄 به‌روزرسانی", callback_data: `bgrd:${gradeIdx}` }]);
  kb.push([
    { text: "🔙 تغییر پایه", callback_data: `blvl:${level === "" ? NO_LEVEL : level}` },
    { text: "🏫 دوره‌ها", callback_data: "books" },
  ]);

  const crumb = [levelLabel, grade !== null ? gradeFa(level, grade) : "همهٔ پایه‌ها"];
  await deliverScreen(
    chatId,
    opts,
    `${emoji} <b>${esc(crumb.join(" · "))}</b> — ${faNum(all.length)} کتاب\n\n📕 <b>گام ۳ از ۳ — درس/نوع کتاب</b> را انتخاب کنید 👇`,
    kb
  );
}

/** فهرست نهایی کتاب‌ها — فیلترشده با مسیر انتخاب‌شده (یا «همهٔ کتاب‌ها») */
async function sendLibraryList(
  chatId: number,
  from: TgUser,
  subjectIdx: number | null, // null = همهٔ درس‌ها / مسیر «همهٔ کتاب‌ها»
  opts: { messageId?: number; fresh?: boolean } = {}
): Promise<void> {
  const s = chatSessions.get(chatId);
  const browse = s?.browse ?? null;
  // اندیس صریح اما نشست/فهرست نامعتبر (ری‌استارت یا تغییر داده) → از ابتدا
  if (
    subjectIdx !== null &&
    (!browse || browse.level === null || (subjectIdx >= 0 && (subjectIdx >= browse.subjects.length || !browse.subjects.length)))
  ) {
    return void (await sendLibraryRoot(chatId, from, { messageId: opts.messageId, fresh: true }));
  }

  await chatAction(chatId, "typing");
  const r = await fetchLibrary(chatId, from, opts);
  if (r === "unlinked") return void (await promptLink(chatId));
  if (!r.ok) {
    return void (await deliverScreen(chatId, opts, r.text, [[{ text: "🔄 تلاش دوباره", callback_data: "books" }]]));
  }

  let all = r.data.books ?? [];
  const crumb: string[] = [];
  if (browse && browse.level !== null) {
    const level = browse.level;
    const meta = LEVELS_FA.find((l) => l.code === level);
    crumb.push(level === "" ? "بدون دورهٔ مشخص" : (meta?.label ?? level));
    all = all.filter((b) => levelOfBook(b) === level);
    if (browse.grade !== null) {
      crumb.push(gradeFa(level, browse.grade));
      all = all.filter((b) => gradeOfBook(b) === browse.grade);
    }
    if (subjectIdx !== null) {
      const subj = subjectIdx >= 0 ? browse.subjects[subjectIdx] : null;
      if (s?.browse) s.browse.subjectIdx = subjectIdx;
      if (subj !== null) {
        crumb.push(subjectFa(subj));
        all = all.filter((b) => subjectOfBook(b) === subj);
      }
    }
  }

  const shown = all.slice(0, BOOKS_PAGE_LIMIT);
  const showGradeSuffix = browse?.grade == null; // در «همهٔ پایه‌ها» پایه کنار عنوان می‌آید
  const kb: InlineKeyboard = shown.map((b) => [
    {
      text: trunc(
        `${bookStatusEmoji(b.status)} ${b.title}${showGradeSuffix && b.gradeLevel ? ` — ${gradeFa(b.level, b.gradeLevel)}` : ""}`,
        58
      ),
      callback_data: `book:${b.id}`,
    },
  ]);

  if (browse && browse.level !== null) {
    kb.push([{ text: "🔙 تغییر درس", callback_data: `bgrd:${browse.gradeIdx}` }]);
    kb.push([
      { text: "🔙 تغییر پایه", callback_data: `blvl:${browse.level === "" ? NO_LEVEL : browse.level}` },
      { text: "🏫 دوره‌ها", callback_data: "books" },
    ]);
    kb.push([{ text: "🔄 به‌روزرسانی", callback_data: `bsub:${browse.subjectIdx}` }]);
  } else {
    kb.push([{ text: "🔙 منوی دوره‌ها", callback_data: "books" }]);
    kb.push([{ text: "🔄 به‌روزرسانی", callback_data: "ball" }]);
  }
  if (r.data.canUpload) kb.push([{ text: "➕ افزودن کتاب جدید (PDF)", callback_data: "upnew" }]);

  const title = crumb.length > 0 ? `📚 <b>${esc(crumb.join(" · "))}</b>` : "📚 <b>همهٔ کتاب‌ها</b>";
  let text: string;
  if (all.length === 0) {
    text = `${title}\n\nکتابی مطابق این انتخاب پیدا نشد! 🌱\nفیلتر دیگری را امتحان کنید.`;
  } else {
    text = `${title}\n\n${faNum(all.length)} کتاب — برای جزئیات، روی عنوان کتاب بزنید 👇`;
    if (all.length > shown.length) text += `\n(و ${faNum(all.length - shown.length)} کتاب دیگر… از نسخهٔ وب)`;
  }
  await deliverScreen(chatId, opts, text, kb);
}

function bestAttempt(
  attempts: BookDetail["myAttempts"]
): { score: number; maxScore: number } | null {
  let best: { score: number; maxScore: number } | null = null;
  for (const a of attempts ?? []) {
    if (!best || a.score > best.score) best = { score: a.score, maxScore: a.maxScore };
  }
  return best;
}

async function sendBookCard(
  chatId: number,
  from: TgUser,
  bookId: string,
  opts: { messageId?: number } = {}
): Promise<void> {
  await chatAction(chatId, "typing");
  const res = await authed(chatId, from, `/api/v1/books/${encodeURIComponent(bookId)}`);
  if (res === "unlinked") return void (await promptLink(chatId));
  if (!res || !res.ok) {
    const msg = apiErrorText(await readJson(res));
    const text = `⚠️ ${esc(msg)}`;
    const kb: InlineKeyboard = [[{ text: "🔙 بازگشت به کتاب‌ها", callback_data: "books" }]];
    if (opts.messageId) return void (await editMessage(chatId, opts.messageId, text, kb));
    return void (await sendMessage(chatId, text, kb));
  }
  const b = await readJson<BookDetail>(res);
  if (!b) {
    if (opts.messageId) return void (await editMessage(chatId, opts.messageId, NET_ERR));
    return void (await sendMessage(chatId, NET_ERR));
  }

  const lines: string[] = [];
  lines.push(`${b.coverEmoji || "📘"} <b>${esc(b.title)}</b>`);
  const structure = structureLineFa(b);
  if (structure) lines.push(`🎓 ${esc(structure)}`);
  const meta: string[] = [];
  if (b.author) meta.push(`✍️ ${esc(b.author)}`);
  if (meta.length) lines.push(meta.join(" · "));
  if (b.description) lines.push("", `«${esc(trunc(b.description, 220))}»`);
  lines.push("", "📊 <b>محتواهای هوشمند:</b>");
  lines.push(`📄 خلاصه: ${statusFa(b.summaryStatus)}`);
  lines.push(`📒 جزوه: ${statusFa(b.studyNotesStatus)}`);
  lines.push(
    `✍️ نمونه‌سؤال: ${b.quizStatus === "READY" ? `✅ (${faNum(b.quizCount)} سؤال)` : statusFa(b.quizStatus)}`
  );
  lines.push(
    `🖼 شکل‌های آموزشی: ${
      b.figuresStatus === "READY" ? (b.figuresCount && b.figuresCount > 0 ? `✅ (${faNum(b.figuresCount)} شکل)` : "— (این کتاب شکل لازم ندارد)") : statusFa(b.figuresStatus)
    }`
  );
  lines.push(
    `🎧 پادکست: ${
      b.podcastStatus === "READY" && b.podcastDurationSec
        ? `✅ (${durationFa(b.podcastDurationSec)})`
        : statusFa(b.podcastStatus)
    }`
  );
  // راند ۲۳ — ذخیره‌سازی کامل در تلگرام: اگر فایل‌های کتاب داخل تلگرام نگهداری می‌شوند
  if (b.telegramFiles && Object.keys(b.telegramFiles).length > 0) {
    lines.push(`☁️ ${esc("ذخیره‌سازی: تلگرام")}`);
  }
  const best = bestAttempt(b.myAttempts);
  if (best) {
    lines.push("", `🏆 بهترین رکورد شما: ${faNum(best.score)} از ${faNum(best.maxScore)} (${faNum(b.myAttempts.length)} تلاش)`);
  }
  lines.push("", "💡 شکل‌های آموزشی را در نسخهٔ وب/مینی‌اپ کتاب ببینید.");

  const kb: InlineKeyboard = [
    [{ text: "📄 خلاصه (PDF)", callback_data: `sum:${b.id}` }],
    [{ text: "📒 جزوه (PDF)", callback_data: `notes:${b.id}` }],
    [{ text: "🎧 پادکست", callback_data: `pod:${b.id}` }],
    [{ text: "✍️ شروع آزمون", callback_data: `quiz:${b.id}` }],
  ];
  // راند ۲۲ — برگهٔ رسمی نمونه‌سؤال به‌صورت PDF (فقط وقتی سؤال‌ها آماده‌اند)
  if (b.quizStatus === "READY") {
    kb.push([{ text: "✍️ نمونه‌سؤال (PDF)", callback_data: `quizpdf:${b.id}` }]);
  }
  if ((b as BookDetailEx).hasOriginalPdf) {
    kb.splice(2, 0, [{ text: "📥 کتاب اصلی (PDF)", callback_data: `orig:${b.id}` }]);
  }
  kb.push([{ text: "🔙 بازگشت", callback_data: "books" }]);
  const text = lines.join("\n");
  if (opts.messageId) await editMessage(chatId, opts.messageId, text, kb);
  else await sendMessage(chatId, text, kb);
}

// ─────────────────────────────── خلاصه (متن + PDF فارسی — round 18/22) ───────────────────────────────

async function sendSummary(chatId: number, from: TgUser, bookId: string): Promise<void> {
  await chatAction(chatId, "typing");
  const res = await authed(chatId, from, `/api/v1/books/${encodeURIComponent(bookId)}`);
  if (res === "unlinked") return void (await promptLink(chatId));
  if (!res || !res.ok) return void (await sendMessage(chatId, `⚠️ ${esc(apiErrorText(await readJson(res)))}`));
  const b = await readJson<BookDetail>(res);
  if (!b) return void (await sendMessage(chatId, NET_ERR));
  if (b.summaryStatus !== "READY" || !b.summary) {
    return void (await sendMessage(
      chatId,
      `📄 خلاصهٔ این کتاب هنوز آماده نشده است.\n${statusFa(b.summaryStatus)} — کمی بعد دوباره تلاش کنید. 🙏`
    ));
  }

  const html = mdToTgHtml(b.summary);
  const chunks = splitMessage(html);
  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    const prefix = i === 0 ? `📄 <b>خلاصهٔ کتاب «${esc(b.title)}»</b>\n\n` : "…ادامهٔ خلاصه\n\n";
    let text = prefix + chunks[i];
    let kb: InlineKeyboard | undefined;
    if (isLast) {
      text += "\n\n💡 نسخهٔ PDF با فونت فارسی (وزیرمتن) هم از دکمهٔ زیر قابل دریافت است.";
      kb = [[{ text: "📄 دریافت فایل PDF", callback_data: `docx:${b.id}` }]];
    }
    await sendMessage(chatId, text, kb);
    if (!isLast) await sleep(350);
  }
}

async function sendDocx(chatId: number, from: TgUser, bookId: string): Promise<void> {
  await chatAction(chatId, "upload_document");
  // عنوان و وضعیت کتاب
  const dres = await authed(chatId, from, `/api/v1/books/${encodeURIComponent(bookId)}`);
  if (dres === "unlinked") return void (await promptLink(chatId));
  const b = dres && dres.ok ? await readJson<BookDetail>(dres) : null;
  if (!b || b.summaryStatus !== "READY") {
    return void (await sendMessage(chatId, "📄 خلاصهٔ این کتاب هنوز آماده نشده است."));
  }
  // راند ۲۳ — مسیر فوری: PDF خلاصه از قبل در تلگرام ذخیره شده → ارسال مستقیم با file_id دائمی
  // (نام فایل فارسی همان نام ذخیره‌شده در تلگرام است؛ file_name در ارسال file_id نادیده گرفته می‌شود)
  const tgFid = tgFileId(b, "SUMMARY_PDF");
  if (tgFid) {
    const sent = await safeTg<TgMessage>("sendDocument", {
      chat_id: chatId,
      document: tgFid,
      caption: `📄 خلاصهٔ هوشمند کتاب «${trunc(b.title, 80)}» — PDF با فونت فارسی (وزیرمتن)`,
    });
    if (sent) return;
    // ارسال file_id ناموفق بود → ادامه با مسیر بایت‌های زیر (fallback)
  }
  // راند ۲۲ — خلاصه به‌صورت PDF فارسی (فونت وزیرمتن جاسازی‌شده؛ Chromium سمت سرور → مهلت بلند)
  const res = await authed(chatId, from, `/api/v1/books/${encodeURIComponent(bookId)}/summary.pdf`, undefined, 110_000);
  if (res === "unlinked") return void (await promptLink(chatId));
  if (!res || !res.ok) return void (await sendMessage(chatId, `⚠️ ${esc(apiErrorText(await readJson(res)))}`));
  const buf = await readArrayBuffer(res, 100_000);
  if (!buf || buf.byteLength === 0) return void (await sendMessage(chatId, NET_ERR));
  if (buf.byteLength > 49 * 1024 * 1024) {
    return void (await sendMessage(chatId, "⚠️ حجم فایل برای ارسال در تلگرام زیاد است — لطفاً از نسخهٔ وب دانلود کنید."));
  }

  const fd = new FormData();
  fd.append("chat_id", String(chatId));
  fd.append("document", new Blob([buf], { type: "application/pdf" }), fileNameFromResponse(res, `${safeFilename(b.title)}.pdf`));
  fd.append("caption", `📄 خلاصهٔ هوشمند کتاب «${trunc(b.title, 80)}» — PDF با فونت فارسی (وزیرمتن)`);
  const sent = await safeTg<TgMessage>("sendDocument", undefined, { multipart: fd, timeoutMs: 120_000 });
  if (!sent) await sendMessage(chatId, "⚠️ ارسال فایل ناموفق بود، دوباره تلاش کنید.");
}

// ─────────────────────────────── جزوهٔ شبامتحان (متن + PDF — round 18/22) ───────────────────────────────

async function sendNotes(chatId: number, from: TgUser, bookId: string): Promise<void> {
  await chatAction(chatId, "typing");
  const res = await authed(chatId, from, `/api/v1/books/${encodeURIComponent(bookId)}`);
  if (res === "unlinked") return void (await promptLink(chatId));
  if (!res || !res.ok) return void (await sendMessage(chatId, `⚠️ ${esc(apiErrorText(await readJson(res)))}`));
  const b = await readJson<BookDetail>(res);
  if (!b) return void (await sendMessage(chatId, NET_ERR));
  if (b.studyNotesStatus !== "READY" || !b.studyNotes) {
    return void (await sendMessage(
      chatId,
      `📒 جزوهٔ این کتاب هنوز آماده نشده است.\n${statusFa(b.studyNotesStatus)} — کمی بعد دوباره تلاش کنید. 🙏`
    ));
  }

  const html = mdToTgHtml(b.studyNotes);
  const chunks = splitMessage(html);
  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    const prefix = i === 0 ? `📒 <b>جزوهٔ شبامتحان «${esc(b.title)}»</b>\n\n` : "…ادامهٔ جزوه\n\n";
    let text = prefix + chunks[i];
    let kb: InlineKeyboard | undefined;
    if (isLast) {
      text += "\n\n💡 تعاریف، فرمول‌ها و نکات کنکوری — نسخهٔ PDF با فونت فارسی (وزیرمتن) از دکمهٔ زیر قابل دریافت است.";
      kb = [[{ text: "📒 دریافت فایل PDF جزوه", callback_data: `notesdocx:${b.id}` }]];
    }
    await sendMessage(chatId, text, kb);
    if (!isLast) await sleep(350);
  }
}

async function sendNotesDocx(chatId: number, from: TgUser, bookId: string): Promise<void> {
  await chatAction(chatId, "upload_document");
  const dres = await authed(chatId, from, `/api/v1/books/${encodeURIComponent(bookId)}`);
  if (dres === "unlinked") return void (await promptLink(chatId));
  const b = dres && dres.ok ? await readJson<BookDetail>(dres) : null;
  if (!b || b.studyNotesStatus !== "READY") {
    return void (await sendMessage(chatId, "📒 جزوهٔ این کتاب هنوز آماده نشده است."));
  }
  // راند ۲۳ — مسیر فوری: PDF جزوه از قبل در تلگرام ذخیره شده → ارسال مستقیم با file_id دائمی
  const tgFid = tgFileId(b, "NOTES_PDF");
  if (tgFid) {
    const sent = await safeTg<TgMessage>("sendDocument", {
      chat_id: chatId,
      document: tgFid,
      caption: `📒 جزوهٔ شبامتحان کتاب «${trunc(b.title, 80)}» — PDF با فونت فارسی (وزیرمتن)`,
    });
    if (sent) return;
    // ارسال file_id ناموفق بود → ادامه با مسیر بایت‌های زیر (fallback)
  }
  // راند ۲۲ — جزوه به‌صورت PDF فارسی (فونت وزیرمتن جاسازی‌شده)
  const res = await authed(chatId, from, `/api/v1/books/${encodeURIComponent(bookId)}/notes.pdf`, undefined, 110_000);
  if (res === "unlinked") return void (await promptLink(chatId));
  if (!res || !res.ok) return void (await sendMessage(chatId, `⚠️ ${esc(apiErrorText(await readJson(res)))}`));
  const buf = await readArrayBuffer(res, 100_000);
  if (!buf || buf.byteLength === 0) return void (await sendMessage(chatId, NET_ERR));
  if (buf.byteLength > 49 * 1024 * 1024) {
    return void (await sendMessage(chatId, "⚠️ حجم فایل برای ارسال در تلگرام زیاد است — لطفاً از نسخهٔ وب دانلود کنید."));
  }

  const fd = new FormData();
  fd.append("chat_id", String(chatId));
  fd.append("document", new Blob([buf], { type: "application/pdf" }), fileNameFromResponse(res, `jozve-${safeFilename(b.title)}.pdf`));
  fd.append("caption", `📒 جزوهٔ شبامتحان کتاب «${trunc(b.title, 80)}» — PDF با فونت فارسی (وزیرمتن)`);
  const sent = await safeTg<TgMessage>("sendDocument", undefined, { multipart: fd, timeoutMs: 120_000 });
  if (!sent) await sendMessage(chatId, "⚠️ ارسال فایل ناموفق بود، دوباره تلاش کنید.");
}

// ─────────────────────────────── پادکست (WAV) ───────────────────────────────

async function sendPodcast(chatId: number, from: TgUser, bookId: string, opts: { forSaved?: boolean } = {}): Promise<void> {
  await chatAction(chatId, "upload_voice");
  const dres = await authed(chatId, from, `/api/v1/books/${encodeURIComponent(bookId)}`);
  if (dres === "unlinked") return void (await promptLink(chatId));
  const b = dres && dres.ok ? await readJson<BookDetail>(dres) : null;
  if (!b || b.podcastStatus !== "READY") {
    return void (await sendMessage(
      chatId,
      `🎧 پادکست این کتاب هنوز تولید نشده است.\n${statusFa(b?.podcastStatus)} — کمی بعد دوباره تلاش کنید. 🙏`
    ));
  }
  // راند ۲۲ — دکمهٔ «ذخیره در پیام‌های ذخیره» زیر پادکست (نسخهٔ ذخیره: بدون دکمه + پیشوند 📌)
  // راند ۲۳ — کپشن/دکمه مشترک بین مسیر فوری (file_id) و مسیر بایت‌ها
  const caption = opts.forSaved
    ? `📌 ذخیره‌شده از پلتفرم آموزش هوشمند — 🎧 پادکست صوتی کتاب «${trunc(b.title, 80)}»${
        b.podcastDurationSec ? ` — ${durationFa(b.podcastDurationSec)}` : ""
      }\nشنیدن شما خوش! 🎶`
    : `🎧 پادکست صوتی کتاب «${trunc(b.title, 80)}»${
        b.podcastDurationSec ? ` — ${durationFa(b.podcastDurationSec)}` : ""
      }\nشنیدن شما خوش! 🎶\nبرای نگه‌داشتن در تلگرام، دکمهٔ ذخیره را بزنید. 📥`;
  const markup = opts.forSaved
    ? undefined
    : { inline_keyboard: [[{ text: "📥 ذخیره در پیام‌های ذخیره", callback_data: `podsave:${bookId}` }]] };
  // راند ۲۳ — مسیر فوری: پادکست از قبل در تلگرام ذخیره شده → ارسال مستقیم با file_id دائمی
  // (title/performer/duration در ارسال file_id توسط تلگرام نادیده گرفته می‌شوند — مشکلی نیست)
  const tgFid = tgFileId(b, "PODCAST_AUDIO");
  if (tgFid) {
    const sent = await safeTg<TgMessage>("sendAudio", {
      chat_id: chatId,
      audio: tgFid,
      caption,
      ...(markup ? { reply_markup: markup } : {}),
    });
    if (sent) return;
    // ارسال file_id ناموفق بود → ادامه با مسیر بایت‌های زیر (fallback)
  }
  const res = await authed(chatId, from, `/api/v1/books/${encodeURIComponent(bookId)}/podcast`, undefined, 120_000);
  if (res === "unlinked") return void (await promptLink(chatId));
  if (!res || !res.ok) return void (await sendMessage(chatId, `⚠️ ${esc(apiErrorText(await readJson(res)))}`));
  const buf = await readArrayBuffer(res, 110_000);
  if (!buf || buf.byteLength === 0) return void (await sendMessage(chatId, NET_ERR));
  if (buf.byteLength > 49 * 1024 * 1024) {
    return void (await sendMessage(chatId, "⚠️ فایل صوتی برای تلگرام بزرگ است — لطفاً از نسخهٔ وب دانلود کنید."));
  }

  const fd = new FormData();
  fd.append("chat_id", String(chatId));
  fd.append("audio", new Blob([buf], { type: "audio/wav" }), `${safeFilename(b.title)}.wav`);
  fd.append("title", trunc(`پادکست کتاب ${b.title}`, 64));
  fd.append("performer", "پلتفرم آموزش هوشمند");
  fd.append("caption", caption);
  if (b.podcastDurationSec) fd.append("duration", String(Math.round(b.podcastDurationSec)));
  if (markup) fd.append("reply_markup", JSON.stringify(markup));
  const sent = await safeTg<TgMessage>("sendAudio", undefined, { multipart: fd, timeoutMs: 120_000 });
  if (!sent) await sendMessage(chatId, "⚠️ ارسال پادکست ناموفق بود، دوباره تلاش کنید.");
}

// ─────────────────────────────── کتاب اصلی PDF (round 20) ───────────────────────────────

async function sendOriginalPdf(chatId: number, from: TgUser, bookId: string, opts: { forSaved?: boolean } = {}): Promise<void> {
  await chatAction(chatId, "upload_document");
  const dres = await authed(chatId, from, `/api/v1/books/${encodeURIComponent(bookId)}`);
  if (dres === "unlinked") return void (await promptLink(chatId));
  const b = dres && dres.ok ? await readJson<BookDetailEx>(dres) : null;
  if (!b || !b.hasOriginalPdf) {
    return void (await sendMessage(chatId, "📥 نسخهٔ اصلی (PDF) برای این کتاب ضمیمه نشده است."));
  }
  // راند ۲۲ — دکمهٔ «ذخیره در پیام‌های ذخیره» زیر فایل (نسخهٔ ذخیره: بدون دکمه)
  // راند ۲۳ — کپشن/دکمه مشترک بین مسیر فوری (file_id) و مسیر بایت‌ها
  const caption = opts.forSaved
    ? `📌 ذخیره‌شده از پلتفرم آموزش هوشمند — 📥 نسخهٔ اصلی کتاب «${trunc(b.title, 80)}»`
    : `📥 نسخهٔ اصلی کتاب «${trunc(b.title, 80)}» — پلتفرم آموزش هوشمند ایران 🎓\nبرای نگه‌داشتن در تلگرام، دکمهٔ ذخیره را بزنید. 📥`;
  const markup = opts.forSaved
    ? undefined
    : { inline_keyboard: [[{ text: "📥 ذخیره در پیام‌های ذخیره", callback_data: `origsave:${bookId}` }]] };
  // راند ۲۳ — مسیر فوری: PDF اصلی از قبل در تلگرام ذخیره شده → ارسال مستقیم با file_id دائمی
  const tgFid = tgFileId(b, "ORIGINAL_PDF");
  if (tgFid) {
    const sent = await safeTg<TgMessage>("sendDocument", {
      chat_id: chatId,
      document: tgFid,
      caption,
      ...(markup ? { reply_markup: markup } : {}),
    });
    if (sent) return;
    // ارسال file_id ناموفق بود → ادامه با مسیر بایت‌های زیر (fallback)
  }
  const res = await authed(chatId, from, `/api/v1/books/${encodeURIComponent(bookId)}/original.pdf`, undefined, 90_000);
  if (res === "unlinked") return void (await promptLink(chatId));
  if (!res || !res.ok) return void (await sendMessage(chatId, `⚠️ ${esc(apiErrorText(await readJson(res)))}`));
  const buf = await readArrayBuffer(res, 90_000);
  if (!buf || buf.byteLength === 0) return void (await sendMessage(chatId, NET_ERR));
  if (buf.byteLength > 49 * 1024 * 1024) {
    return void (await sendMessage(chatId, "⚠️ حجم فایل برای ارسال در تلگرام زیاد است — لطفاً از نسخهٔ وب دانلود کنید."));
  }

  // نام فایل فارسی از Content-Disposition — در صورت نبود، از عنوان کتاب
  const fname = fileNameFromResponse(res, `${safeFilename(b.title)}.pdf`);

  const fd = new FormData();
  fd.append("chat_id", String(chatId));
  fd.append("document", new Blob([buf], { type: "application/pdf" }), fname);
  fd.append("caption", caption);
  if (markup) fd.append("reply_markup", JSON.stringify(markup));
  const sent = await safeTg<TgMessage>("sendDocument", undefined, { multipart: fd, timeoutMs: 120_000 });
  if (!sent) await sendMessage(chatId, "⚠️ ارسال فایل ناموفق بود، دوباره تلاش کنید.");
}

// ─────────────────────────────── نمونه‌سؤال PDF (راند ۲۲) ───────────────────────────────

/** برگهٔ رسمی نمونه‌سؤال (۴ گزینه‌ای) + پاسخ‌نامهٔ تشریحی — PDF با فونت فارسی (وزیرمتن) */
async function sendQuizPdf(chatId: number, from: TgUser, bookId: string): Promise<void> {
  await chatAction(chatId, "upload_document");
  // وضعیت کتاب — سؤال‌ها باید READY باشند (مثل sendPodcast جزئیات را اول می‌خوانیم)
  const dres = await authed(chatId, from, `/api/v1/books/${encodeURIComponent(bookId)}`);
  if (dres === "unlinked") return void (await promptLink(chatId));
  const b = dres && dres.ok ? await readJson<BookDetail>(dres) : null;
  if (!b) return void (await sendMessage(chatId, NET_ERR));
  if (b.quizStatus !== "READY") {
    return void (await sendMessage(
      chatId,
      `✍️ نمونه‌سؤال‌های این کتاب هنوز آماده نشده است.\n${statusFa(b.quizStatus)} — کمی بعد دوباره تلاش کنید. 🙏`
    ));
  }
  // راند ۲۳ — مسیر فوری: برگهٔ نمونه‌سؤال (MC) از قبل در تلگرام ذخیره شده → ارسال مستقیم با file_id
  // (مدل‌های دیگر TF/FB/SHORT/MIXED ممکن است هنوز کش نشده باشند → همان مسیر بایت‌ها)
  const tgFid = tgFileId(b, "QUIZ_PDF_MC");
  if (tgFid) {
    const sent = await safeTg<TgMessage>("sendDocument", {
      chat_id: chatId,
      document: tgFid,
      caption: `✍️ نمونه‌سؤال هوشمند کتاب «${trunc(b.title, 80)}» — برگهٔ رسمی آزمون (۴ گزینه‌ای) + پاسخ‌نامهٔ تشریحی · PDF با فونت فارسی`,
    });
    if (sent) return;
    // ارسال file_id ناموفق بود → ادامه با مسیر بایت‌های زیر (fallback)
  }
  const res = await authed(chatId, from, `/api/v1/books/${encodeURIComponent(bookId)}/quiz.pdf?model=MC`, undefined, 110_000);
  if (res === "unlinked") return void (await promptLink(chatId));
  if (!res || !res.ok) return void (await sendMessage(chatId, `⚠️ ${esc(apiErrorText(await readJson(res)))}`));
  const buf = await readArrayBuffer(res, 100_000);
  if (!buf || buf.byteLength === 0) return void (await sendMessage(chatId, NET_ERR));
  if (buf.byteLength > 49 * 1024 * 1024) {
    return void (await sendMessage(chatId, "⚠️ حجم فایل برای ارسال در تلگرام زیاد است — لطفاً از نسخهٔ وب دانلود کنید."));
  }

  const fd = new FormData();
  fd.append("chat_id", String(chatId));
  fd.append("document", new Blob([buf], { type: "application/pdf" }), fileNameFromResponse(res, `azmoon-${safeFilename(b.title)}.pdf`));
  fd.append(
    "caption",
    `✍️ نمونه‌سؤال هوشمند کتاب «${trunc(b.title, 80)}» — برگهٔ رسمی آزمون (۴ گزینه‌ای) + پاسخ‌نامهٔ تشریحی · PDF با فونت فارسی`
  );
  const sent = await safeTg<TgMessage>("sendDocument", undefined, { multipart: fd, timeoutMs: 120_000 });
  if (!sent) await sendMessage(chatId, "⚠️ ارسال فایل ناموفق بود، دوباره تلاش کنید.");
}

// ─────────────────────────────── آزمون تعاملی ───────────────────────────────

async function sendQuizPicker(chatId: number, from: TgUser, bookId: string, messageId?: number): Promise<void> {
  await chatAction(chatId, "typing");
  const res = await authed(chatId, from, `/api/v1/books/${encodeURIComponent(bookId)}`);
  if (res === "unlinked") return void (await promptLink(chatId));
  if (!res || !res.ok) {
    const msg = `⚠️ ${esc(apiErrorText(await readJson(res)))}`;
    if (messageId) return void (await editMessage(chatId, messageId, msg));
    return void (await sendMessage(chatId, msg));
  }
  const b = await readJson<BookDetail>(res);
  if (!b) {
    if (messageId) return void (await editMessage(chatId, messageId, NET_ERR));
    return void (await sendMessage(chatId, NET_ERR));
  }
  if (b.quizStatus !== "READY") {
    const text = `✍️ نمونه‌سؤال‌های این کتاب هنوز آماده نشده است.\n${statusFa(b.quizStatus)} — کمی بعد دوباره سر بزنید. 🙏`;
    const kb: InlineKeyboard = [[{ text: "🔙 بازگشت", callback_data: `book:${b.id}` }]];
    if (messageId) return void (await editMessage(chatId, messageId, text, kb));
    return void (await sendMessage(chatId, text, kb));
  }

  const counts: Record<string, number> = { mc: 0, tf: 0, fb: 0, short: 0 };
  for (const m of b.quizModels ?? []) counts[m.kind] = m.count;
  const mixedCount = counts.mc + counts.tf + counts.fb;
  const text =
    `✍️ <b>آزمون نمونه — «${esc(b.title)}»</b>\n\n` +
    `مدل آزمون را انتخاب کنید:\n\n` +
    `🎯 چهارگزینه‌ای (${faNum(counts.mc)} سؤال)\n` +
    `✅ درست/غلط (${faNum(counts.tf)} سؤال)\n` +
    (counts.fb > 0 ? `✏️ جای خالی (${faNum(counts.fb)} سؤال)\n` : "") +
    `🔀 ترکیبی (${faNum(mixedCount)} سؤال)\n` +
    `✍️ تشریحی (${faNum(counts.short)} سؤال)\n\n` +
    `💡 نمرهٔ بهتر = امتیاز بیشتر! ⭐`;
  const kb: InlineKeyboard = [
    [{ text: "🎯 چهارگزینه‌ای", callback_data: `qz:${b.id}:MC` }],
    [{ text: "✅ درست/غلط", callback_data: `qz:${b.id}:TF` }],
  ];
  if (counts.fb > 0) kb.push([{ text: "✏️ جای خالی", callback_data: `qz:${b.id}:FB` }]);
  kb.push(
    [{ text: "🔀 ترکیبی", callback_data: `qz:${b.id}:MIXED` }],
    [{ text: "✍️ تشریحی", callback_data: `qz:${b.id}:SHORT` }],
    [{ text: "🔙 بازگشت", callback_data: `book:${b.id}` }]
  );
  if (messageId) await editMessage(chatId, messageId, text, kb);
  else await sendMessage(chatId, text, kb);
}

async function startQuiz(chatId: number, from: TgUser, bookId: string, model: string, cbId?: string): Promise<void> {
  if (model !== "MC" && model !== "TF" && model !== "MIXED" && model !== "FB" && model !== "SHORT") model = "MC";
  await chatAction(chatId, "typing");
  const res = await authed(chatId, from, `/api/v1/books/${encodeURIComponent(bookId)}/quiz?model=${model}`);
  if (res === "unlinked") {
    if (cbId) await answerCb(cbId);
    return void (await promptLink(chatId));
  }
  if (!res || !res.ok) {
    const msg = apiErrorText(await readJson(res));
    if (cbId) await answerCb(cbId, msg);
    return void (await sendMessage(chatId, `⚠️ ${esc(msg)}`));
  }
  const quiz = await readJson<QuizFetch>(res);
  if (!quiz || !Array.isArray(quiz.items) || quiz.items.length === 0) {
    if (cbId) await answerCb(cbId, "سؤالی یافت نشد");
    return void (await sendMessage(chatId, "⚠️ سوالی برای این آزمون یافت نشد."));
  }

  // جایگزینی آزمون فعال قبلی همین چت
  const oldSid = quizByChat.get(chatId);
  if (oldSid) quizSessions.delete(oldSid);

  const sid = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const session: QuizSession = {
    sid,
    chatId,
    tgUser: from,
    bookId: quiz.bookId || bookId,
    bookTitle: quiz.bookTitle || "",
    model: (quiz.model || model) as QuizModel,
    modelLabel: quiz.modelLabel || model,
    items: quiz.items,
    answers: {},
    idx: 0,
    currentMsgId: null,
    shortPending: null,
    lastTouch: Date.now(),
  };
  quizSessions.set(sid, session);
  quizByChat.set(chatId, sid);

  if (cbId) await answerCb(cbId, "آزمون شروع شد — موفق باشی! 🍀");
  await sendMessage(
    chatId,
    `✍️ آزمون «${esc(session.bookTitle)}» — ${esc(session.modelLabel)}\n` +
      `${faNum(quiz.items.length)} سؤال · ${faNum(quiz.maxScore ?? quiz.items.length)} نمره\n` +
      "هرچه بهتر پاسخ بدهی، امتیاز بیشتری می‌گیری ⭐"
  );
  await sendQuizQuestion(session);
}

function questionHeader(session: QuizSession): string {
  return `📝 آزمون «${esc(session.bookTitle)}» — ${esc(session.modelLabel)}\n<b>سؤال ${faNum(session.idx + 1)} از ${faNum(session.items.length)}</b>`;
}

async function sendQuizQuestion(session: QuizSession): Promise<void> {
  const it = session.items[session.idx];
  if (!it) return void (await finishQuiz(session));
  const lines: string[] = [questionHeader(session)];
  if (it.topic) lines.push(`🏷 ${esc(trunc(it.topic, 60))}`);
  lines.push("", esc(trunc(it.prompt, 1600)));

  let kb: InlineKeyboard;
  if (it.kind === "mc") {
    kb = (it.options ?? []).map((opt, i) => [
      { text: trunc(`${FA_LETTERS[i] ?? faNum(i + 1)}) ${opt}`, 60), callback_data: `ans:${session.sid}:${it.id}:${i}` },
    ]);
    kb.push([
      { text: "⏭️ رد کردن", callback_data: `ans:${session.sid}:${it.id}:skip` },
      { text: "🔚 پایان و ثبت", callback_data: `finish:${session.sid}` },
    ]);
  } else if (it.kind === "tf") {
    kb = [
      [
        { text: "✅ صحیح", callback_data: `ans:${session.sid}:${it.id}:true` },
        { text: "❌ غلط", callback_data: `ans:${session.sid}:${it.id}:false` },
      ],
      [
        { text: "⏭️ رد کردن", callback_data: `ans:${session.sid}:${it.id}:skip` },
        { text: "🔚 پایان و ثبت", callback_data: `finish:${session.sid}` },
      ],
    ];
  } else {
    // تشریحی و جای خالی: پاسخ تایپی
    if (it.kind === "fb") {
      lines.push("", "✏️ پاسخ کوتاه جای خالی را همین‌جا تایپ کنید و بفرستید (مثلاً: میتوکندری).");
    } else {
      lines.push("", "✍️ پاسخ خود را همین‌جا تایپ کنید و بفرستید.");
    }
    kb = [[{ text: "🚫 انصراف از آزمون", callback_data: `finish:${session.sid}` }]];
  }

  const msg = await sendMessage(session.chatId, lines.join("\n"), kb);
  session.currentMsgId = msg?.message_id ?? null;
  session.shortPending = it.kind === "short" || it.kind === "fb" ? it.id : null;
  session.lastTouch = Date.now();
}

async function onQuizAnswer(cb: TgCallbackQuery, chatId: number, messageId: number): Promise<void> {
  const parts = (cb.data ?? "").split(":");
  const sid = parts[1] ?? "";
  const itemId = parts[2] ?? "";
  const value = parts.slice(3).join(":");
  const session = quizSessions.get(sid);
  if (!session || session.chatId !== chatId) return void (await answerCb(cb.id, "این آزمون دیگر فعال نیست 🕐"));
  const current = session.items[session.idx];
  if (!current || current.id !== itemId) {
    return void (await answerCb(cb.id, "این سؤال قبلاً پاسخ داده شده ✅"));
  }

  // ثبت پاسخ + برچسب نمایشی
  let label: string;
  if (value === "skip") {
    session.answers[itemId] = "";
    label = "⏭️ رد شد";
  } else if (current.kind === "mc") {
    const i = Number(value);
    if (!Number.isInteger(i) || i < 0 || !current.options || i >= current.options.length) {
      return void (await answerCb(cb.id, "گزینه نامعتبر"));
    }
    session.answers[itemId] = String(i);
    label = `«${FA_LETTERS[i] ?? faNum(i + 1)}) ${esc(trunc(current.options[i], 50))}»`;
  } else if (current.kind === "tf") {
    const v = value === "true" ? "true" : "false";
    session.answers[itemId] = v;
    label = v === "true" ? "✅ صحیح" : "❌ غلط";
  } else {
    session.answers[itemId] = value;
    label = `«${esc(trunc(value, 60))}»`;
  }
  session.shortPending = null;
  session.lastTouch = Date.now();

  await answerCb(cb.id);
  // نمایش انتخاب کاربر روی همان پیام سؤال (بازکردن پاسخ‌ها در پایان)
  const edited =
    `📝 آزمون «${esc(session.bookTitle)}» — ${esc(session.modelLabel)}\n` +
    `✅ سؤال ${faNum(session.idx + 1)} از ${faNum(session.items.length)} — پاسخ شما: ${label}\n\n` +
    esc(trunc(current.prompt, 240));
  await editMessage(chatId, messageId, edited);

  session.idx++;
  if (session.idx >= session.items.length) await finishQuiz(session);
  else await sendQuizQuestion(session);
}

async function captureShortAnswer(chatId: number, text: string): Promise<boolean> {
  const sid = quizByChat.get(chatId);
  const session = sid ? quizSessions.get(sid) : undefined;
  if (!session || !session.shortPending) return false;
  const itemId = session.shortPending;
  const it = session.items[session.idx];
  session.answers[itemId] = text.trim().slice(0, 500);
  session.shortPending = null;
  session.lastTouch = Date.now();
  if (session.currentMsgId) {
    await editMessage(
      chatId,
      session.currentMsgId,
      `📝 آزمون «${esc(session.bookTitle)}» — ${esc(session.modelLabel)}\n` +
        `✅ سؤال ${faNum(session.idx + 1)} از ${faNum(session.items.length)} — پاسخ شما ثبت شد: «${esc(trunc(text, 80))}»\n\n` +
        esc(trunc(it?.prompt ?? "", 200))
    );
  }
  session.idx++;
  if (session.idx >= session.items.length) await finishQuiz(session);
  else await sendQuizQuestion(session);
  return true;
}

async function onFinishCallback(cb: TgCallbackQuery, chatId: number): Promise<void> {
  const sid = (cb.data ?? "").split(":")[1] ?? "";
  const session = quizSessions.get(sid);
  if (!session || session.chatId !== chatId) return void (await answerCb(cb.id, "این آزمون دیگر فعال نیست 🕐"));
  await answerCb(cb.id, "در حال ثبت نتیجه… 🏁");
  if (cb.message) {
    await editMessage(
      chatId,
      cb.message.message_id,
      `📝 آزمون «${esc(session.bookTitle)}» — ${esc(session.modelLabel)}\n🔚 آزمون پایان یافت — در حال ثبت نتیجه…`
    );
  }
  await finishQuiz(session);
}

async function finishQuiz(session: QuizSession): Promise<void> {
  quizSessions.delete(session.sid);
  if (quizByChat.get(session.chatId) === session.sid) quizByChat.delete(session.chatId);
  const chatId = session.chatId;
  await chatAction(chatId, "typing");

  const kb: InlineKeyboard = [
    [{ text: "🔄 آزمون مجدد", callback_data: `qz:${session.bookId}:${session.model}` }],
    [{ text: "📚 کتاب‌ها", callback_data: "books" }],
  ];

  const res = await authed(
    chatId,
    session.tgUser,
    `/api/v1/books/${encodeURIComponent(session.bookId)}/quiz/attempts`,
    { method: "POST", body: JSON.stringify({ model: session.model, answers: session.answers }) },
    60_000
  );
  if (res === "unlinked") return void (await promptLink(chatId));
  if (!res || !res.ok) {
    const msg = apiErrorText(await readJson(res));
    return void (await sendMessage(chatId, `⚠️ ${esc(msg)}\n\nپاسخ‌های شما ثبت نشد — می‌توانی دوباره تلاش کنی.`, kb));
  }
  const r = await readJson<QuizResult>(res);
  if (!r) return void (await sendMessage(chatId, `${NET_ERR}\n\nمی‌توانی دوباره تلاش کنی.`, kb));

  // سربرگ نتیجه
  const head: string[] = [];
  head.push(`🏁 <b>نتیجهٔ آزمون «${esc(r.bookTitle)}»</b>`);
  head.push(`مدل: ${esc(r.modelLabel)}`);
  head.push("");
  head.push(`📊 نمرهٔ شما: <b>${faNum(r.score)} از ${faNum(r.maxScore)} — ${faNum(r.percent)}٪</b>`);
  if (r.newBest) head.push(`🎉 <b>رکورد جدید!</b> بهترین نمرهٔ قبلی: ${faNum(r.previousBest)}`);
  if (r.pointsAwarded > 0) head.push(`⭐ <b>${faNum(r.pointsAwarded)} امتیاز جدید</b> به حساب شما اضافه شد`);
  head.push("", "🔍 <b>مرور پاسخ‌ها:</b>");

  // مرور سؤال‌به‌سؤال
  const review: string[] = [];
  r.perQuestion.forEach((q, i) => {
    const mark = q.correct === null ? "👁" : q.correct ? "✅" : "❌";
    const lines = [`${faNum(i + 1)}. ${mark} ${esc(trunc(q.prompt, 140))}`];
    if (q.kind === "short") {
      lines.push(`   ✍️ پاسخ شما: «${esc(trunc(q.yourAnswer ?? "—", 100))}»`);
      lines.push(`   📖 پاسخ نمونه: «${esc(trunc(q.correctAnswer, 160))}» — خودت مقایسه کن`);
    } else {
      lines.push(`   ✍️ پاسخ شما: «${esc(trunc(q.yourAnswer ?? "بی‌پاسخ", 80))}»`);
      if (!q.correct) lines.push(`   ✔️ پاسخ درست: «${esc(trunc(q.correctAnswer, 100))}»`);
      if (q.explanation) lines.push(`   💡 ${esc(trunc(q.explanation, 180))}`);
    }
    review.push(lines.join("\n"));
  });

  const text = `${head.join("\n")}\n\n${review.join("\n")}`;
  const chunks = splitMessage(text);
  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    const prefix = chunks.length > 1 && i > 0 ? "…ادامه\n\n" : "";
    await sendMessage(chatId, prefix + chunks[i], isLast ? kb : undefined);
    if (!isLast) await sleep(350);
  }
}

// ─────────────────────────────── امتیازها ───────────────────────────────

async function sendPoints(chatId: number, from: TgUser): Promise<void> {
  await chatAction(chatId, "typing");
  const res = await authed(chatId, from, "/api/v1/me/points");
  if (res === "unlinked") return void (await promptLink(chatId));
  if (!res || !res.ok) return void (await sendMessage(chatId, `⚠️ ${esc(apiErrorText(await readJson(res)))}`));
  const p = await readJson<PointsData>(res);
  if (!p) return void (await sendMessage(chatId, NET_ERR));

  const lines: string[] = [];
  lines.push("⭐ <b>امتیازهای من</b>", "");
  lines.push(`🏆 مجموع امتیاز: <b>${faNum(p.total)}</b>`);
  lines.push(`📅 ۳۰ روز اخیر: <b>${faNum(p.last30Days)}</b>`);
  const recent = (p.recent ?? []).slice(0, 5);
  if (recent.length > 0) {
    lines.push("", "🏅 <b>آخرین دستاوردها:</b>");
    for (const r of recent) lines.push(`• +${faNum(r.points)} ${esc(r.reasonLabel)} — ${faDate(r.createdAt)}`);
  }
  if (p.total === 0 && recent.length === 0) {
    lines.push("", "هنوز امتیازی کسب نکرده‌اید — با آزمون‌های کتاب‌خانه شروع کنید! 🚀");
    return void (await sendMessage(chatId, lines.join("\n"), [[{ text: "📚 کتاب‌خانه", callback_data: "books" }]]));
  }
  await sendMessage(chatId, lines.join("\n"), [[{ text: "🔄 به‌روزرسانی", callback_data: "points" }]]);
}

// ─────────────────────────────── اتصال حساب ───────────────────────────────

async function tryLinkCode(chatId: number, from: TgUser, code: string): Promise<void> {
  await chatAction(chatId, "typing");
  const res = await mainAppFetch(
    "/api/v1/internal/telegram/link",
    {
      method: "POST",
      headers: { "x-bot-secret": BOT_SECRET, "content-type": "application/json" },
      body: JSON.stringify({
        code,
        telegramUser: {
          id: from.id,
          firstName: from.first_name ?? "",
          lastName: from.last_name,
          username: from.username,
        },
      }),
    },
    20_000
  );
  if (!res) return void (await sendMessage(chatId, NET_ERR));
  const data = await readJson<LinkResponse>(res);
  if (res.ok && data?.token && data.user) {
    chatSessions.set(chatId, { token: data.token, user: data.user, tgId: from.id, at: Date.now(), booksCache: null });
    await sendMessage(chatId, `✅ حساب شما متصل شد!\n🎉 خوش آمدی <b>${esc(from.first_name || data.user.fullName)}</b>!`);
    const s = chatSessions.get(chatId);
    if (s) await sendWelcomeLinked(chatId, from, s);
    log(`کاربر تلگرام ${from.id} با موفقیت متصل شد`);
    return;
  }
  const msg = data?.error?.message || "اتصال حساب ناموفق بود.";
  await sendMessage(
    chatId,
    `❌ ${esc(msg)}\n\nکد جدیدی از بخش پروفایل نسخهٔ وب بگیرید و دوباره بفرستید. 🔢`,
    [[{ text: "🔗 اتصال با کد ۶ رقمی", callback_data: "link" }]],
    linkPhoneReply()
  );
}

/**
 * راند ۲۲ — ورود با شمارهٔ موبایل: کاربر با دکمهٔ «📱 ورود با شمارهٔ موبایل»
 * (request_contact) شمارهٔ خود را فرستاده؛ اگر با شمارهٔ حساب وب یکی باشد،
 * اتصال خودکار انجام می‌شود (POST /api/v1/internal/telegram/link-phone با X-Bot-Secret).
 */
async function tryLinkPhone(chatId: number, from: TgUser, phone: string): Promise<void> {
  await chatAction(chatId, "typing");
  const res = await mainAppFetch(
    "/api/v1/internal/telegram/link-phone",
    {
      method: "POST",
      headers: { "x-bot-secret": BOT_SECRET, "content-type": "application/json" },
      body: JSON.stringify({
        phone,
        telegramUser: {
          id: from.id,
          firstName: from.first_name ?? "",
          lastName: from.last_name,
          username: from.username,
        },
      }),
    },
    20_000
  );
  if (!res) return void (await sendMessage(chatId, NET_ERR));
  const data = await readJson<LinkResponse>(res);
  if (res.ok && data?.token && data.user) {
    chatSessions.set(chatId, { token: data.token, user: data.user, tgId: from.id, at: Date.now(), booksCache: null });
    await sendMessage(chatId, `✅ با شمارهٔ موبایل‌تان وارد شدید! 🎉\nخوش آمدی <b>${esc(from.first_name || data.user.fullName)}</b>!`);
    const s = chatSessions.get(chatId);
    if (s) await sendWelcomeLinked(chatId, from, s);
    log(`کاربر تلگرام ${from.id} با شمارهٔ موبایل متصل شد`);
    return;
  }
  const msg = data?.error?.message || "ورود با شمارهٔ موبایل ناموفق بود.";
  await sendMessage(
    chatId,
    `❌ ${esc(msg)}\n\nمی‌توانید دوباره دکمهٔ «📱 ورود با شمارهٔ موبایل» را بزنید، یا با «کد اتصال ۶ رقمی» از پروفایل نسخهٔ وب وارد شوید. 🔢`,
    [[{ text: "🔗 اتصال با کد ۶ رقمی", callback_data: "link" }]],
    linkPhoneReply()
  );
}

// ─────────────────────────────── خروج / قطع اتصال (round 18) ───────────────────────────────

async function sendLogoutConfirm(chatId: number, from: TgUser): Promise<void> {
  const s = chatSessions.get(chatId);
  if (!s) {
    // حسابی متصل نیست — فقط راهنمایی کوتاه
    return void (await sendMessage(
      chatId,
      "🚪 حسابی از این تلگرام متصل نیست — نیازی به خروج نیست! ✅\nاگر خواستی وصل شوی، دکمهٔ «📱 ورود با شمارهٔ موبایل» را بزن یا کد ۶ رقمی پروفایل وب را بفرست. 🔢",
      [[{ text: "🔗 اتصال با کد ۶ رقمی", callback_data: "link" }]],
      linkPhoneReply()
    ));
  }
  await sendMessage(
    chatId,
    `🚪 <b>خروج از حساب</b>\n\nحساب «${esc(s.user.fullName)}» (${esc(roleLabelFa(s.user.role))}) به این تلگرام متصل است.\nبا خروج، اتصال قطع می‌شود و:
• این بات دیگر به حساب شما دسترسی ندارد
• مینی‌اپ دیگر خودکار وارد حساب شما نمی‌شود
• حساب وب شما دست‌نخورده می‌ماند و هر وقت خواستید دوباره وصل شوید 🔄

مطمئن هستید؟`,
    [
      [{ text: "✅ بله، قطع اتصال", callback_data: "logoutok" }],
      [{ text: "❌ انصراف", callback_data: "menu" }],
    ]
  );
}

async function doLogout(chatId: number, from: TgUser, cbId?: string): Promise<void> {
  const s = chatSessions.get(chatId);
  if (!s) {
    if (cbId) await answerCb(cbId, "حسابی متصل نیست");
    return void (await sendLogoutConfirm(chatId, from));
  }
  await chatAction(chatId, "typing");
  const res = await mainAppFetch(
    "/api/v1/internal/telegram/unlink",
    {
      method: "POST",
      headers: { "x-bot-secret": BOT_SECRET, "content-type": "application/json" },
      body: JSON.stringify({ telegramId: from.id }),
    },
    20_000
  );
  if (!res || !res.ok) {
    if (cbId) await answerCb(cbId, "خطا در قطع اتصال");
    return void (await sendMessage(chatId, `⚠️ ${esc(apiErrorText(await readJson(res)))}\n\nلطفاً کمی بعد دوباره تلاش کنید.`));
  }
  // پاک‌سازی نشست‌های این چت
  for (const [cid, sess] of chatSessions) {
    if (sess.tgId === from.id) chatSessions.delete(cid);
  }
  if (cbId) await answerCb(cbId, "خروج انجام شد");
  log(`کاربر تلگرام ${from.id} از حساب خود قطع شد`);
  await sendMessage(
    chatId,
    "🚪 <b>اتصال حساب قطع شد.</b>\n\nاز همراهی‌تان سپاسگزاریم! 🙏\nهر وقت خواستید برگردید: دکمهٔ «📱 ورود با شمارهٔ موبایل» را بزنید، یا کد اتصال ۶ رقمی را از پروفایل وب بگیرید و همین‌جا بفرستید. 🔢",
    [[{ text: "🔗 اتصال مجدد", callback_data: "link" }]],
    linkPhoneReply()
  );
}

// ─────────────────────────────── آپلود کتاب از تلگرام (round 20) ───────────────────────────────
// کاربر فایل PDF را برای بات می‌فرستد → بات آن را از تلگرام دانلود می‌کند →
// از طریق /api/v1/books/extract-pdf (با توکن نشست خود کاربر) متن استخراج و PDF اصلی
// نگه داشته می‌شود → ویزارد ۴ گامی: دوره → پایه → درس → عنوان → ثبت کتاب +
// اجرای خط تولید (خلاصه/جزوه/شکل/نمونه‌سؤال/پادکست). مجوزها همان قواعد وب است.

const TG_FILE_MAX_BYTES = 20 * 1024 * 1024; // سقف دانلود فایل بات‌ها از تلگرام
const UPLOAD_IDLE_MS = 15 * 60_000; // انقضای ویزارد پس از ۱۵ دقیقه بی‌فعالیتی

interface UploadWizard {
  chatId: number;
  tgUser: TgUser;
  fileName: string;
  text: string;
  pages: number;
  chars: number;
  storageKey: string;
  level: string | null;
  levelLabel: string | null;
  grade: string | null;
  subject: string | null;
  title: string;
  step: "level" | "grade" | "subject" | "subject_other" | "title" | "title_other" | "confirm";
  grades: string[]; // فهرست پایه‌های دورهٔ انتخابی (برای ایندکس‌ها)
  subjects: string[]; // فهرست درس‌های پایهٔ انتخابی
  lastTouch: number;
}

const uploadSessions = new Map<number, UploadWizard>();

/** ساختار درسی رسمی را از /api/v1/public/meta می‌گیرد (۱۰ دقیقه کش، پایدار در hot-reload)
 *  راند ۲۹: کلید کش نسخه‌دار شد (V2) تا کشِ قدیمیِ نرمال‌نشده بعد از hot-reload به کد جدید نشت نکند. */
const gMeta = globalThis as { __tgBotCurrV2?: { at: number; data: MetaCurriculum } };

/** راند ۲۹ — نرمال‌سازی ساختار درسی: هم شکل کامل ({grade, subjects}) و هم شکل قدیمی/رشته‌ای را می‌پذیرد */
function normalizeCurriculum(raw: unknown): MetaCurriculum | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const levels = (raw as Array<Record<string, unknown>>)
    .filter((l) => !!l && typeof l === "object" && typeof l.code === "string")
    .map((l) => ({
      code: l.code as string,
      label: typeof l.label === "string" && l.label ? (l.label as string) : (l.code as string),
      emoji: typeof l.emoji === "string" && l.emoji ? (l.emoji as string) : "🎓",
      grades: (Array.isArray(l.grades) ? (l.grades as unknown[]) : [])
        .map((g) => (typeof g === "string" ? { grade: g, subjects: [] as string[] } : (g as Record<string, unknown>)))
        .filter(
          (g): g is { grade: string; subjects: string[] } =>
            !!g && typeof g === "object" && typeof g.grade === "string" && Array.isArray(g.subjects),
        ),
    }));
  return levels.length > 0 ? { levels } : null;
}

async function getCurriculum(): Promise<MetaCurriculum | null> {
  const cached = gMeta.__tgBotCurrV2;
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.data;
  const res = await mainAppFetch("/api/v1/public/meta", undefined, 15_000);
  if (res && res.ok) {
    const data = await readJson<{ curriculum?: unknown; levels?: unknown }>(res);
    // راند ۲۹ — رفع باگ ویزارد آپلود: در meta فعلی، `levels` فقط نام پایه‌ها را دارد
    // (آرایهٔ رشته‌ای، بدون دروس) و ساختار کامل درس‌ها در `curriculum` است.
    // هر دو شکل نرمال‌سازی می‌شوند تا پایه‌ها و فهرست درس‌ها همیشه درست ساخته شوند.
    const normalized = normalizeCurriculum(data?.curriculum) ?? normalizeCurriculum(data?.levels);
    if (normalized) {
      gMeta.__tgBotCurrV2 = { at: Date.now(), data: normalized };
      return normalized;
    }
  }
  return cached?.data ?? null;
}

/** برچسب پایه — ابتدایی «کلاس سوم»، بقیه «پایهٔ هفتم» (همان قرارداد وب) */
function wizardGradeLabel(level: string | null, grade: string): string {
  return level === "PRIMARY" ? `کلاس ${grade}` : `پایهٔ ${grade}`;
}

/** آیا کاربر این چت می‌تواند کتاب اضافه کند؟ (از کش کتاب‌خانه یا فراخوانی تازه) */
async function canUploadForChat(chatId: number, from: TgUser): Promise<boolean | null> {
  const cached = chatSessions.get(chatId)?.booksCache;
  if (cached && Date.now() - cached.at < 60_000) return cached.data.canUpload;
  const res = await authed(chatId, from, "/api/v1/books");
  if (res === "unlinked" || !res || !res.ok) return null; // نامشخص — اجازه بده endpoint اصلی تصمیم بگیرد
  const data = await readJson<BooksListData>(res);
  if (!data) return null;
  const s = chatSessions.get(chatId);
  if (s) s.booksCache = { at: Date.now(), key: "", data };
  return data.canUpload;
}

async function sendUploadIntro(chatId: number): Promise<void> {
  await sendMessage(
    chatId,
    [
      "➕ <b>افزودن کتاب جدید</b>",
      "",
      "فایل PDF کتاب را همین‌جا برایم بفرستید تا:",
      "✅ متن آن به‌صورت خودکار استخراج شود",
      "🎓 ساختار درسی (دوره → پایه → درس) را انتخاب کنید",
      "📄 خلاصه، جزوه، شکل، نمونه‌سؤال و پادکست ساخته شود",
      "📥 نسخهٔ اصلی PDF برای دانلود دانش‌آموزان ضمیمه کتاب شود",
      "",
      "📎 سقف آپلود از تلگرام: ۲۰ مگابایت — فایل PDF را بفرستید…",
    ].join("\n")
  );
}

async function onBookDocument(chatId: number, from: TgUser, doc: TgDocument): Promise<void> {
  const isPdf = (doc.mime_type ?? "").toLowerCase() === "application/pdf" || /\.pdf$/i.test(doc.file_name ?? "");
  if (!isPdf) {
    return void (await sendMessage(
      chatId,
      "📄 تنها فایل <b>PDF</b> برای افزودن کتاب پشتیبانی می‌شود.\nفایل PDF کتاب را بفرستید 📚 یا از منوی پایین استفاده کنید."
    ));
  }

  const s = await getSession(chatId, from);
  if (!s) return void (await promptLink(chatId));

  // مجوز — همان قواعد وب (ادمین کل همیشه؛ مدرسه/معلم پس از فعال‌سازی مدیر)
  const can = await canUploadForChat(chatId, from);
  if (can === false) {
    return void (await sendMessage(
      chatId,
      "⛔ قابلیت افزودن کتاب برای شما فعال نیست.\nمدیر کل پلتفرم باید از بخش «تنظیمات و اتصال‌ها» این قابلیت را برای شما روشن کند."
    ));
  }

  const fileName = doc.file_name?.slice(0, 120) || "book.pdf";
  if (doc.file_size && doc.file_size > TG_FILE_MAX_BYTES) {
    return void (await sendMessage(
      chatId,
      "⚠️ حجم این فایل بیش از ۲۰ مگابایت است (سقف آپلود از تلگرام).\nلطفاً فایل سبک‌تری بفرستید یا از نسخهٔ وب (تا ۲۵ مگابایت) بارگذاری کنید."
    ));
  }

  await sendMessage(chatId, `📥 <b>دریافت شد:</b> <code>${esc(fileName)}</code>\n\n⏳ در حال دانلود و استخراج متن… چند لحظه صبر کنید.`);
  await chatAction(chatId, "upload_document");

  // ۱) دانلود فایل از سرور تلگرام (راند ۲۱: با مهلت زمانی — قبلاً بدون timeout بود و
  // گیر کردن آن کل حلقهٔ نظرسنجی را می‌کشت)
  let bytes: Uint8Array | null = null;
  try {
    const f = await tg<{ file_path?: string }>("getFile", { file_id: doc.file_id });
    if (!f.file_path) throw new Error("no file_path");
    const url = `${TG_API_BASE}/file/bot${state.botToken}/${f.file_path}`;
    const dlCtrl = new AbortController();
    const dlTimer = setTimeout(() => dlCtrl.abort(), 120_000);
    try {
      const dres = await fetch(url, { signal: dlCtrl.signal });
      if (!dres.ok) throw new Error(`http ${dres.status}`);
      const ab = await withTimeout(dres.arrayBuffer(), 110_000, "دانلود فایل تلگرام");
      if (ab) bytes = new Uint8Array(ab);
    } finally {
      clearTimeout(dlTimer);
    }
  } catch (e) {
    log(`⚠️ getFile/download: ${errStr(e)}`);
    return void (await sendMessage(chatId, `${NET_ERR}\n\nدانلود فایل از تلگرام ناموفق بود — دوباره بفرستید.`));
  }
  if (!bytes || bytes.length === 0) {
    return void (await sendMessage(chatId, "⚠️ فایل دریافتی خالی به نظر می‌رسد — دوباره بفرستید."));
  }
  if (bytes.length > TG_FILE_MAX_BYTES) {
    return void (await sendMessage(chatId, "⚠️ حجم این فایل بیش از ۲۰ مگابایت است (سقف آپلود از تلگرام)."));
  }

  // ۲) استخراج متن + نگهداری PDF اصلی (همان endpoint وب، با توکن کاربر)
  const fd = new FormData();
  fd.append("file", new Blob([bytes as BlobPart], { type: "application/pdf" }), fileName);
  const res = await authed(chatId, from, "/api/v1/books/extract-pdf", { method: "POST", body: fd }, 180_000);
  if (res === "unlinked") return void (await promptLink(chatId));
  if (!res || !res.ok) {
    const msg = apiErrorText(await readJson(res));
    return void (await sendMessage(chatId, `⚠️ ${esc(msg)}\n\nمیتوانید فایل دیگری بفرستید یا از نسخهٔ وب اقدام کنید.`));
  }
  const extracted = await readJson<PdfExtractResult>(res);
  if (!extracted || !extracted.text || !extracted.storageKey) {
    return void (await sendMessage(chatId, NET_ERR));
  }

  // ۳) شروع ویزارد ۴ گامی
  const suggestedTitle = extracted.fileName
    .replace(/\.pdf$/i, "")
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

  const wiz: UploadWizard = {
    chatId,
    tgUser: from,
    fileName: extracted.fileName,
    text: extracted.text,
    pages: extracted.pages,
    chars: extracted.chars,
    storageKey: extracted.storageKey,
    level: null,
    levelLabel: null,
    grade: null,
    subject: null,
    title: suggestedTitle,
    step: "level",
    grades: [],
    subjects: [],
    lastTouch: Date.now(),
  };
  uploadSessions.set(chatId, wiz);

  const intro: string[] = [];
  intro.push("📘 <b>فایل PDF کتاب دریافت شد!</b>");
  intro.push("");
  intro.push(`📄 <code>${esc(wiz.fileName)}</code> — ${faNum(wiz.pages)} صفحه · ${faNum(wiz.chars)} نویسه`);
  intro.push("✅ متن کتاب استخراج شد و نسخهٔ اصلی PDF نیز ضمیمه کتاب می‌شود.");
  if (extracted.truncated) intro.push(`⚠️ متن طولانی بود و ${faNum(wiz.chars)} نویسهٔ ابتدایی نگه داشته شد.`);
  intro.push("");
  intro.push("حالا مشخصات کتاب را انتخاب کنیم 👇");
  await sendMessage(chatId, intro.join("\n"));
  await sendWizardLevel(wiz, s.user.role);
}

async function sendWizardLevel(w: UploadWizard, role?: string): Promise<void> {
  w.step = "level";
  w.lastTouch = Date.now();
  const meta = await getCurriculum();
  const levels = meta?.levels ?? [];
  const rows: InlineKeyboard = [];
  const btns: InlineButton[] = (levels.length > 0 ? levels.map((l) => ({
    text: `${l.emoji} ${l.label}`,
    callback_data: `upld:lvl:${l.code}`,
  })) : LEVELS_FA.map((l) => ({
    text: `${l.emoji} ${l.label}`,
    callback_data: `upld:lvl:${l.code}`,
  })));
  for (let i = 0; i < btns.length; i += 2) rows.push(btns.slice(i, i + 2));
  rows.push([{ text: "❌ انصراف", callback_data: "upld:cancel" }]);
  const teacherNote = role && role !== "SUPER_ADMIN" ? "\n\nℹ️ کتاب شما پس از تأیید مدیر کل پلتفرم برای دانش‌آموزان نمایش داده می‌شود." : "";
  await sendMessage(
    w.chatId,
    `🎓 <b>گام ۱ از ۴ — دورهٔ تحصیلی</b>\n\nکتاب مربوط به کدام دوره است؟${teacherNote}`,
    rows
  );
}

async function sendWizardGrade(w: UploadWizard): Promise<void> {
  w.step = "grade";
  w.lastTouch = Date.now();
  const meta = await getCurriculum();
  const lvl = meta?.levels.find((l) => l.code === w.level);
  // پیش‌دبستانی پایه ندارد → مستقیم انتخاب درس
  const grades = (lvl?.grades ?? []).map((g) => g.grade).filter((g) => g !== "");
  if (grades.length === 0) {
    w.grade = null;
    return void (await sendWizardSubject(w));
  }
  w.grades = grades;
  const gradeBtns = grades.map((g, i) => ({
    text: wizardGradeLabel(w.level, g),
    callback_data: `upld:gr:${i}`,
  }));
  const rows: InlineKeyboard = chunkRows(gradeBtns, 2);
  rows.push([
    { text: "↩️ اصلاح دوره", callback_data: "upld:lvl2" },
    { text: "❌ انصراف", callback_data: "upld:cancel" },
  ]);
  await sendMessage(
    w.chatId,
    `🎓 <b>گام ۲ از ۴ — ${w.levelLabel}</b>\n\nکتاب برای کدام پایه/کلاس است؟`,
    rows
  );
}

async function sendWizardSubject(w: UploadWizard): Promise<void> {
  w.step = "subject";
  w.lastTouch = Date.now();
  const meta = await getCurriculum();
  const lvl = meta?.levels.find((l) => l.code === w.level);
  const subjects = (lvl?.grades.find((g) => g.grade === (w.grade ?? ""))?.subjects ?? []).slice(0, 20);
  w.subjects = subjects;
  const rows: InlineKeyboard = subjects.map((s, i) => [
    { text: trunc(s, 44), callback_data: `upld:sub:${i}` },
  ]);
  rows.push([{ text: "➕ سایر (تایپ دستی)", callback_data: "upld:other" }]);
  rows.push([
    { text: "↩️ اصلاح پایه", callback_data: "upld:gr2" },
    { text: "❌ انصراف", callback_data: "upld:cancel" },
  ]);
  const gradeBit = w.grade ? ` — ${esc(wizardGradeLabel(w.level, w.grade))}` : "";
  const subjectsNote =
    subjects.length > 0
      ? `لیست دروس ${esc(w.levelLabel ?? "")}${gradeBit} (${faNum(subjects.length)} درس) — کدام درس است؟\n(اگر در فهرست نیست، «سایر» را بزنید و نام درس را تایپ کنید)`
      : `فهرست رسمی دروس برای ${esc(w.levelLabel ?? "")}${gradeBit} در دسترس نیست — نام درس را با «سایر (تایپ دستی)» وارد کنید.`;
  await sendMessage(
    w.chatId,
    `📖 <b>گام ۳ از ۴ — درس</b>\n\n${subjectsNote}`,
    rows
  );
}

async function sendWizardTitle(w: UploadWizard): Promise<void> {
  w.step = "title";
  w.lastTouch = Date.now();
  const rows: InlineKeyboard = [];
  if (w.title.trim().length >= 2) {
    rows.push([{ text: `✅ «${trunc(w.title, 40)}»`, callback_data: "upld:usetitle" }]);
  }
  rows.push([{ text: "⌨️ تایپ عنوان جدید", callback_data: "upld:othertitle" }]);
  rows.push([
    { text: "↩️ اصلاح درس", callback_data: "upld:sub2" },
    { text: "❌ انصراف", callback_data: "upld:cancel" },
  ]);
  const gradeBit = w.grade ? ` · ${esc(wizardGradeLabel(w.level, w.grade))}` : "";
  await sendMessage(
    w.chatId,
    `📕 <b>گام ۴ از ۴ — عنوان کتاب</b>\n\n${esc(w.levelLabel ?? "")}${gradeBit}${w.subject ? ` · ${esc(w.subject)}` : ""}\n\nعنوان پیشنهادی از نام فایل: «${esc(w.title)}»\nمی‌توانید بپذیرید، تایپ کنید و بفرستید، یا عنوان دیگری بنویسید.`,
    rows
  );
}

async function sendWizardConfirm(w: UploadWizard): Promise<void> {
  w.step = "confirm";
  w.lastTouch = Date.now();
  const gradeBit = w.grade ? wizardGradeLabel(w.level, w.grade) : null;
  const lines = [
    "📕 <b>بازبینی نهایی کتاب</b>",
    "",
    `عنوان: <b>${esc(w.title)}</b>`,
    `دوره: ${esc(w.levelLabel ?? "—")}`,
    `پایه: ${esc(gradeBit ?? "—")}`,
    `درس: ${esc(w.subject ?? "—")}`,
    `متن: ${faNum(w.chars)} نویسه · ${faNum(w.pages)} صفحه`,
    "PDF اصلی: ضمیمه می‌شود ✅",
    "",
    "با ثبت کتاب، تولید <b>خلاصه + جزوه + شکل‌ها + نمونه‌سؤال + پادکست</b> آغاز می‌شود.",
  ];
  const rows: InlineKeyboard = [
    [{ text: "📗 ثبت کتاب", callback_data: "upld:go" }],
    [
      { text: "↩️ اصلاح عنوان", callback_data: "upld:sub2" },
      { text: "❌ انصراف", callback_data: "upld:cancel" },
    ],
  ];
  await sendMessage(w.chatId, lines.join("\n"), rows);
}

async function submitWizard(w: UploadWizard): Promise<void> {
  const chatId = w.chatId;
  await chatAction(chatId, "typing");
  const res = await authed(
    chatId,
    w.tgUser,
    "/api/v1/books",
    {
      method: "POST",
      body: JSON.stringify({
        title: w.title.trim().slice(0, 120),
        text: w.text,
        level: w.level ?? undefined,
        gradeLevel: w.grade ?? undefined,
        subject: w.subject ?? undefined,
        pdfStorageKey: w.storageKey,
        pdfFileName: w.fileName,
      }),
    },
    60_000
  );
  if (res === "unlinked") {
    uploadSessions.delete(chatId);
    return void (await promptLink(chatId));
  }
  if (!res || !res.ok) {
    const msg = apiErrorText(await readJson(res));
    return void (await sendMessage(
      chatId,
      `⚠️ ${esc(msg)}\n\nمی‌توانید اصلاح کنید و دوباره ثبت کنید یا /upload را از نو شروع کنید.`,
      [
        [{ text: "↩️ اصلاح عنوان", callback_data: "upld:sub2" }],
        [{ text: "❌ انصراف", callback_data: "upld:cancel" }],
      ]
    ));
  }
  const book = await readJson<CreatedBook>(res);
  uploadSessions.delete(chatId);
  if (!book?.id) return void (await sendMessage(chatId, NET_ERR));

  const s = chatSessions.get(chatId);
  const isTeacher = s && s.user.role !== "SUPER_ADMIN";
  const gradeBit = w.grade ? wizardGradeLabel(w.level, w.grade) : null;
  const lines = [
    "🎉 <b>کتاب با موفقیت ثبت شد!</b>",
    "",
    `📕 <b>${esc(w.title)}</b>`,
    `🎓 ${esc([w.levelLabel, gradeBit, w.subject].filter(Boolean).join(" · "))}`,
    "",
    "⏳ در حال تولید: خلاصه · جزوه · شکل‌ها · نمونه‌سؤال · پادکست",
    "چند دقیقه بعد دوباره به کتاب سر بزنید — همه آماده می‌شود! 🌟",
  ];
  if (isTeacher) {
    lines.push("", "📋 این کتاب پس از <b>تأیید مدیر کل پلتفرم</b> برای دانش‌آموزان نمایش داده می‌شود.");
  }
  await sendMessage(chatId, lines.join("\n"), [[{ text: "📚 مشاهده کتاب", callback_data: `book:${book.id}` }]]);
  log(`کتاب جدید از تلگرام ثبت شد (${book.id}) — ${w.title}`);
}

/** ورودی تایپی ویزارد (عنوان / درس سایر / انصراف) — قبل از برچسب‌های منو صدا می‌شود */
async function captureWizardInput(chatId: number, text: string): Promise<boolean> {
  const w = uploadSessions.get(chatId);
  if (!w) return false;
  w.lastTouch = Date.now();

  // خروج سریع از ویزارد با برچسب‌های آشنای منو
  const lower = text.toLowerCase();
  if (text === "انصراف" || text === "/cancel" || text === "لغو") {
    uploadSessions.delete(chatId);
    await sendMessage(chatId, "❌ افزودن کتاب لغو شد.\nهر وقت خواستید دوباره فایل PDF بفرستید یا /upload را بزنید. 📚");
    return true;
  }
  if (text.includes("کتاب‌خانه") || text.includes("کتابخانه")) {
    uploadSessions.delete(chatId);
    await sendMessage(chatId, "❌ افزودن کتاب لغو شد — بازگشت به کتاب‌خانه…");
    await sendLibraryRoot(chatId, w.tgUser, { fresh: true });
    return true;
  }
  if (text === "خروج") {
    uploadSessions.delete(chatId);
    await sendLogoutConfirm(chatId, w.tgUser);
    return true;
  }

  if (w.step === "subject_other") {
    const sub = text.trim().slice(0, 60);
    if (sub.length < 2) {
      await sendMessage(chatId, "نام درس کوتاه است — دوباره تایپ کنید یا «انصراف» را بفرستید.");
      return true;
    }
    w.subject = sub;
    await sendWizardTitle(w);
    return true;
  }

  if (w.step === "title" || w.step === "title_other") {
    const t = text.trim().slice(0, 120);
    if (t.length < 2) {
      await sendMessage(chatId, "عنوان باید حداقل ۲ نویسه باشد — دوباره بفرستید یا «انصراف» را بزنید.");
      return true;
    }
    w.title = t;
    await sendWizardConfirm(w);
    return true;
  }

  // در گام‌های دکمه‌ای، متن تایپیِ ناشناخته → یادآوری همان گام
  const stepFa =
    w.step === "level" ? "انتخاب دورهٔ تحصیلی" : w.step === "grade" ? "انتخاب پایه" : w.step === "subject" ? "انتخاب درس" : "بازبینی نهایی";
  await sendMessage(
    chatId,
    `🔍 الان در گام «${esc(stepFa)}» هستیم — از دکمه‌های زیر استفاده کنید.\nاگر می‌خواهید ول کنید، «انصراف» را بفرستید. 🙏`
  );
  return true;
}

async function onUploadCallback(cb: TgCallbackQuery, chatId: number, messageId: number): Promise<void> {
  const w = uploadSessions.get(chatId);
  const data = cb.data ?? "";
  const a = data.split(":")[1] ?? "";

  if (a === "cancel") {
    if (w) uploadSessions.delete(chatId);
    await answerCb(cb.id, "لغو شد");
    return void (await editMessage(chatId, messageId, "❌ افزودن کتاب لغو شد.\nهر وقت خواستید دوباره فایل PDF بفرستید یا /upload را بزنید. 📚"));
  }
  if (!w || w.chatId !== chatId) {
    return void (await answerCb(cb.id, "این فرم دیگر فعال نیست 🕐"));
  }
  w.lastTouch = Date.now();

  if (a === "lvl" || a === "lvl2") {
    const code = data.split(":")[2] ?? "";
    const meta = await getCurriculum();
    const lvl = meta?.levels.find((l) => l.code === code);
    if (!lvl) return void (await answerCb(cb.id, "دوره نامعتبر"));
    w.level = lvl.code;
    w.levelLabel = lvl.label;
    w.grade = null;
    w.subject = null;
    await answerCb(cb.id, `${lvl.emoji} ${lvl.label}`);
    if (a === "lvl2") await editMessage(chatId, messageId, `🎓 دورهٔ تحصیلی: <b>${esc(lvl.label)}</b>`);
    return void (await sendWizardGrade(w));
  }
  if (a === "gr" || a === "gr2") {
    const idx = Number(data.split(":")[2] ?? "-1");
    if (a === "gr") {
      const g = w.grades[idx];
      if (!g) return void (await answerCb(cb.id, "پایه نامعتبر"));
      w.grade = g;
      await answerCb(cb.id, wizardGradeLabel(w.level, g));
    } else {
      await answerCb(cb.id);
    }
    return void (await sendWizardSubject(w));
  }
  if (a === "sub" || a === "sub2") {
    if (a === "sub") {
      const idx = Number(data.split(":")[2] ?? "-1");
      const sub = w.subjects[idx];
      if (!sub) return void (await answerCb(cb.id, "درس نامعتبر"));
      w.subject = sub;
      await answerCb(cb.id, sub);
    } else {
      await answerCb(cb.id);
    }
    return void (await sendWizardTitle(w));
  }
  if (a === "other") {
    w.step = "subject_other";
    await answerCb(cb.id);
    return void (await sendMessage(
      chatId,
      "✏️ نام درس را همین‌جا تایپ کنید و بفرستید (مثلاً: مهارت‌های زندگی).\nیا «انصراف» را بفرستید."
    ));
  }
  if (a === "usetitle") {
    await answerCb(cb.id);
    if (!w.title.trim()) w.title = w.fileName.replace(/\.pdf$/i, "").slice(0, 120);
    return void (await sendWizardConfirm(w));
  }
  if (a === "othertitle") {
    w.step = "title_other";
    await answerCb(cb.id);
    return void (await sendMessage(chatId, "⌨️ عنوان کتاب را تایپ کنید و بفرستید (۲ تا ۱۲۰ نویسه)."));
  }
  if (a === "go") {
    await answerCb(cb.id, "در حال ثبت کتاب…");
    await editMessage(chatId, messageId, "⏳ در حال ثبت کتاب و شروع خط تولید…");
    return void (await submitWizard(w));
  }
  await answerCb(cb.id, "فرمان ناشناخته 🤔");
}

// ─────────────────────────────── مسیریابی پیام‌ها ───────────────────────────────

async function cmdStart(chatId: number, from: TgUser): Promise<void> {
  await chatAction(chatId, "typing");
  // راند ۲۱ — /start همیشه وضعیت واقعی اتصال را از سرور می‌گیرد (کش را بی‌اعتبار می‌کنیم)
  // تا پس از «خروج و قطع اتصال» در مینی‌اپ، بات درست رفتار کند و کد اتصال بخواهد.
  chatSessions.delete(chatId);
  const s = await getSession(chatId, from);
  if (s) await sendWelcomeLinked(chatId, from, s);
  else await sendWelcomeUnlinked(chatId, from);
}

async function onMessage(m: TgMessage): Promise<void> {
  const chatId = m.chat.id;
  const from = m.from;
  if (!from || from.is_bot) return;

  // ۰-) سند PDF — آپلود کتاب از خود تلگرام (round 20)
  if (m.document) return void (await onBookDocument(chatId, from, m.document));

  // ۰.۵) اشتراک‌گذاری شمارهٔ موبایل — ورود بدون کد (round 22)
  // باید قبل از بررسی «متن خالی» باشد: پیام مخاطب، text ندارد.
  if (m.contact?.phone_number) return void (await tryLinkPhone(chatId, from, m.contact.phone_number));

  const text = (m.text ?? "").trim();
  if (!text) {
    await sendMessage(chatId, "💬 فعلاً فقط پیام متنی و فایل PDF (برای افزودن کتاب) را پشتیبانی می‌کنم 🙏");
    return;
  }

  // ۰) پاسخ تایپیِ سؤال تشریحیِ در انتظار
  if (await captureShortAnswer(chatId, text)) return;

  // ۱) فرمان‌ها
  const cmdMatch = /^\/([a-zA-Z_]+)(?:@\w+)?/.exec(text);
  const cmd = cmdMatch?.[1]?.toLowerCase();
  if (cmd === "start") return void (await cmdStart(chatId, from));
  if (cmd === "app") return void (await sendApp(chatId));
  if (cmd === "books") return void (await sendLibraryRoot(chatId, from, { fresh: true }));
  if (cmd === "upload") {
    const s = await getSession(chatId, from);
    if (!s) return void (await promptLink(chatId));
    return void (await sendUploadIntro(chatId));
  }
  if (cmd === "cancel") {
    if (uploadSessions.has(chatId)) return void (await captureWizardInput(chatId, "انصراف"));
    return void (await sendMessage(chatId, "چیزی برای لغو نیست ✅"));
  }
  if (cmd === "points") return void (await sendPoints(chatId, from));
  if (cmd === "help") return void (await sendHelp(chatId));
  if (cmd === "link") return void (await sendLinkGuide(chatId));
  if (cmd === "logout") return void (await sendLogoutConfirm(chatId, from));
  if (cmd) return void (await sendMessage(chatId, "🤔 این فرمان را نمی‌شناسم — /help را امتحان کن 💡"));

  // ۱.۵) ورودی‌های ویزارد آپلود کتاب (عنوان / درس سایر / انصراف) — round 20
  if (await captureWizardInput(chatId, text)) return;

  // ۲) کد اتصال ۶ رقمی
  if (/^\d{6}$/.test(text)) return void (await tryLinkCode(chatId, from, text));

  // ۳) برچسب‌های منوی اصلی
  if (text.includes("ورود با شماره")) {
    return void (await sendMessage(
      chatId,
      "📱 برای ورود با شمارهٔ موبایل، دکمهٔ «📱 ورود با شمارهٔ موبایل» پایین صفحه را بزنید تا شمارهٔ تلگرام‌تان با من به اشتراک گذاشته شود.\nاگر دکمه را نمی‌بینید، /start را بفرستید. 🚀",
      undefined,
      linkPhoneReply()
    ));
  }
  if (text.includes("اتصال با کد")) return void (await sendLinkGuide(chatId));
  if (text.includes("کتاب‌خانه") || text.includes("کتاب‌ها") || text.includes("کتابخانه")) {
    return void (await sendLibraryRoot(chatId, from, { fresh: true }));
  }
  if (text.includes("آزمون")) {
    return void (await sendLibraryRoot(chatId, from, { hint: "یکی از کتاب‌ها را انتخاب کنید و «✍️ شروع آزمون» را بزنید." }));
  }
  if (text.includes("افزودن کتاب") || text.includes("کتاب جدید")) {
    const s = await getSession(chatId, from);
    if (!s) return void (await promptLink(chatId));
    return void (await sendUploadIntro(chatId));
  }
  if (text.includes("امتیاز")) return void (await sendPoints(chatId, from));
  if (text.includes("باز کردن اپ")) return void (await sendApp(chatId));
  if (text.includes("راهنما")) return void (await sendHelp(chatId));
  if (text.includes("خروج")) return void (await sendLogoutConfirm(chatId, from));

  // ۴) متن ناشناخته: اگر متصل نیست → خوش‌آمد و راهنمای اتصال
  const s = await getSession(chatId, from);
  if (!s) return void (await sendWelcomeUnlinked(chatId, from));
  return void (await sendFallback(chatId));
}

async function onCallback(cb: TgCallbackQuery): Promise<void> {
  const chatId = cb.message?.chat.id;
  const messageId = cb.message?.message_id;
  const from = cb.from;
  if (!chatId || !messageId) return void (await answerCb(cb.id));
  const data = cb.data ?? "";
  const parts = data.split(":");
  const tag = parts[0] ?? "";
  const a = parts[1] ?? "";

  switch (tag) {
    case "link":
      await answerCb(cb.id);
      return void (await sendLinkGuide(chatId));
    case "logout":
      await answerCb(cb.id);
      return void (await sendLogoutConfirm(chatId, from));
    case "logoutok":
      return void (await doLogout(chatId, from, cb.id));
    case "books":
      await answerCb(cb.id);
      return void (await sendLibraryRoot(chatId, from, { messageId, fresh: true }));
    case "ball": {
      await answerCb(cb.id);
      const sBall = chatSessions.get(chatId);
      if (sBall) sBall.browse = null; // «همهٔ کتاب‌ها» — بدون فیلتر مرحله‌ای
      return void (await sendLibraryList(chatId, from, null, { messageId, fresh: true }));
    }
    case "blvl":
    case "bookslvl": {
      // bookslvl = callback قدیمی راند ۱۸ (پیام‌های زندهٔ قدیمی هنوز آن را می‌فرستند)
      await answerCb(cb.id);
      if (!a) return void (await sendLibraryRoot(chatId, from, { messageId, fresh: true }));
      return void (await sendLibraryGrades(chatId, from, a === NO_LEVEL ? "" : a, { messageId, fresh: true }));
    }
    case "bgrd": {
      await answerCb(cb.id);
      const gi = Number.parseInt(a, 10);
      return void (await sendLibrarySubjects(chatId, from, Number.isFinite(gi) ? gi : -1, { messageId, fresh: true }));
    }
    case "bsub": {
      await answerCb(cb.id);
      const si = Number.parseInt(a, 10);
      return void (await sendLibraryList(chatId, from, Number.isFinite(si) ? si : null, { messageId, fresh: true }));
    }
    case "book":
      await answerCb(cb.id);
      return void (await sendBookCard(chatId, from, a, { messageId }));
    case "sum":
      await answerCb(cb.id);
      return void (await sendSummary(chatId, from, a));
    case "docx":
      await answerCb(cb.id);
      return void (await sendDocx(chatId, from, a));
    case "notes":
      await answerCb(cb.id);
      return void (await sendNotes(chatId, from, a));
    case "notesdocx":
      await answerCb(cb.id);
      return void (await sendNotesDocx(chatId, from, a));
    case "pod":
      await answerCb(cb.id);
      return void (await sendPodcast(chatId, from, a));
    case "orig":
      await answerCb(cb.id);
      return void (await sendOriginalPdf(chatId, from, a));
    case "quizpdf":
      // راند ۲۲ — برگهٔ رسمی نمونه‌سؤال به‌صورت PDF
      await answerCb(cb.id);
      return void (await sendQuizPdf(chatId, from, a));
    case "podsave":
      // راند ۲۲ — ذخیرهٔ پادکست در «پیام‌های ذخیره» خود کاربر (ارسال به from.id)
      await sendPodcast(from.id, from, a, { forSaved: true });
      return void (await answerCb(cb.id, "در پیام‌های ذخیره ذخیره شد ✅"));
    case "origsave":
      // راند ۲۲ — ذخیرهٔ کتاب اصلی در «پیام‌های ذخیره» خود کاربر
      await sendOriginalPdf(from.id, from, a, { forSaved: true });
      return void (await answerCb(cb.id, "در پیام‌های ذخیره ذخیره شد ✅"));
    case "upld":
      return void (await onUploadCallback(cb, chatId, messageId));
    case "quiz":
      await answerCb(cb.id);
      return void (await sendQuizPicker(chatId, from, a, messageId));
    case "qz":
      return void (await startQuiz(chatId, from, a, parts[2] ?? "MC", cb.id));
    case "ans":
      return void (await onQuizAnswer(cb, chatId, messageId));
    case "finish":
      return void (await onFinishCallback(cb, chatId));
    case "points":
      await answerCb(cb.id);
      return void (await sendPoints(chatId, from));
    case "help":
      await answerCb(cb.id);
      return void (await sendHelp(chatId));
    case "menu":
      await answerCb(cb.id);
      return void (await cmdStart(chatId, from));
    case "upnew":
      await answerCb(cb.id);
      return void (await sendUploadIntro(chatId));
    default:
      await answerCb(cb.id, "فرمان ناشناخته 🤔");
  }
}

async function handleUpdate(u: TgUpdate): Promise<void> {
  if (u.message) return void (await onMessage(u.message));
  if (u.callback_query) return void (await onCallback(u.callback_query));
}

/**
 * راند ۲۱ — صف سریال هر چت: پیام‌های یک کاربر به ترتیب پردازش می‌شوند اما حلقهٔ
 * نظرسنجی هرگز روی پردازش «منتظر» نمی‌ماند. اگر پردازشی (هرچند بعید) گیر کند،
 * فقط همان چت دیر پاسخ می‌گیرد — بات برای بقیه و برای /start زنده می‌ماند.
 */
interface ChatQueue {
  chain: Promise<void>;
  pending: number;
}
const chatQueues = new Map<number, ChatQueue>();

function enqueueUpdate(u: TgUpdate): void {
  const chatId = u.message?.chat.id ?? u.callback_query?.message?.chat.id ?? null;
  if (chatId == null) {
    // بدون chat قابل‌تشخیص — بی‌خیالِ صف، فقط لاگ
    void handleUpdate(u).catch((e: unknown) => log(`⚠️ خطا در پردازش پیام: ${errStr(e)}`));
    return;
  }
  let q = chatQueues.get(chatId);
  if (!q) {
    q = { chain: Promise.resolve(), pending: 0 };
    chatQueues.set(chatId, q);
  }
  const queue = q;
  queue.pending += 1;
  const next = queue.chain
    .then(() => handleUpdate(u))
    .catch((e: unknown) => {
      log(`⚠️ خطا در پردازش پیام: ${errStr(e)}`);
    })
    .then(() => {
      queue.pending -= 1;
      if (queue.pending <= 0 && chatQueues.get(chatId) === queue) chatQueues.delete(chatId);
    });
  queue.chain = next;
}

// ─────────────────────────────── پیکربندی + نظرسنجی ───────────────────────────────

async function refreshConfig(): Promise<void> {
  let cfg: BotConfig | null = null;
  const res = await mainAppFetch(
    "/api/v1/internal/telegram/config",
    { headers: { "x-bot-secret": BOT_SECRET } },
    10_000
  );
  if (!res) {
    if (state.configLogged !== "down") {
      log("⚠️ ارتباط با اپ اصلی برقرار نیست — تلاش مجدد در ۳۰ ثانیه…");
      state.configLogged = "down";
    }
    return;
  }
  if (!res.ok) {
    if (state.configLogged !== "down") {
      log(`⚠️ پاسخ پیکربندی: HTTP ${res.status} — تلاش مجدد در ۳۰ ثانیه…`);
      state.configLogged = "down";
    }
    return;
  }
  cfg = await readJson<BotConfig>(res);
  if (!cfg) {
    if (state.configLogged !== "down") {
      log("⚠️ پاسخ پیکربندی نامعتبر — تلاش مجدد در ۳۰ ثانیه…");
      state.configLogged = "down";
    }
    return;
  }

  state.miniAppUrl = cfg.miniAppUrl || null;
  if (cfg.botUsername) state.botUsername = cfg.botUsername;

  if (!cfg.enabled || !cfg.token) {
    state.botToken = null;
    if (state.configLogged !== "waiting" && state.configLogged !== "token-error") {
      log("توکن بات تنظیم نشده — منتظر تنظیمات مدیر…");
      state.configLogged = "waiting";
    }
    return;
  }

  if (cfg.token !== state.botToken) {
    state.botToken = cfg.token;
    state.configLogged = "active";
    await activateBot();
  }
}

async function activateBot(): Promise<void> {
  if (!state.botToken) return;
  try {
    await tg("deleteWebhook", { drop_pending_updates: false });
  } catch (e) {
    log(`⚠️ deleteWebhook: ${errStr(e)}`);
  }
  try {
    const me = await tg<TgUser>("getMe");
    if (me.username) state.botUsername = me.username;
    log(`بات فعال شد${state.botUsername ? ` — @${state.botUsername}` : ""} 🤖 نظرسنجی پیام‌ها آغاز شد`);
  } catch (e) {
    log(`⚠️ فعال‌سازی بات ناموفق: ${errStr(e)} — در چرخهٔ بعدی دوباره تلاش می‌شود`);
    state.botToken = null;
    state.configLogged = "token-error";
    return;
  }
  // فرمان‌های فارسی (best-effort)
  try {
    await tg("setMyCommands", {
      commands: [
        { command: "start", description: "شروع و منوی اصلی" },
        { command: "books", description: "کتاب‌خانه هوشمند" },
        { command: "upload", description: "افزودن کتاب (ارسال PDF)" },
        { command: "app", description: "باز کردن مینی‌اپ" },
        { command: "points", description: "امتیازهای من" },
        { command: "link", description: "اتصال حساب" },
        { command: "logout", description: "خروج و قطع اتصال" },
        { command: "help", description: "راهنمای بات" },
      ],
    });
  } catch {
    /* بهترین تلاش */
  }
}

async function pollLoop(): Promise<void> {
  g.__tgBotLoop = true;
  g.__tgBotBeat = Date.now();
  while (alive()) {
    g.__tgBotBeat = Date.now();
    if (!state.botToken) {
      await sleep(2500);
      continue;
    }
    try {
      const updates = await tg<TgUpdate[]>(
        "getUpdates",
        { offset, timeout: 30, allowed_updates: ["message", "callback_query"] },
        { timeoutMs: 40_000, longPoll: true }
      );
      for (const u of updates) {
        if (!alive()) break;
        offset = u.update_id + 1;
        g.__tgBotOffset = offset;
        enqueueUpdate(u); // غیرمسدودکننده — حلقه هرگز روی پردازش گیر نمی‌کند (رفع راند ۲۱)
      }
    } catch (e) {
      if (e instanceof BotApiError) {
        if (e.code === 409) {
          await sleep(3000);
          continue;
        }
        if (e.code === 401) {
          log("⚠️ توکن بات نامعتبر است — منتظر پیکربندی مجدد مدیر…");
          state.botToken = null;
          state.configLogged = "token-error";
          await sleep(2000);
          continue;
        }
        if (e.code === 429) {
          await sleep(10_000);
          continue;
        }
        log(`⚠️ خطای API تلگرام (${e.code}): ${e.description}`);
        await sleep(5000);
      } else {
        log(`⚠️ خطای شبکه در نظرسنجی: ${errStr(e)}`);
        await sleep(5000);
      }
    }
  }
  g.__tgBotLoop = false;
  log("حلقهٔ نظرسنجی این نسخه متوقف شد (بارگذاری مجدد)");
}

// ─────────────────────────────── پاک‌سازی دوره‌ای ───────────────────────────────

const cleanTimer = setInterval(() => {
  if (!alive()) {
    clearInterval(cleanTimer);
    return;
  }
  const now = Date.now();
  for (const [sid, s] of quizSessions) {
    if (now - s.lastTouch > QUIZ_IDLE_MS) {
      quizSessions.delete(sid);
      if (quizByChat.get(s.chatId) === sid) quizByChat.delete(s.chatId);
      void sendMessage(
        s.chatId,
        `⏱ آزمون «${esc(s.bookTitle)}» به دلیل ${faNum(10)} دقیقه بی‌فعالیت متوقف شد.\nهر وقت آماده بودی دوباره شروع کن! 💪`,
        [[{ text: "🔄 شروع مجدد", callback_data: `qz:${s.bookId}:${s.model}` }]]
      );
    }
  }
  for (const [chatId, s] of chatSessions) {
    if (now - s.at > SESSION_TTL_MS) chatSessions.delete(chatId);
  }
  for (const [chatId, w] of uploadSessions) {
    if (now - w.lastTouch > UPLOAD_IDLE_MS) {
      uploadSessions.delete(chatId);
      void sendMessage(
        chatId,
        `⏱ افزودن کتاب (${trunc(w.title || w.fileName, 40)}) به دلیل ${faNum(15)} دقیقه بی‌فعالیت متوقف شد.\nهر وقت خواستید دوباره فایل PDF بفرستید یا /upload را بزنید. 📚`
      );
    }
  }
}, 60_000);

const configTimer = setInterval(() => {
  if (!alive()) {
    clearInterval(configTimer);
    return;
  }
  void refreshConfig().catch(() => undefined);
}, 30_000);

// ─────────────────────── نگهبان ضربان حلقهٔ نظرسنجی (راند ۲۱) ───────────────────────
// اگر حلقه به هر دلیلی بیش از ۵ دقیقه ضربان نزند: long-pollهای احتمالاً گیرکرده را
// abort می‌کنیم (آزادسازی حلقه) و در صورت مرگ کامل حلقه، دوباره راه‌اندازی می‌کنیم.
const beatTimer = setInterval(() => {
  if (!alive()) {
    clearInterval(beatTimer);
    return;
  }
  const last = g.__tgBotBeat ?? 0;
  if (last && Date.now() - last > 5 * 60_000) {
    log("⚠️ نظرسنجی بیش از ۵ دقیقه بی‌ضربان مانده — بازیابی حلقه…");
    for (const ctrl of [...(g.__tgBotAborts ?? [])]) ctrl.abort(); // آزادسازی گیر احتمالی
    g.__tgBotBeat = Date.now(); // جلوگیری از راه‌اندازی مکرر
    if (!g.__tgBotLoop) void pollLoop(); // اگر حلقه کاملاً مرده، دوباره
  }
}, 60_000);

// ─────────────────────────────── سرویس سلامت (HTTP) ───────────────────────────────

if (!g.__tgBotServer) {
  g.__tgBotServer = Bun.serve({
    port: PORT,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
        return Response.json({ ok: true, service: "telegram-bot", uptime: Math.floor(process.uptime()) });
      }
      return new Response(JSON.stringify({ ok: false, error: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    },
  });
  log(`سرویس سلامت روی پورت ${faNum(PORT)} فعال شد`);
}

// ─────────────────────────────── شروع ───────────────────────────────

log("🚀 بات تلگرام «پلتفرم آموزش هوشمند ایران» آغاز به کار کرد");
void refreshConfig().catch(() => undefined);
void pollLoop();
