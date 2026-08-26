import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Menu, X, SquareCode, BookOpen, Hammer, ClipboardCheck,
  Flame, Check, Award, TrendingUp, BadgeCheck, Wrench, Github, Twitter,
  Youtube, AppWindow, Monitor, Package, Terminal,
} from 'lucide-react';

/* ── Design tokens (Landing.md §2.1) ─────────────────── */
const NAVY = '#001449';
const NAVY2 = '#011E63';
const NAVY3 = '#0A2A78';
const BLUE = '#005BC5';
const SKY = '#00B4FC';
const CYAN = '#17F9FF';
const GOLD = '#F59E0B';
const INK = '#F2F7FF';
const INK2 = '#A8C3E8';
const INK3 = '#6B87B5';
const WHITE = '#FFFFFF';

const FONT_DISPLAY = "'Space Grotesk', 'Plus Jakarta Sans', sans-serif";
const FONT_BODY = "'Plus Jakarta Sans', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono', 'Fira Code', monospace";

const BORDER = '1px solid rgba(255,255,255,0.08)';
const BORDER_HOVER = '1px solid rgba(23,249,255,0.35)';
const SHADOW_CARD = '0 24px 60px rgba(0,8,40,0.6)';

/* ── Landing-only keyframes / shared styles ──────────── */
const landingStyles = `
@keyframes de-fadeUp { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: none; } }
@keyframes de-draw { from { width: 0; } to { width: 100%; } }
.de-card { transition: transform .2s cubic-bezier(.22,1,.36,1), border-color .2s, box-shadow .2s; }
.de-card:hover { transform: translateY(-4px); border-color: rgba(23,249,255,0.35); box-shadow: 0 24px 60px rgba(0,8,40,0.6); }
.de-arrow { transition: transform .2s ease; }
.de-cta:hover .de-arrow { transform: translateX(4px); }
.de-focus:focus-visible { outline: 2px solid #17F9FF; outline-offset: 2px; }
.de-anim { animation-duration: 1s; animation-fill-mode: both; }
.de-node .de-tip { opacity: 0; transform: translateY(-50%) translateX(-4px); transition: opacity .2s, transform .2s; pointer-events: none; }
.de-node:hover .de-tip, .de-node:focus-within .de-tip { opacity: 1; transform: translateY(-50%) translateX(0); }
.de-more { opacity: 0; transform: translateX(-6px); transition: opacity .2s, transform .2s; }
.de-card:hover .de-more { opacity: 1; transform: none; }
.de-connector { display: none; }
@media (min-width: 1024px) { .de-connector { display: block; } }
.de-cert { transform: rotateY(8deg); transition: transform .8s cubic-bezier(.22,1,.36,1); }
.de-cert.de-cert-in { transform: rotateY(0deg); }
@media (prefers-reduced-motion: reduce) {
  .de-anim { animation: none !important; }
  .de-card, .de-arrow { transition: none !important; }
  * { scroll-behavior: auto !important; }
}
`;

/* ── Hooks ───────────────────────────────────────────── */
function useReveal<T extends HTMLElement = HTMLDivElement>(threshold = 0.18) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);

  return { ref, inView };
}

function Reveal({
  children,
  delay = 0,
  y = 24,
  style,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  y?: number;
  style?: React.CSSProperties;
  className?: string;
}) {
  const { ref, inView } = useReveal<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: inView ? 1 : 0,
        transform: inView ? 'none' : `translateY(${y}px)`,
        transition: `opacity .5s cubic-bezier(.22,1,.36,1) ${delay}ms, transform .5s cubic-bezier(.22,1,.36,1) ${delay}ms`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function useCountUp(target: number, start: boolean, duration = 900) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!start) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      setVal(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [start, target, duration]);
  return val;
}

/* ── Primitives ──────────────────────────────────────── */
function Eyebrow({ children, tone = CYAN }: { children: React.ReactNode; tone?: string }) {
  return (
    <div
      style={{
        fontFamily: FONT_MONO,
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: tone,
        marginBottom: 14,
      }}
    >
      {children}
    </div>
  );
}

function SectionHead({ eyebrow, title, lede }: { eyebrow: string; title: React.ReactNode; lede?: string }) {
  return (
    <div style={{ maxWidth: 640, marginBottom: 48 }}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 40,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          lineHeight: 1.1,
          color: INK,
          margin: 0,
        }}
      >
        {title}
      </h2>
      {lede && (
        <p style={{ marginTop: 16, fontSize: 17, lineHeight: 1.7, color: INK2, marginBottom: 0 }}>
          {lede}
        </p>
      )}
    </div>
  );
}

function Wordmark() {
  return (
    <Link
      to="/"
      className="de-focus"
      style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}
    >
      <span
        style={{
          width: 34,
          height: 34,
          borderRadius: 8,
          background: 'linear-gradient(135deg, #001449, #005BC5)',
          border: '1px solid rgba(23,249,255,0.35)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ fontFamily: FONT_MONO, color: WHITE, fontSize: 15, fontWeight: 600 }}>{'</>'}</span>
      </span>
      <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 20, color: WHITE, letterSpacing: '-0.01em' }}>
        Digital-Edu
      </span>
    </Link>
  );
}

