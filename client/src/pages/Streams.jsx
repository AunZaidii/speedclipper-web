import { Link } from "react-router-dom";
import { api, minutes, timeAgo } from "../api.js";
import { Avatar, Badge, Card, Empty, Skeleton, usePoll } from "../components/ui.jsx";
import { useLive } from "../live.jsx";
import { LiveTimer } from "./Overview.jsx";

export default function Streams() {
  const { tick } = useLive();
  const { data } = usePoll(() => api("/sessions?limit=100"), 30000, [tick.worker, tick.clips]);
  if (!data) return <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>;
  const live = data.filter((s) => s.live);
  const past = data.filter((s) => !s.live);
  return (
    <div className="space-y-5">
      <section>
        <h2 className="mb-2 font-semibold">Live right now</h2>
        {live.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {live.map((s) => (
              <Card key={s._id} className="border-bad/40 bg-gradient-to-br from-bad/10 to-panel">
                <div className="flex items-center gap-3">
                  <Avatar name={s.creatorName || "?"} platform={s.platform} live size={44} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2"><b>{s.creatorName}</b><Badge kind="live">● LIVE</Badge><Badge kind={s.platform}>{s.platform === "twitch" ? "Twitch" : "YouTube"}</Badge></div>
                    <div className="truncate text-sm text-muted">{s.title}</div>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                  {[["Recording for", <LiveTimer key="t" since={new Date(s.startedAt).getTime() / 1000} />], ["Chat messages", Number(s.chatMessages || 0).toLocaleString()],
                    ["Big moments", s.moments || 0], ["Your clips", s.clips]].map(([l, v]) => (
                    <div key={l} className="rounded-lg bg-bg/60 py-2"><div className="text-lg font-bold">{v}</div><div className="text-[11px] text-muted">{l}</div></div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        ) : <Empty>None of your streamers is live right now. We check every minute and start recording as soon as one goes live.</Empty>}
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Past streams</h2>
        {past.length ? (
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-line">{["Streamer", "Stream", "When", "Length", "Chat messages", "Big moments", "Your clips"].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {past.map((s) => (
                  <tr key={s._id} className="border-b border-line/60 last:border-0 hover:bg-panel2/40">
                    <td className="px-4 py-3"><div className="flex items-center gap-2"><Avatar name={s.creatorName || "?"} platform={s.platform} size={28} /><b>{s.creatorName}</b></div></td>
                    <td className="max-w-[260px] truncate px-4 py-3 text-muted">{s.title}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{timeAgo(s.startedAt)}</td>
                    <td className="px-4 py-3">{minutes(s.recordedSeconds)}</td>
                    <td className="px-4 py-3">{Number(s.chatMessages || 0).toLocaleString()}</td>
                    <td className="px-4 py-3">{s.moments || 0}</td>
                    <td className="px-4 py-3">{s.clips ? <Link to="/clips" className="text-info">{s.clips} ({s.published} posted)</Link> : "0"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ) : <Empty>Streams you follow show up here once they end, with how many clips they gave you.</Empty>}
      </section>
    </div>
  );
}
