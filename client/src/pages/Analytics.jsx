import { useState } from "react";
import { api } from "../api.js";
import { BarChart, SERIES } from "../components/charts.jsx";
import { Avatar, Badge, Card, Empty, Skeleton, Tabs, usePoll } from "../components/ui.jsx";
import { useLive } from "../live.jsx";

function Tile({ label, value, sub }) {
  return (
    <Card>
      <div className="text-[13px] font-medium text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="text-xs text-muted">{sub}</div>}
    </Card>
  );
}

export default function Analytics() {
  const { tick } = useLive();
  const [days, setDays] = useState("14");
  const { data: a } = usePoll(() => api(`/analytics?days=${days}`), 0, [days, tick.clips]);
  if (!a) return <div className="space-y-4"><Skeleton className="h-24" /><Skeleton className="h-64" /><Skeleton className="h-64" /></div>;
  const t = a.totals;
  const statusSeries = [
    { key: "published", label: "Published", color: SERIES[0] },
    { key: "ready", label: "Queued", color: SERIES[1] },
    { key: "pending", label: "Needs approval", color: SERIES[2] },
    { key: "rejected", label: "Rejected", color: SERIES[3] },
  ];
  const conversion = t.clips ? Math.round(((t.byStatus.published || 0) / t.clips) * 100) : 0;
  return (
    <div className="space-y-5">
      <Tabs value={days} onChange={setDays} items={[["7", "7 days"], ["14", "14 days"], ["30", "30 days"], ["90", "90 days"]]} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile label="Clips made" value={t.clips} sub={t.avgScore ? `avg score ${t.avgScore.toFixed(1)}` : "–"} />
        <Tile label="Published" value={t.byStatus.published || 0} sub={`${conversion}% of clips`} />
        <Tile label="Streams recorded" value={t.sessions} sub={`${t.hoursRecorded.toFixed(1)} h of video`} />
        <Tile label="Moments found" value={t.moments} sub={t.sessions ? `${(t.moments / t.sessions).toFixed(1)} per stream` : "–"} />
        <Tile label="Chat analysed" value={Number(t.chatMessages).toLocaleString()} sub="messages" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Clips per day by outcome">
          {t.clips ? <BarChart data={a.clipsByDay} series={statusSeries} title="Clips per day by outcome" /> : <Empty>No clips in this period.</Empty>}
        </Card>
        <Card title="Published per day">
          {t.published ? <BarChart data={a.publishedByDay} series={[{ key: "youtube", label: "YouTube", color: SERIES[0] }, { key: "instagram", label: "Instagram", color: SERIES[1] }]}
            title="Published per day by platform" /> : <Empty>Nothing published in this period.</Empty>}
        </Card>
        <Card title="Score distribution">
          {t.clips ? <BarChart data={a.scoreHistogram} xKey="score" xFmt={(s) => String(s)} series={[{ key: "n", label: "Clips", color: SERIES[0] }]} height={160} title="Clips by score" />
            : <Empty>No scores yet.</Empty>}
          <p className="mt-1 text-xs text-muted">Clips scoring below your minimum (Settings) are rejected automatically.</p>
        </Card>
        <Card title="Creators">
          {a.perCreator.length ? (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted"><tr><th className="pb-2 font-medium">Creator</th><th className="pb-2 font-medium">Clips</th><th className="pb-2 font-medium">Published</th><th className="pb-2 font-medium">Avg score</th></tr></thead>
              <tbody>
                {a.perCreator.map((c) => (
                  <tr key={c.name} className="border-t border-line">
                    <td className="py-2"><div className="flex items-center gap-2"><Avatar name={c.name} size={24} />{c.name}</div></td>
                    <td className="py-2">{c.clips}</td><td className="py-2">{c.published}</td><td className="py-2">{c.avgScore?.toFixed(1) ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty>No creators with clips yet.</Empty>}
        </Card>
      </div>
      <Card title="Top clips">
        {a.topClips.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {a.topClips.map((c, i) => (
              <div key={c._id} className="overflow-hidden rounded-xl border border-line">
                <div className="relative aspect-[9/16] bg-black bg-cover bg-center" style={c.thumbFile ? { backgroundImage: `url(/api/clips/${c._id}/thumb)` } : undefined}>
                  <span className="absolute left-2 top-2 rounded-full bg-brand px-2 text-xs font-semibold text-black">#{i + 1}</span>
                  <span className="absolute right-2 top-2 rounded-full bg-black/65 px-2 text-xs font-semibold text-white">{c.score?.toFixed(1)}</span>
                </div>
                <div className="p-2 text-xs"><div className="line-clamp-2 font-medium">{c.title}</div><div className="mt-1"><Badge kind={c.status}>{c.status}</Badge></div></div>
              </div>
            ))}
          </div>
        ) : <Empty>No clips in this period.</Empty>}
      </Card>
    </div>
  );
}
