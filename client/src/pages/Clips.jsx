import { CheckSquare, Search, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api.js";
import ClipCard from "../components/ClipCard.jsx";
import { Button, Empty, Skeleton, Tabs, usePoll, useToast } from "../components/ui.jsx";
import { useLive } from "../live.jsx";

const PAGE = 48;

export default function Clips() {
  const { tick } = useLive();
  const toast = useToast();
  const [status, setStatus] = useState("");
  const [creator, setCreator] = useState("");
  const [sort, setSort] = useState("new");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [extra, setExtra] = useState([]);
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState(new Set());
  useEffect(() => { const h = setTimeout(() => setQ(qInput.trim()), 300); return () => clearTimeout(h); }, [qInput]);

  const query = `limit=${PAGE}&sort=${sort}${status ? `&status=${status}` : ""}${creator ? `&creator=${creator}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  const { data: creators } = usePoll(() => api("/creators"), 0, [tick.creators]);
  const { data: ov } = usePoll(() => api("/overview"), 0, [tick.clips]);
  const { data: first, reload } = usePoll(() => api(`/clips?${query}`), 0, [query, tick.clips]);
  useEffect(() => setExtra([]), [query]);
  const clips = [...(first || []), ...extra];

  const loadMore = async () => {
    const last = clips.at(-1);
    const more = await api(`/clips?${query}${sort === "score" ? `&skip=${clips.length}` : `&before=${encodeURIComponent(last.createdAt)}`}`);
    setExtra((x) => [...x, ...more]);
  };
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const bulk = async (action) => {
    if (action === "delete" && !window.confirm(`Delete ${sel.size} clip(s)?`)) return;
    try {
      const r = await api("/clips/bulk", { method: "POST", body: { ids: [...sel], action } });
      toast(`${r.done} clip(s) ${action === "approve" ? "approved" : action === "reject" ? "rejected" : "deleted"}${r.skipped ? `, ${r.skipped} skipped (already published)` : ""}`);
      setSel(new Set()); setSelecting(false); reload();
    } catch (e) { toast(e.message, true); }
  };
  const c = ov?.clips || {};
  const tabs = [["", "All", Object.values(c).reduce((a, b) => a + b, 0)], ["pending", "Needs approval", c.pending || 0], ["ready", "Queued", c.ready || 0],
    ["published", "Published", c.published || 0], ["rejected", "Rejected", c.rejected || 0], ["failed", "Failed", c.failed || 0]];

  return (
    <div className="space-y-4">
      <Tabs value={status} onChange={setStatus} items={tabs} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input className="!pl-9" placeholder="Search titles…" value={qInput} onChange={(e) => setQInput(e.target.value)} />
        </div>
        <select value={creator} onChange={(e) => setCreator(e.target.value)} className="!w-auto">
          <option value="">All creators</option>{(creators || []).map((x) => <option key={x._id} value={x._id}>{x.name}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="!w-auto"><option value="new">Newest</option><option value="score">Best score</option></select>
        <Button variant={selecting ? "primary" : "default"} onClick={() => { setSelecting(!selecting); setSel(new Set()); }}>
          {selecting ? <><X size={15} /> Done</> : <><CheckSquare size={15} /> Select</>}
        </Button>
      </div>

      {selecting && (
        <div className="sticky top-2 z-30 flex flex-wrap items-center gap-2 rounded-xl border border-accent/40 bg-panel/95 p-2 shadow-xl backdrop-blur">
          <span className="px-2 text-sm"><b>{sel.size}</b> selected</span>
          <button className="text-xs text-info" onClick={() => setSel(new Set(clips.map((x) => x._id)))}>Select all {clips.length}</button>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="ok" disabled={!sel.size} onClick={() => bulk("approve")}>Approve & publish</Button>
            <Button size="sm" disabled={!sel.size} onClick={() => bulk("reject")}>Reject</Button>
            <Button size="sm" variant="danger" disabled={!sel.size} onClick={() => bulk("delete")}>Delete</Button>
          </div>
        </div>
      )}

      {!first ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">{Array.from({ length: 12 }, (_, i) => <Skeleton key={i} className="aspect-[9/16]" />)}</div>
      ) : clips.length ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {clips.map((cl) => (
              <div key={cl._id} className="relative">
                <ClipCard clip={cl} onChange={reload} disabled={selecting} />
                {selecting && (
                  <button onClick={() => toggle(cl._id)} className={`absolute inset-0 rounded-xl border-2 ${sel.has(cl._id) ? "border-accent bg-accent/10" : "border-transparent"}`} aria-label="Select clip">
                    <span className="absolute bottom-[4.5rem] right-2 rounded-md bg-black/65 p-1 text-white">{sel.has(cl._id) ? <CheckSquare size={18} className="text-brand" /> : <Square size={18} />}</span>
                  </button>
                )}
              </div>
            ))}
          </div>
          {first.length + extra.length >= PAGE && extra.length % PAGE === 0 && (
            <button onClick={loadMore} className="w-full rounded-xl border border-line py-3 text-sm text-muted hover:text-ink">Load more</button>
          )}
        </>
      ) : <Empty>{q ? `No clips match “${q}”.` : "No clips here yet."}</Empty>}
    </div>
  );
}
