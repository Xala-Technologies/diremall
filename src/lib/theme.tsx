"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Scheme = "auto" | "light" | "dark";
const Ctx = createContext<{ scheme: Scheme; setScheme: (s: Scheme) => void }>({ scheme: "auto", setScheme: () => {} });
export const useScheme = () => useContext(Ctx);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [scheme, setSchemeState] = useState<Scheme>("auto");
  useEffect(() => {
    try { const v = localStorage.getItem("scheme"); if (v === "light" || v === "dark" || v === "auto") setSchemeState(v); } catch { /* ignore */ }
  }, []);
  const setScheme = (s: Scheme) => {
    setSchemeState(s);
    document.documentElement.setAttribute("data-color-scheme", s);
    try { localStorage.setItem("scheme", s); } catch { /* ignore */ }
  };
  return <Ctx.Provider value={{ scheme, setScheme }}>{children}</Ctx.Provider>;
}

/** Runs before first paint so the page never flashes the wrong theme. */
export const themeInitScript = `try{var s=localStorage.getItem("scheme");document.documentElement.setAttribute("data-color-scheme",s==="light"||s==="dark"?s:"auto")}catch(e){document.documentElement.setAttribute("data-color-scheme","auto")}`;
