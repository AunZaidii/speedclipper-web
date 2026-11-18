import { Activity, BarChart3, Film, LayoutDashboard, Link2, ListOrdered, LogOut, Menu, Radio, Settings as Cog, ThumbsUp, Tv, X, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api } from "./api.js";
import { usePoll, useToast } from "./components/ui.jsx";
import { LiveProvider, useLive } from "./live.jsx";
import Accounts from "./pages/Accounts.jsx";
import ActivityPage from "./pages/Activity.jsx";
import Analytics from "./pages/Analytics.jsx";
import Clips from "./pages/Clips.jsx";
import Landing, { Wordmark } from "./pages/Landing.jsx";
import Creators from "./pages/Creators.jsx";
import Overview from "./pages/Overview.jsx";
import Queue from "./pages/Queue.jsx";
import Review from "./pages/Review.jsx";
import Settings from "./pages/Settings.jsx";
import Streams from "./pages/Streams.jsx";

const GROUPS = [
  ["Watch", [
    { to: "/", label: "Home", icon: LayoutDashboard },
    { to: "/streams", label: "Live", icon: Radio },
    { to: "/activity", label: "Activity", icon: Activity },
  ]],
  ["Your clips", [
    { to: "/review", label: "Review", icon: ThumbsUp, badge: "pending" },
    { to: "/clips", label: "My clips", icon: Film },
    { to: "/queue", label: "Schedule", icon: ListOrdered },
    { to: "/analytics", label: "Stats", icon: BarChart3 },
  ]],
  ["Setup", [
    { to: "/creators", label: "Streamers", icon: Tv },
    { to: "/accounts", label: "Accounts", icon: Link2 },
    { to: "/settings", label: "Settings", icon: Cog },
  ]],
];
const ALL = GROUPS.flatMap(([, items]) => items);
const PHONE_MAIN = ["/", "/review", "/clips", "/streams"];

function Brand() {
  return (
    <Wordmark />
  );
}

function Login({ setupNeeded, signupOpen, mode, onDone }) {
  // The page decides the form: /signup creates the account, /login logs in.
  const signup = mode === "signup";
  const closed = signup && !signupOpen;   // the admin can close sign-up (SIGNUP_OPEN=false)
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try { onDone(await api(signup ? "/auth/signup" : "/auth/login", { method: "POST", body: { email, password } })); navigate("/"); }
    catch (err) { toast(err.message, true); } finally { setBusy(false); }
  };
  const linkCls = "font-medium text-neutral-900 underline decoration-neutral-300 underline-offset-4 hover:decoration-neutral-900";
  return (
    <div className="lp grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col px-6 py-6 sm:px-10">
        <Link to="/" aria-label="Back to home" className="self-start"><Wordmark /></Link>
        {closed ? (
          <div className="m-auto w-full max-w-[380px] py-12">
            <h1 className="text-[34px] font-semibold leading-tight tracking-[-.03em]">Sign-up is <span className="serif font-normal">closed</span></h1>
            <p className="mt-2 text-[15px] leading-relaxed text-neutral-600">New accounts aren't being accepted on this site right now. If you already have one, log in.</p>
            <Link to="/login" className="mt-8 block w-full rounded-full bg-neutral-900 py-3.5 text-center text-[15px] font-medium text-white transition hover:bg-neutral-700">Go to log in</Link>
            <p className="mt-6 text-center text-[14px] text-neutral-600"><Link className={linkCls} to="/">Back to the home page</Link></p>
          </div>
        ) : (
          <form onSubmit={submit} className="m-auto w-full max-w-[380px] py-12">
            <h1 className="text-[34px] font-semibold leading-tight tracking-[-.03em]">
              {signup ? <>Create your <span className="serif font-normal">account</span></> : <>Welcome <span className="serif font-normal">back</span></>}
            </h1>
            <p className="mt-2 text-[15px] leading-relaxed text-neutral-600">
              {signup ? (setupNeeded ? "You're the first one here, so this becomes the admin account." : "Free. Add the streamers you like and get Shorts made for you.") : "Log in to your clipping studio."}
            </p>
            <div className="mt-8 space-y-4">
              <label className="block"><span className="mb-1.5 block text-[13px] font-medium text-neutral-700">Email</span>
                <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
              <label className="block"><span className="mb-1.5 block text-[13px] font-medium text-neutral-700">Password</span>
                <input type="password" autoComplete={signup ? "new-password" : "current-password"} required minLength={signup ? 10 : 1} value={password} onChange={(e) => setPassword(e.target.value)} />
                {signup && <span className="mt-1.5 block text-[12.5px] text-neutral-500">At least 10 characters.</span>}</label>
              <button disabled={busy} className="mt-2 w-full rounded-full bg-neutral-900 py-3.5 text-[15px] font-medium text-white transition hover:bg-neutral-700 disabled:opacity-60">
                {busy ? "One moment…" : signup ? "Create account" : "Log in"}
              </button>
            </div>
            <p className="mt-6 text-center text-[14px] text-neutral-600">
              {signup
                ? <>Already have an account? <Link className={linkCls} to="/login">Log in</Link></>
                : signupOpen
                  ? <>New here? <Link className={linkCls} to="/signup">Create an account</Link></>
                  : <Link className={linkCls} to="/">Back to the home page</Link>}
            </p>
          </form>
        )}
      </div>
      <div className="relative hidden p-3 lg:block">
        <img src="/landing/desk.webp" alt="" className="h-full w-full rounded-[24px] object-cover" />
        <div className="absolute inset-3 rounded-[24px] bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        <p className="absolute bottom-12 left-12 right-12 text-[34px] font-semibold leading-tight tracking-[-.03em] text-white [text-shadow:0_2px_24px_rgba(0,0,0,.5)]">
          Live streams in. <span className="serif font-normal">Shorts out.</span>
        </p>
      </div>
    </div>
  );
}