/* ── Nav (§4.1) ──────────────────────────────────────── */
function LandingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const links = [
    { label: 'Courses', href: '#course' },
    { label: 'Method', href: '#method' },
    { label: 'Certificates', href: '#certificates' },
    { label: 'FAQ', href: '#faq' },
  ];

  return (
    <header
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        background: scrolled ? 'rgba(0,12,48,0.8)' : 'transparent',
        backdropFilter: scrolled ? 'blur(12px)' : 'none',
        WebkitBackdropFilter: scrolled ? 'blur(12px)' : 'none',
        borderBottom: scrolled ? '1px solid rgba(255,255,255,0.08)' : '1px solid transparent',
        transition: 'background .3s, border-color .3s',
      }}
    >
      <div
        style={{
          maxWidth: 1120,
          margin: '0 auto',
          padding: '0 24px',
          height: 72,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Wordmark />

        <nav style={{ display: 'flex', gap: 28, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 28 }}>
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="de-focus"
                style={{ color: 'rgba(255,255,255,0.85)', fontSize: 15, fontWeight: 500, textDecoration: 'none', transition: 'color .15s' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = CYAN)}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.85)')}
              >
                {l.label}
              </a>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Link
              to="/login"
              className="de-focus"
              style={{
                height: 44,
                padding: '0 20px',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 12,
                fontSize: 14,
                fontWeight: 600,
                color: WHITE,
                textDecoration: 'none',
                border: '1px solid rgba(255,255,255,0.2)',
                background: 'transparent',
                transition: 'border-color .15s, color .15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = CYAN)}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)')}
            >
              Sign in
            </Link>
            <Link
              to="/register"
              className="de-focus de-cta"
              style={{
                height: 44,
                padding: '0 20px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                borderRadius: 12,
                fontSize: 14,
                fontWeight: 600,
                color: WHITE,
                textDecoration: 'none',
                background: BLUE,
                transition: 'background .15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = SKY)}
              onMouseLeave={(e) => (e.currentTarget.style.background = BLUE)}
            >
              Get Started
              <ArrowRight size={15} className="de-arrow" />
            </Link>
          </div>

          <button
            aria-label="Toggle menu"
            className="de-focus"
            onClick={() => setOpen(!open)}
            style={{ display: 'none', background: 'transparent', border: 'none', color: WHITE, cursor: 'pointer', padding: 8 }}
          >
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </nav>
      </div>

      {/* Mobile sheet */}
      <div
        style={{
          display: open ? 'flex' : 'none',
          flexDirection: 'column',
          gap: 4,
          background: NAVY,
          borderTop: '1px solid rgba(255,255,255,0.08)',
          padding: '12px 24px 20px',
        }}
      >
        {links.map((l) => (
          <a
            key={l.href}
            href={l.href}
            onClick={() => setOpen(false)}
            style={{ color: INK, fontSize: 16, fontWeight: 500, textDecoration: 'none', padding: '12px 4px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
          >
            {l.label}
          </a>
        ))}
        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <Link to="/login" onClick={() => setOpen(false)} style={{ flex: 1, textAlign: 'center', padding: '12px 0', borderRadius: 12, fontSize: 14, fontWeight: 600, color: WHITE, textDecoration: 'none', border: '1px solid rgba(255,255,255,0.2)' }}>
            Sign in
          </Link>
          <Link to="/register" onClick={() => setOpen(false)} style={{ flex: 1, textAlign: 'center', padding: '12px 0', borderRadius: 12, fontSize: 14, fontWeight: 600, color: WHITE, textDecoration: 'none', background: BLUE }}>
            Get Started
          </Link>
        </div>
      </div>
    </header>
  );
}

/* ── Hero (§4.2 + §5.1) ──────────────────────────────── */
function CodeEditor() {
  const lines: React.ReactNode[] = [
    <span key="c" style={{ color: INK3 }}>{'<!-- index.html -->'}</span>,
    <span key="t1" style={{ color: CYAN }}>{'<h1 '}</span>,
    <span key="t2" style={{ color: SKY }}>class</span>,
    <span key="t3" style={{ color: INK3 }}>=</span>,
    <span key="t4" style={{ color: GOLD }}>"title"</span>,
    <span key="t5" style={{ color: CYAN }}>{'>'}</span>,
    <span key="t6" style={{ color: INK }}>Hello, Digital-Edu</span>,
    <span key="t7" style={{ color: CYAN }}>{'</h1>'}</span>,
    <span key="g" style={{ color: INK2 }}>{' '}</span>,
  ];
  return (
    <div style={{ fontFamily: FONT_MONO, fontSize: 13, lineHeight: 1.7, color: INK2, overflow: 'hidden' }}>
      {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
        <div
          key={n}
          style={{
            display: 'flex',
            padding: '0 16px',
            background: n === 5 ? 'rgba(22,163,74,0.14)' : 'transparent',
            borderLeft: n === 5 ? '2px solid #16a34a' : '2px solid transparent',
          }}
        >
          <span style={{ width: 28, flexShrink: 0, color: INK3, userSelect: 'none' }}>{n + 1}</span>
          <span style={{ whiteSpace: 'pre' }}>
            {n === 0 && lines[0]}
            {n === 1 && lines.slice(1, 8)}
            {n === 5 && (
              <>
                {lines.slice(1, 7)}
                <span style={{ display: 'inline-block', width: 7, height: 15, background: CYAN, verticalAlign: 'text-bottom' }} />
              </>
            )}
            {n === 7 && <span style={{ color: CYAN }}>{'</h1>'}</span>}
            {n === 8 && <span style={{ color: INK3 }}>{'<p>I build this page myself.</p>'}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

function ProgressPath() {
  const milestones = [
    { label: 'HTML', state: 'done' },
    { label: 'CSS', state: 'done' },
    { label: 'Advanced CSS', state: 'current' },
    { label: 'Certification Exam', state: 'todo' },
  ];
  return (
    <div style={{ padding: '22px 20px', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2 }}>
      <div style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: INK3, marginBottom: 14 }}>
        &gt; course-track / progress
      </div>
      {milestones.map((m, i) => {
        const isDone = m.state === 'done';
        const isCurrent = m.state === 'current';
        return (
          <div key={m.label} style={{ display: 'flex', alignItems: 'flex-start', gap: 14, position: 'relative', paddingBottom: 18 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 999,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: isDone ? CYAN : isCurrent ? NAVY3 : 'transparent',
                  border: isDone ? '1px solid #17F9FF' : isCurrent ? '2px solid #17F9FF' : '1px solid rgba(255,255,255,0.2)',
                }}
              >
                {isDone && <Check size={11} color={NAVY} strokeWidth={4} />}
              </div>
              {i < milestones.length - 1 && (
                <div style={{ width: 2, flex: 1, minHeight: 18, background: isDone ? 'rgba(23,249,255,0.5)' : 'rgba(255,255,255,0.1)' }} />
              )}
            </div>
            <div style={{ paddingTop: 1 }}>
              <div style={{ fontFamily: FONT_MONO, fontSize: 12, fontWeight: 600, color: isDone ? INK2 : isCurrent ? WHITE : INK3, letterSpacing: '0.02em' }}>
                {m.label}
                {isDone && <span style={{ color: CYAN, marginLeft: 6 }}>✓</span>}
              </div>
              <div style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: INK3, marginTop: 3 }}>
                {isDone ? 'completed' : isCurrent ? 'in progress' : 'locked'}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CurriculumConsole() {
  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: 900, margin: '0 auto', perspective: 1200 }}>
      <div
        className="de-anim"
        style={{ animationName: 'de-fadeUp', animationDelay: '500ms' }}
      >
        <div
          style={{
            background: 'rgba(10,42,120,0.6)',
            borderRadius: 14,
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 30px 80px rgba(0,0,0,0.5)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            transform: 'rotateX(2deg)',
            overflow: 'hidden',
          }}
        >
          {/* top bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ display: 'flex', gap: 7 }}>
              <span style={{ width: 11, height: 11, borderRadius: 999, background: '#FF5F57' }} />
              <span style={{ width: 11, height: 11, borderRadius: 999, background: '#FEBC2E' }} />
              <span style={{ width: 11, height: 11, borderRadius: 999, background: '#28C840' }} />
            </div>
            <div
              style={{
                flex: 1,
                textAlign: 'center',
                fontFamily: FONT_MONO,
                fontSize: 12,
                color: INK3,
                background: 'rgba(255,255,255,0.04)',
                borderRadius: 8,
                padding: '5px 12px',
              }}
            >
              digital-edu.app/courses/responsive-web-design
            </div>
            <div style={{ width: 11 }} />
          </div>

          {/* body */}
          <div style={{ display: 'grid', gridTemplateColumns: '55% 45%', minHeight: 260 }}>
            <div style={{ borderRight: '1px solid rgba(255,255,255,0.08)' }}>
              <CodeEditor />
            </div>
            <ProgressPath />
          </div>
        </div>

        {/* underglow line */}
        <div style={{ height: 1, marginTop: 10, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.5), #17F9FF, transparent)', opacity: 0.7 }} />
      </div>

      {/* floating chips */}
      <div
        style={{
          position: 'absolute',
          top: -18,
          right: -8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: NAVY3, border: '1px solid rgba(255,255,255,0.14)', borderRadius: 999, padding: '8px 14px', boxShadow: SHADOW_CARD }}>
          <BadgeCheck size={14} color={CYAN} />
          <span style={{ fontFamily: FONT_MONO, fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: INK }}>
            BADGE UNLOCKED — HTML
          </span>
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: -16,
          left: -8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: NAVY3, border: '1px solid rgba(255,255,255,0.14)', borderRadius: 999, padding: '8px 14px', boxShadow: SHADOW_CARD }}>
          <Flame size={14} color={GOLD} />
          <span style={{ fontFamily: FONT_MONO, fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: INK }}>
            STREAK 14 DAYS
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── Hero backdrop: faceted mosaic + diagonal light on cursor parallax ── */
function HeroBackdrop() {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const parallaxRefs = useRef<(HTMLDivElement | null)[]>([]);
  const target = useRef({ x: 0, y: 0 });
  const current = useRef({ x: 0, y: 0 });
  const raf = useRef(0);
  const [interactive, setInteractive] = useState(false);

  useEffect(() => {
    const fine = window.matchMedia('(pointer: fine)').matches;
    const motion = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setInteractive(fine && motion);
  }, []);

  useEffect(() => {
    if (!interactive) return;
    const el = rootRef.current;
    if (!el) return;
    let running = false;

    const onMove = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      target.current.x = ((e.clientX - r.left) / r.width - 0.5) * 2;
      target.current.y = ((e.clientY - r.top) / r.height - 0.5) * 2;
      if (!running) {
        running = true;
        raf.current = requestAnimationFrame(step);
      }
    };
    const onLeave = () => {
      target.current.x = 0;
      target.current.y = 0;
    };
    const step = () => {
      const c = current.current;
      const t = target.current;
      c.x += (t.x - c.x) * 0.07;
      c.y += (t.y - c.y) * 0.07;
      parallaxRefs.current.forEach((l) => {
        if (!l) return;
        const f = Number(l.dataset.factor || 0);
        l.style.transform = `translate3d(${(c.x * f).toFixed(2)}px, ${(c.y * f).toFixed(2)}px, 0)`;
      });
      if (Math.abs(t.x - c.x) > 0.002 || Math.abs(t.y - c.y) > 0.002) {
        raf.current = requestAnimationFrame(step);
      } else {
        running = false;
      }
    };

    el.addEventListener('mousemove', onMove, { passive: true });
    el.addEventListener('mouseleave', onLeave);
    return () => {
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('mouseleave', onLeave);
      cancelAnimationFrame(raf.current);
    };
  }, [interactive]);

  const layer = (index: number, factor: number, children: React.ReactNode, style: React.CSSProperties = {}) => (
    <div
      ref={(el) => {
        parallaxRefs.current[index] = el;
      }}
      data-factor={factor}
      style={{ position: 'absolute', inset: 0, willChange: 'transform', ...style }}
    >
      {children}
    </div>
  );

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}
    >
      {/* 1 — depth field */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(120% 90% at 50% -10%, #021B5E 0%, #001449 46%, #000A2E 100%)',
        }}
      />
      {/* vignette — the "stage" */}
      {layer(0, -6, null, {
        background: 'radial-gradient(ellipse 95% 80% at 50% 44%, transparent 52%, rgba(0,4,22,0.55) 100%)',
      })}

      {/* 2 — mosaic: seamless diamond lattice, hairline */}
      {layer(1, 10, (
        <div style={{ position: 'absolute', inset: '-72px' }}>
          <svg width="100%" height="100%" style={{ display: 'block' }}>
            <defs>
              <pattern id="de-mosaic" width="56" height="56" patternUnits="userSpaceOnUse">
                <g fill="none" stroke="rgba(242,247,255,0.05)" strokeWidth="1">
                  <path d="M28 0 L56 28 L28 56 L0 28 Z" />
                  <path d="M0 0 L28 28 L0 56 Z" />
                  <path d="M56 0 L28 28 L56 56 Z" />
                </g>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#de-mosaic)" />
          </svg>
        </div>
      ))}

      {/* 3 — faceted accents: a few large diamonds catching light */}
      {layer(2, 16, (
        <svg width="100%" height="100%" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" style={{ display: 'block' }}>
          <g fill="none" strokeWidth="1">
            <path d="M1020 120 L1260 360 L1020 600 L780 360 Z" stroke="rgba(245,158,11,0.10)" fill="rgba(245,158,11,0.03)" />
            <path d="M330 60 L470 200 L330 340 L190 200 Z" stroke="rgba(242,247,255,0.06)" fill="rgba(242,247,255,0.02)" />
            <path d="M480 640 L620 780 L480 920 L340 780 Z" stroke="rgba(23,249,255,0.07)" fill="rgba(23,249,255,0.025)" />
            <path d="M1180 700 L1290 810 L1180 920 L1070 810 Z" stroke="rgba(242,247,255,0.05)" />
          </g>
        </svg>
      ))}

      {/* 4 — diagonal hairline rake */}
      {layer(3, 18, (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'repeating-linear-gradient(115deg, transparent 0 96px, rgba(242,247,255,0.03) 96px 97px)',
          }}
        />
      ))}

      {/* 5 — diagonal light rays, slow shimmer */}
      {layer(4, 22, (
        <>
          <div style={{ position: 'absolute', top: '-30%', left: '16%', width: 1, height: '160%', transform: 'rotate(28deg)', transformOrigin: 'top left', background: 'linear-gradient(180deg, transparent, rgba(23,249,255,0.07), transparent)' }} />
          <div style={{ position: 'absolute', top: '-30%', left: '44%', width: 1, height: '150%', transform: 'rotate(-24deg)', transformOrigin: 'top left', background: 'linear-gradient(180deg, transparent, rgba(242,247,255,0.05), transparent)' }} />
          <div style={{ position: 'absolute', top: '-30%', left: '70%', width: 1, height: '170%', transform: 'rotate(22deg)', transformOrigin: 'top left', background: 'linear-gradient(180deg, transparent, rgba(242,247,255,0.045), transparent)' }} />
          <div style={{ position: 'absolute', top: '-30%', left: '90%', width: 1, height: '150%', transform: 'rotate(-30deg)', transformOrigin: 'top left', background: 'linear-gradient(180deg, transparent, rgba(245,158,11,0.05), transparent)' }} />
        </>
      ))}

      {/* 6 — glow orbs, slow counter-drift */}
      {layer(5, 26, (
        <div style={{ position: 'absolute', inset: 0 }}>
          <div style={{ position: 'absolute', top: '-10%', left: '-6%', width: 520, height: 520, borderRadius: 999, background: 'radial-gradient(circle, rgba(23,249,255,0.09), transparent 70%)' }} />
          <div style={{ position: 'absolute', bottom: '-12%', right: '-8%', width: 600, height: 600, borderRadius: 999, background: 'radial-gradient(circle, rgba(0,91,197,0.12), transparent 70%)' }} />
        </div>
      ))}

    </div>
  );
}

function Hero() {
  return (
    <section
      style={{
        position: 'relative',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '120px 24px 96px',
        background: NAVY,
        overflow: 'hidden',
      }}
    >
      <HeroBackdrop />
      <div style={{ position: 'relative', zIndex: 1, maxWidth: 860 }}>
        <div className="de-anim" style={{ animationName: 'de-fadeUp', animationDelay: '0ms' }}>
          <Eyebrow>START YOUR JOURNEY</Eyebrow>
        </div>

        <h1
          className="de-anim"
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 64,
            fontWeight: 700,
            letterSpacing: '-0.03em',
            lineHeight: 1.05,
            color: INK,
            margin: 0,
            animationName: 'de-fadeUp',
            animationDelay: '120ms',
          }}
        >
          Learn by <span style={{ color: CYAN }}>building</span>
        </h1>

        <p
          className="de-anim"
          style={{
            maxWidth: 560,
            margin: '24px auto 0',
            fontSize: 17,
            lineHeight: 1.7,
            color: INK2,
            animationName: 'de-fadeUp',
            animationDelay: '240ms',
          }}
        >
          Digital-Edu teaches web development through real projects — you write the code, build
          real pages, and earn a certificate you can prove you earned.
        </p>

        <div
          className="de-anim"
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 14,
            marginTop: 36,
            flexWrap: 'wrap',
            animationName: 'de-fadeUp',
            animationDelay: '360ms',
          }}
        >
          <Link
            to="/register"
            className="de-focus de-cta"
            style={{
              height: 46,
              padding: '0 28px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              borderRadius: 12,
              fontSize: 15,
              fontWeight: 600,
              color: WHITE,
              textDecoration: 'none',
              background: BLUE,
              transition: 'background .15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = SKY)}
            onMouseLeave={(e) => (e.currentTarget.style.background = BLUE)}
          >
            Get Started — it's free
            <ArrowRight size={16} className="de-arrow" />
          </Link>
          <a
            href="#course"
            className="de-focus"
            style={{
              height: 46,
              padding: '0 26px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              borderRadius: 12,
              fontSize: 15,
              fontWeight: 600,
              color: WHITE,
              textDecoration: 'none',
              background: 'rgba(255,255,255,0.10)',
              border: '1px solid rgba(255,255,255,0.2)',
              transition: 'border-color .15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = CYAN)}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)')}
          >
            Explore the Course
          </a>
        </div>

        <div
          className="de-anim"
          style={{
            marginTop: 20,
            fontFamily: FONT_MONO,
            fontSize: 12,
            color: INK3,
            animationName: 'de-fadeUp',
            animationDelay: '420ms',
          }}
        >
          No credit card · Create your free account in 30 seconds
        </div>
      </div>

      <div style={{ position: 'relative', zIndex: 1, width: '100%', marginTop: 72 }}>
        <CurriculumConsole />
      </div>
    </section>
  );
}

