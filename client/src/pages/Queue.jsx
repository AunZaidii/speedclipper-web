import { RotateCcw, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { api, timeAgo } from "../api.js";
import { Badge, Button, Card, Empty, Skeleton, usePoll, useToast } from "../components/ui.jsx";
import { useLive } from "../live.jsx";
import { PLATFORM, postProblem, whenLabel } from "../words.js";

function PlatformSchedule({ name, kind, q, onPin }) {
  return (
    <Card title={name} action={<span className="text-xs text-muted">{q.uploadsToday} of {q.maxPerDay} posted today</span>}>
      {!q.connected && <div className="mb-3 rounded-xl border border-warn/30 bg-warn/5 p-3 text-sm">Nothing goes out here until you <Link className="font-medium underline" to="/accounts">connect {PLATFORM[kind]}</Link>.</div>}
      {!q.enabled && <div className="mb-3 rounded-xl bg-panel2 p-3 text-sm text-muted">Automatic posting is turned off in <Link className="underline" to="/settings">Settings</Link>.</div>}
      {q.items.length ? (
        <ol className="space-y-2">
          {q.items.map((it, i) => (
            <li key={it.clipId} className="flex items-center gap-3 rounded-xl border border-line bg-bg/50 p-2">
              <span className="w-5 text-center text-xs font-bold text-muted">{i + 1}</span>
              <div className="h-14 w-8 shrink-0 rounded-md bg-black bg-cover bg-center" style={it.thumb ? { backgroundImage: `url(/api/clips/${it.clipId}/thumb)` } : undefined} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{it.title}</div>
                <div className="text-xs text-muted">{it.creatorName} · rated {it.score?.toFixed(1)}{it.attempts ? ` · try ${it.attempts + 1}` : ""}</div>
                {it.error && <div className="truncate text-xs text-warn">{postProblem(it.error)}</div>}
              </div>
              {it.pinned && <Badge kind="ready">⚡ next up</Badge>}
              <Badge kind={it.status === "uploading" ? "uploading" : kind}>{it.status === "uploading" ? "posting now" : whenLabel(it.eta)}</Badge>
              {it.status !== "uploading" && (
                <button onClick={() => onPin(it.clipId, !it.pinned)} className="rounded-md p-1.5 text-muted hover:bg-panel2 hover:text-ink"
                  title={it.pinned ? "Put back in its normal place" : "Post this one next"} aria-label={it.pinned ? "Put back in its normal place" : "Post this one next"}>
                  <Zap size={15} className={it.pinned ? "fill-brand text-ink" : ""} />
                </button>
              )}
            </li>
          ))}
        </ol>
      ) : <p className="text-sm text-muted">Nothing scheduled. Approved clips line up here.</p>}
    </Card>
  );
}

export default function Queue() {
  const { tick } = useLive();
  const toast = useToast();
  const { data, reload } = usePoll(() => api("/queue"), 30000, [tick.clips, tick.settings]);
  if (!data) return <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-64" /><Skeleton className="h-64" /></div>;
  const pin = async (id, on) => { try { await api(`/clips/${id}/priority`, { method: "POST", body: { pin: on } }); toast(on ? "This one goes out next" : "Back in its normal place"); reload(); } catch (e) { toast(e.message, true); } };
  const retry = async (id) => { try { await api(`/clips/${id}/retry`, { method: "POST" }); toast("It will try again soon"); reload(); } catch (e) { toast(e.message, true); } };
  return (
    <div className="space-y-5">
      <p className="-mt-2 max-w-2xl text-[15px] text-muted">Your best clips go out first, spaced out so your channel doesn't post too many at once. Change the pace in <Link className="underline" to="/settings">Settings</Link>, or tap <Zap size={13} className="inline" /> to post a clip next.</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <PlatformSchedule name="YouTube Shorts" kind="youtube" q={data.youtube} onPin={pin} />
        <PlatformSchedule name="Instagram Reels" kind="instagram" q={data.instagram} onPin={pin} />
      </div>
      <section>
        <h2 className="mb-2 font-semibold">Couldn't post</h2>
        {data.failed.length ? (
          <div className="space-y-2">
            {data.failed.map((c) => (
              <Card key={c._id} className="flex flex-wrap items-center gap-3 !p-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{c.title}</div>
                  {c.publications.filter((p) => p.status === "failed").map((p) => (
                    <div key={p.platform} className="mt-0.5 flex items-center gap-1.5 text-xs text-bad"><Badge kind={p.platform}>{PLATFORM[p.platform]}</Badge> {postProblem(p.error)}</div>
                  ))}
                  <div className="mt-0.5 text-xs text-muted">{c.creatorName} · {timeAgo(c.updatedAt)}</div>
                </div>
                <Button size="sm" onClick={() => retry(c._id)}><RotateCcw size={14} /> Try again</Button>
              </Card>
            ))}
          </div>
        ) : <Empty>Everything posted fine.</Empty>}
      </section>
    </div>
  );
}
