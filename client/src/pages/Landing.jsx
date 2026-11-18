import { ArrowRight, ArrowUpRight, Plus, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

// Light, minimal marketing page for signed-out visitors.
// Photos are from Unsplash (free license), credited in the footer. No streamer likenesses.

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function Wordmark({ invert = false }) {
  return (
    <span className="flex items-center gap-2 text-[17px] font-semibold tracking-tight">
      <span className={`grid h-7 w-7 place-items-center rounded-lg ${invert ? "bg-white text-neutral-900" : "bg-neutral-900 text-[#ffd400]"}`}><Zap size={15} strokeWidth={2.5} /></span>
      SpeedClipper
    </span>
  );
}

// Fade sections in as they scroll into view (instantly visible with reduced motion).
function useReveal() {
  useEffect(() => {
    const els = [...document.querySelectorAll(".reveal")];
    if (reducedMotion() || !("IntersectionObserver" in window)) { els.forEach((e) => e.classList.add("in")); return; }
    const io = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
    }), { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
}

function Nav({ signupOpen }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header className={`sticky top-0 z-30 transition-colors duration-300 ${scrolled ? "border-b border-black/[.06] bg-[#fbfaf7]/85 backdrop-blur-md" : "border-b border-transparent"}`}>
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link to="/" aria-label="SpeedClipper home"><Wordmark /></Link>
        <div className="hidden items-center gap-8 text-[14px] text-neutral-600 md:flex">
          <a href="#how" className="hover:text-neutral-900">How it works</a>
          <a href="#features" className="hover:text-neutral-900">Features</a>
          <a href="#faq" className="hover:text-neutral-900">FAQ</a>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-3">
          <Link to="/login" className="rounded-full px-3 py-2 text-[14px] font-medium text-neutral-700 hover:text-neutral-900">Log in</Link>
          <Link to={signupOpen ? "/signup" : "/login"} className="rounded-full bg-neutral-900 px-4 py-2 text-[14px] font-medium text-white transition hover:bg-neutral-700">{signupOpen ? "Get started" : "Log in"}</Link>
        </div>
      </nav>
    </header>
  );
}

// The caption style the engine burns into every clip, played word by word over the photo.
const LINES = [["NO", "WAY", "HE", "DID", "THAT", "😱"], ["CHAT", "IS", "GOING", "CRAZY", "🔥"], ["WAIT", "FOR", "IT…"]];
const SCHEDULE = LINES.flatMap((words, li) => [...words.map((_, wi) => [li, wi]), [li, words.length - 1], [li, words.length - 1], [li, words.length - 1]]);

function LiveCaption() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (reducedMotion()) return;
    const t = setInterval(() => setTick((v) => (v + 1) % SCHEDULE.length), 380);
    return () => clearInterval(t);
  }, []);
  const [li, wi] = reducedMotion() ? [0, LINES[0].length - 1] : SCHEDULE[tick];
  const stroke = "0 2px 0 #000, 2px 0 0 #000, -2px 0 0 #000, 0 -2px 0 #000, 2px 2px 0 #000, -2px 2px 0 #000, 0 6px 18px rgba(0,0,0,.45)";
  return (
    <p aria-hidden className="text-center text-[26px] font-extrabold leading-tight tracking-tight sm:text-[30px]" style={{ textShadow: stroke }}>
      {LINES[li].slice(0, wi + 1).map((w, i) => (
        <span key={`${li}-${i}`} className={`cap-word mx-[5px] inline-block ${i === wi ? "text-[#ffd400]" : "text-white"}`}>{w}</span>
      ))}
    </p>
  );
}

