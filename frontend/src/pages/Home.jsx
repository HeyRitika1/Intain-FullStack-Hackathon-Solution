import { useEffect, useRef, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { useAuth, roleHomePath } from "../context/AuthContext.jsx";

/* ──────────────────────────────────────────────────
   DATA
   ────────────────────────────────────────────────── */
const STATS = [
  { value: "15+", label: "Validation Rules" },
  { value: "SHA-256", label: "Audit Chain" },
  { value: "3", label: "Role Portals" },
  { value: "100%", label: "AI Fallback Coverage" },
];

const PROBLEMS = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-7 w-7 text-teal-600">
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 3.75c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
      </svg>
    ),
    title: "Siloed data",
    desc: "Every stakeholder runs its own system, reconciled by hand with sampling and exception handling. Errors and delays compound across the chain.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-7 w-7 text-teal-600">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
      </svg>
    ),
    title: "Weak provenance",
    desc: "Phantom collateral, double-pledging and asset-quality drift stay hidden until it is too late to act. No cryptographic proof of data integrity.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-7 w-7 text-teal-600">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
      </svg>
    ),
    title: "High, layered cost",
    desc: "Costs accumulate at every step, multiplied by compliance burdens from disconnected data systems. Manual exception review is the biggest bottleneck.",
  },
];

const FEATURES = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-6 w-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
      </svg>
    ),
    title: "AI Review Copilot",
    desc: "Provider-agnostic LLM integration with visible reasoning chains, per-field controls, confidence scoring, and a deterministic fallback for offline resilience.",
    color: "text-amber-500",
    bg: "bg-amber-50",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-6 w-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
      </svg>
    ),
    title: "Hash-Chain Audit Trail",
    desc: "Every state change is a SHA-256 hash-linked event. Tamper-evidence is built into every decision, with live chain verification.",
    color: "text-teal-600",
    bg: "bg-teal-50",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-6 w-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
      </svg>
    ),
    title: "Trust Score Engine",
    desc: "Multi-factor trust scores per loan (Completeness + Consistency + Freshness + Review Coverage) and a portfolio aggregate dashboard.",
    color: "text-emerald-600",
    bg: "bg-emerald-50",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-6 w-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
      </svg>
    ),
    title: "Side-by-Side Reconciliation",
    desc: "Visual diff between the loan tape and the servicer update, with one-click field-level resolution for rapid review.",
    color: "text-blue-600",
    bg: "bg-blue-50",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-6 w-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
      </svg>
    ),
    title: "Config-Driven Validation",
    desc: "15 rules loaded from JSON at runtime, with a small expression grammar — isEmpty, equals, crossFieldCompare, conflictsWithOtherSource.",
    color: "text-violet-600",
    bg: "bg-violet-50",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-6 w-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
      </svg>
    ),
    title: "Converse-with-Data",
    desc: "Natural-language queries translated to sanitized Mongo filters, restricted to verified loans only. Ask questions in plain English.",
    color: "text-rose-500",
    bg: "bg-rose-50",
  },
];

const STEPS = [
  { num: "01", title: "Upload", desc: "Drag & drop CSV loan tapes with client-side SHA-256 hashing" },
  { num: "02", title: "Validate", desc: "15 rules run automatically, exceptions flagged by severity" },
  { num: "03", title: "AI Review", desc: "Copilot explains issues with reasoning chain & confidence scores" },
  { num: "04", title: "Verify", desc: "Approved loans become hash-sealed, trust-scored verified records" },
];

