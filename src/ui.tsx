import { useEffect, useRef, useState, type ReactNode } from "react";

/** Server-synchronised clock in ms, refreshed every 100 ms while `active`. */
export function useNow(offset: number, active = true) {
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now() + offset), 100);
    setNow(Date.now() + offset);
    return () => clearInterval(t);
  }, [offset, active]);
  return now;
}

/** mm:ss.t for running clocks. */
export function fmtLive(ms: number) {
  const t = Math.max(0, ms);
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${Math.floor((t % 1000) / 100)}`;
}

export function toast(text: string, tone: "red" | "green" | "teal" = "red") {
  (window as unknown as { RSMA: { toast: (o: { text: string; tone: string }) => void } }).RSMA.toast({ text, tone });
}

interface DialogProps {
  title: string;
  onClose: () => void;
  size?: "s" | "l";
  children: ReactNode;
  foot: ReactNode;
}

/** Modal dialog: Esc closes, focus moves in and returns, Tab stays inside. */
export function Dialog({ title, onClose, size, children, foot }: DialogProps) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(box.current!.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),select,textarea"));
    focusable()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (e.key !== "Tab") return;
      const l = focusable();
      if (!l.length) return;
      const first = l[0];
      const last = l[l.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="r-backdrop">
      <div className={`r-dialog${size ? ` r-dialog--${size}` : ""}`} role="dialog" aria-modal="true" aria-label={title} ref={box}>
        <div className="r-header">{title}</div>
        <div className="r-dialog__body">{children}</div>
        <div className="r-dialog__foot">{foot}</div>
      </div>
    </div>
  );
}