/* ── Stat Bar (§4.3) ─────────────────────────────────── */
function Stat({ value, suffix, display, label, animate, start }: {
  value: number;
  suffix?: string;
  display?: string;
  label: string;
  animate: boolean;
  start: boolean;
}) {
  const count = useCountUp(value, start && animate);
  const shown = animate ? `${count}${suffix ?? ''}` : display ?? `${value}${suffix ?? ''}`;
  return (
    <div style={{ textAlign: 'center', padding: '28px 12px' }}>
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 48, fontWeight: 700, letterSpacing: '-0.02em', color: WHITE, lineHeight: 1 }}>
        {shown}
      </div>
      <div style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: INK3, marginTop: 10 }}>
        {label}
      </div>
    </div>
  );
}

function StatBar() {
  const { ref, inView } = useReveal<HTMLDivElement>(0.4);
  return (
    <section
      style={{
        background: NAVY2,
        borderTop: BORDER,
        borderBottom: BORDER,
      }}
    >
      <div
        ref={ref}
        style={{
          maxWidth: 1120,
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 24,
          padding: '20px 24px',
        }}
      >
        <Stat value={1} display="01" label="Course tracks" animate={false} start={inView} />
        <Stat value={320} suffix="+" label="Lessons & labs" animate={inView} start={inView} />
        <Stat value={100} suffix="%" label="Cost to join" animate={inView} start={inView} />
        <Stat value={24} display="24/7" label="Access" animate={false} start={inView} />
      </div>
    </section>
  );
}