const PORTALS = [
  {
    title: "Data Operator",
    desc: "Upload loan tapes, servicer updates, and document manifests. Monitor import health and data freshness in real time.",
    path: "/operator",
    accent: "border-blue-500",
    iconBg: "bg-blue-100 text-blue-700",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-6 w-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
      </svg>
    ),
  },
  {
    title: "Reviewer",
    desc: "Work the exception queue with keyboard navigation, AI-assisted review, and side-by-side reconciliation.",
    path: "/reviewer",
    accent: "border-amber-500",
    iconBg: "bg-amber-100 text-amber-700",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-6 w-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
      </svg>
    ),
  },
  {
    title: "Data Consumer",
    desc: "Browse verified records, inspect cryptographic audit trails, run natural-language queries, and export sealed data bundles.",
    path: "/consumer",
    accent: "border-emerald-500",
    iconBg: "bg-emerald-100 text-emerald-700",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-6 w-6">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
      </svg>
    ),
  },
];

const DEMO_CREDS = [
  { role: "Operator", email: "operator@intain.test", password: "Operator@123" },
  { role: "Reviewer", email: "reviewer@intain.test", password: "Reviewer@123" },
  { role: "Consumer", email: "consumer@intain.test", password: "Consumer@123" },
  { role: "Admin",    email: "admin@intain.test",    password: "Admin@1234" },
];

const CAPABILITIES = [
  { label: "Multi-CSV Ingest", sub: "SHA-256 · client-side hashing" },
  { label: "Config-Driven Rules", sub: "15 rules · expression grammar" },
  { label: "AI Review Assistant", sub: "Reasoning chain · confidence" },
  { label: "Hash-Chain Audit", sub: "Tamper-evident · verifiable" },
];

/* ──────────────────────────────────────────────────
   HOOKS
   ────────────────────────────────────────────────── */

function useScrollReveal() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("visible");
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -40px 0px" }
    );
    const children = el.querySelectorAll(".fade-in-up");
    children.forEach((c) => obs.observe(c));
    return () => obs.disconnect();
  }, []);
  return ref;
}

function useCountUp(target, duration = 1500) {
  const [value, setValue] = useState(0);
  const [started, setStarted] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setStarted(true); },
      { threshold: 0.5 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!started) return;
    const num = parseInt(target, 10);
    if (isNaN(num)) { setValue(target); return; }
    let start = 0;
    const step = Math.ceil(num / (duration / 16));
    const id = setInterval(() => {
      start += step;
      if (start >= num) { setValue(num); clearInterval(id); }
      else setValue(start);
    }, 16);
    return () => clearInterval(id);
  }, [started, target, duration]);

  return { ref, value: typeof value === "number" ? value : target, started };
}

/* ──────────────────────────────────────────────────
   MAIN COMPONENT
   ────────────────────────────────────────────────── */

