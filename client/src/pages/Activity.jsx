import { AlertTriangle, CheckCircle2, Clapperboard, Info, Radio, Send, Terminal, XCircle } from "lucide-react";
import { useState } from "react";
import { api, timeAgo } from "../api.js";
import { Badge, Card, Empty, Tabs, usePoll } from "../components/ui.jsx";
import { useLive } from "../live.jsx";

const ICON = { live: Radio, ended: Radio, clip: Clapperboard, published: Send, failed: XCircle, approved: CheckCircle2,
  rejected: XCircle, command: Terminal, worker: Info, creator: Info, settings: Info };
const LEVEL = { success: "text-ok", warn: "text-warn", error: "text-bad", info: "text-muted" };

export function EventRow({ e, compact }) {
  const Icon = e.level === "warn" ? AlertTriangle : ICON[e.type] || Info;
  return (
    <div className="flex gap-3 px-1 py-2.5">
      <Icon size={16} className={`mt-0.5 shrink-0 ${LEVEL[e.level] || "text-muted"}`} />
      <div className="min-w-0 flex-1 text-sm">
        <div className={compact ? "line-clamp-2" : ""}>{e.message}</div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
          {timeAgo(e.at)}
          {e.url && <a className="text-info" href={e.url} target="_blank" rel="noreferrer">open ↗</a>}
        </div>
      </div>
    </div>
  );
}

const FILTERS = [["", "All"], ["live,ended", "Streams"], ["clip,approved,rejected", "Clips"], ["published,failed", "Publishing"], ["command,worker,settings,creator", "System"]];

export default function ActivityPage() {
  const { tick } = useLive();
  const [type, setType] = useState("");
  const [extra, setExtra] = useState([]);
  const { data: events } = usePoll(() => { setExtra([]); return api(`/events?limit=60${type ? `&type=${type}` : ""}`); }, 0, [type, tick.events]);
  const { data: cmds } = usePoll(() => api("/commands?limit=15"), 0, [tick.commands]);
  const { data: worker } = usePoll(() => api("/worker-status"), 30000, [tick.worker]);
  const all = [...(events || []), ...extra];
  const more = async () => {
    const last = all.at(-1);
    if (!last) return;
    setExtra((x) => x);
    const next = await api(`/events?limit=60&before=${encodeURIComponent(last.at)}${type ? `&type=${type}` : ""}`);
    setExtra((x) => [...x, ...next]);
  };
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
      <div className="min-w-0 space-y-3">
        <Tabs value={type} onChange={setType} items={FILTERS.map(([v, l]) => [v, l])} />
        <Card>
          {!events ? <div className="text-muted">Loading…</div> : all.length ? (
            <>
              <div className="divide-y divide-line">{all.map((e) => <EventRow key={e._id} e={e} />)}</div>
              {all.length >= 60 && <button onClick={more} className="mt-3 w-full rounded-lg border border-line py-2 text-sm text-muted hover:text-ink">Load older</button>}
            </>
          ) : <Empty>No activity yet.</Empty>}
        </Card>
      </div>
      <div className="space-y-5">
        <Card title="Commands sent to the clipping server">
          {!cmds?.length ? <p className="text-sm text-muted">None yet. Pause/resume, “check now”, stop recording and VOD jobs show up here.</p> : (
            <div className="space-y-2">
              {cmds.map((c) => (
                <div key={c._id} className="flex items-start gap-2 text-sm">
                  <Badge kind={c.status === "done" ? "ready" : c.status === "failed" ? "failed" : "pending"}>{c.status}</Badge>
                  <div className="min-w-0 flex-1">
                    <div>{c.type.replace("_", " ")}{c.payload?.url ? `: ${c.payload.url}` : ""}</div>
                    <div className="text-xs text-muted">{c.result || (c.status === "pending" ? "waiting for the server (≤ 30 s)" : "")} · {timeAgo(c.createdAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
        {worker?.log !== undefined && (   // admin only: other users don't get the server's log
          <Card title={`Server log${worker?.online ? "" : " (offline)"}`}>
            {worker?.log?.length ? (
              <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-panel2 p-3 font-mono text-[11px] leading-relaxed text-muted">
                {worker.log.slice().reverse().join("\n")}
              </pre>
            ) : <p className="text-sm text-muted">The server sends its latest log lines every 30 seconds.</p>}
          </Card>
        )}
      </div>
    </div>
  );
}
