// Real-time updates over Server-Sent Events: toasts for important events + "tick" counters that
// pages use to refetch exactly what changed. Falls back to polling if the stream drops.
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useToast } from "./components/ui.jsx";

const LiveCtx = createContext({ tick: {}, connected: false, latest: null });

const TOPIC_FOR = { live: "worker", ended: "worker", clip: "clips", approved: "clips", rejected: "clips", published: "clips",
  failed: "clips", creator: "creators", command: "commands", worker: "worker", settings: "settings" };
const TOAST_TYPES = new Set(["live", "ended", "published", "failed", "worker", "command"]);
const NOTIFY_TYPES = { live: "/streams", published: "/queue", failed: "/queue", clip: "/review", worker: "/" };

export const notifyPref = {
  get: () => { try { return localStorage.getItem("sc-notify") === "1"; } catch { return false; } },
  set: (on) => { try { localStorage.setItem("sc-notify", on ? "1" : "0"); } catch { /* private mode */ } },
};

/** System notification when the tab isn't visible (phone in pocket, other tab focused). */
async function systemNotify(e) {
  if (!notifyPref.get() || !("Notification" in window) || Notification.permission !== "granted") return;
  if (document.visibilityState === "visible") return;
  if (e.type === "clip" && !/needs approval/.test(e.message)) return;
  const title = { live: "🔴 Live now", published: "✅ Published", failed: "⚠️ Upload problem", clip: "✂️ New clip to review", worker: "💻 Laptop" }[e.type] || "SpeedClipper";
  const opts = { body: e.message, icon: "/icon-192.png", badge: "/icon-192.png", tag: `${e.type}-${e.clip || e.creator || e._id}`, data: { url: NOTIFY_TYPES[e.type] || "/" } };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) reg.showNotification(title, opts); else new Notification(title, opts);
  } catch { /* unsupported */ }
}

export function LiveProvider({ children }) {
  const [tick, setTick] = useState({});
  const [connected, setConnected] = useState(false);
  const [latest, setLatest] = useState(null);
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  useEffect(() => {
    let es, retry;
    const bump = (topic) => setTick((t) => ({ ...t, [topic]: (t[topic] || 0) + 1, any: (t.any || 0) + 1 }));
    const open = () => {
      es = new EventSource("/api/stream");
      es.onopen = () => setConnected(true);
      es.onerror = () => { setConnected(false); es.close(); retry = setTimeout(open, 5000); };
      es.onmessage = (m) => {
        let e;
        try { e = JSON.parse(m.data); } catch { return; }
        if (e.kind === "refresh") return bump(e.topic);
        bump(TOPIC_FOR[e.type] || "any");
        bump("events");
        setLatest(e);
        if (TOAST_TYPES.has(e.type) || e.level === "error") toastRef.current(e.message, e.level === "error");
        if (NOTIFY_TYPES[e.type]) systemNotify(e);
      };
    };
    open();
    // Browsers allow only ~6 connections per site; a stream left open by a reload would pile up and
    // freeze the site after a few refreshes. Close it whenever the page is being left or hidden in bfcache.
    const close = () => { clearTimeout(retry); es?.close(); };
    const reopen = (e) => { if (e.persisted) open(); };
    window.addEventListener("pagehide", close);
    window.addEventListener("beforeunload", close);
    window.addEventListener("pageshow", reopen);
    return () => {
      close();
      window.removeEventListener("pagehide", close);
      window.removeEventListener("beforeunload", close);
      window.removeEventListener("pageshow", reopen);
    };
  }, []);

  return <LiveCtx.Provider value={{ tick, connected, latest }}>{children}</LiveCtx.Provider>;
}

export const useLive = () => useContext(LiveCtx);