function Hero({ cta, ctaLabel }) {
  return (
    <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-10 sm:px-8 lg:grid-cols-[1.08fr_.92fr] lg:gap-16 lg:pb-28 lg:pt-16">
      <div className="reveal">
        <p className="mb-6 text-[13px] font-medium uppercase tracking-[.14em] text-neutral-500">For clip channels</p>
        <h1 className="text-[44px] font-semibold leading-[1.02] tracking-[-.035em] text-neutral-900 sm:text-6xl lg:text-[74px]">
          Every live stream, clipped into Shorts <span className="serif whitespace-nowrap font-normal">while you sleep.</span>
        </h1>
        <p className="mt-7 max-w-[30rem] text-[17px] leading-relaxed text-neutral-600">
          SpeedClipper watches the streamers you follow, finds the moments chat goes wild, and turns them into captioned
          vertical clips ready for YouTube and Instagram.
        </p>
        <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-4">
          <Link to={cta} className="group inline-flex items-center gap-2 rounded-full bg-neutral-900 px-6 py-3.5 text-[15px] font-medium text-white transition hover:bg-neutral-700">
            {ctaLabel} <ArrowRight size={16} className="transition group-hover:translate-x-0.5" />
          </Link>
          <a href="#how" className="text-[15px] font-medium text-neutral-700 underline decoration-neutral-300 underline-offset-[6px] hover:decoration-neutral-900">See how it works</a>
        </div>
        <p className="mt-10 text-[13px] text-neutral-500">Free · Nothing to install · Always credits the creator</p>
      </div>

      <figure className="reveal relative mx-auto w-full max-w-[440px] lg:max-w-none" style={{ transitionDelay: "120ms" }}>
        <img src="/landing/streamer.webp" alt="A streamer wearing headphones, lit by blue and pink light" width="900" height="1350"
          className="aspect-[4/5] w-full rounded-[28px] object-cover object-[50%_30%] shadow-[0_40px_80px_-40px_rgba(0,0,0,.45)]" fetchPriority="high" />
        <span className="absolute left-5 top-5 inline-flex items-center gap-2 rounded-full bg-black/45 px-3 py-1.5 text-[12px] font-medium text-white backdrop-blur-sm">
          <span className="rec h-2 w-2 rounded-full bg-[#ff3b30]" /> LIVE · 2:14:08
        </span>
        <figcaption className="absolute inset-x-0 bottom-9 px-6"><LiveCaption /></figcaption>
      </figure>
    </section>
  );
}

const STEPS = [
  ["Add a creator", "Paste a YouTube or Twitch channel. SpeedClipper notices the moment they go live."],
  ["It finds the moments", "It records the stream and reads chat. When chat suddenly explodes, that part becomes a clip."],
  ["Review and post", "Approve clips from your phone, or let them publish to Shorts and Reels on a schedule."],
];

