"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiClientError } from "@/lib/app/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorState, faDateTime } from "@/components/shared/blocks";
import { Sparkles, Send, Loader2, MessageCircle, Plus, Bot, User, Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ThreadSummary { id: string; title: string; createdAt: string; _count?: { messages: number } }
interface Msg { id: string; role: string; content: string; createdAt: string }

// AI Tutor chat (spec §11.1) — quota-gated with Persian paywall feedback (spec §42)
export function TutorChat() {
  const { toast } = useToast();
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quotaBlocked, setQuotaBlocked] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadThreads = useCallback(async () => {
    try {
      const res = await api<{ threads: ThreadSummary[] }>("/api/v1/student/tutor/threads");
      setThreads(res.threads);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "بارگذاری گفتگوها ناموفق بود.");
      setThreads([]);
    }
  }, []);

  useEffect(() => { void loadThreads(); }, [loadThreads]);

  const openThread = useCallback(async (id: string | null) => {
    setActiveThread(id);
    setMessages([]);
    setQuotaBlocked(null);
    if (!id) return;
    try {
      const res = await api<{ messages: Msg[] }>(`/api/v1/student/tutor/threads/${id}`);
      setMessages(res.messages);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "بارگذاری پیام‌ها ناموفق بود.");
    }
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setQuotaBlocked(null);
    const optimistic: Msg = { id: `tmp-${Date.now()}`, role: "user", content: text, createdAt: new Date().toISOString() };
    setMessages((m) => [...m, optimistic]);
    setDraft("");
    try {
      const res = await api<{ threadId: string; userMessage: Msg; assistantMessage: Msg }>("/api/v1/student/tutor/chat", {
        method: "POST",
        body: JSON.stringify({ threadId: activeThread ?? undefined, message: text }),
      });
      setActiveThread(res.threadId);
      setMessages((m) => [...m.filter((x) => x.id !== optimistic.id), res.userMessage, res.assistantMessage]);
      void loadThreads();
    } catch (e) {
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      setDraft(text);
      if (e instanceof ApiClientError && (e.code === "RATE_LIMITED" || e.status === 429)) {
        setQuotaBlocked(e.message);
      } else if (e instanceof ApiClientError && e.code === "FORBIDDEN") {
        setQuotaBlocked(e.message);
      } else {
        setError(e instanceof ApiClientError ? e.message : "ارسال پیام ناموفق بود.");
        toast({ title: "خطا", description: "ارسال پیام ناموفق بود.", variant: "destructive" });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid lg:grid-cols-[260px_1fr] gap-4">
      {/* Threads list */}
      <Card className="border-border/60 h-fit">
        <CardContent className="p-3">
          <div className="flex items-center justify-between mb-2 px-1">
            <p className="text-xs font-bold text-muted-foreground">گفتگوها</p>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void openThread(null)}>
              <Plus className="h-3.5 w-3.5 ml-1" aria-hidden /> جدید
            </Button>
          </div>
          <div className="max-h-96 overflow-y-auto space-y-1 -mx-1 px-1">
            {threads === null ? (
              <p className="text-xs text-muted-foreground p-2">در حال بارگذاری…</p>
            ) : threads.length === 0 ? (
              <p className="text-xs text-muted-foreground p-2">هنوز گفتگویی ندارید.</p>
            ) : (
              threads.map((t) => (
                <button
                  key={t.id}
                  onClick={() => void openThread(t.id)}
                  className={cn(
                    "w-full text-right rounded-lg px-2.5 py-2 text-xs transition-colors",
                    activeThread === t.id ? "bg-primary/10 text-primary font-bold" : "hover:bg-muted"
                  )}
                >
                  <span className="block truncate font-medium">{t.title}</span>
                  <span className="block text-[10px] text-muted-foreground mt-0.5">
                    {faDateTime(t.createdAt)} · {t._count?.messages ?? 0} پیام
                  </span>
                </button>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {/* Chat area */}
      <Card className="border-border/60 flex flex-col h-[540px]">
        <CardContent className="p-0 flex flex-col h-full">
          <div className="px-4 py-3 border-b border-border/60 flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <Sparkles className="h-4.5 w-4.5" aria-hidden />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold">دستیار آموزشی هوشمند</p>
              <p className="text-[11px] text-muted-foreground">پاسخ‌های مرحله‌به‌مرحله با مثال و تمرین</p>
            </div>
          </div>

          {error && <div className="px-4 pt-3"><ErrorState message={error} /></div>}

          {quotaBlocked && (
            <div className="mx-4 mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 flex items-start gap-3">
              <Lock className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" aria-hidden />
              <div className="text-xs leading-6 text-amber-700 dark:text-amber-400">
                <p className="font-bold mb-1">سهمیهٔ امروز پر شده است</p>
                <p>{quotaBlocked}</p>
              </div>
            </div>
          )}

          <ScrollArea className="flex-1 px-4 py-4">
            {messages.length === 0 ? (
              <EmptyState
                icon={MessageCircle}
                title="سؤال درسی خود را بپرسید"
                description="مثلاً: «مشتق تابع y=x²+3x چگونه محاسبه می‌شود؟» — دستیار مرحله‌به‌مرحله توضیح می‌دهد."
              />
            ) : (
              <div className="space-y-3">
                {messages.map((m) => (
                  <div key={m.id} className={cn("flex gap-2.5", m.role === "user" ? "flex-row-reverse" : "")}>
                    <div
                      className={cn(
                        "h-7 w-7 rounded-lg flex items-center justify-center shrink-0",
                        m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                      )}
                    >
                      {m.role === "user" ? <User className="h-4 w-4" aria-hidden /> : <Bot className="h-4 w-4" aria-hidden />}
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
                    <div className="h-7 w-7 rounded-lg bg-muted flex items-center justify-center">
                      <Bot className="h-4 w-4" aria-hidden />
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

          <div className="p-3 border-t border-border/60 flex gap-2">
            <Textarea
              dir="auto"
              rows={1}
              value={draft}
              placeholder="سؤال خود را بنویسید…"
              className="resize-none min-h-10"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              disabled={!!quotaBlocked}
            />
            <Button onClick={() => void send()} disabled={busy || !draft.trim() || !!quotaBlocked} className="shrink-0 self-end h-10">
              <Send className="h-4 w-4" aria-hidden />
              <span className="sr-only">ارسال</span>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
