import { ArrowLeft, Check, ChevronRight, PartyPopper, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { Badge, Button, Skeleton, Toggle, useToast } from "../components/ui.jsx";

export default function Review() {
  const toast = useToast();
  const [queue, setQueue] = useState(null);
  const [creators, setCreators] = useState({});
  const [i, setI] = useState(0);
  const [title, setTitle] = useState("");
  const [targets, setTargets] = useState({ youtube: true, instagram: false });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState({ approved: 0, rejected: 0 });
  const touch = useRef(null);
  const [drag, setDrag] = useState(0);

  useEffect(() => {
    Promise.all([api("/clips?status=pending&sort=score&limit=200"), api("/creators")]).then(([clips, cs]) => {
      setQueue(clips);
      setCreators(Object.fromEntries(cs.map((c) => [c._id, c])));
    }).catch((e) => toast(e.message, true));
  }, [toast]);

  const clip = queue?.[i];
  useEffect(() => {
    if (!clip) return;
    setTitle(clip.title || "");
    const t = creators[clip.creator]?.targets;
    setTargets({ youtube: t?.youtube ?? true, instagram: t?.instagram ?? false });
  }, [clip, creators]);

  const next = useCallback(() => setI((x) => x + 1), []);
  const act = useCallback(async (kind) => {
    if (!clip || busy) return;
    const platforms = Object.entries(targets).filter(([, on]) => on).map(([p]) => p);
    if (kind === "approve" && !platforms.length) return toast("Pick YouTube and/or Instagram first", true);
    setBusy(true);
    try {
      if (title.trim() && title !== clip.title) await api(`/clips/${clip._id}`, { method: "PATCH", body: { title: title.trim() } });
      await api(`/clips/${clip._id}/${kind}`, { method: "POST", body: kind === "approve" ? { platforms } : {} });
      setDone((d) => ({ ...d, [kind === "approve" ? "approved" : "rejected"]: d[kind === "approve" ? "approved" : "rejected"] + 1 }));
      next();
    } catch (e) { toast(e.message, true); } finally { setBusy(false); setDrag(0); }
  }, [clip, busy, targets, title, toast, next]);

  useEffect(() => {
    const k = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "a" || e.key === "A") act("approve");
      else if (e.key === "r" || e.key === "R") act("reject");
      else if (e.key === "s" || e.key === "S" || e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [act, next]);

  const onTouchStart = (e) => { touch.current = e.touches[0].clientX; };
  const onTouchMove = (e) => { if (touch.current != null) setDrag(e.touches[0].clientX - touch.current); };
  const onTouchEnd = () => {
    if (drag > 90) act("approve"); else if (drag < -90) act("reject"); else setDrag(0);
    touch.current = null;
  };
  const progress = useMemo(() => (queue?.length ? Math.min(100, (i / queue.length) * 100) : 0), [i, queue]);

  if (!queue) return <div className="mx-auto max-w-md space-y-3"><Skeleton className="aspect-[9/16]" /></div>;
  if (!clip) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <PartyPopper size={44} className="mx-auto mb-3 text-accent" />
        <h2 className="text-xl font-bold">{queue.length ? "All caught up!" : "Nothing to review"}</h2>
        <p className="mt-1 text-sm text-muted">{queue.length ? `${done.approved} approved · ${done.rejected} rejected` : "New clips that need approval will show up here."}</p>
        <div className="mt-5 flex justify-center gap-2"><Link to="/queue"><Button>See publishing queue</Button></Link><Link to="/clips"><Button variant="primary">All clips</Button></Link></div>
      </div>
    );
  }
  const tint = drag > 40 ? "ring-ok" : drag < -40 ? "ring-bad" : "ring-transparent";
  return (
    <div className="mx-auto grid max-w-5xl gap-5 md:grid-cols-[minmax(260px,380px)_1fr]">
      <div className="space-y-2">
        <div className="h-1 overflow-hidden rounded-full bg-panel2"><div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} /></div>
        <div className={`relative overflow-hidden rounded-2xl bg-black ring-4 transition ${tint}`}
          style={{ transform: `translateX(${drag * 0.4}px) rotate(${drag * 0.02}deg)` }}
          onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
          {clip.previewFile
            ? <video key={clip._id} src={`/api/clips/${clip._id}/preview`} poster={clip.thumbFile ? `/api/clips/${clip._id}/thumb` : undefined} autoPlay loop playsInline controls className="aspect-[9/16] w-full" />
            : <div className="grid aspect-[9/16] place-items-center text-muted">No preview</div>}
          {drag > 40 && <span className="absolute left-4 top-4 rounded-lg border-2 border-ok px-3 py-1 text-lg font-semibold text-ok">APPROVE</span>}
          {drag < -40 && <span className="absolute right-4 top-4 rounded-lg border-2 border-bad px-3 py-1 text-lg font-semibold text-bad">REJECT</span>}
        </div>
        <p className="text-center text-xs text-muted md:hidden">Swipe right to approve, left to reject</p>
      </div>

      <div className="min-w-0 space-y-4">
        <div className="flex items-center gap-2 text-sm text-muted">
          <span>Clip {i + 1} of {queue.length}</span>
          <span className="ml-auto">{done.approved} approved · {done.rejected} rejected</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <b className="text-3xl font-semibold">{clip.score?.toFixed(1) ?? "–"}</b><span className="text-muted">/10</span>
          <Badge kind="pending">{clip.source === "live" ? "live clip" : "VOD clip"}</Badge>
          <span className="text-sm text-muted">{clip.creatorName} · {Math.round(clip.duration || 0)}s</span>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs text-muted">Title ({title.length}/70)</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} />
        </label>
        <div className="text-sm text-muted">Hook on video: <b className="text-ink">{clip.hookText}</b></div>
        <div className="flex flex-wrap gap-4 rounded-xl border border-line bg-panel p-3">
          <span className="text-xs text-muted">Publish to:</span>
          <Toggle checked={targets.youtube} onChange={(v) => setTargets((t) => ({ ...t, youtube: v }))} label="YouTube Shorts" />
          <Toggle checked={targets.instagram} onChange={(v) => setTargets((t) => ({ ...t, instagram: v }))} label="Instagram Reels" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Button variant="danger" className="!py-3" onClick={() => act("reject")} disabled={busy}><X size={18} /> Reject <kbd className="ml-1 hidden rounded bg-panel2 px-1.5 text-[10px] text-muted md:inline">R</kbd></Button>
          <Button className="!py-3" onClick={next} disabled={busy}>Skip <ChevronRight size={18} /><kbd className="ml-1 hidden rounded bg-panel2 px-1.5 text-[10px] text-muted md:inline">S</kbd></Button>
          <Button variant="ok" className="!py-3" onClick={() => act("approve")} disabled={busy}><Check size={18} /> Approve <kbd className="ml-1 hidden rounded bg-black/20 px-1.5 text-[10px] md:inline">A</kbd></Button>
        </div>
        <button onClick={() => setI((x) => Math.max(0, x - 1))} disabled={i === 0} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink disabled:opacity-40"><ArrowLeft size={14} /> Previous (←)</button>
        {clip.streamUrl && <div className="text-xs text-muted">Source: <a className="text-info" href={clip.streamUrl} target="_blank" rel="noreferrer">{clip.streamTitle || clip.streamUrl}</a></div>}
      </div>
    </div>
  );
}
