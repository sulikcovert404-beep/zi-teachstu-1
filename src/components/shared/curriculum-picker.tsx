"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EDUCATION_LEVELS, gradesForLevel, gradeLabelFa, levelLabel } from "@/lib/education-levels";
import { subjectsForLevelGrade } from "@/lib/curriculum";
import { BookOpen, GraduationCap } from "lucide-react";

// ── Round 18 — structured book placement: دوره → پایه → درس (متوسطهٔ اول → هفتم → فارسی) ──
// Shared by the platform (admin) and teacher upload forms. Level drives the grade
// list; grade drives the official subject list; «سایر» falls back to free text.

export interface CurriculumValue {
  level?: string;
  gradeLevel?: string;
  subject?: string;
}

const OTHER_SUBJECT = "__OTHER__";

export function CurriculumPicker({
  value,
  onChange,
  idPrefix = "curr",
}: {
  value: CurriculumValue;
  onChange: (v: CurriculumValue) => void;
  idPrefix?: string;
}) {
  const level = value.level ?? "";
  const grade = value.gradeLevel ?? "";
  const subjects = useMemo(() => subjectsForLevelGrade(level || null, grade || null), [level, grade]);
  const subjectIsKnown = !!value.subject && subjects.includes(value.subject);
  const [subjectMode, setSubjectMode] = useState<"LIST" | "OTHER">(subjectIsKnown || !value.subject ? "LIST" : "OTHER");

  const isPrePrimary = level === "PRE_PRIMARY";

  return (
    <div className="grid sm:grid-cols-3 gap-3">
      {/* دورهٔ تحصیلی */}
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-level`} className="text-xs flex items-center gap-1.5">
          <GraduationCap className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
          دورهٔ تحصیلی
        </Label>
        <Select
          value={level || "NONE"}
          onValueChange={(v) => {
            const nextLevel = v === "NONE" ? undefined : v;
            setSubjectMode("LIST");
            onChange({ level: nextLevel, gradeLevel: undefined, subject: undefined });
          }}
        >
          <SelectTrigger className="h-11 w-full" id={`${idPrefix}-level`}>
            <SelectValue placeholder="انتخاب دوره" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="NONE">بدون دوره (عمومی)</SelectItem>
            {EDUCATION_LEVELS.map((l) => (
              <SelectItem key={l.code} value={l.code}>
                {l.emoji} {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* پایه */}
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-grade`} className="text-xs">
          پایهٔ تحصیلی
        </Label>
        <Select
          value={grade || "NONE"}
          disabled={!level || isPrePrimary}
          onValueChange={(v) => {
            const nextGrade = v === "NONE" ? undefined : v;
            setSubjectMode("LIST");
            onChange({ level, gradeLevel: nextGrade, subject: undefined });
          }}
        >
          <SelectTrigger className="h-11 w-full" id={`${idPrefix}-grade`}>
            <SelectValue placeholder={isPrePrimary ? "پیش‌دبستانی پایه ندارد" : level === "PRIMARY" ? "انتخاب کلاس (مثل کلاس سوم)" : "انتخاب پایه"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="NONE">{level === "PRIMARY" ? "بدون کلاس" : "بدون پایه"}</SelectItem>
            {gradesForLevel(level || null).map((g) => (
              <SelectItem key={g} value={g}>
                {gradeLabelFa(level, g)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* درس */}
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-subject`} className="text-xs flex items-center gap-1.5">
          <BookOpen className="h-3.5 w-3.5 text-teal-600" aria-hidden />
          درس / کتاب
        </Label>
        {subjectMode === "LIST" ? (
          <Select
            value={value.subject && subjects.includes(value.subject) ? value.subject : "NONE"}
            disabled={subjects.length === 0}
            onValueChange={(v) => {
              if (v === OTHER_SUBJECT) {
                setSubjectMode("OTHER");
                onChange({ level, gradeLevel: grade, subject: undefined });
                return;
              }
              onChange({ level, gradeLevel: grade, subject: v === "NONE" ? undefined : v });
            }}
          >
            <SelectTrigger className="h-11 w-full" id={`${idPrefix}-subject`}>
              <SelectValue placeholder={subjects.length === 0 ? (level ? "پس از انتخاب پایه…" : "ابتدا دوره را انتخاب کنید") : "انتخاب درس"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NONE">بدون درس</SelectItem>
              {subjects.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
              <SelectItem value={OTHER_SUBJECT}>✏️ سایر (نوشتن دستی)</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <div className="flex gap-1.5">
            <Input
              id={`${idPrefix}-subject`}
              dir="auto"
              className="h-11"
              value={value.subject ?? ""}
              onChange={(e) => onChange({ level, gradeLevel: grade, subject: e.target.value || undefined })}
              placeholder="نام درس را بنویسید…"
              maxLength={60}
              autoFocus
            />
            <button
              type="button"
              onClick={() => {
                setSubjectMode("LIST");
                onChange({ level, gradeLevel: grade, subject: undefined });
              }}
              className="h-11 px-3 rounded-lg border border-border/60 text-xs text-muted-foreground hover:bg-muted/50 transition-colors shrink-0"
            >
              فهرست
            </button>
          </div>
        )}
        {level && subjectMode === "LIST" && subjects.length > 0 && (
          <p className="text-[10px] text-muted-foreground leading-4">
            دروس رسمی {levelLabel(level)}
            {grade ? ` · ${gradeLabelFa(level, grade)}` : ""} — اگر درس موردنظر نیست «سایر» را بزنید.
          </p>
        )}
      </div>
    </div>
  );
}