/* ── How It Works (§4.4) ─────────────────────────────── */
const METHOD_STEPS = [
  {
    num: '01',
    icon: BookOpen,
    title: 'Learn',
    desc: 'Short, focused lessons. Read a concept, see it in context, move on.',
  },
  {
    num: '02',
    icon: Hammer,
    title: 'Build',
    desc: 'Turn theory into a real project in guided workshops and labs — code it yourself.',
  },
  {
    num: '03',
    icon: ClipboardCheck,
    title: 'Prove',
    desc: 'Quizzes, tests and exams check your understanding — not your luck.',
  },
  {
    num: '04',
    icon: Award,
    title: 'Get certified',
    desc: 'Finish the track, earn the badge, and get a certificate issued by Digital-Edu.',
  },
];

function Method() {
  return (
    <section id="method" style={{ padding: '120px 24px', background: NAVY }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <Reveal>
          <SectionHead eyebrow="METHOD" title={<>One clear path from first line to certificate.</>} />
        </Reveal>

        <div style={{ position: 'relative' }}>
          {/* dashed connector (desktop only) */}
          <div className="de-connector" style={{ position: 'absolute', top: 50, left: '12%', right: '12%', height: 2, zIndex: 0 }}>
            <div
              className="de-anim"
              style={{ animationName: 'de-draw', animationDuration: '1.4s', animationTimingFunction: 'ease-out', height: '100%', background: 'repeating-linear-gradient(90deg, rgba(23,249,255,0.35) 0 6px, transparent 6px 12px)' }}
            />
          </div>
          <div
            className="de-connector"
            style={{ position: 'absolute', top: 46, left: 'calc(50% - 5px)', width: 10, height: 10, transform: 'rotate(45deg)', background: NAVY, border: '1px solid rgba(23,249,255,0.5)', zIndex: 0 }}
          />

          <div style={{ position: 'relative', zIndex: 1, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 24 }}>
            {METHOD_STEPS.map((s, i) => (
              <Reveal key={s.num} delay={i * 80}>
                <div className="de-card" style={{ background: 'rgba(10,42,120,0.55)', border: BORDER, borderRadius: 16, padding: 28, height: '100%', boxSizing: 'border-box' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                    <span style={{ fontFamily: FONT_MONO, fontSize: 13, fontWeight: 600, color: CYAN }}>{s.num}</span>
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: NAVY3, display: 'flex', alignItems: 'center', justifyContent: 'center', color: CYAN }}>
                      <s.icon size={20} />
                    </div>
                  </div>
                  <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 600, color: INK, margin: '0 0 8px' }}>{s.title}</h3>
                  <p style={{ fontSize: 15, lineHeight: 1.6, color: INK2, margin: 0 }}>{s.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Course Showcase (§4.5 + §5.2) ───────────────────── */
const PATH_MILESTONES = [
  { label: 'HTML', lessons: '72 lessons', state: 'done' },
  { label: 'CSS', lessons: '118 lessons', state: 'done' },
  { label: 'Advanced CSS', lessons: '86 lessons', state: 'current' },
  { label: 'Certification Exam', lessons: '5 projects', state: 'todo' },
];

function MilestonePath() {
  return (
    <div>
      <div style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: INK3, marginBottom: 22 }}>
        &gt; curriculum / responsive-web-design
      </div>
      <div style={{ position: 'relative' }}>
        {/* rail — ~40% filled */}
        <div style={{ position: 'absolute', left: 19, top: 0, bottom: 0, width: 2, background: 'rgba(255,255,255,0.1)', borderRadius: 2 }} />
        <div style={{ position: 'absolute', left: 19, top: 0, height: '40%', width: 2, background: CYAN, borderRadius: 2, boxShadow: '0 0 8px rgba(23,249,255,0.6)' }} />
        {/* glowing dot at current position */}
        <div
          style={{
            position: 'absolute',
            left: 12,
            top: '40%',
            width: 16,
            height: 16,
            borderRadius: 999,
            background: CYAN,
            boxShadow: '0 0 12px rgba(23,249,255,0.8)',
            transform: 'translateY(-50%)',
            zIndex: 2,
          }}
        />

        {PATH_MILESTONES.map((m) => {
          const isDone = m.state === 'done';
          const isCurrent = m.state === 'current';
          return (
            <div key={m.label} className="de-node" style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 20, padding: '16px 0' }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  flexShrink: 0,
                  background: NAVY3,
                  border: isCurrent ? '2px solid rgba(23,249,255,0.6)' : BORDER,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: isCurrent || isDone ? CYAN : INK3,
                  position: 'relative',
                }}
              >
                {isDone && <Check size={18} strokeWidth={3} />}
                {!isCurrent && !isDone && <span style={{ fontFamily: FONT_MONO, fontSize: 12 }}>•••</span>}
                {/* hover tooltip */}
                <span className="de-tip" style={{ position: 'absolute', left: '100%', marginLeft: 12, top: '50%', background: NAVY, border: BORDER, borderRadius: 8, padding: '5px 12px', fontFamily: FONT_MONO, fontSize: 11, color: CYAN, whiteSpace: 'nowrap', zIndex: 5 }}>
                  {m.lessons}
                </span>
              </div>
              <div>
                <div style={{ fontFamily: FONT_MONO, fontSize: 14, fontWeight: 600, color: m.state === 'todo' ? INK3 : INK }}>
                  {m.label}
                  {isDone && <span style={{ color: CYAN, marginLeft: 8 }}>✓</span>}
                </div>
                <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: INK3, marginTop: 4 }}>
                  {isDone ? 'completed' : isCurrent ? 'in progress' : 'locked'}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LessonWindow() {
  const options = ['display: grid', 'display: flex', 'float: left', 'position: absolute'];
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ background: NAVY3, borderRadius: 14, border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 30px 70px rgba(0,0,0,0.45)', overflow: 'hidden' }}>
        {/* browser bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', gap: 7 }}>
            <span style={{ width: 10, height: 10, borderRadius: 999, background: '#FF5F57' }} />
            <span style={{ width: 10, height: 10, borderRadius: 999, background: '#FEBC2E' }} />
            <span style={{ width: 10, height: 10, borderRadius: 999, background: '#28C840' }} />
          </div>
          <div style={{ flex: 1, textAlign: 'center', fontFamily: FONT_MONO, fontSize: 11, color: INK3, background: 'rgba(255,255,255,0.04)', borderRadius: 7, padding: '4px 10px' }}>
            quiz / layout-quiz-04
          </div>
          <div style={{ width: 10 }} />
        </div>

        {/* quiz UI */}
        <div style={{ padding: '22px 22px 26px' }}>
          <div style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: INK3, marginBottom: 12 }}>
            certification exam · question 4 of 40
          </div>
          <p style={{ fontFamily: FONT_DISPLAY, fontSize: 17, fontWeight: 600, color: INK, lineHeight: 1.5, margin: '0 0 16px' }}>
            Which property lays out elements side by side, in rows and columns?
          </p>
          {options.map((opt, i) => (
            <div
              key={opt}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                borderRadius: 10,
                marginBottom: 8,
                border: i === 0 ? '1px solid rgba(34,197,94,0.55)' : '1px solid rgba(255,255,255,0.08)',
                background: i === 0 ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.02)',
                fontFamily: FONT_MONO,
                fontSize: 12.5,
                color: i === 0 ? '#4ade80' : INK2,
              }}
            >
              <span style={{ width: 14, height: 14, borderRadius: 999, border: i === 0 ? '2px solid #4ade80' : '1px solid rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {i === 0 && <Check size={10} color="#4ade80" strokeWidth={4} />}
              </span>
              {opt}
            </div>
          ))}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 10, padding: '10px 20px', borderRadius: 10, background: BLUE, color: WHITE, fontSize: 13, fontWeight: 600, fontFamily: FONT_BODY }}>
            Check Answers
            <ArrowRight size={14} className="de-arrow" />
          </div>
        </div>
      </div>

      {/* floating score badge */}
      <div style={{ position: 'absolute', bottom: -18, left: -14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: NAVY3, border: '1px solid rgba(34,197,94,0.5)', borderRadius: 999, padding: '9px 16px', boxShadow: SHADOW_CARD }}>
          <Check size={13} color="#22c55e" strokeWidth={3} />
          <span style={{ fontFamily: FONT_MONO, fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: INK }}>
            SCORE 32/40 — PASSED
          </span>
        </div>
      </div>
    </div>
  );
}

