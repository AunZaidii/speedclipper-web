import { Bell, KeyRound, Server, Smartphone } from "lucide-react";
import { notifyPref } from "../live.jsx";
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { Button, Card, Field, Skeleton, Toggle, useToast } from "../components/ui.jsx";

// [key, label, type, hint]. Types: bool | text | num | int | list | [[value, label], ...] | { range: [min, max, step], ends: [left, right] }
const GROUPS = [
  ["Posting", "How and when your clips go out.", [
    ["uploadsEnabled", "Post approved clips automatically", "bool", "Turn off to keep everything until you switch it back on."],
    ["requireApproval", "Let me review every clip before it's posted", "bool"],
    ["privacy", "Who can see new YouTube videos", [["public", "Everyone (public)"], ["unlisted", "Only people with the link (unlisted)"], ["private", "Only me (private)"]]],
    ["minScoreToPublish", "Only post clips rated at least", { range: [1, 10, 0.5], ends: ["Post almost everything", "Only the very best"] },
      "Every clip gets a rating from 1 to 10. 7 means great clips only."],
    ["maxUploadsPerDay", "Most posts per day", "int", "Counted separately for YouTube and Instagram."],
    ["minMinutesBetweenUploads", "Minutes to wait between posts", "num", "Spreads your posts out over the day."],
    ["defaultTags", "Search tags added to every video", "list", "Separate with commas."],
    ["instagramCaptionHashtags", "Hashtags for Instagram", "text"],
  ]],
  ["Finding moments", "For the whole site: how big moments are picked from live streams.", [
    ["spikeZThreshold", "How picky to be", { range: [1.5, 5, 0.1], ends: ["More clips", "Only the biggest moments"] },
      "How much chat has to blow up before we make a clip."],
    ["maxClipsPerHour", "Most clips per hour of stream", "int"],
    ["preRollSeconds", "Seconds to include before the moment", "num", "So viewers see what led up to it."],
    ["postRollSeconds", "Seconds to include after the moment", "num", "For the reaction."],
  ]],
  ["Video style", "For the whole site: how every clip looks.", [
    ["layout", "Layout", [["facecam_split", "Facecam on top, game below (no blur)"], ["center_crop", "Zoom to fill the screen"], ["blur_background", "Whole picture with blurred edges"]]],
    ["captions", "Captions on the video", "bool"],
    ["emoji", "Emoji pop-ups with the captions", "bool"],
    ["hookText", "Big text in the first seconds", "bool"],
    ["watermarkText", "Your channel name on the video", "text", "For example @YourChannel. Leave empty for none."],
  ]],
];

