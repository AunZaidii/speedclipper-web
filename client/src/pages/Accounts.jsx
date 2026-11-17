import { Check, ChevronDown, Copy, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { Button, Skeleton, usePoll, useToast } from "../components/ui.jsx";

// Simple brand marks (drawn inline; lucide no longer ships brand icons).
function YouTubeMark() {
  return (
    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#ff0000]/10">
      <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
        <rect x="2" y="5" width="20" height="14" rx="4" fill="#ff0000" />
        <path d="M10 9.2v5.6l4.8-2.8z" fill="#fff" />
      </svg>
    </span>
  );
}
function InstagramMark() {
  return (
    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#d6246e]/10">
      <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
        <defs><linearGradient id="ig" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#feda75" /><stop offset=".45" stopColor="#d62976" /><stop offset="1" stopColor="#4f5bd5" /></linearGradient></defs>
        <rect x="3" y="3" width="18" height="18" rx="5.5" fill="none" stroke="url(#ig)" strokeWidth="2.2" />
        <circle cx="12" cy="12" r="4" fill="none" stroke="url(#ig)" strokeWidth="2.2" />
        <circle cx="17.2" cy="6.8" r="1.3" fill="#d62976" />
      </svg>
    </span>
  );
}

function Row({ icon, title, text, children, note }) {
  return (
    <div className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-4">
        {icon}
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold tracking-tight">{title}</h2>
          <p className="mt-0.5 text-[14px] leading-relaxed text-muted">{text}</p>
          {note && <p className="mt-1.5 text-[12.5px] text-muted/90">{note}</p>}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{children}</div>
    </div>
  );
}

function Status({ on, children }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[13px] font-medium ${on ? "text-ok" : "text-muted"}`}>
      {on && <Check size={15} strokeWidth={2.5} />}{children}
    </span>
  );
}

function Platform({ name, kind, acc, configured, icon, text, note, onChange }) {
  const toast = useToast();
  const disconnect = async () => {
    if (!window.confirm(`Disconnect ${name}? Clips stop posting there until you connect again.`)) return;
    try { await api(`/accounts/${kind}/disconnect`, { method: "POST" }); onChange(); toast(`${name} disconnected`); } catch (e) { toast(e.message, true); }
  };
  return (
    <Row icon={icon} title={name} text={acc ? <>Connected as <b className="font-medium text-ink">{acc.displayName}</b></> : text} note={note}>
      {acc ? (
        <>
          <Status on>Connected</Status>
          <Button variant="ghost" size="sm" className="text-muted" onClick={disconnect}>Disconnect</Button>
        </>
      ) : configured ? (
        // full-page navigation: the sign-in flow needs a top-level redirect
        <a href={`/api/accounts/${kind}/start`}><Button variant="primary">Connect</Button></a>
      ) : (
        <span className="rounded-full bg-panel2 px-3.5 py-1.5 text-[13px] text-muted">Not available yet</span>
      )}
    </Row>
  );
}

function AiTitles() {
  const { data, setData } = usePoll(() => api("/secrets"), 0);
  const [key, setKey] = useState("");
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const on = !!data?.anthropicKey;
  const save = async (value) => {
    try {
      setData(await api("/secrets/anthropic", { method: "PUT", body: { key: value } }));
      setKey(""); setOpen(false);
      toast(value ? "Smart titles are on" : "Smart titles are off");
    } catch (e) { toast(e.message, true); }
  };
  return (
    <div className={open && !on ? "pb-6" : ""}>
      <Row icon={<span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand/30"><Sparkles size={20} /></span>}
        title="Smart titles (optional)"
        text="Let AI choose the best moments and write catchy titles. Costs less than 1 cent per clip. Without it, titles are still written for you."
        note={on ? undefined : "Needs a key from Anthropic, the company behind Claude."}>
        {on ? (
          <>
            <Status on>On</Status>
            <Button variant="ghost" size="sm" className="text-muted" onClick={() => save("")}>Turn off</Button>
          </>
        ) : !open && <Button onClick={() => setOpen(true)}>Turn on</Button>}
      </Row>
      {open && !on && (
        <div className="-mt-2 flex flex-col gap-2 sm:ml-[60px] sm:flex-row">
          <input type="password" placeholder="Paste your key here" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" autoFocus />
          <div className="flex gap-2">
            <Button variant="primary" disabled={!key.trim()} onClick={() => save(key.trim())}>Save</Button>
            <Button variant="ghost" onClick={() => { setOpen(false); setKey(""); }}>Cancel</Button>
          </div>
        </div>
      )}
      {open && !on && (
        <p className="mt-2 text-[12.5px] text-muted sm:ml-[60px]">
          Get one at <a className="text-ink underline decoration-line underline-offset-2" href="https://console.anthropic.com/" target="_blank" rel="noreferrer">console.anthropic.com</a>. It's kept private and encrypted.
        </p>
      )}
    </div>
  );
}

function CopyText({ value }) {
  const [done, setDone] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard blocked */ } };
  return (
    <span className="mt-1 flex items-center gap-2">
      <code className="min-w-0 break-all rounded-lg bg-panel2 px-2 py-1 text-[12px] text-ink">{value}</code>
      <button onClick={copy} className="shrink-0 rounded-full p-1.5 text-muted hover:bg-panel2 hover:text-ink" aria-label="Copy">{done ? <Check size={14} /> : <Copy size={14} />}</button>
    </span>
  );
}

// Only the person running the site needs this; normal users never have to open it.
function OwnerSetup({ data }) {
  const missing = [!data.configured.youtube && "youtube", !data.configured.instagram && "instagram"].filter(Boolean);
  if (!missing.length) return null;
  return (
    <details className="group mt-6 rounded-2xl border border-line bg-panel px-5 py-1">
      <summary className="flex cursor-pointer list-none items-center justify-between py-3 text-[14px] text-muted [&::-webkit-details-marker]:hidden">
        Why can't I connect yet? <span className="flex items-center gap-1 text-[13px]">For the site owner <ChevronDown size={15} className="transition group-open:rotate-180" /></span>
      </summary>
      <div className="space-y-5 pb-5 pt-1 text-[13.5px] leading-relaxed text-muted">
        <p>Connecting needs a one-time setup on the server, done by whoever runs this site. After that, a <b className="font-medium text-ink">Connect</b> button appears here.</p>
        {missing.includes("youtube") && (
          <div>
            <p className="font-medium text-ink">YouTube</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5">
              <li>In Google Cloud, create a sign-in app (<i>OAuth client → Web application</i>).</li>
              <li>Add this as its redirect address:<CopyText value={data.redirects.youtube} /></li>
              <li>Put its ID and secret in the server settings as <code className="text-ink">GOOGLE_CLIENT_ID</code> and <code className="text-ink">GOOGLE_CLIENT_SECRET</code>, then restart the server.</li>
            </ol>
          </div>
        )}
        {missing.includes("instagram") && (
          <div>
            <p className="font-medium text-ink">Instagram</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5">
              <li>At developers.facebook.com, create an app with <i>Facebook Login for Business</i>.</li>
              <li>Add this as its redirect address:<CopyText value={data.redirects.instagram} /></li>
              <li>Put its ID and secret in the server settings as <code className="text-ink">META_APP_ID</code> and <code className="text-ink">META_APP_SECRET</code>, then restart the server.</li>
            </ol>
          </div>
        )}
      </div>
    </details>
  );
}

export default function Accounts() {
  const { data, reload } = usePoll(() => api("/accounts"), 0);
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  useEffect(() => {
    if (params.get("connected")) { toast(`${params.get("connected") === "youtube" ? "YouTube" : "Instagram"} connected 🎉`); setParams({}, { replace: true }); }
    if (params.get("error")) { toast("Couldn't connect. Please try again.", true); setParams({}, { replace: true }); }
  }, [params, setParams, toast]);
  if (!data) return <div className="max-w-3xl space-y-3"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /></div>;
  return (
    <div className="max-w-3xl">
      <p className="-mt-2 mb-6 text-[15px] text-muted">Connect the places where your clips get posted.</p>
      <div className="divide-y divide-line rounded-2xl border border-line bg-panel px-6">
        <Platform name="YouTube" kind="youtube" acc={data.youtube} configured={data.configured.youtube} onChange={reload}
          icon={<YouTubeMark />} text="Post clips as Shorts on your channel."
          note="We can only upload. We can't see, change or delete anything on your channel." />
        <Platform name="Instagram" kind="instagram" acc={data.instagram} configured={data.configured.instagram} onChange={reload}
          icon={<InstagramMark />} text="Post clips as Reels."
          note="Works with Instagram Business or Creator accounts linked to a Facebook Page." />
        <AiTitles />
      </div>
      <OwnerSetup data={data} />
    </div>
  );
}