function CourseShowcase() {
  const tags = ['HTML', 'CSS', 'FLEX & GRID', 'EXAM'];
  return (
    <section id="course" style={{ padding: '120px 24px', background: NAVY, borderTop: BORDER }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <Reveal>
          <SectionHead
            eyebrow="THE TRACK"
            title="Responsive Web Design — start here."
            lede="Build 5 real projects, complete 320+ lessons, pass the certification exam, and earn your first Digital-Edu certificate."
          />
        </Reveal>

        <div style={{ display: 'grid', gridTemplateColumns: '58% 42%', gap: 56, alignItems: 'center' }}>
          <Reveal>
            <MilestonePath />
          </Reveal>
          <Reveal delay={120}>
            <LessonWindow />
          </Reveal>
        </div>

        <Reveal delay={80}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap', marginTop: 48 }}>
            {tags.map((t) => (
              <span key={t} style={{ fontFamily: FONT_MONO, fontSize: 12, letterSpacing: '0.08em', color: INK3 }}>
                {t}
              </span>
            ))}
            <span style={{ marginLeft: 'auto' }}>
              <Link
                to="/courses"
                className="de-focus de-cta"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 46, padding: '0 26px', borderRadius: 12, fontSize: 15, fontWeight: 600, color: WHITE, textDecoration: 'none', background: BLUE, transition: 'background .15s' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = SKY)}
                onMouseLeave={(e) => (e.currentTarget.style.background = BLUE)}
              >
                Start the track
                <ArrowRight size={15} className="de-arrow" />
              </Link>
            </span>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ── Features (§4.6) ─────────────────────────────────── */
const FEATURES = [
  { icon: SquareCode, title: 'Interactive code editor', desc: 'Write and run code inside every workshop. Instant feedback, no setup.' },
  { icon: Wrench, title: 'Guided workshops & labs', desc: 'Step-by-step builds with a real validator that checks your work as you go.' },
  { icon: TrendingUp, title: 'Progress tracking & streaks', desc: 'See exactly where you are. Keep a streak alive and make learning a habit.' },
  { icon: ClipboardCheck, title: 'Quizzes, tests & exams', desc: 'Three levels of checks, from quick quizzes to the full certification exam.' },
  { icon: BadgeCheck, title: 'Badges that stick with you', desc: 'Earn badges for milestones — proof you showed up and did the work.' },
  { icon: Award, title: 'Verifiable certificates', desc: 'A Digital-Edu certificate, issued on completion, ready to share.' },
];

function Features() {
  return (
    <section id="features" style={{ padding: '120px 24px', background: NAVY, borderTop: BORDER }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <Reveal>
          <SectionHead eyebrow="WHY DIGITAL-EDU" title="Everything you need. Nothing you don't." />
        </Reveal>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={(i % 3) * 80}>
              <div className="de-card" style={{ background: 'rgba(10,42,120,0.55)', border: BORDER, borderRadius: 16, padding: 28, height: '100%', boxSizing: 'border-box' }}>
                <div style={{ width: 48, height: 48, borderRadius: 12, background: NAVY3, display: 'flex', alignItems: 'center', justifyContent: 'center', color: CYAN, marginBottom: 20 }}>
                  <f.icon size={22} />
                </div>
                <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 600, color: INK, margin: '0 0 8px' }}>{f.title}</h3>
                <p style={{ fontSize: 15, lineHeight: 1.6, color: INK2, margin: 0 }}>{f.desc}</p>
                <div className="de-more" style={{ marginTop: 18, fontFamily: FONT_MONO, fontSize: 12, color: CYAN, display: 'flex', alignItems: 'center', gap: 6 }}>
                  Learn more <ArrowRight size={13} />
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Human Strip (§4.7) ──────────────────────────────── */
/* System-drawn stand-in for the warm learner photo (no photo asset in repo yet). */
function LearnerDesk() {
  return (
    <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', border: BORDER, boxShadow: SHADOW_CARD }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(circle at 70% 30%, rgba(23,249,255,0.16), transparent 55%), linear-gradient(160deg, #0A2A78 0%, #001449 70%)',
        }}
      />
      {/* editor screen */}
      <div style={{ position: 'relative', margin: '16% 10% 8%', background: '#030B2E', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '16px 18px', boxShadow: '0 24px 60px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          <span style={{ width: 9, height: 9, borderRadius: 999, background: '#FF5F57' }} />
          <span style={{ width: 9, height: 9, borderRadius: 999, background: '#FEBC2E' }} />
          <span style={{ width: 9, height: 9, borderRadius: 999, background: '#28C840' }} />
        </div>
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <div key={n} style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: '#33406B', width: 12 }}>{n + 1}</span>
            <div style={{ width: n === 4 ? '38%' : n === 5 ? '26%' : '55%', height: 7, borderRadius: 3, background: n === 4 ? 'rgba(23,249,255,0.4)' : 'rgba(255,255,255,0.14)' }} />
          </div>
        ))}
        <div style={{ position: 'absolute', right: 14, bottom: 12, width: 9, height: 9, borderRadius: 999, background: CYAN, boxShadow: '0 0 10px rgba(23,249,255,0.9)' }} />
      </div>
      {/* desk glow + caption */}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '32%', background: 'linear-gradient(0deg, rgba(0,20,90,0.55), transparent)' }} />
      <div style={{ position: 'relative', padding: '0 22px 18px', fontFamily: FONT_MONO, fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: INK3 }}>
        DIGITAL-EDU / LIVE FROM THE LEARNER'S DESK
      </div>
    </div>
  );
}

