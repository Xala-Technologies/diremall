"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { EN, AM } from "./dictionary";

export type Lang = "en" | "am";
export type Calendar = "gregorian" | "ethiopian";
type Ctx = { lang: Lang; setLang: (l: Lang) => void; calendar: Calendar; setCalendar: (c: Calendar) => void; t: (key: string) => string };
const I18n = createContext<Ctx | null>(null);

const read = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");
  const [calendar, setCalendarState] = useState<Calendar>("gregorian");
  useEffect(() => {
    const saved = read("lang") === "am" ? "am" : "en";
    setLangState(saved);
    document.documentElement.lang = saved; // screen readers pick the right voice for Amharic
    setCalendarState(read("calendar") === "ethiopian" ? "ethiopian" : "gregorian");
  }, []);
  const setLang = (l: Lang) => { setLangState(l); write("lang", l); document.documentElement.lang = l; };
  const setCalendar = (c: Calendar) => { setCalendarState(c); write("calendar", c); };
  const t = (key: string) => (lang === "am" ? AM[key] : undefined) ?? EN[key] ?? key;
  return <I18n.Provider value={{ lang, setLang, calendar, setCalendar, t }}>{children}</I18n.Provider>;
}

export function useI18n(): Ctx {
  const c = useContext(I18n);
  if (!c) throw new Error("I18nProvider missing");
  return c;
}
