import { useState } from "react";
import { api, timeAgo } from "../api.js";
import { Badge, Button, Field, Modal, useToast } from "./ui.jsx";

const LABEL = { ready: "queued", pending: "needs approval", rejected: "rejected", published: "published", failed: "failed" };

export function ClipDetail({ clip: initial, onClose, onChange }) {
  const [clip, setClip] = useState(initial);
  const [f, setF] = useState({ title: initial.title || "", description: initial.description || "", tags: (initial.tags || []).join(", ") });
  const [busy, setBusy] = useState(false);
  const [platforms, setPlatforms] = useState({ youtube: true, instagram: false });
  const toast = useToast();
  const locked = clip.publications?.some((p) => ["uploading", "published"].includes(p.status));
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const run = async (fn, msg) => {
    setBusy(true);
    try { const r = await fn(); if (r?._id) setClip(r); if (msg) toast(msg); onChange?.(); return r; }
    catch (e) { toast(e.message, true); } finally { setBusy(false); }
  };
  const save = () => run(() => api(`/clips/${clip._id}`, { method: "PATCH", body: f }), "Saved");
  const approve = () => run(async () => { await api(`/clips/${clip._id}`, { method: "PATCH", body: f }); return api(`/clips/${clip._id}/approve`, { method: "POST", body: {} }); },
    "Approved. It publishes at the next free slot.");
  const approveTo = () => {
    const list = Object.entries(platforms).filter(([, on]) => on).map(([p]) => p);
    if (!list.length) return toast("Pick YouTube and/or Instagram", true);
    return run(async () => { await api(`/clips/${clip._id}`, { method: "PATCH", body: f }); return api(`/clips/${clip._id}/approve`, { method: "POST", body: { platforms: list } }); },
      "Approved. It publishes at the next free slot.");
  };
  const pinned = (clip.priority || 0) > 0;
  const pin = () => run(() => api(`/clips/${clip._id}/priority`, { method: "POST", body: { pin: !pinned } }), pinned ? "Back to normal order" : "Moved to the front of the queue");
  const reject = () => run(() => api(`/clips/${clip._id}/reject`, { method: "POST" }), "Rejected");
  const retry = () => run(() => api(`/clips/${clip._id}/retry`, { method: "POST" }), "Back in the publishing queue");
  const failed = clip.publications?.some((p) => p.status === "failed");
  const del = async () => { if (window.confirm("Delete this clip?")) { await run(() => api(`/clips/${clip._id}`, { method: "DELETE" }), "Deleted"); onClose(); } };

  return (
    <div className="grid md:grid-cols-[minmax(240px,340px)_1fr]">
      <div className="bg-black md:rounded-l-2xl">
        {clip.previewFile
          ? <video src={`/api/clips/${clip._id}/preview`} poster={clip.thumbFile ? `/api/clips/${clip._id}/thumb` : undefined} controls autoPlay playsInline className="max-h-[60vh] w-full md:max-h-[94vh]" />
          : <div className="grid aspect-[9/16] place-items-center text-sm text-muted">No preview</div>}
      </div>
      <div className="min-w-0 space-y-3 p-5">
        <div className="flex flex-wrap items-center gap-2 pr-8">
          <Badge kind={clip.status}>{LABEL[clip.status] || clip.status}</Badge>
          <b className="text-lg">{clip.score != null ? clip.score.toFixed(1) : "–"}/10</b>
          <span className="text-sm text-muted">{clip.creatorName} · {clip.duration ? `${Math.round(clip.duration)}s` : ""} · {timeAgo(clip.createdAt)}</span>
        </div>
        {clip.publications?.length > 0 && (
          <div className="space-y-1 text-sm">
            {clip.publications.map((p) => (
              <div key={p.platform} className="flex flex-wrap items-center gap-2">
                <Badge kind={p.platform}>{p.platform}</Badge><Badge kind={p.status}>{p.status}</Badge>
                {p.url && <a className="truncate text-info" href={p.url} target="_blank" rel="noreferrer">{p.url}</a>}
                {p.error && <span className="text-xs text-bad">{p.error}</span>}
              </div>
            ))}
          </div>
        )}
        {clip.rejectReason && clip.status === "rejected" && <div className="rounded-lg border border-line bg-panel2 p-2 text-sm text-warn">Why rejected: {clip.rejectReason}</div>}
        <Field label={`Title (${f.title.length}/70${f.title.length >= 70 ? ", too long for Shorts" : ""})`}>
          <input value={f.title} onChange={set("title")} maxLength={100} disabled={locked} />
        </Field>
        <Field label="Description (the creator credit is always kept)"><textarea rows={6} value={f.description} onChange={set("description")} disabled={locked} /></Field>
        <Field label="Tags"><input value={f.tags} onChange={set("tags")} disabled={locked} /></Field>
        <div className="text-xs text-muted">Hook on video: <b className="text-ink">{clip.hookText}</b> · scoring: {clip.scoreSource} ({clip.scoreReason})</div>
        {clip.streamUrl && <div className="text-xs text-muted">Source: <a className="text-info" href={clip.streamUrl} target="_blank" rel="noreferrer">{clip.streamTitle || clip.streamUrl}</a></div>}
        <div className="flex flex-wrap gap-2 pt-1">
          {!locked && <Button onClick={save} disabled={busy}>Save text</Button>}
          {!locked && clip.status !== "ready" && (
            <div className="flex w-full flex-wrap items-center gap-3 rounded-lg border border-line bg-bg/50 p-2">
              <span className="text-xs text-muted">Publish to:</span>
              <label className="inline-flex items-center gap-1.5 text-sm"><input type="checkbox" checked={platforms.youtube} onChange={(e) => setPlatforms((p) => ({ ...p, youtube: e.target.checked }))} /> YouTube</label>
              <label className="inline-flex items-center gap-1.5 text-sm"><input type="checkbox" checked={platforms.instagram} onChange={(e) => setPlatforms((p) => ({ ...p, instagram: e.target.checked }))} /> Instagram</label>
              <Button variant="ok" size="sm" className="ml-auto" onClick={approveTo} disabled={busy}>Approve & publish</Button>
            </div>
          )}
          {clip.status === "ready" && !locked && <Button onClick={pin} disabled={busy}>{pinned ? "Unpin" : "⚡ Publish next"}</Button>}
          {failed && <Button variant="primary" onClick={retry} disabled={busy}>Retry failed upload</Button>}
          {!locked && clip.status !== "rejected" && <Button onClick={reject} disabled={busy}>Reject</Button>}
          {!locked && <Button variant="danger" className="ml-auto" onClick={del} disabled={busy}>Delete</Button>}
        </div>
      </div>
    </div>
  );
}

