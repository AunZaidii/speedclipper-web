import { Clapperboard, Laptop, Pause, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, timeAgo } from "../api.js";
import ClipCard from "../components/ClipCard.jsx";
import { SERIES, Sparkline } from "../components/charts.jsx";
import { Avatar, Badge, Button, Card, Empty, PageSkeleton, usePoll, useToast } from "../components/ui.jsx";
import { useLive } from "../live.jsx";
import { EventRow } from "./Activity.jsx";

export function LiveTimer({ since }) {
  const [, set] = useState(0);
  useEffect(() => { const h = setInterval(() => set((x) => x + 1), 1000); return () => clearInterval(h); }, []);
  const s = Math.max(0, Math.floor(Date.now() / 1000 - since));
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return <span className="font-mono tabular-nums">{hh ? `${hh}:` : ""}{String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}</span>;
}

function Kpi({ label, value, sub, trend, color }) {
  return (
    <Card className="fade-in">
      <div className="text-[13px] font-medium text-muted">{label}</div>
      <div className="mt-1 text-[32px] font-semibold tracking-[-.03em]">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
      <Sparkline values={trend} color={color} />
    </Card>
  );
}

function VodForm({ creators }) {
  const [url, setUrl] = useState("");
  const [max, setMax] = useState("");
  const [creator, setCreator] = useState("");
  const toast = useToast();
  const go = async (e) => {
    e.preventDefault();
    try {
      await api("/commands", { method: "POST", body: { type: "vod", payload: { url: url.trim(), ...(max ? { maxMinutes: Number(max) } : {}), ...(creator ? { creatorId: creator } : {}) } } });
      toast("Sent to the laptop. Clips will appear for approval when it's done."); setUrl(""); setMax("");
    } catch (err) { toast(err.message, true); }
  };
  return (
    <Card title="Clip a past stream (VOD)">
      <form onSubmit={go} className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
        <input required placeholder="https://www.youtube.com/watch?v=…" value={url} onChange={(e) => setUrl(e.target.value)} />
        <select value={creator} onChange={(e) => setCreator(e.target.value)} className="sm:!w-40">
          <option value="">Creator…</option>{(creators || []).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
        </select>
        <input type="number" min="1" placeholder="Max min" value={max} onChange={(e) => setMax(e.target.value)} className="sm:!w-28" />
        <Button variant="primary"><Clapperboard size={15} /> Find clips</Button>
      </form>
      <p className="mt-2 text-xs text-muted">The laptop downloads the VOD and its chat replay, finds the moments and edits them. Nothing is published until you approve.</p>
    </Card>
  );
}

export default function Overview() {
  const { tick } = useLive();
  const toast = useToast();
  const { data: ov, reload } = usePoll(() => api("/overview"), 15000, [tick.worker, tick.clips, tick.commands]);
  const { data: an } = usePoll(() => api("/analytics?days=7"), 120000, [tick.clips]);
  const { data: clips } = usePoll(() => api("/clips?limit=6"), 60000, [tick.clips]);
  const { data: events } = usePoll(() => api("/events?limit=8"), 60000, [tick.events]);
  const { data: creators } = usePoll(() => api("/creators"), 60000, [tick.creators, tick.worker]);
  if (!ov) return <PageSkeleton />;

  const w = ov.worker || {};
  const sessions = w.online ? w.sessions || [] : [];
  const c = ov.clips || {};
  const togglePause = async () => {
    try { await api("/commands", { method: "POST", body: { type: ov.paused ? "resume" : "pause" } }); toast(ov.paused ? "Resuming…" : "Pausing… (current recordings continue)"); reload(); }
    catch (e) { toast(e.message, true); }
  };
  const byDay = an?.clipsByDay || [];
  const steps = [
    { done: ov.creators > 0, label: "Add a creator to monitor", to: "/creators" },
    { done: !!w.lastSeen, label: "Link your laptop (the worker that records and edits)", to: "/settings" },
    { done: !!ov.accounts?.youtube, label: "Connect YouTube", to: "/accounts" },
    { done: !!ov.accounts?.instagram, label: "Connect Instagram (optional)", to: "/accounts", optional: true },
  ];
  const required = steps.filter((s) => !s.optional);
  const showSetup = required.some((s) => !s.done);

  return (
    <div className="space-y-5">
      {showSetup && (
        <div className="rounded-2xl border border-line bg-panel p-5">
          <div className="mb-2 flex items-center gap-2"><b>Get set up</b><span className="text-xs text-muted">{steps.filter((s) => s.done).length}/{steps.length} done</span></div>
          <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-panel2"><div className="h-full bg-accent" style={{ width: `${(steps.filter((s) => s.done).length / steps.length) * 100}%` }} /></div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {steps.map((s) => (
              <Link key={s.label} to={s.to} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-panel2 ${s.done ? "text-muted line-through" : ""}`}>
                <span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold ${s.done ? "bg-ok text-white" : "border border-line"}`}>{s.done ? "✓" : ""}</span>{s.label}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className={`relative overflow-hidden rounded-2xl border p-5 ${sessions.length ? "border-bad/25 bg-gradient-to-br from-bad/[.05] to-panel" : "border-line bg-panel"}`}>
        <div className="flex flex-wrap items-center gap-3">
          <span className={`grid h-11 w-11 place-items-center rounded-xl ${w.online ? "bg-ok/15 text-ok" : "bg-panel2 text-muted"}`}><Laptop size={22} /></span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-lg font-bold">
              <span className={`h-2.5 w-2.5 rounded-full ${sessions.length ? "rec bg-bad" : w.online ? (ov.paused ? "bg-warn" : "bg-ok") : "bg-muted"}`} />
              {sessions.length ? `Recording ${sessions.length} live stream${sessions.length > 1 ? "s" : ""}` : !w.online ? "Laptop offline" : ov.paused ? "Monitoring paused" : "Watching for live streams"}
            </div>
            <div className="text-sm text-muted">{w.hostname || "Laptop"} · last seen {timeAgo(w.lastSeen)}{w.freeGb != null ? ` · ${w.freeGb} GB free` : ""} · {ov.creatorsEnabled} creators monitored</div>
          </div>
          {w.online && <Button onClick={togglePause} variant={ov.paused ? "ok" : "default"}>{ov.paused ? <><Play size={15} /> Resume</> : <><Pause size={15} /> Pause</>}</Button>}
        </div>
        {sessions.length > 0 && (
          <div className="mt-4 grid gap-2 lg:grid-cols-2">
            {sessions.map((s) => (
              <div key={s.videoId} className="flex items-center gap-3 rounded-xl border border-line bg-bg/60 p-3">
                <Avatar name={s.creator || "?"} platform={s.platform} live size={38} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><b className="truncate">{s.creator}</b><Badge kind="live">● LIVE <LiveTimer since={s.since} /></Badge></div>
                  <div className="truncate text-xs text-muted">{s.title}</div>
                </div>
                <div className="text-right text-xs text-muted"><div><b className="text-ink">{Number(s.chatMessages || 0).toLocaleString()}</b> chat</div><div><b className="text-ink">{s.moments || 0}</b> moments</div></div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Clips this week" value={an?.totals.clips ?? "–"} sub={an?.totals.avgScore ? `avg score ${an.totals.avgScore.toFixed(1)}` : "no clips yet"}
          trend={byDay.map((d) => (d.published || 0) + (d.ready || 0) + (d.pending || 0) + (d.rejected || 0) + (d.failed || 0))} color={SERIES[0]} />
        <Kpi label="Need approval" value={c.pending || 0} sub={<Link to="/review" className="text-info">Start review →</Link>} />
        <Kpi label="Published today" value={(ov.uploadsToday.youtube || 0) + (ov.uploadsToday.instagram || 0)}
          sub={`YouTube ${ov.uploadsToday.youtube}/${ov.maxUploadsPerDay} · IG ${ov.uploadsToday.instagram}/${ov.maxUploadsPerDay}`}
          trend={(an?.publishedByDay || []).map((d) => d.youtube + d.instagram)} color={SERIES[1]} />
        <Kpi label="Queued to publish" value={c.ready || 0} sub={<Link to="/queue" className="text-info">See schedule →</Link>} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-5">
          <section>
            <div className="mb-2 flex items-center"><h2 className="font-semibold">Latest clips</h2><Link to="/clips" className="ml-auto text-sm text-info">All clips →</Link></div>
            {clips?.length ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 xl:grid-cols-3 2xl:grid-cols-6">
                {clips.map((cl) => <ClipCard key={cl._id} clip={cl} />)}
              </div>
            ) : <Empty>No clips yet. They appear here as soon as a moment is edited.</Empty>}
          </section>
          <VodForm creators={creators} />
        </div>
        <Card title="Activity" action={<Link to="/activity" className="text-xs text-info">All →</Link>}>
          {events?.length ? <div className="-mx-1 divide-y divide-line">{events.map((e) => <EventRow key={e._id} e={e} compact />)}</div>
            : <p className="text-sm text-muted">Nothing yet.</p>}
        </Card>
      </div>
    </div>
  );
}