export default function Home() {
  const { user } = useAuth();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="min-h-screen bg-white">
      {/* ─── NAVBAR ─── */}
      <nav
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled
            ? "bg-white/90 shadow-sm backdrop-blur-md border-b border-slate-100"
            : "bg-transparent"
        }`}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-600 text-white font-bold text-sm">
              IV
            </div>
            <span className="text-lg font-bold text-slate-900">
              intain<span className="font-light text-slate-500"> verify</span>
            </span>
          </div>

          <div className="hidden items-center gap-8 text-sm font-medium text-slate-600 md:flex">
            <a href="#features" className="transition hover:text-teal-600">Features</a>
            <a href="#how-it-works" className="transition hover:text-teal-600">How It Works</a>
            <a href="#portals" className="transition hover:text-teal-600">Portals</a>
          </div>

          <div className="flex items-center gap-3">
            {user ? (
              <Link
                to={roleHomePath(user.role)}
                className="rounded-lg bg-teal-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-teal-700"
              >
                Go to Dashboard
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  className="text-sm font-medium text-slate-600 transition hover:text-teal-600"
                >
                  Sign in
                </Link>
                <Link
                  to="/login"
                  className="rounded-lg bg-teal-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-teal-700 pulse-glow"
                >
                  Request a Demo
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* ─── HERO ─── */}
      <section className="relative overflow-hidden pt-28 pb-20 grid-bg">
        {/* decorative bg circles */}
        <div className="pointer-events-none absolute -top-40 -right-40 h-[600px] w-[600px] rounded-full bg-teal-100/40 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-20 h-[400px] w-[400px] rounded-full bg-amber-100/30 blur-3xl" />

        <div className="relative mx-auto grid max-w-7xl gap-12 px-6 lg:grid-cols-2 lg:items-center">
          {/* left */}
          <div>
            <p className="hero-animate text-xs font-semibold uppercase tracking-widest text-teal-600">
              ASSET BACKED FINANCE : AUTOMATED AND INTEGRATED
            </p>
            <h1 className="hero-animate hero-animate-delay-1 mt-6 text-4xl font-extrabold leading-tight text-slate-900 sm:text-5xl lg:text-[3.5rem]">
              From "trust-me" to{" "}
              <span className="gradient-text">Traceable Truth.</span>
            </h1>
            <p className="hero-animate hero-animate-delay-2 mt-6 max-w-lg text-lg text-slate-600 leading-relaxed">
              Intain Verify combines purpose-built AI with a hash-chained audit trail —
              automating every verification process and giving every stakeholder one
              verifiable view of every loan. Less risk, lower cost, real transparency.
            </p>
            <div className="hero-animate hero-animate-delay-3 mt-8 flex flex-wrap gap-4">
              <Link
                to="/login"
                className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-teal-600/20 transition hover:bg-teal-700 hover:shadow-teal-600/30 pulse-glow"
              >
                Request a Demo
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path fillRule="evenodd" d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z" clipRule="evenodd" />
                </svg>
              </Link>
              <a
                href="#features"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
              >
                See the platform
              </a>
            </div>
          </div>

          {/* right — capability cards */}
          <div className="hero-animate hero-animate-delay-4 hidden lg:block">
            <div className="space-y-3">
              {CAPABILITIES.map((cap, i) => (
                <div
                  key={cap.label}
                  className={`slide-in-right slide-in-delay-${i + 1} flex items-center justify-between rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm transition hover:shadow-md hover:border-teal-200`}
                >
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-50 text-teal-600">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </div>
                    <div>
                      <div className="font-semibold text-slate-900">{cap.label}</div>
                      <div className="text-sm text-slate-500">{cap.sub}</div>
                    </div>
                  </div>
                  <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5 text-teal-500">
                    <path fillRule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clipRule="evenodd" />
                  </svg>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─── STATS BAR ─── */}
      <section className="border-y border-slate-100 bg-slate-50 py-12">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-10 px-6 text-center">
          {STATS.map((s) => (
            <StatItem key={s.label} stat={s} />
          ))}
        </div>
      </section>

      {/* ─── PROBLEM SECTION ─── */}
      <ProblemSection />

      {/* ─── FEATURES ─── */}
      <FeaturesSection />

      {/* ─── HOW IT WORKS ─── */}
      <HowItWorksSection />

      {/* ─── PORTALS ─── */}
      <PortalsSection user={user} />

      {/* ─── DEMO CTA ─── */}
      <DemoCTASection user={user} />

      {/* ─── FOOTER ─── */}
      <footer className="border-t border-slate-100 bg-white py-8">
        <div className="mx-auto max-w-7xl px-6 text-center">
          <div className="flex items-center justify-center gap-2 text-sm text-slate-500">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-teal-600 text-[10px] font-bold text-white">IV</div>
            <span>Intain Verify — Loan Data Verification Copilot</span>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Built for the Intain Full-Stack Hackathon. Powered by React, Node.js, MongoDB, and AI.
          </p>
        </div>
      </footer>
    </div>
  );
}

/* ──────────────────────────────────────────────────
   SUB-COMPONENTS
   ────────────────────────────────────────────────── */

function StatItem({ stat }) {
  const isNum = /^\d+/.test(stat.value);
  const numPart = isNum ? parseInt(stat.value, 10) : null;
  const suffix = isNum ? stat.value.replace(/^\d+/, "") : "";
  const { ref, value, started } = useCountUp(numPart ?? stat.value);

  return (
    <div ref={ref} className="min-w-[120px]">
      <div className={`text-3xl font-extrabold text-slate-900 ${started ? "count-pop" : "opacity-0"}`}>
        {isNum ? `${value}${suffix}` : stat.value}
      </div>
      <div className="mt-1 text-sm text-slate-500">{stat.label}</div>
    </div>
  );
}

function ProblemSection() {
  const sectionRef = useScrollReveal();
  return (
    <section ref={sectionRef} className="py-20 bg-white">
      <div className="mx-auto max-w-6xl px-6">
        <p className="fade-in-up text-xs font-semibold uppercase tracking-widest text-teal-600">THE PROBLEM</p>
        <h2 className="fade-in-up stagger-1 mt-4 text-3xl font-bold text-slate-900 sm:text-4xl max-w-2xl">
          "Trust-me" data is failing — and no asset class is untouched.
        </h2>
        <p className="fade-in-up stagger-2 mt-4 max-w-3xl text-slate-600 leading-relaxed">
          The plumbing under a $13T asset class, with $3T in annual issuances, has barely
          changed since the financial crisis. Manual reconciliation, siloed systems, and
          absent provenance create compounding risk.
        </p>
        <div className="mt-12 grid gap-6 sm:grid-cols-3">
          {PROBLEMS.map((p, i) => (
            <div
              key={p.title}
              className={`fade-in-up stagger-${i + 3} rounded-xl border border-slate-200 bg-white p-6 transition hover:shadow-lg hover:border-teal-200`}
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-teal-50">
                {p.icon}
              </div>
              <h3 className="mt-4 text-lg font-semibold text-slate-900">{p.title}</h3>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">{p.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeaturesSection() {
  const sectionRef = useScrollReveal();
  return (
    <section ref={sectionRef} id="features" className="py-20 bg-slate-50 grid-bg">
      <div className="mx-auto max-w-6xl px-6">
        <div className="text-center">
          <p className="fade-in-up text-xs font-semibold uppercase tracking-widest text-teal-600">CAPABILITIES</p>
          <h2 className="fade-in-up stagger-1 mt-4 text-3xl font-bold text-slate-900 sm:text-4xl">
            Everything you need for verifiable loan data
          </h2>
          <p className="fade-in-up stagger-2 mt-4 mx-auto max-w-2xl text-slate-600">
            From AI-powered exception review to cryptographic audit trails, Intain Verify
            covers the entire loan verification lifecycle.
          </p>
        </div>
        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <div
              key={f.title}
              className={`fade-in-up stagger-${(i % 6) + 1} group rounded-xl border border-slate-200 bg-white p-6 transition hover:shadow-lg hover:border-teal-200 hover:-translate-y-1`}
            >
              <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${f.bg} ${f.color} transition group-hover:scale-110`}>
                {f.icon}
              </div>
              <h3 className="mt-4 text-lg font-semibold text-slate-900">{f.title}</h3>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorksSection() {
  const sectionRef = useScrollReveal();
  return (
    <section ref={sectionRef} id="how-it-works" className="py-20 bg-white">
      <div className="mx-auto max-w-4xl px-6">
        <div className="text-center">
          <p className="fade-in-up text-xs font-semibold uppercase tracking-widest text-teal-600">HOW IT WORKS</p>
          <h2 className="fade-in-up stagger-1 mt-4 text-3xl font-bold text-slate-900 sm:text-4xl">
            Four steps to traceable truth
          </h2>
        </div>
        <div className="mt-14 relative">
          {/* connector line */}
          <div className="absolute left-8 top-0 bottom-0 w-px bg-gradient-to-b from-teal-200 via-teal-400 to-teal-200 hidden sm:block" />

          <div className="space-y-10">
            {STEPS.map((step, i) => (
              <div key={step.num} className={`fade-in-up stagger-${i + 1} flex gap-6 items-start`}>
                <div className="relative z-10 flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-teal-600 text-white font-bold text-lg shadow-lg shadow-teal-600/20">
                  {step.num}
                </div>
                <div className="pt-2">
                  <h3 className="text-xl font-semibold text-slate-900">{step.title}</h3>
                  <p className="mt-1 text-slate-600">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function PortalsSection({ user }) {
  const sectionRef = useScrollReveal();
  return (
    <section ref={sectionRef} id="portals" className="py-20 bg-slate-50">
      <div className="mx-auto max-w-6xl px-6">
        <div className="text-center">
          <p className="fade-in-up text-xs font-semibold uppercase tracking-widest text-teal-600">ROLE-BASED PORTALS</p>
          <h2 className="fade-in-up stagger-1 mt-4 text-3xl font-bold text-slate-900 sm:text-4xl">
            Three stakeholders, one source of truth
          </h2>
        </div>
        <div className="mt-14 grid gap-6 sm:grid-cols-3">
          {PORTALS.map((p, i) => (
            <div
              key={p.title}
              className={`fade-in-up stagger-${i + 2} group rounded-xl border-l-4 ${p.accent} border border-slate-200 bg-white p-6 transition hover:shadow-lg`}
            >
              <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${p.iconBg}`}>
                {p.icon}
              </div>
              <h3 className="mt-4 text-xl font-semibold text-slate-900">{p.title}</h3>
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">{p.desc}</p>
              {user ? (
                <Link
                  to={p.path}
                  className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-teal-600 transition hover:text-teal-700"
                >
                  Enter portal →
                </Link>
              ) : (
                <Link
                  to="/login"
                  className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-teal-600 transition hover:text-teal-700"
                >
                  Sign in to access →
                </Link>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function DemoCTASection({ user }) {
  const sectionRef = useScrollReveal();
  return (
    <section ref={sectionRef} className="py-20 bg-slate-900 text-white">
      <div className="mx-auto max-w-4xl px-6 text-center">
        <h2 className="fade-in-up text-3xl font-bold sm:text-4xl">
          Ready to see it in action?
        </h2>
        <p className="fade-in-up stagger-1 mt-4 text-lg text-slate-300">
          Jump straight into the live demo with pre-seeded test accounts.
        </p>

        <div className="fade-in-up stagger-2 mt-8">
          {user ? (
            <Link
              to={roleHomePath(user.role)}
              className="inline-flex items-center gap-2 rounded-lg bg-teal-500 px-8 py-3 text-base font-semibold text-white shadow-lg shadow-teal-500/30 transition hover:bg-teal-400"
            >
              Go to Dashboard
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path fillRule="evenodd" d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z" clipRule="evenodd" />
              </svg>
            </Link>
          ) : (
            <Link
              to="/login"
              className="inline-flex items-center gap-2 rounded-lg bg-teal-500 px-8 py-3 text-base font-semibold text-white shadow-lg shadow-teal-500/30 transition hover:bg-teal-400 pulse-glow"
            >
              Launch Demo
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path fillRule="evenodd" d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z" clipRule="evenodd" />
              </svg>
            </Link>
          )}
        </div>

        {!user && (
          <div className="fade-in-up stagger-3 mt-10 mx-auto max-w-xl">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-4">
              Pre-seeded demo credentials
            </p>
            <div className="grid grid-cols-2 gap-3">
              {DEMO_CREDS.map((c) => (
                <Link
                  key={c.email}
                  to={`/login?email=${encodeURIComponent(c.email)}&password=${encodeURIComponent(c.password)}`}
                  className="rounded-lg border border-slate-700 bg-slate-800/60 px-4 py-3 text-left transition hover:border-teal-500 hover:bg-slate-800"
                >
                  <div className="text-sm font-semibold text-teal-400">{c.role}</div>
                  <div className="mt-1 text-xs text-slate-400 font-mono">{c.email}</div>
                  <div className="text-xs text-slate-500 font-mono">{c.password}</div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}