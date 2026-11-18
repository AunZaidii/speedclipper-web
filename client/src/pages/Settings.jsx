import { Bell, KeyRound, Server, Smartphone } from "lucide-react";
import { notifyPref } from "../live.jsx";
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { Button, Card, Field, Skeleton, Toggle, useToast } from "../components/ui.jsx";

const GROUPS = [
  ["Publishing", [
    ["uploadsEnabled", "Publish automatically", "bool"],
    ["privacy", "YouTube privacy", ["private", "unlisted", "public"]],
    ["requireApproval", "Every clip needs my approval", "bool"],
    ["maxUploadsPerDay", "Max uploads per day (per platform)", "int"],
    ["minMinutesBetweenUploads", "Minutes between uploads", "num"],
    ["minScoreToPublish", "Min score to publish (1–10)", "num"],
    ["defaultTags", "Tags added to every upload", "list"],
    ["instagramCaptionHashtags", "Hashtags added to Instagram captions", "text"],
  ]],
  ["Finding moments (whole site)", [
    ["spikeZThreshold", "Spike threshold (higher = fewer, stronger clips)", "num"],
    ["maxClipsPerHour", "Max clips per hour of stream", "int"],
    ["preRollSeconds", "Seconds before the peak", "num"],
    ["postRollSeconds", "Seconds after the peak", "num"],
  ]],
  ["Video style (whole site)", [
    ["layout", "Video layout", [["facecam_split", "Facecam + gameplay (no blur)"], ["center_crop", "Zoom to fill the screen"], ["blur_background", "Blurred background"]]],
    ["captions", "Burned-in captions", "bool"],
    ["emoji", "Emoji pop-ups on captions", "bool"],
    ["hookText", "Hook text at the start", "bool"],
    ["watermarkText", "Watermark (e.g. @YourChannel)", "text"],
  ]],
];

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
    <Card title="Security">
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
    try { const r = await api("/settings", { method: "PATCH", body }); setS(r); setSaved(r); toast("Settings saved. They apply within a minute."); }
    catch (e) { toast(e.message, true); }
  };
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        {GROUPS.filter(([g]) => s.canEditPlatform || !g.includes("whole site")).map(([g, items]) => (
          <Card key={g} title={g}>
            <div className="space-y-3">
              {items.map(([k, label, t]) => t === "bool" ? <div key={k}><Toggle checked={s[k]} onChange={(v) => set(k, v)} label={label} /></div>
                : Array.isArray(t) ? <Field key={k} label={label}><select value={s[k]} onChange={(e) => set(k, e.target.value)}>{t.map((o) => Array.isArray(o) ? <option key={o[0]} value={o[0]}>{o[1]}</option> : <option key={o}>{o}</option>)}</select></Field>
                : t === "list" ? <Field key={k} label={label}><input value={(s[k] || []).join(", ")} onChange={(e) => set(k, e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} /></Field>
                : <Field key={k} label={label}><input type={t === "text" ? "text" : "number"} step="any" value={s[k] ?? ""} onChange={(e) => set(k, t === "text" ? e.target.value : e.target.value === "" ? "" : Number(e.target.value))} /></Field>)}
            </div>
          </Card>
        ))}
      </div>
      <div className={`sticky bottom-20 z-20 flex items-center gap-3 rounded-xl p-2 md:bottom-4 ${dirty ? "border border-accent/40 bg-panel/95 shadow-xl backdrop-blur" : ""}`}>
        <Button variant="primary" disabled={!dirty} onClick={save}>Save settings</Button>
        {dirty && <><span className="text-sm text-warn">Unsaved changes</span><Button variant="ghost" onClick={() => setS(saved)}>Discard</Button></>}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <DeviceCard />
        {s.canEditPlatform && <WorkerSetup />}
        <Security />
      </div>
    </div>
  );
}
