import { Pencil, Plus, RefreshCw, Square, Trash2 } from "lucide-react";
import { useState } from "react";
import { api, timeAgo } from "../api.js";
import { Avatar, Badge, Button, Card, Empty, Field, Modal, Skeleton, Toggle, usePoll, useToast } from "../components/ui.jsx";
import { useLive } from "../live.jsx";

function AddCreator({ onAdded }) {
  const [f, setF] = useState({ link: "", name: "", hashtags: "", autoUpload: true, youtube: true, instagram: false });
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const c = await api("/creators", { method: "POST", body: { link: f.link, name: f.name, hashtags: f.hashtags, autoUpload: f.autoUpload,
        targets: { youtube: f.youtube, instagram: f.instagram } } });
      toast(`Added ${c.name}. The clipping server picks it up within a minute.`);
      setF({ ...f, link: "", name: "", hashtags: "" });
      onAdded();
    } catch (err) { toast(err.message, true); } finally { setBusy(false); }
  };
  return (
    <Card title="Follow a streamer">
      <form onSubmit={add} className="grid gap-3 md:grid-cols-[2fr_1.2fr_1.2fr]">
        <Field label="Their YouTube or Twitch channel" hint="Paste the channel link or the @name."><input required placeholder="@IShowSpeed or twitch.tv/name" value={f.link} onChange={set("link")} /></Field>
        <Field label="Name to show (optional)"><input placeholder="IShowSpeed" value={f.name} onChange={set("name")} /></Field>
        <Field label="Extra hashtags for their clips (optional)"><input placeholder="#speed #football" value={f.hashtags} onChange={set("hashtags")} /></Field>
        <div className="flex flex-wrap items-center gap-4 md:col-span-3">
          <span className="text-sm text-muted">Post their clips to</span>
          <Toggle checked={f.youtube} onChange={set("youtube")} label="YouTube Shorts" />
          <Toggle checked={f.instagram} onChange={set("instagram")} label="Instagram Reels" />
          <Toggle checked={f.autoUpload} onChange={set("autoUpload")} label="Post automatically (no review needed)" />
          <Button variant="primary" className="ml-auto" disabled={busy}><Plus size={16} /> Follow</Button>
        </div>
      </form>
      <p className="mt-3 text-xs text-muted">Only follow streamers who allow clipping. Every post credits them with a link to their channel.</p>
    </Card>
  );
}

function EditCreator({ creator, onClose, onSaved, isAdmin }) {
  const [f, setF] = useState({ name: creator.name, creditLine: creator.creditLine, tags: creator.tags.join(", "), hashtags: creator.hashtags, ...(isAdmin ? { layout: creator.layout } : {}) });
  const toast = useToast();
  const save = async () => {
    try { await api(`/creators/${creator._id}`, { method: "PATCH", body: f }); toast("Changes saved"); onSaved(); onClose(); } catch (e) { toast(e.message, true); }
  };
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <div className="space-y-3 p-5">
      <h2 className="text-lg font-bold">{creator.name}</h2>
      <Field label="Name to show"><input value={f.name} onChange={set("name")} /></Field>
      <Field label="Credit line" hint="Added to every video description so the streamer gets credit."><input value={f.creditLine} onChange={set("creditLine")} /></Field>
      <Field label="Search tags" hint="Separate with commas."><input value={f.tags} onChange={set("tags")} /></Field>
      <Field label="Extra hashtags"><input value={f.hashtags} onChange={set("hashtags")} /></Field>
      {isAdmin && <Field label="Video layout" hint="Applies to everyone who follows this streamer.">
        <select value={f.layout} onChange={set("layout")}>
          <option value="">Same as the rest of the site</option>
          <option value="facecam_split">Facecam + gameplay (no blur)</option>
          <option value="center_crop">Zoom to fill the screen</option>
          <option value="blur_background">Blurred background</option>
        </select>
      </Field>}
      <div className="flex gap-2"><Button variant="primary" onClick={save}>Save</Button><Button onClick={onClose}>Cancel</Button></div>
    </div>
  );
}