function HumanStrip() {
  return (
    <section style={{ background: NAVY2, borderTop: BORDER, borderBottom: BORDER }}>
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '120px 24px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 64, alignItems: 'center' }}>
        <Reveal>
          <LearnerDesk />
        </Reveal>
        <Reveal delay={120}>
          <div>
            <Eyebrow>REAL PEOPLE</Eyebrow>
            <h2 style={{ fontFamily: FONT_DISPLAY, fontSize: 40, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.1, color: INK, margin: '0 0 28px' }}>
              Real people. Real projects.
            </h2>
            {/* streak card */}
            <div className="de-card" style={{ display: 'flex', alignItems: 'center', gap: 14, background: 'rgba(10,42,120,0.55)', border: BORDER, borderRadius: 14, padding: '18px 20px', maxWidth: 360, marginBottom: 14 }}>
              <div style={{ width: 42, height: 42, borderRadius: 10, background: 'rgba(245,158,11,0.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Flame size={20} color={GOLD} />
              </div>
              <div>
                <div style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '0.08em', color: INK3, textTransform: 'uppercase' }}>Current streak</div>
                <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600, color: INK, marginTop: 2 }}>14 days</div>
              </div>
            </div>
            {/* badge card */}
            <div className="de-card" style={{ display: 'flex', alignItems: 'center', gap: 14, background: 'rgba(10,42,120,0.55)', border: BORDER, borderRadius: 14, padding: '18px 20px', maxWidth: 400 }}>
              <div style={{ width: 42, height: 42, borderRadius: 10, background: 'rgba(23,249,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Check size={20} color={CYAN} strokeWidth={3} />
              </div>
              <div>
                <div style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '0.08em', color: INK3, textTransform: 'uppercase' }}>Badge unlocked</div>
                <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, fontWeight: 600, color: INK, marginTop: 2 }}>Responsive Web Design · HTML</div>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ── Certificate & Badges (§4.8) ─────────────────────── */
