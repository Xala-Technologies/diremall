"use client";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Icon } from "./icons";

type T = { id: number; text: string };
const Ctx = createContext<(text: string) => void>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<T[]>([]);
  const push = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, text }]);
    setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), 4200);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">{items.map((t) => <div key={t.id} className="toast"><Icon name="check" />{t.text}</div>)}</div>
    </Ctx.Provider>
  );
}
