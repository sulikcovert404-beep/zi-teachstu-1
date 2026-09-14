import { Errors } from "./errors";

// Shared secret between the main app and the telegram-bot mini-service (localhost only).
// Overridable via env on both sides; default is a sandbox-internal value (not a real secret
// in the credential sense — it gates localhost service-to-service calls).
export const TELEGRAM_BOT_SECRET = process.env.TELEGRAM_BOT_SECRET ?? "aep-internal-bot-secret";

// Guard for internal bot-service endpoints. The bot service runs on the same host and
// authenticates with X-Bot-Secret; browser clients can never reach these without it.
export function requireBotSecret(req: Request): void {
  const provided = req.headers.get("x-bot-secret");
  if (!provided || provided !== TELEGRAM_BOT_SECRET) {
    throw Errors.forbidden("دسترسی داخلی نامعتبر.");
  }
}
