import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { CheckCircle, XCircle } from 'lucide-react';
import { setToastHandler } from '@/lib/api';

type ToastItem = { id: number; message: string; isError: boolean };

const ToastContext = createContext<{ toast: (msg: string, isError?: boolean) => void }>({
  toast: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [counter, setCounter] = useState(0);

  const toast = useCallback((message: string, isError = false) => {
    setCounter((c) => {
      const id = c + 1;
      setToasts((prev) => [...prev, { id, message, isError }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 3500);
      return id;
    });
  }, []);

  useEffect(() => {
    setToastHandler(toast);
  }, [toast]);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          pointerEvents: 'none',
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              pointerEvents: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '12px 20px',
              borderRadius: 10,
              backgroundColor: 'var(--bg-card)',
              border: `1px solid ${t.isError ? 'var(--danger)' : 'var(--success)'}`,
              boxShadow: 'var(--shadow-md)',
              color: 'var(--text)',
              minWidth: 260,
              maxWidth: 400,
              animation: 'slide-up 0.3s ease',
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            {t.isError ? (
              <XCircle size={18} style={{ color: 'var(--danger)', flexShrink: 0 }} />
            ) : (
              <CheckCircle size={18} style={{ color: 'var(--success)', flexShrink: 0 }} />
            )}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
