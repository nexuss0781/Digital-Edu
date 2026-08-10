import { useEffect, useState } from 'react';

export default function AppLoader() {
  const [visible, setVisible] = useState(true);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFading(true), 1200);
    const hideTimer = setTimeout(() => setVisible(false), 1500);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#001449',
        transition: 'opacity 0.3s ease',
        opacity: fading ? 0 : 1,
        pointerEvents: fading ? 'none' : 'auto',
      }}
    >
      <div style={{ position: 'relative', width: 100, height: 100, marginBottom: 32 }}>
        <img
          src="/images/logo.svg"
          alt="DigitalEdu"
          width={100}
          height={100}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            animation: 'loader-pulse 1.5s ease-in-out infinite',
          }}
        />
      </div>

      <div
        style={{
          color: '#17F9FF',
          fontSize: 22,
          fontWeight: 700,
          fontFamily: 'var(--font-display)',
          letterSpacing: '0.05em',
        }}
      >
        DigitalEdu
      </div>

      <style>{`
        @keyframes loader-pulse {
          0% { transform: scale(0.9); opacity: 0.7; }
          50% { transform: scale(1.1); opacity: 1; }
          100% { transform: scale(0.9); opacity: 0.7; }
        }
      `}</style>
    </div>
  );
}