function Setting({ k, label, t, hint, value, set }) {
  if (t === "bool") return <div><Toggle checked={value} onChange={(v) => set(k, v)} label={label} />{hint && <p className="ml-6 mt-0.5 text-xs text-muted">{hint}</p>}</div>;
  if (t?.range) {
    const [min, max, step] = t.range;
    return (
      <Field label={<span className="flex items-baseline justify-between gap-2"><span>{label}</span><b className="text-ink">{value}</b></span>} hint={hint}>
        <input type="range" min={min} max={max} step={step} value={value ?? min} onChange={(e) => set(k, Number(e.target.value))} className="w-full" />
        <span className="mt-0.5 flex justify-between text-[11px] text-muted"><span>{t.ends[0]}</span><span>{t.ends[1]}</span></span>
      </Field>
    );
  }
  if (Array.isArray(t)) {
    return <Field label={label} hint={hint}><select value={value} onChange={(e) => set(k, e.target.value)}>{t.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>;
  }
  if (t === "list") return <Field label={label} hint={hint}><input value={(value || []).join(", ")} onChange={(e) => set(k, e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} /></Field>;
  return (
    <Field label={label} hint={hint}>
      <input type={t === "text" ? "text" : "number"} step={t === "int" ? 1 : "any"} min={t === "text" ? undefined : 0} value={value ?? ""}
        onChange={(e) => set(k, t === "text" ? e.target.value : e.target.value === "" ? "" : Number(e.target.value))} />
    </Field>
  );
}

function Security() {
  const [f, setF] = useState({ current: "", next: "", confirm: "" });
  const toast = useToast();
  const save = async (e) => {
    e.preventDefault();
    if (f.next !== f.confirm) return toast("The new passwords don't match", true);
    try { await api("/auth/password", { method: "POST", body: { current: f.current, next: f.next } }); setF({ current: "", next: "", confirm: "" }); toast("Password changed. Other devices were signed out."); }
    catch (err) { toast(err.message, true); }
  };
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Card title="Password">
      <form onSubmit={save} className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted"><KeyRound size={16} /> Changing your password signs out every other device.</div>
        <Field label="Current password"><input type="password" autoComplete="current-password" required value={f.current} onChange={set("current")} /></Field>
        <Field label="New password"><input type="password" autoComplete="new-password" minLength={10} required value={f.next} onChange={set("next")} /></Field>
        <Field label="Repeat new password"><input type="password" autoComplete="new-password" minLength={10} required value={f.confirm} onChange={set("confirm")} /></Field>
        <Button>Change password</Button>
      </form>
    </Card>
  );
}

function DeviceCard() {
  const toast = useToast();
  const supported = typeof window !== "undefined" && "Notification" in window;
  const [on, setOn] = useState(supported && notifyPref.get() && Notification.permission === "granted");
  const toggle = async (v) => {
    if (!v) { notifyPref.set(false); setOn(false); return; }
    const p = await Notification.requestPermission();
    if (p !== "granted") return toast("Notifications are blocked for this site in your browser settings", true);
    notifyPref.set(true); setOn(true);
    try { (await navigator.serviceWorker?.getRegistration())?.showNotification("SpeedClipper", { body: "Notifications are on for this device.", icon: "/icon-192.png" }); } catch { /* ignore */ }
  };
  return (
    <Card title="This device">
      <div className="space-y-3 text-sm">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand/25 text-ink"><Bell size={18} /></span>
          <div className="flex-1">
            {supported ? <Toggle checked={on} onChange={toggle} label="Notify me when a stream goes live, a clip needs review, or an upload finishes" />
              : <span className="text-muted">This browser doesn't support notifications.</span>}
            <p className="mt-1 text-xs text-muted">Shown while SpeedClipper is open in the background.</p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-info/15 text-info"><Smartphone size={18} /></span>
          <p className="text-muted">Install it like an app: on Android Chrome use <b className="text-ink">⋮ → Install app</b>; on iPhone Safari use <b className="text-ink">Share → Add to Home Screen</b>.</p>
        </div>
      </div>
    </Card>
  );
}

function WorkerSetup() {
  return (
    <Card title="Clipping server">
      <div className="flex gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-info/15 text-info"><Server size={18} /></span>
        <div className="min-w-0 text-sm text-muted">
          <p>The clipping server records streams, finds moments, edits and uploads for every user. It needs two lines in its <code className="text-ink">.env</code>:</p>
          <pre className="mt-2 overflow-x-auto rounded-xl bg-panel2 p-3 font-mono text-xs text-ink">{`SPEEDCLIPPER_SERVER_URL=${window.location.origin}\nSPEEDCLIPPER_WORKER_KEY=<WORKER_KEY from the server's environment>`}</pre>
          <p className="mt-2">Then on the server run <code className="text-ink">bash deploy/setup-server.sh</code>. It appears on the Overview page within 30 seconds.</p>
        </div>
      </div>
    </Card>
  );
}

export default function Settings() {
  const [s, setS] = useState(null);
  const [saved, setSaved] = useState(null);
  const toast = useToast();
  useEffect(() => { api("/settings").then((x) => { setS(x); setSaved(x); }); }, []);
  if (!s) return <div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-72" /><Skeleton className="h-72" /><Skeleton className="h-72" /></div>;
  const set = (k, v) => setS((x) => ({ ...x, [k]: v }));
  const dirty = JSON.stringify(s) !== JSON.stringify(saved);
  const save = async () => {
    const body = Object.fromEntries(Object.entries(s).filter(([k, v]) => k !== "canEditPlatform" && JSON.stringify(v) !== JSON.stringify(saved[k])));
    try { const r = await api("/settings", { method: "PATCH", body }); setS(r); setSaved(r); toast("Saved. Changes apply within a minute."); }
    catch (e) { toast(e.message, true); }
  };
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        {GROUPS.filter(([g]) => s.canEditPlatform || g === "Posting").map(([g, about, items]) => (
          <Card key={g} title={g}>
            <p className="-mt-1 mb-4 text-xs text-muted">{about}</p>
            <div className="space-y-4">
              {items.map(([k, label, t, hint]) => <Setting key={k} k={k} label={label} t={t} hint={hint} value={s[k]} set={set} />)}
            </div>
          </Card>
        ))}
      </div>
      <div className={`sticky bottom-20 z-20 flex items-center gap-3 rounded-xl p-2 md:bottom-4 ${dirty ? "border border-accent/40 bg-panel/95 shadow-xl backdrop-blur" : ""}`}>
        <Button variant="primary" disabled={!dirty} onClick={save}>Save changes</Button>
        {dirty && <><span className="text-sm text-warn">You have changes that aren't saved yet</span><Button variant="ghost" onClick={() => setS(saved)}>Undo</Button></>}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <DeviceCard />
        {s.canEditPlatform && <WorkerSetup />}
        <Security />
      </div>
    </div>
  );
}