export default function Creators() {
  const { tick } = useLive();
  const { data, reload } = usePoll(() => api("/creators"), 30000, [tick.creators, tick.worker, tick.clips]);
  const { data: me } = usePoll(() => api("/auth/me"), 0);
  const command = async (type, c) => {
    try { await api("/commands", { method: "POST", body: { type, payload: { creatorId: c._id } } }); toast(type === "check_now" ? `Checking if ${c.name} is live…` : `Stopping ${c.name}'s recording…`); }
    catch (e) { toast(e.message, true); }
  };
  const [editing, setEditing] = useState(null);
  const toast = useToast();
  const patch = async (c, body) => {
    try { await api(`/creators/${c._id}`, { method: "PATCH", body }); reload(); } catch (e) { toast(e.message, true); }
  };
  const remove = async (c) => {
    if (!window.confirm(`Stop following ${c.name}? Clips you already have stay.`)) return;
    try { await api(`/creators/${c._id}`, { method: "DELETE" }); reload(); } catch (e) { toast(e.message, true); }
  };

  return (
    <div className="space-y-5">
      <AddCreator onAdded={reload} />
      {!data ? <div className="grid gap-3 lg:grid-cols-2"><Skeleton className="h-36" /><Skeleton className="h-36" /></div> : !data.length ? <Empty>You're not following anyone yet. Add a streamer above and we'll start watching for their live streams.</Empty> : (
        <div className="grid gap-3 lg:grid-cols-2">
          {data.map((c) => (
            <Card key={c._id} className={c.live ? "border-bad/40" : ""}>
              <div className="flex items-start gap-3">
                <Avatar name={c.name} platform={c.platform} live={!!c.live} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge kind={c.platform}>{c.platform === "twitch" ? "Twitch" : "YouTube"}</Badge>
                    <b className="truncate">{c.name}</b>
                    {c.live && <Badge kind="live">● LIVE</Badge>}
                  </div>
                  <a href={c.channelUrl} target="_blank" rel="noreferrer" className="text-xs text-info">{c.handle}</a>
                  <div className="mt-1 text-xs text-muted">
                    {c.live ? `Live now: ${c.live.title}` : `${c.enabled ? "Watching" : "Paused"} · last live ${timeAgo(c.lastLiveAt)}`} · {c.clips} clip{c.clips === 1 ? "" : "s"} ({c.published} posted)
                  </div>
                </div>
                {c.live
                  ? <Button size="sm" variant="danger" onClick={() => command("stop_session", c)} title="Stop recording this stream"><Square size={13} /> Stop</Button>
                  : <Button size="sm" onClick={() => command("check_now", c)} disabled={!c.enabled} title="Check right now if they're live"><RefreshCw size={13} /> Check now</Button>}
                <Button size="sm" variant="ghost" onClick={() => setEditing(c)} aria-label="Edit"><Pencil size={15} /></Button>
                <Button size="sm" variant="ghost" className="text-bad" onClick={() => remove(c)} aria-label="Remove"><Trash2 size={15} /></Button>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 border-t border-line pt-3">
                <Toggle checked={c.enabled} onChange={(v) => patch(c, { enabled: v })} label="Watch for live streams" />
                <Toggle checked={c.autoUpload} onChange={(v) => patch(c, { autoUpload: v })} label="Post automatically" />
                <Toggle checked={c.targets?.youtube} onChange={(v) => patch(c, { targets: { youtube: v } })} label="YouTube" />
                <Toggle checked={c.targets?.instagram} onChange={(v) => patch(c, { targets: { instagram: v } })} label="Instagram" />
              </div>
            </Card>
          ))}
        </div>
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)}>
        {editing && <EditCreator creator={editing} onClose={() => setEditing(null)} onSaved={reload} isAdmin={me?.role === "admin"} />}
      </Modal>
    </div>
  );
}
