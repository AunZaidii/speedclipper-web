import { RotateCcw } from "lucide-react";
import { Link } from "react-router-dom";
import { api, timeAgo } from "../api.js";
import { Badge, Button, Card, Empty, Skeleton, usePoll, useToast } from "../components/ui.jsx";
import { useLive } from "../live.jsx";

const eta = (d) => {
  if (!d) return "uploading now";
  const ms = new Date(d) - Date.now();
  if (ms < 60000) return "next";
  const t = new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return ms > 20 * 3600000 ? `${new Date(d).toLocaleDateString([], { weekday: "short" })} ${t}` : `~${t}`;
};

function PlatformQueue({ name, kind, q, onPin }) {
  return (
    <Card title={name} action={<span className="text-xs text-muted">{q.uploadsToday}/{q.maxPerDay} today</span>}>
      {!q.connected && <div className="mb-3 rounded-lg border border-warn/30 bg-warn/10 p-2 text-xs text-warn">Not connected: nothing is published here until you <Link className="underline" to="/accounts">connect {name}</Link>.</div>}
      {!q.enabled && <div className="mb-3 rounded-lg border border-line bg-panel2 p-2 text-xs text-muted">Automatic publishing is switched off in Settings.</div>}
      {q.items.length ? (
        <ol className="space-y-2">
          {q.items.map((it, i) => (
            <li key={it.clipId} className="flex items-center gap-3 rounded-lg border border-line bg-bg/50 p-2">
              <span className="w-5 text-center text-xs font-bold text-muted">{i + 1}</span>
              <div className="h-14 w-8 shrink-0 rounded bg-black bg-cover bg-center" style={it.thumb ? { backgroundImage: `url(/api/clips/${it.clipId}/thumb)` } : undefined} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{it.title}</div>
                <div className="text-xs text-muted">{it.creatorName} · score {it.score?.toFixed(1)}{it.attempts ? ` · attempt ${it.attempts + 1}` : ""}</div>
                {it.error && <div className="truncate text-xs text-warn">{it.error}</div>}
              </div>
              {it.pinned && <Badge kind="ready">⚡ next</Badge>}
              <Badge kind={it.status === "uploading" ? "uploading" : kind}>{eta(it.eta)}</Badge>
              {it.status !== "uploading" && <button onClick={() => onPin(it.clipId, !it.pinned)} className="rounded-md px-1.5 text-xs text-muted hover:bg-panel2 hover:text-ink" title={it.pinned ? "Unpin" : "Publish next"}>{it.pinned ? "unpin" : "⚡"}</button>}
            </li>
          ))}
        </ol>
      ) : <p className="text-sm text-muted">Nothing queued.</p>}
    </Card>
  );
}

export default function Queue() {
  const { tick } = useLive();
  const toast = useToast();
  const { data, reload } = usePoll(() => api("/queue"), 30000, [tick.clips, tick.settings]);
  if (!data) return <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-64" /><Skeleton className="h-64" /></div>;
  const pin = async (id, on) => { try { await api(`/clips/${id}/priority`, { method: "POST", body: { pin: on } }); reload(); } catch (e) { toast(e.message, true); } };
  const retry = async (id) => { try { await api(`/clips/${id}/retry`, { method: "POST" }); toast("Back in the queue"); reload(); } catch (e) { toast(e.message, true); } };
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">Best clips go first. Times are estimates from your limits (max per day, minutes between uploads); the laptop uploads when a slot opens.</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <PlatformQueue name="YouTube Shorts" kind="youtube" q={data.youtube} onPin={pin} />
        <PlatformQueue name="Instagram Reels" kind="instagram" q={data.instagram} onPin={pin} />
      </div>
      <section>
        <h2 className="mb-2 font-semibold">Failed uploads</h2>
        {data.failed.length ? (
          <div className="space-y-2">
            {data.failed.map((c) => (
              <Card key={c._id} className="flex flex-wrap items-center gap-3 !p-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{c.title}</div>
                  {c.publications.filter((p) => p.status === "failed").map((p) => (
                    <div key={p.platform} className="text-xs text-bad"><Badge kind={p.platform}>{p.platform}</Badge> {p.error}</div>
                  ))}
                  <div className="text-xs text-muted">{c.creatorName} · {timeAgo(c.updatedAt)}</div>
                </div>
                <Button size="sm" onClick={() => retry(c._id)}><RotateCcw size={14} /> Retry</Button>
              </Card>
            ))}
          </div>
        ) : <Empty>No failed uploads.</Empty>}
      </section>
    </div>
  );
}