function Certificate() {
  const { ref, inView } = useReveal<HTMLDivElement>(0.3);
  const badges = ['HTML', 'CSS', 'Certification'];
  return (
    <section id="certificates" style={{ padding: '120px 24px', background: NAVY }}>
      <div style={{ maxWidth: 1120, margin: '0 auto', textAlign: 'center' }}>
        <Reveal>
          <div style={{ maxWidth: 640, margin: '0 auto' }}>
            <SectionHead eyebrow="THE REWARD" title="Work you can prove." />
          </div>
        </Reveal>

        <Reveal delay={120}>
          <div style={{ position: 'relative', maxWidth: 720, margin: '0 auto' }}>
            {/* glow */}
            <div style={{ position: 'absolute', inset: -40, background: 'radial-gradient(ellipse, rgba(23,249,255,0.10), transparent 70%)', pointerEvents: 'none' }} />
            <div
              ref={ref}
              className={inView ? 'de-cert de-cert-in' : 'de-cert'}
              style={{ position: 'relative', background: WHITE, borderRadius: 14, padding: '44px 48px', boxShadow: '0 40px 90px rgba(0,0,0,0.55)', textAlign: 'left' }}
            >
              <div style={{ border: '2px solid #001449', borderRadius: 10, padding: '32px 28px', position: 'relative' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14, letterSpacing: '0.18em', color: '#005BC5', textTransform: 'uppercase' }}>
                    Digital-Edu
                  </div>
                  <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 34, color: '#001449', letterSpacing: '-0.02em', margin: '22px 0 6px' }}>
                    Certificate of Completion
                  </div>
                  <div style={{ fontFamily: FONT_MONO, fontSize: 13, letterSpacing: '0.1em', color: '#6B87B5', textTransform: 'uppercase', marginBottom: 26 }}>
                    Responsive Web Design
                  </div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 14, lineHeight: 1.7, color: '#445E8C', maxWidth: 400, margin: '0 auto 30px' }}>
                    This certifies that <strong style={{ color: '#001449' }}>[learner name]</strong> has successfully completed all lessons,
                    projects, quizzes and the certification exam.
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ borderBottom: '1px solid #001449', width: 180, marginBottom: 8 }} />
                      <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: '#6B87B5', letterSpacing: '0.08em' }}>ISSUED BY DIGITAL-EDU · [DATE]</div>
                    </div>
                    {/* gold seal */}
                    <div style={{ width: 64, height: 64, borderRadius: 999, border: '3px solid #F59E0B', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #FEF3C7, #FDE68A)', flexShrink: 0 }}>
                      <Award size={26} color="#B45309" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Reveal>

        {/* badges */}
        <Reveal delay={200}>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 14, marginTop: 44, flexWrap: 'wrap' }}>
            {badges.map((b) => (
              <div key={b} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: NAVY3, border: BORDER, borderRadius: 999, padding: '10px 18px' }}>
                <Check size={13} color={CYAN} strokeWidth={3} />
                <span style={{ fontFamily: FONT_MONO, fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', color: INK }}>{b}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 18, fontFamily: FONT_MONO, fontSize: 12, color: INK3 }}>
            Certificates are issued by Digital-Edu and reflect completed, verified work.
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ── Testimonials (§4.9) ─────────────────────────────── */
const TESTIMONIALS = [
  { quote: 'I opened the track with zero HTML. Six weeks later I shipped my own portfolio page and got my certificate 6 weeks later.', name: 'Sofia R.', role: 'Career switcher · 32' },
  { quote: 'The workshops check your code as you write it. No guessing, no watching — you build, and you can see yourself getting better every week.', name: 'Daniel M.', role: 'Self-taught · 27' },
  { quote: 'The exam felt real because the projects were real. I passed on the first try, and the certificate sits on my wall today.', name: 'Aisha K.', role: 'Student · 21' },
];

function Testimonials() {
  const colors = ['#005BC5', '#0A2A78', '#00B4FC'];
  return (
    <section style={{ padding: '120px 24px', background: NAVY, borderTop: BORDER }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <Reveal>
          <SectionHead eyebrow="LEARNERS" title="From first lesson to certified." />
        </Reveal>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
          {TESTIMONIALS.map((t, i) => (
            <Reveal key={t.name} delay={i * 80}>
              <div className="de-card" style={{ background: 'rgba(10,42,120,0.55)', border: BORDER, borderRadius: 16, padding: 28, height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
                <p style={{ fontSize: 18, fontWeight: 500, lineHeight: 1.6, color: INK, margin: '0 0 24px', flex: 1 }}>
                  &ldquo;{t.quote}&rdquo;
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 48, height: 48, borderRadius: 999, background: `linear-gradient(135deg, ${colors[i]}, #001449)`, border: '1px solid rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT_MONO, fontSize: 14, fontWeight: 600, color: WHITE, flexShrink: 0 }}>
                    {t.name.split(' ').map((w) => w[0]).join('')}
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: WHITE }}>{t.name}</div>
                    <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: INK3, marginTop: 2, letterSpacing: '0.04em' }}>{t.role}</div>
                  </div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── FAQ (§4.10) ─────────────────────────────────────── */
const FAQ_ITEMS = [
  { q: 'Is it really free?', a: 'Yes. The full track, the editor, and the certificate are free, forever. No trials, no paywalls.' },
  { q: 'Do I need experience?', a: 'None. The Responsive Web Design track starts from the very first HTML tag.' },
  { q: 'How long does it take?', a: 'Most learners finish in 6–10 weeks at a few hours a week. Learn at your own pace.' },
  { q: 'What do I get at the end?', a: 'A Digital-Edu certificate and milestone badges, backed by completed projects and a passed exam.' },
  { q: 'What if I get stuck?', a: 'Every workshop validates your code step-by-step, so you always know what’s next.' },
];

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" style={{ padding: '120px 24px', background: NAVY2 }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <Reveal>
          <div style={{ maxWidth: 640, margin: '0 auto', textAlign: 'center' }}>
            <SectionHead eyebrow="FAQ" title="Quick answers." />
          </div>
        </Reveal>
        {FAQ_ITEMS.map((it, i) => {
          const isOpen = open === i;
          return (
            <Reveal key={it.q} delay={i * 60}>
              <div style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <button
                  className="de-focus"
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, padding: '20px 4px', background: 'transparent', border: 'none', cursor: 'pointer', color: INK, fontSize: 16, fontWeight: 600, textAlign: 'left', fontFamily: FONT_BODY }}
                >
                  <span>{it.q}</span>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 18, lineHeight: 1, color: CYAN, transition: 'transform .24s ease', transform: isOpen ? 'rotate(45deg)' : 'none', flexShrink: 0 }}>+</span>
                </button>
                <div style={{ display: 'grid', gridTemplateRows: isOpen ? '1fr' : '0fr', transition: 'grid-template-rows .24s ease' }}>
                  <div style={{ overflow: 'hidden' }}>
                    <p style={{ fontSize: 15, lineHeight: 1.7, color: INK2, margin: 0, padding: '0 4px 20px' }}>{it.a}</p>
                  </div>
                </div>
              </div>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}

/* ── Final CTA (§4.11) ───────────────────────────────── */
const NIGHTLY_BASE = 'https://github.com/nexuss0781/Digital-Edu/releases/download/nightly';

const DESKTOP_DOWNLOADS = [
  { href: `${NIGHTLY_BASE}/DigitalEdu-windows.exe`, label: 'Windows 10 / 11', icon: AppWindow },
  { href: `${NIGHTLY_BASE}/DigitalEdu-windows7.exe`, label: 'Windows 7', icon: Monitor },
  { href: `${NIGHTLY_BASE}/digitaledu-nightly-amd64.deb`, label: 'Debian (.deb)', icon: Package },
  { href: `${NIGHTLY_BASE}/DigitalEdu-linux-binary`, label: 'Linux binary', icon: Terminal },
];

function FinalCta() {
  return (
    <section style={{ position: 'relative', padding: '140px 24px', background: NAVY, overflow: 'hidden', borderTop: BORDER }}>
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 720,
          height: 520,
          borderRadius: 999,
          background: 'radial-gradient(ellipse, rgba(23,249,255,0.14), transparent 65%)',
          pointerEvents: 'none',
        }}
      />
      <div style={{ position: 'relative', zIndex: 1, maxWidth: 640, margin: '0 auto', textAlign: 'center' }}>
        <div className="de-anim" style={{ animationName: 'de-fadeUp' }}>
          <Eyebrow>READY</Eyebrow>
        </div>
        <h2 className="de-anim" style={{ fontFamily: FONT_DISPLAY, fontSize: 44, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.1, color: INK, margin: 0, animationName: 'de-fadeUp', animationDelay: '100ms' }}>
          Your first project is waiting.
        </h2>
        <p className="de-anim" style={{ fontSize: 17, lineHeight: 1.7, color: INK2, margin: '18px 0 34px', animationName: 'de-fadeUp', animationDelay: '200ms' }}>
          Create your free account and write your first line of code today.
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Link
            to="/register"
            className="de-focus de-cta"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 10, height: 52, padding: '0 34px', borderRadius: 12, fontSize: 16, fontWeight: 600, color: WHITE, textDecoration: 'none', background: BLUE, boxShadow: '0 16px 40px rgba(0,91,197,0.4)', transition: 'background .15s' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = SKY)}
            onMouseLeave={(e) => (e.currentTarget.style.background = BLUE)}
          >
            Create free account
            <ArrowRight size={17} className="de-arrow" />
          </Link>
        </div>
        {/* Desktop app downloads — all platforms, rolling nightly build */}
        <div style={{ marginTop: 38 }}>
          <div style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '0.14em', color: INK3, marginBottom: 14, textTransform: 'uppercase' }}>
            Or download the desktop app · offline after install
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
            {DESKTOP_DOWNLOADS.map((d) => {
              const Icon = d.icon;
              return (
                <a
                  key={d.label}
                  href={d.href}
                  download
                  className="de-focus"
                  title={`Download DigitalEdu for ${d.label}`}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 9, height: 46, padding: '0 20px', borderRadius: 12, fontSize: 14, fontWeight: 600, color: INK, textDecoration: 'none', background: 'rgba(23,249,255,0.10)', border: '1px solid rgba(23,249,255,0.4)', transition: 'background .15s, border-color .15s' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(23,249,255,0.18)'; e.currentTarget.style.borderColor = CYAN; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(23,249,255,0.10)'; e.currentTarget.style.borderColor = 'rgba(23,249,255,0.4)'; }}
                >
                  <Icon size={16} />
                  {d.label}
                </a>
              );
            })}
          </div>
          <div style={{ marginTop: 14, fontFamily: FONT_MONO, fontSize: 11, color: INK3 }}>
            Free · No internet required after download · Debian/Ubuntu: sudo dpkg -i digitaledu-nightly-amd64.deb
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Footer (§4.12 + §7.4) ───────────────────────────── */
const FOOTER_COLS = [
  { title: 'Platform', links: ['Courses', 'Method', 'Certificates', 'FAQ'] },
  { title: 'Track', links: ['Responsive Web Design', 'HTML', 'CSS', 'Certification Exam'] },
  { title: 'Resources', links: ['Get Started', 'Create account', 'Sign in', 'Support'] },
  { title: 'Legal', links: ['Privacy', 'Terms', 'Cookie policy'] },
];