function How() {
  return (
    <section id="how" className="scroll-mt-20 border-t border-black/[.07]">
      <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8 lg:py-32">
        <h2 className="reveal max-w-xl text-4xl font-semibold leading-[1.08] tracking-[-.03em] text-neutral-900 sm:text-5xl">
          Three steps. Then it <span className="serif font-normal">runs on its own.</span>
        </h2>
        <ol className="mt-16 grid gap-12 md:grid-cols-3 md:gap-10">
          {STEPS.map(([t, d], i) => (
            <li key={t} className="reveal" style={{ transitionDelay: `${i * 90}ms` }}>
              <span className="serif text-[40px] leading-none text-neutral-400">0{i + 1}</span>
              <h3 className="mt-5 text-[19px] font-semibold tracking-tight text-neutral-900">{t}</h3>
              <p className="mt-2.5 text-[15.5px] leading-relaxed text-neutral-600">{d}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Feature({ img, alt, flip, title, accent, text, points, id }) {
  return (
    <div id={id} className="mx-auto grid max-w-6xl scroll-mt-20 items-center gap-10 px-5 py-14 sm:px-8 md:grid-cols-2 md:gap-16 lg:py-20">
      <img src={img} alt={alt} loading="lazy" width="1200" height="800"
        className={`reveal aspect-[5/4] w-full rounded-[24px] object-cover ${flip ? "md:order-2" : ""}`} />
      <div className={`reveal ${flip ? "md:order-1" : ""}`} style={{ transitionDelay: "100ms" }}>
        <h2 className="text-[34px] font-semibold leading-[1.1] tracking-[-.03em] text-neutral-900 sm:text-[42px]">
          {title} <span className="serif font-normal">{accent}</span>
        </h2>
        <p className="mt-5 max-w-md text-[16.5px] leading-relaxed text-neutral-600">{text}</p>
        <ul className="mt-8 max-w-md divide-y divide-black/[.07] border-y border-black/[.07] text-[15px] text-neutral-800">
          {points.map((p) => <li key={p} className="py-3.5">{p}</li>)}
        </ul>
      </div>
    </div>
  );
}

const FAQS = [
  ["Is it free?", "Yes. Create an account, add the streamers you like and connect your channel. That's it."],
  ["Does it credit the creator?", "Always. Every clip description includes a credit line to the streamer, and it can't be removed."],
  ["Do I need to install anything?", "No. Recording, editing and uploading all happen on our servers, around the clock. You only use the website, from your laptop or your phone."],
  ["Can I check clips before they go up?", "Yes. Turn off auto-upload and approve each clip yourself, with a swipe, from your phone."],
];

function Faq() {
  return (
    <section id="faq" className="scroll-mt-20 border-t border-black/[.07]">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-24 sm:px-8 md:grid-cols-[.8fr_1.2fr] lg:py-32">
        <h2 className="reveal text-4xl font-semibold tracking-[-.03em] text-neutral-900 sm:text-5xl">Questions</h2>
        <div className="reveal divide-y divide-black/[.08] border-y border-black/[.08]">
          {FAQS.map(([q, a]) => (
            <details key={q} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-[17px] font-medium text-neutral-900 [&::-webkit-details-marker]:hidden">
                {q}<Plus size={18} className="shrink-0 text-neutral-500 transition-transform duration-300 group-open:rotate-45" />
              </summary>
              <p className="max-w-xl pb-6 pr-8 text-[15.5px] leading-relaxed text-neutral-600">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function Closing({ cta, ctaLabel }) {
  return (
    <section className="px-3 pb-3 sm:px-5 sm:pb-5">
      <div className="relative overflow-hidden rounded-[28px]">
        <img src="/landing/arena.webp" alt="A player at a gaming setup under arena lights" loading="lazy" width="1800" height="1200"
          className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/10" />
        <div className="reveal relative mx-auto flex min-h-[520px] max-w-6xl flex-col items-start justify-end px-6 py-14 sm:px-10 lg:min-h-[600px] lg:py-20">
          <h2 className="max-w-2xl text-[40px] font-semibold leading-[1.04] tracking-[-.035em] text-white sm:text-6xl">
            Set it up once. <span className="serif font-normal">Wake up to clips.</span>
          </h2>
          <Link to={cta} className="group mt-9 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3.5 text-[15px] font-medium text-neutral-900 transition hover:bg-[#ffd400]">
            {ctaLabel} <ArrowRight size={16} className="transition group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="mx-auto max-w-6xl px-5 pb-12 pt-16 sm:px-8">
      <div className="flex flex-col justify-between gap-8 border-b border-black/[.07] pb-10 sm:flex-row sm:items-center">
        <Wordmark />
        <div className="flex flex-wrap gap-x-7 gap-y-3 text-[14px] text-neutral-600">
          <a href="#how" className="hover:text-neutral-900">How it works</a>
          <a href="#faq" className="hover:text-neutral-900">FAQ</a>
          <Link to="/login" className="hover:text-neutral-900">Log in</Link>
          <Link to="/signup" className="hover:text-neutral-900">Sign up</Link>
        </div>
      </div>
      <div className="flex flex-col justify-between gap-3 pt-6 text-[12.5px] text-neutral-500 sm:flex-row">
        <span>© {new Date().getFullYear()} SpeedClipper. Clips always credit the original creator.</span>
        <span>
          Photos by Fausto Sandoval, ELLA DON, Josh Power and Florian Olivo on{" "}
          <a href="https://unsplash.com" target="_blank" rel="noreferrer" className="inline-flex items-center underline decoration-neutral-300 underline-offset-2 hover:text-neutral-800">Unsplash<ArrowUpRight size={11} /></a>
        </span>
      </div>
    </footer>
  );
}

export default function Landing({ signupOpen = true }) {
  const cta = signupOpen ? "/signup" : "/login";
  const ctaLabel = signupOpen ? "Get started free" : "Log in";
  useReveal();
  useEffect(() => { document.title = "SpeedClipper: live streams into Shorts, automatically"; }, []);
  return (
    <div className="lp min-h-screen">
      <Nav signupOpen={signupOpen} />
      <main>
        <Hero cta={cta} ctaLabel={ctaLabel} />
        <How />
        <section className="border-t border-black/[.07] py-10 lg:py-16">
          <Feature id="features" img="/landing/desk.webp" alt="A microphone next to a glowing gaming monitor"
            title="Knows when something" accent="just happened."
            text="When chat suddenly explodes, that's usually the moment. SpeedClipper measures it live and cuts the clip with a few seconds of build-up."
            points={["Knows real laughs from sub trains and spam", "Writes a title for every clip", "Skips clips that are mostly music"]} />
          <Feature flip img="/landing/phone.webp" alt="A hand holding a phone up to take a photo of a lake"
            title="Ready to post," accent="right from your phone."
            text="Every clip is made vertical for phones, with word-by-word captions, emoji and a credit to the streamer. Swipe right to post it, left to skip."
            points={["Captions and emoji added for you", "Publishes to YouTube Shorts and Instagram Reels", "Installs on your phone like an app"]} />
        </section>
        <Faq />
        <Closing cta={cta} ctaLabel={ctaLabel} />
      </main>
      <Footer />
    </div>
  );
}