function NavItem({ item, pending, onClick }) {
  const Icon = item.icon;
  return (
    <NavLink to={item.to} end={item.to === "/"} onClick={onClick} className={({ isActive }) =>
      `group mb-0.5 flex items-center gap-2.5 rounded-xl px-3 py-2 text-[14px] transition-colors ${isActive ? "bg-panel2 font-medium text-ink" : "text-muted hover:bg-panel2/70 hover:text-ink"}`}>
      <Icon size={17} strokeWidth={1.8} /> {item.label}
      {item.badge === "pending" && pending > 0 && <span className="ml-auto rounded-full bg-brand px-1.5 text-[11px] font-semibold text-black">{pending}</span>}
    </NavLink>
  );
}

function Shell({ me, onLogout }) {
  const loc = useLocation();
  const { connected, tick } = useLive();
  const { data: ov } = usePoll(() => api("/overview"), 30000, [tick.clips, tick.worker]);
  const [more, setMore] = useState(false);
  const pending = ov?.clips?.pending || 0;
  const title = ALL.find((n) => (n.to === "/" ? loc.pathname === "/" : loc.pathname.startsWith(n.to)))?.label || "";
  useEffect(() => setMore(false), [loc.pathname]);

  return (
    <div className="min-h-screen md:grid md:grid-cols-[232px_1fr]">
      <nav className="sticky top-0 hidden h-screen flex-col overflow-y-auto overscroll-contain border-r border-line bg-bg px-3 py-5 md:flex">
        <div className="mb-6 shrink-0 px-2 pt-1"><Brand /></div>
        {GROUPS.map(([g, items]) => (
          <div key={g} className="mb-3 shrink-0">
            <div className="mb-1.5 px-3 text-[11px] font-medium uppercase tracking-[.12em] text-muted/80">{g}</div>
            {items.map((it) => <NavItem key={it.to} item={it} pending={pending} />)}
          </div>
        ))}
        <div className="mt-auto shrink-0 space-y-2 px-2 pt-4 text-xs text-muted">
          <div className="flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${connected ? "bg-ok" : "bg-muted"}`} />{connected ? "Up to date" : "Reconnecting…"}</div>
          <div className="truncate">{me.email}</div>
          <button onClick={onLogout} className="inline-flex items-center gap-1.5 hover:text-ink"><LogOut size={14} /> Sign out</button>
        </div>
      </nav>

      <main className="min-w-0 px-4 pb-28 pt-5 md:px-10 md:pb-12 md:pt-8">
        <header className="mb-6 flex items-center gap-3">
          <div className="md:hidden"><Brand /></div>
          <h1 className="mr-auto hidden text-[34px] font-semibold leading-tight tracking-[-.03em] md:block">{title}</h1>
          <span className="ml-auto hidden items-center gap-1.5 text-xs text-muted sm:inline-flex md:hidden"><span className={`h-2 w-2 rounded-full ${connected ? "bg-ok" : "bg-muted"}`} /></span>
        </header>
        <h1 className="-mt-2 mb-5 text-[28px] font-semibold tracking-[-.03em] md:hidden">{title}</h1>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/streams" element={<Streams />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/review" element={<Review />} />
          <Route path="/clips" element={<Clips />} />
          <Route path="/queue" element={<Queue />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/creators" element={<Creators />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {/* phone: 4 main tabs + More sheet */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-line bg-bg/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
        {ALL.filter((n) => PHONE_MAIN.includes(n.to)).map(({ to, label, icon: Icon, badge }) => (
          <NavLink key={to} to={to} end={to === "/"} className={({ isActive }) => `relative flex flex-col items-center gap-0.5 py-2 text-[11px] ${isActive ? "font-medium text-ink" : "text-muted"}`}>
            <Icon size={19} /> {label}
            {badge === "pending" && pending > 0 && <span className="absolute right-[22%] top-1 rounded-full bg-brand px-1 text-[9px] font-semibold text-black">{pending}</span>}
          </NavLink>
        ))}
        <button onClick={() => setMore(true)} className="flex flex-col items-center gap-0.5 py-2 text-[11px] text-muted"><Menu size={19} /> More</button>
      </nav>
      {more && (
        <div className="fixed inset-0 z-50 bg-black/25 backdrop-blur-sm md:hidden" onClick={() => setMore(false)}>
          <div className="absolute inset-x-0 bottom-0 rounded-t-3xl border-t border-line bg-panel p-5 pb-[calc(1rem+env(safe-area-inset-bottom))]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center"><b>More</b><button className="ml-auto text-muted" onClick={() => setMore(false)} aria-label="Close"><X size={18} /></button></div>
            <div className="grid grid-cols-3 gap-2">
              {ALL.filter((n) => !PHONE_MAIN.includes(n.to)).map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} className="flex flex-col items-center gap-1 rounded-xl border border-line bg-panel2 py-3 text-xs"><Icon size={20} />{label}</NavLink>
              ))}
              <button onClick={onLogout} className="flex flex-col items-center gap-1 rounded-xl border border-line bg-panel2 py-3 text-xs text-bad"><LogOut size={20} />Sign out</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [me, setMe] = useState(undefined);
  const [status, setStatus] = useState({ setupNeeded: false, signupOpen: true });
  const check = async () => {
    try { setMe(await api("/auth/me")); } catch {
      setMe(null);
      try { setStatus(await api("/auth/status")); } catch { /* offline */ }
    }
  };
  useEffect(() => { check(); }, []);
  useEffect(() => {
    const out = () => setMe(null);
    window.addEventListener("sc:logout", out);
    return () => window.removeEventListener("sc:logout", out);
  }, []);
  if (me === undefined) return <div className="grid min-h-screen place-items-center"><Brand /></div>;
  if (!me) {
    const done = (u) => { setStatus((s) => ({ ...s, setupNeeded: false })); setMe(u); };
    const { setupNeeded, signupOpen } = status;
    return (
      <Routes>
        <Route path="/" element={<Landing signupOpen={signupOpen} />} />
        <Route path="/login" element={<Login key="login" setupNeeded={setupNeeded} signupOpen={signupOpen} mode="login" onDone={done} />} />
        <Route path="/signup" element={<Login key="signup" setupNeeded={setupNeeded} signupOpen={signupOpen} mode="signup" onDone={done} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  const logout = async () => { await api("/auth/logout", { method: "POST" }).catch(() => {}); setMe(null); };
  return <LiveProvider><Shell me={me} onLogout={logout} /></LiveProvider>;
}