function LandingFooter() {
  const socials = [Github, Twitter, Youtube];
  return (
    <footer style={{ background: NAVY, borderTop: '1px solid rgba(255,255,255,0.08)', padding: '72px 24px 40px' }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr 1fr', gap: 32 }}>
          <div>
            <Wordmark />
            <p style={{ fontSize: 14, lineHeight: 1.7, color: INK2, margin: '16px 0 20px', maxWidth: 260 }}>
              Competency-based learning: read it, build it, prove it, earn it.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              {socials.map((Icon, i) => (
                <a
                  key={i}
                  href="#"
                  aria-label="Social link"
                  className="de-focus"
                  style={{ width: 36, height: 36, borderRadius: 999, border: '1px solid rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: INK2, transition: 'border-color .15s, color .15s' }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = CYAN; e.currentTarget.style.color = CYAN; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'; e.currentTarget.style.color = INK2; }}
                >
                  <Icon size={15} />
                </a>
              ))}
            </div>
          </div>
          {FOOTER_COLS.map((col) => (
            <div key={col.title}>
              <div style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: INK3, marginBottom: 16 }}>{col.title}</div>
              {col.links.map((l) => (
                <a
                  key={l}
                  href="#"
                  className="de-focus"
                  style={{ display: 'block', fontSize: 14, color: INK2, textDecoration: 'none', padding: '5px 0', transition: 'color .15s' }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = CYAN)}
                  onMouseLeave={(e) => (e.currentTarget.style.color = INK2)}
                >
                  {l}
                </a>
              ))}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginTop: 56, paddingTop: 24, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: INK3 }}>
            © 2026 Digital-Edu. All rights reserved.
          </span>
          <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: INK3 }}>
            Course content adapted from freeCodeCamp.org,{' '}
            <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer" style={{ color: INK2, textDecoration: 'none' }}>
              CC BY-SA 4.0 ↗
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  return (
    <>
      <style>{landingStyles}</style>
      <div style={{ background: NAVY, color: INK, fontFamily: FONT_BODY, minHeight: '100vh' }}>
        <LandingNav />
        <Hero />
        <StatBar />
        <Method />
        <CourseShowcase />
        <Features />
        <HumanStrip />
        <Certificate />
        <Testimonials />
        <Faq />
        <FinalCta />
        <LandingFooter />
      </div>
    </>
  );
}
