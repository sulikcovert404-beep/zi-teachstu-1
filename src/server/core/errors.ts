// Spec §33 — standard API error format: { error: { code, message } }
export class ApiError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const Errors = {
  unauthenticated: () => new ApiError("UNAUTHENTICATED", "ابتدا وارد حساب خود شوید.", 401),
  forbidden: (msg = "شما به این بخش دسترسی ندارید.") => new ApiError("FORBIDDEN", msg, 403),
  notFound: (what = "منبع") => new ApiError("NOT_FOUND", `${what} یافت نشد.`, 404),
  validation: (msg = "داده ورودی معتبر نیست.") => new ApiError("VALIDATION_ERROR", msg, 422),
  conflict: (code: string, msg: string) => new ApiError(code, msg, 409),
  rateLimited: (msg = "سهمیه امروز شما به پایان رسیده است.") => new ApiError("RATE_LIMITED", msg, 429),
  internal: () => new ApiError("INTERNAL_ERROR", "خطای داخلی سرور رخ داد. لطفاً دوباره تلاش کنید.", 500),
  providerUnavailable: (msg = "سرویس هوش مصنوعی موقتاً در دسترس نیست. لطفاً کمی بعد دوباره تلاش کنید.") =>
    new ApiError("AI_PROVIDER_UNAVAILABLE", msg, 503),
  channelNotConfigured: (msg = "این کانال هنوز پیکربندی نشده است.") =>
    new ApiError("CHANNEL_NOT_CONFIGURED", msg, 501),
};
