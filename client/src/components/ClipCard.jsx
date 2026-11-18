import { Sparkles } from "lucide-react";
import { useState } from "react";
import { api, timeAgo } from "../api.js";
import { CLIP_STATUS, CLIP_STATUS_HELP, PLATFORM, POST_STATUS, postProblem, ratingWord, whyPicked, whySkipped } from "../words.js";
import { Badge, Button, Field, Modal, useToast } from "./ui.jsx";

export function Rating({ score, big }) {
  if (score == null) return <span className="text-muted">Not rated</span>;
  return (
    <span className={`inline-flex items-baseline gap-1 ${big ? "text-lg" : ""}`} title="How likely this clip is to do well, from 1 to 10">
      <b>{score.toFixed(1)}</b><span className="text-xs text-muted">/10 · {ratingWord(score)}</span>
    </span>
  );
}

export function ClipDetail({ clip: initial, onClose, onChange }) {
  const [clip, setClip] = useState(initial);
  const [f, setF] = useState({ title: initial.title || "", description: initial.description || "", tags: (initial.tags || []).join(", ") });
  const [busy, setBusy] = useState(false);
  const [platforms, setPlatforms] = useState({ youtube: true, instagram: false });
  const toast = useToast();
  const locked = clip.publications?.some((p) => ["uploading", "published"].includes(p.status));
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const changed = f.title !== (clip.title || "") || f.description !== (clip.description || "") || f.tags !== (clip.tags || []).join(", ");

  const run = async (fn, msg) => {
    setBusy(true);
    try { const r = await fn(); if (r?._id) setClip(r); if (msg) toast(msg); onChange?.(); return r; }
    catch (e) { toast(e.message, true); } finally { setBusy(false); }
  };
  const save = () => run(() => api(`/clips/${clip._id}`, { method: "PATCH", body: f }), "Changes saved");
  const approve = () => {
    const list = Object.entries(platforms).filter(([, on]) => on).map(([p]) => p);
    if (!list.length) return toast("Pick where to post it: YouTube, Instagram or both.", true);
    return run(async () => { await api(`/clips/${clip._id}`, { method: "PATCH", body: f }); return api(`/clips/${clip._id}/approve`, { method: "POST", body: { platforms: list } }); },
      "Approved. It will be posted when its turn comes.");
  };
  const pinned = (clip.priority || 0) > 0;
  const pin = () => run(() => api(`/clips/${clip._id}/priority`, { method: "POST", body: { pin: !pinned } }), pinned ? "Back in its normal place" : "This one goes out next");
  const reject = () => run(() => api(`/clips/${clip._id}/reject`, { method: "POST" }), "Skipped. It won't be posted.");
  const retry = () => run(() => api(`/clips/${clip._id}/retry`, { method: "POST" }), "Trying again soon");
  const failed = clip.publications?.some((p) => p.status === "failed");
  const del = async () => { if (window.confirm("Delete this clip for good?")) { await run(() => api(`/clips/${clip._id}`, { method: "DELETE" }), "Deleted"); onClose(); } };

  return (
    <div className="grid md:grid-cols-[minmax(240px,340px)_1fr]">
      <div className="bg-black md:rounded-l-3xl">
        {clip.previewFile
          ? <video src={`/api/clips/${clip._id}/preview`} poster={clip.thumbFile ? `/api/clips/${clip._id}/thumb` : undefined} controls autoPlay playsInline className="max-h-[60vh] w-full md:max-h-[94vh] md:rounded-l-3xl" />
          : clip.thumbFile
            ? <div className="relative">
                <img src={`/api/clips/${clip._id}/thumb`} alt="" className="aspect-[9/16] w-full object-cover opacity-80 md:rounded-l-3xl" />
                <p className="absolute inset-x-0 bottom-0 bg-black/60 p-3 text-center text-xs text-white">The preview was removed to save space. The full clip is on your channel.</p>
              </div>
            : <div className="grid aspect-[9/16] place-items-center text-sm text-white/60">No preview</div>}
      </div>
      <div className="min-w-0 space-y-4 p-5 sm:p-6">
        <div className="pr-8">
          <div className="flex flex-wrap items-center gap-2">
            <Badge kind={clip.status}>{CLIP_STATUS[clip.status] || clip.status}</Badge>
            <Rating score={clip.score} big />
          </div>
          <p className="mt-1.5 text-sm text-muted">{clip.creatorName}{clip.duration ? ` · ${Math.round(clip.duration)} seconds` : ""} · {timeAgo(clip.createdAt)} · {CLIP_STATUS_HELP[clip.status]}</p>
        </div>

        <div className="flex gap-2.5 rounded-xl bg-panel2 p-3 text-sm">
          <Sparkles size={16} className="mt-0.5 shrink-0 text-muted" />
          <div><b className="font-medium">Why this clip: </b>{whyPicked(clip)}</div>
        </div>
        {clip.status === "rejected" && clip.rejectReason && (
          <div className="rounded-xl border border-warn/30 bg-warn/5 p-3 text-sm"><b className="font-medium">Why it wasn't posted: </b>{whySkipped(clip.rejectReason)}</div>
        )}

        {clip.publications?.length > 0 && (
          <div className="space-y-1.5 text-sm">
            {clip.publications.map((p) => (
              <div key={p.platform} className="flex flex-wrap items-center gap-2">
                <Badge kind={p.platform}>{PLATFORM[p.platform]}</Badge><Badge kind={p.status}>{POST_STATUS[p.status] || p.status}</Badge>
                {p.url && <a className="text-info" href={p.url} target="_blank" rel="noreferrer">Watch it →</a>}
                {p.error && p.status !== "published" && <span className="text-xs text-bad">{postProblem(p.error)}</span>}
              </div>
            ))}
          </div>
        )}

        <Field label={`Title · ${f.title.length} of 70 characters${f.title.length >= 70 ? " (too long, YouTube will cut it)" : ""}`}>
          <input value={f.title} onChange={set("title")} maxLength={100} disabled={locked} />
        </Field>
        <Field label="Description" hint="The credit to the streamer is always added, even if you remove it here.">
          <textarea rows={5} value={f.description} onChange={set("description")} disabled={locked} />
        </Field>
        <Field label="Search tags" hint="Separate with commas."><input value={f.tags} onChange={set("tags")} disabled={locked} /></Field>
        {(clip.hookText || clip.streamUrl) && (
          <div className="space-y-1 text-xs text-muted">
            {clip.hookText && <div>Big text at the start of the video: <b className="text-ink">{clip.hookText}</b></div>}
            {clip.streamUrl && <div>From the stream: <a className="text-info" href={clip.streamUrl} target="_blank" rel="noreferrer">{clip.streamTitle || "open it"}</a></div>}
          </div>
        )}
        {locked && <p className="text-xs text-muted">Already posted, so the text can't be changed here any more. Edit it on the platform instead.</p>}

        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          {!locked && changed && <Button onClick={save} disabled={busy}>Save changes</Button>}
          {!locked && clip.status !== "ready" && (
            <div className="flex w-full flex-wrap items-center gap-3 rounded-xl bg-panel2 p-2.5">
              <span className="text-sm text-muted">Post to</span>
              <label className="inline-flex items-center gap-1.5 text-sm"><input type="checkbox" checked={platforms.youtube} onChange={(e) => setPlatforms((p) => ({ ...p, youtube: e.target.checked }))} /> YouTube</label>
              <label className="inline-flex items-center gap-1.5 text-sm"><input type="checkbox" checked={platforms.instagram} onChange={(e) => setPlatforms((p) => ({ ...p, instagram: e.target.checked }))} /> Instagram</label>
              <Button variant="ok" size="sm" className="ml-auto" onClick={approve} disabled={busy}>Approve</Button>
            </div>
          )}
          {clip.status === "ready" && !locked && <Button onClick={pin} disabled={busy}>{pinned ? "Don't rush it" : "⚡ Post this next"}</Button>}
          {failed && <Button variant="primary" onClick={retry} disabled={busy}>Try posting again</Button>}
          {!locked && clip.status !== "rejected" && <Button onClick={reject} disabled={busy}>Skip</Button>}
          {!locked && <Button variant="danger" className="ml-auto" onClick={del} disabled={busy}>Delete</Button>}
        </div>
      </div>
    </div>
  );
}

export default function ClipCard({ clip, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const posted = clip.publications?.filter((p) => p.status === "published") || [];
  return (
    <>
      <button onClick={() => !disabled && setOpen(true)} className="group flex w-full flex-col overflow-hidden rounded-2xl border border-line bg-panel text-left transition hover:-translate-y-0.5 hover:border-[#d9d6ce] hover:shadow-xl hover:shadow-black/10"
        aria-label={`Open clip: ${clip.title}`}>
        <div className="relative aspect-[9/16] w-full bg-black bg-cover bg-center transition group-hover:brightness-110"
          style={clip.thumbFile ? { backgroundImage: `url(/api/clips/${clip._id}/thumb)` } : undefined}>
          <Badge kind={clip.status} className="absolute left-2 top-2">{CLIP_STATUS[clip.status] || clip.status}</Badge>
          <span className="absolute right-2 top-2 rounded-full bg-black/65 px-2 py-0.5 text-xs font-semibold text-white backdrop-blur-sm" title={`Rating: ${ratingWord(clip.score)}`}>{clip.score != null ? clip.score.toFixed(1) : "–"}</span>
          {posted.length > 0 && (
            <div className="absolute bottom-2 left-2 flex gap-1">
              {posted.map((p) => <Badge key={p.platform} kind={p.platform}>✓ {PLATFORM[p.platform]}</Badge>)}
            </div>
          )}
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
