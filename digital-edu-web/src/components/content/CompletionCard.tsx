import { useEffect, useRef } from 'react';
import { PartyPopper, ArrowRight, X, Sparkles } from 'lucide-react';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rotation: number;
  rotSpeed: number;
  shape: 'rect' | 'circle';
  life: number;
  decay: number;
}

const CONFETTI_COLORS = ['#FF6B6B', '#FFD93D', '#6BCB77', '#4D96FF', '#FF9F45', '#F472B6', '#A78BFA', '#17F9FF', '#FBBF24'];

function ConfettiBurst() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const DPR = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * DPR;
    canvas.height = canvas.offsetHeight * DPR;
    ctx.scale(DPR, DPR);

    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    const cx = W / 2;
    const cy = 70;

    const particles: Particle[] = [];
    for (let i = 0; i < 160; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 9;
      particles.push({
        x: cx + (Math.random() - 0.5) * 60,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.7 - 2,
        size: 4 + Math.random() * 6,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        rotation: Math.random() * Math.PI,
        rotSpeed: (Math.random() - 0.5) * 0.35,
        shape: Math.random() > 0.5 ? 'rect' : 'circle',
        life: 1,
        decay: 0.004 + Math.random() * 0.008,
      });
    }

    let raf = 0;
    const tick = () => {
      ctx.clearRect(0, 0, W, H);
      let alive = false;
      for (const p of particles) {
        if (p.life <= 0) continue;
        alive = true;
        p.vy += 0.16;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.rotSpeed;
        p.life -= p.decay;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        if (p.shape === 'circle') {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size / 1.5);
        }
        ctx.restore();
      }
      if (alive) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />;
}

export default function CompletionCard({
  open,
  title,
  onContinue,
  onClose,
}: {
  open: boolean;
  title?: string;
  onContinue: () => void;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center px-4 pb-6 sm:pb-10">
      {/* Blur the rest of the page */}
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(5,10,25,0.55)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
        onClick={onClose}
      />

      {/* Card */}
      <div
        className="animate-pop-in relative w-full max-w-md overflow-hidden rounded-3xl"
        style={{
          background: 'linear-gradient(165deg, #141b38 0%, #1b2548 55%, #232f5c 100%)',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 30px 90px rgba(0,0,0,0.6), 0 0 60px rgba(23,249,255,0.12)',
        }}
      >
        <ConfettiBurst />

        {/* Decorative glows */}
        <div
          className="pointer-events-none absolute -top-16 -left-16 h-48 w-48 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(23,249,255,0.35), transparent 70%)' }}
        />
        <div
          className="pointer-events-none absolute -bottom-20 -right-16 h-56 w-56 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(249,115,22,0.3), transparent 70%)' }}
        />

        <button
          onClick={onClose}
          title="Close"
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full transition-colors"
          style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)', border: 'none', cursor: 'pointer' }}
        >
          <X size={16} />
        </button>

        <div className="relative z-[1] px-8 py-10 text-center">
          {/* Icon badge */}
          <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full" style={{ background: 'linear-gradient(135deg, #FFD93D, #FF9F45, #F472B6)' }}>
            <PartyPopper size={36} color="#ffffff" strokeWidth={2.2} />
          </div>

          <div className="mb-2 flex items-center justify-center gap-2">
            <Sparkles size={16} style={{ color: '#17F9FF' }} />
            <span className="text-xs font-bold uppercase tracking-[0.2em]" style={{ color: '#17F9FF' }}>
              Lesson complete
            </span>
            <Sparkles size={16} style={{ color: '#17F9FF' }} />
          </div>

          <h2
            className="mb-2 text-3xl font-extrabold"
            style={{ color: '#ffffff', fontFamily: 'var(--font-display)', textShadow: '0 2px 20px rgba(23,249,255,0.35)' }}
          >
            Great job!
          </h2>

          {title && (
            <p className="mx-auto mb-1 text-sm font-medium" style={{ color: 'rgba(255,255,255,0.85)' }}>
              You finished <span style={{ color: '#FFD93D' }}>“{title}”</span>
            </p>
          )}
          <p className="mx-auto mb-7 max-w-xs text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
            Keep the streak going — your next lesson is ready.
          </p>

          <button
            onClick={onContinue}
            className="flex w-full items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-sm font-bold transition-all hover:brightness-110 active:scale-[0.98]"
            style={{
              background: 'linear-gradient(135deg, #17F9FF, #0EA5E9)',
              color: '#04121f',
              boxShadow: '0 10px 30px rgba(23,249,255,0.3)',
              cursor: 'pointer',
              border: 'none',
            }}
          >
            Continue Learning
            <ArrowRight size={17} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  );
}