export default function ClipCard({ clip, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => !disabled && setOpen(true)} className="group flex w-full flex-col overflow-hidden rounded-2xl border border-line bg-panel text-left transition hover:-translate-y-0.5 hover:border-[#d9d6ce] hover:shadow-xl hover:shadow-black/10">
        <div className="relative aspect-[9/16] w-full bg-black bg-cover bg-center transition group-hover:brightness-110"
          style={clip.thumbFile ? { backgroundImage: `url(/api/clips/${clip._id}/thumb)` } : undefined}>
          <Badge kind={clip.status} className="absolute left-2 top-2">{LABEL[clip.status] || clip.status}</Badge>
          <span className="absolute right-2 top-2 rounded-full bg-black/65 px-2 py-0.5 text-xs font-semibold text-white backdrop-blur-sm">{clip.score != null ? clip.score.toFixed(1) : "–"}</span>
          <div className="absolute bottom-2 left-2 flex gap-1">
            {clip.publications?.filter((p) => p.status === "published").map((p) => <Badge key={p.platform} kind={p.platform}>✓ {p.platform === "youtube" ? "YT" : "IG"}</Badge>)}
          </div>
        </div>
        <div className="p-2.5 text-xs">
          <div className="line-clamp-2 font-semibold">{clip.title}</div>
          <div className="mt-0.5 text-muted">{clip.creatorName} · {timeAgo(clip.createdAt)}</div>
        </div>
      </button>
      <Modal open={open} onClose={() => setOpen(false)} wide>
        {open && <ClipDetail clip={clip} onClose={() => setOpen(false)} onChange={onChange} />}
      </Modal>
    </>
  );
}
