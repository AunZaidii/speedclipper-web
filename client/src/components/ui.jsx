import { X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

const cx = (...c) => c.filter(Boolean).join(" ");

export function Card({ title, children, className, action }) {
  return (
    <div className={cx("rounded-2xl border border-line bg-panel p-5 min-w-0 shadow-[0_1px_2px_rgba(20,20,10,.03)]", className)}>
      {(title || action) && (
        <div className="mb-3 flex items-center gap-2">
          {title && <h3 className="text-[13px] font-medium text-muted">{title}</h3>}
          <div className="ml-auto">{action}</div>
        </div>
      )}
      {children}
    </div>
  );
}

export function Button({ variant = "default", size = "md", className, ...p }) {
  const v = {
    default: "bg-panel border-line text-ink hover:border-[#cfccc4] hover:bg-panel2/60",
    primary: "bg-ink text-white border-ink hover:bg-neutral-700",
    ok: "bg-ok text-white border-ok hover:brightness-110",
    danger: "bg-panel border-line text-bad hover:border-bad/50 hover:bg-bad/5",
    ghost: "border-transparent text-ink hover:bg-panel2",
  }[variant];
  const s = size === "sm" ? "px-3 py-1 text-xs" : "px-4 py-2 text-sm";
  return <button className={cx("inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full border font-medium transition-colors disabled:cursor-default disabled:opacity-50", v, s, className)} {...p} />;
}

const BADGE = {
  ready: "text-ok", pending: "text-warn", rejected: "text-muted", published: "text-info", failed: "text-bad",
  queued: "text-warn", uploading: "text-info", live: "bg-bad text-white border-bad", youtube: "text-[#e62117]",
  twitch: "text-[#7c3aed]", instagram: "text-[#d6246e]",
};
export function Badge({ kind, children, className }) {
  return <span className={cx("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold", kind === "live" ? "" : "border-line bg-panel2", BADGE[kind], className)}>{children}</span>;
}

export function Stat({ label, value, sub }) {
  return (
    <Card title={label}>
      <div className="text-[32px] font-semibold leading-none tracking-[-.03em]">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </Card>
  );
}

export function Empty({ children }) {
  return <div className="rounded-2xl border border-dashed border-[#d9d6ce] p-10 text-center text-sm text-muted">{children}</div>;
}

export function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-ink/80">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-muted">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label }) {
  return (
    <label className="inline-flex cursor-pointer select-none items-center gap-2 text-sm">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}

export function Modal({ open, onClose, children, wide }) {
  useEffect(() => {
    if (!open) return undefined;
    const k = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-3 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx("relative max-h-[94vh] w-full overflow-auto rounded-3xl border border-line bg-panel shadow-2xl shadow-black/10", wide ? "max-w-5xl" : "max-w-lg")}>
        <button onClick={onClose} className="absolute right-3 top-3 z-10 rounded-full bg-panel2 p-1.5 text-muted hover:text-ink" aria-label="Close"><X size={16} /></button>
        {children}
      </div>
    </div>
  );
}

const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [t, setT] = useState(null);
  const show = useCallback((msg, err = false) => {
    setT({ msg, err, id: Date.now() });
  }, []);
  useEffect(() => {
    if (!t) return undefined;
    const h = setTimeout(() => setT(null), t.err ? 7000 : 3500);
    return () => clearTimeout(h);
  }, [t]);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {t && (
        <div className={cx("fade-in fixed bottom-20 right-4 z-[60] max-w-sm rounded-2xl px-4 py-3 text-sm text-white shadow-xl shadow-black/15 md:bottom-5", t.err ? "bg-bad" : "bg-ink")}>
          {t.msg}
        </div>
      )}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/** Poll an async loader every `ms` while mounted. */
export function usePoll(loader, ms, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(async () => {
    try { setData(await loader()); setError(null); } catch (e) { setError(e); }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
    if (!ms) return undefined;
    const h = setInterval(() => document.visibilityState === "visible" && load(), ms);
    return () => clearInterval(h);
  }, [load, ms]);
  return { data, error, reload: load, setData };
}

export function Skeleton({ className }) {
  return <div className={cx("animate-pulse rounded-2xl bg-panel2", className)} />;
}

export function PageSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div>
      <Skeleton className="h-40" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="aspect-[9/16]" />)}</div>
    </div>
  );
}

export function Tabs({ value, onChange, items }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-full bg-panel2 p-1">
      {items.map(([v, label, count]) => (
        <button key={v} onClick={() => onChange(v)}
          className={cx("rounded-full px-3.5 py-1 text-sm transition-colors", value === v ? "bg-panel font-medium text-ink shadow-sm" : "text-muted hover:text-ink")}>
          {label}{count != null && <span className="ml-1.5 text-[11px] text-muted">{count}</span>}
        </button>
      ))}
    </div>
  );
}

const PLATFORM_RING = { youtube: "ring-[#e62117]/50", twitch: "ring-[#7c3aed]/50" };
export function Avatar({ name = "?", platform, live, size = 40 }) {
  const initials = name.replace(/^@/, "").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span className={cx("relative inline-grid shrink-0 place-items-center rounded-full font-bold text-white ring-2", PLATFORM_RING[platform] || "ring-line")}
      style={{ width: size, height: size, fontSize: size * 0.36, background: `linear-gradient(135deg, hsl(${h} 55% 42%), hsl(${(h + 40) % 360} 60% 30%))` }}>
      {initials}
      {live && <span className="rec absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-panel bg-bad" />}
    </span>
  );
}
