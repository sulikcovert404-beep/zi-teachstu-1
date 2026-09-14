"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiClientError } from "@/lib/app/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorState } from "@/components/shared/blocks";
import { cn } from "@/lib/utils";
import { Bot, Eraser, Loader2, Send, Sparkles, User } from "lucide-react";
import { PaywallNotice, isPaywallError } from "./shared";

const ASSISTANT_TASKS: Array<{ value: string; label: string }> = [
  { value: "GENERAL", label: "عمومی" },
  { value: "LESSON_PLAN", label: "طراحی درس" },
  { value: "QUESTION_IDEAS", label: "تولید سؤال" },
  { value: "RUBRIC", label: "روبریک ارزیابی" },
  { value: "SUMMARY", label: "خلاصه" },
  { value: "CLASS_ANALYSIS", label: "تحلیل کلاس" },
];

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

const QUICK_PROMPTS: Array<{ task: string; label: string; text: string }> = [
  {
    task: "LESSON_PLAN",
    label: "طراحی طرح درس",
    text: "برای درس ریاضی مبحث «معادله خط» پایه دهم، یک طرح درس ۹۰ دقیقه‌ای با اهداف، فعالیت‌ها و ارزشیابی بنویس.",
  },
  {
    task: "RUBRIC",
    label: "ساخت روبریک",
    text: "یک روبریک ارزیابی ۴ سطحی برای پروژه گروهی علوم پایه هشتم با معیارهای شفاف بنویس.",
  },
  {
    task: "CLASS_ANALYSIS",
    label: "تحلیل عملکرد",
    text: "میانگین کلاس من در آخرین آزمون پایین بوده است؛ چند راهکار هدفمند برای بهبود عملکرد کلاس پیشنهاد بده.",
  },
];

// Teacher Assistant (spec §11.10) — single-panel chat with task selection,
// history kept in local state (not thread-based).
export function AssistantSection() {
  const [task, setTask] = useState("GENERAL");
  const [message, setMessage] = useState("");
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [history, busy]);

  async function send() {
    const text = message.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setBlocked(null);
    const optimistic: ChatMessage = { id: `tmp-${Date.now()}`, role: "user", content: text };
    setHistory((h) => [...h, optimistic]);
    setMessage("");
    try {
      const res = await api<{ content: string }>("/api/v1/teacher/assistant", {
        method: "POST",
        body: JSON.stringify({
          message: text,
          task: task !== "GENERAL" ? task : undefined,
        }),
      });
      setHistory((h) => [
        ...h,
        { id: `ai-${Date.now()}`, role: "assistant", content: res.content },
      ]);
    } catch (e) {
      setHistory((h) => h.filter((m) => m.id !== optimistic.id));
      setMessage(text);
      if (isPaywallError(e)) {
        setBlocked(e instanceof ApiClientError ? e.message : "سهمیهٔ امروز شما به پایان رسیده است.");
      } else {
        setError(e instanceof ApiClientError ? e.message : "ارسال درخواست ناموفق بود.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-border/60 flex flex-col h-[600px]">
      <CardContent className="p-0 flex flex-col h-full">
        <div className="px-4 py-3 border-b border-border/60 flex items-center gap-3 flex-wrap">
          <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Bot className="h-5 w-5" aria-hidden />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold">دستیار معلم</p>
            <p className="text-[11px] text-muted-foreground">
              طراحی درس، تولید سؤال، روبریک، خلاصه و تحلیل کلاس
            </p>
          </div>
          {history.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-9 text-xs"
              onClick={() => {
                setHistory([]);
                setError(null);
                setBlocked(null);
              }}
            >
              <Eraser className="h-3.5 w-3.5 ml-1" aria-hidden />
              پاک کردن گفتگو
            </Button>
          )}
        </div>

        <div className="px-4 py-2.5 border-b border-border/60 flex items-center gap-2 flex-wrap">
          <Label className="text-xs text-muted-foreground shrink-0">نوع درخواست:</Label>
          <Select value={task} onValueChange={setTask}>
            <SelectTrigger className="w-40 h-9 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ASSISTANT_TASKS.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {error && <div className="px-4 pt-3"><ErrorState message={error} /></div>}
        {blocked && <div className="px-4 pt-3"><PaywallNotice message={blocked} /></div>}

        <ScrollArea className="flex-1 px-4 py-4">
          {history.length === 0 && !busy ? (
            <div className="space-y-4">
              <EmptyState
                icon={Sparkles}
                title="چطور می‌توانم کمک کنم؟"
                description="درخواست خود را بنویسید یا یکی از نمونه‌های زیر را انتخاب کنید؛ پاسخ در همین صفحه نمایش داده می‌شود."
              />
              <div className="grid sm:grid-cols-3 gap-2.5">
                {QUICK_PROMPTS.map((p) => (
                  <Button
                    key={p.label}
                    variant="outline"
                    className="h-auto py-3 px-3.5 justify-start text-right"
                    onClick={() => {
                      setTask(p.task);
                      setMessage(p.text);
                    }}
                  >
                    <span className="min-w-0">
                      <Badge variant="secondary" className="text-[9px] mb-1 block w-fit">{p.label}</Badge>
                      <span className="block text-[11px] text-muted-foreground leading-5 line-clamp-2">{p.text}</span>
                    </span>
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {history.map((m) => (
                <div key={m.id} className={cn("flex gap-2.5", m.role === "user" ? "flex-row-reverse" : "")}>
                  <div
                    className={cn(
                      "h-7 w-7 rounded-lg flex items-center justify-center shrink-0",
                      m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                    )}
                    aria-hidden
                  >
                    {m.role === "user" ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                  </div>
                  <div
                    className={cn(
                      "rounded-xl px-3.5 py-2.5 max-w-[85%] text-sm leading-7 whitespace-pre-wrap",
                      m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                    )}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {busy && (
                <div className="flex gap-2.5">
                  <div className="h-7 w-7 rounded-lg bg-muted flex items-center justify-center" aria-hidden>
                    <Bot className="h-4 w-4" />
                  </div>
                  <div className="rounded-xl px-3.5 py-2.5 bg-muted flex items-center gap-1.5 text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    <span className="text-xs">در حال پاسخ…</span>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </ScrollArea>

        <div className="p-3 border-t border-border/60 flex gap-2 items-end">
          <Textarea
            dir="auto"
            rows={2}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="درخواست خود را بنویسید… (Enter برای ارسال)"
            className="resize-none min-h-10"
            aria-label="متن درخواست"
            disabled={busy}
          />
          <Button
            onClick={() => void send()}
            disabled={busy || !message.trim()}
            className="shrink-0 h-10"
            aria-label="ارسال درخواست"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
