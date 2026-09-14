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
 *   • کتاب‌خانه/خلاصه (متن + Word)/پادکست (WAV)/آزمون تعاملی/امتیازها — همه از
 *     همان API عمومی نسخهٔ وب (/api/v1/books، /api/v1/me/points، …).
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
}

interface BooksListData {
  canUpload: boolean;
  canUploadLabel: string;
  role: string;
  books: BookSummary[];
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

async function readJson<T>(res: Response | null | undefined): Promise<T | null> {
  if (!res) return null;
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function apiErrorText(data: unknown): string {
  const msg = (data as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof msg === "string" && msg.trim() ? msg.trim() : "ارتباط با سرور برقرار نشد، دوباره تلاش کنید.";
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
    if (init?.body && !headers.has("content-type")) headers.set("content-type", "application/json");
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

async function promptLink(chatId: number): Promise<void> {
  await sendMessage(
    chatId,
    "🔐 برای این کار ابتدا باید حساب خود را متصل کنید.\n\nبرای اتصال، در نسخهٔ وب (یا مینی‌اپ) وارد حساب خود شوید و از بخش پروفایل کد اتصال بگیرید، سپس آن را همین‌جا بفرستید.",
    [[{ text: "🔗 اتصال حساب من", callback_data: "link" }]]
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
    "📄 خلاصهٔ کتاب‌ها را بفرستم (متن + فایل Word)",
    "🎧 پادکست صوتی کتاب‌ها را برایتان بفرستم",
    "✍️ با نمونه‌سؤال‌های هوشمند محکتان کنم",
    "⭐ امتیازها و رکوردهایتان را دنبال کنم",
    "",
    "برای شروع، حساب کاربری‌تان را متصل کنید 👇",
  ];
  await sendMessage(chatId, lines.join("\n"), [[{ text: "🔗 اتصال حساب من", callback_data: "link" }]]);
  await sendMessage(
    chatId,
    "برای اتصال، در نسخهٔ وب (یا مینی‌اپ) وارد حساب خود شوید و از بخش پروفایل کد اتصال بگیرید، سپس آن را همین‌جا بفرستید. 🔢"
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
    "📚 <b>کتاب‌خانه</b> — فهرست کتاب‌های هوشمند شما با فیلتر دورهٔ تحصیلی؛ هر کتاب دارای خلاصه، جزوه، شکل، نمونه‌سؤال و پادکست است.",
    "📄 <b>خلاصهٔ کتاب</b> — خلاصهٔ کامل به‌صورت متن + فایل Word قابل دانلود.",
    "📒 <b>جزوهٔ شبامتحان</b> — تعاریف، فرمول‌ها و نکات کنکوری، به‌صورت متن + Word.",
    "🎧 <b>پادکست صوتی</b> — نسخهٔ شنیداری کتاب؛ در مسیر هم گوش بدهید!",
    "✍️ <b>آزمون نمونه</b> — چهارگزینه‌ای، درست/غلط، جای خالی، ترکیبی و تشریحی؛ همراه با مرور کامل پاسخ‌ها.",
    "⭐ <b>امتیازهای من</b> — مجموع امتیاز، ۳۰ روز اخیر و آخرین دستاوردها.",
    "🎓 <b>باز کردن اپ</b> — مینی‌اپ کامل پلتفرم، همین‌جا داخل تلگرام.",
    "🔗 <b>اتصال حساب</b> — با فرستادن کد ۶ رقمی از بخش پروفایل وب (/link).",
    "🚪 <b>خروج</b> — قطع اتصال حساب تلگرام از پلتفرم (/logout).",
    "",
    "💡 نکته: نتیجهٔ آزمون‌ها در پلتفرم ثبت می‌شود و با بهبود رکوردتان امتیاز می‌گیرید! 🚀",
    "",
    "فرمان‌ها: /start · /books · /app · /points · /link · /logout · /help",
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

// ─────────────────────────────── کتاب‌خانه ───────────────────────────────

async function sendBooksList(
  chatId: number,
  from: TgUser,
  opts: { messageId?: number; fresh?: boolean; hint?: string; level?: string | null } = {}
): Promise<void> {
  await chatAction(chatId, "typing");

  // کش ۶۰ ثانیه‌ای هر چت (دکمهٔ «به‌روزرسانی» آن را دور می‌زند)
  const cacheKey = opts.level ?? "";
  let data: BooksListData | null = null;
  const cached = chatSessions.get(chatId)?.booksCache;
  if (!opts.fresh && cached && cached.key === cacheKey && Date.now() - cached.at < 60_000) data = cached.data;

  if (!data) {
    const path = opts.level ? `/api/v1/books?level=${encodeURIComponent(opts.level)}` : "/api/v1/books";
    const res = await authed(chatId, from, path);
    if (res === "unlinked") return void (await promptLink(chatId));
    if (!res || !res.ok) {
      const msg = apiErrorText(await readJson(res));
      const text = `⚠️ ${esc(msg)}`;
      if (opts.messageId) return void (await editMessage(chatId, opts.messageId, text));
      return void (await sendMessage(chatId, text));
    }
    data = await readJson<BooksListData>(res);
    if (!data) {
      if (opts.messageId) return void (await editMessage(chatId, opts.messageId, NET_ERR));
      return void (await sendMessage(chatId, NET_ERR));
    }
    const s = chatSessions.get(chatId);
    if (s) s.booksCache = { at: Date.now(), key: cacheKey, data };
  }

  const all = data.books ?? [];
  const books = all.slice(0, BOOKS_PAGE_LIMIT);
  const active = opts.level ? LEVELS_FA.find((l) => l.code === opts.level) : null;
  const kb: InlineKeyboard = books.map((b) => [
    { text: trunc(`${bookStatusEmoji(b.status)} ${b.title}${b.gradeLevel ? ` — پایهٔ ${b.gradeLevel}` : ""}`, 58), callback_data: `book:${b.id}` },
  ]);

  // فیلتر دورهٔ تحصیلی (round 18): «همه» + دو دوره در هر ردیف
  const levelRows: InlineKeyboard = [[{ text: "✨ همهٔ دوره‌ها", callback_data: "bookslvl:" }]];
  const levelBtns: InlineButton[] = LEVELS_FA.map((l) => ({
    text: `${l.emoji}${active?.code === l.code ? "✔️" : ""} ${l.label}`,
    callback_data: `bookslvl:${l.code}`,
  }));
  for (let i = 0; i < levelBtns.length; i += 2) {
    levelRows.push(levelBtns.slice(i, i + 2));
  }
  kb.push(...levelRows);
  kb.push([{ text: "🔄 به‌روزرسانی", callback_data: active ? `bookslvl:${active.code}` : "books" }]);

  let text: string;
  if (all.length === 0) {
    text =
      `📚 <b>کتاب‌خانه هوشمند</b>${active ? ` — ${active.emoji} ${esc(active.label)}` : ""}\n\nهنوز کتابی برای شما ثبت نشده است! 🌱\nبه‌محض افزودن کتاب توسط مدیر یا معلمان، همین‌جا نمایش داده می‌شود.`;
  } else {
    const structByLevel = new Map<string, number>();
    for (const b of all) {
      const key = b.levelLabel ?? "بدون دوره";
      structByLevel.set(key, (structByLevel.get(key) ?? 0) + 1);
    }
    const structText =
      !active && all.length > 1
        ? `\n📕 بر اساس دوره: ${[...structByLevel.entries()].map(([l, n]) => `${esc(l)} (${faNum(n)})`).join(" · ")}`
        : "";
    text = `📚 <b>کتاب‌خانه هوشمند</b>${active ? ` — ${active.emoji} ${esc(active.label)}` : ""}\n\n${faNum(all.length)} کتاب برای شما قابل مشاهده است — برای جزئیات، روی عنوان کتاب بزنید.${structText}`;
    if (all.length > books.length) text += `\n(و ${faNum(all.length - books.length)} کتاب دیگر… از نسخهٔ وب)`;
    if (data.canUpload) text += "\n\n➕ شما می‌توانید کتاب جدید اضافه کنید — از نسخهٔ وب یا مینی‌اپ.";
  }
  if (opts.hint) text += `\n\n💡 ${esc(opts.hint)}`;

  if (opts.messageId) await editMessage(chatId, opts.messageId, text, kb);
  else await sendMessage(chatId, text, kb);
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
  const best = bestAttempt(b.myAttempts);
  if (best) {
    lines.push("", `🏆 بهترین رکورد شما: ${faNum(best.score)} از ${faNum(best.maxScore)} (${faNum(b.myAttempts.length)} تلاش)`);
  }
  lines.push("", "💡 شکل‌های آموزشی را در نسخهٔ وب/مینی‌اپ کتاب ببینید.");

  const kb: InlineKeyboard = [
    [{ text: "📄 خلاصه", callback_data: `sum:${b.id}` }],
    [{ text: "📒 جزوهٔ شبامتحان", callback_data: `notes:${b.id}` }],
    [{ text: "🎧 پادکست", callback_data: `pod:${b.id}` }],
    [{ text: "✍️ شروع آزمون", callback_data: `quiz:${b.id}` }],
    [{ text: "🔙 بازگشت", callback_data: "books" }],
  ];
  const text = lines.join("\n");
  if (opts.messageId) await editMessage(chatId, opts.messageId, text, kb);
  else await sendMessage(chatId, text, kb);
}

// ─────────────────────────────── خلاصه (متن + Word) ───────────────────────────────

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
      text += "\n\n💡 در نسخهٔ وب می‌توانید با «چاپ صفحه» نسخهٔ PDF هم دریافت کنید.";
      kb = [[{ text: "📥 دریافت نسخهٔ Word", callback_data: `docx:${b.id}` }]];
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
  const res = await authed(chatId, from, `/api/v1/books/${encodeURIComponent(bookId)}/summary.docx`, undefined, 90_000);
  if (res === "unlinked") return void (await promptLink(chatId));
  if (!res || !res.ok) return void (await sendMessage(chatId, `⚠️ ${esc(apiErrorText(await readJson(res)))}`));
  const buf = await res.arrayBuffer().catch(() => null);
  if (!buf || buf.byteLength === 0) return void (await sendMessage(chatId, NET_ERR));
  if (buf.byteLength > 49 * 1024 * 1024) {
    return void (await sendMessage(chatId, "⚠️ حجم فایل برای ارسال در تلگرام زیاد است — لطفاً از نسخهٔ وب دانلود کنید."));
  }

  const fd = new FormData();
  fd.append("chat_id", String(chatId));
  fd.append(
    "document",
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
    `${safeFilename(b.title)}.docx`
  );
  fd.append("caption", `📄 خلاصهٔ Word کتاب «${trunc(b.title, 80)}» — پلتفرم آموزش هوشمند ایران 🎓`);
  const sent = await safeTg<TgMessage>("sendDocument", undefined, { multipart: fd, timeoutMs: 120_000 });
  if (!sent) await sendMessage(chatId, "⚠️ ارسال فایل ناموفق بود، دوباره تلاش کنید.");
}

// ─────────────────────────────── جزوهٔ شبامتحان (متن + Word — round 18) ───────────────────────────────

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
      text += "\n\n💡 تعاریف، فرمول‌ها و نکات کنکوری — برای مرور سریع شبامتحان.";
      kb = [[{ text: "📥 دریافت نسخهٔ Word جزوه", callback_data: `notesdocx:${b.id}` }]];
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
  const res = await authed(chatId, from, `/api/v1/books/${encodeURIComponent(bookId)}/notes.docx`, undefined, 90_000);
  if (res === "unlinked") return void (await promptLink(chatId));
  if (!res || !res.ok) return void (await sendMessage(chatId, `⚠️ ${esc(apiErrorText(await readJson(res)))}`));
  const buf = await res.arrayBuffer().catch(() => null);
  if (!buf || buf.byteLength === 0) return void (await sendMessage(chatId, NET_ERR));
  if (buf.byteLength > 49 * 1024 * 1024) {
    return void (await sendMessage(chatId, "⚠️ حجم فایل برای ارسال در تلگرام زیاد است — لطفاً از نسخهٔ وب دانلود کنید."));
  }

  const fd = new FormData();
  fd.append("chat_id", String(chatId));
  fd.append(
    "document",
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
    `jozve-${safeFilename(b.title)}.docx`
  );
  fd.append("caption", `📒 جزوهٔ شبامتحان کتاب «${trunc(b.title, 80)}» — پلتفرم آموزش هوشمند ایران 🎓`);
  const sent = await safeTg<TgMessage>("sendDocument", undefined, { multipart: fd, timeoutMs: 120_000 });
  if (!sent) await sendMessage(chatId, "⚠️ ارسال فایل ناموفق بود، دوباره تلاش کنید.");
}

// ─────────────────────────────── پادکست (WAV) ───────────────────────────────

async function sendPodcast(chatId: number, from: TgUser, bookId: string): Promise<void> {
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
  const res = await authed(chatId, from, `/api/v1/books/${encodeURIComponent(bookId)}/podcast`, undefined, 120_000);
  if (res === "unlinked") return void (await promptLink(chatId));
  if (!res || !res.ok) return void (await sendMessage(chatId, `⚠️ ${esc(apiErrorText(await readJson(res)))}`));
  const buf = await res.arrayBuffer().catch(() => null);
  if (!buf || buf.byteLength === 0) return void (await sendMessage(chatId, NET_ERR));
  if (buf.byteLength > 49 * 1024 * 1024) {
    return void (await sendMessage(chatId, "⚠️ فایل صوتی برای تلگرام بزرگ است — لطفاً از نسخهٔ وب دانلود کنید."));
  }

  const fd = new FormData();
  fd.append("chat_id", String(chatId));
  fd.append("audio", new Blob([buf], { type: "audio/wav" }), `${safeFilename(b.title)}.wav`);
  fd.append("title", trunc(`پادکست کتاب ${b.title}`, 64));
  fd.append("performer", "پلتفرم آموزش هوشمند");
  const caption = `🎧 پادکست صوتی کتاب «${trunc(b.title, 80)}»${
    b.podcastDurationSec ? ` — ${durationFa(b.podcastDurationSec)}` : ""
  }\nشنیدن شما خوش! 🎶`;
  fd.append("caption", caption);
  if (b.podcastDurationSec) fd.append("duration", String(Math.round(b.podcastDurationSec)));
  const sent = await safeTg<TgMessage>("sendAudio", undefined, { multipart: fd, timeoutMs: 120_000 });
  if (!sent) await sendMessage(chatId, "⚠️ ارسال پادکست ناموفق بود، دوباره تلاش کنید.");
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
    [[{ text: "🔗 اتصال حساب من", callback_data: "link" }]]
  );
}

// ─────────────────────────────── خروج / قطع اتصال (round 18) ───────────────────────────────

async function sendLogoutConfirm(chatId: number, from: TgUser): Promise<void> {
  const s = chatSessions.get(chatId);
  if (!s) {
    // حسابی متصل نیست — فقط راهنمایی کوتاه
    return void (await sendMessage(
      chatId,
      "🚪 حسابی از این تلگرام متصل نیست — نیازی به خروج نیست! ✅\nاگر خواستی وصل شوی، کد ۶ رقمی پروفایل وب را بفرست. 🔢",
      [[{ text: "🔗 اتصال حساب من", callback_data: "link" }]]
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
    "🚪 <b>اتصال حساب قطع شد.</b>\n\nاز همراهی‌تان سپاسگزاریم! 🙏\nهر وقت خواستید دوباره برگردید، کد اتصال ۶ رقمی را از پروفایل وب بگیرید و همین‌جا بفرستید. 🔢",
    [[{ text: "🔗 اتصال مجدد", callback_data: "link" }]]
  );
}

// ─────────────────────────────── مسیریابی پیام‌ها ───────────────────────────────

async function cmdStart(chatId: number, from: TgUser): Promise<void> {
  await chatAction(chatId, "typing");
  const s = await getSession(chatId, from);
  if (s) await sendWelcomeLinked(chatId, from, s);
  else await sendWelcomeUnlinked(chatId, from);
}

async function onMessage(m: TgMessage): Promise<void> {
  const chatId = m.chat.id;
  const from = m.from;
  if (!from || from.is_bot) return;
  const text = (m.text ?? "").trim();
  if (!text) {
    await sendMessage(chatId, "💬 فعلاً فقط پیام متنی را پشتیبانی می‌کنم 🙏");
    return;
  }

  // ۰) پاسخ تایپیِ سؤال تشریحیِ در انتظار
  if (await captureShortAnswer(chatId, text)) return;

  // ۱) فرمان‌ها
  const cmdMatch = /^\/([a-zA-Z_]+)(?:@\w+)?/.exec(text);
  const cmd = cmdMatch?.[1]?.toLowerCase();
  if (cmd === "start") return void (await cmdStart(chatId, from));
  if (cmd === "app") return void (await sendApp(chatId));
  if (cmd === "books") return void (await sendBooksList(chatId, from, { fresh: true }));
  if (cmd === "points") return void (await sendPoints(chatId, from));
  if (cmd === "help") return void (await sendHelp(chatId));
  if (cmd === "link") return void (await sendLinkGuide(chatId));
  if (cmd === "logout") return void (await sendLogoutConfirm(chatId, from));
  if (cmd) return void (await sendMessage(chatId, "🤔 این فرمان را نمی‌شناسم — /help را امتحان کن 💡"));

  // ۲) کد اتصال ۶ رقمی
  if (/^\d{6}$/.test(text)) return void (await tryLinkCode(chatId, from, text));

  // ۳) برچسب‌های منوی اصلی
  if (text.includes("کتاب‌خانه") || text.includes("کتاب‌ها") || text.includes("کتابخانه")) {
    return void (await sendBooksList(chatId, from, { fresh: true }));
  }
  if (text.includes("آزمون")) {
    return void (await sendBooksList(chatId, from, { hint: "یکی از کتاب‌ها را انتخاب کنید و «✍️ شروع آزمون» را بزنید." }));
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
      return void (await sendBooksList(chatId, from, { messageId, fresh: true }));
    case "bookslvl": {
      await answerCb(cb.id);
      return void (await sendBooksList(chatId, from, { messageId, fresh: true, level: a || null }));
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
    default:
      await answerCb(cb.id, "فرمان ناشناخته 🤔");
  }
}

async function handleUpdate(u: TgUpdate): Promise<void> {
  if (u.message) return void (await onMessage(u.message));
  if (u.callback_query) return void (await onCallback(u.callback_query));
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
  while (alive()) {
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
        try {
          await handleUpdate(u);
        } catch (e) {
          log(`⚠️ خطا در پردازش پیام: ${errStr(e)}`);
        }
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
}, 60_000);

const configTimer = setInterval(() => {
  if (!alive()) {
    clearInterval(configTimer);
    return;
  }
  void refreshConfig().catch(() => undefined);
}, 30_000);

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
